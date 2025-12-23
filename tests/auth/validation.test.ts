/**
 * Validation Schema Unit Tests
 *
 * Tests for the Zod validation schemas in the auth module.
 *
 * @module tests/auth/validation
 */

import { describe, it, expect } from "bun:test";
import {
  TokenScopeSchema,
  InstanceAccessSchema,
  RawTokenSchema,
  TokenHashSchema,
  TokenNameSchema,
  GenerateTokenParamsSchema,
  TokenMetadataSchema,
  StoredTokenSchema,
  TokenStoreFileSchema,
  TOKEN_PREFIX,
} from "../../src/auth/validation.js";

describe("Validation Schemas", () => {
  describe("TOKEN_PREFIX", () => {
    it("should be pk_mcp_", () => {
      expect(TOKEN_PREFIX).toBe("pk_mcp_");
    });
  });

  describe("TokenScopeSchema", () => {
    it("should accept valid scopes", () => {
      expect(TokenScopeSchema.parse("read")).toBe("read");
      expect(TokenScopeSchema.parse("write")).toBe("write");
      expect(TokenScopeSchema.parse("admin")).toBe("admin");
    });

    it("should reject invalid scopes", () => {
      expect(() => TokenScopeSchema.parse("invalid")).toThrow();
      expect(() => TokenScopeSchema.parse("READ")).toThrow(); // Case sensitive
      expect(() => TokenScopeSchema.parse("")).toThrow();
    });
  });

  describe("InstanceAccessSchema", () => {
    it("should accept valid instance access levels", () => {
      expect(InstanceAccessSchema.parse("private")).toBe("private");
      expect(InstanceAccessSchema.parse("work")).toBe("work");
      expect(InstanceAccessSchema.parse("public")).toBe("public");
    });

    it("should reject invalid instance access levels", () => {
      expect(() => InstanceAccessSchema.parse("invalid")).toThrow();
      expect(() => InstanceAccessSchema.parse("PRIVATE")).toThrow();
      expect(() => InstanceAccessSchema.parse("")).toThrow();
    });
  });

  describe("RawTokenSchema", () => {
    it("should accept valid token format", () => {
      const validToken = "pk_mcp_" + "a".repeat(32);
      expect(RawTokenSchema.parse(validToken)).toBe(validToken);

      const validToken2 = "pk_mcp_" + "0123456789abcdef".repeat(2);
      expect(RawTokenSchema.parse(validToken2)).toBe(validToken2);
    });

    it("should reject wrong prefix", () => {
      expect(() => RawTokenSchema.parse("wrong_" + "a".repeat(32))).toThrow();
      expect(() => RawTokenSchema.parse("pk_" + "a".repeat(32))).toThrow();
    });

    it("should reject wrong hex length", () => {
      expect(() => RawTokenSchema.parse("pk_mcp_" + "a".repeat(31))).toThrow();
      expect(() => RawTokenSchema.parse("pk_mcp_" + "a".repeat(33))).toThrow();
    });

    it("should reject non-hex characters", () => {
      expect(() => RawTokenSchema.parse("pk_mcp_" + "g".repeat(32))).toThrow();
      expect(() => RawTokenSchema.parse("pk_mcp_" + "A".repeat(32))).toThrow(); // Upper case
    });

    it("should reject empty string", () => {
      expect(() => RawTokenSchema.parse("")).toThrow();
    });
  });

  describe("TokenHashSchema", () => {
    it("should accept valid SHA-256 hash", () => {
      const validHash = "a".repeat(64);
      expect(TokenHashSchema.parse(validHash)).toBe(validHash);

      const validHash2 = "0123456789abcdef".repeat(4);
      expect(TokenHashSchema.parse(validHash2)).toBe(validHash2);
    });

    it("should reject wrong length", () => {
      expect(() => TokenHashSchema.parse("a".repeat(63))).toThrow();
      expect(() => TokenHashSchema.parse("a".repeat(65))).toThrow();
    });

    it("should reject non-hex characters", () => {
      expect(() => TokenHashSchema.parse("g".repeat(64))).toThrow();
      expect(() => TokenHashSchema.parse("A".repeat(64))).toThrow(); // Upper case
    });
  });

  describe("TokenNameSchema", () => {
    it("should accept valid names", () => {
      expect(TokenNameSchema.parse("Test Token")).toBe("Test Token");
      expect(TokenNameSchema.parse("my-token_v2.0")).toBe("my-token_v2.0");
      expect(TokenNameSchema.parse("A")).toBe("A");
      expect(TokenNameSchema.parse("a".repeat(100))).toBe("a".repeat(100));
    });

    it("should trim whitespace", () => {
      expect(TokenNameSchema.parse("  Test Token  ")).toBe("Test Token");
    });

    it("should reject empty name", () => {
      expect(() => TokenNameSchema.parse("")).toThrow();
      expect(() => TokenNameSchema.parse("   ")).toThrow(); // Only whitespace
    });

    it("should reject name exceeding 100 characters", () => {
      expect(() => TokenNameSchema.parse("a".repeat(101))).toThrow();
    });

    it("should reject invalid characters", () => {
      expect(() => TokenNameSchema.parse("test<script>")).toThrow();
      expect(() => TokenNameSchema.parse("test$name")).toThrow();
      expect(() => TokenNameSchema.parse("test@name")).toThrow();
    });

    it("should allow hyphens, underscores, periods, and spaces", () => {
      expect(TokenNameSchema.parse("test-name")).toBe("test-name");
      expect(TokenNameSchema.parse("test_name")).toBe("test_name");
      expect(TokenNameSchema.parse("test.name")).toBe("test.name");
      expect(TokenNameSchema.parse("test name")).toBe("test name");
    });
  });

  describe("GenerateTokenParamsSchema", () => {
    it("should accept minimal valid params", () => {
      const result = GenerateTokenParamsSchema.parse({ name: "Test" });

      expect(result.name).toBe("Test");
      expect(result.scopes).toEqual(["read"]); // Default
      expect(result.instanceAccess).toEqual(["public"]); // Default
      expect(result.expiresInSeconds).toBeNull(); // Default
    });

    it("should accept full params", () => {
      const result = GenerateTokenParamsSchema.parse({
        name: "Full Token",
        scopes: ["read", "write"],
        instanceAccess: ["work", "private"],
        expiresInSeconds: 3600,
      });

      expect(result.name).toBe("Full Token");
      expect(result.scopes).toEqual(["read", "write"]);
      expect(result.instanceAccess).toEqual(["work", "private"]);
      expect(result.expiresInSeconds).toBe(3600);
    });

    it("should accept null expiresInSeconds", () => {
      const result = GenerateTokenParamsSchema.parse({
        name: "Test",
        expiresInSeconds: null,
      });

      expect(result.expiresInSeconds).toBeNull();
    });

    it("should reject empty scopes array", () => {
      expect(() =>
        GenerateTokenParamsSchema.parse({
          name: "Test",
          scopes: [],
        })
      ).toThrow();
    });

    it("should reject empty instanceAccess array", () => {
      expect(() =>
        GenerateTokenParamsSchema.parse({
          name: "Test",
          instanceAccess: [],
        })
      ).toThrow();
    });

    it("should reject negative expiresInSeconds", () => {
      expect(() =>
        GenerateTokenParamsSchema.parse({
          name: "Test",
          expiresInSeconds: -1,
        })
      ).toThrow();
    });

    it("should reject non-integer expiresInSeconds", () => {
      expect(() =>
        GenerateTokenParamsSchema.parse({
          name: "Test",
          expiresInSeconds: 3600.5,
        })
      ).toThrow();
    });

    it("should reject expiresInSeconds exceeding 1 year", () => {
      expect(() =>
        GenerateTokenParamsSchema.parse({
          name: "Test",
          expiresInSeconds: 31536001,
        })
      ).toThrow();
    });

    it("should reject extra properties (strict mode)", () => {
      expect(() =>
        GenerateTokenParamsSchema.parse({
          name: "Test",
          unknownProp: "value",
        })
      ).toThrow();
    });
  });

  describe("TokenMetadataSchema", () => {
    it("should accept valid metadata", () => {
      const now = new Date().toISOString();
      const result = TokenMetadataSchema.parse({
        name: "Test",
        createdAt: now,
        expiresAt: null,
        scopes: ["read"],
        instanceAccess: ["public"],
      });

      expect(result.name).toBe("Test");
      expect(result.createdAt).toBe(now);
      expect(result.expiresAt).toBeNull();
    });

    it("should accept optional fields", () => {
      const now = new Date().toISOString();
      const result = TokenMetadataSchema.parse({
        name: "Test",
        createdAt: now,
        expiresAt: now,
        scopes: ["read"],
        instanceAccess: ["public"],
        lastUsedAt: now,
        useCount: 5,
      });

      expect(result.lastUsedAt).toBe(now);
      expect(result.useCount).toBe(5);
    });

    it("should reject invalid datetime format", () => {
      expect(() =>
        TokenMetadataSchema.parse({
          name: "Test",
          createdAt: "not-a-date",
          expiresAt: null,
          scopes: ["read"],
          instanceAccess: ["public"],
        })
      ).toThrow();
    });

    it("should reject negative useCount", () => {
      expect(() =>
        TokenMetadataSchema.parse({
          name: "Test",
          createdAt: new Date().toISOString(),
          expiresAt: null,
          scopes: ["read"],
          instanceAccess: ["public"],
          useCount: -1,
        })
      ).toThrow();
    });
  });

  describe("StoredTokenSchema", () => {
    it("should accept valid stored token", () => {
      const now = new Date().toISOString();
      const result = StoredTokenSchema.parse({
        tokenHash: "a".repeat(64),
        metadata: {
          name: "Test",
          createdAt: now,
          expiresAt: null,
          scopes: ["read"],
          instanceAccess: ["public"],
        },
        revoked: false,
      });

      expect(result.tokenHash).toBe("a".repeat(64));
      expect(result.revoked).toBe(false);
    });

    it("should accept revoked token with revokedAt", () => {
      const now = new Date().toISOString();
      const result = StoredTokenSchema.parse({
        tokenHash: "a".repeat(64),
        metadata: {
          name: "Test",
          createdAt: now,
          expiresAt: null,
          scopes: ["read"],
          instanceAccess: ["public"],
        },
        revoked: true,
        revokedAt: now,
      });

      expect(result.revoked).toBe(true);
      expect(result.revokedAt).toBe(now);
    });

    it("should reject invalid tokenHash format", () => {
      expect(() =>
        StoredTokenSchema.parse({
          tokenHash: "invalid",
          metadata: {
            name: "Test",
            createdAt: new Date().toISOString(),
            expiresAt: null,
            scopes: ["read"],
            instanceAccess: ["public"],
          },
          revoked: false,
        })
      ).toThrow();
    });
  });

  describe("TokenStoreFileSchema", () => {
    it("should accept valid file format", () => {
      const now = new Date().toISOString();
      const result = TokenStoreFileSchema.parse({
        version: "1.0",
        tokens: {
          ["a".repeat(64)]: {
            tokenHash: "a".repeat(64),
            metadata: {
              name: "Test",
              createdAt: now,
              expiresAt: null,
              scopes: ["read"],
              instanceAccess: ["public"],
            },
            revoked: false,
          },
        },
      });

      expect(result.version).toBe("1.0");
      expect(Object.keys(result.tokens).length).toBe(1);
    });

    it("should accept empty tokens", () => {
      const result = TokenStoreFileSchema.parse({
        version: "1.0",
        tokens: {},
      });

      expect(Object.keys(result.tokens).length).toBe(0);
    });

    it("should reject invalid version", () => {
      expect(() =>
        TokenStoreFileSchema.parse({
          version: "2.0",
          tokens: {},
        })
      ).toThrow();
    });

    it("should reject missing version", () => {
      expect(() =>
        TokenStoreFileSchema.parse({
          tokens: {},
        })
      ).toThrow();
    });

    it("should reject missing tokens", () => {
      expect(() =>
        TokenStoreFileSchema.parse({
          version: "1.0",
        })
      ).toThrow();
    });
  });
});
