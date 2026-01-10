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
  /** Check Neo4j connectivity (optional - gracefully degrades if not configured) */
  checkNeo4j?: () => Promise<boolean>;
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

      // Check Neo4j connectivity (optional)
      let neo4jHealthy: boolean | undefined;
      if (deps.checkNeo4j) {
        try {
          neo4jHealthy = await deps.checkNeo4j();
        } catch (neo4jError) {
          getLogger().warn({ error: neo4jError }, "Neo4j health check failed");
          neo4jHealthy = false;
        }
      }

      // Determine overall health status
      // - healthy: all configured services are up
      // - degraded: some services are down but core (ChromaDB) is up
      // - unhealthy: core service (ChromaDB) is down
      let status: "healthy" | "degraded" | "unhealthy";
      if (!chromaDbHealthy) {
        status = "unhealthy";
      } else if (neo4jHealthy === false) {
        status = "degraded";
      } else {
        status = "healthy";
      }

      const response: HealthResponse = {
        status,
        version: VERSION,
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        checks: {
          chromadb: chromaDbHealthy ? "connected" : "disconnected",
          ...(neo4jHealthy !== undefined && {
            neo4j: neo4jHealthy ? "connected" : "disconnected",
          }),
        },
      };

      const statusCode = status === "healthy" ? 200 : 503;

      getLogger().debug(
        {
          status: response.status,
          chromadb: response.checks.chromadb,
          neo4j: response.checks.neo4j,
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
