/**
 * HTTP Transport Type Definitions
 *
 * Type definitions for the HTTP/SSE transport layer that enables
 * network-accessible MCP clients like Cursor, VS Code, etc.
 */

import type { Request, Response, NextFunction } from "express";

/**
 * Health check response structure
 */
export interface HealthResponse {
  /** Overall health status */
  status: "healthy" | "degraded" | "unhealthy";

  /** Server version from package.json */
  version: string;

  /** Server uptime in seconds */
  uptime: number;

  /** Current timestamp in ISO 8601 format */
  timestamp: string;

  /** Individual service health checks */
  checks: {
    /** ChromaDB connection status */
    chromadb: "connected" | "disconnected";
  };
}

/**
 * Express middleware function type
 */
export type ExpressMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => void | Promise<void>;

/**
 * Express error middleware function type
 */
export type ExpressErrorMiddleware = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => void | Promise<void>;

/**
 * HTTP server instance with additional metadata
 */
export interface HttpServerInstance {
  /** Close the HTTP server gracefully */
  close: () => Promise<void>;

  /** The port the server is listening on */
  port: number;

  /** The host the server is bound to */
  host: string;
}

/**
 * SSE connection state
 */
export interface SseConnectionState {
  /** Unique connection ID */
  connectionId: string;

  /** Connection start time */
  connectedAt: Date;

  /** Last activity timestamp */
  lastActivity: Date;

  /** Whether the connection is still active */
  isActive: boolean;
}
