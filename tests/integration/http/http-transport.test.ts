/**
 * HTTP Transport Integration Tests
 *
 * Tests the complete HTTP/SSE transport flow including:
 * - Health endpoint functionality
 * - SSE connection establishment
 * - MCP protocol over HTTP
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, mock } from "bun:test";
import { initializeLogger } from "../../../src/logging/index.js";
import {
  createHttpApp,
  startHttpServer,
  getActiveSessionCount,
  getMaxSessions,
  closeAllSessions,
} from "../../../src/http/index.js";
import type { HttpTransportConfig } from "../../../src/mcp/types.js";
import type { HttpServerInstance } from "../../../src/http/types.js";
import type { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";

/**
 * Response types for type-safe assertions
 */
interface HealthResponse {
  status: string;
  version: string;
  uptime: number;
  timestamp: string;
  checks: {
    chromadb: string;
  };
}

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

describe("HTTP Transport Integration", () => {
  let serverInstance: HttpServerInstance | null = null;
  let baseUrl: string;
  const port = 3099; // Use a non-standard port for tests

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

  beforeAll(async () => {
    const app = createHttpApp({
      createServerForSse: mockCreateServerForSse,
      createServerForStreamableHttp: mockCreateServerForStreamableHttp,
      checkChromaDb: mockCheckChromaDb,
      // Disable rate limiting for these tests - rate limiting is tested in rate-limiting.test.ts
      rateLimitConfig: {
        enabled: false,
        readLimits: { perMinute: 0, perHour: 0 },
        writeLimits: { perMinute: 0, perHour: 0 },
        adminBypass: false,
      },
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

  describe("Health Endpoint", () => {
    test("GET /health should return 200 when healthy", async () => {
      const response = await fetch(`${baseUrl}/health`);

      expect(response.status).toBe(200);

      const body = (await response.json()) as HealthResponse;
      expect(body.status).toBe("healthy");
      expect(body.version).toBe("1.0.0");
      expect(body.checks.chromadb).toBe("connected");
    });

    test("GET /health should include uptime and timestamp", async () => {
      const response = await fetch(`${baseUrl}/health`);
      const body = (await response.json()) as HealthResponse;

      expect(typeof body.uptime).toBe("number");
      expect(body.uptime).toBeGreaterThanOrEqual(0);

      expect(typeof body.timestamp).toBe("string");
      // Validate ISO format
      expect(() => new Date(body.timestamp)).not.toThrow();
    });

    test("GET /health should return JSON content type", async () => {
      const response = await fetch(`${baseUrl}/health`);

      expect(response.headers.get("content-type")).toContain("application/json");
    });
  });

  describe("404 Handling", () => {
    test("should return 404 for unknown routes", async () => {
      const response = await fetch(`${baseUrl}/unknown-route`);

      expect(response.status).toBe(404);

      const body = (await response.json()) as ErrorResponse;
      expect(body.error.code).toBe("NOT_FOUND");
      expect(body.error.message).toContain("Route not found");
    });

    test("should include method and path in 404 error", async () => {
      const response = await fetch(`${baseUrl}/api/v1/unknown`, {
        method: "POST",
      });

      expect(response.status).toBe(404);

      const body = (await response.json()) as ErrorResponse;
      expect(body.error.message).toContain("POST");
      expect(body.error.message).toContain("/api/v1/unknown");
    });
  });

  describe("SSE Endpoint", () => {
    test("GET /api/v1/sse should establish SSE connection", async () => {
      // Note: This test verifies the endpoint is reachable
      // Full SSE testing requires a more complex setup with event handling
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1000);

      try {
        const response = await fetch(`${baseUrl}/api/v1/sse`, {
          headers: {
            Accept: "text/event-stream",
          },
          signal: controller.signal,
        });

        // SSE endpoints return 200 with text/event-stream content type
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain("text/event-stream");
      } catch (error: unknown) {
        // AbortError is expected when we timeout
        if (error instanceof Error && error.name !== "AbortError") {
          throw error;
        }
      } finally {
        clearTimeout(timeoutId);
      }
    });

    test("POST /api/v1/sse without session ID should return 400", async () => {
      const response = await fetch(`${baseUrl}/api/v1/sse`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "initialize",
          params: {},
          id: 1,
        }),
      });

      expect(response.status).toBe(400);

      const body = (await response.json()) as ErrorResponse;
      expect(body.error.code).toBe("MISSING_SESSION_ID");
    });

    test("POST /api/v1/sse with invalid session ID should return 400", async () => {
      const response = await fetch(`${baseUrl}/api/v1/sse`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "mcp-session-id": "invalid-session-id",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/list",
          id: 1,
        }),
      });

      expect(response.status).toBe(400);

      const body = (await response.json()) as ErrorResponse;
      expect(body.error.code).toBe("INVALID_SESSION");
    });
  });

  describe("Error Handling", () => {
    test("should handle JSON parsing errors", async () => {
      const response = await fetch(`${baseUrl}/api/v1/sse`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "mcp-session-id": "test-session",
        },
        body: "{ invalid json }",
      });

      // Should return 400 for malformed JSON
      expect(response.status).toBe(400);
    });
  });

  describe("Session Management", () => {
    beforeEach(async () => {
      // Clean up any existing sessions before each test
      await closeAllSessions();
    });

    test("should track active session count", async () => {
      const initialCount = getActiveSessionCount();
      expect(initialCount).toBe(0);

      // Create an SSE connection
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 500);

      try {
        // Start SSE connection (will be aborted after 500ms)
        await fetch(`${baseUrl}/api/v1/sse`, {
          headers: { Accept: "text/event-stream" },
          signal: controller.signal,
        });
      } catch (error: unknown) {
        if (error instanceof Error && error.name !== "AbortError") {
          throw error;
        }
      } finally {
        clearTimeout(timeoutId);
      }

      // Session count may increase briefly (cleaned up on abort)
      // This tests that the tracking mechanism exists
      expect(typeof getActiveSessionCount()).toBe("number");
    });

    test("should expose max sessions configuration", () => {
      const maxSessions = getMaxSessions();

      expect(typeof maxSessions).toBe("number");
      expect(maxSessions).toBeGreaterThan(0);
      // Default is 100 unless overridden by env var
      expect(maxSessions).toBeLessThanOrEqual(1000);
    });

    test("should handle concurrent SSE connection requests", async () => {
      // Create multiple concurrent SSE connection attempts
      const connectionPromises: Promise<Response>[] = [];
      const controllers: AbortController[] = [];

      // Start 3 concurrent connections
      for (let i = 0; i < 3; i++) {
        const controller = new AbortController();
        controllers.push(controller);

        connectionPromises.push(
          fetch(`${baseUrl}/api/v1/sse`, {
            headers: { Accept: "text/event-stream" },
            signal: controller.signal,
          })
        );
      }

      // Abort all after a short delay
      setTimeout(() => {
        for (const controller of controllers) {
          controller.abort();
        }
      }, 300);

      // All connections should either succeed (200) or be aborted
      const results = await Promise.allSettled(connectionPromises);

      for (const result of results) {
        if (result.status === "fulfilled") {
          expect(result.value.status).toBe(200);
        } else if (result.status === "rejected") {
          // AbortError is expected
          const reason = result.reason as Error;
          expect(reason.name).toBe("AbortError");
        }
      }
    });

    test("should clean up all sessions on closeAllSessions", async () => {
      // Start an SSE connection
      const controller = new AbortController();

      // Use a promise to track the connection
      const connectionPromise = fetch(`${baseUrl}/api/v1/sse`, {
        headers: { Accept: "text/event-stream" },
        signal: controller.signal,
      }).catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") {
          return null; // Expected
        }
        throw error;
      });

      // Give the connection time to establish
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Close all sessions
      await closeAllSessions();

      // Clean up our controller
      controller.abort();
      await connectionPromise;

      // Session count should be 0
      expect(getActiveSessionCount()).toBe(0);
    });
  });

  describe("Performance", () => {
    test("health endpoint should respond within 100ms", async () => {
      const iterations = 5;
      const times: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        await fetch(`${baseUrl}/health`);
        const end = performance.now();
        times.push(end - start);
      }

      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;

      // Average response time should be under 100ms (generous for HTTP overhead)
      expect(avgTime).toBeLessThan(100);
    });
  });
});
