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
import { requestLogging, errorHandler, notFoundHandler } from "./middleware/index.js";
import { createHealthRouter, createSseRouter, closeAllSessions } from "./routes/index.js";
import type { HttpTransportConfig } from "../mcp/types.js";
import type { HttpServerInstance } from "./types.js";
import { getComponentLogger } from "../logging/index.js";

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

  /** Health check function for ChromaDB */
  checkChromaDb: () => Promise<boolean>;
}

/**
 * Create and configure the Express application
 *
 * @param deps - Server dependencies
 * @returns Configured Express application
 */
export function createHttpApp(deps: HttpServerDependencies): Express {
  const app = express();

  // Parse JSON bodies for POST requests
  app.use(express.json());

  // Request logging (must be early in middleware chain)
  app.use(requestLogging);

  // Health check endpoint (unauthenticated)
  app.use(
    createHealthRouter({
      checkChromaDb: deps.checkChromaDb,
    })
  );

  // SSE transport endpoints under /api/v1
  app.use(
    "/api/v1",
    createSseRouter({
      createServerForSse: deps.createServerForSse,
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
 */
export function loadHttpConfig(): HttpTransportConfig {
  return {
    enabled: Bun.env["HTTP_TRANSPORT_ENABLED"] === "true",
    port: parseInt(Bun.env["HTTP_PORT"] || "3001", 10),
    host: Bun.env["HTTP_HOST"] || "127.0.0.1",
  };
}
