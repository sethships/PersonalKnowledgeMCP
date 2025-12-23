/**
 * Authentication Middleware Integration Tests
 *
 * Tests the complete authentication flow including:
 * - Health endpoint accessibility without auth
 * - Protected endpoint authentication requirements
 * - Token validation and error responses
 * - Scope and instance access enforcement
 */

import { describe, test, expect, beforeAll, afterAll, mock } from "bun:test";
import { initializeLogger } from "../../../src/logging/index.js";
import { createHttpApp, startHttpServer } from "../../../src/http/index.js";
import type { HttpTransportConfig } from "../../../src/mcp/types.js";
import type { HttpServerInstance } from "../../../src/http/types.js";
import type { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import type {
  TokenService,
  TokenValidationResult,
  TokenMetadata,
  GenerateTokenParams,
  GeneratedToken,
} from "../../../src/auth/types.js";

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

/**
 * Create valid token metadata for testing
 */
function createValidTokenMetadata(overrides: Partial<TokenMetadata> = {}): TokenMetadata {
  return {
    name: "Test Token",
    createdAt: new Date().toISOString(),
    expiresAt: null,
    scopes: ["read", "write"],
    instanceAccess: ["public"],
    useCount: 0,
    ...overrides,
  };
}

/**
 * Create a mock TokenService with configurable behavior
 */
function createMockTokenService(
  config: {
    validTokens?: Map<string, TokenMetadata>;
    expiredTokens?: Set<string>;
    revokedTokens?: Set<string>;
  } = {}
): TokenService {
  const {
    validTokens = new Map([["pk_mcp_validtoken123456789012345", createValidTokenMetadata()]]),
    expiredTokens = new Set<string>(),
    revokedTokens = new Set<string>(),
  } = config;

  return {
    generateToken: mock(async (params: GenerateTokenParams): Promise<GeneratedToken> => {
      const rawToken = "pk_mcp_newtoken12345678901234567";
      const metadata: TokenMetadata = {
        name: params.name,
        createdAt: new Date().toISOString(),
        expiresAt: params.expiresInSeconds
          ? new Date(Date.now() + params.expiresInSeconds * 1000).toISOString()
          : null,
        scopes: params.scopes ?? ["read"],
        instanceAccess: params.instanceAccess ?? ["public"],
        useCount: 0,
      };
      return { rawToken, tokenHash: "a".repeat(64), metadata };
    }),

    validateToken: mock(async (rawToken: string): Promise<TokenValidationResult> => {
      if (expiredTokens.has(rawToken)) {
        return { valid: false, reason: "expired" };
      }
      if (revokedTokens.has(rawToken)) {
        return { valid: false, reason: "revoked" };
      }
      const metadata = validTokens.get(rawToken);
      if (metadata) {
        return { valid: true, metadata };
      }
      return { valid: false, reason: "not_found" };
    }),

    revokeToken: mock(async (): Promise<boolean> => true),

    listTokens: mock(async () => []),

    hasScopes: mock(async (rawToken: string, scopes: string[]): Promise<boolean> => {
      const metadata = validTokens.get(rawToken);
      if (!metadata) return false;
      return scopes.every((scope) => metadata.scopes.includes(scope as never));
    }),

    hasInstanceAccess: mock(async (rawToken: string, instances: string[]): Promise<boolean> => {
      const metadata = validTokens.get(rawToken);
      if (!metadata) return false;
      return instances.every((instance) => metadata.instanceAccess.includes(instance as never));
    }),

    deleteToken: mock(async (): Promise<boolean> => true),
  };
}

describe("Authentication Middleware Integration", () => {
  const port = 3098; // Use a different port than other integration tests
  let serverInstance: HttpServerInstance | null = null;
  let baseUrl: string;

  // Valid test token
  const validToken = "pk_mcp_validtoken123456789012345";
  const expiredToken = "pk_mcp_expiredtoken12345678901234";
  const revokedToken = "pk_mcp_revokedtoken12345678901234";

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

  // Create token service with test tokens
  const tokenService = createMockTokenService({
    validTokens: new Map([
      [
        validToken,
        createValidTokenMetadata({ scopes: ["read", "write"], instanceAccess: ["public", "work"] }),
      ],
    ]),
    expiredTokens: new Set([expiredToken]),
    revokedTokens: new Set([revokedToken]),
  });

  beforeAll(async () => {
    const app = createHttpApp({
      createServerForSse: mockCreateServerForSse,
      createServerForStreamableHttp: mockCreateServerForStreamableHttp,
      checkChromaDb: mockCheckChromaDb,
      tokenService,
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

  describe("Health Endpoint (Unauthenticated)", () => {
    test("should allow access without authentication", async () => {
      const response = await fetch(`${baseUrl}/health`);
      expect(response.status).toBe(200);

      const data = (await response.json()) as HealthResponse;
      expect(data.status).toBe("healthy");
      expect(data.checks.chromadb).toBe("connected");
    });

    test("should allow access with invalid token (health is public)", async () => {
      const response = await fetch(`${baseUrl}/health`, {
        headers: {
          Authorization: "Bearer invalid_token",
        },
      });
      expect(response.status).toBe(200);
    });
  });

  describe("Protected Endpoints - Authentication Required", () => {
    test("should return 401 MISSING_AUTHORIZATION without Authorization header", async () => {
      const response = await fetch(`${baseUrl}/api/v1/sse`);
      expect(response.status).toBe(401);

      const data = (await response.json()) as ErrorResponse;
      expect(data.error.code).toBe("MISSING_AUTHORIZATION");
      expect(data.error.statusCode).toBe(401);
    });

    test("should return 401 INVALID_AUTHORIZATION_FORMAT for malformed header", async () => {
      const response = await fetch(`${baseUrl}/api/v1/sse`, {
        headers: {
          Authorization: "NotBearer token123",
        },
      });
      expect(response.status).toBe(401);

      const data = (await response.json()) as ErrorResponse;
      expect(data.error.code).toBe("INVALID_AUTHORIZATION_FORMAT");
    });

    test("should return 401 INVALID_TOKEN for unknown token", async () => {
      const response = await fetch(`${baseUrl}/api/v1/sse`, {
        headers: {
          Authorization: "Bearer pk_mcp_unknowntoken1234567890123",
        },
      });
      expect(response.status).toBe(401);

      const data = (await response.json()) as ErrorResponse;
      expect(data.error.code).toBe("INVALID_TOKEN");
    });

    test("should return 401 TOKEN_EXPIRED for expired token", async () => {
      const response = await fetch(`${baseUrl}/api/v1/sse`, {
        headers: {
          Authorization: `Bearer ${expiredToken}`,
        },
      });
      expect(response.status).toBe(401);

      const data = (await response.json()) as ErrorResponse;
      expect(data.error.code).toBe("TOKEN_EXPIRED");
    });

    test("should return 401 TOKEN_REVOKED for revoked token", async () => {
      const response = await fetch(`${baseUrl}/api/v1/sse`, {
        headers: {
          Authorization: `Bearer ${revokedToken}`,
        },
      });
      expect(response.status).toBe(401);

      const data = (await response.json()) as ErrorResponse;
      expect(data.error.code).toBe("TOKEN_REVOKED");
    });

    test("should allow access with valid token", async () => {
      // SSE endpoint returns a streaming response, so we just check it doesn't return 401/403
      const response = await fetch(`${baseUrl}/api/v1/sse`, {
        headers: {
          Authorization: `Bearer ${validToken}`,
        },
      });
      // SSE endpoints return 200 with streaming response or we get past auth
      // The exact status depends on the SSE handler, but it should NOT be 401 or 403
      expect(response.status).not.toBe(401);
      expect(response.status).not.toBe(403);
    });
  });

  describe("Error Response Format", () => {
    test("should return consistent error format for 401 errors", async () => {
      const response = await fetch(`${baseUrl}/api/v1/sse`);
      expect(response.status).toBe(401);

      const data = (await response.json()) as ErrorResponse;

      // Verify error structure matches expected format
      expect(data).toHaveProperty("error");
      expect(data.error).toHaveProperty("message");
      expect(data.error).toHaveProperty("code");
      expect(data.error).toHaveProperty("statusCode");

      // Verify types
      expect(typeof data.error.message).toBe("string");
      expect(typeof data.error.code).toBe("string");
      expect(typeof data.error.statusCode).toBe("number");
    });

    test("should include descriptive error messages", async () => {
      const response = await fetch(`${baseUrl}/api/v1/sse`, {
        headers: {
          Authorization: "Basic dXNlcjpwYXNz",
        },
      });

      const data = (await response.json()) as ErrorResponse;
      expect(data.error.message).toContain("Bearer");
    });
  });

  describe("Streamable HTTP Endpoint Authentication", () => {
    test("should require authentication for streamable HTTP endpoint", async () => {
      const response = await fetch(`${baseUrl}/api/v1/mcp`, {
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

      expect(response.status).toBe(401);
      const data = (await response.json()) as ErrorResponse;
      expect(data.error.code).toBe("MISSING_AUTHORIZATION");
    });

    test("should allow authenticated access to streamable HTTP endpoint", async () => {
      const response = await fetch(`${baseUrl}/api/v1/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${validToken}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "test-client", version: "1.0.0" },
          },
          id: 1,
        }),
      });

      // Should get past authentication - exact response depends on MCP handler
      expect(response.status).not.toBe(401);
      expect(response.status).not.toBe(403);
    });
  });

  describe("Case Insensitive Bearer Scheme", () => {
    test("should accept lowercase bearer", async () => {
      const response = await fetch(`${baseUrl}/api/v1/sse`, {
        headers: {
          Authorization: `bearer ${validToken}`,
        },
      });
      expect(response.status).not.toBe(401);
      expect(response.status).not.toBe(403);
    });

    test("should accept uppercase BEARER", async () => {
      const response = await fetch(`${baseUrl}/api/v1/sse`, {
        headers: {
          Authorization: `BEARER ${validToken}`,
        },
      });
      expect(response.status).not.toBe(401);
      expect(response.status).not.toBe(403);
    });

    test("should accept mixed case BeArEr", async () => {
      const response = await fetch(`${baseUrl}/api/v1/sse`, {
        headers: {
          Authorization: `BeArEr ${validToken}`,
        },
      });
      expect(response.status).not.toBe(401);
      expect(response.status).not.toBe(403);
    });
  });

  describe("Server Without TokenService (Backward Compatibility)", () => {
    let noAuthServerInstance: HttpServerInstance | null = null;
    let noAuthBaseUrl: string;
    const noAuthPort = 3097;

    beforeAll(async () => {
      // Create server without tokenService - should not require auth
      const app = createHttpApp({
        createServerForSse: mockCreateServerForSse,
        createServerForStreamableHttp: mockCreateServerForStreamableHttp,
        checkChromaDb: mockCheckChromaDb,
        // Note: tokenService not provided
      });

      const config: HttpTransportConfig = {
        enabled: true,
        port: noAuthPort,
        host: "127.0.0.1",
      };

      noAuthServerInstance = await startHttpServer(app, config);
      noAuthBaseUrl = `http://${noAuthServerInstance.host}:${noAuthServerInstance.port}`;
    });

    afterAll(async () => {
      if (noAuthServerInstance) {
        await noAuthServerInstance.close();
      }
    });

    test("should allow unauthenticated access when tokenService not configured", async () => {
      // SSE endpoint should be accessible without auth when no tokenService
      const response = await fetch(`${noAuthBaseUrl}/api/v1/sse`);
      // Should NOT get 401 - authentication is disabled
      expect(response.status).not.toBe(401);
    });

    test("should still serve health endpoint", async () => {
      const response = await fetch(`${noAuthBaseUrl}/health`);
      expect(response.status).toBe(200);
    });
  });
});
