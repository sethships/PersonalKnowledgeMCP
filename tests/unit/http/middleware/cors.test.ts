/**
 * CORS Middleware Unit Tests
 *
 * Tests CORS configuration loading, origin validation, and middleware creation.
 */

import { describe, test, expect, beforeAll, beforeEach, afterEach, mock } from "bun:test";
import type { Request, Response, NextFunction } from "express";
import { initializeLogger } from "../../../../src/logging/index.js";
import {
  createCorsMiddleware,
  loadCorsConfig,
  DEFAULT_CORS_CONFIG,
} from "../../../../src/http/middleware/cors.js";
import type { CorsConfig } from "../../../../src/http/middleware/cors-types.js";

// Initialize logger before tests (wrapped in try-catch for parallel test execution)
beforeAll(() => {
  try {
    initializeLogger({ level: "silent", format: "json" });
  } catch {
    // Logger already initialized by another test file, ignore
  }
});

/**
 * Create a complete mock Express response with all required methods
 */
function createMockResponse(): {
  response: Partial<Response>;
  getData: () => { jsonData: unknown; statusCode: number; headers: Map<string, string> };
} {
  let jsonData: unknown;
  let statusCode = 200;
  const headers = new Map<string, string>();

  const response: Partial<Response> = {
    status: mock((code: number) => {
      statusCode = code;
      return response as Response;
    }),
    json: mock((data: unknown) => {
      jsonData = data;
      return response as Response;
    }),
    setHeader: mock((name: string, value: string) => {
      headers.set(name.toLowerCase(), value);
      return response as Response;
    }),
    getHeader: mock((name: string) => headers.get(name.toLowerCase())),
    end: mock(() => response as Response),
    statusCode: 200,
  };

  // Make statusCode property update correctly
  Object.defineProperty(response, "statusCode", {
    get: () => statusCode,
    set: (value: number) => {
      statusCode = value;
    },
  });

  return {
    response,
    getData: () => ({ jsonData, statusCode, headers }),
  };
}

describe("CORS Middleware", () => {
  describe("DEFAULT_CORS_CONFIG", () => {
    test("should have secure default values", () => {
      expect(DEFAULT_CORS_CONFIG.enabled).toBe(true);
      expect(DEFAULT_CORS_CONFIG.origins).toEqual(["http://localhost:3000"]);
      expect(DEFAULT_CORS_CONFIG.methods).toEqual(["GET", "POST", "OPTIONS"]);
      expect(DEFAULT_CORS_CONFIG.allowedHeaders).toContain("Authorization");
      expect(DEFAULT_CORS_CONFIG.allowedHeaders).toContain("Content-Type");
      expect(DEFAULT_CORS_CONFIG.allowedHeaders).toContain("Mcp-Session-Id");
      expect(DEFAULT_CORS_CONFIG.credentials).toBe(true);
      expect(DEFAULT_CORS_CONFIG.maxAge).toBe(86400);
    });
  });

  describe("loadCorsConfig", () => {
    const originalEnv: Record<string, string | undefined> = {};

    beforeEach(() => {
      // Store original environment variables
      originalEnv["CORS_ENABLED"] = Bun.env["CORS_ENABLED"];
      originalEnv["CORS_ORIGINS"] = Bun.env["CORS_ORIGINS"];
      originalEnv["CORS_CREDENTIALS"] = Bun.env["CORS_CREDENTIALS"];
      originalEnv["CORS_MAX_AGE"] = Bun.env["CORS_MAX_AGE"];
    });

    afterEach(() => {
      // Restore original environment variables
      for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) {
          delete Bun.env[key];
        } else {
          Bun.env[key] = value;
        }
      }
    });

    test("should load default config when no env vars set", () => {
      delete Bun.env["CORS_ENABLED"];
      delete Bun.env["CORS_ORIGINS"];
      delete Bun.env["CORS_CREDENTIALS"];
      delete Bun.env["CORS_MAX_AGE"];

      const config = loadCorsConfig();

      expect(config.enabled).toBe(true);
      expect(config.origins).toEqual(DEFAULT_CORS_CONFIG.origins);
      expect(config.credentials).toBe(true);
      expect(config.maxAge).toBe(DEFAULT_CORS_CONFIG.maxAge);
    });

    test("should parse single origin from env var", () => {
      Bun.env["CORS_ORIGINS"] = "http://example.com";

      const config = loadCorsConfig();

      expect(config.origins).toEqual(["http://example.com"]);
    });

    test("should parse multiple origins from comma-separated env var", () => {
      Bun.env["CORS_ORIGINS"] = "http://localhost:3000,http://localhost:5173,https://myapp.com";

      const config = loadCorsConfig();

      expect(config.origins).toEqual([
        "http://localhost:3000",
        "http://localhost:5173",
        "https://myapp.com",
      ]);
    });

    test("should trim whitespace from origins", () => {
      Bun.env["CORS_ORIGINS"] = " http://localhost:3000 , http://example.com ";

      const config = loadCorsConfig();

      expect(config.origins).toEqual(["http://localhost:3000", "http://example.com"]);
    });

    test("should disable CORS when CORS_ENABLED=false", () => {
      Bun.env["CORS_ENABLED"] = "false";

      const config = loadCorsConfig();

      expect(config.enabled).toBe(false);
    });

    test("should disable credentials when CORS_CREDENTIALS=false", () => {
      Bun.env["CORS_CREDENTIALS"] = "false";

      const config = loadCorsConfig();

      expect(config.credentials).toBe(false);
    });

    test("should parse custom max age from env var", () => {
      Bun.env["CORS_MAX_AGE"] = "3600";

      const config = loadCorsConfig();

      expect(config.maxAge).toBe(3600);
    });

    test("should use default max age for invalid value", () => {
      Bun.env["CORS_MAX_AGE"] = "invalid";

      const config = loadCorsConfig();

      expect(config.maxAge).toBe(DEFAULT_CORS_CONFIG.maxAge);
    });

    test("should use default max age for negative value", () => {
      Bun.env["CORS_MAX_AGE"] = "-100";

      const config = loadCorsConfig();

      expect(config.maxAge).toBe(DEFAULT_CORS_CONFIG.maxAge);
    });
  });

  describe("createCorsMiddleware", () => {
    test("should return null when CORS is disabled", () => {
      const config: CorsConfig = {
        ...DEFAULT_CORS_CONFIG,
        enabled: false,
      };

      const middleware = createCorsMiddleware(config);

      expect(middleware).toBeNull();
    });

    test("should return middleware function when CORS is enabled", () => {
      const middleware = createCorsMiddleware(DEFAULT_CORS_CONFIG);

      expect(middleware).toBeFunction();
    });

    test("should allow requests without origin (same-origin)", () => {
      const middleware = createCorsMiddleware(DEFAULT_CORS_CONFIG);
      const { response } = createMockResponse();

      const mockRequest: Partial<Request> = {
        method: "GET",
        path: "/health",
        headers: {}, // No origin header
      };

      let nextCalled = false;
      const mockNext = () => {
        nextCalled = true;
      };

      middleware!(mockRequest as Request, response as Response, mockNext as NextFunction);

      expect(nextCalled).toBe(true);
    });

    test("should allow requests from allowed origin", () => {
      const middleware = createCorsMiddleware(DEFAULT_CORS_CONFIG);
      const { response } = createMockResponse();

      const mockRequest: Partial<Request> = {
        method: "GET",
        path: "/health",
        headers: {
          origin: "http://localhost:3000",
        },
      };

      let nextCalled = false;
      const mockNext = () => {
        nextCalled = true;
      };

      middleware!(mockRequest as Request, response as Response, mockNext as NextFunction);

      expect(nextCalled).toBe(true);
    });

    test("should block requests from non-allowed origin", () => {
      const middleware = createCorsMiddleware(DEFAULT_CORS_CONFIG);
      const { response, getData } = createMockResponse();

      const mockRequest: Partial<Request> = {
        method: "GET",
        path: "/health",
        headers: {
          origin: "http://malicious-site.com",
        },
      };

      middleware!(mockRequest as Request, response as Response, (() => {}) as NextFunction);

      const { jsonData, statusCode } = getData();
      expect(statusCode).toBe(403);
      expect(jsonData).toEqual({
        error: {
          message: "CORS policy: Origin not allowed",
          code: "CORS_ORIGIN_NOT_ALLOWED",
          statusCode: 403,
        },
      });
    });

    test("should handle preflight OPTIONS requests", () => {
      const middleware = createCorsMiddleware(DEFAULT_CORS_CONFIG);
      const { response } = createMockResponse();

      const mockRequest: Partial<Request> = {
        method: "OPTIONS",
        path: "/api/v1/sse",
        headers: {
          origin: "http://localhost:3000",
          "access-control-request-method": "POST",
          "access-control-request-headers": "Authorization,Content-Type",
        },
      };

      const mockNext = () => {};

      middleware!(mockRequest as Request, response as Response, mockNext as NextFunction);

      // For preflight requests from allowed origin, the cors middleware should handle it
      // The response.end() is called by the cors package for OPTIONS
      expect(response.end).toHaveBeenCalled();
    });

    test("should allow multiple configured origins", () => {
      const config: CorsConfig = {
        ...DEFAULT_CORS_CONFIG,
        origins: ["http://localhost:3000", "http://localhost:5173", "https://myapp.com"],
      };

      const middleware = createCorsMiddleware(config);

      // Test each allowed origin
      for (const origin of config.origins) {
        const { response } = createMockResponse();
        const mockRequest: Partial<Request> = {
          method: "GET",
          path: "/health",
          headers: { origin },
        };

        let nextCalled = false;
        const mockNext = () => {
          nextCalled = true;
        };

        middleware!(mockRequest as Request, response as Response, mockNext as NextFunction);

        expect(nextCalled).toBe(true);
      }
    });
  });
});
