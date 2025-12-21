/**
 * Integration tests for Interrupted Update Detection
 *
 * Tests end-to-end detection and recovery scenarios for interrupted updates,
 * including simulated crashes, startup detection, and recovery with --force.
 *
 * @module tests/integration/services/interrupted-update-detection.test.ts
 */

import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { RepositoryMetadataStoreImpl } from "../../../src/repositories/metadata-store.js";
import {
  detectInterruptedUpdates,
  clearInterruptedUpdateFlag,
  markAsInterrupted,
  formatElapsedTime,
} from "../../../src/services/interrupted-update-detector.js";
import { createTestRepositoryInfo } from "../../fixtures/repository-fixtures.js";
import { initializeLogger, resetLogger } from "../../../src/logging/index.js";
import type { RepositoryInfo } from "../../../src/repositories/types.js";

describe("Interrupted Update Detection Integration Tests", () => {
  let tempDir: string;
  let store: RepositoryMetadataStoreImpl;

  beforeEach(async () => {
    // Initialize logger to suppress output during tests
    initializeLogger({
      level: "error", // Only show errors, not warnings from detection
      format: "json",
    });

    // Create temporary directory for test data
    tempDir = await mkdtemp(join(tmpdir(), "interrupted-update-test-"));

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

  describe("Simulating Interrupted Update (Set Flag, Don't Clear)", () => {
    test("should detect repository with updateInProgress=true after simulated crash", async () => {
      // Simulate starting an update (set flag)
      const updateStartedAt = new Date().toISOString();
      const repo = createTestRepositoryInfo("crashed-update", {
        status: "indexing",
        updateInProgress: true,
        updateStartedAt,
      });

      // Persist the "in progress" state (simulating a crash before completion)
      await store.updateRepository(repo);

      // Simulate service restart - create new instance
      RepositoryMetadataStoreImpl.resetInstance();
      const newStore = RepositoryMetadataStoreImpl.getInstance(tempDir);

      // Detect interrupted updates (as would happen on startup)
      const result = await detectInterruptedUpdates(newStore);

      expect(result.interrupted.length).toBe(1);
      expect(result.interrupted[0]!.repositoryName).toBe("crashed-update");
      expect(result.interrupted[0]!.updateStartedAt).toBe(updateStartedAt);
      expect(result.interrupted[0]!.status).toBe("indexing");
      expect(result.totalRepositories).toBe(1);
    });

    test("should detect multiple interrupted updates across service restart", async () => {
      // Simulate multiple repositories with interrupted updates
      const repo1StartedAt = new Date(Date.now() - 60000).toISOString(); // 1 min ago
      const repo2StartedAt = new Date(Date.now() - 300000).toISOString(); // 5 mins ago

      const repo1 = createTestRepositoryInfo("interrupted-1", {
        status: "indexing",
        updateInProgress: true,
        updateStartedAt: repo1StartedAt,
      });

      const repo2 = createTestRepositoryInfo("interrupted-2", {
        status: "indexing",
        updateInProgress: true,
        updateStartedAt: repo2StartedAt,
        lastIndexedCommitSha: "abc123def456",
      });

      const repo3 = createTestRepositoryInfo("normal-repo", {
        status: "ready",
        updateInProgress: false,
      });

      // Persist all repositories
      await store.updateRepository(repo1);
      await store.updateRepository(repo2);
      await store.updateRepository(repo3);

      // Simulate service restart
      RepositoryMetadataStoreImpl.resetInstance();
      const newStore = RepositoryMetadataStoreImpl.getInstance(tempDir);

      // Detect interrupted updates
      const result = await detectInterruptedUpdates(newStore);

      expect(result.interrupted.length).toBe(2);
      expect(result.totalRepositories).toBe(3);

      // Verify both interrupted repos are detected
      const interruptedNames = result.interrupted.map((i) => i.repositoryName);
      expect(interruptedNames).toContain("interrupted-1");
      expect(interruptedNames).toContain("interrupted-2");

      // Verify elapsed time calculations are reasonable
      const int1 = result.interrupted.find((i) => i.repositoryName === "interrupted-1");
      const int2 = result.interrupted.find((i) => i.repositoryName === "interrupted-2");

      expect(int1?.elapsedMs).toBeGreaterThan(50000); // Close to 60s
      expect(int2?.elapsedMs).toBeGreaterThan(290000); // Close to 5 mins
      expect(int2?.lastKnownCommit).toBe("abc123def456");
    });

    test("should persist interrupted state across multiple service restarts", async () => {
      // Set up interrupted update
      const updateStartedAt = new Date().toISOString();
      const repo = createTestRepositoryInfo("persistent-interrupted", {
        status: "indexing",
        updateInProgress: true,
        updateStartedAt,
      });

      await store.updateRepository(repo);

      // Simulate multiple restarts
      for (let restart = 1; restart <= 3; restart++) {
        RepositoryMetadataStoreImpl.resetInstance();
        const restartedStore = RepositoryMetadataStoreImpl.getInstance(tempDir);

        const result = await detectInterruptedUpdates(restartedStore);

        expect(result.interrupted.length).toBe(1);
        expect(result.interrupted[0]!.repositoryName).toBe("persistent-interrupted");
      }
    });
  });

  describe("Startup Detection Integration", () => {
    test("should return empty result when no repositories have interrupted updates", async () => {
      // Create several normal repositories
      const repos = [
        createTestRepositoryInfo("normal-1", { status: "ready" }),
        createTestRepositoryInfo("normal-2", { status: "ready" }),
        createTestRepositoryInfo("error-repo", { status: "error", errorMessage: "Some error" }),
      ];

      for (const repo of repos) {
        await store.updateRepository(repo);
      }

      // Simulate restart and detection
      RepositoryMetadataStoreImpl.resetInstance();
      const newStore = RepositoryMetadataStoreImpl.getInstance(tempDir);

      const result = await detectInterruptedUpdates(newStore);

      expect(result.interrupted.length).toBe(0);
      expect(result.totalRepositories).toBe(3);
      expect(result.detectionDurationMs).toBeGreaterThanOrEqual(0);
    });

    test("should include full repository info in detection result", async () => {
      const updateStartedAt = new Date().toISOString();
      const repo = createTestRepositoryInfo("detailed-repo", {
        status: "indexing",
        updateInProgress: true,
        updateStartedAt,
        fileCount: 150,
        chunkCount: 450,
        lastIndexedCommitSha: "abc123",
        branch: "develop",
      });

      await store.updateRepository(repo);

      // Simulate restart
      RepositoryMetadataStoreImpl.resetInstance();
      const newStore = RepositoryMetadataStoreImpl.getInstance(tempDir);

      const result = await detectInterruptedUpdates(newStore);

      expect(result.interrupted.length).toBe(1);
      const detected = result.interrupted[0]!;

      // Verify full repository info is included
      expect(detected.repository).toBeDefined();
      expect(detected.repository.name).toBe("detailed-repo");
      expect(detected.repository.fileCount).toBe(150);
      expect(detected.repository.chunkCount).toBe(450);
      expect(detected.repository.branch).toBe("develop");
      expect(detected.lastKnownCommit).toBe("abc123");
    });
  });

  describe("Recovery with clearInterruptedUpdateFlag", () => {
    test("should clear interrupted flag and allow normal operations", async () => {
      // Set up interrupted update
      const updateStartedAt = new Date().toISOString();
      const repo = createTestRepositoryInfo("recovery-test", {
        status: "indexing",
        updateInProgress: true,
        updateStartedAt,
        fileCount: 100,
        chunkCount: 300,
      });

      await store.updateRepository(repo);

      // Verify it's detected as interrupted
      let result = await detectInterruptedUpdates(store);
      expect(result.interrupted.length).toBe(1);

      // Clear the interrupted flag (simulating --force recovery)
      const cleared = await clearInterruptedUpdateFlag(store, "recovery-test");

      // Verify flag is cleared
      expect(cleared.updateInProgress).toBe(false);
      expect(cleared.updateStartedAt).toBeUndefined();

      // Verify other fields are preserved
      expect(cleared.fileCount).toBe(100);
      expect(cleared.chunkCount).toBe(300);

      // Verify detection no longer finds it
      result = await detectInterruptedUpdates(store);
      expect(result.interrupted.length).toBe(0);
    });

    test("should persist cleared state across restarts", async () => {
      // Set up and clear interrupted update
      const repo = createTestRepositoryInfo("persist-clear-test", {
        status: "indexing",
        updateInProgress: true,
        updateStartedAt: new Date().toISOString(),
      });

      await store.updateRepository(repo);
      await clearInterruptedUpdateFlag(store, "persist-clear-test");

      // Simulate restart
      RepositoryMetadataStoreImpl.resetInstance();
      const newStore = RepositoryMetadataStoreImpl.getInstance(tempDir);

      // Should not detect as interrupted
      const result = await detectInterruptedUpdates(newStore);
      expect(result.interrupted.length).toBe(0);

      // Verify repository state
      const retrieved = await newStore.getRepository("persist-clear-test");
      expect(retrieved?.updateInProgress).toBe(false);
      expect(retrieved?.updateStartedAt).toBeUndefined();
    });

    test("should throw error when clearing flag for non-existent repository", async () => {
      expect(clearInterruptedUpdateFlag(store, "non-existent")).rejects.toThrow(
        "Repository 'non-existent' not found"
      );
    });
  });

  describe("Recovery with markAsInterrupted", () => {
    test("should mark repository with error status", async () => {
      const updateStartedAt = new Date().toISOString();
      const repo = createTestRepositoryInfo("mark-error-test", {
        status: "indexing",
        updateInProgress: true,
        updateStartedAt,
      });

      await store.updateRepository(repo);

      // Mark as interrupted
      const marked = await markAsInterrupted(store, "mark-error-test", updateStartedAt);

      expect(marked.status).toBe("error");
      expect(marked.updateInProgress).toBe(false);
      expect(marked.updateStartedAt).toBeUndefined();
      expect(marked.errorMessage).toContain("Update interrupted");
      expect(marked.errorMessage).toContain(updateStartedAt);
      expect(marked.errorMessage).toContain("pk-mcp update mark-error-test --force");
    });

    test("should persist error status across restarts", async () => {
      const updateStartedAt = new Date().toISOString();
      const repo = createTestRepositoryInfo("persist-error-test", {
        status: "indexing",
        updateInProgress: true,
        updateStartedAt,
      });

      await store.updateRepository(repo);
      await markAsInterrupted(store, "persist-error-test", updateStartedAt);

      // Simulate restart
      RepositoryMetadataStoreImpl.resetInstance();
      const newStore = RepositoryMetadataStoreImpl.getInstance(tempDir);

      const retrieved = await newStore.getRepository("persist-error-test");
      expect(retrieved?.status).toBe("error");
      expect(retrieved?.updateInProgress).toBe(false);
      expect(retrieved?.errorMessage).toContain("Update interrupted");
    });
  });

  describe("Mixed Scenario Integration", () => {
    test("should handle mix of normal, interrupted, and recovered repositories", async () => {
      // Normal ready repository
      const normalRepo = createTestRepositoryInfo("normal", { status: "ready" });

      // Interrupted repository
      const interruptedRepo = createTestRepositoryInfo("interrupted", {
        status: "indexing",
        updateInProgress: true,
        updateStartedAt: new Date().toISOString(),
      });

      // Previously interrupted, now marked as error
      const errorRepo = createTestRepositoryInfo("was-interrupted", {
        status: "error",
        updateInProgress: false,
        errorMessage: "Update interrupted at 2024-12-14T10:00:00.000Z",
      });

      // Previously interrupted, cleared and ready for new update
      const recoveredRepo = createTestRepositoryInfo("recovered", {
        status: "indexing", // Currently indexing
        updateInProgress: false, // But flag is clear (fresh start)
      });

      await store.updateRepository(normalRepo);
      await store.updateRepository(interruptedRepo);
      await store.updateRepository(errorRepo);
      await store.updateRepository(recoveredRepo);

      // Detect interrupted
      const result = await detectInterruptedUpdates(store);

      // Only "interrupted" should be detected (updateInProgress: true)
      expect(result.interrupted.length).toBe(1);
      expect(result.interrupted[0]!.repositoryName).toBe("interrupted");
      expect(result.totalRepositories).toBe(4);
    });

    test("should support full recovery workflow: detect -> clear -> verify", async () => {
      // Set up multiple interrupted repositories
      const repos: RepositoryInfo[] = [
        createTestRepositoryInfo("int-1", {
          status: "indexing",
          updateInProgress: true,
          updateStartedAt: new Date(Date.now() - 60000).toISOString(),
        }),
        createTestRepositoryInfo("int-2", {
          status: "indexing",
          updateInProgress: true,
          updateStartedAt: new Date(Date.now() - 120000).toISOString(),
        }),
        createTestRepositoryInfo("normal", { status: "ready" }),
      ];

      for (const repo of repos) {
        await store.updateRepository(repo);
      }

      // Step 1: Detect
      let result = await detectInterruptedUpdates(store);
      expect(result.interrupted.length).toBe(2);

      // Step 2: Clear first repository
      await clearInterruptedUpdateFlag(store, "int-1");

      // Step 3: Verify only second remains interrupted
      result = await detectInterruptedUpdates(store);
      expect(result.interrupted.length).toBe(1);
      expect(result.interrupted[0]!.repositoryName).toBe("int-2");

      // Step 4: Clear second repository
      await clearInterruptedUpdateFlag(store, "int-2");

      // Step 5: Verify no more interrupted
      result = await detectInterruptedUpdates(store);
      expect(result.interrupted.length).toBe(0);
      expect(result.totalRepositories).toBe(3);
    });
  });

  describe("Performance", () => {
    test("should detect interrupted updates quickly with many repositories", async () => {
      const repoCount = 50;
      const repos: RepositoryInfo[] = [];

      // Create mix of normal and interrupted repositories
      for (let i = 0; i < repoCount; i++) {
        const isInterrupted = i % 10 === 0; // 10% are interrupted
        repos.push(
          createTestRepositoryInfo(`perf-repo-${i}`, {
            status: isInterrupted ? "indexing" : "ready",
            updateInProgress: isInterrupted,
            updateStartedAt: isInterrupted ? new Date().toISOString() : undefined,
          })
        );
      }

      // Persist all repositories
      for (const repo of repos) {
        await store.updateRepository(repo);
      }

      // Measure detection time
      const startTime = Date.now();
      const result = await detectInterruptedUpdates(store);
      const durationMs = Date.now() - startTime;

      // Should complete quickly (< 1 second)
      expect(durationMs).toBeLessThan(1000);
      expect(result.interrupted.length).toBe(5); // 10% of 50
      expect(result.totalRepositories).toBe(50);
      expect(result.detectionDurationMs).toBeLessThan(1000);
    });
  });

  describe("formatElapsedTime Edge Cases", () => {
    test("should format various time durations correctly", () => {
      // Seconds only
      expect(formatElapsedTime(0)).toBe("0s");
      expect(formatElapsedTime(1000)).toBe("1s");
      expect(formatElapsedTime(59000)).toBe("59s");

      // Minutes and seconds
      expect(formatElapsedTime(60000)).toBe("1m 0s");
      expect(formatElapsedTime(90000)).toBe("1m 30s");
      expect(formatElapsedTime(3599000)).toBe("59m 59s");

      // Hours and minutes
      expect(formatElapsedTime(3600000)).toBe("1h 0m");
      expect(formatElapsedTime(7200000)).toBe("2h 0m");
      expect(formatElapsedTime(86400000)).toBe("24h 0m"); // 24 hours
    });
  });
});
