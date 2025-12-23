/**
 * Token Service Unit Tests
 *
 * Comprehensive tests for the TokenServiceImpl class covering
 * token generation, validation, scope checking, and lifecycle management.
 *
 * @module tests/auth/token-service
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/await-thenable */

import { describe, it, expect, beforeEach, beforeAll, afterAll } from "bun:test";
import { TokenServiceImpl } from "../../src/auth/token-service.js";
import { TokenValidationError, TokenGenerationError } from "../../src/auth/errors.js";
import type { TokenScope, InstanceAccess } from "../../src/auth/types.js";
import { MockTokenStore, createMockStoredToken, hashToken } from "../helpers/token-mock.js";
import { initializeLogger, resetLogger } from "../../src/logging/index.js";

describe("TokenServiceImpl", () => {
  let tokenService: TokenServiceImpl;
  let mockStore: MockTokenStore;

  beforeAll(() => {
    // Initialize logger in silent mode for tests
    initializeLogger({ level: "error", format: "json" });
  });

  afterAll(() => {
    resetLogger();
  });

  beforeEach(() => {
    mockStore = new MockTokenStore();
    tokenService = new TokenServiceImpl(mockStore);
  });

  describe("Token Generation", () => {
    it("should generate token with correct prefix format", async () => {
      const result = await tokenService.generateToken({
        name: "Test Token",
      });

      expect(result.rawToken).toMatch(/^pk_mcp_[a-f0-9]{32}$/);
    });

    it("should hash token with SHA-256 before storage", async () => {
      const result = await tokenService.generateToken({
        name: "Test Token",
      });

      // Verify hash is 64 hex characters (SHA-256)
      expect(result.tokenHash).toMatch(/^[a-f0-9]{64}$/);

      // Verify the hash matches what we'd expect
      const expectedHash = await hashToken(result.rawToken);
      expect(result.tokenHash).toBe(expectedHash);
    });

    it("should never store raw token", async () => {
      const result = await tokenService.generateToken({
        name: "Test Token",
      });

      // Check saved tokens
      const savedTokens = mockStore.getTokens();
      const savedToken = savedTokens.get(result.tokenHash);

      expect(savedToken).toBeDefined();
      expect(savedToken!.tokenHash).toBe(result.tokenHash);

      // Ensure rawToken is not stored anywhere in the saved data
      const savedJson = JSON.stringify(savedToken);
      expect(savedJson).not.toContain(result.rawToken);
    });

    it("should apply default scopes when not specified", async () => {
      const result = await tokenService.generateToken({
        name: "Test Token",
      });

      expect(result.metadata.scopes).toEqual(["read"]);
    });

    it("should apply default instance access when not specified", async () => {
      const result = await tokenService.generateToken({
        name: "Test Token",
      });

      expect(result.metadata.instanceAccess).toEqual(["public"]);
    });

    it("should use provided scopes and instance access", async () => {
      const result = await tokenService.generateToken({
        name: "Test Token",
        scopes: ["read", "write"],
        instanceAccess: ["work", "private"],
      });

      expect(result.metadata.scopes).toEqual(["read", "write"]);
      expect(result.metadata.instanceAccess).toEqual(["work", "private"]);
    });

    it("should calculate expiration from expiresInSeconds", async () => {
      const beforeGen = new Date();
      const expiresInSeconds = 3600; // 1 hour

      const result = await tokenService.generateToken({
        name: "Test Token",
        expiresInSeconds,
      });

      expect(result.metadata.expiresAt).not.toBeNull();

      const expiresAt = new Date(result.metadata.expiresAt!);
      const expectedMin = new Date(beforeGen.getTime() + expiresInSeconds * 1000 - 1000);
      const expectedMax = new Date(beforeGen.getTime() + expiresInSeconds * 1000 + 1000);

      expect(expiresAt.getTime()).toBeGreaterThanOrEqual(expectedMin.getTime());
      expect(expiresAt.getTime()).toBeLessThanOrEqual(expectedMax.getTime());
    });

    it("should set expiresAt to null for non-expiring tokens", async () => {
      const result = await tokenService.generateToken({
        name: "Test Token",
        expiresInSeconds: null,
      });

      expect(result.metadata.expiresAt).toBeNull();
    });

    it("should set createdAt timestamp", async () => {
      const beforeGen = new Date();

      const result = await tokenService.generateToken({
        name: "Test Token",
      });

      const createdAt = new Date(result.metadata.createdAt);
      expect(createdAt.getTime()).toBeGreaterThanOrEqual(beforeGen.getTime() - 1000);
      expect(createdAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    });

    it("should initialize useCount to 0", async () => {
      const result = await tokenService.generateToken({
        name: "Test Token",
      });

      expect(result.metadata.useCount).toBe(0);
    });

    it("should reject empty token name", async () => {
      await expect(
        tokenService.generateToken({
          name: "",
        })
      ).rejects.toThrow(TokenValidationError);
    });

    it("should reject token name exceeding 100 characters", async () => {
      await expect(
        tokenService.generateToken({
          name: "x".repeat(101),
        })
      ).rejects.toThrow(TokenValidationError);
    });

    it("should reject invalid characters in token name", async () => {
      await expect(
        tokenService.generateToken({
          name: "Test<script>Token",
        })
      ).rejects.toThrow(TokenValidationError);
    });

    it("should reject invalid scope values", async () => {
      await expect(
        tokenService.generateToken({
          name: "Test Token",
          scopes: ["read", "invalid" as TokenScope],
        })
      ).rejects.toThrow(TokenValidationError);
    });

    it("should reject invalid instance access values", async () => {
      await expect(
        tokenService.generateToken({
          name: "Test Token",
          instanceAccess: ["public", "invalid" as InstanceAccess],
        })
      ).rejects.toThrow(TokenValidationError);
    });

    it("should reject empty scopes array", async () => {
      await expect(
        tokenService.generateToken({
          name: "Test Token",
          scopes: [],
        })
      ).rejects.toThrow(TokenValidationError);
    });

    it("should reject negative expiresInSeconds", async () => {
      await expect(
        tokenService.generateToken({
          name: "Test Token",
          expiresInSeconds: -1,
        })
      ).rejects.toThrow(TokenValidationError);
    });

    it("should reject expiresInSeconds exceeding 1 year", async () => {
      await expect(
        tokenService.generateToken({
          name: "Test Token",
          expiresInSeconds: 31536001, // 1 year + 1 second
        })
      ).rejects.toThrow(TokenValidationError);
    });

    it("should throw TokenGenerationError on storage failure", async () => {
      mockStore.setShouldFailSave(true);

      await expect(
        tokenService.generateToken({
          name: "Test Token",
        })
      ).rejects.toThrow(TokenGenerationError);
    });
  });

  describe("Token Validation", () => {
    it("should validate correct token format", async () => {
      // Generate a token first
      const generated = await tokenService.generateToken({
        name: "Test Token",
      });

      const result = await tokenService.validateToken(generated.rawToken);

      expect(result.valid).toBe(true);
      expect(result.metadata).toBeDefined();
      expect(result.metadata!.name).toBe("Test Token");
    });

    it("should reject invalid token format", async () => {
      const result = await tokenService.validateToken("invalid-token");

      expect(result.valid).toBe(false);
      expect(result.reason).toBe("invalid");
    });

    it("should reject token with wrong prefix", async () => {
      const result = await tokenService.validateToken("wrong_prefix_" + "a".repeat(32));

      expect(result.valid).toBe(false);
      expect(result.reason).toBe("invalid");
    });

    it("should reject token with incorrect hex length", async () => {
      const result = await tokenService.validateToken("pk_mcp_" + "a".repeat(31));

      expect(result.valid).toBe(false);
      expect(result.reason).toBe("invalid");
    });

    it("should return not_found for unknown tokens", async () => {
      const result = await tokenService.validateToken("pk_mcp_" + "a".repeat(32));

      expect(result.valid).toBe(false);
      expect(result.reason).toBe("not_found");
    });

    it("should return expired for expired tokens", async () => {
      // Create an expired token
      const expiredToken = createMockStoredToken({
        tokenHash: await hashToken("pk_mcp_" + "a".repeat(32)),
        metadata: {
          name: "Expired Token",
          createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
          expiresAt: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(), // 1 hour ago (expired)
          scopes: ["read"],
          instanceAccess: ["public"],
        },
      });
      mockStore.addToken(expiredToken);

      const result = await tokenService.validateToken("pk_mcp_" + "a".repeat(32));

      expect(result.valid).toBe(false);
      expect(result.reason).toBe("expired");
    });

    it("should return revoked for revoked tokens", async () => {
      const revokedToken = createMockStoredToken({
        tokenHash: await hashToken("pk_mcp_" + "b".repeat(32)),
        revoked: true,
        revokedAt: new Date().toISOString(),
      });
      mockStore.addToken(revokedToken);

      const result = await tokenService.validateToken("pk_mcp_" + "b".repeat(32));

      expect(result.valid).toBe(false);
      expect(result.reason).toBe("revoked");
    });

    it("should return valid with metadata for active tokens", async () => {
      const validToken = createMockStoredToken({
        tokenHash: await hashToken("pk_mcp_" + "c".repeat(32)),
        metadata: {
          name: "Valid Token",
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour from now
          scopes: ["read", "write"],
          instanceAccess: ["work"],
        },
      });
      mockStore.addToken(validToken);

      const result = await tokenService.validateToken("pk_mcp_" + "c".repeat(32));

      expect(result.valid).toBe(true);
      expect(result.metadata).toBeDefined();
      expect(result.metadata!.name).toBe("Valid Token");
      expect(result.metadata!.scopes).toEqual(["read", "write"]);
    });

    it("should complete validation in <10ms for cached tokens", async () => {
      // First generate a token
      const generated = await tokenService.generateToken({
        name: "Performance Test Token",
      });

      // Warm up cache
      await tokenService.validateToken(generated.rawToken);

      // Measure validation time
      const iterations = 100;
      const start = performance.now();

      for (let i = 0; i < iterations; i++) {
        await tokenService.validateToken(generated.rawToken);
      }

      const elapsed = performance.now() - start;
      const avgTime = elapsed / iterations;

      // Average should be well under 10ms
      expect(avgTime).toBeLessThan(10);
    });

    it("should update usage stats on successful validation", async () => {
      const generated = await tokenService.generateToken({
        name: "Usage Stats Token",
      });

      // Validate token
      await tokenService.validateToken(generated.rawToken);

      // Wait for async usage update
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Check updated stats
      const tokens = mockStore.getTokens();
      const token = tokens.get(generated.tokenHash);

      expect(token).toBeDefined();
      expect(token!.metadata.useCount).toBeGreaterThanOrEqual(1);
      expect(token!.metadata.lastUsedAt).toBeDefined();
    });
  });

  describe("Scope Checking", () => {
    let validRawToken: string;

    beforeEach(async () => {
      const generated = await tokenService.generateToken({
        name: "Scope Test Token",
        scopes: ["read", "write"],
      });
      validRawToken = generated.rawToken;
    });

    it("should return true when token has all required scopes", async () => {
      const result = await tokenService.hasScopes(validRawToken, ["read"]);
      expect(result).toBe(true);

      const result2 = await tokenService.hasScopes(validRawToken, ["read", "write"]);
      expect(result2).toBe(true);
    });

    it("should return false when token missing required scopes", async () => {
      const result = await tokenService.hasScopes(validRawToken, ["admin"]);
      expect(result).toBe(false);

      const result2 = await tokenService.hasScopes(validRawToken, ["read", "admin"]);
      expect(result2).toBe(false);
    });

    it("should grant all permissions for admin scope", async () => {
      const adminGen = await tokenService.generateToken({
        name: "Admin Token",
        scopes: ["admin"],
      });

      const result = await tokenService.hasScopes(adminGen.rawToken, ["read", "write", "admin"]);
      expect(result).toBe(true);
    });

    it("should return false for invalid tokens", async () => {
      const result = await tokenService.hasScopes("invalid-token", ["read"]);
      expect(result).toBe(false);
    });

    it("should return false for expired tokens", async () => {
      const expiredToken = createMockStoredToken({
        tokenHash: await hashToken("pk_mcp_" + "d".repeat(32)),
        metadata: {
          name: "Expired Token",
          createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
          expiresAt: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
          scopes: ["read", "write"],
          instanceAccess: ["public"],
        },
      });
      mockStore.addToken(expiredToken);

      const result = await tokenService.hasScopes("pk_mcp_" + "d".repeat(32), ["read"]);
      expect(result).toBe(false);
    });
  });

  describe("Instance Access Checking", () => {
    let validRawToken: string;

    beforeEach(async () => {
      const generated = await tokenService.generateToken({
        name: "Access Test Token",
        instanceAccess: ["work", "public"],
      });
      validRawToken = generated.rawToken;
    });

    it("should return true when token has required access", async () => {
      const result = await tokenService.hasInstanceAccess(validRawToken, ["work"]);
      expect(result).toBe(true);

      const result2 = await tokenService.hasInstanceAccess(validRawToken, ["work", "public"]);
      expect(result2).toBe(true);
    });

    it("should return false when token missing required access", async () => {
      const result = await tokenService.hasInstanceAccess(validRawToken, ["private"]);
      expect(result).toBe(false);

      const result2 = await tokenService.hasInstanceAccess(validRawToken, ["work", "private"]);
      expect(result2).toBe(false);
    });

    it("should return false for invalid tokens", async () => {
      const result = await tokenService.hasInstanceAccess("invalid-token", ["public"]);
      expect(result).toBe(false);
    });
  });

  describe("Token Revocation", () => {
    it("should revoke existing token", async () => {
      const generated = await tokenService.generateToken({
        name: "Revoke Test Token",
      });

      const result = await tokenService.revokeToken(generated.tokenHash);
      expect(result).toBe(true);

      // Verify token is revoked
      const validation = await tokenService.validateToken(generated.rawToken);
      expect(validation.valid).toBe(false);
      expect(validation.reason).toBe("revoked");
    });

    it("should return false for non-existent token", async () => {
      const result = await tokenService.revokeToken("a".repeat(64));
      expect(result).toBe(false);
    });

    it("should set revokedAt timestamp", async () => {
      const beforeRevoke = new Date();

      const generated = await tokenService.generateToken({
        name: "Timestamp Test Token",
      });

      await tokenService.revokeToken(generated.tokenHash);

      const tokens = mockStore.getTokens();
      const token = tokens.get(generated.tokenHash);

      expect(token).toBeDefined();
      expect(token!.revoked).toBe(true);
      expect(token!.revokedAt).toBeDefined();

      const revokedAt = new Date(token!.revokedAt!);
      expect(revokedAt.getTime()).toBeGreaterThanOrEqual(beforeRevoke.getTime() - 1000);
    });

    it("should prevent revoked token from validating", async () => {
      const generated = await tokenService.generateToken({
        name: "Block Revoked Token",
      });

      // Validate works before revocation
      const beforeResult = await tokenService.validateToken(generated.rawToken);
      expect(beforeResult.valid).toBe(true);

      // Revoke
      await tokenService.revokeToken(generated.tokenHash);

      // Validate fails after revocation
      const afterResult = await tokenService.validateToken(generated.rawToken);
      expect(afterResult.valid).toBe(false);
      expect(afterResult.reason).toBe("revoked");
    });
  });

  describe("Token Listing", () => {
    it("should list only active tokens", async () => {
      // Create multiple tokens
      await tokenService.generateToken({ name: "Active 1" });
      await tokenService.generateToken({ name: "Active 2" });

      const tokens = await tokenService.listTokens();

      expect(tokens.length).toBe(2);
      expect(tokens.map((t) => t.metadata.name)).toContain("Active 1");
      expect(tokens.map((t) => t.metadata.name)).toContain("Active 2");
    });

    it("should exclude revoked tokens", async () => {
      await tokenService.generateToken({ name: "Active Token" });
      const toRevoke = await tokenService.generateToken({ name: "To Revoke" });

      await tokenService.revokeToken(toRevoke.tokenHash);

      const tokens = await tokenService.listTokens();

      expect(tokens.length).toBe(1);
      expect(tokens[0]!.metadata.name).toBe("Active Token");
    });

    it("should exclude expired tokens", async () => {
      await tokenService.generateToken({
        name: "Active Token",
        expiresInSeconds: 3600, // 1 hour from now
      });

      // Add an expired token manually
      const expiredToken = createMockStoredToken({
        tokenHash: "e".repeat(64),
        metadata: {
          name: "Expired Token",
          createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
          expiresAt: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
          scopes: ["read"],
          instanceAccess: ["public"],
        },
      });
      mockStore.addToken(expiredToken);

      const tokens = await tokenService.listTokens();

      expect(tokens.length).toBe(1);
      expect(tokens[0]!.metadata.name).toBe("Active Token");
    });

    it("should return empty array when no active tokens", async () => {
      const tokens = await tokenService.listTokens();
      expect(tokens).toEqual([]);
    });

    it("should include token hash in listing", async () => {
      const generated = await tokenService.generateToken({ name: "Hash Check" });

      const tokens = await tokenService.listTokens();

      expect(tokens.length).toBe(1);
      expect(tokens[0]!.hash).toBe(generated.tokenHash);
    });
  });

  describe("Token Deletion", () => {
    it("should delete existing token", async () => {
      const generated = await tokenService.generateToken({ name: "To Delete" });

      const result = await tokenService.deleteToken(generated.tokenHash);
      expect(result).toBe(true);

      // Verify token is gone
      const tokens = await tokenService.listTokens();
      expect(tokens.length).toBe(0);
    });

    it("should return false for non-existent token", async () => {
      const result = await tokenService.deleteToken("f".repeat(64));
      expect(result).toBe(false);
    });

    it("should remove token from storage", async () => {
      const generated = await tokenService.generateToken({ name: "Storage Delete" });

      await tokenService.deleteToken(generated.tokenHash);

      const storedTokens = mockStore.getTokens();
      expect(storedTokens.has(generated.tokenHash)).toBe(false);
    });

    it("should prevent deleted token from validating", async () => {
      const generated = await tokenService.generateToken({ name: "Delete Validate" });

      // Validate works before deletion
      const beforeResult = await tokenService.validateToken(generated.rawToken);
      expect(beforeResult.valid).toBe(true);

      // Delete
      await tokenService.deleteToken(generated.tokenHash);

      // Validate fails after deletion
      const afterResult = await tokenService.validateToken(generated.rawToken);
      expect(afterResult.valid).toBe(false);
      expect(afterResult.reason).toBe("not_found");
    });
  });
});
