/**
 * HTTP Server Setup
 *
 * Creates and configures the Express application for HTTP/SSE transport.
 * Provides factory functions for creating the server and managing lifecycle.
 */

import express from "express";
import type { Express, Request, Response, NextFunction } from "express";
import type { Server as HttpServer } from "node:http";
import type { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import {
  requestLogging,
  errorHandler,
  notFoundHandler,
  createRateLimitMiddleware,
  loadRateLimitConfig,
  createCorsMiddleware,
  loadCorsConfig,
} from "./middleware/index.js";
import type { RateLimitConfig, CorsConfig } from "./middleware/index.js";
import {
  createHealthRouter,
  createSseRouter,
  closeAllSessions,
  createStreamableHttpRouter,
  closeAllStreamableSessions,
} from "./routes/index.js";
import type { HttpTransportConfig } from "../mcp/types.js";
import type { HttpServerInstance } from "./types.js";
import { getComponentLogger } from "../logging/index.js";
import type { TokenService } from "../auth/types.js";
import { createAuthMiddleware } from "../auth/middleware.js";

/**
 * Lazy-initialized logger to avoid initialization at module load time
 */
let logger: ReturnType<typeof getComponentLogger> | null = null;

function getLogger(): ReturnType<typeof getComponentLogger> {
  if (!logger) {
    logger = getComponentLogger("http:server");
  }
  return logger;
}

/**
 * Dependencies required to create the HTTP server
 */
export interface HttpServerDependencies {
  /** Factory to create MCP server instances for SSE sessions */
  createServerForSse: () => McpServer;

  /** Factory to create MCP server instances for Streamable HTTP sessions */
  createServerForStreamableHttp: () => McpServer;

  /** Health check function for ChromaDB */
  checkChromaDb: () => Promise<boolean>;

  /** Token service for authentication (optional for backward compatibility) */
  tokenService?: TokenService;

  /** Rate limit configuration (optional, uses defaults if not provided) */
  rateLimitConfig?: RateLimitConfig;

  /** CORS configuration (optional, uses defaults if not provided) */
  corsConfig?: CorsConfig;
}

/**
 * Create and configure the Express application
 *
 * @param deps - Server dependencies
 * @returns Configured Express application
 */
export function createHttpApp(deps: HttpServerDependencies): Express {
  const app = express();

  // ============================================================================
  // Security Middleware
  // ============================================================================
  // When HTTP_HOST is set to 0.0.0.0 for network access, enable these:
  //
  // 1. Helmet - Security headers (X-Content-Type-Options, X-Frame-Options, etc.)
  //    import helmet from "helmet";
  //    app.use(helmet());
  //
  // 2. CORS - Configured below via CORS middleware (Issue #95)
  // ============================================================================

  // Parse JSON bodies for POST requests
  app.use(express.json());

  // Request logging (must be early in middleware chain)
  app.use(requestLogging);

  // CORS middleware (early in chain to handle preflight requests)
  // Must be before routes to properly respond to OPTIONS requests
  const corsConfig = deps.corsConfig || loadCorsConfig();
  const corsMiddleware = createCorsMiddleware(corsConfig);
  if (corsMiddleware) {
    app.use(corsMiddleware);
  }

  // Health check endpoint (UNAUTHENTICATED - before auth and rate limiting middleware)
  app.use(
    createHealthRouter({
      checkChromaDb: deps.checkChromaDb,
    })
  );

  // Create auth middleware if token service is provided
  const authMiddleware = deps.tokenService ? createAuthMiddleware(deps.tokenService) : null;

  // Apply authentication to /api/v1 routes if available
  if (authMiddleware) {
    app.use("/api/v1", authMiddleware.authenticateRequest);
  }

  // Apply rate limiting to /api/v1 routes (after auth so we can use per-token limits)
  // Rate limiting is applied after authentication so we can use token hash for per-token limits
  // and check for admin scope to enable bypass
  const rateLimitConfig = deps.rateLimitConfig || loadRateLimitConfig();
  const rateLimitMiddleware = createRateLimitMiddleware(rateLimitConfig);
  if (rateLimitMiddleware) {
    app.use("/api/v1", rateLimitMiddleware);
  }

  // SSE transport endpoints under /api/v1 (legacy transport)
  app.use(
    "/api/v1",
    createSseRouter({
      createServerForSse: deps.createServerForSse,
    })
  );

  // Streamable HTTP transport endpoints under /api/v1 (modern transport)
  app.use(
    "/api/v1",
    createStreamableHttpRouter({
      createServerForStreamableHttp: deps.createServerForStreamableHttp,
    })
  );

  // 404 handler for unmatched routes
  app.use(notFoundHandler);

  // Error handler (must be last)
  // Need to cast to avoid TypeScript strict mode issues with Express error middleware signature
  app.use(((err: Error, req: Request, res: Response, next: NextFunction) => {
    errorHandler(err, req, res, next);
  }) as express.ErrorRequestHandler);

  return app;
}

/**
 * Start the HTTP server
 *
 * @param app - Express application
 * @param config - HTTP transport configuration
 * @returns Server instance with control methods
 */
export async function startHttpServer(
  app: Express,
  config: HttpTransportConfig
): Promise<HttpServerInstance> {
  return new Promise((resolve, reject) => {
    let httpServer: HttpServer;

    try {
      httpServer = app.listen(config.port, config.host, () => {
        getLogger().info({ host: config.host, port: config.port }, "HTTP server listening");

        resolve({
          port: config.port,
          host: config.host,
          close: async (): Promise<void> => {
            getLogger().info("Closing HTTP server");

            // Close all SSE sessions first
            await closeAllSessions();

            // Close all Streamable HTTP sessions
            await closeAllStreamableSessions();

            // Then close the HTTP server
            return new Promise((resolveClose, rejectClose) => {
              httpServer.close((err) => {
                if (err) {
                  getLogger().error({ error: err }, "Error closing HTTP server");
                  rejectClose(err);
                } else {
                  getLogger().info("HTTP server closed");
                  resolveClose();
                }
              });
            });
          },
        });
      });

      httpServer.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "EADDRINUSE") {
          getLogger().error({ port: config.port, host: config.host }, "Port already in use");
          reject(new Error(`Port ${config.port} is already in use`));
        } else if (error.code === "EACCES") {
          getLogger().error({ port: config.port }, "Permission denied to bind to port");
          reject(new Error(`Permission denied to bind to port ${config.port}`));
        } else {
          getLogger().error({ error }, "HTTP server error");
          reject(error);
        }
      });
    } catch (error) {
      getLogger().error({ error }, "Failed to create HTTP server");
      reject(error);
    }
  });
}

/**
 * Load HTTP transport configuration from environment
 *
 * @returns HTTP transport configuration
 * @throws Error if configuration is invalid
 */
export function loadHttpConfig(): HttpTransportConfig {
  const portStr = Bun.env["HTTP_PORT"] || "3001";
  const port = parseInt(portStr, 10);

  // Validate port is a valid number in valid range
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid HTTP_PORT: "${portStr}". Must be a number between 1 and 65535.`);
  }

  const host = Bun.env["HTTP_HOST"] || "127.0.0.1";

  // Warn if exposing to network without additional security
  if (host === "0.0.0.0" && Bun.env["HTTP_TRANSPORT_ENABLED"] === "true") {
    getLogger().warn(
      { host },
      "HTTP server binding to all interfaces (0.0.0.0). " +
        "Ensure appropriate security measures (firewall, rate limiting, authentication) are in place."
    );
  }

  return {
    enabled: Bun.env["HTTP_TRANSPORT_ENABLED"] === "true",
    port,
    host,
  };
}
