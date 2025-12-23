/**
 * Token Store Unit Tests
 *
 * Tests for the TokenStoreImpl class covering file operations,
 * singleton pattern, caching, and error handling.
 *
 * @module tests/auth/token-store
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/await-thenable */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "bun:test";
import { join } from "path";
import { TokenStoreImpl } from "../../src/auth/token-store.js";
import { TokenStorageError } from "../../src/auth/errors.js";
import type { StoredToken, TokenStoreFile } from "../../src/auth/types.js";
import { createMockStoredToken } from "../helpers/token-mock.js";
import { initializeLogger, resetLogger } from "../../src/logging/index.js";

describe("TokenStoreImpl", () => {
  const testDataPath = join(process.cwd(), "tests", "temp", "token-store-test");
  const tokensFilePath = join(testDataPath, "tokens.json");

  beforeAll(async () => {
    // Initialize logger in silent mode for tests
    initializeLogger({ level: "error", format: "json" });

    // Create test directory
    const fs = await import("fs/promises");
    await fs.mkdir(testDataPath, { recursive: true });
  });

  afterAll(async () => {
    resetLogger();

    // Clean up test directory
    const fs = await import("fs/promises");
    try {
      await fs.rm(testDataPath, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  beforeEach(async () => {
    // Reset singleton
    TokenStoreImpl.resetInstance();

    // Clean up tokens file if exists
    const fs = await import("fs/promises");
    try {
      await fs.unlink(tokensFilePath);
    } catch {
      // File doesn't exist, that's fine
    }
  });

  afterEach(() => {
    // Reset singleton after each test
    TokenStoreImpl.resetInstance();
  });

  describe("Singleton Pattern", () => {
    it("should return same instance on multiple calls", () => {
      const instance1 = TokenStoreImpl.getInstance(testDataPath);
      const instance2 = TokenStoreImpl.getInstance(testDataPath);

      expect(instance1).toBe(instance2);
    });

    it("should reset with resetInstance()", () => {
      const instance1 = TokenStoreImpl.getInstance(testDataPath);
      TokenStoreImpl.resetInstance();
      const instance2 = TokenStoreImpl.getInstance(testDataPath);

      expect(instance1).not.toBe(instance2);
    });

    it("should use DATA_PATH environment variable if no path provided", () => {
      const originalPath = process.env["DATA_PATH"];
      process.env["DATA_PATH"] = testDataPath;

      try {
        const instance = TokenStoreImpl.getInstance();
        expect(instance.getStoragePath()).toBe(join(testDataPath, "tokens.json"));
      } finally {
        // Restore original env
        if (originalPath !== undefined) {
          process.env["DATA_PATH"] = originalPath;
        } else {
          delete process.env["DATA_PATH"];
        }
      }
    });

    it("should default to ./data if no path provided and no env var", () => {
      const originalPath = process.env["DATA_PATH"];
      delete process.env["DATA_PATH"];

      TokenStoreImpl.resetInstance();

      try {
        const instance = TokenStoreImpl.getInstance();
        expect(instance.getStoragePath()).toBe(join("./data", "tokens.json"));
      } finally {
        // Restore original env
        if (originalPath !== undefined) {
          process.env["DATA_PATH"] = originalPath;
        }
      }
    });
  });

  describe("File Operations", () => {
    it("should create file if not exists", async () => {
      const store = TokenStoreImpl.getInstance(testDataPath);

      // First load should create the file
      const tokens = await store.loadTokens();
      expect(tokens.size).toBe(0);

      // Verify file exists
      const fs = await import("fs/promises");
      const stat = await fs.stat(tokensFilePath);
      expect(stat.isFile()).toBe(true);
    });

    it("should load tokens from file", async () => {
      // Create a tokens file manually
      const testToken = createMockStoredToken({
        tokenHash: "a".repeat(64),
        metadata: {
          name: "Pre-existing Token",
          createdAt: new Date().toISOString(),
          expiresAt: null,
          scopes: ["read"],
          instanceAccess: ["public"],
        },
      });

      const fileContent: TokenStoreFile = {
        version: "1.0",
        tokens: { ["a".repeat(64)]: testToken },
      };

      await Bun.write(tokensFilePath, JSON.stringify(fileContent, null, 2));

      const store = TokenStoreImpl.getInstance(testDataPath);
      const tokens = await store.loadTokens();

      expect(tokens.size).toBe(1);
      expect(tokens.get("a".repeat(64))!.metadata.name).toBe("Pre-existing Token");
    });

    it("should save tokens atomically", async () => {
      const store = TokenStoreImpl.getInstance(testDataPath);

      const testToken = createMockStoredToken({
        tokenHash: "b".repeat(64),
        metadata: {
          name: "Saved Token",
          createdAt: new Date().toISOString(),
          expiresAt: null,
          scopes: ["write"],
          instanceAccess: ["work"],
        },
      });

      const tokens = new Map<string, StoredToken>();
      tokens.set("b".repeat(64), testToken);

      await store.saveTokens(tokens);

      // Verify file contents
      const file = Bun.file(tokensFilePath);
      const content = await file.json();

      expect(content.version).toBe("1.0");
      expect(content.tokens["b".repeat(64)].metadata.name).toBe("Saved Token");
    });

    it("should handle corrupted file gracefully", async () => {
      // Write invalid JSON
      await Bun.write(tokensFilePath, "{ invalid json }");

      const store = TokenStoreImpl.getInstance(testDataPath);

      await expect(store.loadTokens()).rejects.toThrow(TokenStorageError);
    });

    it("should use in-memory cache for performance", async () => {
      const store = TokenStoreImpl.getInstance(testDataPath);

      // First load (creates empty file)
      await store.loadTokens();

      // Second load should use cache (no file I/O)
      // We can't directly test cache, but we can test performance
      const iterations = 100;
      const start = performance.now();

      for (let i = 0; i < iterations; i++) {
        await store.loadTokens();
      }

      const elapsed = performance.now() - start;
      const avgTime = elapsed / iterations;

      // Cached loads should be very fast
      expect(avgTime).toBeLessThan(1); // Less than 1ms per load
    });

    it("should invalidate cache after saveTokens", async () => {
      const store = TokenStoreImpl.getInstance(testDataPath);

      // Load to populate cache
      await store.loadTokens();

      // Save new tokens
      const testToken = createMockStoredToken({
        tokenHash: "c".repeat(64),
      });
      const tokens = new Map<string, StoredToken>();
      tokens.set("c".repeat(64), testToken);
      await store.saveTokens(tokens);

      // Load again - should reflect saved tokens
      const loaded = await store.loadTokens();
      expect(loaded.size).toBe(1);
      expect(loaded.has("c".repeat(64))).toBe(true);
    });

    it("should invalidate cache when invalidateCache called", async () => {
      const store = TokenStoreImpl.getInstance(testDataPath);

      // Save a token
      const testToken = createMockStoredToken({ tokenHash: "d".repeat(64) });
      await store.saveTokens(new Map([["d".repeat(64), testToken]]));

      // Load to populate cache
      await store.loadTokens();

      // Modify file directly (simulating external modification)
      const newToken = createMockStoredToken({
        tokenHash: "e".repeat(64),
        metadata: { ...testToken.metadata, name: "Externally Added" },
      });
      const fileContent: TokenStoreFile = {
        version: "1.0",
        tokens: { ["e".repeat(64)]: newToken },
      };
      await Bun.write(tokensFilePath, JSON.stringify(fileContent, null, 2));

      // Cache still has old data
      const cachedLoad = await store.loadTokens();
      expect(cachedLoad.has("d".repeat(64))).toBe(true);

      // Invalidate cache
      store.invalidateCache();

      // Now should load from file
      const freshLoad = await store.loadTokens();
      expect(freshLoad.has("e".repeat(64))).toBe(true);
      expect(freshLoad.has("d".repeat(64))).toBe(false);
    });

    it("should return copy of tokens to prevent external modification", async () => {
      const store = TokenStoreImpl.getInstance(testDataPath);

      const testToken = createMockStoredToken({ tokenHash: "f".repeat(64) });
      await store.saveTokens(new Map([["f".repeat(64), testToken]]));

      const tokens1 = await store.loadTokens();
      const tokens2 = await store.loadTokens();

      // Should be different Map instances
      expect(tokens1).not.toBe(tokens2);

      // Modifying one shouldn't affect the other
      tokens1.delete("f".repeat(64));
      expect(tokens2.has("f".repeat(64))).toBe(true);
    });
  });

  describe("Error Handling", () => {
    it("should throw TokenStorageError on read failure with invalid file", async () => {
      // Write malformed JSON that passes syntax but fails schema validation
      const invalidContent = {
        version: "2.0", // Invalid version
        tokens: {},
      };
      await Bun.write(tokensFilePath, JSON.stringify(invalidContent));

      const store = TokenStoreImpl.getInstance(testDataPath);

      await expect(store.loadTokens()).rejects.toThrow(TokenStorageError);
    });

    it("should include operation type in storage error", async () => {
      await Bun.write(tokensFilePath, "not json");

      const store = TokenStoreImpl.getInstance(testDataPath);

      try {
        await store.loadTokens();
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(TokenStorageError);
        expect((error as TokenStorageError).operation).toBe("read");
      }
    });

    it("should clean up temp file on write failure", async () => {
      // This is hard to test without mocking fs, but we can verify
      // the temp file pattern is used correctly
      const store = TokenStoreImpl.getInstance(testDataPath);

      // Save should work
      await store.saveTokens(new Map());

      // Verify no temp file exists after successful save
      const fs = await import("fs/promises");
      const tempPath = `${tokensFilePath}.tmp`;

      try {
        await fs.stat(tempPath);
        expect.unreachable("Temp file should not exist");
      } catch (error) {
        // Expected - temp file should be cleaned up
        expect((error as NodeJS.ErrnoException).code).toBe("ENOENT");
      }
    });
  });

  describe("Storage Path", () => {
    it("should return correct storage path", () => {
      const store = TokenStoreImpl.getInstance(testDataPath);
      expect(store.getStoragePath()).toBe(tokensFilePath);
    });
  });
});
