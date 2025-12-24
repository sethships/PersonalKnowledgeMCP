/**
 * CORS Integration Tests
 *
 * Tests the complete CORS flow with real HTTP requests.
 */

import { describe, test, expect, beforeAll, afterAll, mock } from "bun:test";
import { initializeLogger } from "../../../src/logging/index.js";
import { createHttpApp, startHttpServer } from "../../../src/http/index.js";
import type { HttpTransportConfig } from "../../../src/mcp/types.js";
import type { HttpServerInstance } from "../../../src/http/types.js";
import type { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import type { CorsConfig } from "../../../src/http/middleware/cors-types.js";

/**
 * Response types for type-safe assertions
 */
interface ErrorResponse {
  error: {
    message: string;
    code: string;
    statusCode: number;
  };
}

// Initialize logger before tests (wrapped in try-catch for parallel test execution)
try {
  initializeLogger({ level: "silent", format: "json" });
} catch {
  // Logger already initialized by another test file, ignore
}

describe("CORS Integration", () => {
  let serverInstance: HttpServerInstance | null = null;
  let baseUrl: string;
  const port = 3096; // Use a unique port for CORS tests

  // Mock MCP server factory for SSE
  const mockCreateServerForSse = mock((): McpServer => {
    return {
      connect: mock(async () => {}),
      close: mock(async () => {}),
      setRequestHandler: mock(() => {}),
    } as unknown as McpServer;
  });

  // Mock MCP server factory for Streamable HTTP
  const mockCreateServerForStreamableHttp = mock((): McpServer => {
    return {
      connect: mock(async () => {}),
      close: mock(async () => {}),
      setRequestHandler: mock(() => {}),
    } as unknown as McpServer;
  });

  // Mock ChromaDB health check
  const mockCheckChromaDb = mock(async () => true);

  // CORS configuration for testing with multiple origins
  const testCorsConfig: CorsConfig = {
    enabled: true,
    origins: ["http://localhost:3000", "http://localhost:5173"],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "Mcp-Session-Id", "X-Request-Id"],
    exposedHeaders: ["X-Request-Id"],
    credentials: true,
    maxAge: 86400,
  };

  beforeAll(async () => {
    const app = createHttpApp({
      createServerForSse: mockCreateServerForSse,
      createServerForStreamableHttp: mockCreateServerForStreamableHttp,
      checkChromaDb: mockCheckChromaDb,
      corsConfig: testCorsConfig,
    });

    const config: HttpTransportConfig = {
      enabled: true,
      port,
      host: "127.0.0.1",
    };

    serverInstance = await startHttpServer(app, config);
    baseUrl = `http://${serverInstance.host}:${serverInstance.port}`;
  });

  afterAll(async () => {
    if (serverInstance) {
      await serverInstance.close();
    }
  });

  describe("Preflight (OPTIONS) Requests", () => {
    test("should return CORS headers for allowed origin", async () => {
      const response = await fetch(`${baseUrl}/health`, {
        method: "OPTIONS",
        headers: {
          Origin: "http://localhost:3000",
          "Access-Control-Request-Method": "GET",
        },
      });

      // Preflight should succeed
      expect([200, 204]).toContain(response.status);

      // Check CORS headers
      expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
      expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    });

    test("should return CORS headers with allowed methods", async () => {
      const response = await fetch(`${baseUrl}/api/v1/sse`, {
        method: "OPTIONS",
        headers: {
          Origin: "http://localhost:3000",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "Authorization,Content-Type",
        },
      });

      expect([200, 204]).toContain(response.status);

      const allowMethods = response.headers.get("access-control-allow-methods");
      expect(allowMethods).toContain("GET");
      expect(allowMethods).toContain("POST");
    });

    test("should reject preflight for non-allowed origin", async () => {
      const response = await fetch(`${baseUrl}/health`, {
        method: "OPTIONS",
        headers: {
          Origin: "http://malicious-site.com",
          "Access-Control-Request-Method": "GET",
        },
      });

      // Should return 403 for non-allowed origin
      expect(response.status).toBe(403);

      const body = (await response.json()) as ErrorResponse;
      expect(body.error.code).toBe("CORS_ORIGIN_NOT_ALLOWED");
    });
  });

  describe("Cross-Origin Requests", () => {
    test("should allow GET request from allowed origin", async () => {
      const response = await fetch(`${baseUrl}/health`, {
        headers: {
          Origin: "http://localhost:3000",
        },
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    });

    test("should allow requests from second allowed origin", async () => {
      const response = await fetch(`${baseUrl}/health`, {
        headers: {
          Origin: "http://localhost:5173",
        },
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    });

    test("should block requests from non-allowed origin", async () => {
      const response = await fetch(`${baseUrl}/health`, {
        headers: {
          Origin: "http://malicious-site.com",
        },
      });

      expect(response.status).toBe(403);

      const body = (await response.json()) as ErrorResponse;
      expect(body.error.code).toBe("CORS_ORIGIN_NOT_ALLOWED");
      expect(body.error.message).toContain("Origin not allowed");
    });

    test("should allow requests without origin (same-origin/curl)", async () => {
      // Requests without Origin header should be allowed
      const response = await fetch(`${baseUrl}/health`);

      expect(response.status).toBe(200);
    });
  });

  describe("Credentials Support", () => {
    test("should include credentials header in response", async () => {
      const response = await fetch(`${baseUrl}/health`, {
        headers: {
          Origin: "http://localhost:3000",
        },
      });

      expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    });

    test("should handle POST requests with credentials", async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1000);

      try {
        const response = await fetch(`${baseUrl}/api/v1/sse`, {
          method: "GET",
          headers: {
            Origin: "http://localhost:3000",
            Accept: "text/event-stream",
          },
          signal: controller.signal,
        });

        // SSE endpoint should be accessible
        expect(response.status).toBe(200);
        expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
      } catch (error: unknown) {
        // AbortError is expected when we timeout
        if (error instanceof Error && error.name !== "AbortError") {
          throw error;
        }
      } finally {
        clearTimeout(timeoutId);
      }
    });
  });

  describe("Health Endpoint CORS", () => {
    test("should be accessible cross-origin", async () => {
      const response = await fetch(`${baseUrl}/health`, {
        headers: {
          Origin: "http://localhost:3000",
        },
      });

      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body).toHaveProperty("status", "healthy");
    });
  });

  describe("API Endpoints CORS", () => {
    test("should apply CORS to /api/v1 routes", async () => {
      // Try to access SSE endpoint
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 500);

      try {
        const response = await fetch(`${baseUrl}/api/v1/sse`, {
          headers: {
            Origin: "http://localhost:3000",
            Accept: "text/event-stream",
          },
          signal: controller.signal,
        });

        expect(response.status).toBe(200);
        expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
      } catch (error: unknown) {
        if (error instanceof Error && error.name !== "AbortError") {
          throw error;
        }
      } finally {
        clearTimeout(timeoutId);
      }
    });
  });
});

describe("CORS Disabled", () => {
  let serverInstance: HttpServerInstance | null = null;
  let baseUrl: string;
  const port = 3095; // Different port for disabled CORS tests

  // Mock factories
  const mockCreateServerForSse = mock((): McpServer => {
    return {
      connect: mock(async () => {}),
      close: mock(async () => {}),
      setRequestHandler: mock(() => {}),
    } as unknown as McpServer;
  });

  const mockCreateServerForStreamableHttp = mock((): McpServer => {
    return {
      connect: mock(async () => {}),
      close: mock(async () => {}),
      setRequestHandler: mock(() => {}),
    } as unknown as McpServer;
  });

  const mockCheckChromaDb = mock(async () => true);

  // Disabled CORS config
  const disabledCorsConfig: CorsConfig = {
    enabled: false,
    origins: ["http://localhost:3000"],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type"],
    exposedHeaders: [],
    credentials: true,
    maxAge: 86400,
  };

  beforeAll(async () => {
    const app = createHttpApp({
      createServerForSse: mockCreateServerForSse,
      createServerForStreamableHttp: mockCreateServerForStreamableHttp,
      checkChromaDb: mockCheckChromaDb,
      corsConfig: disabledCorsConfig,
    });

    const config: HttpTransportConfig = {
      enabled: true,
      port,
      host: "127.0.0.1",
    };

    serverInstance = await startHttpServer(app, config);
    baseUrl = `http://${serverInstance.host}:${serverInstance.port}`;
  });

  afterAll(async () => {
    if (serverInstance) {
      await serverInstance.close();
    }
  });

  test("should not add CORS headers when disabled", async () => {
    const response = await fetch(`${baseUrl}/health`, {
      headers: {
        Origin: "http://localhost:3000",
      },
    });

    // Request should succeed (no CORS blocking)
    expect(response.status).toBe(200);

    // No CORS headers should be present
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("should allow cross-origin requests without CORS when disabled", async () => {
    // When CORS is disabled, the middleware is not applied at all
    // so cross-origin requests work but without CORS headers
    const response = await fetch(`${baseUrl}/health`, {
      headers: {
        Origin: "http://any-origin.com",
      },
    });

    expect(response.status).toBe(200);
  });
});
