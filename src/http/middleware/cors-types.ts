/**
 * CORS Middleware Type Definitions
 *
 * Type definitions for Cross-Origin Resource Sharing (CORS) configuration.
 * Provides secure defaults for browser-based MCP client access.
 *
 * @module http/middleware/cors-types
 */

import type { RequestHandler } from "express";

/**
 * CORS configuration options
 */
export interface CorsConfig {
  /**
   * Whether CORS is enabled
   * Default: true (when HTTP_TRANSPORT_ENABLED)
   */
  enabled: boolean;

  /**
   * List of allowed origins
   * Default: ["http://localhost:3000"]
   */
  origins: string[];

  /**
   * HTTP methods allowed for CORS requests
   * Default: ["GET", "POST", "OPTIONS"]
   */
  methods: string[];

  /**
   * Headers allowed in CORS requests
   * Default: ["Authorization", "Content-Type", "Mcp-Session-Id", "X-Request-Id"]
   */
  allowedHeaders: string[];

  /**
   * Headers exposed to the client
   * Default: ["X-Request-Id"]
   */
  exposedHeaders: string[];

  /**
   * Whether credentials (cookies, auth headers) are allowed
   * Default: true
   */
  credentials: boolean;

  /**
   * How long (in seconds) preflight results can be cached
   * Default: 86400 (24 hours)
   */
  maxAge: number;
}

/**
 * CORS middleware type (Express request handler)
 */
export type CorsMiddleware = RequestHandler;

/**
 * Default CORS configuration with secure defaults
 *
 * Restricts origins to localhost by default for security.
 * Production deployments should configure specific allowed origins.
 */
export const DEFAULT_CORS_CONFIG: CorsConfig = {
  enabled: true,
  origins: ["http://localhost:3000"],
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Authorization", "Content-Type", "Mcp-Session-Id", "X-Request-Id"],
  exposedHeaders: ["X-Request-Id"],
  credentials: true,
  maxAge: 86400, // 24 hours
};
