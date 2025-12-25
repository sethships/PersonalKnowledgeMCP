/**
 * OIDC Provider Unit Tests
 *
 * Tests for the OIDC provider implementation.
 * Uses mocked openid-client for isolated testing.
 *
 * @module tests/unit/auth/oidc/oidc-provider
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { OidcProviderImpl } from "../../../../src/auth/oidc/oidc-provider.js";
import { OidcSessionStoreImpl } from "../../../../src/auth/oidc/oidc-session-store.js";
import { initializeLogger, resetLogger } from "../../../../src/logging/index.js";
import { join } from "path";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import type { OidcConfig, OidcSessionStore } from "../../../../src/auth/oidc/oidc-types.js";

describe("OIDC Provider", () => {
  let tempDir: string;
  let sessionStore: OidcSessionStore;

  beforeAll(async () => {
    initializeLogger({ level: "error", format: "json" });
    tempDir = await mkdtemp(join(tmpdir(), "oidc-provider-test-"));
  });

  afterAll(async () => {
    resetLogger();
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  beforeEach(() => {
    OidcSessionStoreImpl.resetInstance();
    sessionStore = OidcSessionStoreImpl.getInstance(tempDir);
  });

  describe("isEnabled", () => {
    it("should return false when OIDC is disabled", () => {
      const config: OidcConfig = {
        enabled: false,
        defaultScopes: ["read"],
        defaultInstanceAccess: ["public"],
        sessionTtlSeconds: 3600,
        refreshBeforeExpirySeconds: 300,
        cookieName: "pk_mcp_oidc_session",
      };

      const provider = new OidcProviderImpl(config, sessionStore);

      expect(provider.isEnabled()).toBe(false);
    });

    it("should return true when OIDC is enabled", () => {
      const config: OidcConfig = {
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
      };

      const provider = new OidcProviderImpl(config, sessionStore);

      expect(provider.isEnabled()).toBe(true);
    });
  });

  describe("getConfig", () => {
    it("should return the configuration", () => {
      const config: OidcConfig = {
        enabled: true,
        issuer: "https://auth.example.com/",
        clientId: "test-client",
        clientSecret: "test-secret",
        redirectUri: "http://localhost:3001/callback",
        defaultScopes: ["read", "write"],
        defaultInstanceAccess: ["work"],
        sessionTtlSeconds: 7200,
        refreshBeforeExpirySeconds: 600,
        cookieName: "pk_mcp_oidc_session",
      };

      const provider = new OidcProviderImpl(config, sessionStore);
      const returnedConfig = provider.getConfig();

      expect(returnedConfig).toEqual(config);
    });
  });

  describe("getAuthorizationUrl", () => {
    it("should throw when OIDC is disabled", async () => {
      const config: OidcConfig = {
        enabled: false,
        defaultScopes: ["read"],
        defaultInstanceAccess: ["public"],
        sessionTtlSeconds: 3600,
        refreshBeforeExpirySeconds: 300,
        cookieName: "pk_mcp_oidc_session",
      };

      const provider = new OidcProviderImpl(config, sessionStore);
      const session = await sessionStore.createSession();

      expect(provider.getAuthorizationUrl(session.sessionId)).rejects.toThrow(/not configured/i);
    });

    it("should throw for non-existent session", async () => {
      const config: OidcConfig = {
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
      };

      const provider = new OidcProviderImpl(config, sessionStore);

      expect(provider.getAuthorizationUrl("non-existent-session")).rejects.toThrow(/not found/i);
    });
  });

  describe("handleCallback", () => {
    it("should throw for non-existent session", async () => {
      const config: OidcConfig = {
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
      };

      const provider = new OidcProviderImpl(config, sessionStore);

      expect(provider.handleCallback("non-existent", "code", "state")).rejects.toThrow(
        /not found/i
      );
    });

    it("should throw for session without auth flow state", async () => {
      const config: OidcConfig = {
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
      };

      const provider = new OidcProviderImpl(config, sessionStore);
      const session = await sessionStore.createSession();

      expect(provider.handleCallback(session.sessionId, "code", "state")).rejects.toThrow(
        /No pending auth flow/i
      );
    });
  });

  describe("getUserInfo", () => {
    it("should throw for non-existent session", async () => {
      const config: OidcConfig = {
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
      };

      const provider = new OidcProviderImpl(config, sessionStore);

      expect(provider.getUserInfo("non-existent")).rejects.toThrow(/not found/i);
    });

    it("should throw for session without user info", async () => {
      const config: OidcConfig = {
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
      };

      const provider = new OidcProviderImpl(config, sessionStore);
      const session = await sessionStore.createSession();

      expect(provider.getUserInfo(session.sessionId)).rejects.toThrow(/No user info/i);
    });

    it("should return user info for authenticated session", async () => {
      const config: OidcConfig = {
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
      };

      const provider = new OidcProviderImpl(config, sessionStore);
      const session = await sessionStore.createSession();

      // Simulate authenticated session
      session.user = {
        sub: "user-123",
        email: "test@example.com",
        name: "Test User",
      };
      await sessionStore.updateSession(session);

      const userInfo = await provider.getUserInfo(session.sessionId);

      expect(userInfo.sub).toBe("user-123");
      expect(userInfo.email).toBe("test@example.com");
      expect(userInfo.name).toBe("Test User");
    });
  });

  describe("logout", () => {
    it("should delete the session", async () => {
      const config: OidcConfig = {
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
      };

      const provider = new OidcProviderImpl(config, sessionStore);
      const session = await sessionStore.createSession();

      await provider.logout(session.sessionId);

      const retrieved = await sessionStore.getSession(session.sessionId);
      expect(retrieved).toBeNull();
    });

    it("should not throw for non-existent session", async () => {
      const config: OidcConfig = {
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
      };

      const provider = new OidcProviderImpl(config, sessionStore);

      // Should not throw
      await provider.logout("non-existent");
    });
  });

  describe("refreshToken", () => {
    it("should throw for session without refresh token", async () => {
      const config: OidcConfig = {
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
      };

      const provider = new OidcProviderImpl(config, sessionStore);
      const session = await sessionStore.createSession();

      // Add tokens but no refresh token
      session.tokens = {
        accessToken: "access-token",
        tokenExpiresAt: new Date(Date.now() + 3600000).toISOString(),
      };
      await sessionStore.updateSession(session);

      expect(provider.refreshToken(session.sessionId)).rejects.toThrow();
    });
  });
});
