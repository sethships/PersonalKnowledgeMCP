/**
 * Health Route Tests
 */

import { describe, test, expect, beforeEach, beforeAll, mock } from "bun:test";
import type { Request, Response, NextFunction } from "express";
import type { Router } from "express";
import { initializeLogger } from "../../../../src/logging/index.js";
import {
  createHealthRouter,
  type HealthCheckDependencies,
} from "../../../../src/http/routes/health.js";

/**
 * Type for Express route handler extracted from router stack
 */
type RouteHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

/**
 * Extract the handler for a specific route path from an Express router
 */
function getRouteHandler(router: Router, path: string): RouteHandler {
  const route = router.stack.find(
    (layer: { route?: { path: string } }) => layer.route?.path === path
  );
  if (!route?.route?.stack?.[0]?.handle) {
    throw new Error(`Route ${path} not found in router`);
  }
  return route.route.stack[0].handle as RouteHandler;
}

// Initialize logger before tests (wrapped in try-catch for parallel test execution)
beforeAll(() => {
  try {
    initializeLogger({ level: "silent", format: "json" });
  } catch {
    // Logger already initialized by another test file, ignore
  }
});

describe("Health Route", () => {
  let deps: HealthCheckDependencies;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let jsonData: unknown;
  let statusCode: number;

  beforeEach(() => {
    jsonData = undefined;
    statusCode = 0;

    deps = {
      checkChromaDb: mock(async () => true),
    };

    mockRequest = {
      method: "GET",
      path: "/health",
    };

    mockResponse = {
      status: mock((code: number) => {
        statusCode = code;
        return mockResponse as Response;
      }),
      json: mock((data: unknown) => {
        jsonData = data;
        return mockResponse as Response;
      }),
    };
  });

  test("should create router with health endpoint", () => {
    const router = createHealthRouter(deps);

    expect(router).toBeDefined();
    // Router has a stack with the route defined
    expect(router.stack.length).toBeGreaterThan(0);
  });

  test("should return 200 when ChromaDB is healthy", async () => {
    const router = createHealthRouter(deps);
    const handler = getRouteHandler(router, "/health");
    const mockNext = mock(() => {}) as unknown as NextFunction;

    await handler(mockRequest as Request, mockResponse as Response, mockNext);

    expect(statusCode).toBe(200);
    expect(jsonData).toMatchObject({
      status: "healthy",
      version: "1.0.0",
      checks: {
        chromadb: "connected",
      },
    });
  });

  test("should return 503 when ChromaDB is unhealthy", async () => {
    deps.checkChromaDb = mock(async () => false);
    const router = createHealthRouter(deps);
    const handler = getRouteHandler(router, "/health");
    const mockNext = mock(() => {}) as unknown as NextFunction;

    await handler(mockRequest as Request, mockResponse as Response, mockNext);

    expect(statusCode).toBe(503);
    expect(jsonData).toMatchObject({
      status: "degraded",
      checks: {
        chromadb: "disconnected",
      },
    });
  });

  test("should return 503 when ChromaDB check throws", async () => {
    deps.checkChromaDb = mock(async () => {
      throw new Error("Connection refused");
    });
    const router = createHealthRouter(deps);
    const handler = getRouteHandler(router, "/health");
    const mockNext = mock(() => {}) as unknown as NextFunction;

    await handler(mockRequest as Request, mockResponse as Response, mockNext);

    expect(statusCode).toBe(503);
    expect(jsonData).toMatchObject({
      status: "unhealthy",
      checks: {
        chromadb: "disconnected",
      },
    });
  });

  test("should include uptime in response", async () => {
    const router = createHealthRouter(deps);
    const handler = getRouteHandler(router, "/health");
    const mockNext = mock(() => {}) as unknown as NextFunction;

    await handler(mockRequest as Request, mockResponse as Response, mockNext);

    const response = jsonData as { uptime: number };
    expect(typeof response.uptime).toBe("number");
    expect(response.uptime).toBeGreaterThanOrEqual(0);
  });

  test("should include timestamp in ISO format", async () => {
    const router = createHealthRouter(deps);
    const handler = getRouteHandler(router, "/health");
    const mockNext = mock(() => {}) as unknown as NextFunction;

    await handler(mockRequest as Request, mockResponse as Response, mockNext);

    const response = jsonData as { timestamp: string };
    expect(typeof response.timestamp).toBe("string");

    // Should be valid ISO date
    const parsed = new Date(response.timestamp);
    expect(parsed.toISOString()).toBe(response.timestamp);
  });
});
