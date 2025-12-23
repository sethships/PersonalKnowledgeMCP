/**
 * Authentication Middleware
 *
 * Express middleware for HTTP request authentication using bearer tokens.
 * Validates tokens, checks scopes, and verifies instance access.
 *
 * @module auth/middleware
 */

import type { Request, Response, NextFunction } from "express";
import type { Logger } from "pino";
import { getComponentLogger } from "../logging/index.js";
import { unauthorized, forbidden } from "../http/middleware/error-handler.js";
import type { TokenService, TokenScope, InstanceAccess, TokenValidationResult } from "./types.js";
import type { AuthMiddleware, AuthMiddlewareFunctions } from "./middleware-types.js";

// Re-export types for consumers
export type { AuthMiddlewareFunctions } from "./middleware-types.js";

/**
 * Lazy-initialized logger to avoid module load-time initialization
 */
let logger: Logger | null = null;

function getLogger(): Logger {
  if (!logger) {
    logger = getComponentLogger("http:auth");
  }
  return logger;
}

/**
 * Extract bearer token from Authorization header
 *
 * @param authHeader - The Authorization header value
 * @returns The raw token or null if invalid format
 */
function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) {
    return null;
  }
  const parts = authHeader.split(" ");
  const scheme = parts[0];
  const token = parts[1];
  if (parts.length !== 2 || !scheme || !token || scheme.toLowerCase() !== "bearer") {
    return null;
  }
  return token;
}

/**
 * Log authentication event with structured data
 */
function logAuthEvent(req: Request, success: boolean, reason?: string, tokenName?: string): void {
  const requestId = req.headers["x-request-id"] as string | undefined;
  const logData = {
    requestId,
    method: req.method,
    path: req.path,
    success,
    reason,
    tokenName,
  };

  if (success) {
    getLogger().debug(logData, "Authentication successful");
  } else {
    getLogger().info(logData, `Authentication failed: ${reason}`);
  }
}

/**
 * Create authenticateRequest middleware
 *
 * Extracts bearer token from Authorization header, validates it via TokenService,
 * and attaches token metadata to the request object.
 *
 * @param tokenService - Token service for validation
 * @returns Express middleware function
 */
function createAuthenticateRequest(tokenService: TokenService): AuthMiddleware {
  return async function authenticateRequest(
    req: Request,
    _res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const authHeader = req.headers.authorization;

      // Check for missing Authorization header
      if (!authHeader) {
        logAuthEvent(req, false, "missing_authorization");
        throw unauthorized("Authorization header is required", "MISSING_AUTHORIZATION");
      }

      // Extract bearer token
      const rawToken = extractBearerToken(authHeader);
      if (!rawToken) {
        logAuthEvent(req, false, "invalid_format");
        throw unauthorized(
          "Authorization header must be 'Bearer <token>'",
          "INVALID_AUTHORIZATION_FORMAT"
        );
      }

      // Validate token
      const result: TokenValidationResult = await tokenService.validateToken(rawToken);

      if (!result.valid) {
        // Map validation failure reason to appropriate error
        switch (result.reason) {
          case "expired":
            logAuthEvent(req, false, "token_expired");
            throw unauthorized("Token has expired", "TOKEN_EXPIRED");

          case "revoked":
            logAuthEvent(req, false, "token_revoked");
            throw unauthorized("Token has been revoked", "TOKEN_REVOKED");

          case "invalid":
          case "not_found":
          default:
            logAuthEvent(req, false, result.reason || "invalid");
            throw unauthorized("Invalid or expired token", "INVALID_TOKEN");
        }
      }

      // Attach token metadata to request for downstream middleware/handlers
      req.tokenMetadata = result.metadata;
      req.rawToken = rawToken;

      logAuthEvent(req, true, undefined, result.metadata?.name);
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Create requireScope middleware factory
 *
 * Returns middleware that checks if the authenticated token has the required scope.
 * Must be used after authenticateRequest middleware.
 *
 * @param tokenService - Token service for scope checking
 * @returns Factory function that creates scope-checking middleware
 */
function createRequireScope(tokenService: TokenService) {
  return function requireScope(scope: TokenScope): AuthMiddleware {
    return async function checkScope(
      req: Request,
      _res: Response,
      next: NextFunction
    ): Promise<void> {
      try {
        const rawToken = req.rawToken;

        if (!rawToken || !req.tokenMetadata) {
          // authenticateRequest was not called before this middleware
          logAuthEvent(req, false, "missing_authentication");
          throw unauthorized(
            "Authentication required before scope check",
            "MISSING_AUTHENTICATION"
          );
        }

        const hasScope = await tokenService.hasScopes(rawToken, [scope]);

        if (!hasScope) {
          logAuthEvent(req, false, `insufficient_scope:${scope}`, req.tokenMetadata.name);
          throw forbidden(`Token lacks required scope: ${scope}`, "INSUFFICIENT_SCOPE");
        }

        next();
      } catch (error) {
        next(error);
      }
    };
  };
}

/**
 * Create requireInstanceAccess middleware factory
 *
 * Returns middleware that checks if the authenticated token can access the specified instance.
 * Must be used after authenticateRequest middleware.
 *
 * @param tokenService - Token service for instance access checking
 * @returns Factory function that creates instance access-checking middleware
 */
function createRequireInstanceAccess(tokenService: TokenService) {
  return function requireInstanceAccess(instance: InstanceAccess): AuthMiddleware {
    return async function checkInstanceAccess(
      req: Request,
      _res: Response,
      next: NextFunction
    ): Promise<void> {
      try {
        const rawToken = req.rawToken;

        if (!rawToken || !req.tokenMetadata) {
          logAuthEvent(req, false, "missing_authentication");
          throw unauthorized(
            "Authentication required before instance access check",
            "MISSING_AUTHENTICATION"
          );
        }

        const hasAccess = await tokenService.hasInstanceAccess(rawToken, [instance]);

        if (!hasAccess) {
          logAuthEvent(req, false, `unauthorized_instance:${instance}`, req.tokenMetadata.name);
          throw forbidden(`Token cannot access instance: ${instance}`, "UNAUTHORIZED_INSTANCE");
        }

        next();
      } catch (error) {
        next(error);
      }
    };
  };
}

/**
 * Create authentication middleware collection
 *
 * Factory function that creates all auth middleware with injected TokenService dependency.
 *
 * @param tokenService - Token service for authentication operations
 * @returns Collection of auth middleware functions
 */
export function createAuthMiddleware(tokenService: TokenService): AuthMiddlewareFunctions {
  return {
    authenticateRequest: createAuthenticateRequest(tokenService),
    requireScope: createRequireScope(tokenService),
    requireInstanceAccess: createRequireInstanceAccess(tokenService),
  };
}
