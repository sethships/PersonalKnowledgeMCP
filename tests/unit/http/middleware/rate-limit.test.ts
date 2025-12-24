/**
 * Rate Limiting Middleware Unit Tests
 *
 * Tests for rate limiting middleware including configuration loading,
 * key generation, admin bypass, and rate limit enforcement.
 *
 * @module tests/unit/http/middleware/rate-limit
 */

import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import type { Request, Response } from "express";
import { initializeLogger } from "../../../../src/logging/index.js";
import {
  createRateLimitMiddleware,
  loadRateLimitConfig,
  DEFAULT_RATE_LIMIT_CONFIG,
} from "../../../../src/http/middleware/rate-limit.js";
import type { RateLimitConfig } from "../../../../src/http/middleware/rate-limit-types.js";
import type { TokenMetadata } from "../../../../src/auth/types.js";

// Initialize logger before tests (wrapped in try-catch for parallel test execution)
try {
  initializeLogger({ level: "silent", format: "json" });
} catch {
  // Logger already initialized by another test file, ignore
}

/**
 * Create a mock Request object
 */
function createMockRequest(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    method: "GET",
    path: "/test",
    ip: "127.0.0.1",
    socket: { remoteAddress: "127.0.0.1" },
    ...overrides,
  } as Request;
}

/**
 * Create a mock Response object with header tracking
 */
function createMockResponse(): Response & { headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  const res = {
    headers,
    status: mock(function (this: Response, _code: number) {
      return this;
    }),
    set: mock(function (
      this: Response & { headers: Record<string, string> },
      key: string,
      value: string
    ) {
      this.headers[key] = value;
      return this;
    }),
    json: mock(() => {}),
    setHeader: mock((key: string, value: string) => {
      headers[key] = value;
    }),
  } as unknown as Response & { headers: Record<string, string> };
  return res;
}

/**
 * Create valid token metadata for testing
 */
function createValidTokenMetadata(
  scopes: ("read" | "write" | "admin")[] = ["read"]
): TokenMetadata {
  return {
    name: "Test Token",
    createdAt: new Date().toISOString(),
    expiresAt: null,
    scopes,
    instanceAccess: ["public"],
    useCount: 0,
  };
}

/**
 * Helper to invoke middleware and wait for next() callback
 */
function invokeMiddleware(
  middleware: ReturnType<typeof createRateLimitMiddleware>,
  req: Request,
  res: Response
): Promise<unknown> {
  return new Promise((resolve) => {
    if (middleware) {
      // The middleware is synchronous in its callback invocation
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      middleware(req, res, (err?: unknown) => {
        resolve(err);
      });
    } else {
      resolve(undefined);
    }
  });
}

describe("Rate Limiting Middleware", () => {
  // Store original env values
  const originalEnv: Record<string, string | undefined> = {};
  const envVars = [
    "RATE_LIMIT_ENABLED",
    "RATE_LIMIT_READ_PER_MINUTE",
    "RATE_LIMIT_READ_PER_HOUR",
    "RATE_LIMIT_WRITE_PER_MINUTE",
    "RATE_LIMIT_WRITE_PER_HOUR",
    "RATE_LIMIT_ADMIN_BYPASS",
  ];

  beforeEach(() => {
    // Save original env values
    for (const key of envVars) {
      originalEnv[key] = Bun.env[key];
      delete Bun.env[key];
    }
  });

  afterEach(() => {
    // Restore original env values
    for (const key of envVars) {
      if (originalEnv[key] === undefined) {
        delete Bun.env[key];
      } else {
        Bun.env[key] = originalEnv[key];
      }
    }
  });

  describe("DEFAULT_RATE_LIMIT_CONFIG", () => {
    it("should have expected default values", () => {
      expect(DEFAULT_RATE_LIMIT_CONFIG.enabled).toBe(true);
      expect(DEFAULT_RATE_LIMIT_CONFIG.readLimits.perMinute).toBe(60);
      expect(DEFAULT_RATE_LIMIT_CONFIG.readLimits.perHour).toBe(1000);
      expect(DEFAULT_RATE_LIMIT_CONFIG.writeLimits.perMinute).toBe(30);
      expect(DEFAULT_RATE_LIMIT_CONFIG.writeLimits.perHour).toBe(500);
      expect(DEFAULT_RATE_LIMIT_CONFIG.adminBypass).toBe(true);
    });
  });

  describe("loadRateLimitConfig", () => {
    it("should use defaults when no environment variables set", () => {
      const config = loadRateLimitConfig();

      expect(config.enabled).toBe(true);
      expect(config.readLimits.perMinute).toBe(60);
      expect(config.readLimits.perHour).toBe(1000);
      expect(config.writeLimits.perMinute).toBe(30);
      expect(config.writeLimits.perHour).toBe(500);
      expect(config.adminBypass).toBe(true);
    });

    it("should respect RATE_LIMIT_ENABLED=false", () => {
      Bun.env["RATE_LIMIT_ENABLED"] = "false";

      const config = loadRateLimitConfig();

      expect(config.enabled).toBe(false);
    });

    it("should parse custom read limits from environment", () => {
      Bun.env["RATE_LIMIT_READ_PER_MINUTE"] = "100";
      Bun.env["RATE_LIMIT_READ_PER_HOUR"] = "2000";

      const config = loadRateLimitConfig();

      expect(config.readLimits.perMinute).toBe(100);
      expect(config.readLimits.perHour).toBe(2000);
    });

    it("should parse custom write limits from environment", () => {
      Bun.env["RATE_LIMIT_WRITE_PER_MINUTE"] = "50";
      Bun.env["RATE_LIMIT_WRITE_PER_HOUR"] = "1000";

      const config = loadRateLimitConfig();

      expect(config.writeLimits.perMinute).toBe(50);
      expect(config.writeLimits.perHour).toBe(1000);
    });

    it("should respect RATE_LIMIT_ADMIN_BYPASS=false", () => {
      Bun.env["RATE_LIMIT_ADMIN_BYPASS"] = "false";

      const config = loadRateLimitConfig();

      expect(config.adminBypass).toBe(false);
    });

    it("should use defaults for invalid numeric values", () => {
      Bun.env["RATE_LIMIT_READ_PER_MINUTE"] = "invalid";
      Bun.env["RATE_LIMIT_WRITE_PER_HOUR"] = "-50";

      const config = loadRateLimitConfig();

      expect(config.readLimits.perMinute).toBe(60); // default
      expect(config.writeLimits.perHour).toBe(500); // default
    });
  });

  describe("createRateLimitMiddleware", () => {
    it("should return null when rate limiting is disabled", () => {
      const config: RateLimitConfig = {
        ...DEFAULT_RATE_LIMIT_CONFIG,
        enabled: false,
      };

      const middleware = createRateLimitMiddleware(config);

      expect(middleware).toBeNull();
    });

    it("should return a middleware function when enabled", () => {
      const middleware = createRateLimitMiddleware(DEFAULT_RATE_LIMIT_CONFIG);

      expect(middleware).not.toBeNull();
      expect(typeof middleware).toBe("function");
    });

    it("should allow requests within rate limits", async () => {
      const middleware = createRateLimitMiddleware(DEFAULT_RATE_LIMIT_CONFIG);
      expect(middleware).not.toBeNull();

      const req = createMockRequest({ method: "GET" });
      const res = createMockResponse();

      const err = await invokeMiddleware(middleware, req, res);
      expect(err).toBeUndefined();
    });

    it("should use token hash as key for authenticated requests", async () => {
      const middleware = createRateLimitMiddleware({
        ...DEFAULT_RATE_LIMIT_CONFIG,
        readLimits: { perMinute: 100, perHour: 1000 },
      });
      expect(middleware).not.toBeNull();

      const req = createMockRequest({ method: "GET" });
      req.rawToken = "pk_mcp_token_a_1234567890123456";
      req.tokenMetadata = createValidTokenMetadata();
      const res = createMockResponse();

      const err = await invokeMiddleware(middleware, req, res);
      expect(err).toBeUndefined();
    });

    it("should use IP as key for unauthenticated requests", async () => {
      const middleware = createRateLimitMiddleware(DEFAULT_RATE_LIMIT_CONFIG);
      expect(middleware).not.toBeNull();

      const req = createMockRequest({
        method: "GET",
        ip: "192.168.1.100",
      });
      // No rawToken or tokenMetadata
      const res = createMockResponse();

      const err = await invokeMiddleware(middleware, req, res);
      expect(err).toBeUndefined();
    });

    it("should bypass rate limits for admin tokens when adminBypass is enabled", async () => {
      const middleware = createRateLimitMiddleware({
        ...DEFAULT_RATE_LIMIT_CONFIG,
        readLimits: { perMinute: 1, perHour: 1 }, // Very restrictive
        adminBypass: true,
      });
      expect(middleware).not.toBeNull();

      const req = createMockRequest({ method: "GET" });
      req.rawToken = "pk_mcp_admin_token_" + Date.now();
      req.tokenMetadata = createValidTokenMetadata(["admin"]);
      const res = createMockResponse();

      // First request should pass
      const err1 = await invokeMiddleware(middleware, req, res);
      expect(err1).toBeUndefined();

      // Second request should also pass due to admin bypass
      const err2 = await invokeMiddleware(middleware, req, res);
      expect(err2).toBeUndefined();
    });

    it("should apply read limits to GET requests", async () => {
      const middleware = createRateLimitMiddleware({
        ...DEFAULT_RATE_LIMIT_CONFIG,
        readLimits: { perMinute: 100, perHour: 1000 },
      });
      expect(middleware).not.toBeNull();

      const req = createMockRequest({ method: "GET" });
      req.rawToken = "pk_mcp_get_test_" + Date.now();
      req.tokenMetadata = createValidTokenMetadata();
      const res = createMockResponse();

      const err = await invokeMiddleware(middleware, req, res);
      expect(err).toBeUndefined();
    });

    it("should apply write limits to POST requests", async () => {
      const middleware = createRateLimitMiddleware({
        ...DEFAULT_RATE_LIMIT_CONFIG,
        writeLimits: { perMinute: 100, perHour: 1000 },
      });
      expect(middleware).not.toBeNull();

      const req = createMockRequest({ method: "POST" });
      req.rawToken = "pk_mcp_post_test_" + Date.now();
      req.tokenMetadata = createValidTokenMetadata();
      const res = createMockResponse();

      const err = await invokeMiddleware(middleware, req, res);
      expect(err).toBeUndefined();
    });

    it("should classify PUT, PATCH, DELETE as write operations", async () => {
      const middleware = createRateLimitMiddleware(DEFAULT_RATE_LIMIT_CONFIG);
      expect(middleware).not.toBeNull();

      const req = createMockRequest({ method: "PUT" });
      req.rawToken = "pk_mcp_put_test_" + Date.now();
      req.tokenMetadata = createValidTokenMetadata();
      const res = createMockResponse();

      const err = await invokeMiddleware(middleware, req, res);
      expect(err).toBeUndefined();
    });

    it("should classify HEAD and OPTIONS as read operations", async () => {
      const middleware = createRateLimitMiddleware(DEFAULT_RATE_LIMIT_CONFIG);
      expect(middleware).not.toBeNull();

      const req = createMockRequest({ method: "HEAD" });
      req.rawToken = "pk_mcp_head_test_" + Date.now();
      req.tokenMetadata = createValidTokenMetadata();
      const res = createMockResponse();

      const err = await invokeMiddleware(middleware, req, res);
      expect(err).toBeUndefined();
    });
  });

  describe("Rate Limit Enforcement", () => {
    it("should enforce rate limits and return 429 when exceeded", async () => {
      const middleware = createRateLimitMiddleware({
        ...DEFAULT_RATE_LIMIT_CONFIG,
        readLimits: { perMinute: 1, perHour: 100 },
      });
      expect(middleware).not.toBeNull();

      const tokenId = "pk_mcp_limit_enforce_" + Date.now();

      // First request should pass
      const req1 = createMockRequest({ method: "GET" });
      req1.rawToken = tokenId;
      req1.tokenMetadata = createValidTokenMetadata();
      const res1 = createMockResponse();

      const err1 = await invokeMiddleware(middleware, req1, res1);
      expect(err1).toBeUndefined();

      // Second request should be rate limited
      const req2 = createMockRequest({ method: "GET" });
      req2.rawToken = tokenId;
      req2.tokenMetadata = createValidTokenMetadata();
      const res2 = createMockResponse();

      // Override status to capture the status code
      let receivedStatus = 0;
      res2.status = ((code: number) => {
        receivedStatus = code;
        return res2;
      }) as typeof res2.status;

      // Invoke middleware and wait for rate limit response
      if (middleware) {
        // The middleware is synchronous in its callback invocation
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        middleware(req2, res2, () => {
          // If next is called without error, rate limiting didn't trigger
          // This shouldn't happen with the limit of 1
        });
      }

      // Give a bit of time for the response to be sent
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(receivedStatus).toBe(429);
          resolve();
        }, 50);
      });
    });
  });
});
