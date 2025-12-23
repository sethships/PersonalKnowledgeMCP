/**
 * Rate Limiting Middleware
 *
 * Protects HTTP endpoints from abuse using configurable rate limits.
 * Supports per-token rate limiting for authenticated requests and
 * different limits for read vs write operations.
 *
 * @module http/middleware/rate-limit
 */

import rateLimit from "express-rate-limit";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import type { Logger } from "pino";
import { createHash } from "node:crypto";
import { getComponentLogger } from "../../logging/index.js";
import type {
  RateLimitConfig,
  RateLimitMiddleware,
  RateLimitErrorResponse,
} from "./rate-limit-types.js";
import { DEFAULT_RATE_LIMIT_CONFIG } from "./rate-limit-types.js";

// Re-export types for consumers
export type { RateLimitConfig, RateLimitMiddleware } from "./rate-limit-types.js";
export { DEFAULT_RATE_LIMIT_CONFIG } from "./rate-limit-types.js";

/**
 * Lazy-initialized logger to avoid module load-time initialization
 */
let logger: Logger | null = null;

function getLogger(): Logger {
  if (!logger) {
    logger = getComponentLogger("http:rate-limit");
  }
  return logger;
}

/**
 * Read operation HTTP methods
 */
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Write operation HTTP methods
 */
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Generate a rate limit key based on request context
 *
 * Uses token hash for authenticated requests (per-token limiting),
 * falls back to IP address for unauthenticated requests.
 *
 * This function uses a unique key prefix to avoid the express-rate-limit
 * IPv6 validation warning, since we handle IP normalization ourselves.
 *
 * @param req - Express request
 * @returns Rate limit key
 */
function generateRateLimitKey(req: Request): string {
  // For authenticated requests, use a hash of the raw token
  // This provides per-token rate limiting without exposing the token
  if (req.rawToken) {
    const tokenHash = createHash("sha256").update(req.rawToken).digest("hex").substring(0, 16);
    return `token:${tokenHash}`;
  }

  // Fall back to IP address for unauthenticated requests
  // This handles health checks and pre-auth requests
  // Use socket.remoteAddress directly to avoid express-rate-limit IPv6 validation
  const remoteAddress = req.socket?.remoteAddress || "unknown";
  return `addr:${remoteAddress}`;
}

/**
 * Check if a request should skip rate limiting
 *
 * Admin tokens bypass rate limits when adminBypass is enabled.
 *
 * @param req - Express request
 * @param adminBypass - Whether admin bypass is enabled
 * @returns True if rate limiting should be skipped
 */
function shouldSkipRateLimit(req: Request, adminBypass: boolean): boolean {
  if (!adminBypass) {
    return false;
  }

  // Check if request has admin scope
  const scopes = req.tokenMetadata?.scopes;
  if (scopes && scopes.includes("admin")) {
    getLogger().debug(
      { path: req.path, tokenName: req.tokenMetadata?.name },
      "Rate limit bypassed for admin token"
    );
    return true;
  }

  return false;
}

/**
 * Log rate limit event
 */
function logRateLimitEvent(
  req: Request,
  limited: boolean,
  windowMs: number,
  remaining?: number
): void {
  const requestId = req.headers["x-request-id"] as string | undefined;
  const key = generateRateLimitKey(req);
  const logData = {
    requestId,
    method: req.method,
    path: req.path,
    key: key.substring(0, 20) + "...", // Truncate for logs
    windowMs,
    remaining,
  };

  if (limited) {
    getLogger().warn(logData, "Request rate limited");
  } else {
    getLogger().debug(logData, "Rate limit check passed");
  }
}

/**
 * Create rate limit handler for 429 responses
 */
function createRateLimitHandler(
  windowMs: number
): (req: Request, res: Response, next: NextFunction, options: Record<string, unknown>) => void {
  return (req, res, _next, options) => {
    const resetTime = options["resetTime"] as Date | undefined;
    const retryAfterSeconds = resetTime
      ? Math.ceil((resetTime.getTime() - Date.now()) / 1000)
      : Math.ceil(windowMs / 1000);

    logRateLimitEvent(req, true, windowMs);

    const response: RateLimitErrorResponse = {
      error: {
        message: "Too many requests, please try again later",
        code: "RATE_LIMIT_EXCEEDED",
        statusCode: 429,
        retryAfter: retryAfterSeconds,
      },
    };

    res.status(429).set("Retry-After", String(retryAfterSeconds)).json(response);
  };
}

/**
 * Determine operation type from request method
 */
function getOperationType(method: string): "read" | "write" | "unknown" {
  if (READ_METHODS.has(method.toUpperCase())) {
    return "read";
  }
  if (WRITE_METHODS.has(method.toUpperCase())) {
    return "write";
  }
  return "unknown";
}

/**
 * Create a rate limit middleware for a specific window
 *
 * @param windowMs - Window duration in milliseconds
 * @param maxRead - Maximum read requests per window
 * @param maxWrite - Maximum write requests per window
 * @param adminBypass - Whether admin tokens bypass limits
 * @returns Express middleware
 */
function createWindowRateLimiter(
  windowMs: number,
  maxRead: number,
  maxWrite: number,
  adminBypass: boolean
): RequestHandler {
  // Create separate limiters for read and write operations
  const readLimiter = rateLimit({
    windowMs,
    max: maxRead,
    standardHeaders: true, // Return rate limit info in RateLimit-* headers
    legacyHeaders: true, // Also return X-RateLimit-* headers
    keyGenerator: generateRateLimitKey,
    skip: (req: Request) => shouldSkipRateLimit(req, adminBypass),
    handler: createRateLimitHandler(windowMs),
  });

  const writeLimiter = rateLimit({
    windowMs,
    max: maxWrite,
    standardHeaders: true,
    legacyHeaders: true,
    keyGenerator: generateRateLimitKey,
    skip: (req: Request) => shouldSkipRateLimit(req, adminBypass),
    handler: createRateLimitHandler(windowMs),
  });

  // Return middleware that routes to appropriate limiter
  return (req: Request, res: Response, next: NextFunction) => {
    const opType = getOperationType(req.method);

    if (opType === "read") {
      readLimiter(req, res, next);
    } else if (opType === "write") {
      writeLimiter(req, res, next);
    } else {
      // Unknown methods (unlikely) - apply read limits
      readLimiter(req, res, next);
    }
  };
}

/**
 * Create rate limiting middleware collection
 *
 * Factory function that creates rate limit middleware based on configuration.
 *
 * @param config - Rate limit configuration
 * @returns Rate limit middleware or null if disabled
 */
export function createRateLimitMiddleware(config: RateLimitConfig): RateLimitMiddleware | null {
  if (!config.enabled) {
    getLogger().info("Rate limiting is disabled");
    return null;
  }

  getLogger().info(
    {
      readPerMinute: config.readLimits.perMinute,
      readPerHour: config.readLimits.perHour,
      writePerMinute: config.writeLimits.perMinute,
      writePerHour: config.writeLimits.perHour,
      adminBypass: config.adminBypass,
    },
    "Rate limiting enabled"
  );

  // Create per-minute limiter
  const perMinuteLimiter = createWindowRateLimiter(
    60 * 1000, // 1 minute
    config.readLimits.perMinute,
    config.writeLimits.perMinute,
    config.adminBypass
  );

  // Create per-hour limiter
  const perHourLimiter = createWindowRateLimiter(
    60 * 60 * 1000, // 1 hour
    config.readLimits.perHour,
    config.writeLimits.perHour,
    config.adminBypass
  );

  // Return combined middleware that applies both limiters
  return (req: Request, res: Response, next: NextFunction): void => {
    // Apply per-minute limit first
    perMinuteLimiter(req, res, (err?: Error | string) => {
      if (err) {
        // Rate limited or error
        next(err);
        return;
      }

      // If per-minute passes, apply per-hour limit
      perHourLimiter(req, res, next);
    });
  };
}

/**
 * Load rate limit configuration from environment variables
 *
 * @returns Rate limit configuration
 */
export function loadRateLimitConfig(): RateLimitConfig {
  const enabled = Bun.env["RATE_LIMIT_ENABLED"] !== "false";

  const readPerMinute = parseEnvInt(
    "RATE_LIMIT_READ_PER_MINUTE",
    DEFAULT_RATE_LIMIT_CONFIG.readLimits.perMinute
  );
  const readPerHour = parseEnvInt(
    "RATE_LIMIT_READ_PER_HOUR",
    DEFAULT_RATE_LIMIT_CONFIG.readLimits.perHour
  );
  const writePerMinute = parseEnvInt(
    "RATE_LIMIT_WRITE_PER_MINUTE",
    DEFAULT_RATE_LIMIT_CONFIG.writeLimits.perMinute
  );
  const writePerHour = parseEnvInt(
    "RATE_LIMIT_WRITE_PER_HOUR",
    DEFAULT_RATE_LIMIT_CONFIG.writeLimits.perHour
  );
  const adminBypass = Bun.env["RATE_LIMIT_ADMIN_BYPASS"] !== "false";

  return {
    enabled,
    readLimits: {
      perMinute: readPerMinute,
      perHour: readPerHour,
    },
    writeLimits: {
      perMinute: writePerMinute,
      perHour: writePerHour,
    },
    adminBypass,
  };
}

/**
 * Parse environment variable as integer with default
 */
function parseEnvInt(envVar: string, defaultValue: number): number {
  const value = Bun.env[envVar];
  if (!value) {
    return defaultValue;
  }

  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed < 0) {
    getLogger().warn({ envVar, value, defaultValue }, `Invalid ${envVar} value, using default`);
    return defaultValue;
  }

  return parsed;
}
