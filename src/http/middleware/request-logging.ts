/**
 * Request Logging Middleware
 *
 * Logs HTTP requests with timing information for observability.
 */

import type { Request, Response, NextFunction } from "express";
import { getComponentLogger } from "../../logging/index.js";

/**
 * Lazy-initialized logger to avoid initialization at module load time
 */
let logger: ReturnType<typeof getComponentLogger> | null = null;

function getLogger(): ReturnType<typeof getComponentLogger> {
  if (!logger) {
    logger = getComponentLogger("http:request");
  }
  return logger;
}

/**
 * Request logging middleware
 *
 * Logs incoming requests and their completion with timing metrics.
 * Excludes request body logging for security.
 */
export function requestLogging(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();
  const requestId = generateRequestId();

  // Attach request ID for correlation
  req.headers["x-request-id"] = requestId;

  getLogger().debug(
    {
      requestId,
      method: req.method,
      path: req.path,
      query: req.query,
      userAgent: req.get("User-Agent"),
      contentType: req.get("Content-Type"),
    },
    "Incoming request"
  );

  // Log response when finished
  res.on("finish", () => {
    const duration = Date.now() - startTime;

    const logData = {
      requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: duration,
    };

    if (res.statusCode >= 500) {
      getLogger().error(logData, "Request completed with server error");
    } else if (res.statusCode >= 400) {
      getLogger().warn(logData, "Request completed with client error");
    } else {
      getLogger().info(logData, "Request completed");
    }
  });

  next();
}

/**
 * Generate a unique request ID for correlation
 */
function generateRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 9)}`;
}
