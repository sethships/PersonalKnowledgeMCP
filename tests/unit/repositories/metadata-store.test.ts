/* eslint-disable @typescript-eslint/await-thenable */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

/**
 * Unit tests for RepositoryMetadataStoreImpl
 *
 * Tests all methods of the repository metadata store using mocked file operations
 * to ensure 90%+ code coverage and correct behavior without actual file I/O.
 *
 * @module tests/unit/repositories/metadata-store.test.ts
 */

import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import {
  RepositoryMetadataStoreImpl,
  sanitizeCollectionName,
  addHistoryEntry,
} from "../../../src/repositories/metadata-store.js";
import {
  RepositoryMetadataError,
  RepositoryNotFoundError,
  FileOperationError,
  InvalidMetadataFormatError,
} from "../../../src/repositories/errors.js";
import type { RepositoryInfo, UpdateHistoryEntry } from "../../../src/repositories/types.js";
import {
  createTestRepositoryInfo,
  edgeCaseRepositoryNames,
} from "../../fixtures/repository-fixtures.js";
import { initializeLogger, resetLogger } from "../../../src/logging/index.js";

describe("RepositoryMetadataStoreImpl", () => {
  beforeEach(() => {
    // Initialize logger before each test
    initializeLogger({
      level: "info",
      format: "json",
    });

    // Reset singleton instance for each test
    RepositoryMetadataStoreImpl.resetInstance();
  });

  afterEach(() => {
    // Reset logger after each test
    resetLogger();

    // Ensure singleton is reset
    RepositoryMetadataStoreImpl.resetInstance();
  });

  describe("Singleton Pattern", () => {
    test("should return same instance on multiple getInstance calls", () => {
      const instance1 = RepositoryMetadataStoreImpl.getInstance();
      const instance2 = RepositoryMetadataStoreImpl.getInstance();

      expect(instance1).toBe(instance2);
    });

    test("should use default data path when not specified", () => {
      const instance = RepositoryMetadataStoreImpl.getInstance();
      expect(instance).toBeDefined();
    });

    test("should use custom data path on first getInstance call", () => {
      const customPath = "/custom/data/path";
      const instance = RepositoryMetadataStoreImpl.getInstance(customPath);
      expect(instance).toBeDefined();
    });

    test("should reset instance with resetInstance()", () => {
      const instance1 = RepositoryMetadataStoreImpl.getInstance();
      RepositoryMetadataStoreImpl.resetInstance();
      const instance2 = RepositoryMetadataStoreImpl.getInstance();

      // Should be different instances after reset
      expect(instance1).not.toBe(instance2);
    });
  });

  describe("sanitizeCollectionName()", () => {
    test("should convert to lowercase", () => {
      expect(sanitizeCollectionName("MyAPI")).toBe("repo_myapi");
      expect(sanitizeCollectionName(edgeCaseRepositoryNames.uppercase)).toBe("repo_uppercase_repo");
    });

    test("should replace special characters with underscores", () => {
      expect(sanitizeCollectionName("my-api")).toBe("repo_my_api");
      expect(sanitizeCollectionName("my.api")).toBe("repo_my_api");
      expect(sanitizeCollectionName("my@api#test")).toBe("repo_my_api_test");
    });

    test("should collapse multiple consecutive underscores", () => {
      expect(sanitizeCollectionName("test___name")).toBe("repo_test_name");
      expect(sanitizeCollectionName(edgeCaseRepositoryNames.consecutiveSpecialChars)).toBe(
        "repo_test_repo_name_final"
      );
    });

    test("should remove leading and trailing underscores", () => {
      expect(sanitizeCollectionName("_test_")).toBe("repo_test");
      expect(sanitizeCollectionName("___test___")).toBe("repo_test");
    });

    test("should add repo_ prefix", () => {
      expect(sanitizeCollectionName("api")).toBe("repo_api");
      expect(sanitizeCollectionName("test123")).toBe("repo_test123");
    });

    test("should truncate to 63 characters", () => {
      const longName = edgeCaseRepositoryNames.veryLong;
      const sanitized = sanitizeCollectionName(longName);

      expect(sanitized.length).toBeLessThanOrEqual(63);
      expect(sanitized.startsWith("repo_")).toBe(true);
    });

    test("should handle mixed case with numbers", () => {
      expect(sanitizeCollectionName(edgeCaseRepositoryNames.mixedCase)).toBe(
        "repo_myapp123_v2_0_final"
      );
    });

    test("should handle names with spaces", () => {
      expect(sanitizeCollectionName(edgeCaseRepositoryNames.withSpaces)).toBe(
        "repo_my_project_name"
      );
    });

    test("should preserve allowed characters (alphanumeric and underscore)", () => {
      expect(sanitizeCollectionName("test_123")).toBe("repo_test_123");
      expect(sanitizeCollectionName("abc123")).toBe("repo_abc123");
    });
  });

  describe("Error Classes", () => {
    describe("RepositoryMetadataError", () => {
      test("should create error with message and code", () => {
        const error = new RepositoryMetadataError("Test error", "TEST_CODE");
        expect(error.message).toBe("Test error");
        expect(error.code).toBe("TEST_CODE");
        expect(error.name).toBe("RepositoryMetadataError");
      });

      test("should use default code if not provided", () => {
        const error = new RepositoryMetadataError("Test error");
        expect(error.code).toBe("REPOSITORY_METADATA_ERROR");
      });

      test("should chain cause errors", () => {
        const cause = new Error("Original error");
        const error = new RepositoryMetadataError("Wrapped error", "TEST", cause);

        expect(error.cause).toBe(cause);
        expect(error.stack).toContain("Caused by:");
      });

      test("should capture stack trace", () => {
        const error = new RepositoryMetadataError("Test");
        expect(error.stack).toBeDefined();
        expect(error.stack).toContain("RepositoryMetadataError");
      });
    });

    describe("RepositoryNotFoundError", () => {
      test("should create error with repository name", () => {
        const error = new RepositoryNotFoundError("my-api");
        expect(error.repositoryName).toBe("my-api");
        expect(error.message).toContain("my-api");
        expect(error.code).toBe("REPOSITORY_NOT_FOUND");
        expect(error.name).toBe("RepositoryNotFoundError");
      });

      test("should use custom message if provided", () => {
        const customMessage = "Custom error message";
        const error = new RepositoryNotFoundError("my-api", customMessage);
        expect(error.message).toBe(customMessage);
      });
    });

    describe("FileOperationError", () => {
      test("should create error with operation type", () => {
        const error = new FileOperationError("read", "Failed to read file");
        expect(error.operation).toBe("read");
        expect(error.message).toBe("Failed to read file");
        expect(error.code).toBe("FILE_OPERATION_ERROR");
        expect(error.name).toBe("FileOperationError");
      });

      test("should support all operation types", () => {
        const readError = new FileOperationError("read", "Read failed");
        const writeError = new FileOperationError("write", "Write failed");
        const deleteError = new FileOperationError("delete", "Delete failed");

        expect(readError.operation).toBe("read");
        expect(writeError.operation).toBe("write");
        expect(deleteError.operation).toBe("delete");
      });

      test("should chain cause errors", () => {
        const cause = new Error("Original file error");
        const error = new FileOperationError("write", "Failed", cause);
        expect(error.cause).toBe(cause);
      });
    });

    describe("InvalidMetadataFormatError", () => {
      test("should create error with message", () => {
        const error = new InvalidMetadataFormatError("Invalid JSON");
        expect(error.message).toBe("Invalid JSON");
        expect(error.code).toBe("INVALID_METADATA_FORMAT");
        expect(error.name).toBe("InvalidMetadataFormatError");
      });

      test("should chain cause errors", () => {
        const cause = new SyntaxError("Unexpected token");
        const error = new InvalidMetadataFormatError("Parse failed", cause);
        expect(error.cause).toBe(cause);
      });
    });
  });

  describe("addHistoryEntry()", () => {
    const createMockEntry = (
      timestamp: string,
      commits: { prev: string; new: string }
    ): UpdateHistoryEntry => ({
      timestamp,
      previousCommit: commits.prev,
      newCommit: commits.new,
      filesAdded: 1,
      filesModified: 2,
      filesDeleted: 0,
      chunksUpserted: 15,
      chunksDeleted: 3,
      durationMs: 1000,
      errorCount: 0,
      status: "success" as const,
    });

    test("should add first entry to empty history", () => {
      const entry = createMockEntry("2024-12-15T10:00:00.000Z", {
        prev: "abc123",
        new: "def456",
      });

      const result = addHistoryEntry(undefined, entry, 20);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(entry);
    });

    test("should prepend new entry (newest first ordering)", () => {
      const entry1 = createMockEntry("2024-12-15T10:00:00.000Z", {
        prev: "abc123",
        new: "def456",
      });
      const entry2 = createMockEntry("2024-12-15T11:00:00.000Z", {
        prev: "def456",
        new: "ghi789",
      });

      const history = addHistoryEntry(undefined, entry1, 20);
      const result = addHistoryEntry(history, entry2, 20);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(entry2); // Newest first
      expect(result[1]).toEqual(entry1); // Older second
    });

    test("should rotate oldest entry when limit exceeded", () => {
      // Create history with 3 entries
      const entry1 = createMockEntry("2024-12-15T10:00:00.000Z", {
        prev: "aaa",
        new: "bbb",
      });
      const entry2 = createMockEntry("2024-12-15T11:00:00.000Z", {
        prev: "bbb",
        new: "ccc",
      });
      const entry3 = createMockEntry("2024-12-15T12:00:00.000Z", {
        prev: "ccc",
        new: "ddd",
      });

      let history = addHistoryEntry(undefined, entry1, 3);
      history = addHistoryEntry(history, entry2, 3);
      history = addHistoryEntry(history, entry3, 3);

      expect(history).toHaveLength(3);

      // Add 4th entry with limit=3, should drop oldest (entry1)
      const entry4 = createMockEntry("2024-12-15T13:00:00.000Z", {
        prev: "ddd",
        new: "eee",
      });
      const result = addHistoryEntry(history, entry4, 3);

      expect(result).toHaveLength(3); // Still 3 entries
      expect(result[0]).toEqual(entry4); // Newest
      expect(result[1]).toEqual(entry3);
      expect(result[2]).toEqual(entry2);
      expect(result.find((e) => e.timestamp === entry1.timestamp)).toBeUndefined(); // entry1 dropped
    });

    test("should handle custom limit of 5", () => {
      const entries = Array.from({ length: 10 }, (_, i) =>
        createMockEntry(`2024-12-15T${String(10 + i).padStart(2, "0")}:00:00.000Z`, {
          prev: `commit${i}`,
          new: `commit${i + 1}`,
        })
      );

      const firstEntry = entries[0];
      if (!firstEntry) throw new Error("First entry is undefined");

      let history = addHistoryEntry(undefined, firstEntry, 5);
      for (let i = 1; i < entries.length; i++) {
        const entry = entries[i];
        if (!entry) throw new Error(`Entry at index ${i} is undefined`);
        history = addHistoryEntry(history, entry, 5);
      }

      expect(history).toHaveLength(5); // Limit enforced
      // Should contain last 5 entries (newest first)
      expect(history[0]).toEqual(entries[9]);
      expect(history[4]).toEqual(entries[5]);
    });

    test("should handle custom limit of 1", () => {
      const entry1 = createMockEntry("2024-12-15T10:00:00.000Z", {
        prev: "aaa",
        new: "bbb",
      });
      const entry2 = createMockEntry("2024-12-15T11:00:00.000Z", {
        prev: "bbb",
        new: "ccc",
      });

      let history = addHistoryEntry(undefined, entry1, 1);
      expect(history).toHaveLength(1);

      history = addHistoryEntry(history, entry2, 1);
      expect(history).toHaveLength(1);
      expect(history[0]).toEqual(entry2); // Only newest remains
    });

    test("should not mutate input array (immutability)", () => {
      const entry1 = createMockEntry("2024-12-15T10:00:00.000Z", {
        prev: "aaa",
        new: "bbb",
      });
      const entry2 = createMockEntry("2024-12-15T11:00:00.000Z", {
        prev: "bbb",
        new: "ccc",
      });

      const originalHistory = [entry1];
      const result = addHistoryEntry(originalHistory, entry2, 20);

      // Original should be unchanged
      expect(originalHistory).toHaveLength(1);
      expect(originalHistory[0]).toEqual(entry1);

      // Result should be new array with 2 entries
      expect(result).toHaveLength(2);
      expect(result).not.toBe(originalHistory);
    });

    test("should handle limit of 0 (no history retention)", () => {
      const entry = createMockEntry("2024-12-15T10:00:00.000Z", {
        prev: "aaa",
        new: "bbb",
      });

      const result = addHistoryEntry(undefined, entry, 0);
      expect(result).toHaveLength(0); // Immediately rotated out
    });

    test("should use default limit of 20 when not specified", () => {
      const entry = createMockEntry("2024-12-15T10:00:00.000Z", {
        prev: "aaa",
        new: "bbb",
      });

      const result = addHistoryEntry(undefined, entry); // No limit specified
      expect(result).toHaveLength(1);

      // Add 21 entries to test default limit
      let history = result;
      for (let i = 1; i < 25; i++) {
        const newEntry = createMockEntry(
          `2024-12-15T${String(10 + i).padStart(2, "0")}:00:00.000Z`,
          {
            prev: `commit${i}`,
            new: `commit${i + 1}`,
          }
        );
        history = addHistoryEntry(history, newEntry);
      }

      expect(history).toHaveLength(20); // Default limit enforced
    });

    test("should preserve entry status field correctly", () => {
      const successEntry = {
        ...createMockEntry("2024-12-15T10:00:00.000Z", { prev: "a", new: "b" }),
        status: "success" as const,
      };
      const partialEntry = {
        ...createMockEntry("2024-12-15T11:00:00.000Z", { prev: "b", new: "c" }),
        status: "partial" as const,
        errorCount: 2,
      };
      const failedEntry = {
        ...createMockEntry("2024-12-15T12:00:00.000Z", { prev: "c", new: "d" }),
        status: "failed" as const,
        errorCount: 10,
      };

      let history = addHistoryEntry(undefined, successEntry, 10);
      history = addHistoryEntry(history, partialEntry, 10);
      history = addHistoryEntry(history, failedEntry, 10);

      expect(history[0]?.status).toBe("failed");
      expect(history[1]?.status).toBe("partial");
      expect(history[2]?.status).toBe("success");
    });
  });
});

// Note: CRUD operation tests are covered by integration tests
// Unit tests with mocked file I/O are not feasible in Bun due to readonly global.Bun
// Integration tests provide more value by testing real file operations

describe("source discriminator + back-compat round-trip", () => {
  let tmpDir: string;

  beforeEach(() => {
    initializeLogger({ level: "silent", format: "json" });
    RepositoryMetadataStoreImpl.resetInstance();
    tmpDir = path.join(
      os.tmpdir(),
      `metadata-store-source-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    RepositoryMetadataStoreImpl.resetInstance();
    resetLogger();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test.each(["git-remote", "local-git", "local-folder"] as const)(
    "round-trips source value %s",
    async (source) => {
      const store = RepositoryMetadataStoreImpl.getInstance(tmpDir);
      const repo = createTestRepositoryInfo("rt-source", {
        source,
        url: source === "local-folder" ? null : "https://github.com/x/y.git",
      });

      await store.updateRepository(repo);

      // Reset singleton to force a re-read from disk
      RepositoryMetadataStoreImpl.resetInstance();
      const store2 = RepositoryMetadataStoreImpl.getInstance(tmpDir);
      const reloaded = await store2.getRepository("rt-source");

      expect(reloaded).not.toBeNull();
      expect(reloaded?.source).toBe(source);
      expect(reloaded?.url).toBe(source === "local-folder" ? null : "https://github.com/x/y.git");
    }
  );

  test("synthesizes source=git-remote when persisted record has no source field", async () => {
    // Hand-write a legacy-shape repositories.json (pre-source-discriminator)
    const legacyFile = {
      version: "1.0",
      repositories: {
        "legacy-repo": {
          name: "legacy-repo",
          // NB: no `source` field — simulates data persisted before T1.1
          url: "https://github.com/legacy/repo.git",
          localPath: "./data/repos/legacy-repo",
          collectionName: "repo_legacy_repo",
          fileCount: 50,
          chunkCount: 200,
          lastIndexedAt: "2024-01-01T00:00:00.000Z",
          indexDurationMs: 1000,
          status: "ready",
          branch: "main",
          includeExtensions: [".ts"],
          excludePatterns: ["node_modules/**"],
        },
      },
    };
    fs.writeFileSync(
      path.join(tmpDir, "repositories.json"),
      JSON.stringify(legacyFile, null, 2),
      "utf-8"
    );

    const store = RepositoryMetadataStoreImpl.getInstance(tmpDir);
    const reloaded = await store.getRepository("legacy-repo");

    expect(reloaded).not.toBeNull();
    expect(reloaded?.source).toBe("git-remote");
    expect(reloaded?.url).toBe("https://github.com/legacy/repo.git");
  });

  test("synthesizes source on listRepositories too", async () => {
    const legacyFile = {
      version: "1.0",
      repositories: {
        a: { ...buildLegacyRepoRecord("a") },
        b: { ...buildLegacyRepoRecord("b") },
      },
    };
    fs.writeFileSync(
      path.join(tmpDir, "repositories.json"),
      JSON.stringify(legacyFile, null, 2),
      "utf-8"
    );

    const store = RepositoryMetadataStoreImpl.getInstance(tmpDir);
    const all = await store.listRepositories();

    expect(all).toHaveLength(2);
    for (const repo of all) {
      expect(repo.source).toBe("git-remote");
    }
  });

  test("round-trips url=null when source is local-folder", async () => {
    const store = RepositoryMetadataStoreImpl.getInstance(tmpDir);
    const repo = createTestRepositoryInfo("local-folder-repo", {
      source: "local-folder",
      url: null,
      lastManifestId: "repo_local_folder_repo",
    });

    await store.updateRepository(repo);
    RepositoryMetadataStoreImpl.resetInstance();
    const store2 = RepositoryMetadataStoreImpl.getInstance(tmpDir);
    const reloaded = await store2.getRepository("local-folder-repo");

    expect(reloaded?.source).toBe("local-folder");
    expect(reloaded?.url).toBeNull();
    expect(reloaded?.lastManifestId).toBe("repo_local_folder_repo");
  });

  test("validation rejects url=null when source is git-remote", async () => {
    const store = RepositoryMetadataStoreImpl.getInstance(tmpDir);
    const repo = createTestRepositoryInfo("bad-repo", {
      source: "git-remote",
      // Cast: deliberately violating the type contract to exercise the runtime guard
      url: null as unknown as string,
    });

    await expect(store.updateRepository(repo)).rejects.toThrow(RepositoryMetadataError);
  });

  test("validation rejects an unknown source value", async () => {
    const store = RepositoryMetadataStoreImpl.getInstance(tmpDir);
    const repo = createTestRepositoryInfo("bad-source", {
      // Cast: deliberately violating the type contract to exercise the runtime guard
      source: "bogus" as unknown as RepositoryInfo["source"],
    });

    await expect(store.updateRepository(repo)).rejects.toThrow(RepositoryMetadataError);
  });

  test.each(["private", "work", "public"] as const)("round-trips tier value %s", async (tier) => {
    const store = RepositoryMetadataStoreImpl.getInstance(tmpDir);
    const repo = createTestRepositoryInfo("tier-repo", { tier });
    await store.updateRepository(repo);

    RepositoryMetadataStoreImpl.resetInstance();
    const store2 = RepositoryMetadataStoreImpl.getInstance(tmpDir);
    const reloaded = await store2.getRepository("tier-repo");

    expect(reloaded?.tier).toBe(tier);
  });

  test("round-trips tier=undefined as undefined (omitted)", async () => {
    const store = RepositoryMetadataStoreImpl.getInstance(tmpDir);
    const repo = createTestRepositoryInfo("no-tier-repo");
    await store.updateRepository(repo);

    RepositoryMetadataStoreImpl.resetInstance();
    const store2 = RepositoryMetadataStoreImpl.getInstance(tmpDir);
    const reloaded = await store2.getRepository("no-tier-repo");

    expect(reloaded?.tier).toBeUndefined();
  });

  test("round-trips lastManifestId", async () => {
    const store = RepositoryMetadataStoreImpl.getInstance(tmpDir);
    const repo = createTestRepositoryInfo("manifest-id-repo", {
      source: "local-folder",
      url: null,
      lastManifestId: "repo_manifest_id_repo",
    });
    await store.updateRepository(repo);

    RepositoryMetadataStoreImpl.resetInstance();
    const store2 = RepositoryMetadataStoreImpl.getInstance(tmpDir);
    const reloaded = await store2.getRepository("manifest-id-repo");

    expect(reloaded?.lastManifestId).toBe("repo_manifest_id_repo");
  });

  test("UpdateHistoryEntry preserves both 40-hex SHAs and local- markers", async () => {
    const store = RepositoryMetadataStoreImpl.getInstance(tmpDir);

    const gitEntry: UpdateHistoryEntry = {
      timestamp: "2026-05-05T10:00:00.000Z",
      previousCommit: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
      newCommit: "b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3",
      filesAdded: 1,
      filesModified: 0,
      filesDeleted: 0,
      chunksUpserted: 5,
      chunksDeleted: 0,
      durationMs: 100,
      errorCount: 0,
      status: "success",
    };

    const localEntry: UpdateHistoryEntry = {
      timestamp: "2026-05-05T11:00:00.000Z",
      previousCommit: "local-2026-05-05T10:30:00.000Z",
      newCommit: "local-2026-05-05T11:00:00.000Z",
      filesAdded: 0,
      filesModified: 1,
      filesDeleted: 0,
      chunksUpserted: 2,
      chunksDeleted: 0,
      durationMs: 50,
      errorCount: 0,
      status: "success",
    };

    const repo = createTestRepositoryInfo("history-repo", {
      source: "local-folder",
      url: null,
      updateHistory: [localEntry, gitEntry],
    });
    await store.updateRepository(repo);

    RepositoryMetadataStoreImpl.resetInstance();
    const store2 = RepositoryMetadataStoreImpl.getInstance(tmpDir);
    const reloaded = await store2.getRepository("history-repo");

    expect(reloaded?.updateHistory).toHaveLength(2);
    expect(reloaded?.updateHistory?.[0]?.previousCommit).toBe("local-2026-05-05T10:30:00.000Z");
    expect(reloaded?.updateHistory?.[0]?.newCommit).toBe("local-2026-05-05T11:00:00.000Z");
    expect(reloaded?.updateHistory?.[1]?.previousCommit).toBe(
      "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"
    );
  });

  test("quarantines an unknown persisted source value to git-remote on read (Issue #3)", async () => {
    // Hand-write a repositories.json with a corrupt `source` value that
    // doesn't match any of the three known discriminators.
    const corrupt = {
      version: "1.0",
      repositories: {
        "bogus-repo": {
          ...buildLegacyRepoRecord("bogus-repo"),
          source: "from-the-future",
        },
      },
    };
    fs.writeFileSync(
      path.join(tmpDir, "repositories.json"),
      JSON.stringify(corrupt, null, 2),
      "utf-8"
    );

    const store = RepositoryMetadataStoreImpl.getInstance(tmpDir);
    // Must not throw — read-side quarantine treats it as git-remote.
    const reloaded = await store.getRepository("bogus-repo");
    expect(reloaded).not.toBeNull();
    expect(reloaded?.source).toBe("git-remote");
  });
});

/**
 * Helper to construct a legacy-shape (pre-source-discriminator) repository
 * record for synthesis tests. Returns a plain object — NOT typed as
 * `RepositoryInfo`, since the whole point is that `source` is missing.
 */
function buildLegacyRepoRecord(name: string): Record<string, unknown> {
  return {
    name,
    url: `https://github.com/legacy/${name}.git`,
    localPath: `./data/repos/${name}`,
    collectionName: `repo_${name}`,
    fileCount: 1,
    chunkCount: 1,
    lastIndexedAt: "2024-01-01T00:00:00.000Z",
    indexDurationMs: 1,
    status: "ready",
    branch: "main",
    includeExtensions: [".ts"],
    excludePatterns: [],
  };
}
