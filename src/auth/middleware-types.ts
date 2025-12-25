/**
 * Authentication Middleware Type Definitions
 *
 * Extends Express Request with token metadata for authenticated requests.
 *
 * @module auth/middleware-types
 */

import type { Request, Response, NextFunction } from "express";
import type { TokenMetadata, TokenScope, InstanceAccess } from "./types.js";
import type { OidcSession } from "./oidc/oidc-types.js";

/**
 * Extend Express Request to include token metadata after authentication
 * Using module augmentation (ES2015 module syntax) instead of namespace
 */
declare module "express-serve-static-core" {
  interface Request {
    /** Token metadata (only present after authenticateRequest succeeds) */
    tokenMetadata?: TokenMetadata;
    /** Raw token string (only present after authenticateRequest succeeds) */
    rawToken?: string;
    /** OIDC session (only present when authenticated via OIDC) */
    oidcSession?: OidcSession;
  }
}

/**
 * Authentication middleware function type
 */
export type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => Promise<void>;

/**
 * Middleware factory that returns a scope-checking middleware function
 */
export type ScopeMiddlewareFactory = (scope: TokenScope) => AuthMiddleware;

/**
 * Middleware factory that returns an instance access-checking middleware function
 */
export type InstanceMiddlewareFactory = (instance: InstanceAccess) => AuthMiddleware;

/**
 * Auth middleware collection returned by createAuthMiddleware
 */
export interface AuthMiddlewareFunctions {
  /** Validates bearer token and attaches metadata to request */
  authenticateRequest: AuthMiddleware;

  /** Factory for scope-checking middleware */
  requireScope: ScopeMiddlewareFactory;

  /** Factory for instance access-checking middleware */
  requireInstanceAccess: InstanceMiddlewareFactory;
}
