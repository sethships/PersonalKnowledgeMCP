/**
 * OIDC Route Handlers
 *
 * Express router for OIDC authentication endpoints.
 *
 * @module http/routes/oidc
 */

import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import type { Logger } from "pino";
import { getComponentLogger } from "../../logging/index.js";
import type { OidcProvider, OidcSessionStore } from "../../auth/oidc/oidc-types.js";
import { OIDC_SESSION_COOKIE } from "../../auth/oidc/oidc-types.js";
import { getOidcCookieOptions } from "../../auth/oidc/oidc-middleware.js";
import { badRequest, unauthorized } from "../middleware/error-handler.js";

/**
 * Lazy-initialized logger
 */
let logger: Logger | null = null;

function getLogger(): Logger {
  if (!logger) {
    logger = getComponentLogger("http:oidc-routes");
  }
  return logger;
}

/**
 * Dependencies for OIDC routes
 */
export interface OidcRouterDeps {
  /** OIDC provider instance */
  oidcProvider: OidcProvider;
  /** Session store for managing sessions */
  sessionStore: OidcSessionStore;
}

/**
 * Create OIDC router
 *
 * Endpoints:
 * - GET /authorize - Start OIDC authentication flow
 * - GET /callback - Handle IdP callback after authentication
 * - POST /logout - End OIDC session
 * - GET /userinfo - Get current user info
 *
 * @param deps - Router dependencies
 * @returns Express router
 */
export function createOidcRouter(deps: OidcRouterDeps): Router {
  const { oidcProvider, sessionStore } = deps;
  const router = Router();

  /**
   * GET /authorize
   *
   * Start OIDC authentication flow.
   * Creates a new session and redirects to the IdP authorization endpoint.
   *
   * Query parameters:
   * - redirect_to: Optional URL to redirect to after successful authentication
   */
  router.get("/authorize", async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!oidcProvider.isEnabled()) {
        throw badRequest("OIDC authentication is not enabled");
      }

      // Get optional redirect URL from query parameter
      const redirectTo = req.query.redirect_to;
      let originalUrl: string | undefined;
      if (redirectTo && typeof redirectTo === "string") {
        // Validate the redirect URL to prevent open redirect vulnerabilities
        try {
          const url = new URL(redirectTo);
          // Only allow same-origin redirects or relative paths
          const requestHost = req.get("host") || "";
          if (url.host === requestHost || redirectTo.startsWith("/")) {
            originalUrl = redirectTo;
          } else {
            getLogger().warn(
              { redirectTo, requestHost },
              "Ignoring cross-origin redirect_to parameter"
            );
          }
        } catch {
          // If it's not a valid URL, check if it's a relative path
          if (redirectTo.startsWith("/")) {
            originalUrl = redirectTo;
          }
        }
      }

      // Create a new session for this auth flow
      const session = await sessionStore.createSession();

      // Set session cookie
      const config = oidcProvider.getConfig();
      res.cookie(OIDC_SESSION_COOKIE, session.sessionId, {
        ...getOidcCookieOptions(config),
        maxAge: config.sessionTtlSeconds * 1000,
      });

      // Get authorization URL (passing original URL for post-auth redirect)
      const authUrl = await oidcProvider.getAuthorizationUrl(session.sessionId, originalUrl);

      getLogger().info(
        { sessionId: session.sessionId, hasRedirectTo: !!originalUrl },
        "Starting OIDC authorization flow"
      );

      // Redirect to IdP
      res.redirect(authUrl);
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /callback
   *
   * Handle IdP callback after authentication.
   * Exchanges authorization code for tokens and establishes session.
   * Redirects to original URL if one was provided during authorization.
   */
  router.get("/callback", async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!oidcProvider.isEnabled()) {
        throw badRequest("OIDC authentication is not enabled");
      }

      const { code, state, error, error_description } = req.query;

      // Check for error from IdP
      if (error) {
        const errorStr = typeof error === "string" ? error : "unknown_error";
        const errorDescStr = typeof error_description === "string" ? error_description : undefined;
        getLogger().warn(
          { error: errorStr, error_description: errorDescStr },
          "OIDC authorization error from IdP"
        );
        throw badRequest(`Authorization failed: ${errorDescStr || errorStr}`, "OIDC_AUTH_ERROR");
      }

      // Validate required parameters
      if (!code || typeof code !== "string") {
        throw badRequest("Missing authorization code", "MISSING_CODE");
      }
      if (!state || typeof state !== "string") {
        throw badRequest("Missing state parameter", "MISSING_STATE");
      }

      // Get session ID from cookie
      const cookies = req.cookies as Record<string, string> | undefined;
      const sessionId = cookies?.[OIDC_SESSION_COOKIE];
      if (!sessionId || typeof sessionId !== "string") {
        throw badRequest(
          "Missing session cookie - please start authorization flow again",
          "MISSING_SESSION"
        );
      }

      // Get session to capture originalUrl before handleCallback clears authFlowState
      const preCallbackSession = await sessionStore.getSession(sessionId);
      const originalUrl = preCallbackSession?.authFlowState?.originalUrl;

      // Handle callback (this clears authFlowState)
      const session = await oidcProvider.handleCallback(sessionId, code, state);

      // Update cookie with new expiry
      const config = oidcProvider.getConfig();
      res.cookie(OIDC_SESSION_COOKIE, session.sessionId, {
        ...getOidcCookieOptions(config),
        maxAge: config.sessionTtlSeconds * 1000,
      });

      getLogger().info(
        { sessionId, sub: session.user?.sub, hasRedirect: !!originalUrl },
        "OIDC authentication successful"
      );

      // Redirect to original URL if provided, otherwise return JSON response
      if (originalUrl) {
        res.redirect(originalUrl);
      } else {
        // No redirect URL - return JSON success response for API clients
        res.json({
          success: true,
          message: "Authentication successful",
          user: {
            email: session.user?.email,
            name: session.user?.name,
          },
        });
      }
    } catch (error) {
      // Clear cookie on error
      res.clearCookie(OIDC_SESSION_COOKIE, getOidcCookieOptions(oidcProvider.getConfig()));
      next(error);
    }
  });

  /**
   * POST /logout
   *
   * End OIDC session.
   */
  router.post("/logout", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const cookies = req.cookies as Record<string, string> | undefined;
      const sessionId = cookies?.[OIDC_SESSION_COOKIE];

      if (sessionId && typeof sessionId === "string") {
        await oidcProvider.logout(sessionId);
        getLogger().info({ sessionId }, "OIDC logout successful");
      }

      // Clear cookie
      const cookieOptions = getOidcCookieOptions(oidcProvider.getConfig());
      res.clearCookie(OIDC_SESSION_COOKIE, cookieOptions);

      res.json({
        success: true,
        message: "Logged out successfully",
      });
    } catch (error) {
      // Still clear cookie even on error
      res.clearCookie(OIDC_SESSION_COOKIE, getOidcCookieOptions(oidcProvider.getConfig()));
      next(error);
    }
  });

  /**
   * GET /userinfo
   *
   * Get current user info from OIDC session.
   * Requires an active OIDC session.
   */
  router.get("/userinfo", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const cookies = req.cookies as Record<string, string> | undefined;
      const sessionId = cookies?.[OIDC_SESSION_COOKIE];

      if (!sessionId || typeof sessionId !== "string") {
        throw unauthorized("No active OIDC session", "NO_SESSION");
      }

      const userInfo = await oidcProvider.getUserInfo(sessionId);

      res.json({
        sub: userInfo.sub,
        email: userInfo.email,
        name: userInfo.name,
        picture: userInfo.picture,
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /refresh
   *
   * Force token refresh.
   * Requires an active OIDC session with a refresh token.
   */
  router.post("/refresh", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const cookies = req.cookies as Record<string, string> | undefined;
      const sessionId = cookies?.[OIDC_SESSION_COOKIE];

      if (!sessionId || typeof sessionId !== "string") {
        throw unauthorized("No active OIDC session", "NO_SESSION");
      }

      const session = await oidcProvider.refreshToken(sessionId);

      // Update cookie with new expiry
      const config = oidcProvider.getConfig();
      res.cookie(OIDC_SESSION_COOKIE, session.sessionId, {
        ...getOidcCookieOptions(config),
        maxAge: config.sessionTtlSeconds * 1000,
      });

      getLogger().debug({ sessionId }, "Token refresh forced");

      res.json({
        success: true,
        message: "Token refreshed successfully",
        expiresAt: session.tokens?.tokenExpiresAt,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
