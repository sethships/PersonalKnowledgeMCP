/**
 * Tests for Token Output Formatters
 *
 * Tests formatting functions for token displays:
 * - createTokenTable: CLI table display
 * - formatTokensJson: JSON output
 * - formatCreatedToken: New token display with warning box
 * - formatTokenRevoked: Revocation confirmation
 * - formatTokenRotated: Rotation confirmation
 * - formatRevokeConfirmation: Confirmation prompt
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import { describe, it, expect } from "bun:test";
import type { TokenMetadata } from "../../../src/auth/types.js";
import {
  createTokenTable,
  formatTokensJson,
  formatCreatedToken,
  formatTokenRevoked,
  formatTokenRotated,
  formatRevokeConfirmation,
  type TokenDisplayInfo,
} from "../../../src/cli/output/token-formatters.js";

/**
 * Create test token metadata
 */
function createTestMetadata(overrides: Partial<TokenMetadata> = {}): TokenMetadata {
  return {
    name: "Test Token",
    createdAt: "2024-12-01T00:00:00Z",
    expiresAt: null,
    scopes: ["read"],
    instanceAccess: ["public"],
    useCount: 0,
    ...overrides,
  };
}

/**
 * Create test token display info
 */
function createTestDisplayInfo(overrides: Partial<TokenDisplayInfo> = {}): TokenDisplayInfo {
  return {
    hash: "a".repeat(64),
    metadata: createTestMetadata(),
    isExpired: false,
    isRevoked: false,
    ...overrides,
  };
}

describe("Token Formatters", () => {
  describe("createTokenTable", () => {
    it("should create a table for active tokens", () => {
      const tokens: TokenDisplayInfo[] = [
        createTestDisplayInfo({
          hash: "a1b2c3d4e5f6" + "0".repeat(52),
          metadata: createTestMetadata({ name: "Token One" }),
        }),
        createTestDisplayInfo({
          hash: "b2c3d4e5f6a1" + "0".repeat(52),
          metadata: createTestMetadata({ name: "Token Two" }),
        }),
      ];

      const table = createTokenTable(tokens);

      expect(table).toContain("Token One");
      expect(table).toContain("Token Two");
      expect(table).toContain("a1b2c3d4"); // Truncated hash
      expect(table).toContain("b2c3d4e5"); // Truncated hash
      expect(table).toContain("active");
    });

    it("should show expired tokens with expired status", () => {
      const tokens: TokenDisplayInfo[] = [
        createTestDisplayInfo({
          metadata: createTestMetadata({
            name: "Expired Token",
            expiresAt: "2020-01-01T00:00:00Z",
          }),
          isExpired: true,
        }),
      ];

      const table = createTokenTable(tokens);

      expect(table).toContain("Expired Token");
      expect(table).toContain("expired");
    });

    it("should show revoked tokens with revoked status", () => {
      const tokens: TokenDisplayInfo[] = [
        createTestDisplayInfo({
          metadata: createTestMetadata({ name: "Revoked Token" }),
          isRevoked: true,
        }),
      ];

      const table = createTokenTable(tokens);

      expect(table).toContain("Revoked Token");
      expect(table).toContain("revoked");
    });

    it("should show scopes in the table", () => {
      const tokens: TokenDisplayInfo[] = [
        createTestDisplayInfo({
          metadata: createTestMetadata({
            name: "Admin Token",
            scopes: ["read", "write"],
          }),
        }),
      ];

      const table = createTokenTable(tokens);

      expect(table).toContain("read");
      expect(table).toContain("write");
    });

    it("should show instance access levels", () => {
      const tokens: TokenDisplayInfo[] = [
        createTestDisplayInfo({
          metadata: createTestMetadata({
            name: "Work Token",
            instanceAccess: ["private", "work"],
          }),
        }),
      ];

      const table = createTokenTable(tokens);

      expect(table).toContain("private");
      expect(table).toContain("work");
    });

    it("should show helpful message when no tokens exist", () => {
      const table = createTokenTable([]);

      expect(table).toContain("No tokens found");
      expect(table).toContain("token create");
    });

    it("should show correct counts in header", () => {
      const tokens: TokenDisplayInfo[] = [
        createTestDisplayInfo({
          metadata: createTestMetadata({ name: "Active 1" }),
        }),
        createTestDisplayInfo({
          metadata: createTestMetadata({ name: "Active 2" }),
        }),
        createTestDisplayInfo({
          metadata: createTestMetadata({ name: "Expired" }),
          isExpired: true,
        }),
      ];

      const table = createTokenTable(tokens);

      // Should show "2 active, 3 total"
      expect(table).toContain("2 active");
      expect(table).toContain("3 total");
    });

    it("should truncate long token names", () => {
      const tokens: TokenDisplayInfo[] = [
        createTestDisplayInfo({
          metadata: createTestMetadata({
            name: "This is a very long token name that should be truncated",
          }),
        }),
      ];

      const table = createTokenTable(tokens);

      // Should contain truncated name with ellipsis
      expect(table).toContain("...");
    });
  });

  describe("formatTokensJson", () => {
    it("should format tokens as valid JSON", () => {
      const tokens: TokenDisplayInfo[] = [
        createTestDisplayInfo({
          hash: "abc123" + "0".repeat(58),
          metadata: createTestMetadata({
            name: "JSON Token",
            scopes: ["read", "write"],
            instanceAccess: ["public"],
          }),
        }),
      ];

      const json = formatTokensJson(tokens);
      const parsed = JSON.parse(json);

      expect(parsed.totalTokens).toBe(1);
      expect(parsed.activeTokens).toBe(1);
      expect(parsed.tokens).toHaveLength(1);
      expect(parsed.tokens[0].name).toBe("JSON Token");
      expect(parsed.tokens[0].scopes).toEqual(["read", "write"]);
    });

    it("should include hash and id in JSON output", () => {
      const tokens: TokenDisplayInfo[] = [
        createTestDisplayInfo({
          hash: "a1b2c3d4e5f6" + "0".repeat(52),
        }),
      ];

      const json = formatTokensJson(tokens);
      const parsed = JSON.parse(json);

      expect(parsed.tokens[0].id).toBe("a1b2c3d4");
      expect(parsed.tokens[0].hash).toBe("a1b2c3d4e5f6" + "0".repeat(52));
    });

    it("should include status field in JSON output", () => {
      const tokens: TokenDisplayInfo[] = [
        createTestDisplayInfo({
          metadata: createTestMetadata({ name: "Active" }),
          isExpired: false,
          isRevoked: false,
        }),
        createTestDisplayInfo({
          hash: "b".repeat(64),
          metadata: createTestMetadata({ name: "Expired" }),
          isExpired: true,
          isRevoked: false,
        }),
        createTestDisplayInfo({
          hash: "c".repeat(64),
          metadata: createTestMetadata({ name: "Revoked" }),
          isExpired: false,
          isRevoked: true,
        }),
      ];

      const json = formatTokensJson(tokens);
      const parsed = JSON.parse(json);

      expect(parsed.tokens[0].status).toBe("active");
      expect(parsed.tokens[1].status).toBe("expired");
      expect(parsed.tokens[2].status).toBe("revoked");
    });

    it("should count active tokens correctly", () => {
      const tokens: TokenDisplayInfo[] = [
        createTestDisplayInfo({ metadata: createTestMetadata({ name: "Active 1" }) }),
        createTestDisplayInfo({
          hash: "b".repeat(64),
          metadata: createTestMetadata({ name: "Active 2" }),
        }),
        createTestDisplayInfo({
          hash: "c".repeat(64),
          metadata: createTestMetadata({ name: "Expired" }),
          isExpired: true,
        }),
        createTestDisplayInfo({
          hash: "d".repeat(64),
          metadata: createTestMetadata({ name: "Revoked" }),
          isRevoked: true,
        }),
      ];

      const json = formatTokensJson(tokens);
      const parsed = JSON.parse(json);

      expect(parsed.totalTokens).toBe(4);
      expect(parsed.activeTokens).toBe(2);
    });
  });

  describe("formatCreatedToken", () => {
    it("should display the raw token prominently", () => {
      const rawToken = "pk_mcp_test123456789012345678901234";
      const metadata = createTestMetadata({ name: "New Token" });

      const output = formatCreatedToken(rawToken, metadata);

      expect(output).toContain(rawToken);
    });

    it("should include warning about saving token", () => {
      const rawToken = "pk_mcp_test123456789012345678901234";
      const metadata = createTestMetadata({ name: "New Token" });

      const output = formatCreatedToken(rawToken, metadata);

      expect(output).toContain("IMPORTANT");
      expect(output).toContain("NOT be shown again");
    });

    it("should show token details", () => {
      const rawToken = "pk_mcp_test123456789012345678901234";
      const metadata = createTestMetadata({
        name: "My Token",
        scopes: ["read", "write"],
        instanceAccess: ["work", "public"],
      });

      const output = formatCreatedToken(rawToken, metadata);

      expect(output).toContain("My Token");
      expect(output).toContain("read");
      expect(output).toContain("write");
      expect(output).toContain("work");
      expect(output).toContain("public");
    });

    it("should show expiration as never for null expiresAt", () => {
      const rawToken = "pk_mcp_test123456789012345678901234";
      const metadata = createTestMetadata({
        name: "Permanent Token",
        expiresAt: null,
      });

      const output = formatCreatedToken(rawToken, metadata);

      expect(output).toContain("never");
    });

    it("should format expiration date when set", () => {
      const rawToken = "pk_mcp_test123456789012345678901234";
      const metadata = createTestMetadata({
        name: "Temp Token",
        expiresAt: "2025-06-15T12:00:00Z",
      });

      const output = formatCreatedToken(rawToken, metadata);

      // Should contain formatted date
      expect(output).toContain("2025");
      expect(output).toContain("Jun");
    });
  });

  describe("formatTokenRevoked", () => {
    it("should confirm revocation with token name", () => {
      const output = formatTokenRevoked("My Token");

      expect(output).toContain("My Token");
      expect(output).toContain("revoked");
    });

    it("should explain token is no longer valid", () => {
      const output = formatTokenRevoked("Test Token");

      expect(output).toContain("no longer be used");
    });
  });

  describe("formatTokenRotated", () => {
    it("should show old token revocation note", () => {
      const rawToken = "pk_mcp_newtoken12345678901234567";
      const metadata = createTestMetadata({ name: "Rotated Token" });

      const output = formatTokenRotated("Rotated Token", rawToken, metadata);

      expect(output).toContain("revoked");
    });

    it("should show new token value", () => {
      const rawToken = "pk_mcp_newtoken12345678901234567";
      const metadata = createTestMetadata({ name: "Rotated Token" });

      const output = formatTokenRotated("Rotated Token", rawToken, metadata);

      expect(output).toContain(rawToken);
    });

    it("should include warning about saving new token", () => {
      const rawToken = "pk_mcp_newtoken12345678901234567";
      const metadata = createTestMetadata({ name: "Rotated Token" });

      const output = formatTokenRotated("Rotated Token", rawToken, metadata);

      expect(output).toContain("IMPORTANT");
      expect(output).toContain("NOT be shown again");
    });
  });

  describe("formatRevokeConfirmation", () => {
    it("should include token name in prompt", () => {
      const output = formatRevokeConfirmation("Target Token");

      expect(output).toContain("Target Token");
    });

    it("should warn about permanent invalidation", () => {
      const output = formatRevokeConfirmation("Target Token");

      expect(output).toContain("permanently invalidate");
    });

    it("should warn about applications losing access", () => {
      const output = formatRevokeConfirmation("Target Token");

      expect(output).toContain("lose access");
    });
  });
});
