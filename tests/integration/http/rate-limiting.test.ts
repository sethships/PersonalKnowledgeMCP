/**
 * Rate Limiting Integration Tests
 *
 * End-to-end tests for rate limiting middleware with a real HTTP server.
 * Tests the full request flow including authentication and rate limiting.
 *
 * @module tests/integration/http/rate-limiting
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import express from "express";
import type { Express } from "express";
import type { Server } from "node:http";
import {
  createRateLimitMiddleware,
  loadRateLimitConfig,
} from "../../../src/http/middleware/rate-limit.js";
import { createAuthMiddleware } from "../../../src/auth/middleware.js";
import type {
  TokenService,
  TokenMetadata,
  TokenValidationResult,
  TokenListItem,
  GeneratedToken,
  GenerateTokenParams,
} from "../../../src/auth/types.js";
import { initializeLogger } from "../../../src/logging/index.js";

/**
 * Initialize logger for tests
 * This is a helper function to ensure logger is initialized before any middleware is created
 */
function ensureLoggerInitialized(): void {
  try {
    initializeLogger({ level: "silent", format: "json" });
  } catch {
    // Logger already initialized by another test file, ignore
  }
}

/**
 * Create a mock token service for testing
 */
function createMockTokenService(adminScopes: boolean = false): TokenService {
  const scopes: ("read" | "write" | "admin")[] = adminScopes
    ? ["read", "write", "admin"]
    : ["read", "write"];

  const metadata: TokenMetadata = {
    name: "Test Token",
    createdAt: new Date().toISOString(),
    expiresAt: null,
    scopes,
    instanceAccess: ["public"],
    useCount: 0,
  };

  return {
    generateToken: async (_params: GenerateTokenParams): Promise<GeneratedToken> => ({
      rawToken: "pk_mcp_test_token_12345678901234",
      tokenHash: "a".repeat(64),
      metadata,
    }),
    validateToken: async (rawToken: string): Promise<TokenValidationResult> => {
      if (rawToken.startsWith("pk_mcp_")) {
        return { valid: true, metadata };
      }
      return { valid: false, reason: "invalid" };
    },
    revokeToken: async () => true,
    listTokens: async (): Promise<TokenListItem[]> => [],
    hasScopes: async (_rawToken: string, requiredScopes: string[]) => {
      return requiredScopes.every((s) => scopes.includes(s as "read" | "write" | "admin"));
    },
    hasInstanceAccess: async () => true,
    deleteToken: async () => true,
    findTokenByName: async () => undefined,
    findTokenByHashPrefix: async () => [],
    listAllTokens: async () => [],
  };
}

/**
 * Create a test Express app with rate limiting
 */
function createTestApp(
  options: {
    readPerMinute?: number;
    writePerMinute?: number;
    adminBypass?: boolean;
    withAuth?: boolean;
    adminScopes?: boolean;
  } = {}
): Express {
  // Ensure logger is initialized before creating middleware
  ensureLoggerInitialized();

  const app = express();

  // Add JSON parsing
  app.use(express.json());

  // Add authentication if requested
  if (options.withAuth) {
    const tokenService = createMockTokenService(options.adminScopes);
    const { authenticateRequest } = createAuthMiddleware(tokenService);
    app.use(authenticateRequest);
  }

  // Add rate limiting
  const rateLimitConfig = {
    enabled: true,
    readLimits: {
      perMinute: options.readPerMinute ?? 5,
      perHour: 1000,
    },
    writeLimits: {
      perMinute: options.writePerMinute ?? 3,
      perHour: 500,
    },
    adminBypass: options.adminBypass ?? true,
  };

  const rateLimitMiddleware = createRateLimitMiddleware(rateLimitConfig);
  if (rateLimitMiddleware) {
    app.use(rateLimitMiddleware);
  }

  // Test endpoints
  app.get("/test", (_req, res) => {
    res.json({ message: "GET success" });
  });

  app.post("/test", (_req, res) => {
    res.json({ message: "POST success" });
  });

  app.put("/test", (_req, res) => {
    res.json({ message: "PUT success" });
  });

  return app;
}

/**
 * Start server and return it with the port
 */
async function startServer(app: Express): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ server, port });
    });
  });
}

/**
 * Stop server
 */
async function stopServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

describe("Rate Limiting Integration", () => {
  describe("Without Authentication", () => {
    let app: Express;
    let server: Server;
    let port: number;

    beforeAll(async () => {
      app = createTestApp({
        readPerMinute: 3,
        writePerMinute: 2,
        withAuth: false,
      });
      const result = await startServer(app);
      server = result.server;
      port = result.port;
    });

    afterAll(async () => {
      await stopServer(server);
    });

    it("should allow requests within rate limit", async () => {
      const response = await fetch(`http://127.0.0.1:${port}/test`);

      expect(response.status).toBe(200);
      const data = (await response.json()) as { message: string };
      expect(data.message).toBe("GET success");
    });

    it("should include rate limit headers in response", async () => {
      const response = await fetch(`http://127.0.0.1:${port}/test`);

      expect(response.status).toBe(200);
      // Check for either standard or legacy headers
      const hasRateLimitHeaders =
        response.headers.has("ratelimit-limit") ||
        response.headers.has("x-ratelimit-limit") ||
        response.headers.has("RateLimit-Limit");

      expect(hasRateLimitHeaders).toBe(true);
    });

    it("should return 429 when rate limit is exceeded", async () => {
      // Create a new server for this test to avoid interference
      const testApp = createTestApp({
        readPerMinute: 1,
        withAuth: false,
      });
      const { server: testServer, port: testPort } = await startServer(testApp);

      try {
        // First request should succeed
        const response1 = await fetch(`http://127.0.0.1:${testPort}/test`);
        expect(response1.status).toBe(200);

        // Second request should be rate limited
        const response2 = await fetch(`http://127.0.0.1:${testPort}/test`);
        expect(response2.status).toBe(429);

        // Verify error response structure
        const data = (await response2.json()) as { error: { code: string; retryAfter: number } };
        expect(data.error).toBeDefined();
        expect(data.error.code).toBe("RATE_LIMIT_EXCEEDED");
        expect(data.error.retryAfter).toBeGreaterThan(0);
      } finally {
        await stopServer(testServer);
      }
    });

    it("should include Retry-After header in 429 response", async () => {
      // Create a new server for this test
      const testApp = createTestApp({
        readPerMinute: 1,
        withAuth: false,
      });
      const { server: testServer, port: testPort } = await startServer(testApp);

      try {
        // First request
        await fetch(`http://127.0.0.1:${testPort}/test`);

        // Second request should be rate limited
        const response = await fetch(`http://127.0.0.1:${testPort}/test`);
        expect(response.status).toBe(429);
        expect(response.headers.has("retry-after")).toBe(true);
      } finally {
        await stopServer(testServer);
      }
    });

    it("should apply different limits for read vs write operations", async () => {
      // Create a new server with different limits
      const testApp = createTestApp({
        readPerMinute: 10,
        writePerMinute: 1,
        withAuth: false,
      });
      const { server: testServer, port: testPort } = await startServer(testApp);

      try {
        // First POST should succeed
        const post1 = await fetch(`http://127.0.0.1:${testPort}/test`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        expect(post1.status).toBe(200);

        // Second POST should be rate limited
        const post2 = await fetch(`http://127.0.0.1:${testPort}/test`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        expect(post2.status).toBe(429);

        // GET should still work (different limit)
        const get = await fetch(`http://127.0.0.1:${testPort}/test`);
        expect(get.status).toBe(200);
      } finally {
        await stopServer(testServer);
      }
    });
  });

  describe("With Authentication", () => {
    it("should use per-token rate limiting", async () => {
      const testApp = createTestApp({
        readPerMinute: 1,
        withAuth: true,
        adminScopes: false,
      });
      const { server: testServer, port: testPort } = await startServer(testApp);

      try {
        const tokenA = "pk_mcp_token_a_12345678901234";
        const tokenB = "pk_mcp_token_b_12345678901234";

        // Token A first request
        const responseA1 = await fetch(`http://127.0.0.1:${testPort}/test`, {
          headers: { Authorization: `Bearer ${tokenA}` },
        });
        expect(responseA1.status).toBe(200);

        // Token A second request - should be rate limited
        const responseA2 = await fetch(`http://127.0.0.1:${testPort}/test`, {
          headers: { Authorization: `Bearer ${tokenA}` },
        });
        expect(responseA2.status).toBe(429);

        // Token B first request - should succeed (separate counter)
        const responseB1 = await fetch(`http://127.0.0.1:${testPort}/test`, {
          headers: { Authorization: `Bearer ${tokenB}` },
        });
        expect(responseB1.status).toBe(200);
      } finally {
        await stopServer(testServer);
      }
    });

    it("should bypass rate limits for admin tokens when enabled", async () => {
      const testApp = createTestApp({
        readPerMinute: 1,
        withAuth: true,
        adminScopes: true,
        adminBypass: true,
      });
      const { server: testServer, port: testPort } = await startServer(testApp);

      try {
        const adminToken = "pk_mcp_admin_token_123456789";

        // Multiple requests should all succeed due to admin bypass
        for (let i = 0; i < 5; i++) {
          const response = await fetch(`http://127.0.0.1:${testPort}/test`, {
            headers: { Authorization: `Bearer ${adminToken}` },
          });
          expect(response.status).toBe(200);
        }
      } finally {
        await stopServer(testServer);
      }
    });

    it("should NOT bypass rate limits for admin tokens when disabled", async () => {
      const testApp = createTestApp({
        readPerMinute: 1,
        withAuth: true,
        adminScopes: true,
        adminBypass: false,
      });
      const { server: testServer, port: testPort } = await startServer(testApp);

      try {
        const adminToken = "pk_mcp_admin_no_bypass_123";

        // First request should succeed
        const response1 = await fetch(`http://127.0.0.1:${testPort}/test`, {
          headers: { Authorization: `Bearer ${adminToken}` },
        });
        expect(response1.status).toBe(200);

        // Second request should be rate limited even for admin
        const response2 = await fetch(`http://127.0.0.1:${testPort}/test`, {
          headers: { Authorization: `Bearer ${adminToken}` },
        });
        expect(response2.status).toBe(429);
      } finally {
        await stopServer(testServer);
      }
    });
  });

  describe("Rate Limit Configuration", () => {
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
      // Ensure logger is initialized for middleware creation
      ensureLoggerInitialized();

      for (const key of envVars) {
        originalEnv[key] = Bun.env[key];
        delete Bun.env[key];
      }
    });

    afterEach(() => {
      for (const key of envVars) {
        if (originalEnv[key] === undefined) {
          delete Bun.env[key];
        } else {
          Bun.env[key] = originalEnv[key];
        }
      }
    });

    it("should load configuration from environment variables", () => {
      Bun.env["RATE_LIMIT_ENABLED"] = "true";
      Bun.env["RATE_LIMIT_READ_PER_MINUTE"] = "120";
      Bun.env["RATE_LIMIT_READ_PER_HOUR"] = "2000";
      Bun.env["RATE_LIMIT_WRITE_PER_MINUTE"] = "60";
      Bun.env["RATE_LIMIT_WRITE_PER_HOUR"] = "1000";
      Bun.env["RATE_LIMIT_ADMIN_BYPASS"] = "false";

      const config = loadRateLimitConfig();

      expect(config.enabled).toBe(true);
      expect(config.readLimits.perMinute).toBe(120);
      expect(config.readLimits.perHour).toBe(2000);
      expect(config.writeLimits.perMinute).toBe(60);
      expect(config.writeLimits.perHour).toBe(1000);
      expect(config.adminBypass).toBe(false);
    });

    it("should disable rate limiting when RATE_LIMIT_ENABLED=false", () => {
      Bun.env["RATE_LIMIT_ENABLED"] = "false";

      const config = loadRateLimitConfig();
      const middleware = createRateLimitMiddleware(config);

      expect(config.enabled).toBe(false);
      expect(middleware).toBeNull();
    });
  });
});
