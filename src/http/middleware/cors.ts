/**
 * CORS Middleware
 *
 * Configures Cross-Origin Resource Sharing (CORS) for browser-based MCP clients.
 * Provides secure defaults with configurable origins via environment variables.
 *
 * @module http/middleware/cors
 */

import cors from "cors";
import type { Request, Response, NextFunction } from "express";
import type { Logger } from "pino";
import { getComponentLogger } from "../../logging/index.js";
import type { CorsConfig, CorsMiddleware } from "./cors-types.js";
import { DEFAULT_CORS_CONFIG } from "./cors-types.js";

// Re-export types for consumers
export type { CorsConfig, CorsMiddleware } from "./cors-types.js";
export { DEFAULT_CORS_CONFIG } from "./cors-types.js";

/**
 * Lazy-initialized logger to avoid module load-time initialization
 */
let logger: Logger | null = null;

function getLogger(): Logger {
  if (!logger) {
    logger = getComponentLogger("http:cors");
  }
  return logger;
}

/**
 * Parse origins from a comma-separated string
 *
 * @param originsStr - Comma-separated list of origins
 * @returns Array of origin strings
 */
function parseOrigins(originsStr: string): string[] {
  return originsStr
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/**
 * Log CORS request details for debugging
 *
 * @param req - Express request
 * @param origin - Request origin
 * @param allowed - Whether the origin was allowed
 */
function logCorsRequest(req: Request, origin: string | undefined, allowed: boolean): void {
  const logData = {
    requestId: req.headers["x-request-id"] as string | undefined,
    method: req.method,
    path: req.path,
    origin: origin || "(none)",
    allowed,
  };

  if (allowed) {
    getLogger().debug(logData, "CORS request allowed");
  } else {
    getLogger().warn(logData, "CORS request blocked - origin not in allowed list");
  }
}

/**
 * Create origin validator function for CORS middleware
 *
 * @param allowedOrigins - List of allowed origins
 * @returns Origin validation function
 */
function createOriginValidator(
  allowedOrigins: string[]
): (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => void {
  // Create a Set for efficient lookup
  const originsSet = new Set(allowedOrigins);

  return (origin, callback) => {
    // Allow requests with no origin (e.g., same-origin, server-to-server, curl)
    if (!origin) {
      callback(null, true);
      return;
    }

    // Check if origin is in allowed list
    if (originsSet.has(origin)) {
      callback(null, true);
    } else {
      // Origin not allowed - pass error to trigger CORS failure
      callback(new Error(`Origin ${origin} not allowed by CORS policy`), false);
    }
  };
}

/**
 * Create CORS middleware with logging wrapper
 *
 * @param config - CORS configuration
 * @returns Express middleware
 */
export function createCorsMiddleware(config: CorsConfig): CorsMiddleware | null {
  if (!config.enabled) {
    getLogger().info("CORS is disabled");
    return null;
  }

  getLogger().info(
    {
      origins: config.origins,
      methods: config.methods,
      credentials: config.credentials,
      maxAge: config.maxAge,
    },
    "CORS middleware enabled"
  );

  // Create the cors middleware with our configuration
  const corsMiddleware = cors({
    origin: createOriginValidator(config.origins),
    methods: config.methods,
    allowedHeaders: config.allowedHeaders,
    exposedHeaders: config.exposedHeaders,
    credentials: config.credentials,
    maxAge: config.maxAge,
    optionsSuccessStatus: 204, // Use 204 for preflight success (some legacy browsers need 200)
  });

  // Wrap with logging
  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;

    // For preflight requests, log at debug level
    if (req.method === "OPTIONS") {
      getLogger().debug(
        {
          origin: origin || "(none)",
          path: req.path,
          requestedMethod: req.headers["access-control-request-method"],
          requestedHeaders: req.headers["access-control-request-headers"],
        },
        "CORS preflight request"
      );
    }

    // Call the cors middleware
    corsMiddleware(req, res, (err?: unknown) => {
      if (err) {
        // CORS error - origin not allowed
        logCorsRequest(req, origin, false);

        // Send a 403 response for CORS failures
        res.status(403).json({
          error: {
            message: "CORS policy: Origin not allowed",
            code: "CORS_ORIGIN_NOT_ALLOWED",
            statusCode: 403,
          },
        });
        return;
      }

      // Log successful CORS handling (only for cross-origin requests)
      if (origin) {
        logCorsRequest(req, origin, true);
      }

      next();
    });
  };
}

/**
 * Load CORS configuration from environment variables
 *
 * @returns CORS configuration
 */
export function loadCorsConfig(): CorsConfig {
  // CORS is enabled by default when HTTP transport is enabled
  const enabled = Bun.env["CORS_ENABLED"] !== "false";

  // Parse origins from environment (comma-separated)
  const originsEnv = Bun.env["CORS_ORIGINS"];
  const origins = originsEnv ? parseOrigins(originsEnv) : DEFAULT_CORS_CONFIG.origins;

  // Methods (usually don't need to be configurable)
  const methods = DEFAULT_CORS_CONFIG.methods;

  // Headers
  const allowedHeaders = DEFAULT_CORS_CONFIG.allowedHeaders;
  const exposedHeaders = DEFAULT_CORS_CONFIG.exposedHeaders;

  // Credentials
  const credentials = Bun.env["CORS_CREDENTIALS"] !== "false";

  // Max age (preflight cache duration)
  const maxAgeEnv = Bun.env["CORS_MAX_AGE"];
  const maxAge = maxAgeEnv ? parseInt(maxAgeEnv, 10) : DEFAULT_CORS_CONFIG.maxAge;

  return {
    enabled,
    origins,
    methods,
    allowedHeaders,
    exposedHeaders,
    credentials,
    maxAge: isNaN(maxAge) || maxAge < 0 ? DEFAULT_CORS_CONFIG.maxAge : maxAge,
  };
}
