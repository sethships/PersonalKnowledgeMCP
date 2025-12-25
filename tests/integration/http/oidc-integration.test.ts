/**
 * OIDC Integration Tests
 *
 * End-to-end tests for OIDC authentication flow using mocked openid-client.
 * Tests the complete flow from authorization to callback to session management.
 *
 * @module tests/integration/http/oidc-integration
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, mock } from "bun:test";
import { join } from "path";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import express from "express";
import cookieParser from "cookie-parser";
import type { Server } from "http";
import type { OidcConfig } from "../../../src/auth/oidc/oidc-types.js";
import { OIDC_SESSION_COOKIE } from "../../../src/auth/oidc/oidc-types.js";
import { OidcProviderImpl } from "../../../src/auth/oidc/oidc-provider.js";
import { OidcSessionStoreImpl } from "../../../src/auth/oidc/oidc-session-store.js";
import { createOidcRouter } from "../../../src/http/routes/oidc.js";
import { initializeLogger, resetLogger } from "../../../src/logging/index.js";

/**
 * Mock OIDC Server
 *
 * Simulates an OIDC identity provider for integration testing.
 * Provides mock implementations for discovery, token exchange, and userinfo.
 */
class MockOidcServer {
  private mockDiscovery: ReturnType<typeof mock>;
  private mockCodeGrant: ReturnType<typeof mock>;
  private mockRefreshGrant: ReturnType<typeof mock>;
  private mockFetchUserInfo: ReturnType<typeof mock>;
  private mockBuildAuthUrl: ReturnType<typeof mock>;
  private mockRandomPKCE: ReturnType<typeof mock>;
  private mockCalculatePKCE: ReturnType<typeof mock>;
  private mockRandomState: ReturnType<typeof mock>;

  private mockConfig = {
    serverMetadata: () => ({
      issuer: "https://mock-idp.example.com/",
      authorization_endpoint: "https://mock-idp.example.com/authorize",
      token_endpoint: "https://mock-idp.example.com/token",
      userinfo_endpoint: "https://mock-idp.example.com/userinfo",
    }),
  };

  constructor() {
    // Mock all openid-client functions
    this.mockDiscovery = mock(() => Promise.resolve(this.mockConfig));
    this.mockCodeGrant = mock(() =>
      Promise.resolve({
        access_token: "mock-access-token",
        refresh_token: "mock-refresh-token",
        id_token: "mock-id-token",
        expires_in: 3600,
        claims: () => ({ sub: "mock-user-123", email: "test@example.com", name: "Test User" }),
      })
    );
    this.mockRefreshGrant = mock(() =>
      Promise.resolve({
        access_token: "new-mock-access-token",
        refresh_token: "new-mock-refresh-token",
        expires_in: 3600,
      })
    );
    this.mockFetchUserInfo = mock(() =>
      Promise.resolve({
        sub: "mock-user-123",
        email: "test@example.com",
        name: "Test User",
        picture: "https://example.com/avatar.jpg",
      })
    );
    this.mockBuildAuthUrl = mock(
      (_config: unknown, params: { state: string; code_challenge: string }) => {
        const url = new URL("https://mock-idp.example.com/authorize");
        url.searchParams.set("state", params.state);
        url.searchParams.set("code_challenge", params.code_challenge);
        return url;
      }
    );
    this.mockRandomPKCE = mock(() => "mock-pkce-code-verifier-43-chars-minimum-xxxxx");
    this.mockCalculatePKCE = mock(() => Promise.resolve("mock-code-challenge"));
    this.mockRandomState = mock(() => "mock-state-value");
  }

  /**
   * Install mocks for openid-client module
   */
  async install(): Promise<void> {
    void mock.module("openid-client", () => ({
      discovery: this.mockDiscovery,
      authorizationCodeGrant: this.mockCodeGrant,
      refreshTokenGrant: this.mockRefreshGrant,
      fetchUserInfo: this.mockFetchUserInfo,
      buildAuthorizationUrl: this.mockBuildAuthUrl,
      randomPKCECodeVerifier: this.mockRandomPKCE,
      calculatePKCECodeChallenge: this.mockCalculatePKCE,
      randomState: this.mockRandomState,
    }));
  }

  /**
   * Configure mock to fail token exchange
   */
  setTokenExchangeError(error: Error): void {
    this.mockCodeGrant.mockImplementation(() => Promise.reject(error));
  }

  /**
   * Configure mock to fail token refresh
   */
  setTokenRefreshError(error: Error): void {
    this.mockRefreshGrant.mockImplementation(() => Promise.reject(error));
  }

  /**
   * Configure mock to fail userinfo fetch
   */
  setUserInfoError(error: Error): void {
    this.mockFetchUserInfo.mockImplementation(() => Promise.reject(error));
  }

  /**
   * Reset all mocks to default behavior
   */
  reset(): void {
    this.mockDiscovery.mockReset();
    this.mockCodeGrant.mockReset();
    this.mockRefreshGrant.mockReset();
    this.mockFetchUserInfo.mockReset();

    // Restore default implementations
    this.mockDiscovery.mockImplementation(() => Promise.resolve(this.mockConfig));
    this.mockCodeGrant.mockImplementation(() =>
      Promise.resolve({
        access_token: "mock-access-token",
        refresh_token: "mock-refresh-token",
        id_token: "mock-id-token",
        expires_in: 3600,
        claims: () => ({ sub: "mock-user-123", email: "test@example.com", name: "Test User" }),
      })
    );
    this.mockRefreshGrant.mockImplementation(() =>
      Promise.resolve({
        access_token: "new-mock-access-token",
        refresh_token: "new-mock-refresh-token",
        expires_in: 3600,
      })
    );
    this.mockFetchUserInfo.mockImplementation(() =>
      Promise.resolve({
        sub: "mock-user-123",
        email: "test@example.com",
        name: "Test User",
        picture: "https://example.com/avatar.jpg",
      })
    );
  }

  /**
   * Get the state value that was used in the last auth URL
   */
  getLastState(): string {
    return "mock-state-value";
  }
}

describe("OIDC Integration Tests", () => {
  let tempDir: string;
  let sessionStore: OidcSessionStoreImpl;
  let mockOidcServer: MockOidcServer;
  let app: express.Express;
  let server: Server;
  let baseUrl: string;

  const testConfig: OidcConfig = {
    enabled: true,
    issuer: "https://mock-idp.example.com/",
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    redirectUri: "http://localhost:0/api/v1/oidc/callback",
    defaultScopes: ["read", "write"],
    defaultInstanceAccess: ["work"],
    sessionTtlSeconds: 3600,
    refreshBeforeExpirySeconds: 300,
    cookieSecure: false, // For testing over HTTP
    cookieName: "pk_mcp_oidc_session",
  };

  beforeAll(async () => {
    // Reset logger first to ensure clean state for this test file
    resetLogger();
    initializeLogger({ level: "error", format: "json" });
    tempDir = await mkdtemp(join(tmpdir(), "oidc-integration-test-"));

    // Install mock OIDC server
    mockOidcServer = new MockOidcServer();
    await mockOidcServer.install();
  });

  afterAll(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    // Reset logger at the very end to leave clean state for subsequent tests
    resetLogger();
  });

  beforeEach(async () => {
    // Reset session store singleton and mock server
    OidcSessionStoreImpl.resetInstance();
    sessionStore = OidcSessionStoreImpl.getInstance(tempDir);
    mockOidcServer.reset();

    // Create Express app with OIDC routes
    const oidcProvider = new OidcProviderImpl(testConfig, sessionStore);

    app = express();
    app.use(cookieParser());
    app.use(
      "/api/v1/oidc",
      createOidcRouter({
        oidcProvider,
        sessionStore,
      })
    );

    // Add error handler for test visibility
    app.use(
      (
        err: Error & { statusCode?: number; code?: string },
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction
      ) => {
        const status = err.statusCode || 500;
        res.status(status).json({
          error: err.message,
          code: err.code || "INTERNAL_ERROR",
        });
      }
    );

    // Start server on random port
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (addr && typeof addr === "object") {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  describe("Authorization Flow", () => {
    it("should redirect to IdP authorization endpoint on /authorize", async () => {
      const response = await fetch(`${baseUrl}/api/v1/oidc/authorize`, {
        method: "GET",
        redirect: "manual",
      });

      expect(response.status).toBe(302);
      const location = response.headers.get("location");
      expect(location).toContain("https://mock-idp.example.com/authorize");

      // Should set session cookie
      const cookies = response.headers.get("set-cookie");
      expect(cookies).toContain(OIDC_SESSION_COOKIE);
    });

    it("should store redirect_to URL during authorization", async () => {
      const response = await fetch(`${baseUrl}/api/v1/oidc/authorize?redirect_to=/dashboard`, {
        method: "GET",
        redirect: "manual",
      });

      expect(response.status).toBe(302);

      // Extract session ID from cookie and verify originalUrl was stored
      const cookies = response.headers.get("set-cookie") || "";
      const sessionMatch = cookies.match(new RegExp(`${OIDC_SESSION_COOKIE}=([^;]+)`));
      expect(sessionMatch).not.toBeNull();

      if (sessionMatch && sessionMatch[1]) {
        const sessionId = sessionMatch[1];
        const session = await sessionStore.getSession(sessionId);
        expect(session?.authFlowState?.originalUrl).toBe("/dashboard");
      }
    });

    it("should reject cross-origin redirect_to URLs", async () => {
      const response = await fetch(
        `${baseUrl}/api/v1/oidc/authorize?redirect_to=https://evil.com/phish`,
        {
          method: "GET",
          redirect: "manual",
        }
      );

      expect(response.status).toBe(302);

      // Session should NOT have originalUrl stored (cross-origin rejected)
      const cookies = response.headers.get("set-cookie") || "";
      const sessionMatch = cookies.match(new RegExp(`${OIDC_SESSION_COOKIE}=([^;]+)`));
      expect(sessionMatch).not.toBeNull();

      if (sessionMatch && sessionMatch[1]) {
        const sessionId = sessionMatch[1];
        const session = await sessionStore.getSession(sessionId);
        expect(session?.authFlowState?.originalUrl).toBeUndefined();
      }
    });
  });

  describe("Callback Flow", () => {
    it("should exchange code for tokens and redirect to original URL", async () => {
      // First, start auth flow to get session
      const authResponse = await fetch(`${baseUrl}/api/v1/oidc/authorize?redirect_to=/dashboard`, {
        method: "GET",
        redirect: "manual",
      });

      // Extract session cookie
      const cookies = authResponse.headers.get("set-cookie") || "";
      const sessionMatch = cookies.match(new RegExp(`${OIDC_SESSION_COOKIE}=([^;]+)`));
      expect(sessionMatch).not.toBeNull();
      if (!sessionMatch?.[1]) throw new Error("Session match failed");
      const sessionId = sessionMatch[1];

      // Get session to get the state value
      const session = await sessionStore.getSession(sessionId);
      expect(session?.authFlowState).toBeDefined();
      if (!session?.authFlowState) throw new Error("Session authFlowState missing");
      const state = session.authFlowState.state;

      // Now call callback with code and state
      const callbackResponse = await fetch(
        `${baseUrl}/api/v1/oidc/callback?code=mock-auth-code&state=${state}`,
        {
          method: "GET",
          redirect: "manual",
          headers: {
            Cookie: `${OIDC_SESSION_COOKIE}=${sessionId}`,
          },
        }
      );

      // Should redirect to original URL
      expect(callbackResponse.status).toBe(302);
      expect(callbackResponse.headers.get("location")).toBe("/dashboard");
    });

    it("should return JSON when no redirect_to was provided", async () => {
      // Start auth flow without redirect_to
      const authResponse = await fetch(`${baseUrl}/api/v1/oidc/authorize`, {
        method: "GET",
        redirect: "manual",
      });

      // Extract session cookie
      const cookies = authResponse.headers.get("set-cookie") || "";
      const sessionMatch = cookies.match(new RegExp(`${OIDC_SESSION_COOKIE}=([^;]+)`));
      if (!sessionMatch?.[1]) throw new Error("Session match failed");
      const sessionId = sessionMatch[1];

      // Get state from session
      const session = await sessionStore.getSession(sessionId);
      if (!session?.authFlowState) throw new Error("Session authFlowState missing");
      const state = session.authFlowState.state;

      // Call callback
      const callbackResponse = await fetch(
        `${baseUrl}/api/v1/oidc/callback?code=mock-auth-code&state=${state}`,
        {
          method: "GET",
          headers: {
            Cookie: `${OIDC_SESSION_COOKIE}=${sessionId}`,
          },
        }
      );

      expect(callbackResponse.status).toBe(200);
      const body = (await callbackResponse.json()) as { success: boolean; user: { email: string } };
      expect(body.success).toBe(true);
      expect(body.user.email).toBe("test@example.com");
    });

    it("should fail callback with mismatched state", async () => {
      // Start auth flow
      const authResponse = await fetch(`${baseUrl}/api/v1/oidc/authorize`, {
        method: "GET",
        redirect: "manual",
      });

      const cookies = authResponse.headers.get("set-cookie") || "";
      const sessionMatch = cookies.match(new RegExp(`${OIDC_SESSION_COOKIE}=([^;]+)`));
      if (!sessionMatch?.[1]) throw new Error("Session match failed");
      const sessionId = sessionMatch[1];

      // Call callback with wrong state
      const callbackResponse = await fetch(
        `${baseUrl}/api/v1/oidc/callback?code=mock-auth-code&state=wrong-state`,
        {
          method: "GET",
          headers: {
            Cookie: `${OIDC_SESSION_COOKIE}=${sessionId}`,
          },
        }
      );

      // State mismatch should return 401 or 500 (implementation-dependent error handling)
      expect(callbackResponse.status).toBeGreaterThanOrEqual(400);
    });

    it("should fail callback without session cookie", async () => {
      const callbackResponse = await fetch(
        `${baseUrl}/api/v1/oidc/callback?code=mock-auth-code&state=some-state`,
        {
          method: "GET",
        }
      );

      expect(callbackResponse.status).toBe(400);
      const body = (await callbackResponse.json()) as { code: string };
      expect(body.code).toBe("MISSING_SESSION");
    });
  });

  describe("Session Management", () => {
    /**
     * Helper to complete OIDC auth flow and return authenticated session
     */
    async function completeAuthFlow(): Promise<{ sessionId: string; cookies: string }> {
      // Start auth
      const authResponse = await fetch(`${baseUrl}/api/v1/oidc/authorize`, {
        method: "GET",
        redirect: "manual",
      });

      const cookies = authResponse.headers.get("set-cookie") || "";
      const sessionMatch = cookies.match(new RegExp(`${OIDC_SESSION_COOKIE}=([^;]+)`));
      if (!sessionMatch || !sessionMatch[1]) {
        throw new Error("Session cookie not found in response");
      }
      const sessionId = sessionMatch[1];

      const session = await sessionStore.getSession(sessionId);
      if (!session?.authFlowState) {
        throw new Error("Session or authFlowState not found");
      }
      const state = session.authFlowState.state;

      // Complete callback
      await fetch(`${baseUrl}/api/v1/oidc/callback?code=mock-auth-code&state=${state}`, {
        method: "GET",
        headers: {
          Cookie: `${OIDC_SESSION_COOKIE}=${sessionId}`,
        },
      });

      return { sessionId, cookies: `${OIDC_SESSION_COOKIE}=${sessionId}` };
    }

    it("should return user info for authenticated session", async () => {
      const { cookies } = await completeAuthFlow();

      const response = await fetch(`${baseUrl}/api/v1/oidc/userinfo`, {
        method: "GET",
        headers: { Cookie: cookies },
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as { sub: string; email: string; name: string };
      expect(body.sub).toBe("mock-user-123");
      expect(body.email).toBe("test@example.com");
      expect(body.name).toBe("Test User");
    });

    it("should fail userinfo without session", async () => {
      const response = await fetch(`${baseUrl}/api/v1/oidc/userinfo`, {
        method: "GET",
      });

      expect(response.status).toBe(401);
    });

    it("should successfully logout and clear session", async () => {
      const { sessionId, cookies } = await completeAuthFlow();

      // Verify session exists
      let session = await sessionStore.getSession(sessionId);
      expect(session).not.toBeNull();

      // Logout
      const response = await fetch(`${baseUrl}/api/v1/oidc/logout`, {
        method: "POST",
        headers: { Cookie: cookies },
      });

      expect(response.status).toBe(200);

      // Verify session is deleted
      session = await sessionStore.getSession(sessionId);
      expect(session).toBeNull();
    });
  });

  describe("Token Refresh", () => {
    it("should refresh tokens on /refresh endpoint", async () => {
      // Complete auth flow
      const authResponse = await fetch(`${baseUrl}/api/v1/oidc/authorize`, {
        method: "GET",
        redirect: "manual",
      });

      const cookies = authResponse.headers.get("set-cookie") || "";
      const sessionMatch = cookies.match(new RegExp(`${OIDC_SESSION_COOKIE}=([^;]+)`));
      if (!sessionMatch?.[1]) throw new Error("Session match failed");
      const sessionId = sessionMatch[1];

      const session = await sessionStore.getSession(sessionId);
      if (!session?.authFlowState) throw new Error("Session authFlowState missing");
      const state = session.authFlowState.state;

      await fetch(`${baseUrl}/api/v1/oidc/callback?code=mock-auth-code&state=${state}`, {
        method: "GET",
        headers: {
          Cookie: `${OIDC_SESSION_COOKIE}=${sessionId}`,
        },
      });

      // Now refresh
      const refreshResponse = await fetch(`${baseUrl}/api/v1/oidc/refresh`, {
        method: "POST",
        headers: {
          Cookie: `${OIDC_SESSION_COOKIE}=${sessionId}`,
        },
      });

      expect(refreshResponse.status).toBe(200);
      const body = (await refreshResponse.json()) as { success: boolean; expiresAt: string };
      expect(body.success).toBe(true);
      expect(body.expiresAt).toBeDefined();
    });

    it("should fail refresh without session", async () => {
      const response = await fetch(`${baseUrl}/api/v1/oidc/refresh`, {
        method: "POST",
      });

      expect(response.status).toBe(401);
    });
  });

  describe("Error Handling", () => {
    it("should handle IdP error response gracefully", async () => {
      const response = await fetch(
        `${baseUrl}/api/v1/oidc/callback?error=access_denied&error_description=User%20cancelled`,
        {
          method: "GET",
          headers: {
            Cookie: `${OIDC_SESSION_COOKIE}=any-session-id`,
          },
        }
      );

      expect(response.status).toBe(400);
      const body = (await response.json()) as { message?: string; error?: string };
      // Check for either message or error field (depending on error handler)
      const errorText = body.message ?? body.error ?? "";
      expect(errorText).toContain("User cancelled");
    });

    it("should reject /authorize when OIDC is disabled", async () => {
      // Create app with OIDC disabled
      const disabledConfig: OidcConfig = {
        ...testConfig,
        enabled: false,
      };

      const disabledProvider = new OidcProviderImpl(disabledConfig, sessionStore);
      const disabledApp = express();
      disabledApp.use(cookieParser());
      disabledApp.use(
        "/api/v1/oidc",
        createOidcRouter({
          oidcProvider: disabledProvider,
          sessionStore,
        })
      );

      // Add error handler
      disabledApp.use(
        (
          err: Error & { statusCode?: number; code?: string },
          _req: express.Request,
          res: express.Response,
          _next: express.NextFunction
        ) => {
          const status = err.statusCode || 500;
          res.status(status).json({
            message: err.message,
            code: err.code || "INTERNAL_ERROR",
          });
        }
      );

      const disabledServer = await new Promise<Server>((resolve) => {
        const s = disabledApp.listen(0, "127.0.0.1", () => resolve(s));
      });

      try {
        const addr = disabledServer.address();
        const disabledUrl = addr && typeof addr === "object" ? `http://127.0.0.1:${addr.port}` : "";

        const response = await fetch(`${disabledUrl}/api/v1/oidc/authorize`, {
          method: "GET",
        });

        expect(response.status).toBe(400);
        const body = (await response.json()) as { message: string };
        expect(body.message).toContain("not enabled");
      } finally {
        await new Promise<void>((resolve) => disabledServer.close(() => resolve()));
      }
    });
  });
});
