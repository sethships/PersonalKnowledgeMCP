/**
 * Tests for IncrementalUpdateCoordinator completeness check integration
 *
 * Validates that the coordinator correctly runs post-update completeness
 * checks and attaches results to the CoordinatorResult.
 *
 * @module tests/services/incremental-update-coordinator-completeness
 */

/* eslint-disable @typescript-eslint/unbound-method */
/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { describe, it, expect, beforeEach, mock } from "bun:test";
import { IncrementalUpdateCoordinator } from "../../src/services/incremental-update-coordinator.js";
import { initializeLogger } from "../../src/logging/index.js";
import type {
  GitHubClient,
  CommitInfo,
  CommitComparison,
} from "../../src/services/github-client-types.js";
import type { RepositoryMetadataService, RepositoryInfo } from "../../src/repositories/types.js";
import type { IncrementalUpdatePipeline } from "../../src/services/incremental-update-pipeline.js";
import type { UpdateResult } from "../../src/services/incremental-update-types.js";
import type { IndexCompletenessChecker } from "../../src/services/index-completeness-checker.js";
import type { CompletenessCheckResult } from "../../src/services/index-completeness-types.js";

describe("IncrementalUpdateCoordinator - Completeness Integration", () => {
  // Test fixture: Repository metadata
  const testRepo: RepositoryInfo = {
    name: "test-repo",
    url: "https://github.com/owner/test-repo.git",
    localPath: "/repos/test-repo",
    collectionName: "repo_test_repo",
    fileCount: 100,
    chunkCount: 500,
    lastIndexedAt: "2024-12-01T00:00:00.000Z",
    indexDurationMs: 5000,
    status: "ready",
    branch: "main",
    includeExtensions: [".ts", ".js", ".md"],
    excludePatterns: ["node_modules/**", "dist/**"],
    lastIndexedCommitSha: "abc123def456abc123def456abc123def456abc1",
    lastIncrementalUpdateAt: "2024-12-01T00:00:00.000Z",
    incrementalUpdateCount: 0,
  };

  // Test fixture: HEAD commit (same as base for "no_changes")
  const sameHeadCommit: CommitInfo = {
    sha: "abc123def456abc123def456abc123def456abc1",
    message: "existing commit",
    author: "Test Author",
    date: "2024-12-01T00:00:00.000Z",
  };

  // Test fixture: NEW HEAD commit (different from base for "updated")
  const newHeadCommit: CommitInfo = {
    sha: "def456abc123def456abc123def456abc123def4",
    message: "feat: add new feature",
    author: "Test Author",
    date: "2024-12-02T00:00:00.000Z",
  };

  // Test fixture: Commit comparison
  const comparison: CommitComparison = {
    baseSha: "abc123def456abc123def456abc123def456abc1",
    headSha: "def456abc123def456abc123def456abc123def4",
    totalCommits: 1,
    files: [{ path: "src/new.ts", status: "added" }],
  };

  // Test fixture: Completeness check result
  const completeResult: CompletenessCheckResult = {
    status: "complete",
    indexedFileCount: 100,
    eligibleFileCount: 100,
    missingFileCount: 0,
    divergencePercent: 0,
    durationMs: 50,
  };

  const incompleteResult: CompletenessCheckResult = {
    status: "incomplete",
    indexedFileCount: 89,
    eligibleFileCount: 424,
    missingFileCount: 335,
    divergencePercent: 79,
    durationMs: 142,
  };

  let mockGitHubClient: GitHubClient;
  let mockRepositoryService: RepositoryMetadataService;
  let mockUpdatePipeline: IncrementalUpdatePipeline;
  let mockCompletenessChecker: IndexCompletenessChecker;

  beforeEach(() => {
    initializeLogger({ level: "silent", format: "json" });

    mockGitHubClient = {
      getHeadCommit: mock(async () => newHeadCommit),
      compareCommits: mock(async () => comparison),
      healthCheck: mock(async () => true),
    };

    mockRepositoryService = {
      listRepositories: mock(async () => [testRepo]),
      getRepository: mock(async (name: string) => (name === "test-repo" ? testRepo : null)),
      updateRepository: mock(async () => {}),
      removeRepository: mock(async () => {}),
    };

    const mockPipelineResult: UpdateResult = {
      stats: {
        filesAdded: 1,
        filesModified: 0,
        filesDeleted: 0,
        chunksUpserted: 5,
        chunksDeleted: 0,
        durationMs: 500,
      },
      errors: [],
    };
    mockUpdatePipeline = {
      processChanges: mock(async () => mockPipelineResult),
    } as unknown as IncrementalUpdatePipeline;

    mockCompletenessChecker = {
      checkCompleteness: mock(async () => completeResult),
    } as unknown as IndexCompletenessChecker;
  });

  describe("updated status path", () => {
    it("should attach completeness result when checker is provided", async () => {
      const coordinator = new IncrementalUpdateCoordinator(
        mockGitHubClient,
        mockRepositoryService,
        mockUpdatePipeline,
        {
          customGitPull: mock(async () => {}),
          completenessChecker: mockCompletenessChecker,
        }
      );

      const result = await coordinator.updateRepository("test-repo");

      expect(result.status).toBe("updated");
      expect(result.completenessCheck).toBeDefined();
      expect(result.completenessCheck!.status).toBe("complete");
      expect(result.completenessCheck!.indexedFileCount).toBe(100);
      expect(result.completenessCheck!.eligibleFileCount).toBe(100);
    });

    it("should attach incomplete result when detected", async () => {
      const incompleteChecker = {
        checkCompleteness: mock(async () => incompleteResult),
      } as unknown as IndexCompletenessChecker;

      const coordinator = new IncrementalUpdateCoordinator(
        mockGitHubClient,
        mockRepositoryService,
        mockUpdatePipeline,
        {
          customGitPull: mock(async () => {}),
          completenessChecker: incompleteChecker,
        }
      );

      const result = await coordinator.updateRepository("test-repo");

      expect(result.status).toBe("updated");
      expect(result.completenessCheck).toBeDefined();
      expect(result.completenessCheck!.status).toBe("incomplete");
      expect(result.completenessCheck!.missingFileCount).toBe(335);
    });
  });

  describe("failed status path", () => {
    it("should not run completeness check when pipeline returns errors", async () => {
      const failedPipelineResult: UpdateResult = {
        stats: {
          filesAdded: 0,
          filesModified: 0,
          filesDeleted: 0,
          chunksUpserted: 0,
          chunksDeleted: 0,
          durationMs: 200,
        },
        errors: [
          {
            path: "src/broken.ts",
            error: "Parse error",
          },
        ],
      };
      const failedPipeline = {
        processChanges: mock(async () => failedPipelineResult),
      } as unknown as IncrementalUpdatePipeline;

      const coordinator = new IncrementalUpdateCoordinator(
        mockGitHubClient,
        mockRepositoryService,
        failedPipeline,
        {
          customGitPull: mock(async () => {}),
          completenessChecker: mockCompletenessChecker,
        }
      );

      const result = await coordinator.updateRepository("test-repo");

      expect(result.status).toBe("failed");
      expect(result.completenessCheck).toBeUndefined();
      // Verify completeness checker was never called
      expect(mockCompletenessChecker.checkCompleteness).not.toHaveBeenCalled();
    });
  });

  describe("no_changes status path", () => {
    it("should attach completeness result on no_changes", async () => {
      // Return same HEAD commit to trigger no_changes path
      const sameCommitGitHub: GitHubClient = {
        getHeadCommit: mock(async () => sameHeadCommit),
        compareCommits: mock(async () => comparison),
        healthCheck: mock(async () => true),
      };

      const coordinator = new IncrementalUpdateCoordinator(
        sameCommitGitHub,
        mockRepositoryService,
        mockUpdatePipeline,
        {
          customGitPull: mock(async () => {}),
          completenessChecker: mockCompletenessChecker,
        }
      );

      const result = await coordinator.updateRepository("test-repo");

      expect(result.status).toBe("no_changes");
      expect(result.completenessCheck).toBeDefined();
      expect(result.completenessCheck!.status).toBe("complete");
    });
  });

  describe("backward compatibility", () => {
    it("should omit completenessCheck when checker is not provided", async () => {
      const coordinator = new IncrementalUpdateCoordinator(
        mockGitHubClient,
        mockRepositoryService,
        mockUpdatePipeline,
        {
          customGitPull: mock(async () => {}),
          // No completenessChecker
        }
      );

      const result = await coordinator.updateRepository("test-repo");

      expect(result.status).toBe("updated");
      expect(result.completenessCheck).toBeUndefined();
    });

    it("should omit completenessCheck on no_changes when checker not provided", async () => {
      const sameCommitGitHub: GitHubClient = {
        getHeadCommit: mock(async () => sameHeadCommit),
        compareCommits: mock(async () => comparison),
        healthCheck: mock(async () => true),
      };

      const coordinator = new IncrementalUpdateCoordinator(
        sameCommitGitHub,
        mockRepositoryService,
        mockUpdatePipeline,
        {
          customGitPull: mock(async () => {}),
        }
      );

      const result = await coordinator.updateRepository("test-repo");

      expect(result.status).toBe("no_changes");
      expect(result.completenessCheck).toBeUndefined();
    });
  });

  describe("error resilience", () => {
    it("should not fail the update when completeness check throws", async () => {
      const errorChecker = {
        checkCompleteness: mock(async () => {
          throw new Error("File system access denied");
        }),
      } as unknown as IndexCompletenessChecker;

      const coordinator = new IncrementalUpdateCoordinator(
        mockGitHubClient,
        mockRepositoryService,
        mockUpdatePipeline,
        {
          customGitPull: mock(async () => {}),
          completenessChecker: errorChecker,
        }
      );

      // Should not throw - completeness check is non-blocking
      const result = await coordinator.updateRepository("test-repo");

      expect(result.status).toBe("updated");
      expect(result.completenessCheck).toBeUndefined();
    });

    it("should not fail no_changes when completeness check throws", async () => {
      const sameCommitGitHub: GitHubClient = {
        getHeadCommit: mock(async () => sameHeadCommit),
        compareCommits: mock(async () => comparison),
        healthCheck: mock(async () => true),
      };

      const errorChecker = {
        checkCompleteness: mock(async () => {
          throw new Error("Disk full");
        }),
      } as unknown as IndexCompletenessChecker;

      const coordinator = new IncrementalUpdateCoordinator(
        sameCommitGitHub,
        mockRepositoryService,
        mockUpdatePipeline,
        {
          customGitPull: mock(async () => {}),
          completenessChecker: errorChecker,
        }
      );

      const result = await coordinator.updateRepository("test-repo");

      expect(result.status).toBe("no_changes");
      expect(result.completenessCheck).toBeUndefined();
    });

    it("should handle repository not found during completeness check", async () => {
      // After update, the re-fetch returns null (unusual but possible)
      // The coordinator calls getRepository once at the start,
      // then runCompletenessCheck calls it again at the end.
      let getRepoCallCount = 0;
      const disappearingRepoService: RepositoryMetadataService = {
        listRepositories: mock(async () => [testRepo]),
        getRepository: mock(async (name: string) => {
          getRepoCallCount++;
          // First call returns the repo (for the main update flow),
          // second call returns null (for the completeness check re-fetch)
          if (name === "test-repo" && getRepoCallCount <= 1) return testRepo;
          return null;
        }),
        updateRepository: mock(async () => {}),
        removeRepository: mock(async () => {}),
      };

      const coordinator = new IncrementalUpdateCoordinator(
        mockGitHubClient,
        disappearingRepoService,
        mockUpdatePipeline,
        {
          customGitPull: mock(async () => {}),
          completenessChecker: mockCompletenessChecker,
        }
      );

      const result = await coordinator.updateRepository("test-repo");

      expect(result.status).toBe("updated");
      // Completeness check should be undefined since repo not found on re-fetch
      expect(result.completenessCheck).toBeUndefined();
    });
  });
});
