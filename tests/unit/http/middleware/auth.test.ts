/**
 * Authentication Middleware Unit Tests
 *
 * Tests for authenticateRequest, requireScope, and requireInstanceAccess middleware.
 *
 * @module tests/unit/http/middleware/auth
 */

import { describe, it, expect, mock } from "bun:test";
import type { Request, Response } from "express";
import { createAuthMiddleware } from "../../../../src/auth/middleware.js";
import type {
  TokenService,
  TokenValidationResult,
  TokenMetadata,
} from "../../../../src/auth/types.js";

// Mock logger to avoid console output during tests
void mock.module("../../../../src/logging/index.js", () => ({
  getComponentLogger: () => ({
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  }),
}));

/**
 * Helper type for mock function with calls tracking
 */
type MockFn = ReturnType<typeof mock> & {
  mock: { calls: unknown[][] };
};

/**
 * Get the first argument passed to the mock function
 */
function getFirstCallArg(mockFn: MockFn): unknown {
  const calls = mockFn.mock.calls;
  if (calls.length === 0 || !calls[0]) {
    throw new Error("Mock was not called");
  }
  return calls[0][0];
}

/**
 * Create a mock Request object
 */
function createMockRequest(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    method: "GET",
    path: "/test",
    ...overrides,
  } as Request;
}

/**
 * Create a mock Response object
 */
function createMockResponse(): Response {
  return {
    status: mock(() => ({ json: mock(() => {}) })),
    json: mock(() => {}),
  } as unknown as Response;
}

/**
 * Create a mock TokenService
 */
function createMockTokenService(overrides: Partial<TokenService> = {}): TokenService {
  return {
    generateToken: mock(() =>
      Promise.resolve({
        rawToken: "pk_mcp_test",
        tokenHash: "a".repeat(64),
        metadata: {} as TokenMetadata,
      })
    ),
    validateToken: mock(() => Promise.resolve({ valid: false, reason: "not_found" })),
    revokeToken: mock(() => Promise.resolve(true)),
    listTokens: mock(() => Promise.resolve([])),
    hasScopes: mock(() => Promise.resolve(false)),
    hasInstanceAccess: mock(() => Promise.resolve(false)),
    deleteToken: mock(() => Promise.resolve(true)),
    ...overrides,
  } as TokenService;
}

/**
 * Create valid token metadata for testing
 */
function createValidTokenMetadata(): TokenMetadata {
  return {
    name: "Test Token",
    createdAt: new Date().toISOString(),
    expiresAt: null,
    scopes: ["read"],
    instanceAccess: ["public"],
    useCount: 0,
  };
}

describe("Authentication Middleware", () => {
  describe("authenticateRequest", () => {
    it("should return 401 MISSING_AUTHORIZATION when Authorization header is missing", async () => {
      const tokenService = createMockTokenService();
      const { authenticateRequest } = createAuthMiddleware(tokenService);

      const req = createMockRequest({ headers: {} });
      const res = createMockResponse();
      const next = mock(() => {}) as MockFn;

      await authenticateRequest(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      const error = getFirstCallArg(next) as { statusCode: number; code: string };
      expect(error).toBeDefined();
      expect(error.statusCode).toBe(401);
      expect(error.code).toBe("MISSING_AUTHORIZATION");
    });

    it("should return 401 INVALID_AUTHORIZATION_FORMAT for malformed header", async () => {
      const tokenService = createMockTokenService();
      const { authenticateRequest } = createAuthMiddleware(tokenService);

      const req = createMockRequest({
        headers: { authorization: "InvalidFormat" },
      });
      const res = createMockResponse();
      const next = mock(() => {}) as MockFn;

      await authenticateRequest(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      const error = getFirstCallArg(next) as { statusCode: number; code: string };
      expect(error).toBeDefined();
      expect(error.statusCode).toBe(401);
      expect(error.code).toBe("INVALID_AUTHORIZATION_FORMAT");
    });

    it("should return 401 INVALID_AUTHORIZATION_FORMAT for non-Bearer scheme", async () => {
      const tokenService = createMockTokenService();
      const { authenticateRequest } = createAuthMiddleware(tokenService);

      const req = createMockRequest({
        headers: { authorization: "Basic dXNlcjpwYXNz" },
      });
      const res = createMockResponse();
      const next = mock(() => {}) as MockFn;

      await authenticateRequest(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      const error = getFirstCallArg(next) as { statusCode: number; code: string };
      expect(error).toBeDefined();
      expect(error.statusCode).toBe(401);
      expect(error.code).toBe("INVALID_AUTHORIZATION_FORMAT");
    });

    it("should return 401 INVALID_TOKEN for invalid token", async () => {
      const tokenService = createMockTokenService({
        validateToken: mock(() =>
          Promise.resolve({ valid: false, reason: "invalid" } as TokenValidationResult)
        ),
      });
      const { authenticateRequest } = createAuthMiddleware(tokenService);

      const req = createMockRequest({
        headers: { authorization: "Bearer pk_mcp_invalidtoken123456789012" },
      });
      const res = createMockResponse();
      const next = mock(() => {}) as MockFn;

      await authenticateRequest(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      const error = getFirstCallArg(next) as { statusCode: number; code: string };
      expect(error).toBeDefined();
      expect(error.statusCode).toBe(401);
      expect(error.code).toBe("INVALID_TOKEN");
    });

    it("should return 401 TOKEN_EXPIRED for expired token", async () => {
      const tokenService = createMockTokenService({
        validateToken: mock(() =>
          Promise.resolve({ valid: false, reason: "expired" } as TokenValidationResult)
        ),
      });
      const { authenticateRequest } = createAuthMiddleware(tokenService);

      const req = createMockRequest({
        headers: { authorization: "Bearer pk_mcp_expiredtoken12345678901" },
      });
      const res = createMockResponse();
      const next = mock(() => {}) as MockFn;

      await authenticateRequest(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      const error = getFirstCallArg(next) as { statusCode: number; code: string };
      expect(error).toBeDefined();
      expect(error.statusCode).toBe(401);
      expect(error.code).toBe("TOKEN_EXPIRED");
    });

    it("should return 401 TOKEN_REVOKED for revoked token", async () => {
      const tokenService = createMockTokenService({
        validateToken: mock(() =>
          Promise.resolve({ valid: false, reason: "revoked" } as TokenValidationResult)
        ),
      });
      const { authenticateRequest } = createAuthMiddleware(tokenService);

      const req = createMockRequest({
        headers: { authorization: "Bearer pk_mcp_revokedtoken12345678901" },
      });
      const res = createMockResponse();
      const next = mock(() => {}) as MockFn;

      await authenticateRequest(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      const error = getFirstCallArg(next) as { statusCode: number; code: string };
      expect(error).toBeDefined();
      expect(error.statusCode).toBe(401);
      expect(error.code).toBe("TOKEN_REVOKED");
    });

    it("should attach token metadata and call next() for valid token", async () => {
      const metadata = createValidTokenMetadata();
      const tokenService = createMockTokenService({
        validateToken: mock(() =>
          Promise.resolve({ valid: true, metadata } as TokenValidationResult)
        ),
      });
      const { authenticateRequest } = createAuthMiddleware(tokenService);

      const req = createMockRequest({
        headers: { authorization: "Bearer pk_mcp_validtoken123456789012" },
      });
      const res = createMockResponse();
      const next = mock(() => {}) as MockFn;

      await authenticateRequest(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      // Successful authentication calls next without arguments
      const nextArg = getFirstCallArg(next);
      expect(nextArg).toBeUndefined();
      expect(req.tokenMetadata).toEqual(metadata);
      expect(req.rawToken).toBe("pk_mcp_validtoken123456789012");
    });

    it("should handle case-insensitive Bearer scheme", async () => {
      const metadata = createValidTokenMetadata();
      const tokenService = createMockTokenService({
        validateToken: mock(() =>
          Promise.resolve({ valid: true, metadata } as TokenValidationResult)
        ),
      });
      const { authenticateRequest } = createAuthMiddleware(tokenService);

      const req = createMockRequest({
        headers: { authorization: "BEARER pk_mcp_validtoken123456789012" },
      });
      const res = createMockResponse();
      const next = mock(() => {}) as MockFn;

      await authenticateRequest(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      const nextArg = getFirstCallArg(next);
      expect(nextArg).toBeUndefined();
    });
  });

  describe("requireScope", () => {
    it("should return 401 MISSING_AUTHENTICATION when not authenticated", async () => {
      const tokenService = createMockTokenService();
      const { requireScope } = createAuthMiddleware(tokenService);
      const scopeMiddleware = requireScope("read");

      const req = createMockRequest(); // No tokenMetadata attached
      const res = createMockResponse();
      const next = mock(() => {}) as MockFn;

      await scopeMiddleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      const error = getFirstCallArg(next) as { statusCode: number; code: string };
      expect(error).toBeDefined();
      expect(error.statusCode).toBe(401);
      expect(error.code).toBe("MISSING_AUTHENTICATION");
    });

    it("should return 403 INSUFFICIENT_SCOPE when token lacks required scope", async () => {
      const tokenService = createMockTokenService({
        hasScopes: mock(() => Promise.resolve(false)),
      });
      const { requireScope } = createAuthMiddleware(tokenService);
      const scopeMiddleware = requireScope("admin");

      const req = createMockRequest();
      req.tokenMetadata = createValidTokenMetadata();
      req.rawToken = "pk_mcp_validtoken123456789012";
      const res = createMockResponse();
      const next = mock(() => {}) as MockFn;

      await scopeMiddleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      const error = getFirstCallArg(next) as { statusCode: number; code: string };
      expect(error).toBeDefined();
      expect(error.statusCode).toBe(403);
      expect(error.code).toBe("INSUFFICIENT_SCOPE");
    });

    it("should call next() when token has required scope", async () => {
      const tokenService = createMockTokenService({
        hasScopes: mock(() => Promise.resolve(true)),
      });
      const { requireScope } = createAuthMiddleware(tokenService);
      const scopeMiddleware = requireScope("read");

      const req = createMockRequest();
      req.tokenMetadata = createValidTokenMetadata();
      req.rawToken = "pk_mcp_validtoken123456789012";
      const res = createMockResponse();
      const next = mock(() => {}) as MockFn;

      await scopeMiddleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      const nextArg = getFirstCallArg(next);
      expect(nextArg).toBeUndefined();
    });
  });

  describe("requireInstanceAccess", () => {
    it("should return 401 MISSING_AUTHENTICATION when not authenticated", async () => {
      const tokenService = createMockTokenService();
      const { requireInstanceAccess } = createAuthMiddleware(tokenService);
      const instanceMiddleware = requireInstanceAccess("public");

      const req = createMockRequest(); // No tokenMetadata attached
      const res = createMockResponse();
      const next = mock(() => {}) as MockFn;

      await instanceMiddleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      const error = getFirstCallArg(next) as { statusCode: number; code: string };
      expect(error).toBeDefined();
      expect(error.statusCode).toBe(401);
      expect(error.code).toBe("MISSING_AUTHENTICATION");
    });

    it("should return 403 UNAUTHORIZED_INSTANCE when token lacks instance access", async () => {
      const tokenService = createMockTokenService({
        hasInstanceAccess: mock(() => Promise.resolve(false)),
      });
      const { requireInstanceAccess } = createAuthMiddleware(tokenService);
      const instanceMiddleware = requireInstanceAccess("private");

      const req = createMockRequest();
      req.tokenMetadata = createValidTokenMetadata();
      req.rawToken = "pk_mcp_validtoken123456789012";
      const res = createMockResponse();
      const next = mock(() => {}) as MockFn;

      await instanceMiddleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      const error = getFirstCallArg(next) as { statusCode: number; code: string };
      expect(error).toBeDefined();
      expect(error.statusCode).toBe(403);
      expect(error.code).toBe("UNAUTHORIZED_INSTANCE");
    });

    it("should call next() when token has instance access", async () => {
      const tokenService = createMockTokenService({
        hasInstanceAccess: mock(() => Promise.resolve(true)),
      });
      const { requireInstanceAccess } = createAuthMiddleware(tokenService);
      const instanceMiddleware = requireInstanceAccess("public");

      const req = createMockRequest();
      req.tokenMetadata = createValidTokenMetadata();
      req.rawToken = "pk_mcp_validtoken123456789012";
      const res = createMockResponse();
      const next = mock(() => {}) as MockFn;

      await instanceMiddleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      const nextArg = getFirstCallArg(next);
      expect(nextArg).toBeUndefined();
    });
  });

  describe("createAuthMiddleware", () => {
    it("should return all three middleware functions", () => {
      const tokenService = createMockTokenService();
      const middleware = createAuthMiddleware(tokenService);

      expect(middleware).toHaveProperty("authenticateRequest");
      expect(middleware).toHaveProperty("requireScope");
      expect(middleware).toHaveProperty("requireInstanceAccess");
      expect(typeof middleware.authenticateRequest).toBe("function");
      expect(typeof middleware.requireScope).toBe("function");
      expect(typeof middleware.requireInstanceAccess).toBe("function");
    });
  });
});
