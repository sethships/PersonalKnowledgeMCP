/**
 * Backward compatibility tests for repository metadata schema
 *
 * Validates that the metadata store correctly handles both legacy data
 * (without incremental update fields) and new data (with all fields).
 *
 * @module tests/integration/repositories/metadata-backward-compat.test
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { RepositoryMetadataStoreImpl } from "../../../src/repositories/metadata-store.js";
import { initializeLogger, resetLogger } from "../../../src/logging/index.js";
import type { RepositoryInfo, RepositoryMetadataFile } from "../../../src/repositories/types.js";

describe("Backward Compatibility - Incremental Update Fields", () => {
  let tempDir: string;

  beforeEach(async () => {
    initializeLogger({ level: "error", format: "json" });
    RepositoryMetadataStoreImpl.resetInstance();
    tempDir = await mkdtemp(join(tmpdir(), "metadata-compat-"));
  });

  afterEach(async () => {
    resetLogger();
    RepositoryMetadataStoreImpl.resetInstance();
    // Guard against undefined tempDir if beforeEach failed
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  describe("Loading Legacy Metadata", () => {
    test("should load legacy metadata file without incremental update fields", async () => {
      // Create a legacy metadata file (without incremental update fields)
      const legacyMetadata = {
        version: "1.0",
        repositories: {
          "legacy-repo": {
            name: "legacy-repo",
            url: "https://github.com/test/legacy.git",
            localPath: "./data/repos/legacy-repo",
            collectionName: "repo_legacy_repo",
            fileCount: 50,
            chunkCount: 150,
            lastIndexedAt: "2024-01-01T00:00:00.000Z",
            indexDurationMs: 3000,
            status: "ready",
            branch: "main",
            includeExtensions: [".ts", ".js"],
            excludePatterns: ["node_modules/**"],
          },
        },
      };

      // Write legacy file
      const filePath = join(tempDir, "repositories.json");
      await writeFile(filePath, JSON.stringify(legacyMetadata, null, 2));

      // Load with current implementation
      const store = RepositoryMetadataStoreImpl.getInstance(tempDir);
      const repos = await store.listRepositories();

      expect(repos).toHaveLength(1);
      const repo = repos[0];
      expect(repo).toBeDefined();
      expect(repo!.name).toBe("legacy-repo");
      expect(repo!.fileCount).toBe(50);
      expect(repo!.status).toBe("ready");

      // New fields should be undefined
      expect(repo!.lastIndexedCommitSha).toBeUndefined();
      expect(repo!.lastIncrementalUpdateAt).toBeUndefined();
      expect(repo!.incrementalUpdateCount).toBeUndefined();
    });

    test("should load metadata with multiple legacy repositories", async () => {
      const legacyMetadata = {
        version: "1.0",
        repositories: {
          "repo-a": {
            name: "repo-a",
            url: "https://github.com/test/repo-a.git",
            localPath: "./data/repos/repo-a",
            collectionName: "repo_repo_a",
            fileCount: 100,
            chunkCount: 300,
            lastIndexedAt: "2024-01-01T00:00:00.000Z",
            indexDurationMs: 5000,
            status: "ready",
            branch: "main",
            includeExtensions: [".ts"],
            excludePatterns: ["node_modules/**"],
          },
          "repo-b": {
            name: "repo-b",
            url: "https://github.com/test/repo-b.git",
            localPath: "./data/repos/repo-b",
            collectionName: "repo_repo_b",
            fileCount: 200,
            chunkCount: 600,
            lastIndexedAt: "2024-01-02T00:00:00.000Z",
            indexDurationMs: 8000,
            status: "indexing",
            branch: "develop",
            includeExtensions: [".js", ".ts"],
            excludePatterns: ["node_modules/**", "dist/**"],
          },
        },
      };

      const filePath = join(tempDir, "repositories.json");
      await writeFile(filePath, JSON.stringify(legacyMetadata, null, 2));

      const store = RepositoryMetadataStoreImpl.getInstance(tempDir);
      const repos = await store.listRepositories();

      expect(repos).toHaveLength(2);

      // Both should load without incremental update fields
      repos.forEach((repo) => {
        expect(repo.lastIndexedCommitSha).toBeUndefined();
        expect(repo.lastIncrementalUpdateAt).toBeUndefined();
        expect(repo.incrementalUpdateCount).toBeUndefined();
      });
    });
  });

  describe("Saving Metadata with New Fields", () => {
    test("should save and load metadata with all new fields", async () => {
      const store = RepositoryMetadataStoreImpl.getInstance(tempDir);
      const now = new Date().toISOString();

      const repoWithNewFields: RepositoryInfo = {
        name: "new-repo",
        url: "https://github.com/test/new.git",
        localPath: "./data/repos/new-repo",
        collectionName: "repo_new_repo",
        fileCount: 100,
        chunkCount: 300,
        lastIndexedAt: now,
        indexDurationMs: 5000,
        status: "ready",
        branch: "main",
        includeExtensions: [".ts"],
        excludePatterns: ["node_modules/**"],
        lastIndexedCommitSha: "abc123def456abc123def456abc123def456abc1",
        lastIncrementalUpdateAt: now,
        incrementalUpdateCount: 3,
      };

      await store.updateRepository(repoWithNewFields);

      // Reload from disk to verify persistence
      RepositoryMetadataStoreImpl.resetInstance();
      const newStore = RepositoryMetadataStoreImpl.getInstance(tempDir);
      const repo = await newStore.getRepository("new-repo");

      expect(repo).not.toBeNull();
      expect(repo?.lastIndexedCommitSha).toBe("abc123def456abc123def456abc123def456abc1");
      expect(repo?.lastIncrementalUpdateAt).toBe(now);
      expect(repo?.incrementalUpdateCount).toBe(3);
    });

    test("should save metadata with only SHA field", async () => {
      const store = RepositoryMetadataStoreImpl.getInstance(tempDir);

      const repoWithShaOnly: RepositoryInfo = {
        name: "sha-only-repo",
        url: "https://github.com/test/sha-only.git",
        localPath: "./data/repos/sha-only-repo",
        collectionName: "repo_sha_only_repo",
        fileCount: 75,
        chunkCount: 225,
        lastIndexedAt: new Date().toISOString(),
        indexDurationMs: 4000,
        status: "ready",
        branch: "main",
        includeExtensions: [".ts"],
        excludePatterns: ["node_modules/**"],
        lastIndexedCommitSha: "fedcba9876543210fedcba9876543210fedcba98",
      };

      await store.updateRepository(repoWithShaOnly);

      // Verify on disk
      const filePath = join(tempDir, "repositories.json");
      const content = await readFile(filePath, "utf-8");
      const parsed = JSON.parse(content) as RepositoryMetadataFile;
      const savedRepo = parsed.repositories["sha-only-repo"];

      expect(savedRepo).toBeDefined();
      expect(savedRepo!.lastIndexedCommitSha).toBe("fedcba9876543210fedcba9876543210fedcba98");
      expect(savedRepo!.lastIncrementalUpdateAt).toBeUndefined();
      expect(savedRepo!.incrementalUpdateCount).toBeUndefined();
    });
  });

  describe("Updating Repositories", () => {
    test("should preserve new fields when updating existing repository", async () => {
      const store = RepositoryMetadataStoreImpl.getInstance(tempDir);

      // Create repo with new fields
      const original: RepositoryInfo = {
        name: "update-test",
        url: "https://github.com/test/update.git",
        localPath: "./data/repos/update-test",
        collectionName: "repo_update_test",
        fileCount: 100,
        chunkCount: 300,
        lastIndexedAt: new Date().toISOString(),
        indexDurationMs: 5000,
        status: "ready",
        branch: "main",
        includeExtensions: [".ts"],
        excludePatterns: ["node_modules/**"],
        lastIndexedCommitSha: "original-sha-12345",
        incrementalUpdateCount: 1,
      };

      await store.updateRepository(original);

      // Update with new values
      const updatedAt = new Date().toISOString();
      const updated: RepositoryInfo = {
        ...original,
        fileCount: 150,
        lastIndexedCommitSha: "updated-sha-67890",
        incrementalUpdateCount: 2,
        lastIncrementalUpdateAt: updatedAt,
      };

      await store.updateRepository(updated);

      const repo = await store.getRepository("update-test");
      expect(repo?.fileCount).toBe(150);
      expect(repo?.lastIndexedCommitSha).toBe("updated-sha-67890");
      expect(repo?.incrementalUpdateCount).toBe(2);
      expect(repo?.lastIncrementalUpdateAt).toBe(updatedAt);
    });

    test("should add new fields to legacy repository on update", async () => {
      // Start with legacy metadata
      const legacyMetadata = {
        version: "1.0",
        repositories: {
          "legacy-upgrade": {
            name: "legacy-upgrade",
            url: "https://github.com/test/legacy-upgrade.git",
            localPath: "./data/repos/legacy-upgrade",
            collectionName: "repo_legacy_upgrade",
            fileCount: 50,
            chunkCount: 150,
            lastIndexedAt: "2024-01-01T00:00:00.000Z",
            indexDurationMs: 3000,
            status: "ready",
            branch: "main",
            includeExtensions: [".ts"],
            excludePatterns: ["node_modules/**"],
          },
        },
      };

      const filePath = join(tempDir, "repositories.json");
      await writeFile(filePath, JSON.stringify(legacyMetadata, null, 2));

      // Load and update with new fields
      const store = RepositoryMetadataStoreImpl.getInstance(tempDir);
      const legacy = await store.getRepository("legacy-upgrade");

      expect(legacy).not.toBeNull();
      expect(legacy?.lastIndexedCommitSha).toBeUndefined();

      // Update with incremental data - safe to assert here since we verified not null above
      const updated: RepositoryInfo = {
        ...(legacy as RepositoryInfo),
        fileCount: 55,
        lastIndexedCommitSha: "first-incremental-sha",
        lastIncrementalUpdateAt: new Date().toISOString(),
        incrementalUpdateCount: 1,
      };

      await store.updateRepository(updated);

      // Verify upgrade
      const upgraded = await store.getRepository("legacy-upgrade");
      expect(upgraded?.lastIndexedCommitSha).toBe("first-incremental-sha");
      expect(upgraded?.incrementalUpdateCount).toBe(1);
      expect(upgraded?.lastIncrementalUpdateAt).toBeDefined();
    });
  });

  describe("Mixed Repositories", () => {
    test("should handle mix of legacy and new repositories", async () => {
      // Create legacy metadata with one repository
      const legacyMetadata = {
        version: "1.0",
        repositories: {
          "legacy-project": {
            name: "legacy-project",
            url: "https://github.com/test/legacy-project.git",
            localPath: "./data/repos/legacy-project",
            collectionName: "repo_legacy_project",
            fileCount: 40,
            chunkCount: 120,
            lastIndexedAt: "2024-01-01T00:00:00.000Z",
            indexDurationMs: 2500,
            status: "ready",
            branch: "main",
            includeExtensions: [".ts"],
            excludePatterns: ["node_modules/**"],
          },
        },
      };

      const filePath = join(tempDir, "repositories.json");
      await writeFile(filePath, JSON.stringify(legacyMetadata, null, 2));

      // Add a new repository with incremental update fields
      const store = RepositoryMetadataStoreImpl.getInstance(tempDir);

      const newRepo: RepositoryInfo = {
        name: "modern-project",
        url: "https://github.com/test/modern-project.git",
        localPath: "./data/repos/modern-project",
        collectionName: "repo_modern_project",
        fileCount: 200,
        chunkCount: 600,
        lastIndexedAt: new Date().toISOString(),
        indexDurationMs: 8000,
        status: "ready",
        branch: "main",
        includeExtensions: [".ts", ".tsx"],
        excludePatterns: ["node_modules/**", "dist/**"],
        lastIndexedCommitSha: "modern-sha-abc123",
        lastIncrementalUpdateAt: new Date().toISOString(),
        incrementalUpdateCount: 10,
      };

      await store.updateRepository(newRepo);

      // Verify both exist with correct data
      const repos = await store.listRepositories();
      expect(repos).toHaveLength(2);

      const legacy = repos.find((r) => r.name === "legacy-project");
      const modern = repos.find((r) => r.name === "modern-project");

      expect(legacy).toBeDefined();
      expect(legacy?.lastIndexedCommitSha).toBeUndefined();
      expect(legacy?.incrementalUpdateCount).toBeUndefined();

      expect(modern).toBeDefined();
      expect(modern?.lastIndexedCommitSha).toBe("modern-sha-abc123");
      expect(modern?.incrementalUpdateCount).toBe(10);
    });
  });

  describe("JSON File Format", () => {
    test("should write new fields to JSON file correctly", async () => {
      const store = RepositoryMetadataStoreImpl.getInstance(tempDir);

      const repo: RepositoryInfo = {
        name: "json-test",
        url: "https://github.com/test/json-test.git",
        localPath: "./data/repos/json-test",
        collectionName: "repo_json_test",
        fileCount: 100,
        chunkCount: 300,
        lastIndexedAt: "2024-12-14T10:00:00.000Z",
        indexDurationMs: 5000,
        status: "ready",
        branch: "main",
        includeExtensions: [".ts"],
        excludePatterns: ["node_modules/**"],
        lastIndexedCommitSha: "abcdef1234567890",
        lastIncrementalUpdateAt: "2024-12-14T11:00:00.000Z",
        incrementalUpdateCount: 2,
      };

      await store.updateRepository(repo);

      // Read raw file and verify structure
      const filePath = join(tempDir, "repositories.json");
      const content = await readFile(filePath, "utf-8");

      // Verify JSON is properly formatted
      expect(content).toContain('"version": "1.0"');
      expect(content).toContain('"lastIndexedCommitSha": "abcdef1234567890"');
      expect(content).toContain('"lastIncrementalUpdateAt": "2024-12-14T11:00:00.000Z"');
      expect(content).toContain('"incrementalUpdateCount": 2');
    });

    test("should not write undefined fields to JSON", async () => {
      const store = RepositoryMetadataStoreImpl.getInstance(tempDir);

      const repo: RepositoryInfo = {
        name: "no-optional",
        url: "https://github.com/test/no-optional.git",
        localPath: "./data/repos/no-optional",
        collectionName: "repo_no_optional",
        fileCount: 100,
        chunkCount: 300,
        lastIndexedAt: "2024-12-14T10:00:00.000Z",
        indexDurationMs: 5000,
        status: "ready",
        branch: "main",
        includeExtensions: [".ts"],
        excludePatterns: ["node_modules/**"],
        // No optional fields set
      };

      await store.updateRepository(repo);

      // Read raw file
      const filePath = join(tempDir, "repositories.json");
      const content = await readFile(filePath, "utf-8");

      // Undefined fields should not appear in JSON
      expect(content).not.toContain("lastIndexedCommitSha");
      expect(content).not.toContain("lastIncrementalUpdateAt");
      expect(content).not.toContain("incrementalUpdateCount");
      expect(content).not.toContain("errorMessage");
    });
  });
});
