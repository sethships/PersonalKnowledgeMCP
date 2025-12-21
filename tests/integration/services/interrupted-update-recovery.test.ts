/**
 * Integration tests for Interrupted Update Recovery
 *
 * Tests end-to-end recovery scenarios for interrupted updates,
 * including strategy evaluation, execution, and batch recovery.
 *
 * @module tests/integration/services/interrupted-update-recovery.test.ts
 */

import { expect, test, describe, beforeEach, afterEach, mock } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { RepositoryMetadataStoreImpl } from "../../../src/repositories/metadata-store.js";
import { detectInterruptedUpdates } from "../../../src/services/interrupted-update-detector.js";
import {
  evaluateRecoveryStrategy,
  executeRecovery,
  recoverMultiple,
  type RecoveryDependencies,
} from "../../../src/services/interrupted-update-recovery.js";
import { createTestRepositoryInfo } from "../../fixtures/repository-fixtures.js";
import { initializeLogger, resetLogger } from "../../../src/logging/index.js";
import type { RepositoryInfo, RepositoryMetadataService } from "../../../src/repositories/types.js";
import type { IngestionService } from "../../../src/services/ingestion-service.js";
import type { IncrementalUpdateCoordinator } from "../../../src/services/incremental-update-coordinator.js";

describe("Interrupted Update Recovery Integration Tests", () => {
  let tempDir: string;
  let store: RepositoryMetadataStoreImpl;

  beforeEach(async () => {
    // Initialize logger to suppress output during tests
    initializeLogger({
      level: "error",
      format: "json",
    });

    // Create temporary directory for test data
    tempDir = await mkdtemp(join(tmpdir(), "recovery-test-"));

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

  // Helper to create mock ingestion service
  function createMockIngestionService(
    options: {
      status?: "success" | "error";
      stats?: { filesProcessed: number; chunksCreated: number };
    } = {}
  ): IngestionService {
    const { status = "success", stats = { filesProcessed: 100, chunksCreated: 500 } } = options;
    return {
      indexRepository: mock(async () => ({
        status,
        stats: status === "success" ? stats : undefined,
      })),
    } as unknown as IngestionService;
  }

  // Helper to create mock update coordinator
  function createMockUpdateCoordinator(
    options: {
      status?: "updated" | "no_changes" | "failed";
      stats?: { filesAdded: number; filesModified: number; filesDeleted: number };
      errors?: string[];
    } = {}
  ): IncrementalUpdateCoordinator {
    const {
      status = "updated",
      stats = { filesAdded: 5, filesModified: 3, filesDeleted: 1 },
      errors = [],
    } = options;
    return {
      updateRepository: mock(async () => ({
        status,
        stats,
        errors,
      })),
    } as unknown as IncrementalUpdateCoordinator;
  }

  describe("Recovery Strategy Evaluation with Real Store", () => {
    test("should evaluate resume strategy for recent interruption with last commit", async () => {
      // Create interrupted repository with recent update
      const updateStartedAt = new Date(Date.now() - 60000).toISOString(); // 1 min ago
      const repo = createTestRepositoryInfo("resume-candidate", {
        status: "indexing",
        updateInProgress: true,
        updateStartedAt,
        lastIndexedCommitSha: "abc123def456",
        localPath: tempDir, // Use existing temp dir for accessibility check
      });

      await store.updateRepository(repo);

      // Detect and evaluate
      const detectionResult = await detectInterruptedUpdates(store);
      expect(detectionResult.interrupted.length).toBe(1);

      const strategy = await evaluateRecoveryStrategy(detectionResult.interrupted[0]!);

      expect(strategy.type).toBe("resume");
      expect(strategy.canAutoRecover).toBe(true);
      expect(strategy.reason).toContain("ago");
    });

    test("should evaluate full_reindex for stale interruption", async () => {
      // Create interrupted repository with stale update (>24 hours)
      const updateStartedAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      const repo = createTestRepositoryInfo("stale-update", {
        status: "indexing",
        updateInProgress: true,
        updateStartedAt,
        lastIndexedCommitSha: "abc123",
        localPath: tempDir,
      });

      await store.updateRepository(repo);

      // Detect and evaluate
      const detectionResult = await detectInterruptedUpdates(store);
      const strategy = await evaluateRecoveryStrategy(detectionResult.interrupted[0]!);

      expect(strategy.type).toBe("full_reindex");
      expect(strategy.canAutoRecover).toBe(true);
      expect(strategy.reason).toContain(">24 hours");
    });

    test("should evaluate full_reindex when no last commit available", async () => {
      const repo = createTestRepositoryInfo("no-commit", {
        status: "indexing",
        updateInProgress: true,
        updateStartedAt: new Date().toISOString(),
        lastIndexedCommitSha: undefined,
        localPath: tempDir,
      });

      await store.updateRepository(repo);

      const detectionResult = await detectInterruptedUpdates(store);
      const strategy = await evaluateRecoveryStrategy(detectionResult.interrupted[0]!);

      expect(strategy.type).toBe("full_reindex");
      expect(strategy.reason).toContain("No previous commit");
    });

    test("should evaluate manual_required for inaccessible path", async () => {
      const repo = createTestRepositoryInfo("inaccessible", {
        status: "indexing",
        updateInProgress: true,
        updateStartedAt: new Date().toISOString(),
        lastIndexedCommitSha: "abc123",
        localPath: "/nonexistent/path/that/does/not/exist",
      });

      await store.updateRepository(repo);

      const detectionResult = await detectInterruptedUpdates(store);
      const strategy = await evaluateRecoveryStrategy(detectionResult.interrupted[0]!);

      expect(strategy.type).toBe("manual_required");
      expect(strategy.canAutoRecover).toBe(false);
      expect(strategy.reason).toContain("not accessible");
    });
  });

  describe("Full Recovery Workflow", () => {
    test("should execute resume recovery and clear interrupted flag", async () => {
      const repo = createTestRepositoryInfo("full-recovery", {
        status: "indexing",
        updateInProgress: true,
        updateStartedAt: new Date().toISOString(),
        lastIndexedCommitSha: "abc123",
        localPath: tempDir,
      });

      await store.updateRepository(repo);

      // Detect interrupted
      const detectionResult = await detectInterruptedUpdates(store);
      expect(detectionResult.interrupted.length).toBe(1);

      // Evaluate strategy
      const strategy = await evaluateRecoveryStrategy(detectionResult.interrupted[0]!);
      expect(strategy.type).toBe("resume");

      // Execute recovery with mocked dependencies
      const deps: RecoveryDependencies = {
        repositoryService: store as unknown as RepositoryMetadataService,
        ingestionService: createMockIngestionService(),
        updateCoordinator: createMockUpdateCoordinator(),
      };

      const result = await executeRecovery(detectionResult.interrupted[0]!, strategy, deps);

      expect(result.success).toBe(true);
      expect(result.repositoryName).toBe("full-recovery");

      // Verify flag is cleared
      const updatedRepo = await store.getRepository("full-recovery");
      expect(updatedRepo?.updateInProgress).toBe(false);

      // Verify no longer detected as interrupted
      const newDetection = await detectInterruptedUpdates(store);
      expect(newDetection.interrupted.length).toBe(0);
    });

    test("should execute full_reindex recovery for stale updates", async () => {
      const repo = createTestRepositoryInfo("stale-recovery", {
        status: "indexing",
        updateInProgress: true,
        updateStartedAt: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
        lastIndexedCommitSha: "abc123",
        localPath: tempDir,
      });

      await store.updateRepository(repo);

      const detectionResult = await detectInterruptedUpdates(store);
      const strategy = await evaluateRecoveryStrategy(detectionResult.interrupted[0]!);

      const deps: RecoveryDependencies = {
        repositoryService: store as unknown as RepositoryMetadataService,
        ingestionService: createMockIngestionService({
          status: "success",
          stats: { filesProcessed: 50, chunksCreated: 200 },
        }),
        updateCoordinator: createMockUpdateCoordinator(),
      };

      const result = await executeRecovery(detectionResult.interrupted[0]!, strategy, deps);

      expect(result.success).toBe(true);
      expect(result.strategy.type).toBe("full_reindex");
      expect(result.message).toContain("50 files");
    });

    test("should handle manual_required by setting error status", async () => {
      const repo = createTestRepositoryInfo("manual-recovery", {
        status: "indexing",
        updateInProgress: true,
        updateStartedAt: new Date().toISOString(),
        lastIndexedCommitSha: "abc123",
        localPath: "/nonexistent/path",
      });

      await store.updateRepository(repo);

      const detectionResult = await detectInterruptedUpdates(store);
      const strategy = await evaluateRecoveryStrategy(detectionResult.interrupted[0]!);

      expect(strategy.type).toBe("manual_required");

      const deps: RecoveryDependencies = {
        repositoryService: store as unknown as RepositoryMetadataService,
        ingestionService: createMockIngestionService(),
        updateCoordinator: createMockUpdateCoordinator(),
      };

      const result = await executeRecovery(detectionResult.interrupted[0]!, strategy, deps);

      // Should succeed at clearing flag
      expect(result.success).toBe(true);
      expect(result.message).toContain("Manual action required");

      // Verify repository is marked as error
      const updatedRepo = await store.getRepository("manual-recovery");
      expect(updatedRepo?.status).toBe("error");
      expect(updatedRepo?.updateInProgress).toBe(false);
      expect(updatedRepo?.errorMessage).toContain("Manual intervention required");
    });
  });

  describe("Batch Recovery", () => {
    test("should recover multiple interrupted repositories", async () => {
      // Create multiple interrupted repositories
      const repos: RepositoryInfo[] = [
        createTestRepositoryInfo("batch-1", {
          status: "indexing",
          updateInProgress: true,
          updateStartedAt: new Date().toISOString(),
          lastIndexedCommitSha: "commit1",
          localPath: tempDir,
        }),
        createTestRepositoryInfo("batch-2", {
          status: "indexing",
          updateInProgress: true,
          updateStartedAt: new Date().toISOString(),
          lastIndexedCommitSha: "commit2",
          localPath: tempDir,
        }),
        createTestRepositoryInfo("normal", {
          status: "ready",
        }),
      ];

      for (const repo of repos) {
        await store.updateRepository(repo);
      }

      // Detect all interrupted
      const detectionResult = await detectInterruptedUpdates(store);
      expect(detectionResult.interrupted.length).toBe(2);

      // Recover all
      const deps: RecoveryDependencies = {
        repositoryService: store as unknown as RepositoryMetadataService,
        ingestionService: createMockIngestionService(),
        updateCoordinator: createMockUpdateCoordinator(),
      };

      const batchResult = await recoverMultiple(detectionResult.interrupted, deps);

      expect(batchResult.total).toBe(2);
      expect(batchResult.successful).toBe(2);
      expect(batchResult.failed).toBe(0);
      expect(batchResult.results).toHaveLength(2);

      // Verify all are recovered
      const newDetection = await detectInterruptedUpdates(store);
      expect(newDetection.interrupted.length).toBe(0);
    });

    test("should track partial failures in batch recovery", async () => {
      // Create repos with different recovery outcomes
      const repos: RepositoryInfo[] = [
        createTestRepositoryInfo("success-repo", {
          status: "indexing",
          updateInProgress: true,
          updateStartedAt: new Date().toISOString(),
          lastIndexedCommitSha: "commit1",
          localPath: tempDir,
        }),
        createTestRepositoryInfo("manual-repo", {
          status: "indexing",
          updateInProgress: true,
          updateStartedAt: new Date().toISOString(),
          lastIndexedCommitSha: "commit2",
          localPath: "/nonexistent/path", // Will require manual intervention
        }),
      ];

      for (const repo of repos) {
        await store.updateRepository(repo);
      }

      const detectionResult = await detectInterruptedUpdates(store);

      const deps: RecoveryDependencies = {
        repositoryService: store as unknown as RepositoryMetadataService,
        ingestionService: createMockIngestionService(),
        updateCoordinator: createMockUpdateCoordinator(),
      };

      const batchResult = await recoverMultiple(detectionResult.interrupted, deps);

      expect(batchResult.total).toBe(2);
      // One should require manual intervention
      expect(batchResult.manualRequired).toBeGreaterThan(0);
    });
  });

  describe("Persistence Across Service Restarts", () => {
    test("should maintain recovery state across service restart", async () => {
      // Set up interrupted repository
      const repo = createTestRepositoryInfo("persist-test", {
        status: "indexing",
        updateInProgress: true,
        updateStartedAt: new Date().toISOString(),
        lastIndexedCommitSha: "abc123",
        localPath: tempDir,
      });

      await store.updateRepository(repo);

      // Simulate service restart
      RepositoryMetadataStoreImpl.resetInstance();
      const newStore = RepositoryMetadataStoreImpl.getInstance(tempDir);

      // Detect on "new" service
      const detectionResult = await detectInterruptedUpdates(newStore);
      expect(detectionResult.interrupted.length).toBe(1);

      // Execute recovery with new store instance
      const strategy = await evaluateRecoveryStrategy(detectionResult.interrupted[0]!);
      const deps: RecoveryDependencies = {
        repositoryService: newStore as unknown as RepositoryMetadataService,
        ingestionService: createMockIngestionService(),
        updateCoordinator: createMockUpdateCoordinator(),
      };

      const result = await executeRecovery(detectionResult.interrupted[0]!, strategy, deps);
      expect(result.success).toBe(true);

      // Simulate another restart
      RepositoryMetadataStoreImpl.resetInstance();
      const thirdStore = RepositoryMetadataStoreImpl.getInstance(tempDir);

      // Should no longer be detected as interrupted
      const finalDetection = await detectInterruptedUpdates(thirdStore);
      expect(finalDetection.interrupted.length).toBe(0);
    });
  });

  describe("Edge Cases", () => {
    test("should handle recovery when repository is removed during process", async () => {
      const repo = createTestRepositoryInfo("removed-repo", {
        status: "indexing",
        updateInProgress: true,
        updateStartedAt: new Date().toISOString(),
        lastIndexedCommitSha: "abc123",
        localPath: tempDir,
      });

      await store.updateRepository(repo);

      const detectionResult = await detectInterruptedUpdates(store);

      // Remove repository before recovery
      await store.removeRepository("removed-repo");

      // Attempt recovery should handle gracefully
      const strategy = await evaluateRecoveryStrategy(detectionResult.interrupted[0]!);
      const deps: RecoveryDependencies = {
        repositoryService: store as unknown as RepositoryMetadataService,
        ingestionService: createMockIngestionService(),
        updateCoordinator: createMockUpdateCoordinator(),
      };

      const result = await executeRecovery(detectionResult.interrupted[0]!, strategy, deps);

      // Should fail gracefully with error message
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    test("should handle concurrent detection and recovery", async () => {
      const repo = createTestRepositoryInfo("concurrent-test", {
        status: "indexing",
        updateInProgress: true,
        updateStartedAt: new Date().toISOString(),
        lastIndexedCommitSha: "abc123",
        localPath: tempDir,
      });

      await store.updateRepository(repo);

      // Run detection concurrently
      const [detection1, detection2] = await Promise.all([
        detectInterruptedUpdates(store),
        detectInterruptedUpdates(store),
      ]);

      // Both should detect the same interrupted update
      expect(detection1.interrupted.length).toBe(1);
      expect(detection2.interrupted.length).toBe(1);
      expect(detection1.interrupted[0]!.repositoryName).toBe(
        detection2.interrupted[0]!.repositoryName
      );
    });

    test("should handle very long elapsed times", async () => {
      // Repository interrupted 30 days ago
      const repo = createTestRepositoryInfo("ancient-update", {
        status: "indexing",
        updateInProgress: true,
        updateStartedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        lastIndexedCommitSha: "abc123",
        localPath: tempDir,
      });

      await store.updateRepository(repo);

      const detectionResult = await detectInterruptedUpdates(store);
      const strategy = await evaluateRecoveryStrategy(detectionResult.interrupted[0]!);

      // Should recommend full reindex for very stale updates
      expect(strategy.type).toBe("full_reindex");
      expect(strategy.canAutoRecover).toBe(true);
    });
  });

  describe("Performance", () => {
    test("should evaluate strategies quickly for many interrupted updates", async () => {
      const count = 20;
      const repos: RepositoryInfo[] = [];

      for (let i = 0; i < count; i++) {
        repos.push(
          createTestRepositoryInfo(`perf-test-${i}`, {
            status: "indexing",
            updateInProgress: true,
            updateStartedAt: new Date().toISOString(),
            lastIndexedCommitSha: `commit${i}`,
            localPath: tempDir,
          })
        );
      }

      for (const repo of repos) {
        await store.updateRepository(repo);
      }

      const startTime = Date.now();
      const detectionResult = await detectInterruptedUpdates(store);

      // Evaluate all strategies
      const strategies = await Promise.all(
        detectionResult.interrupted.map((i) => evaluateRecoveryStrategy(i))
      );

      const durationMs = Date.now() - startTime;

      expect(detectionResult.interrupted.length).toBe(count);
      expect(strategies.length).toBe(count);
      expect(durationMs).toBeLessThan(5000); // Should complete in < 5 seconds
    });
  });
});
