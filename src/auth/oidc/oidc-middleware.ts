/**
 * OIDC Authentication Middleware
 *
 * Provides Express middleware for OIDC session-based authentication.
 * Falls through to next middleware (bearer token) if no OIDC session is present.
 *
 * @module auth/oidc/middleware
 */

import type { Request, Response, NextFunction } from "express";
import type { Logger } from "pino";
import { getComponentLogger } from "../../logging/index.js";
import type { OidcConfig, OidcProvider, OidcSession, OidcSessionStore } from "./oidc-types.js";
import { OIDC_SESSION_COOKIE } from "./oidc-types.js";
import type { TokenMetadata } from "../types.js";

/**
 * Lazy-initialized logger
 */
let logger: Logger | null = null;

function getLogger(): Logger {
  if (!logger) {
    logger = getComponentLogger("http:oidc-auth");
  }
  return logger;
}

/**
 * Default cookie options for OIDC session cookie (used when no config available)
 */
export const OIDC_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

/**
 * Get cookie options for OIDC session cookie based on configuration
 *
 * The secure flag is determined by:
 * 1. Explicit config.cookieSecure value if set (true/false)
 * 2. Auto-detection based on NODE_ENV if undefined (secure in production)
 *
 * @param config - OIDC configuration (optional, uses defaults if not provided)
 * @returns Cookie options object
 */
export function getOidcCookieOptions(config?: OidcConfig): typeof OIDC_COOKIE_OPTIONS {
  const secure = config?.cookieSecure ?? process.env.NODE_ENV === "production";

  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
  };
}

/**
 * Convert OIDC session to TokenMetadata for downstream compatibility
 *
 * This allows OIDC-authenticated requests to use the same scope/instance
 * access checking as bearer token authenticated requests.
 *
 * @param session - OIDC session
 * @returns TokenMetadata compatible object
 */
export function sessionToTokenMetadata(session: OidcSession): TokenMetadata {
  return {
    name: `OIDC: ${session.user?.email || session.user?.sub || "Unknown"}`,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    scopes: session.mappedScopes,
    instanceAccess: session.mappedInstanceAccess,
    lastUsedAt: new Date().toISOString(),
  };
}

/**
 * OIDC authentication middleware dependencies
 */
export interface OidcAuthMiddlewareDeps {
  /** OIDC provider instance */
  oidcProvider: OidcProvider;
  /** Session store for looking up sessions */
  sessionStore: OidcSessionStore;
}

/**
 * Create OIDC authentication middleware
 *
 * This middleware:
 * 1. Checks for OIDC session cookie
 * 2. If present, validates the session
 * 3. If session is valid and authenticated, attaches TokenMetadata to request
 * 4. Falls through to next middleware if no session or session is invalid
 *
 * Should be placed BEFORE bearer token auth middleware so OIDC sessions
 * take precedence when both are present.
 *
 * @param deps - Middleware dependencies
 * @returns Express middleware function
 */
export function createOidcAuthMiddleware(deps: OidcAuthMiddlewareDeps) {
  const { oidcProvider, sessionStore } = deps;

  return async function authenticateOidcSession(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    // Skip if OIDC is disabled
    if (!oidcProvider.isEnabled()) {
      return next();
    }

    // Check for session cookie
    const cookies = req.cookies as Record<string, string> | undefined;
    const sessionId = cookies?.[OIDC_SESSION_COOKIE];
    if (!sessionId || typeof sessionId !== "string") {
      // No OIDC session, fall through to bearer token auth
      return next();
    }

    try {
      const session = await sessionStore.getSession(sessionId);

      if (!session) {
        // Session not found or expired, clear cookie and fall through
        const config = oidcProvider.getConfig();
        res.clearCookie(OIDC_SESSION_COOKIE, getOidcCookieOptions(config));
        return next();
      }

      // Check if session has completed authentication
      if (!session.user || !session.tokens) {
        // Session exists but auth not complete (in middle of auth flow)
        return next();
      }

      // Check if token needs refresh
      const config = oidcProvider.getConfig();
      const expiresAt = new Date(session.tokens.tokenExpiresAt);
      const refreshThreshold = new Date(Date.now() + config.refreshBeforeExpirySeconds * 1000);

      if (expiresAt < refreshThreshold && session.tokens.refreshToken) {
        try {
          await oidcProvider.refreshToken(sessionId);
          getLogger().debug({ sessionId }, "OIDC token refreshed");
        } catch (error) {
          getLogger().warn(
            { sessionId, err: error },
            "OIDC token refresh failed, session may expire soon"
          );
        }
      }

      // Convert session to TokenMetadata for downstream compatibility
      const tokenMetadata = sessionToTokenMetadata(session);

      // Attach to request (same properties as bearer token auth)
      req.tokenMetadata = tokenMetadata;
      req.oidcSession = session;

      getLogger().debug({ sessionId, sub: session.user.sub }, "OIDC session authenticated");

      next();
    } catch (error) {
      getLogger().error({ err: error }, "OIDC session validation error");
      // Clear potentially invalid cookie and fall through
      const config = oidcProvider.getConfig();
      res.clearCookie(OIDC_SESSION_COOKIE, getOidcCookieOptions(config));
      next();
    }
  };
}
