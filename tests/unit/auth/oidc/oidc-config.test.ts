/**
 * OIDC Configuration Unit Tests
 *
 * Tests for the OIDC configuration loading and validation.
 *
 * @module tests/unit/auth/oidc/oidc-config
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import {
  loadOidcConfig,
  createDisabledOidcConfig,
  isOidcConfigComplete,
} from "../../../../src/auth/oidc/oidc-config.js";
import { initializeLogger, resetLogger } from "../../../../src/logging/index.js";
import type { OidcConfig } from "../../../../src/auth/oidc/oidc-types.js";

/**
 * Helper to save and restore environment variables
 */
class EnvHelper {
  private saved: Record<string, string | undefined> = {};
  private readonly envVars = [
    "OIDC_ENABLED",
    "OIDC_ISSUER",
    "OIDC_CLIENT_ID",
    "OIDC_CLIENT_SECRET",
    "OIDC_REDIRECT_URI",
    "OIDC_DEFAULT_SCOPES",
    "OIDC_DEFAULT_INSTANCE_ACCESS",
    "OIDC_SESSION_TTL_SECONDS",
    "OIDC_REFRESH_BEFORE_EXPIRY_SECONDS",
  ];

  save(): void {
    for (const key of this.envVars) {
      this.saved[key] = Bun.env[key];
    }
  }

  restore(): void {
    for (const key of this.envVars) {
      if (this.saved[key] === undefined) {
        delete Bun.env[key];
      } else {
        Bun.env[key] = this.saved[key];
      }
    }
  }

  clear(): void {
    for (const key of this.envVars) {
      delete Bun.env[key];
    }
  }
}

describe("OIDC Configuration", () => {
  const envHelper = new EnvHelper();

  beforeAll(() => {
    initializeLogger({ level: "error", format: "json" });
  });

  afterAll(() => {
    resetLogger();
  });

  beforeEach(() => {
    envHelper.save();
    envHelper.clear();
  });

  afterEach(() => {
    envHelper.restore();
  });

  describe("loadOidcConfig", () => {
    describe("disabled OIDC (default)", () => {
      it("should return disabled config when OIDC_ENABLED is not set", () => {
        const config = loadOidcConfig();

        expect(config.enabled).toBe(false);
        expect(config.issuer).toBeUndefined();
        expect(config.clientId).toBeUndefined();
        expect(config.clientSecret).toBeUndefined();
        expect(config.redirectUri).toBeUndefined();
      });

      it("should return disabled config when OIDC_ENABLED is false", () => {
        Bun.env["OIDC_ENABLED"] = "false";
        const config = loadOidcConfig();

        expect(config.enabled).toBe(false);
      });

      it("should use default scopes when OIDC is disabled", () => {
        const config = loadOidcConfig();

        expect(config.defaultScopes).toEqual(["read"]);
      });

      it("should use default instance access when OIDC is disabled", () => {
        const config = loadOidcConfig();

        expect(config.defaultInstanceAccess).toEqual(["public"]);
      });

      it("should use default session TTL when OIDC is disabled", () => {
        const config = loadOidcConfig();

        expect(config.sessionTtlSeconds).toBe(3600);
      });

      it("should use default refresh threshold when OIDC is disabled", () => {
        const config = loadOidcConfig();

        expect(config.refreshBeforeExpirySeconds).toBe(300);
      });
    });

    describe("enabled OIDC with complete configuration", () => {
      beforeEach(() => {
        // Set up valid complete OIDC config
        Bun.env["OIDC_ENABLED"] = "true";
        Bun.env["OIDC_ISSUER"] = "https://auth.example.com/";
        Bun.env["OIDC_CLIENT_ID"] = "test-client-id";
        Bun.env["OIDC_CLIENT_SECRET"] = "test-client-secret";
        Bun.env["OIDC_REDIRECT_URI"] = "http://localhost:3001/api/v1/oidc/callback";
      });

      it("should return enabled config with all required fields", () => {
        const config = loadOidcConfig();

        expect(config.enabled).toBe(true);
        expect(config.issuer).toBe("https://auth.example.com/");
        expect(config.clientId).toBe("test-client-id");
        expect(config.clientSecret).toBe("test-client-secret");
        expect(config.redirectUri).toBe("http://localhost:3001/api/v1/oidc/callback");
      });

      it("should parse custom scopes from env", () => {
        Bun.env["OIDC_DEFAULT_SCOPES"] = "read,write,admin";
        const config = loadOidcConfig();

        expect(config.defaultScopes).toEqual(["read", "write", "admin"]);
      });

      it("should parse custom instance access from env", () => {
        Bun.env["OIDC_DEFAULT_INSTANCE_ACCESS"] = "private,work";
        const config = loadOidcConfig();

        expect(config.defaultInstanceAccess).toEqual(["private", "work"]);
      });

      it("should parse custom session TTL from env", () => {
        Bun.env["OIDC_SESSION_TTL_SECONDS"] = "7200";
        const config = loadOidcConfig();

        expect(config.sessionTtlSeconds).toBe(7200);
      });

      it("should parse custom refresh threshold from env", () => {
        Bun.env["OIDC_REFRESH_BEFORE_EXPIRY_SECONDS"] = "600";
        const config = loadOidcConfig();

        expect(config.refreshBeforeExpirySeconds).toBe(600);
      });

      it("should handle OIDC_ENABLED with uppercase TRUE (case-insensitive)", () => {
        // Set up complete config since TRUE will enable OIDC
        Bun.env["OIDC_ENABLED"] = "TRUE";
        Bun.env["OIDC_ISSUER"] = "https://auth.example.com/";
        Bun.env["OIDC_CLIENT_ID"] = "test-client-id";
        Bun.env["OIDC_CLIENT_SECRET"] = "test-client-secret";
        Bun.env["OIDC_REDIRECT_URI"] = "http://localhost:3001/api/v1/oidc/callback";

        const config = loadOidcConfig();

        // Case-insensitive parsing: "TRUE" is recognized as true
        expect(config.enabled).toBe(true);
      });
    });

    describe("validation errors", () => {
      it("should throw error when OIDC is enabled but issuer is missing", () => {
        Bun.env["OIDC_ENABLED"] = "true";
        Bun.env["OIDC_CLIENT_ID"] = "test-client-id";
        Bun.env["OIDC_CLIENT_SECRET"] = "test-client-secret";
        Bun.env["OIDC_REDIRECT_URI"] = "http://localhost:3001/api/v1/oidc/callback";
        // Missing: OIDC_ISSUER

        expect(() => loadOidcConfig()).toThrow(
          /issuer.*clientId.*clientSecret.*redirectUri.*required/
        );
      });

      it("should throw error when OIDC is enabled but clientId is missing", () => {
        Bun.env["OIDC_ENABLED"] = "true";
        Bun.env["OIDC_ISSUER"] = "https://auth.example.com/";
        Bun.env["OIDC_CLIENT_SECRET"] = "test-client-secret";
        Bun.env["OIDC_REDIRECT_URI"] = "http://localhost:3001/api/v1/oidc/callback";
        // Missing: OIDC_CLIENT_ID

        expect(() => loadOidcConfig()).toThrow(
          /issuer.*clientId.*clientSecret.*redirectUri.*required/
        );
      });

      it("should throw error when OIDC is enabled but clientSecret is missing", () => {
        Bun.env["OIDC_ENABLED"] = "true";
        Bun.env["OIDC_ISSUER"] = "https://auth.example.com/";
        Bun.env["OIDC_CLIENT_ID"] = "test-client-id";
        Bun.env["OIDC_REDIRECT_URI"] = "http://localhost:3001/api/v1/oidc/callback";
        // Missing: OIDC_CLIENT_SECRET

        expect(() => loadOidcConfig()).toThrow(
          /issuer.*clientId.*clientSecret.*redirectUri.*required/
        );
      });

      it("should throw error when OIDC is enabled but redirectUri is missing", () => {
        Bun.env["OIDC_ENABLED"] = "true";
        Bun.env["OIDC_ISSUER"] = "https://auth.example.com/";
        Bun.env["OIDC_CLIENT_ID"] = "test-client-id";
        Bun.env["OIDC_CLIENT_SECRET"] = "test-client-secret";
        // Missing: OIDC_REDIRECT_URI

        expect(() => loadOidcConfig()).toThrow(
          /issuer.*clientId.*clientSecret.*redirectUri.*required/
        );
      });
    });

    describe("scope parsing", () => {
      beforeEach(() => {
        Bun.env["OIDC_ENABLED"] = "true";
        Bun.env["OIDC_ISSUER"] = "https://auth.example.com/";
        Bun.env["OIDC_CLIENT_ID"] = "test-client-id";
        Bun.env["OIDC_CLIENT_SECRET"] = "test-client-secret";
        Bun.env["OIDC_REDIRECT_URI"] = "http://localhost:3001/api/v1/oidc/callback";
      });

      it("should handle single scope", () => {
        Bun.env["OIDC_DEFAULT_SCOPES"] = "write";
        const config = loadOidcConfig();

        expect(config.defaultScopes).toEqual(["write"]);
      });

      it("should handle scopes with extra whitespace", () => {
        Bun.env["OIDC_DEFAULT_SCOPES"] = " read , write , admin ";
        const config = loadOidcConfig();

        expect(config.defaultScopes).toEqual(["read", "write", "admin"]);
      });

      it("should filter out invalid scopes", () => {
        Bun.env["OIDC_DEFAULT_SCOPES"] = "read,invalid,write";
        const config = loadOidcConfig();

        expect(config.defaultScopes).toEqual(["read", "write"]);
      });

      it("should use defaults when all scopes are invalid", () => {
        Bun.env["OIDC_DEFAULT_SCOPES"] = "invalid,unknown";
        const config = loadOidcConfig();

        expect(config.defaultScopes).toEqual(["read"]);
      });

      it("should use defaults when scopes are empty", () => {
        Bun.env["OIDC_DEFAULT_SCOPES"] = "";
        const config = loadOidcConfig();

        expect(config.defaultScopes).toEqual(["read"]);
      });
    });

    describe("instance access parsing", () => {
      beforeEach(() => {
        Bun.env["OIDC_ENABLED"] = "true";
        Bun.env["OIDC_ISSUER"] = "https://auth.example.com/";
        Bun.env["OIDC_CLIENT_ID"] = "test-client-id";
        Bun.env["OIDC_CLIENT_SECRET"] = "test-client-secret";
        Bun.env["OIDC_REDIRECT_URI"] = "http://localhost:3001/api/v1/oidc/callback";
      });

      it("should handle single instance access", () => {
        Bun.env["OIDC_DEFAULT_INSTANCE_ACCESS"] = "work";
        const config = loadOidcConfig();

        expect(config.defaultInstanceAccess).toEqual(["work"]);
      });

      it("should handle instance access with extra whitespace", () => {
        Bun.env["OIDC_DEFAULT_INSTANCE_ACCESS"] = " private , work , public ";
        const config = loadOidcConfig();

        expect(config.defaultInstanceAccess).toEqual(["private", "work", "public"]);
      });

      it("should filter out invalid instance access", () => {
        Bun.env["OIDC_DEFAULT_INSTANCE_ACCESS"] = "work,invalid,public";
        const config = loadOidcConfig();

        expect(config.defaultInstanceAccess).toEqual(["work", "public"]);
      });

      it("should use defaults when all instance access are invalid", () => {
        Bun.env["OIDC_DEFAULT_INSTANCE_ACCESS"] = "invalid,unknown";
        const config = loadOidcConfig();

        expect(config.defaultInstanceAccess).toEqual(["public"]);
      });
    });

    describe("numeric parsing", () => {
      beforeEach(() => {
        Bun.env["OIDC_ENABLED"] = "true";
        Bun.env["OIDC_ISSUER"] = "https://auth.example.com/";
        Bun.env["OIDC_CLIENT_ID"] = "test-client-id";
        Bun.env["OIDC_CLIENT_SECRET"] = "test-client-secret";
        Bun.env["OIDC_REDIRECT_URI"] = "http://localhost:3001/api/v1/oidc/callback";
      });

      it("should handle invalid session TTL gracefully (use default)", () => {
        Bun.env["OIDC_SESSION_TTL_SECONDS"] = "not-a-number";
        const config = loadOidcConfig();

        expect(config.sessionTtlSeconds).toBe(3600);
      });

      it("should handle negative session TTL gracefully (use default)", () => {
        Bun.env["OIDC_SESSION_TTL_SECONDS"] = "-100";
        const config = loadOidcConfig();

        expect(config.sessionTtlSeconds).toBe(3600);
      });

      it("should handle empty session TTL gracefully (use default)", () => {
        Bun.env["OIDC_SESSION_TTL_SECONDS"] = "";
        const config = loadOidcConfig();

        expect(config.sessionTtlSeconds).toBe(3600);
      });

      it("should handle invalid refresh threshold gracefully (use default)", () => {
        Bun.env["OIDC_REFRESH_BEFORE_EXPIRY_SECONDS"] = "not-a-number";
        const config = loadOidcConfig();

        expect(config.refreshBeforeExpirySeconds).toBe(300);
      });

      it("should allow zero refresh threshold", () => {
        Bun.env["OIDC_REFRESH_BEFORE_EXPIRY_SECONDS"] = "0";
        const config = loadOidcConfig();

        expect(config.refreshBeforeExpirySeconds).toBe(0);
      });
    });
  });

  describe("createDisabledOidcConfig", () => {
    it("should return a disabled config", () => {
      const config = createDisabledOidcConfig();

      expect(config.enabled).toBe(false);
    });

    it("should have default scopes", () => {
      const config = createDisabledOidcConfig();

      expect(config.defaultScopes).toEqual(["read"]);
    });

    it("should have default instance access", () => {
      const config = createDisabledOidcConfig();

      expect(config.defaultInstanceAccess).toEqual(["public"]);
    });

    it("should have default session TTL", () => {
      const config = createDisabledOidcConfig();

      expect(config.sessionTtlSeconds).toBe(3600);
    });

    it("should have default refresh threshold", () => {
      const config = createDisabledOidcConfig();

      expect(config.refreshBeforeExpirySeconds).toBe(300);
    });

    it("should not have optional fields set", () => {
      const config = createDisabledOidcConfig();

      expect(config.issuer).toBeUndefined();
      expect(config.clientId).toBeUndefined();
      expect(config.clientSecret).toBeUndefined();
      expect(config.redirectUri).toBeUndefined();
    });
  });

  describe("isOidcConfigComplete", () => {
    it("should return true for disabled config", () => {
      const config = createDisabledOidcConfig();

      expect(isOidcConfigComplete(config)).toBe(true);
    });

    it("should return true for enabled config with all required fields", () => {
      const config: OidcConfig = {
        enabled: true,
        issuer: "https://auth.example.com/",
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
        redirectUri: "http://localhost:3001/api/v1/oidc/callback",
        defaultScopes: ["read"],
        defaultInstanceAccess: ["public"],
        sessionTtlSeconds: 3600,
        refreshBeforeExpirySeconds: 300,
        cookieName: "pk_mcp_oidc_session",
      };

      expect(isOidcConfigComplete(config)).toBe(true);
    });

    it("should return false for enabled config missing issuer", () => {
      const config: OidcConfig = {
        enabled: true,
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
        redirectUri: "http://localhost:3001/api/v1/oidc/callback",
        defaultScopes: ["read"],
        defaultInstanceAccess: ["public"],
        sessionTtlSeconds: 3600,
        refreshBeforeExpirySeconds: 300,
        cookieName: "pk_mcp_oidc_session",
      };

      expect(isOidcConfigComplete(config)).toBe(false);
    });

    it("should return false for enabled config missing clientId", () => {
      const config: OidcConfig = {
        enabled: true,
        issuer: "https://auth.example.com/",
        clientSecret: "test-client-secret",
        redirectUri: "http://localhost:3001/api/v1/oidc/callback",
        defaultScopes: ["read"],
        defaultInstanceAccess: ["public"],
        sessionTtlSeconds: 3600,
        refreshBeforeExpirySeconds: 300,
        cookieName: "pk_mcp_oidc_session",
      };

      expect(isOidcConfigComplete(config)).toBe(false);
    });

    it("should return false for enabled config missing clientSecret", () => {
      const config: OidcConfig = {
        enabled: true,
        issuer: "https://auth.example.com/",
        clientId: "test-client-id",
        redirectUri: "http://localhost:3001/api/v1/oidc/callback",
        defaultScopes: ["read"],
        defaultInstanceAccess: ["public"],
        sessionTtlSeconds: 3600,
        refreshBeforeExpirySeconds: 300,
        cookieName: "pk_mcp_oidc_session",
      };

      expect(isOidcConfigComplete(config)).toBe(false);
    });

    it("should return false for enabled config missing redirectUri", () => {
      const config: OidcConfig = {
        enabled: true,
        issuer: "https://auth.example.com/",
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
        defaultScopes: ["read"],
        defaultInstanceAccess: ["public"],
        sessionTtlSeconds: 3600,
        refreshBeforeExpirySeconds: 300,
        cookieName: "pk_mcp_oidc_session",
      };

      expect(isOidcConfigComplete(config)).toBe(false);
    });
  });
});
