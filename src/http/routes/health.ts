/**
 * Health Check Route
 *
 * Provides a health check endpoint for monitoring and load balancing.
 * This endpoint is unauthenticated and always accessible.
 */

import { Router } from "express";
import type { Request, Response } from "express";
import type { HealthResponse } from "../types.js";
import { getComponentLogger } from "../../logging/index.js";

/**
 * Lazy-initialized logger to avoid initialization at module load time
 */
let logger: ReturnType<typeof getComponentLogger> | null = null;

function getLogger(): ReturnType<typeof getComponentLogger> {
  if (!logger) {
    logger = getComponentLogger("http:health");
  }
  return logger;
}

// Package version - imported at build time
const VERSION = "1.0.0";

/**
 * Health check dependencies
 */
export interface HealthCheckDependencies {
  /** Check ChromaDB connectivity */
  checkChromaDb: () => Promise<boolean>;
}

/**
 * Create health check router
 *
 * @param deps - Dependencies for health checks
 * @returns Express router with health endpoints
 */
export function createHealthRouter(deps: HealthCheckDependencies): Router {
  const router = Router();

  /**
   * GET /health
   *
   * Returns server health status with component checks.
   * Status codes:
   * - 200: All components healthy
   * - 503: One or more components unhealthy
   */
  router.get("/health", async (_req: Request, res: Response): Promise<void> => {
    const startTime = Date.now();

    try {
      // Check ChromaDB connectivity
      const chromaDbHealthy = await deps.checkChromaDb();

      const response: HealthResponse = {
        status: chromaDbHealthy ? "healthy" : "degraded",
        version: VERSION,
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        checks: {
          chromadb: chromaDbHealthy ? "connected" : "disconnected",
        },
      };

      const statusCode = chromaDbHealthy ? 200 : 503;

      getLogger().debug(
        {
          status: response.status,
          chromadb: response.checks.chromadb,
          durationMs: Date.now() - startTime,
        },
        "Health check completed"
      );

      res.status(statusCode).json(response);
    } catch (error) {
      getLogger().error({ error }, "Health check failed");

      const response: HealthResponse = {
        status: "unhealthy",
        version: VERSION,
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        checks: {
          chromadb: "disconnected",
        },
      };

      res.status(503).json(response);
    }
  });

  return router;
}
