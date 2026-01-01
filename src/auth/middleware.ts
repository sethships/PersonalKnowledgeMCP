/**
 * Authentication Middleware
 *
 * Express middleware for HTTP request authentication using bearer tokens.
 * Validates tokens, checks scopes, and verifies instance access.
 *
 * Includes audit logging for security events:
 * - auth.success / auth.failure
 * - scope.denied
 * - instance.denied
 *
 * @module auth/middleware
 */

import type { Request, Response, NextFunction } from "express";
import type { Logger } from "pino";
import { getComponentLogger, getAuditLogger } from "../logging/index.js";
import type { AuditLogger, TokenIdentifier, AuthFailureReason } from "../logging/audit-types.js";
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
 * Lazy-initialized audit logger
 */
let auditLogger: AuditLogger | null = null;

function getAudit(): AuditLogger | null {
  if (auditLogger === null) {
    try {
      auditLogger = getAuditLogger();
    } catch {
      // Audit logger not initialized, skip audit logging
      return null;
    }
  }
  return auditLogger;
}

/**
 * Extract source IP from request, supporting reverse proxy environments
 *
 * @param req - Express request
 * @returns Client IP address or undefined
 */
function extractSourceIp(req: Request): string | undefined {
  // Trust X-Forwarded-For for reverse proxy environments (Docker, nginx)
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    // X-Forwarded-For can be comma-separated list; take first (client) IP
    const firstIp = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(",")[0]?.trim();
    return firstIp;
  }
  // Fall back to direct IP
  return req.ip;
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
 * Compute token hash prefix from raw token for audit logging
 * Uses the same hash function as TokenService
 */
function computeTokenHashPrefix(rawToken: string): string {
  // Simple hash using Bun's crypto
  const hash = new Bun.CryptoHasher("sha256").update(rawToken).digest("hex");
  return hash.substring(0, 8);
}

/**
 * Map internal reason strings to AuthFailureReason type
 */
function mapToAuthFailureReason(reason?: string): AuthFailureReason {
  switch (reason) {
    case "missing_authorization":
      return "missing";
    case "invalid_format":
      return "format";
    case "token_expired":
    case "expired":
      return "expired";
    case "token_revoked":
    case "revoked":
      return "revoked";
    case "not_found":
      return "not_found";
    default:
      return "invalid";
  }
}

/**
 * Log authentication event with structured data and audit log
 */
function logAuthEvent(
  req: Request,
  success: boolean,
  reason?: string,
  tokenName?: string,
  tokenHashPrefix?: string
): void {
  const requestId = req.headers["x-request-id"] as string | undefined;
  const logData = {
    requestId,
    method: req.method,
    path: req.path,
    success,
    reason,
    tokenName,
  };

  // Application log
  if (success) {
    getLogger().debug(logData, "Authentication successful");
  } else {
    getLogger().info(logData, `Authentication failed: ${reason}`);
  }

  // Audit log
  const audit = getAudit();
  if (audit) {
    const sourceIp = extractSourceIp(req);
    const tokenIdentifier: TokenIdentifier | undefined =
      tokenHashPrefix || tokenName
        ? {
            tokenHashPrefix: tokenHashPrefix || "",
            tokenName,
          }
        : undefined;

    if (success) {
      audit.emit({
        timestamp: new Date().toISOString(),
        eventType: "auth.success",
        success: true,
        requestId,
        sourceIp,
        authMethod: "bearer",
        token: tokenIdentifier,
      });
    } else {
      // Map reason string to AuthFailureReason
      const auditReason = mapToAuthFailureReason(reason);
      audit.emit({
        timestamp: new Date().toISOString(),
        eventType: "auth.failure",
        success: false,
        requestId,
        sourceIp,
        authMethod: "bearer",
        reason: auditReason,
        token: tokenIdentifier,
      });
    }
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

      // Compute token hash prefix for audit logging (before validation)
      const tokenHashPrefix = computeTokenHashPrefix(rawToken);

      // Validate token
      const result: TokenValidationResult = await tokenService.validateToken(rawToken);

      if (!result.valid) {
        // Map validation failure reason to appropriate error
        switch (result.reason) {
          case "expired":
            logAuthEvent(req, false, "token_expired", undefined, tokenHashPrefix);
            throw unauthorized("Token has expired", "TOKEN_EXPIRED");

          case "revoked":
            logAuthEvent(req, false, "token_revoked", undefined, tokenHashPrefix);
            throw unauthorized("Token has been revoked", "TOKEN_REVOKED");

          case "invalid":
          case "not_found":
          default:
            logAuthEvent(req, false, result.reason || "invalid", undefined, tokenHashPrefix);
            throw unauthorized("Invalid or expired token", "INVALID_TOKEN");
        }
      }

      // Attach token metadata to request for downstream middleware/handlers
      // SECURITY NOTE: rawToken is attached for downstream middleware (scope/instance checks).
      // Ensure logging middleware never serializes full request objects to avoid token exposure.
      req.tokenMetadata = result.metadata;
      req.rawToken = rawToken;

      logAuthEvent(req, true, undefined, result.metadata?.name, tokenHashPrefix);
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

          // Emit audit event for scope denial
          const audit = getAudit();
          if (audit) {
            const tokenHashPrefix = computeTokenHashPrefix(rawToken);
            audit.emit({
              timestamp: new Date().toISOString(),
              eventType: "scope.denied",
              success: false,
              requestId: req.headers["x-request-id"] as string | undefined,
              sourceIp: extractSourceIp(req),
              token: {
                tokenHashPrefix,
                tokenName: req.tokenMetadata.name,
              },
              requiredScope: scope,
              grantedScopes: req.tokenMetadata.scopes,
            });
          }

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

          // Emit audit event for instance access denial
          const audit = getAudit();
          if (audit) {
            const tokenHashPrefix = computeTokenHashPrefix(rawToken);
            audit.emit({
              timestamp: new Date().toISOString(),
              eventType: "instance.denied",
              success: false,
              requestId: req.headers["x-request-id"] as string | undefined,
              sourceIp: extractSourceIp(req),
              token: {
                tokenHashPrefix,
                tokenName: req.tokenMetadata.name,
              },
              requestedInstance: instance,
              allowedInstances: req.tokenMetadata.instanceAccess,
            });
          }

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
