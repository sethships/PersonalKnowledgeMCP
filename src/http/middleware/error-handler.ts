/**
 * Error Handler Middleware
 *
 * Catches errors from route handlers and returns appropriate HTTP responses.
 * Ensures error details are logged but not leaked to clients.
 */

import type { Request, Response, NextFunction } from "express";
import { getComponentLogger } from "../../logging/index.js";

/**
 * Lazy-initialized logger to avoid initialization at module load time
 */
let logger: ReturnType<typeof getComponentLogger> | null = null;

function getLogger(): ReturnType<typeof getComponentLogger> {
  if (!logger) {
    logger = getComponentLogger("http:error");
  }
  return logger;
}

/**
 * HTTP error with status code
 */
export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/**
 * Create a 400 Bad Request error
 */
export function badRequest(message: string, code?: string): HttpError {
  return new HttpError(400, message, code);
}

/**
 * Create a 404 Not Found error
 */
export function notFound(message: string, code?: string): HttpError {
  return new HttpError(404, message, code);
}

/**
 * Create a 500 Internal Server Error
 */
export function internalError(message: string, code?: string): HttpError {
  return new HttpError(500, message, code);
}

/**
 * Error response structure
 */
interface ErrorResponse {
  error: {
    message: string;
    code?: string;
    statusCode: number;
  };
}

/**
 * Express error handling middleware
 *
 * Must have 4 parameters to be recognized as error middleware by Express.
 * Logs error details for debugging while returning sanitized response to client.
 */
/**
 * Check if error is a JSON parsing error from express.json() middleware
 */
function isJsonParseError(err: Error): boolean {
  return err instanceof SyntaxError && "body" in err;
}

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  const requestId = req.headers["x-request-id"] as string | undefined;

  // Determine status code - JSON parse errors are client errors (400)
  let statusCode: number;
  let code: string | undefined;

  if (err instanceof HttpError) {
    statusCode = err.statusCode;
    code = err.code;
  } else if (isJsonParseError(err)) {
    statusCode = 400;
    code = "INVALID_JSON";
  } else {
    statusCode = 500;
    code = "INTERNAL_ERROR";
  }

  // Log the error with full details
  getLogger().error(
    {
      requestId,
      error: err,
      method: req.method,
      path: req.path,
      statusCode,
    },
    `Request failed: ${err.message}`
  );

  // Send sanitized error response
  // Only hide error details for 500 errors
  let message: string;
  if (statusCode === 500) {
    message = "Internal server error";
  } else if (isJsonParseError(err)) {
    message = "Invalid JSON in request body";
  } else {
    message = err.message;
  }

  const response: ErrorResponse = {
    error: {
      message,
      code,
      statusCode,
    },
  };

  res.status(statusCode).json(response);
}

/**
 * 404 handler for unmatched routes
 */
export function notFoundHandler(req: Request, res: Response): void {
  const response: ErrorResponse = {
    error: {
      message: `Route not found: ${req.method} ${req.path}`,
      code: "NOT_FOUND",
      statusCode: 404,
    },
  };

  res.status(404).json(response);
}
