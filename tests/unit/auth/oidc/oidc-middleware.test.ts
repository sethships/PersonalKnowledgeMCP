/**
 * OIDC Middleware Unit Tests
 *
 * Tests for the OIDC authentication middleware.
 *
 * @module tests/unit/auth/oidc/oidc-middleware
 */

import { describe, it, expect, beforeAll, afterAll, mock } from "bun:test";
import type { Request, Response } from "express";
import {
  createOidcAuthMiddleware,
  sessionToTokenMetadata,
  OIDC_COOKIE_OPTIONS,
} from "../../../../src/auth/oidc/oidc-middleware.js";
import type {
  OidcProvider,
  OidcSession,
  OidcSessionStore,
  OidcConfig,
} from "../../../../src/auth/oidc/oidc-types.js";
import { initializeLogger, resetLogger } from "../../../../src/logging/index.js";

/** Default cookie name used in tests - matches the default config value */
const TEST_OIDC_COOKIE_NAME = "pk_mcp_oidc_session";

describe("OIDC Middleware", () => {
  beforeAll(() => {
    initializeLogger({ level: "error", format: "json" });
  });

  afterAll(() => {
    resetLogger();
  });

  /**
   * Create a mock Request object
   */
  function createMockRequest(overrides: Partial<Request> = {}): Request {
    return {
      headers: {},
      method: "GET",
      path: "/test",
      cookies: {},
      ...overrides,
    } as Request;
  }

  /**
   * Create a mock Response object
   */
  function createMockResponse(): Response & {
    clearCookie: ReturnType<typeof mock>;
  } {
    const mockClearCookie = mock(() => {});
    return {
      status: mock(() => ({ json: mock(() => {}) })),
      json: mock(() => {}),
      clearCookie: mockClearCookie,
    } as unknown as Response & { clearCookie: ReturnType<typeof mock> };
  }

  /**
   * Create a mock OIDC config
   */
  function createMockOidcConfig(overrides: Partial<OidcConfig> = {}): OidcConfig {
    return {
      enabled: true,
      issuer: "https://auth.example.com/",
      clientId: "test-client",
      clientSecret: "test-secret",
      redirectUri: "http://localhost:3001/callback",
      defaultScopes: ["read"],
      defaultInstanceAccess: ["public"],
      sessionTtlSeconds: 3600,
      refreshBeforeExpirySeconds: 300,
      cookieName: "pk_mcp_oidc_session",
      ...overrides,
    };
  }

  /**
   * Create a valid OIDC session
   */
  function createValidSession(overrides: Partial<OidcSession> = {}): OidcSession {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 3600000); // 1 hour from now

    return {
      sessionId: "test-session-id",
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      mappedScopes: ["read", "write"],
      mappedInstanceAccess: ["work"],
      user: {
        sub: "user-123",
        email: "test@example.com",
        name: "Test User",
      },
      tokens: {
        accessToken: "access-token-123",
        tokenExpiresAt: expiresAt.toISOString(),
        refreshToken: "refresh-token-123",
      },
      ...overrides,
    };
  }

  /**
   * Create a mock OidcProvider
   */
  function createMockOidcProvider(overrides: Partial<OidcProvider> = {}): OidcProvider {
    const config = createMockOidcConfig();
    return {
      isEnabled: mock(() => true),
      getConfig: mock(() => config),
      getAuthorizationUrl: mock(() => Promise.resolve("https://auth.example.com/authorize")),
      handleCallback: mock(() => Promise.resolve(createValidSession())),
      refreshToken: mock(() => Promise.resolve(createValidSession())),
      getUserInfo: mock(() =>
        Promise.resolve({ sub: "user-123", email: "test@example.com", name: "Test User" })
      ),
      logout: mock(() => Promise.resolve()),
      ...overrides,
    };
  }

  /**
   * Create a mock OidcSessionStore
   */
  function createMockSessionStore(overrides: Partial<OidcSessionStore> = {}): OidcSessionStore {
    return {
      createSession: mock(() => Promise.resolve(createValidSession())),
      getSession: mock(() => Promise.resolve(createValidSession())),
      updateSession: mock(() => Promise.resolve()),
      deleteSession: mock(() => Promise.resolve()),
      cleanExpiredSessions: mock(() => Promise.resolve(0)),
      getStoragePath: mock(() => "/mock/path"),
      invalidateCache: mock(() => {}),
      startAutoCleanup: mock(() => {}),
      stopAutoCleanup: mock(() => {}),
      isAutoCleanupRunning: mock(() => false),
      ...overrides,
    };
  }

  describe("sessionToTokenMetadata", () => {
    it("should convert session with email to TokenMetadata", () => {
      const session = createValidSession();
      const metadata = sessionToTokenMetadata(session);

      expect(metadata.name).toBe("OIDC: test@example.com");
      expect(metadata.createdAt).toBe(session.createdAt);
      expect(metadata.expiresAt).toBe(session.expiresAt);
      expect(metadata.scopes).toEqual(["read", "write"]);
      expect(metadata.instanceAccess).toEqual(["work"]);
      expect(metadata.lastUsedAt).toBeDefined();
    });

    it("should use sub when email is not available", () => {
      const session = createValidSession({
        user: { sub: "user-456" },
      });
      const metadata = sessionToTokenMetadata(session);

      expect(metadata.name).toBe("OIDC: user-456");
    });

    it("should use Unknown when no user info available", () => {
      const session = createValidSession({
        user: undefined,
      });
      const metadata = sessionToTokenMetadata(session);

      expect(metadata.name).toBe("OIDC: Unknown");
    });
  });

  describe("createOidcAuthMiddleware", () => {
    it("should fall through when OIDC is disabled", async () => {
      const oidcProvider = createMockOidcProvider({
        isEnabled: mock(() => false),
      });
      const getSessionMock = mock(() => Promise.resolve(createValidSession()));
      const sessionStore = createMockSessionStore({
        getSession: getSessionMock,
      });

      const middleware = createOidcAuthMiddleware({ oidcProvider, sessionStore });

      const req = createMockRequest({
        cookies: { [TEST_OIDC_COOKIE_NAME]: "test-session" },
      });
      const res = createMockResponse();
      const next = mock(() => {});

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(getSessionMock).not.toHaveBeenCalled();
    });

    it("should fall through when no session cookie is present", async () => {
      const oidcProvider = createMockOidcProvider();
      const getSessionMock = mock(() => Promise.resolve(createValidSession()));
      const sessionStore = createMockSessionStore({
        getSession: getSessionMock,
      });

      const middleware = createOidcAuthMiddleware({ oidcProvider, sessionStore });

      const req = createMockRequest({ cookies: {} });
      const res = createMockResponse();
      const next = mock(() => {});

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(getSessionMock).not.toHaveBeenCalled();
    });

    it("should clear cookie and fall through when session not found", async () => {
      const oidcProvider = createMockOidcProvider();
      const sessionStore = createMockSessionStore({
        getSession: mock(() => Promise.resolve(null)),
      });

      const middleware = createOidcAuthMiddleware({ oidcProvider, sessionStore });

      const req = createMockRequest({
        cookies: { [TEST_OIDC_COOKIE_NAME]: "non-existent-session" },
      });
      const res = createMockResponse();
      const next = mock(() => {});

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.clearCookie).toHaveBeenCalledWith(
        TEST_OIDC_COOKIE_NAME,
        expect.objectContaining({ httpOnly: true })
      );
    });

    it("should fall through when session exists but auth not complete (no user)", async () => {
      const oidcProvider = createMockOidcProvider();
      const incompleteSession = createValidSession({ user: undefined });
      const sessionStore = createMockSessionStore({
        getSession: mock(() => Promise.resolve(incompleteSession)),
      });

      const middleware = createOidcAuthMiddleware({ oidcProvider, sessionStore });

      const req = createMockRequest({
        cookies: { [TEST_OIDC_COOKIE_NAME]: "incomplete-session" },
      });
      const res = createMockResponse();
      const next = mock(() => {});

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(req.tokenMetadata).toBeUndefined();
    });

    it("should fall through when session exists but auth not complete (no tokens)", async () => {
      const oidcProvider = createMockOidcProvider();
      const incompleteSession = createValidSession({ tokens: undefined });
      const sessionStore = createMockSessionStore({
        getSession: mock(() => Promise.resolve(incompleteSession)),
      });

      const middleware = createOidcAuthMiddleware({ oidcProvider, sessionStore });

      const req = createMockRequest({
        cookies: { [TEST_OIDC_COOKIE_NAME]: "incomplete-session" },
      });
      const res = createMockResponse();
      const next = mock(() => {});

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(req.tokenMetadata).toBeUndefined();
    });

    it("should attach tokenMetadata and oidcSession for valid session", async () => {
      const validSession = createValidSession();
      const oidcProvider = createMockOidcProvider();
      const sessionStore = createMockSessionStore({
        getSession: mock(() => Promise.resolve(validSession)),
      });

      const middleware = createOidcAuthMiddleware({ oidcProvider, sessionStore });

      const req = createMockRequest({
        cookies: { [TEST_OIDC_COOKIE_NAME]: "valid-session" },
      });
      const res = createMockResponse();
      const next = mock(() => {});

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(req.tokenMetadata).toBeDefined();
      expect(req.tokenMetadata?.name).toBe("OIDC: test@example.com");
      expect(req.tokenMetadata?.scopes).toEqual(["read", "write"]);
      expect(req.oidcSession).toBe(validSession);
    });

    it("should attempt token refresh when token is near expiry", async () => {
      const nearExpirySession = createValidSession({
        tokens: {
          accessToken: "access-token",
          tokenExpiresAt: new Date(Date.now() + 60000).toISOString(), // 1 minute from now
          refreshToken: "refresh-token",
        },
      });

      const refreshMock = mock(() => Promise.resolve(nearExpirySession));
      const oidcProvider = createMockOidcProvider({
        refreshToken: refreshMock,
        getConfig: mock(() => createMockOidcConfig({ refreshBeforeExpirySeconds: 300 })),
      });
      const sessionStore = createMockSessionStore({
        getSession: mock(() => Promise.resolve(nearExpirySession)),
      });

      const middleware = createOidcAuthMiddleware({ oidcProvider, sessionStore });

      const req = createMockRequest({
        cookies: { [TEST_OIDC_COOKIE_NAME]: "near-expiry-session" },
      });
      const res = createMockResponse();
      const next = mock(() => {});

      await middleware(req, res, next);

      expect(refreshMock).toHaveBeenCalledWith("near-expiry-session");
      expect(next).toHaveBeenCalledTimes(1);
      expect(req.tokenMetadata).toBeDefined();
    });

    it("should continue even if token refresh fails", async () => {
      const nearExpirySession = createValidSession({
        tokens: {
          accessToken: "access-token",
          tokenExpiresAt: new Date(Date.now() + 60000).toISOString(),
          refreshToken: "refresh-token",
        },
      });

      const refreshMock = mock(() => Promise.reject(new Error("Refresh failed")));
      const oidcProvider = createMockOidcProvider({
        refreshToken: refreshMock,
        getConfig: mock(() => createMockOidcConfig({ refreshBeforeExpirySeconds: 300 })),
      });
      const sessionStore = createMockSessionStore({
        getSession: mock(() => Promise.resolve(nearExpirySession)),
      });

      const middleware = createOidcAuthMiddleware({ oidcProvider, sessionStore });

      const req = createMockRequest({
        cookies: { [TEST_OIDC_COOKIE_NAME]: "near-expiry-session" },
      });
      const res = createMockResponse();
      const next = mock(() => {});

      await middleware(req, res, next);

      // Should still continue and authenticate
      expect(next).toHaveBeenCalledTimes(1);
      expect(req.tokenMetadata).toBeDefined();
    });

    it("should not attempt refresh if no refresh token available", async () => {
      const noRefreshSession = createValidSession({
        tokens: {
          accessToken: "access-token",
          tokenExpiresAt: new Date(Date.now() + 60000).toISOString(),
          // No refresh token
        },
      });

      const refreshMock = mock(() => Promise.resolve(noRefreshSession));
      const oidcProvider = createMockOidcProvider({
        refreshToken: refreshMock,
        getConfig: mock(() => createMockOidcConfig({ refreshBeforeExpirySeconds: 300 })),
      });
      const sessionStore = createMockSessionStore({
        getSession: mock(() => Promise.resolve(noRefreshSession)),
      });

      const middleware = createOidcAuthMiddleware({ oidcProvider, sessionStore });

      const req = createMockRequest({
        cookies: { [TEST_OIDC_COOKIE_NAME]: "no-refresh-session" },
      });
      const res = createMockResponse();
      const next = mock(() => {});

      await middleware(req, res, next);

      expect(refreshMock).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
    });

    it("should clear cookie and fall through on session validation error", async () => {
      const oidcProvider = createMockOidcProvider();
      const sessionStore = createMockSessionStore({
        getSession: mock(() => Promise.reject(new Error("Database error"))),
      });

      const middleware = createOidcAuthMiddleware({ oidcProvider, sessionStore });

      const req = createMockRequest({
        cookies: { [TEST_OIDC_COOKIE_NAME]: "error-session" },
      });
      const res = createMockResponse();
      const next = mock(() => {});

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.clearCookie).toHaveBeenCalledWith(
        TEST_OIDC_COOKIE_NAME,
        expect.objectContaining({ httpOnly: true })
      );
      expect(req.tokenMetadata).toBeUndefined();
    });
  });

  describe("OIDC_COOKIE_OPTIONS", () => {
    it("should have correct security settings", () => {
      expect(OIDC_COOKIE_OPTIONS.httpOnly).toBe(true);
      expect(OIDC_COOKIE_OPTIONS.sameSite).toBe("lax");
      expect(OIDC_COOKIE_OPTIONS.path).toBe("/");
    });

    it("should set secure based on environment", () => {
      // In test environment, NODE_ENV is not 'production'
      expect(OIDC_COOKIE_OPTIONS.secure).toBe(false);
    });
  });
});
