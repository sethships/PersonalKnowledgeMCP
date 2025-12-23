/**
 * Rate Limiting Middleware Type Definitions
 *
 * Defines configuration types for rate limiting middleware.
 *
 * @module http/middleware/rate-limit-types
 */

import type { Request, Response, NextFunction } from "express";

/**
 * Rate limit window configuration
 *
 * Defines the request limits for a specific time window.
 */
export interface RateLimitWindow {
  /** Maximum requests allowed in the window */
  max: number;
  /** Window duration in milliseconds */
  windowMs: number;
}

/**
 * Rate limit configuration for a specific operation type
 */
export interface OperationRateLimits {
  /** Requests per minute limit */
  perMinute: number;
  /** Requests per hour limit */
  perHour: number;
}

/**
 * Complete rate limit configuration
 */
export interface RateLimitConfig {
  /** Whether rate limiting is enabled */
  enabled: boolean;

  /** Rate limits for read operations (GET requests) */
  readLimits: OperationRateLimits;

  /** Rate limits for write operations (POST, PUT, PATCH, DELETE) */
  writeLimits: OperationRateLimits;

  /** Whether admin tokens bypass rate limits */
  adminBypass: boolean;
}

/**
 * Rate limit middleware function type
 */
export type RateLimitMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => void | Promise<void>;

/**
 * Rate limit middleware collection
 */
export interface RateLimitMiddlewareFunctions {
  /** Per-minute rate limit middleware */
  perMinute: RateLimitMiddleware;
  /** Per-hour rate limit middleware */
  perHour: RateLimitMiddleware;
}

/**
 * Rate limit key generator function type
 *
 * Generates a unique key for rate limiting based on the request.
 * Uses token hash for authenticated requests, IP for unauthenticated.
 */
export type RateLimitKeyGenerator = (req: Request, res: Response) => string;

/**
 * Rate limit skip function type
 *
 * Determines whether to skip rate limiting for a request.
 */
export type RateLimitSkipFunction = (req: Request, res: Response) => boolean;

/**
 * Rate limit handler function type
 *
 * Called when a request is rate limited (429 response).
 */
export type RateLimitHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
  options: Record<string, unknown>
) => void;

/**
 * Default rate limit configuration values
 */
export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  enabled: true,
  readLimits: {
    perMinute: 60,
    perHour: 1000,
  },
  writeLimits: {
    perMinute: 30,
    perHour: 500,
  },
  adminBypass: true,
};

/**
 * Rate limit error response structure
 */
export interface RateLimitErrorResponse {
  error: {
    message: string;
    code: "RATE_LIMIT_EXCEEDED";
    statusCode: 429;
    retryAfter: number;
  };
}
