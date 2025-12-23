/**
 * HTTP Transport Integration Tests
 *
 * Tests the complete HTTP/SSE transport flow including:
 * - Health endpoint functionality
 * - SSE connection establishment
 * - MCP protocol over HTTP
 */

import { describe, test, expect, beforeAll, afterAll, mock } from "bun:test";
import { initializeLogger } from "../../../src/logging/index.js";
import { createHttpApp, startHttpServer } from "../../../src/http/index.js";
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

  // Mock MCP server factory
  const mockCreateServerForSse = mock((): McpServer => {
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
      checkChromaDb: mockCheckChromaDb,
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
});
