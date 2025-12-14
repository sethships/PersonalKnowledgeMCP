/**
 * Unit tests for RepositoryInfo type definitions
 *
 * Validates that the RepositoryInfo interface correctly handles
 * new incremental update fields while maintaining backward compatibility.
 *
 * @module tests/unit/repositories/types.test
 */

import { describe, expect, test } from "bun:test";
import type { RepositoryInfo, RepositoryStatus } from "../../../src/repositories/types.js";

describe("RepositoryInfo Type", () => {
  describe("Core Required Fields", () => {
    test("should require all mandatory fields", () => {
      // This test validates TypeScript compilation - if it compiles, types are correct
      const repo: RepositoryInfo = {
        name: "test-repo",
        url: "https://github.com/test/repo.git",
        localPath: "./data/repos/test-repo",
        collectionName: "repo_test_repo",
        fileCount: 100,
        chunkCount: 300,
        lastIndexedAt: new Date().toISOString(),
        indexDurationMs: 5000,
        status: "ready",
        branch: "main",
        includeExtensions: [".ts"],
        excludePatterns: ["node_modules/**"],
      };

      // Verify all required fields are present
      expect(repo.name).toBe("test-repo");
      expect(repo.url).toBe("https://github.com/test/repo.git");
      expect(repo.localPath).toBe("./data/repos/test-repo");
      expect(repo.collectionName).toBe("repo_test_repo");
      expect(repo.fileCount).toBe(100);
      expect(repo.chunkCount).toBe(300);
      expect(repo.lastIndexedAt).toBeDefined();
      expect(repo.indexDurationMs).toBe(5000);
      expect(repo.status).toBe("ready");
      expect(repo.branch).toBe("main");
      expect(repo.includeExtensions).toEqual([".ts"]);
      expect(repo.excludePatterns).toEqual(["node_modules/**"]);
    });

    test("should accept all valid status values", () => {
      const statuses: RepositoryStatus[] = ["ready", "indexing", "error"];

      statuses.forEach((status) => {
        const repo: RepositoryInfo = {
          name: "test-repo",
          url: "https://github.com/test/repo.git",
          localPath: "./data/repos/test-repo",
          collectionName: "repo_test_repo",
          fileCount: 100,
          chunkCount: 300,
          lastIndexedAt: new Date().toISOString(),
          indexDurationMs: 5000,
          status,
          branch: "main",
          includeExtensions: [".ts"],
          excludePatterns: ["node_modules/**"],
        };

        expect(repo.status).toBe(status);
      });
    });
  });

  describe("Optional errorMessage Field", () => {
    test("should allow errorMessage when status is error", () => {
      const repo: RepositoryInfo = {
        name: "failed-repo",
        url: "https://github.com/test/repo.git",
        localPath: "./data/repos/failed-repo",
        collectionName: "repo_failed_repo",
        fileCount: 0,
        chunkCount: 0,
        lastIndexedAt: new Date().toISOString(),
        indexDurationMs: 1000,
        status: "error",
        branch: "main",
        includeExtensions: [".ts"],
        excludePatterns: ["node_modules/**"],
        errorMessage: "Clone failed: authentication required",
      };

      expect(repo.status).toBe("error");
      expect(repo.errorMessage).toBe("Clone failed: authentication required");
    });

    test("should allow omitting errorMessage", () => {
      const repo: RepositoryInfo = {
        name: "test-repo",
        url: "https://github.com/test/repo.git",
        localPath: "./data/repos/test-repo",
        collectionName: "repo_test_repo",
        fileCount: 100,
        chunkCount: 300,
        lastIndexedAt: new Date().toISOString(),
        indexDurationMs: 5000,
        status: "ready",
        branch: "main",
        includeExtensions: [".ts"],
        excludePatterns: ["node_modules/**"],
      };

      expect(repo.errorMessage).toBeUndefined();
    });
  });

  describe("Incremental Update Fields", () => {
    test("should accept RepositoryInfo without incremental update fields", () => {
      // Existing repositories without new fields should still be valid
      // This validates backward compatibility
      const repo: RepositoryInfo = {
        name: "legacy-repo",
        url: "https://github.com/test/repo.git",
        localPath: "./data/repos/legacy-repo",
        collectionName: "repo_legacy_repo",
        fileCount: 100,
        chunkCount: 300,
        lastIndexedAt: new Date().toISOString(),
        indexDurationMs: 5000,
        status: "ready",
        branch: "main",
        includeExtensions: [".ts"],
        excludePatterns: ["node_modules/**"],
      };

      // All incremental update fields should be undefined
      expect(repo.lastIndexedCommitSha).toBeUndefined();
      expect(repo.lastIncrementalUpdateAt).toBeUndefined();
      expect(repo.incrementalUpdateCount).toBeUndefined();
    });

    test("should accept RepositoryInfo with all incremental update fields", () => {
      const commitSha = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
      const incrementalUpdateAt = new Date().toISOString();

      const repo: RepositoryInfo = {
        name: "active-repo",
        url: "https://github.com/test/repo.git",
        localPath: "./data/repos/active-repo",
        collectionName: "repo_active_repo",
        fileCount: 100,
        chunkCount: 300,
        lastIndexedAt: new Date().toISOString(),
        indexDurationMs: 5000,
        status: "ready",
        branch: "main",
        includeExtensions: [".ts"],
        excludePatterns: ["node_modules/**"],
        lastIndexedCommitSha: commitSha,
        lastIncrementalUpdateAt: incrementalUpdateAt,
        incrementalUpdateCount: 5,
      };

      expect(repo.lastIndexedCommitSha).toBe(commitSha);
      expect(repo.lastIncrementalUpdateAt).toBe(incrementalUpdateAt);
      expect(repo.incrementalUpdateCount).toBe(5);
    });

    test("should accept partial incremental update fields - only SHA", () => {
      // After initial full index, only SHA is set
      const repo: RepositoryInfo = {
        name: "fresh-repo",
        url: "https://github.com/test/repo.git",
        localPath: "./data/repos/fresh-repo",
        collectionName: "repo_fresh_repo",
        fileCount: 100,
        chunkCount: 300,
        lastIndexedAt: new Date().toISOString(),
        indexDurationMs: 5000,
        status: "ready",
        branch: "main",
        includeExtensions: [".ts"],
        excludePatterns: ["node_modules/**"],
        lastIndexedCommitSha: "abc123def456abc123def456abc123def456abc1",
      };

      expect(repo.lastIndexedCommitSha).toBe("abc123def456abc123def456abc123def456abc1");
      expect(repo.lastIncrementalUpdateAt).toBeUndefined();
      expect(repo.incrementalUpdateCount).toBeUndefined();
    });

    test("should accept partial incremental update fields - SHA and count only", () => {
      // Edge case: count set but timestamp not (shouldn't happen in practice)
      const repo: RepositoryInfo = {
        name: "edge-case-repo",
        url: "https://github.com/test/repo.git",
        localPath: "./data/repos/edge-case-repo",
        collectionName: "repo_edge_case_repo",
        fileCount: 100,
        chunkCount: 300,
        lastIndexedAt: new Date().toISOString(),
        indexDurationMs: 5000,
        status: "ready",
        branch: "main",
        includeExtensions: [".ts"],
        excludePatterns: ["node_modules/**"],
        lastIndexedCommitSha: "abc123",
        incrementalUpdateCount: 0,
      };

      expect(repo.lastIndexedCommitSha).toBe("abc123");
      expect(repo.lastIncrementalUpdateAt).toBeUndefined();
      expect(repo.incrementalUpdateCount).toBe(0);
    });

    test("should handle zero incremental update count", () => {
      const repo: RepositoryInfo = {
        name: "zero-count-repo",
        url: "https://github.com/test/repo.git",
        localPath: "./data/repos/zero-count-repo",
        collectionName: "repo_zero_count_repo",
        fileCount: 100,
        chunkCount: 300,
        lastIndexedAt: new Date().toISOString(),
        indexDurationMs: 5000,
        status: "ready",
        branch: "main",
        includeExtensions: [".ts"],
        excludePatterns: ["node_modules/**"],
        lastIndexedCommitSha: "abc123",
        incrementalUpdateCount: 0,
      };

      expect(repo.incrementalUpdateCount).toBe(0);
    });

    test("should handle high incremental update count", () => {
      // Simulate a repository with many incremental updates
      const repo: RepositoryInfo = {
        name: "high-update-repo",
        url: "https://github.com/test/repo.git",
        localPath: "./data/repos/high-update-repo",
        collectionName: "repo_high_update_repo",
        fileCount: 500,
        chunkCount: 1500,
        lastIndexedAt: new Date().toISOString(),
        indexDurationMs: 15000,
        status: "ready",
        branch: "main",
        includeExtensions: [".ts", ".js"],
        excludePatterns: ["node_modules/**"],
        lastIndexedCommitSha: "abc123def456",
        lastIncrementalUpdateAt: new Date().toISOString(),
        incrementalUpdateCount: 100,
      };

      expect(repo.incrementalUpdateCount).toBe(100);
    });
  });

  describe("Type Exports", () => {
    test("should export RepositoryStatus type", () => {
      // Verify the type is usable
      const status: RepositoryStatus = "ready";
      expect(status).toBe("ready");
    });

    test("should export RepositoryInfo interface", () => {
      // Verify the interface is usable
      const repo: Partial<RepositoryInfo> = {
        name: "partial-repo",
      };
      expect(repo.name).toBe("partial-repo");
    });
  });
});
