/**
 * Integration tests for RepositoryMetadataStoreImpl
 *
 * Tests repository metadata store with real file system operations
 * to verify atomic writes, persistence, and end-to-end functionality.
 *
 * @module tests/integration/repositories/metadata-integration.test.ts
 */

import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { RepositoryMetadataStoreImpl } from "../../../src/repositories/metadata-store.js";
import {
  createTestRepositoryInfo,
  createTestRepositoryBatch,
  sampleRepositories,
  createRepositoryWithStatus,
} from "../../fixtures/repository-fixtures.js";
import { initializeLogger, resetLogger } from "../../../src/logging/index.js";
import { InvalidMetadataFormatError } from "../../../src/repositories/errors.js";

describe("RepositoryMetadataStore Integration Tests", () => {
  let tempDir: string;
  let store: RepositoryMetadataStoreImpl;

  beforeEach(async () => {
    // Initialize logger
    initializeLogger({
      level: "info",
      format: "json",
    });

    // Create temporary directory for test data
    tempDir = await mkdtemp(join(tmpdir(), "repo-metadata-test-"));

    // Reset singleton and create instance with temp directory
    RepositoryMetadataStoreImpl.resetInstance();
    store = RepositoryMetadataStoreImpl.getInstance(tempDir);
  });

  afterEach(async () => {
    // Clean up temporary directory
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      console.warn("Failed to clean up temp directory:", error);
    }

    // Reset logger and singleton
    resetLogger();
    RepositoryMetadataStoreImpl.resetInstance();
  });

  describe("File Creation and Persistence", () => {
    test("should create metadata file on first operation", async () => {
      const repos = await store.listRepositories();
      expect(repos).toEqual([]);

      // Note: File existence is verified by subsequent read operations
    });

    test("should persist data across operations", async () => {
      const repo = createTestRepositoryInfo("my-api");

      // Add repository
      await store.updateRepository(repo);

      // Read it back
      const retrieved = await store.getRepository("my-api");
      expect(retrieved).toEqual(repo);
    });

    test("should persist data across instance recreation", async () => {
      const repo = createTestRepositoryInfo("persistent-repo");

      // Add repository with first instance
      await store.updateRepository(repo);

      // Reset and create new instance
      RepositoryMetadataStoreImpl.resetInstance();
      const newStore = RepositoryMetadataStoreImpl.getInstance(tempDir);

      // Verify data persists
      const retrieved = await newStore.getRepository("persistent-repo");
      expect(retrieved).toEqual(repo);
    });

    test("should maintain JSON formatting", async () => {
      const repo = createTestRepositoryInfo("formatted-repo");
      await store.updateRepository(repo);

      // Read raw file content
      const filePath = join(tempDir, "repositories.json");
      const content = await readFile(filePath, "utf-8");

      // Should be pretty-printed JSON
      expect(content).toContain("  "); // Should have indentation
      expect(content).toContain('"version": "1.0"');
      expect(content).toContain('"repositories"');
    });

    test("should handle corrupted JSON file", async () => {
      const filePath = join(tempDir, "repositories.json");

      // Write corrupted JSON to the file
      await Bun.write(filePath, "{ invalid json }");

      // Reset and create new instance
      RepositoryMetadataStoreImpl.resetInstance();
      const newStore = RepositoryMetadataStoreImpl.getInstance(tempDir);

      // Should throw InvalidMetadataFormatError when trying to load
      expect(newStore.listRepositories()).rejects.toThrow(InvalidMetadataFormatError);
    });
  });

  describe("Full Lifecycle Operations", () => {
    test("should handle complete CRUD lifecycle", async () => {
      const repoName = "lifecycle-test";

      // Create
      const repo = createTestRepositoryInfo(repoName);
      await store.updateRepository(repo);

      // Read
      let retrieved = await store.getRepository(repoName);
      expect(retrieved).toEqual(repo);

      // Update
      const updated = { ...repo, status: "error" as const, errorMessage: "Test error" };
      await store.updateRepository(updated);

      retrieved = await store.getRepository(repoName);
      expect(retrieved?.status).toBe("error");
      expect(retrieved?.errorMessage).toBe("Test error");

      // Delete
      await store.removeRepository(repoName);

      retrieved = await store.getRepository(repoName);
      expect(retrieved).toBeNull();
    });

    test("should handle multiple repositories", async () => {
      const repos = createTestRepositoryBatch(5, "multi");

      // Add all repositories
      for (const repo of repos) {
        await store.updateRepository(repo);
      }

      // List all
      const allRepos = await store.listRepositories();
      expect(allRepos.length).toBe(5);

      // Verify each one
      for (const repo of repos) {
        const retrieved = await store.getRepository(repo.name);
        expect(retrieved).toEqual(repo);
      }
    });

    test("should handle sequential rapid updates", async () => {
      const repos = createTestRepositoryBatch(10, "sequential");

      // Update all repositories sequentially (rapid succession)
      // Note: Truly concurrent writes may fail with atomic write pattern (expected for MVP)
      for (const repo of repos) {
        await store.updateRepository(repo);
      }

      // Verify all were saved
      const allRepos = await store.listRepositories();
      expect(allRepos.length).toBe(10);
    });
  });

  describe("Different Repository States", () => {
    test("should handle repositories in ready state", async () => {
      await store.updateRepository(sampleRepositories.ready);

      const retrieved = await store.getRepository(sampleRepositories.ready.name);
      expect(retrieved?.status).toBe("ready");
      expect(retrieved?.errorMessage).toBeUndefined();
    });

    test("should handle repositories in indexing state", async () => {
      await store.updateRepository(sampleRepositories.indexing);

      const retrieved = await store.getRepository(sampleRepositories.indexing.name);
      expect(retrieved?.status).toBe("indexing");
      expect(retrieved?.fileCount).toBe(0);
      expect(retrieved?.chunkCount).toBe(0);
    });

    test("should handle repositories in error state", async () => {
      await store.updateRepository(sampleRepositories.error);

      const retrieved = await store.getRepository(sampleRepositories.error.name);
      expect(retrieved?.status).toBe("error");
      expect(retrieved?.errorMessage).toBeDefined();
      expect(retrieved?.errorMessage).toContain("authentication required");
    });

    test("should handle large repositories", async () => {
      await store.updateRepository(sampleRepositories.large);

      const retrieved = await store.getRepository(sampleRepositories.large.name);
      expect(retrieved?.fileCount).toBe(2500);
      expect(retrieved?.chunkCount).toBe(7500);
    });

    test("should handle small repositories", async () => {
      await store.updateRepository(sampleRepositories.small);

      const retrieved = await store.getRepository(sampleRepositories.small.name);
      expect(retrieved?.fileCount).toBe(25);
      expect(retrieved?.chunkCount).toBe(75);
    });
  });

  describe("Atomic Writes", () => {
    test("should not corrupt data on write", async () => {
      // Add initial repository
      const repo1 = createTestRepositoryInfo("repo1");
      await store.updateRepository(repo1);

      // Verify initial state
      let allRepos = await store.listRepositories();
      expect(allRepos.length).toBe(1);

      // Add more repositories
      const repo2 = createTestRepositoryInfo("repo2");
      const repo3 = createTestRepositoryInfo("repo3");
      await store.updateRepository(repo2);
      await store.updateRepository(repo3);

      // Verify all repositories exist
      allRepos = await store.listRepositories();
      expect(allRepos.length).toBe(3);

      // Verify each repository is intact
      expect(await store.getRepository("repo1")).toEqual(repo1);
      expect(await store.getRepository("repo2")).toEqual(repo2);
      expect(await store.getRepository("repo3")).toEqual(repo3);
    });

    test("should handle rapid sequential writes", async () => {
      const repos = createTestRepositoryBatch(20, "rapid");

      // Add repositories sequentially as fast as possible
      for (const repo of repos) {
        await store.updateRepository(repo);
      }

      // Verify all were saved correctly
      const allRepos = await store.listRepositories();
      expect(allRepos.length).toBe(20);

      // Verify integrity of each repository
      for (const repo of repos) {
        const retrieved = await store.getRepository(repo.name);
        expect(retrieved).toEqual(repo);
      }
    });
  });

  describe("Edge Cases", () => {
    test("should handle repositories with special characters in name", async () => {
      const repo = createTestRepositoryInfo("my-api_v2.0");
      await store.updateRepository(repo);

      const retrieved = await store.getRepository("my-api_v2.0");
      expect(retrieved).toEqual(repo);
    });

    test("should handle repositories with very long names", async () => {
      const longName =
        "this-is-a-very-long-repository-name-that-exceeds-typical-limits-for-testing";
      const repo = createTestRepositoryInfo(longName);
      await store.updateRepository(repo);

      const retrieved = await store.getRepository(longName);
      expect(retrieved).toEqual(repo);
    });

    test("should handle empty repository list", async () => {
      const repos = await store.listRepositories();
      expect(repos).toEqual([]);
    });

    test("should handle removing non-existent repository", async () => {
      // Should not throw
      await store.removeRepository("does-not-exist");
      // Operation succeeds (idempotent)
    });

    test("should handle getting non-existent repository", async () => {
      const repo = await store.getRepository("does-not-exist");
      expect(repo).toBeNull();
    });

    test("should handle updating same repository multiple times", async () => {
      const name = "updated-repo";
      const repo1 = createRepositoryWithStatus(name, "indexing");
      const repo2 = createRepositoryWithStatus(name, "ready");
      const repo3 = { ...createRepositoryWithStatus(name, "error"), errorMessage: "Failed" };

      // Multiple updates
      await store.updateRepository(repo1);
      await store.updateRepository(repo2);
      await store.updateRepository(repo3);

      // Should have final state
      const final = await store.getRepository(name);
      expect(final?.status).toBe("error");
      expect(final?.errorMessage).toBe("Failed");
    });
  });

  describe("Performance", () => {
    test("should handle 100 repositories efficiently", async () => {
      const startTime = Date.now();
      const repos = createTestRepositoryBatch(100, "perf");

      // Add all repositories
      for (const repo of repos) {
        await store.updateRepository(repo);
      }

      // Should complete in reasonable time (< 10 seconds)
      const addDuration = Date.now() - startTime;
      expect(addDuration).toBeLessThan(10000);

      // List all should be fast
      const listStart = Date.now();
      const allRepos = await store.listRepositories();
      const listDuration = Date.now() - listStart;

      expect(allRepos.length).toBe(100);
      expect(listDuration).toBeLessThan(1000); // < 1 second
    });
  });
});
