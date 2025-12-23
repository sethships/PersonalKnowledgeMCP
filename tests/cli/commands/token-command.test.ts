/**
 * Tests for Token Command
 *
 * Comprehensive tests for token lifecycle management CLI commands:
 * - create: Generate new tokens
 * - list: List all tokens
 * - revoke: Revoke tokens by name or hash prefix
 * - rotate: Rotate tokens (revoke + regenerate)
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/await-thenable */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { describe, it, expect, beforeEach, vi, afterEach } from "bun:test";
import {
  tokenCreateCommand,
  tokenListCommand,
  tokenRevokeCommand,
  tokenRotateCommand,
  type TokenCreateOptions,
  type TokenListOptions,
  type TokenRevokeOptions,
  type TokenRotateOptions,
} from "../../../src/cli/commands/token-command.js";
import type { CliDependencies } from "../../../src/cli/utils/dependency-init.js";
import type {
  TokenService,
  TokenMetadata,
  GeneratedToken,
  TokenListItem,
} from "../../../src/auth/types.js";

/**
 * Create a mock TokenService with configurable behavior
 */
function createMockTokenService(overrides: Partial<TokenService> = {}): TokenService {
  return {
    generateToken: vi.fn(),
    validateToken: vi.fn(),
    revokeToken: vi.fn(),
    listTokens: vi.fn(),
    hasScopes: vi.fn(),
    hasInstanceAccess: vi.fn(),
    deleteToken: vi.fn(),
    findTokenByName: vi.fn(),
    findTokenByHashPrefix: vi.fn(),
    listAllTokens: vi.fn(),
    ...overrides,
  } as unknown as TokenService;
}

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
 * Create a mock CliDependencies object
 */
function createMockDeps(tokenService: TokenService): CliDependencies {
  return {
    tokenService,
  } as unknown as CliDependencies;
}

describe("Token Commands", () => {
  let capturedLogs: string[];

  beforeEach(() => {
    capturedLogs = [];
    // Use fresh spy for each test
    vi.spyOn(console, "log").mockImplementation((...args: any[]) => {
      capturedLogs.push(args.map((a) => String(a)).join(" "));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("tokenCreateCommand", () => {
    it("should create a token with default options", async () => {
      const mockGenerateToken = vi.fn().mockResolvedValue({
        rawToken: "pk_mcp_test123456789012345678901234",
        tokenHash: "a".repeat(64),
        metadata: createTestMetadata({ name: "My Token" }),
      } as GeneratedToken);

      const tokenService = createMockTokenService({
        generateToken: mockGenerateToken,
      });
      const deps = createMockDeps(tokenService);

      const options: TokenCreateOptions = {
        name: "My Token",
        scopes: ["read"],
        instances: ["public"],
        expires: null,
      };

      await tokenCreateCommand(options, deps);

      expect(mockGenerateToken).toHaveBeenCalledWith({
        name: "My Token",
        scopes: ["read"],
        instanceAccess: ["public"],
        expiresInSeconds: null,
      });

      expect(capturedLogs.length).toBeGreaterThan(0);
      const output = capturedLogs.join("\n");
      expect(output).toContain("pk_mcp_test123456789012345678901234");
    });

    it("should create a token with multiple scopes", async () => {
      const mockGenerateToken = vi.fn().mockResolvedValue({
        rawToken: "pk_mcp_test123456789012345678901234",
        tokenHash: "a".repeat(64),
        metadata: createTestMetadata({
          name: "Admin Token",
          scopes: ["read", "write", "admin"],
        }),
      } as GeneratedToken);

      const tokenService = createMockTokenService({
        generateToken: mockGenerateToken,
      });
      const deps = createMockDeps(tokenService);

      const options: TokenCreateOptions = {
        name: "Admin Token",
        scopes: ["read", "write", "admin"],
        instances: ["public"],
        expires: null,
      };

      await tokenCreateCommand(options, deps);

      expect(mockGenerateToken).toHaveBeenCalledWith({
        name: "Admin Token",
        scopes: ["read", "write", "admin"],
        instanceAccess: ["public"],
        expiresInSeconds: null,
      });
    });

    it("should create a token with expiration", async () => {
      const mockGenerateToken = vi.fn().mockResolvedValue({
        rawToken: "pk_mcp_test123456789012345678901234",
        tokenHash: "a".repeat(64),
        metadata: createTestMetadata({
          name: "Temp Token",
          expiresAt: "2025-01-01T00:00:00Z",
        }),
      } as GeneratedToken);

      const tokenService = createMockTokenService({
        generateToken: mockGenerateToken,
      });
      const deps = createMockDeps(tokenService);

      const options: TokenCreateOptions = {
        name: "Temp Token",
        scopes: ["read"],
        instances: ["public"],
        expires: 86400, // 1 day in seconds
      };

      await tokenCreateCommand(options, deps);

      expect(mockGenerateToken).toHaveBeenCalledWith({
        name: "Temp Token",
        scopes: ["read"],
        instanceAccess: ["public"],
        expiresInSeconds: 86400,
      });
    });

    it("should propagate errors from token service", async () => {
      const mockGenerateToken = vi.fn().mockRejectedValue(new Error("Token generation failed"));

      const tokenService = createMockTokenService({
        generateToken: mockGenerateToken,
      });
      const deps = createMockDeps(tokenService);

      const options: TokenCreateOptions = {
        name: "Failed Token",
        scopes: ["read"],
        instances: ["public"],
        expires: null,
      };

      await expect(tokenCreateCommand(options, deps)).rejects.toThrow("Token generation failed");
    });
  });

  describe("tokenListCommand", () => {
    it("should list active tokens with table output", async () => {
      const mockListTokens = vi.fn().mockResolvedValue([
        {
          hash: "a".repeat(64),
          metadata: createTestMetadata({ name: "Token 1" }),
        },
        {
          hash: "b".repeat(64),
          metadata: createTestMetadata({ name: "Token 2" }),
        },
      ] as TokenListItem[]);

      const tokenService = createMockTokenService({
        listTokens: mockListTokens,
      });
      const deps = createMockDeps(tokenService);

      const options: TokenListOptions = {};

      await tokenListCommand(options, deps);

      expect(mockListTokens).toHaveBeenCalled();
      expect(capturedLogs.length).toBeGreaterThan(0);
      const output = capturedLogs.join("\n");
      expect(output).toContain("Token 1");
      expect(output).toContain("Token 2");
    });

    it("should list tokens as JSON when --json flag is set", async () => {
      const mockListTokens = vi.fn().mockResolvedValue([
        {
          hash: "a".repeat(64),
          metadata: createTestMetadata({ name: "JSON Token" }),
        },
      ] as TokenListItem[]);

      const tokenService = createMockTokenService({
        listTokens: mockListTokens,
      });
      const deps = createMockDeps(tokenService);

      const options: TokenListOptions = { json: true };

      await tokenListCommand(options, deps);

      expect(capturedLogs.length).toBeGreaterThan(0);
      const output = capturedLogs.join("\n");
      const parsed = JSON.parse(output);
      expect(parsed).toHaveProperty("tokens");
      expect(parsed.tokens[0].name).toBe("JSON Token");
    });

    it("should list all tokens including expired/revoked when --all flag is set", async () => {
      const mockListAllTokens = vi.fn().mockResolvedValue([
        {
          hash: "a".repeat(64),
          metadata: createTestMetadata({ name: "Active Token" }),
          isExpired: false,
          isRevoked: false,
        },
        {
          hash: "b".repeat(64),
          metadata: createTestMetadata({ name: "Expired Token" }),
          isExpired: true,
          isRevoked: false,
        },
        {
          hash: "c".repeat(64),
          metadata: createTestMetadata({ name: "Revoked Token" }),
          isExpired: false,
          isRevoked: true,
        },
      ]);

      const tokenService = createMockTokenService({
        listAllTokens: mockListAllTokens,
      });
      const deps = createMockDeps(tokenService);

      const options: TokenListOptions = { all: true };

      await tokenListCommand(options, deps);

      expect(mockListAllTokens).toHaveBeenCalled();
      expect(capturedLogs.length).toBeGreaterThan(0);
      const output = capturedLogs.join("\n");
      expect(output).toContain("Active Token");
      expect(output).toContain("Expired Token");
      expect(output).toContain("Revoked Token");
    });

    it("should show helpful message when no tokens exist", async () => {
      const mockListTokens = vi.fn().mockResolvedValue([]);

      const tokenService = createMockTokenService({
        listTokens: mockListTokens,
      });
      const deps = createMockDeps(tokenService);

      const options: TokenListOptions = {};

      await tokenListCommand(options, deps);

      expect(capturedLogs.length).toBeGreaterThan(0);
      const output = capturedLogs.join("\n");
      expect(output).toContain("No tokens found");
    });
  });

  describe("tokenRevokeCommand", () => {
    it("should revoke a token by name with --force", async () => {
      const mockFindTokenByName = vi.fn().mockResolvedValue({
        hash: "a".repeat(64),
        metadata: createTestMetadata({ name: "Target Token" }),
      } as TokenListItem);

      const mockRevokeToken = vi.fn().mockResolvedValue(true);

      const tokenService = createMockTokenService({
        findTokenByName: mockFindTokenByName,
        revokeToken: mockRevokeToken,
      });
      const deps = createMockDeps(tokenService);

      const options: TokenRevokeOptions = {
        name: "Target Token",
        force: true,
      };

      await tokenRevokeCommand(options, deps);

      expect(mockFindTokenByName).toHaveBeenCalledWith("Target Token");
      expect(mockRevokeToken).toHaveBeenCalledWith("a".repeat(64));
      expect(capturedLogs.length).toBeGreaterThan(0);
      const output = capturedLogs.join("\n");
      expect(output).toContain("revoked");
    });

    it("should revoke a token by hash prefix with --force", async () => {
      const mockFindTokenByHashPrefix = vi.fn().mockResolvedValue([
        {
          hash: "a1b2c3d4" + "0".repeat(56),
          metadata: createTestMetadata({ name: "Hash Token" }),
        },
      ] as TokenListItem[]);

      const mockRevokeToken = vi.fn().mockResolvedValue(true);

      const tokenService = createMockTokenService({
        findTokenByHashPrefix: mockFindTokenByHashPrefix,
        revokeToken: mockRevokeToken,
      });
      const deps = createMockDeps(tokenService);

      const options: TokenRevokeOptions = {
        id: "a1b2c3d4",
        force: true,
      };

      await tokenRevokeCommand(options, deps);

      expect(mockFindTokenByHashPrefix).toHaveBeenCalledWith("a1b2c3d4");
      expect(mockRevokeToken).toHaveBeenCalled();
    });

    it("should throw error when token not found by name", async () => {
      const mockFindTokenByName = vi.fn().mockResolvedValue(undefined);

      const tokenService = createMockTokenService({
        findTokenByName: mockFindTokenByName,
      });
      const deps = createMockDeps(tokenService);

      const options: TokenRevokeOptions = {
        name: "Nonexistent Token",
        force: true,
      };

      await expect(tokenRevokeCommand(options, deps)).rejects.toThrow(
        "Token 'Nonexistent Token' not found"
      );
    });

    it("should throw error when multiple tokens match hash prefix", async () => {
      const mockFindTokenByHashPrefix = vi.fn().mockResolvedValue([
        {
          hash: "a1b2c3d4" + "0".repeat(56),
          metadata: createTestMetadata({ name: "Token 1" }),
        },
        {
          hash: "a1b2c3d5" + "0".repeat(56),
          metadata: createTestMetadata({ name: "Token 2" }),
        },
      ] as TokenListItem[]);

      const tokenService = createMockTokenService({
        findTokenByHashPrefix: mockFindTokenByHashPrefix,
      });
      const deps = createMockDeps(tokenService);

      const options: TokenRevokeOptions = {
        id: "a1b2c3d",
        force: true,
      };

      await expect(tokenRevokeCommand(options, deps)).rejects.toThrow("Multiple tokens match");
    });

    it("should throw error when no hash matches prefix", async () => {
      const mockFindTokenByHashPrefix = vi.fn().mockResolvedValue([]);

      const tokenService = createMockTokenService({
        findTokenByHashPrefix: mockFindTokenByHashPrefix,
      });
      const deps = createMockDeps(tokenService);

      const options: TokenRevokeOptions = {
        id: "nonexistent",
        force: true,
      };

      await expect(tokenRevokeCommand(options, deps)).rejects.toThrow(
        "No token found with hash prefix"
      );
    });

    it("should throw error when neither name nor id provided", async () => {
      const tokenService = createMockTokenService();
      const deps = createMockDeps(tokenService);

      const options: TokenRevokeOptions = {
        force: true,
      };

      await expect(tokenRevokeCommand(options, deps)).rejects.toThrow(
        "Either --name or --id must be provided"
      );
    });

    it("should throw error when revoke fails", async () => {
      const mockFindTokenByName = vi.fn().mockResolvedValue({
        hash: "a".repeat(64),
        metadata: createTestMetadata({ name: "Target Token" }),
      } as TokenListItem);

      const mockRevokeToken = vi.fn().mockResolvedValue(false);

      const tokenService = createMockTokenService({
        findTokenByName: mockFindTokenByName,
        revokeToken: mockRevokeToken,
      });
      const deps = createMockDeps(tokenService);

      const options: TokenRevokeOptions = {
        name: "Target Token",
        force: true,
      };

      await expect(tokenRevokeCommand(options, deps)).rejects.toThrow("Failed to revoke token");
    });
  });

  describe("tokenRotateCommand", () => {
    it("should rotate a token successfully", async () => {
      const oldMetadata = createTestMetadata({
        name: "Rotate Token",
        scopes: ["read", "write"],
        instanceAccess: ["work", "public"],
      });

      const mockFindTokenByName = vi.fn().mockResolvedValue({
        hash: "old".repeat(21) + "d",
        metadata: oldMetadata,
      } as TokenListItem);

      const mockRevokeToken = vi.fn().mockResolvedValue(true);

      const mockGenerateToken = vi.fn().mockResolvedValue({
        rawToken: "pk_mcp_newtoken12345678901234567",
        tokenHash: "new".repeat(21) + "w",
        metadata: createTestMetadata({
          name: "Rotate Token",
          scopes: ["read", "write"],
          instanceAccess: ["work", "public"],
        }),
      } as GeneratedToken);

      const tokenService = createMockTokenService({
        findTokenByName: mockFindTokenByName,
        revokeToken: mockRevokeToken,
        generateToken: mockGenerateToken,
      });
      const deps = createMockDeps(tokenService);

      const options: TokenRotateOptions = {
        name: "Rotate Token",
      };

      await tokenRotateCommand(options, deps);

      // Should find the existing token
      expect(mockFindTokenByName).toHaveBeenCalledWith("Rotate Token");

      // Should revoke the old token
      expect(mockRevokeToken).toHaveBeenCalledWith("old".repeat(21) + "d");

      // Should create a new token with the same metadata
      expect(mockGenerateToken).toHaveBeenCalledWith({
        name: "Rotate Token",
        scopes: ["read", "write"],
        instanceAccess: ["work", "public"],
        expiresInSeconds: null, // Expiration reset on rotation
      });

      // Should output the new token
      expect(capturedLogs.length).toBeGreaterThan(0);
      const output = capturedLogs.join("\n");
      expect(output).toContain("pk_mcp_newtoken12345678901234567");
    });

    it("should throw error when token to rotate not found", async () => {
      const mockFindTokenByName = vi.fn().mockResolvedValue(undefined);

      const tokenService = createMockTokenService({
        findTokenByName: mockFindTokenByName,
      });
      const deps = createMockDeps(tokenService);

      const options: TokenRotateOptions = {
        name: "Nonexistent Token",
      };

      await expect(tokenRotateCommand(options, deps)).rejects.toThrow(
        "Token 'Nonexistent Token' not found"
      );
    });

    it("should throw error when revoke fails during rotation", async () => {
      const mockFindTokenByName = vi.fn().mockResolvedValue({
        hash: "a".repeat(64),
        metadata: createTestMetadata({ name: "Rotate Token" }),
      } as TokenListItem);

      const mockRevokeToken = vi.fn().mockResolvedValue(false);

      const tokenService = createMockTokenService({
        findTokenByName: mockFindTokenByName,
        revokeToken: mockRevokeToken,
      });
      const deps = createMockDeps(tokenService);

      const options: TokenRotateOptions = {
        name: "Rotate Token",
      };

      await expect(tokenRotateCommand(options, deps)).rejects.toThrow(
        "Failed to revoke existing token"
      );
    });
  });
});
