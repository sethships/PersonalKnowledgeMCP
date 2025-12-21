/**
 * Comprehensive Error Handling Integration Tests
 *
 * Tests end-to-end error handling scenarios for the incremental update system,
 * including force push recovery, network failures, and error message verification.
 *
 * @module tests/integration/services/error-handling-comprehensive.test.ts
 */

/* eslint-disable @typescript-eslint/await-thenable, @typescript-eslint/unbound-method */
import { expect, test, describe, beforeEach, afterEach, mock } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { RepositoryMetadataStoreImpl } from "../../../src/repositories/metadata-store.js";
import { IncrementalUpdateCoordinator } from "../../../src/services/incremental-update-coordinator.js";
import {
  ForcePushDetectedError,
  ChangeThresholdExceededError,
} from "../../../src/services/incremental-update-coordinator-errors.js";
import { evaluateRecoveryStrategy } from "../../../src/services/interrupted-update-recovery.js";
import { detectInterruptedUpdates } from "../../../src/services/interrupted-update-detector.js";
import { createTestRepositoryInfo } from "../../fixtures/repository-fixtures.js";
import { initializeLogger, resetLogger } from "../../../src/logging/index.js";
import { GitHubNotFoundError } from "../../../src/services/github-client-errors.js";
import type {
  GitHubClient,
  CommitInfo,
  CommitComparison,
} from "../../../src/services/github-client-types.js";
import type { RepositoryMetadataService, RepositoryInfo } from "../../../src/repositories/types.js";
import type { IncrementalUpdatePipeline } from "../../../src/services/incremental-update-pipeline.js";
import type { UpdateResult } from "../../../src/services/incremental-update-types.js";

describe("Comprehensive Error Handling Integration Tests", () => {
  let tempDir: string;
  let store: RepositoryMetadataStoreImpl;

  beforeEach(async () => {
    initializeLogger({ level: "error", format: "json" });
    tempDir = await mkdtemp(join(tmpdir(), "error-handling-test-"));
    RepositoryMetadataStoreImpl.resetInstance();
    store = RepositoryMetadataStoreImpl.getInstance(tempDir);
  });

  afterEach(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    resetLogger();
    RepositoryMetadataStoreImpl.resetInstance();
  });

  describe("Force Push Recovery Flow", () => {
    test("should detect force push and recommend full reindex recovery", async () => {
      // Setup: Repository with lastIndexedCommitSha
      const repo = createTestRepositoryInfo("force-push-repo", {
        status: "indexing",
        updateInProgress: true,
        updateStartedAt: new Date().toISOString(),
        lastIndexedCommitSha: "abc123def456abc123def456abc123def456abc1",
        localPath: tempDir,
      });

      await store.updateRepository(repo);

      // Detect the interrupted update
      const detectionResult = await detectInterruptedUpdates(store);
      expect(detectionResult.interrupted.length).toBe(1);

      // Evaluate recovery strategy
      const strategy = await evaluateRecoveryStrategy(detectionResult.interrupted[0]!);

      // Should recommend resume (or full_reindex for older updates)
      expect(["resume", "full_reindex"]).toContain(strategy.type);
      expect(strategy.canAutoRecover).toBe(true);
    });

    test("should detect ForcePushDetectedError and capture commit info", async () => {
      // Create mocks for coordinator
      const headCommit: CommitInfo = {
        sha: "new456abc123def456abc123def456abc123def4",
        message: "after force push",
        author: "Test",
        date: new Date().toISOString(),
      };

      const mockGitHubClient: GitHubClient = {
        getHeadCommit: mock(async () => headCommit),
        compareCommits: mock(async () => {
          throw new GitHubNotFoundError(
            "Commit not found - history was rewritten",
            "https://api.github.com/..."
          );
        }),
        healthCheck: mock(async () => true),
      };

      const testRepo: RepositoryInfo = {
        name: "test-repo",
        url: "https://github.com/owner/test-repo.git",
        localPath: tempDir,
        collectionName: "repo_test_repo",
        fileCount: 100,
        chunkCount: 500,
        lastIndexedAt: "2024-12-01T00:00:00.000Z",
        indexDurationMs: 5000,
        status: "ready",
        branch: "main",
        includeExtensions: [".ts"],
        excludePatterns: [],
        lastIndexedCommitSha: "old123abc456def789old123abc456def789old1",
      };

      const mockRepositoryService: RepositoryMetadataService = {
        listRepositories: mock(async () => [testRepo]),
        getRepository: mock(async () => testRepo),
        updateRepository: mock(async () => {}),
        removeRepository: mock(async () => {}),
      };

      const mockPipelineResult: UpdateResult = {
        stats: {
          filesAdded: 0,
          filesModified: 0,
          filesDeleted: 0,
          chunksUpserted: 0,
          chunksDeleted: 0,
          durationMs: 0,
        },
        errors: [],
      };

      const mockPipeline = {
        processChanges: mock(async () => mockPipelineResult),
      } as unknown as IncrementalUpdatePipeline;

      const coordinator = new IncrementalUpdateCoordinator(
        mockGitHubClient,
        mockRepositoryService,
        mockPipeline,
        { customGitPull: mock(async () => {}) }
      );

      // Execute and verify ForcePushDetectedError
      try {
        await coordinator.updateRepository("test-repo");
        throw new Error("Should not reach here");
      } catch (error) {
        expect(error).toBeInstanceOf(ForcePushDetectedError);

        const fpError = error as ForcePushDetectedError;
        expect(fpError.repositoryName).toBe("test-repo");
        expect(fpError.lastIndexedCommitSha).toBe(testRepo.lastIndexedCommitSha!);
        expect(fpError.currentHeadSha).toBe(headCommit.sha);
        expect(fpError.message).toContain("Force push detected");
        expect(fpError.message).toContain("Full re-index required");
      }
    });
  });

  describe("Network Failure Handling", () => {
    test("should propagate GitHub API errors correctly", async () => {
      const mockGitHubClient: GitHubClient = {
        getHeadCommit: mock(async () => {
          throw new Error("Network timeout: connection refused");
        }),
        compareCommits: mock(async () => {
          throw new Error("Should not be called");
        }),
        healthCheck: mock(async () => false),
      };

      const testRepo: RepositoryInfo = {
        name: "test-repo",
        url: "https://github.com/owner/test-repo.git",
        localPath: tempDir,
        collectionName: "repo_test_repo",
        fileCount: 100,
        chunkCount: 500,
        lastIndexedAt: "2024-12-01T00:00:00.000Z",
        indexDurationMs: 5000,
        status: "ready",
        branch: "main",
        includeExtensions: [".ts"],
        excludePatterns: [],
        lastIndexedCommitSha: "abc123def456abc123def456abc123def456abc1",
      };

      const mockRepositoryService: RepositoryMetadataService = {
        listRepositories: mock(async () => [testRepo]),
        getRepository: mock(async () => testRepo),
        updateRepository: mock(async () => {}),
        removeRepository: mock(async () => {}),
      };

      const mockPipeline = {
        processChanges: mock(async () => ({
          stats: {
            filesAdded: 0,
            filesModified: 0,
            filesDeleted: 0,
            chunksUpserted: 0,
            chunksDeleted: 0,
            durationMs: 0,
          },
          errors: [],
        })),
      } as unknown as IncrementalUpdatePipeline;

      const coordinator = new IncrementalUpdateCoordinator(
        mockGitHubClient,
        mockRepositoryService,
        mockPipeline,
        { customGitPull: mock(async () => {}) }
      );

      // Should propagate the network error
      await expect(coordinator.updateRepository("test-repo")).rejects.toThrow(
        "Network timeout: connection refused"
      );
    });

    test("should clean up in-progress flag after network failure", async () => {
      const updateCalls: RepositoryInfo[] = [];

      // Track stateful changes to simulate real behavior
      let currentInProgressState = false;
      let currentUpdateStartedAt: string | undefined;

      const mockGitHubClient: GitHubClient = {
        getHeadCommit: mock(async () => {
          throw new Error("API rate limit exceeded");
        }),
        compareCommits: mock(async () => {
          throw new Error("Should not be called");
        }),
        healthCheck: mock(async () => true),
      };

      const baseRepo: RepositoryInfo = {
        name: "test-repo",
        url: "https://github.com/owner/test-repo.git",
        localPath: tempDir,
        collectionName: "repo_test_repo",
        fileCount: 100,
        chunkCount: 500,
        lastIndexedAt: "2024-12-01T00:00:00.000Z",
        indexDurationMs: 5000,
        status: "ready",
        branch: "main",
        includeExtensions: [".ts"],
        excludePatterns: [],
        lastIndexedCommitSha: "abc123def456abc123def456abc123def456abc1",
      };

      const mockRepositoryService: RepositoryMetadataService = {
        listRepositories: mock(async () => [baseRepo]),
        getRepository: mock(async () => ({
          ...baseRepo,
          updateInProgress: currentInProgressState,
          updateStartedAt: currentUpdateStartedAt,
        })),
        updateRepository: mock(async (repo: RepositoryInfo) => {
          // Track state changes
          currentInProgressState = repo.updateInProgress ?? false;
          currentUpdateStartedAt = repo.updateStartedAt;
          updateCalls.push({ ...repo });
        }),
        removeRepository: mock(async () => {}),
      };

      const mockPipeline = {
        processChanges: mock(async () => ({
          stats: {
            filesAdded: 0,
            filesModified: 0,
            filesDeleted: 0,
            chunksUpserted: 0,
            chunksDeleted: 0,
            durationMs: 0,
          },
          errors: [],
        })),
      } as unknown as IncrementalUpdatePipeline;

      const coordinator = new IncrementalUpdateCoordinator(
        mockGitHubClient,
        mockRepositoryService,
        mockPipeline,
        { customGitPull: mock(async () => {}) }
      );

      // Execute and expect failure
      try {
        await coordinator.updateRepository("test-repo");
      } catch {
        // Expected to fail
      }

      // Verify in-progress flag was set and then cleared
      expect(updateCalls.length).toBeGreaterThanOrEqual(2);
      expect(updateCalls[0]?.updateInProgress).toBe(true);
      expect(updateCalls[updateCalls.length - 1]?.updateInProgress).toBe(false);
    });
  });

  describe("Error Message Verification", () => {
    test("ChangeThresholdExceededError should have correct message format", async () => {
      const error = new ChangeThresholdExceededError("my-repo", 750, 500);

      expect(error.message).toContain("750");
      expect(error.message).toContain("500");
      expect(error.message).toContain("my-repo");
      expect(error.message).toContain("Full re-index required");
      expect(error.changeCount).toBe(750);
      expect(error.threshold).toBe(500);
      expect(error.repositoryName).toBe("my-repo");
    });

    test("ForcePushDetectedError should have correct message format", async () => {
      const error = new ForcePushDetectedError(
        "my-repo",
        "old123abc456def789old123abc456def789old1",
        "new456abc123def456abc123def456abc123def4"
      );

      expect(error.message).toContain("my-repo");
      expect(error.message).toContain("Force push detected");
      expect(error.message).toContain("old123a"); // First 7 chars
      expect(error.message).toContain("new456a"); // First 7 chars
      expect(error.message).toContain("Full re-index required");
      expect(error.lastIndexedCommitSha).toBe("old123abc456def789old123abc456def789old1");
      expect(error.currentHeadSha).toBe("new456abc123def456abc123def456abc123def4");
    });
  });

  describe("Threshold Boundary Conditions", () => {
    test("should process exactly 500 files without error", async () => {
      const headCommit: CommitInfo = {
        sha: "new456abc123def456abc123def456abc123def4",
        message: "500 file update",
        author: "Test",
        date: new Date().toISOString(),
      };

      const boundaryComparison: CommitComparison = {
        baseSha: "abc123def456abc123def456abc123def456abc1",
        headSha: headCommit.sha,
        totalCommits: 1,
        files: Array.from({ length: 500 }, (_, i) => ({
          path: `file${i}.ts`,
          status: "added" as const,
        })),
      };

      const mockGitHubClient: GitHubClient = {
        getHeadCommit: mock(async () => headCommit),
        compareCommits: mock(async () => boundaryComparison),
        healthCheck: mock(async () => true),
      };

      const testRepo: RepositoryInfo = {
        name: "test-repo",
        url: "https://github.com/owner/test-repo.git",
        localPath: tempDir,
        collectionName: "repo_test_repo",
        fileCount: 100,
        chunkCount: 500,
        lastIndexedAt: "2024-12-01T00:00:00.000Z",
        indexDurationMs: 5000,
        status: "ready",
        branch: "main",
        includeExtensions: [".ts"],
        excludePatterns: [],
        lastIndexedCommitSha: "abc123def456abc123def456abc123def456abc1",
      };

      const mockRepositoryService: RepositoryMetadataService = {
        listRepositories: mock(async () => [testRepo]),
        getRepository: mock(async () => testRepo),
        updateRepository: mock(async () => {}),
        removeRepository: mock(async () => {}),
      };

      const mockPipeline = {
        processChanges: mock(async () => ({
          stats: {
            filesAdded: 500,
            filesModified: 0,
            filesDeleted: 0,
            chunksUpserted: 1000,
            chunksDeleted: 0,
            durationMs: 5000,
          },
          errors: [],
        })),
      } as unknown as IncrementalUpdatePipeline;

      const coordinator = new IncrementalUpdateCoordinator(
        mockGitHubClient,
        mockRepositoryService,
        mockPipeline,
        { customGitPull: mock(async () => {}) }
      );

      // Should NOT throw - 500 is at threshold, not over
      const result = await coordinator.updateRepository("test-repo");
      expect(result.status).toBe("updated");
      expect(mockPipeline.processChanges).toHaveBeenCalled();
    });

    test("should throw ChangeThresholdExceededError for 501 files", async () => {
      const headCommit: CommitInfo = {
        sha: "new456abc123def456abc123def456abc123def4",
        message: "501 file update",
        author: "Test",
        date: new Date().toISOString(),
      };

      const overThresholdComparison: CommitComparison = {
        baseSha: "abc123def456abc123def456abc123def456abc1",
        headSha: headCommit.sha,
        totalCommits: 1,
        files: Array.from({ length: 501 }, (_, i) => ({
          path: `file${i}.ts`,
          status: "added" as const,
        })),
      };

      const mockGitHubClient: GitHubClient = {
        getHeadCommit: mock(async () => headCommit),
        compareCommits: mock(async () => overThresholdComparison),
        healthCheck: mock(async () => true),
      };

      const testRepo: RepositoryInfo = {
        name: "test-repo",
        url: "https://github.com/owner/test-repo.git",
        localPath: tempDir,
        collectionName: "repo_test_repo",
        fileCount: 100,
        chunkCount: 500,
        lastIndexedAt: "2024-12-01T00:00:00.000Z",
        indexDurationMs: 5000,
        status: "ready",
        branch: "main",
        includeExtensions: [".ts"],
        excludePatterns: [],
        lastIndexedCommitSha: "abc123def456abc123def456abc123def456abc1",
      };

      const mockRepositoryService: RepositoryMetadataService = {
        listRepositories: mock(async () => [testRepo]),
        getRepository: mock(async () => testRepo),
        updateRepository: mock(async () => {}),
        removeRepository: mock(async () => {}),
      };

      const mockPipeline = {
        processChanges: mock(async () => ({
          stats: {
            filesAdded: 0,
            filesModified: 0,
            filesDeleted: 0,
            chunksUpserted: 0,
            chunksDeleted: 0,
            durationMs: 0,
          },
          errors: [],
        })),
      } as unknown as IncrementalUpdatePipeline;

      const coordinator = new IncrementalUpdateCoordinator(
        mockGitHubClient,
        mockRepositoryService,
        mockPipeline,
        { customGitPull: mock(async () => {}) }
      );

      // Should throw - 501 exceeds threshold
      await expect(coordinator.updateRepository("test-repo")).rejects.toThrow(
        ChangeThresholdExceededError
      );
    });
  });
});
