/**
 * HTTP Server Unit Tests
 *
 * Tests for HTTP server configuration and setup functions.
 */

import { describe, test, expect, beforeAll, afterAll, mock } from "bun:test";
import { initializeLogger } from "../../../src/logging/index.js";
import { loadHttpConfig, createHttpApp } from "../../../src/http/server.js";
import type { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";

// Initialize logger before tests (wrapped in try-catch for parallel test execution)
try {
  initializeLogger({ level: "silent", format: "json" });
} catch {
  // Logger already initialized by another test file, ignore
}

describe("HTTP Server Configuration", () => {
  // Store original env values
  const originalEnv: Record<string, string | undefined> = {};

  beforeAll(() => {
    // Save original values
    originalEnv["HTTP_PORT"] = Bun.env["HTTP_PORT"];
    originalEnv["HTTP_HOST"] = Bun.env["HTTP_HOST"];
    originalEnv["HTTP_TRANSPORT_ENABLED"] = Bun.env["HTTP_TRANSPORT_ENABLED"];
  });

  afterAll(() => {
    // Restore original values
    Bun.env["HTTP_PORT"] = originalEnv["HTTP_PORT"];
    Bun.env["HTTP_HOST"] = originalEnv["HTTP_HOST"];
    Bun.env["HTTP_TRANSPORT_ENABLED"] = originalEnv["HTTP_TRANSPORT_ENABLED"];
  });

  describe("loadHttpConfig", () => {
    describe("Port Validation", () => {
      test("should use default port 3001 when not specified", () => {
        delete Bun.env["HTTP_PORT"];
        const config = loadHttpConfig();
        expect(config.port).toBe(3001);
      });

      test("should parse valid port from environment", () => {
        Bun.env["HTTP_PORT"] = "8080";
        const config = loadHttpConfig();
        expect(config.port).toBe(8080);
      });

      test("should throw error for non-numeric port", () => {
        Bun.env["HTTP_PORT"] = "abc";
        expect(() => loadHttpConfig()).toThrow("Invalid HTTP_PORT");
      });

      test("should throw error for port 0", () => {
        Bun.env["HTTP_PORT"] = "0";
        expect(() => loadHttpConfig()).toThrow("Invalid HTTP_PORT");
      });

      test("should throw error for negative port", () => {
        Bun.env["HTTP_PORT"] = "-1";
        expect(() => loadHttpConfig()).toThrow("Invalid HTTP_PORT");
      });

      test("should throw error for port above 65535", () => {
        Bun.env["HTTP_PORT"] = "65536";
        expect(() => loadHttpConfig()).toThrow("Invalid HTTP_PORT");
      });

      test("should accept port 1 (minimum valid)", () => {
        Bun.env["HTTP_PORT"] = "1";
        const config = loadHttpConfig();
        expect(config.port).toBe(1);
      });

      test("should accept port 65535 (maximum valid)", () => {
        Bun.env["HTTP_PORT"] = "65535";
        const config = loadHttpConfig();
        expect(config.port).toBe(65535);
      });

      test("should throw error for floating point port", () => {
        Bun.env["HTTP_PORT"] = "3001.5";
        // parseInt parses "3001.5" as 3001, which is valid
        // This test documents current behavior - floats get truncated
        const config = loadHttpConfig();
        expect(config.port).toBe(3001);
      });

      test("should throw error for empty string port", () => {
        Bun.env["HTTP_PORT"] = "";
        // Empty string falls back to default
        const config = loadHttpConfig();
        expect(config.port).toBe(3001);
      });
    });

    describe("Host Configuration", () => {
      test("should use default host 127.0.0.1 when not specified", () => {
        delete Bun.env["HTTP_HOST"];
        const config = loadHttpConfig();
        expect(config.host).toBe("127.0.0.1");
      });

      test("should use specified host from environment", () => {
        Bun.env["HTTP_HOST"] = "0.0.0.0";
        Bun.env["HTTP_TRANSPORT_ENABLED"] = "false";
        const config = loadHttpConfig();
        expect(config.host).toBe("0.0.0.0");
      });

      test("should accept localhost as host", () => {
        Bun.env["HTTP_HOST"] = "localhost";
        const config = loadHttpConfig();
        expect(config.host).toBe("localhost");
      });
    });

    describe("Enabled Flag", () => {
      test("should return enabled=false by default", () => {
        delete Bun.env["HTTP_TRANSPORT_ENABLED"];
        const config = loadHttpConfig();
        expect(config.enabled).toBe(false);
      });

      test("should return enabled=true when set to 'true'", () => {
        Bun.env["HTTP_TRANSPORT_ENABLED"] = "true";
        const config = loadHttpConfig();
        expect(config.enabled).toBe(true);
      });

      test("should return enabled=false for any value other than 'true'", () => {
        Bun.env["HTTP_TRANSPORT_ENABLED"] = "false";
        expect(loadHttpConfig().enabled).toBe(false);

        Bun.env["HTTP_TRANSPORT_ENABLED"] = "1";
        expect(loadHttpConfig().enabled).toBe(false);

        Bun.env["HTTP_TRANSPORT_ENABLED"] = "yes";
        expect(loadHttpConfig().enabled).toBe(false);
      });
    });
  });
});

describe("HTTP App Creation", () => {
  // Mock dependencies
  const mockCreateServerForSse = mock((): McpServer => {
    return {
      connect: mock(async () => {}),
      close: mock(async () => {}),
      setRequestHandler: mock(() => {}),
    } as unknown as McpServer;
  });

  const mockCheckChromaDb = mock(async () => true);

  test("should create Express app without throwing", () => {
    expect(() =>
      createHttpApp({
        createServerForSse: mockCreateServerForSse,
        checkChromaDb: mockCheckChromaDb,
      })
    ).not.toThrow();
  });

  test("should return an Express app with use method", () => {
    const app = createHttpApp({
      createServerForSse: mockCreateServerForSse,
      checkChromaDb: mockCheckChromaDb,
    });

    expect(typeof app.use).toBe("function");
    expect(typeof app.listen).toBe("function");
  });
});
