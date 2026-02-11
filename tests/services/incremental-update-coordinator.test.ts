/**
 * Tests for IncrementalUpdateCoordinator service
 *
 * @module tests/services/incremental-update-coordinator
 */

/* eslint-disable @typescript-eslint/unbound-method */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { IncrementalUpdateCoordinator } from "../../src/services/incremental-update-coordinator.js";
import { initializeLogger, resetLogger } from "../../src/logging/index.js";
import type {
  GitHubClient,
  CommitInfo,
  CommitComparison,
} from "../../src/services/github-client-types.js";
import type { RepositoryMetadataService, RepositoryInfo } from "../../src/repositories/types.js";
import type { IncrementalUpdatePipeline } from "../../src/services/incremental-update-pipeline.js";
import type { UpdateResult } from "../../src/services/incremental-update-types.js";
import { GitHubNotFoundError } from "../../src/services/github-client-errors.js";
import {
  RepositoryNotFoundError,
  ForcePushDetectedError,
  ChangeThresholdExceededError,
  MissingCommitShaError,
  GitPullError,
  ConcurrentUpdateError,
} from "../../src/services/incremental-update-coordinator-errors.js";

describe("IncrementalUpdateCoordinator", () => {
  let coordinator: IncrementalUpdateCoordinator;
  let mockGitHubClient: GitHubClient;
  let mockRepositoryService: RepositoryMetadataService;
  let mockUpdatePipeline: IncrementalUpdatePipeline;

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

  // Test fixture: HEAD commit
  const headCommit: CommitInfo = {
    sha: "def456abc123def456abc123def456abc123def4",
    message: "feat: add new feature",
    author: "Test Author",
    date: "2024-12-02T00:00:00.000Z",
  };

  // Test fixture: Commit comparison
  const comparison: CommitComparison = {
    baseSha: "abc123def456abc123def456abc123def456abc1",
    headSha: "def456abc123def456abc123def456abc123def4",
    totalCommits: 5,
    files: [
      { path: "src/new.ts", status: "added" },
      { path: "src/updated.ts", status: "modified" },
      { path: "src/old.ts", status: "deleted" },
    ],
  };

  beforeEach(() => {
    // Initialize logger for tests
    initializeLogger({ level: "silent", format: "json" });

    // Create mock GitHub client
    mockGitHubClient = {
      getHeadCommit: mock(async (_owner, _repo, _branch) => headCommit),
      compareCommits: mock(async (_owner, _repo, _base, _head) => comparison),
      healthCheck: mock(async () => true),
    };

    // Create mock repository service
    mockRepositoryService = {
      listRepositories: mock(async () => [testRepo]),
      getRepository: mock(async (name) => (name === "test-repo" ? testRepo : null)),
      updateRepository: mock(async (_repo) => {}),
      removeRepository: mock(async (_name) => {}),
    };

    // Create mock update pipeline
    const mockPipelineResult: UpdateResult = {
      stats: {
        filesAdded: 1,
        filesModified: 1,
        filesDeleted: 1,
        chunksUpserted: 15,
        chunksDeleted: 5,
        durationMs: 1500,
      },
      errors: [],
    };
    mockUpdatePipeline = {
      processChanges: mock(async (_changes, _options) => mockPipelineResult),
    } as unknown as IncrementalUpdatePipeline;

    // Create coordinator with mocked git pull
    coordinator = new IncrementalUpdateCoordinator(
      mockGitHubClient,
      mockRepositoryService,
      mockUpdatePipeline,
      {
        // Mock git pull for testing (avoid real git operations)
        customGitPull: mock(async (_localPath: string, _branch: string) => {
          // No-op for tests
        }),
      }
    );
  });

  afterEach(() => {
    resetLogger();
  });

  describe("updateRepository", () => {
    it("should throw RepositoryNotFoundError when repository doesn't exist", async () => {
      // eslint-disable-next-line @typescript-eslint/await-thenable
      await expect(coordinator.updateRepository("non-existent")).rejects.toThrow(
        RepositoryNotFoundError
      );
    });

    it("should throw MissingCommitShaError when repository has no lastIndexedCommitSha", async () => {
      const repoWithoutSha: RepositoryInfo = {
        ...testRepo,
        lastIndexedCommitSha: undefined,
      };
      mockRepositoryService.getRepository = mock(async () => repoWithoutSha);

      // eslint-disable-next-line @typescript-eslint/await-thenable
      await expect(coordinator.updateRepository("test-repo")).rejects.toThrow(
        MissingCommitShaError
      );
    });

    it("should throw ConcurrentUpdateError when update is already in progress", async () => {
      const repoInProgress: RepositoryInfo = {
        ...testRepo,
        updateInProgress: true,
        updateStartedAt: "2024-12-14T10:00:00.000Z",
      };
      mockRepositoryService.getRepository = mock(async () => repoInProgress);

      // eslint-disable-next-line @typescript-eslint/await-thenable
      await expect(coordinator.updateRepository("test-repo")).rejects.toThrow(
        ConcurrentUpdateError
      );

      // Verify the error message contains useful information
      try {
        await coordinator.updateRepository("test-repo");
      } catch (error) {
        expect(error).toBeInstanceOf(ConcurrentUpdateError);
        const concurrentError = error as ConcurrentUpdateError;
        expect(concurrentError.repositoryName).toBe("test-repo");
        expect(concurrentError.updateStartedAt).toBe("2024-12-14T10:00:00.000Z");
        expect(concurrentError.message).toContain("already in progress");
        expect(concurrentError.message).toContain("test-repo");
      }
    });

    it("should process update with exactly 500 files (at threshold boundary)", async () => {
      // Exactly 500 files should NOT throw ChangeThresholdExceededError
      const boundaryComparison: CommitComparison = {
        ...comparison,
        files: Array.from({ length: 500 }, (_, i) => ({
          path: `file${i}.ts`,
          status: "added" as const,
        })),
      };
      mockGitHubClient.compareCommits = mock(async () => boundaryComparison);

      // Should succeed (not throw)
      const result = await coordinator.updateRepository("test-repo");

      expect(result.status).toBe("updated");
      // Pipeline should be called with 500 files
      expect(mockUpdatePipeline.processChanges).toHaveBeenCalled();
    });

    it("should return no_changes when HEAD commit matches last indexed commit", async () => {
      const sameCommit: CommitInfo = {
        ...headCommit,
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        sha: testRepo.lastIndexedCommitSha!,
      };
      mockGitHubClient.getHeadCommit = mock(async () => sameCommit);

      // Track in-progress state for stateful mock behavior
      let currentInProgressState = false;
      mockRepositoryService.updateRepository = mock(async (repo: RepositoryInfo) => {
        currentInProgressState = repo.updateInProgress ?? false;
      });
      mockRepositoryService.getRepository = mock(async () => ({
        ...testRepo,
        updateInProgress: currentInProgressState,
      }));

      const result = await coordinator.updateRepository("test-repo");

      expect(result.status).toBe("no_changes");
      expect(result.commitSha).toBe(testRepo.lastIndexedCommitSha);
      expect(result.stats.filesAdded).toBe(0);
      expect(result.stats.filesModified).toBe(0);
      expect(result.stats.filesDeleted).toBe(0);
      expect(result.errors).toHaveLength(0);

      // Verify pipeline was NOT called
      expect(mockUpdatePipeline.processChanges).not.toHaveBeenCalled();

      // Verify updateInProgress was set and then cleared (even for no_changes)
      const updateCalls = (mockRepositoryService.updateRepository as ReturnType<typeof mock>).mock
        .calls;
      expect(updateCalls.length).toBe(2); // Set flag, then clear flag
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(updateCalls[0]?.[0]?.updateInProgress).toBe(true); // First call sets flag
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(updateCalls[1]?.[0]?.updateInProgress).toBe(false); // Second call clears flag
    });

    it("should throw ForcePushDetectedError when base commit not found", async () => {
      mockGitHubClient.compareCommits = mock(async () => {
        throw new GitHubNotFoundError("Commit not found", "https://api.github.com/...");
      });

      // eslint-disable-next-line @typescript-eslint/await-thenable
      await expect(coordinator.updateRepository("test-repo")).rejects.toThrow(
        ForcePushDetectedError
      );

      // Verify updateInProgress was set and then cleared in finally block
      const updateCalls = (mockRepositoryService.updateRepository as ReturnType<typeof mock>).mock
        .calls;
      expect(updateCalls.length).toBeGreaterThanOrEqual(1);
      // First call sets updateInProgress=true
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(updateCalls[0]?.[0]?.updateInProgress).toBe(true);
    });

    it("should throw ChangeThresholdExceededError when changes exceed 500 files", async () => {
      const largeComparison: CommitComparison = {
        ...comparison,
        files: Array.from({ length: 501 }, (_, i) => ({
          path: `file${i}.ts`,
          status: "added" as const,
        })),
      };
      mockGitHubClient.compareCommits = mock(async () => largeComparison);

      // eslint-disable-next-line @typescript-eslint/await-thenable
      await expect(coordinator.updateRepository("test-repo")).rejects.toThrow(
        ChangeThresholdExceededError
      );

      // Verify updateInProgress was set and then cleared in finally block
      const updateCalls = (mockRepositoryService.updateRepository as ReturnType<typeof mock>).mock
        .calls;
      expect(updateCalls.length).toBeGreaterThanOrEqual(1);
      // First call sets updateInProgress=true
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(updateCalls[0]?.[0]?.updateInProgress).toBe(true);
    });

    it("should successfully process normal incremental update", async () => {
      const result = await coordinator.updateRepository("test-repo");

      // Verify result
      expect(result.status).toBe("updated");
      expect(result.commitSha).toBe(headCommit.sha);
      expect(result.commitMessage).toBe(headCommit.message);
      expect(result.stats.filesAdded).toBe(1);
      expect(result.stats.filesModified).toBe(1);
      expect(result.stats.filesDeleted).toBe(1);
      expect(result.stats.chunksUpserted).toBe(15);
      expect(result.stats.chunksDeleted).toBe(5);
      expect(result.errors).toHaveLength(0);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);

      // Verify GitHub client was called
      expect(mockGitHubClient.getHeadCommit).toHaveBeenCalledWith(
        "owner",
        "test-repo",
        "main",
        expect.any(String) // correlationId
      );
      expect(mockGitHubClient.compareCommits).toHaveBeenCalledWith(
        "owner",
        "test-repo",
        testRepo.lastIndexedCommitSha,
        headCommit.sha,
        expect.any(String) // correlationId
      );

      // Verify pipeline was called with correct options
      expect(mockUpdatePipeline.processChanges).toHaveBeenCalledWith(comparison.files, {
        repository: testRepo.name,
        localPath: testRepo.localPath,
        collectionName: testRepo.collectionName,
        includeExtensions: testRepo.includeExtensions,
        excludePatterns: testRepo.excludePatterns,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        correlationId: expect.any(String), // correlationId
      });

      // Verify metadata was updated
      expect(mockRepositoryService.updateRepository).toHaveBeenCalled();
      // Get the LAST call (first call sets updateInProgress, last call has final metadata)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
      const updateCalls = (mockRepositoryService.updateRepository as any).mock.calls;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      const updatedRepo = updateCalls[updateCalls.length - 1]?.[0];
      expect(updatedRepo).toBeDefined();
      if (updatedRepo) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        expect(updatedRepo.lastIndexedCommitSha).toBe(headCommit.sha);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        expect(updatedRepo.incrementalUpdateCount).toBe(1);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        expect(updatedRepo.fileCount).toBe(100); // 100 + 1 added - 1 deleted
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        expect(updatedRepo.chunkCount).toBe(510); // 500 + 15 upserted - 5 deleted
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        expect(updatedRepo.status).toBe("ready");
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        expect(updatedRepo.updateInProgress).toBe(false); // Should be cleared
      }
    });

    it("should handle pipeline errors gracefully (partial success)", async () => {
      const pipelineResultWithErrors: UpdateResult = {
        stats: {
          filesAdded: 1,
          filesModified: 0,
          filesDeleted: 0,
          chunksUpserted: 10,
          chunksDeleted: 0,
          durationMs: 1000,
        },
        errors: [
          { path: "src/broken.ts", error: "Failed to read file" },
          { path: "src/invalid.ts", error: "Invalid syntax" },
        ],
      };
      mockUpdatePipeline.processChanges = mock(async () => pipelineResultWithErrors);

      const result = await coordinator.updateRepository("test-repo");

      // Verify result indicates failure
      expect(result.status).toBe("failed");
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0]?.path).toBe("src/broken.ts");
      expect(result.errors[1]?.path).toBe("src/invalid.ts");

      // Verify metadata was still updated with new commit SHA
      expect(mockRepositoryService.updateRepository).toHaveBeenCalled();
      // Get the LAST call (first call sets updateInProgress, last call has final metadata)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
      const updateCalls = (mockRepositoryService.updateRepository as any).mock.calls;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      const updatedRepo = updateCalls[updateCalls.length - 1]?.[0];
      expect(updatedRepo).toBeDefined();
      if (updatedRepo) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        expect(updatedRepo.lastIndexedCommitSha).toBe(headCommit.sha);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        expect(updatedRepo.status).toBe("error");
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        expect(updatedRepo.errorMessage).toMatch(/2 error/i);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        expect(updatedRepo.updateInProgress).toBe(false); // Should be cleared
      }
    });

    it("should parse HTTPS GitHub URLs correctly", async () => {
      await coordinator.updateRepository("test-repo");

      // Verify GitHub client was called with parsed owner/repo
      expect(mockGitHubClient.getHeadCommit).toHaveBeenCalledWith(
        "owner",
        "test-repo",
        "main",
        expect.any(String) // correlationId
      );
    });

    it("should parse SSH GitHub URLs correctly", async () => {
      const sshRepo: RepositoryInfo = {
        ...testRepo,
        url: "git@github.com:owner/test-repo.git",
      };
      mockRepositoryService.getRepository = mock(async () => sshRepo);

      await coordinator.updateRepository("test-repo");

      // Verify GitHub client was called with parsed owner/repo
      expect(mockGitHubClient.getHeadCommit).toHaveBeenCalledWith(
        "owner",
        "test-repo",
        "main",
        expect.any(String) // correlationId
      );
    });

    it("should respect custom change file threshold", async () => {
      const customCoordinator = new IncrementalUpdateCoordinator(
        mockGitHubClient,
        mockRepositoryService,
        mockUpdatePipeline,
        { changeFileThreshold: 100 }
      );

      const largeComparison: CommitComparison = {
        ...comparison,
        files: Array.from({ length: 101 }, (_, i) => ({
          path: `file${i}.ts`,
          status: "added" as const,
        })),
      };
      mockGitHubClient.compareCommits = mock(async () => largeComparison);

      // eslint-disable-next-line @typescript-eslint/await-thenable
      await expect(customCoordinator.updateRepository("test-repo")).rejects.toThrow(
        ChangeThresholdExceededError
      );
    });

    it("should handle renamed files in comparison", async () => {
      const comparisonWithRename: CommitComparison = {
        ...comparison,
        files: [{ path: "src/new-name.ts", status: "renamed", previousPath: "src/old-name.ts" }],
      };
      mockGitHubClient.compareCommits = mock(async () => comparisonWithRename);

      const result = await coordinator.updateRepository("test-repo");

      expect(result.status).toBe("updated");
      expect(mockUpdatePipeline.processChanges).toHaveBeenCalledWith(
        comparisonWithRename.files,
        expect.anything()
      );
    });

    it("should update incrementalUpdateCount correctly", async () => {
      // First update
      await coordinator.updateRepository("test-repo");
      // Get the LAST call from first update (first call sets updateInProgress, last call has final metadata)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
      let updateCalls = (mockRepositoryService.updateRepository as any).mock.calls;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      let updatedRepo = updateCalls[updateCalls.length - 1]?.[0];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(updatedRepo?.incrementalUpdateCount).toBe(1);

      // Reset mock to track second update separately
      (mockRepositoryService.updateRepository as ReturnType<typeof mock>).mockClear();

      // Simulate second update
      const repoAfterFirstUpdate: RepositoryInfo = {
        ...testRepo,
        incrementalUpdateCount: 1,
        lastIndexedCommitSha: headCommit.sha,
      };
      mockRepositoryService.getRepository = mock(async () => repoAfterFirstUpdate);

      const newHeadCommit: CommitInfo = {
        ...headCommit,
        sha: "new123abc456new123abc456new123abc456new1",
      };
      mockGitHubClient.getHeadCommit = mock(async () => newHeadCommit);

      const newComparison: CommitComparison = {
        ...comparison,
        headSha: newHeadCommit.sha,
      };
      mockGitHubClient.compareCommits = mock(async () => newComparison);

      await coordinator.updateRepository("test-repo");
      // Get the LAST call from second update
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
      updateCalls = (mockRepositoryService.updateRepository as any).mock.calls;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      updatedRepo = updateCalls[updateCalls.length - 1]?.[0];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(updatedRepo?.incrementalUpdateCount).toBe(2);
    });

    it("should handle undefined incrementalUpdateCount gracefully", async () => {
      const repoWithoutCount: RepositoryInfo = {
        ...testRepo,
        incrementalUpdateCount: undefined,
      };
      mockRepositoryService.getRepository = mock(async () => repoWithoutCount);

      await coordinator.updateRepository("test-repo");

      // Get the LAST call (first call sets updateInProgress, last call has final metadata)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
      const updateCalls = (mockRepositoryService.updateRepository as any).mock.calls;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      const updatedRepo = updateCalls[updateCalls.length - 1]?.[0];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(updatedRepo?.incrementalUpdateCount).toBe(1);
    });
  });

  describe("empty includeExtensions handling", () => {
    it("should pass empty includeExtensions to pipeline (pipeline handles fallback)", async () => {
      // Simulate a repository with empty includeExtensions (the bug scenario)
      const repoWithEmptyExtensions: RepositoryInfo = {
        ...testRepo,
        includeExtensions: [],
      };
      mockRepositoryService.getRepository = mock(async () => repoWithEmptyExtensions);

      const result = await coordinator.updateRepository("test-repo");

      expect(result.status).toBe("updated");

      // Verify pipeline was called with the empty array (pipeline handles fallback internally)
      expect(mockUpdatePipeline.processChanges).toHaveBeenCalledWith(
        comparison.files,
        expect.objectContaining({
          includeExtensions: [],
        })
      );
    });
  });

  describe("error handling", () => {
    it("should re-throw GitHub API errors", async () => {
      const apiError = new Error("GitHub API error");
      mockGitHubClient.getHeadCommit = mock(async () => {
        throw apiError;
      });

      // eslint-disable-next-line @typescript-eslint/await-thenable
      await expect(coordinator.updateRepository("test-repo")).rejects.toThrow(apiError);
    });

    it("should handle invalid GitHub URL format", async () => {
      const invalidRepo: RepositoryInfo = {
        ...testRepo,
        url: "https://invalid-url.com/repo",
      };
      mockRepositoryService.getRepository = mock(async () => invalidRepo);

      // eslint-disable-next-line @typescript-eslint/await-thenable
      await expect(coordinator.updateRepository("test-repo")).rejects.toThrow(
        /Cannot parse GitHub URL/
      );
    });

    it("should throw GitPullError when git pull fails", async () => {
      const failingCoordinator = new IncrementalUpdateCoordinator(
        mockGitHubClient,
        mockRepositoryService,
        mockUpdatePipeline,
        {
          customGitPull: mock(async () => {
            throw new Error("Merge conflict detected");
          }),
        }
      );

      // eslint-disable-next-line @typescript-eslint/await-thenable
      await expect(failingCoordinator.updateRepository("test-repo")).rejects.toThrow(GitPullError);
    });
  });

  describe("parseGitHubUrl", () => {
    it("should parse HTTPS URL without .git suffix", async () => {
      const repoWithoutGit: RepositoryInfo = {
        ...testRepo,
        url: "https://github.com/owner/test-repo",
      };
      mockRepositoryService.getRepository = mock(async () => repoWithoutGit);

      await coordinator.updateRepository("test-repo");
      expect(mockGitHubClient.getHeadCommit).toHaveBeenCalledWith(
        "owner",
        "test-repo",
        "main",
        expect.any(String) // correlationId
      );
    });

    it("should parse SSH URL without .git suffix", async () => {
      const repoWithoutGit: RepositoryInfo = {
        ...testRepo,
        url: "git@github.com:owner/test-repo",
      };
      mockRepositoryService.getRepository = mock(async () => repoWithoutGit);

      await coordinator.updateRepository("test-repo");
      expect(mockGitHubClient.getHeadCommit).toHaveBeenCalledWith(
        "owner",
        "test-repo",
        "main",
        expect.any(String) // correlationId
      );
    });

    it("should handle repository names with hyphens and underscores", async () => {
      const repoWithSpecialChars: RepositoryInfo = {
        ...testRepo,
        url: "https://github.com/my-org/my-cool_repo-123.git",
      };
      mockRepositoryService.getRepository = mock(async () => repoWithSpecialChars);

      await coordinator.updateRepository("test-repo");
      expect(mockGitHubClient.getHeadCommit).toHaveBeenCalledWith(
        "my-org",
        "my-cool_repo-123",
        "main",
        expect.any(String) // correlationId
      );
    });
  });

  describe("Update History Recording", () => {
    it("should record history on successful update (status='success')", async () => {
      const result = await coordinator.updateRepository("test-repo");

      expect(result.status).toBe("updated");
      expect(mockRepositoryService.updateRepository).toHaveBeenCalled();

      // Get the LAST call (first call sets updateInProgress, last call has final metadata)
      const updateCalls = (mockRepositoryService.updateRepository as ReturnType<typeof mock>).mock
        .calls;
      const updatedRepo = updateCalls[updateCalls.length - 1]?.[0] as RepositoryInfo | undefined;
      expect(updatedRepo).toBeDefined();
      expect(updatedRepo?.updateHistory).toBeDefined();
      expect(updatedRepo?.updateHistory).toHaveLength(1);

      const historyEntry = updatedRepo?.updateHistory?.[0];
      expect(historyEntry).toBeDefined();
      if (!historyEntry) throw new Error("History entry not found");

      expect(historyEntry.previousCommit).toBe("abc123def456abc123def456abc123def456abc1");
      expect(historyEntry.newCommit).toBe("def456abc123def456abc123def456abc123def4");
      expect(historyEntry.filesAdded).toBe(1);
      expect(historyEntry.filesModified).toBe(1);
      expect(historyEntry.filesDeleted).toBe(1);
      expect(historyEntry.chunksUpserted).toBe(15);
      expect(historyEntry.chunksDeleted).toBe(5);
      expect(historyEntry.durationMs).toBe(1500);
      expect(historyEntry.errorCount).toBe(0);
      expect(historyEntry.status).toBe("success");
      expect(historyEntry.timestamp).toBeDefined();
    });

    it("should record 'partial' status when some files fail", async () => {
      // Mock pipeline with some errors
      mockUpdatePipeline.processChanges = mock(async () => ({
        stats: {
          filesAdded: 2,
          filesModified: 1,
          filesDeleted: 1,
          chunksUpserted: 35,
          chunksDeleted: 10,
          durationMs: 1500,
        },
        errors: [
          {
            path: "file1.ts",
            error: "Parse error",
          },
        ],
      }));

      await coordinator.updateRepository("test-repo");

      // Get the LAST call (first call sets updateInProgress, last call has final metadata)
      const updateCalls = (mockRepositoryService.updateRepository as ReturnType<typeof mock>).mock
        .calls;
      const updatedRepo = updateCalls[updateCalls.length - 1]?.[0] as RepositoryInfo | undefined;
      const historyEntry = updatedRepo?.updateHistory?.[0];
      expect(historyEntry).toBeDefined();
      if (!historyEntry) throw new Error("History entry not found");

      expect(historyEntry.errorCount).toBe(1);
      expect(historyEntry.status).toBe("partial");
    });

    it("should record 'failed' status when all files fail", async () => {
      // Mock pipeline with errors >= total files changed
      mockUpdatePipeline.processChanges = mock(async () => ({
        stats: {
          filesAdded: 1,
          filesModified: 1,
          filesDeleted: 0,
          chunksUpserted: 0,
          chunksDeleted: 0,
          durationMs: 500,
        },
        errors: [
          { path: "file1.ts", error: "Error 1" },
          { path: "file2.ts", error: "Error 2" },
        ],
      }));

      await coordinator.updateRepository("test-repo");

      // Get the LAST call (first call sets updateInProgress, last call has final metadata)
      const updateCalls = (mockRepositoryService.updateRepository as ReturnType<typeof mock>).mock
        .calls;
      const updatedRepo = updateCalls[updateCalls.length - 1]?.[0] as RepositoryInfo | undefined;
      const historyEntry = updatedRepo?.updateHistory?.[0];
      expect(historyEntry).toBeDefined();
      if (!historyEntry) throw new Error("History entry not found");

      expect(historyEntry.errorCount).toBe(2);
      expect(historyEntry.status).toBe("failed");
    });

    it("should append to existing history (newest first)", async () => {
      const existingHistory = [
        {
          timestamp: "2024-12-15T10:00:00.000Z",
          previousCommit: "old1",
          newCommit: "old2",
          filesAdded: 1,
          filesModified: 0,
          filesDeleted: 0,
          chunksUpserted: 5,
          chunksDeleted: 0,
          durationMs: 1000,
          errorCount: 0,
          status: "success" as const,
        },
      ];

      testRepo.updateHistory = existingHistory;

      await coordinator.updateRepository("test-repo");

      // Get the LAST call (first call sets updateInProgress, last call has final metadata)
      const updateCalls = (mockRepositoryService.updateRepository as ReturnType<typeof mock>).mock
        .calls;
      const updatedRepo = updateCalls[updateCalls.length - 1]?.[0] as RepositoryInfo | undefined;
      expect(updatedRepo?.updateHistory).toHaveLength(2);

      // Newest should be first
      const history = updatedRepo?.updateHistory;
      expect(history).toBeDefined();
      if (!history) throw new Error("History not found");

      expect(history[0]?.newCommit).toBe("def456abc123def456abc123def456abc123def4");
      expect(history[1]?.newCommit).toBe("old2");
    });

    it("should rotate oldest entry when limit exceeded", async () => {
      // Create history at limit (3 entries) in reverse chronological order (newest first)
      const existingHistory = Array.from({ length: 3 }, (_, i) => ({
        timestamp: `2024-12-15T${String(10 + i).padStart(2, "0")}:00:00.000Z`,
        previousCommit: `commit${i}`,
        newCommit: `commit${i + 1}`,
        filesAdded: 1,
        filesModified: 0,
        filesDeleted: 0,
        chunksUpserted: 5,
        chunksDeleted: 0,
        durationMs: 1000,
        errorCount: 0,
        status: "success" as const,
      })).reverse(); // Reverse to get newest-first ordering

      testRepo.updateHistory = existingHistory;

      // Create coordinator with limit=3
      const limitedCoordinator = new IncrementalUpdateCoordinator(
        mockGitHubClient,
        mockRepositoryService,
        mockUpdatePipeline,
        { updateHistoryLimit: 3, customGitPull: mock(async () => {}) }
      );

      await limitedCoordinator.updateRepository("test-repo");

      // Get the LAST call (first call sets updateInProgress, last call has final metadata)
      const updateCalls = (mockRepositoryService.updateRepository as ReturnType<typeof mock>).mock
        .calls;
      const updatedRepo = updateCalls[updateCalls.length - 1]?.[0] as RepositoryInfo | undefined;
      const history = updatedRepo?.updateHistory;
      expect(history).toBeDefined();
      if (!history) throw new Error("History not found");

      expect(history).toHaveLength(3); // Still 3 entries

      // Newest should be our new update
      expect(history[0]?.newCommit).toBe("def456abc123def456abc123def456abc123def4");
      // Oldest (commit0 -> commit1) should be dropped
      expect(history.find((e) => e.newCommit === "commit1")).toBeUndefined();
    });

    it("should NOT record history for 'no_changes' status", async () => {
      // Create a fresh repo with history
      const repoWithHistory: RepositoryInfo = {
        ...testRepo,
        updateHistory: [
          {
            timestamp: "2024-12-15T09:00:00.000Z",
            previousCommit: "older",
            newCommit: "abc123def456abc123def456abc123def456abc1",
            filesAdded: 1,
            filesModified: 0,
            filesDeleted: 0,
            chunksUpserted: 5,
            chunksDeleted: 0,
            durationMs: 1000,
            errorCount: 0,
            status: "success" as const,
          },
        ],
      };

      // Track state updates to simulate real behavior
      let currentInProgressState = false;

      // Create new coordinator with mocks that return same commit
      const noChangeGitHubClient: GitHubClient = {
        getHeadCommit: mock(async () => ({
          sha: "abc123def456abc123def456abc123def456abc1", // Same as testRepo.lastIndexedCommitSha
          message: "Same commit",
          author: "Test Author",
          date: "2024-12-15T10:00:00Z",
        })),
        compareCommits: mock(async () => comparison),
        healthCheck: mock(async () => true),
      };

      const noChangeRepositoryService: RepositoryMetadataService = {
        listRepositories: mock(async () => [repoWithHistory]),
        getRepository: mock(async () => ({
          ...repoWithHistory,
          updateInProgress: currentInProgressState,
        })),
        updateRepository: mock(async (repo: RepositoryInfo) => {
          currentInProgressState = repo.updateInProgress ?? false;
        }),
        removeRepository: mock(async () => {}),
      };

      const noChangeCoordinator = new IncrementalUpdateCoordinator(
        noChangeGitHubClient,
        noChangeRepositoryService,
        mockUpdatePipeline,
        { customGitPull: mock(async () => {}) }
      );

      const result = await noChangeCoordinator.updateRepository("test-repo");

      expect(result.status).toBe("no_changes");

      // updateRepository IS called for no_changes (to set/clear the in-progress flag)
      // but history should NOT be modified
      const updateCalls = (noChangeRepositoryService.updateRepository as ReturnType<typeof mock>)
        .mock.calls;

      // Should be 2 calls: set flag, then clear flag (no history update)
      expect(updateCalls.length).toBe(2);

      // Verify second call (finally cleanup) doesn't add history
      // History should remain unchanged from the original
      const secondUpdate = updateCalls[1]?.[0] as RepositoryInfo | undefined;
      // The cleanup call only clears the flag, doesn't touch history
      expect(secondUpdate?.updateInProgress).toBe(false);
    });

    it("should respect custom updateHistoryLimit from config", async () => {
      const customLimit = 5;
      const customCoordinator = new IncrementalUpdateCoordinator(
        mockGitHubClient,
        mockRepositoryService,
        mockUpdatePipeline,
        { updateHistoryLimit: customLimit, customGitPull: mock(async () => {}) }
      );

      // Create history at limit
      const existingHistory = Array.from({ length: customLimit }, (_, i) => ({
        timestamp: `2024-12-15T${String(10 + i).padStart(2, "0")}:00:00.000Z`,
        previousCommit: `commit${i}`,
        newCommit: `commit${i + 1}`,
        filesAdded: 1,
        filesModified: 0,
        filesDeleted: 0,
        chunksUpserted: 5,
        chunksDeleted: 0,
        durationMs: 1000,
        errorCount: 0,
        status: "success" as const,
      }));

      testRepo.updateHistory = existingHistory;

      await customCoordinator.updateRepository("test-repo");

      // Get the LAST call (first call sets updateInProgress, last call has final metadata)
      const updateCalls = (mockRepositoryService.updateRepository as ReturnType<typeof mock>).mock
        .calls;
      const updatedRepo = updateCalls[updateCalls.length - 1]?.[0] as RepositoryInfo | undefined;
      expect(updatedRepo?.updateHistory).toHaveLength(customLimit); // Limit enforced
    });
  });

  describe("Update In-Progress Flag Management", () => {
    it("should set updateInProgress=true at start of update", async () => {
      await coordinator.updateRepository("test-repo");

      // First updateRepository call should set updateInProgress=true
      const updateCalls = (mockRepositoryService.updateRepository as ReturnType<typeof mock>).mock
        .calls;
      expect(updateCalls.length).toBeGreaterThanOrEqual(1);

      const firstUpdate = updateCalls[0]?.[0] as RepositoryInfo | undefined;
      expect(firstUpdate).toBeDefined();
      expect(firstUpdate?.updateInProgress).toBe(true);
      expect(firstUpdate?.updateStartedAt).toBeDefined();
    });

    it("should clear updateInProgress=false after successful update", async () => {
      await coordinator.updateRepository("test-repo");

      const updateCalls = (mockRepositoryService.updateRepository as ReturnType<typeof mock>).mock
        .calls;
      expect(updateCalls.length).toBeGreaterThanOrEqual(2);

      // Last update should clear the flag
      const lastUpdate = updateCalls[updateCalls.length - 1]?.[0] as RepositoryInfo | undefined;
      expect(lastUpdate).toBeDefined();
      expect(lastUpdate?.updateInProgress).toBe(false);
      expect(lastUpdate?.updateStartedAt).toBeUndefined();
    });

    it("should clear updateInProgress=false after partial failure", async () => {
      // Mock pipeline with some errors
      mockUpdatePipeline.processChanges = mock(async () => ({
        stats: {
          filesAdded: 1,
          filesModified: 0,
          filesDeleted: 0,
          chunksUpserted: 5,
          chunksDeleted: 0,
          durationMs: 1000,
        },
        errors: [{ path: "file.ts", error: "Parse error" }],
      }));

      await coordinator.updateRepository("test-repo");

      const updateCalls = (mockRepositoryService.updateRepository as ReturnType<typeof mock>).mock
        .calls;
      const lastUpdate = updateCalls[updateCalls.length - 1]?.[0] as RepositoryInfo | undefined;
      expect(lastUpdate?.updateInProgress).toBe(false);
      expect(lastUpdate?.updateStartedAt).toBeUndefined();
    });

    it("should clear updateInProgress=false in finally block after error", async () => {
      // Track state updates to simulate real behavior
      let currentInProgressState = false;
      mockRepositoryService.updateRepository = mock(async (repo: RepositoryInfo) => {
        currentInProgressState = repo.updateInProgress ?? false;
      });
      mockRepositoryService.getRepository = mock(async () => ({
        ...testRepo,
        updateInProgress: currentInProgressState,
      }));

      // Mock git pull to throw an error
      const errorCoordinator = new IncrementalUpdateCoordinator(
        mockGitHubClient,
        mockRepositoryService,
        mockUpdatePipeline,
        {
          customGitPull: mock(async () => {
            throw new Error("Git pull failed");
          }),
        }
      );

      // eslint-disable-next-line @typescript-eslint/await-thenable
      await expect(errorCoordinator.updateRepository("test-repo")).rejects.toThrow(GitPullError);

      // Verify updateInProgress was set then cleared
      const updateCalls = (mockRepositoryService.updateRepository as ReturnType<typeof mock>).mock
        .calls;

      // Should have 2 calls: set flag, then clear flag
      expect(updateCalls.length).toBe(2);

      // First call sets the flag
      const firstUpdate = updateCalls[0]?.[0] as RepositoryInfo | undefined;
      expect(firstUpdate?.updateInProgress).toBe(true);

      // Last call should clear the flag (in finally block)
      const lastUpdate = updateCalls[updateCalls.length - 1]?.[0] as RepositoryInfo | undefined;
      expect(lastUpdate?.updateInProgress).toBe(false);
    });

    it("should set and clear updateInProgress for 'no_changes' result", async () => {
      // Track state updates to simulate real behavior
      let currentInProgressState = false;
      const noChangeMockRepositoryService: RepositoryMetadataService = {
        listRepositories: mock(async () => [testRepo]),
        getRepository: mock(async () => ({
          ...testRepo,
          updateInProgress: currentInProgressState,
        })),
        updateRepository: mock(async (repo: RepositoryInfo) => {
          currentInProgressState = repo.updateInProgress ?? false;
        }),
        removeRepository: mock(async () => {}),
      };

      // Mock to return same commit (no changes)
      const sameCommit: CommitInfo = {
        ...headCommit,
        sha: testRepo.lastIndexedCommitSha!,
      };
      const noChangeGitHubClient: GitHubClient = {
        getHeadCommit: mock(async () => sameCommit),
        compareCommits: mock(async () => comparison),
        healthCheck: mock(async () => true),
      };

      const noChangeCoordinator = new IncrementalUpdateCoordinator(
        noChangeGitHubClient,
        noChangeMockRepositoryService,
        mockUpdatePipeline,
        { customGitPull: mock(async () => {}) }
      );

      const result = await noChangeCoordinator.updateRepository("test-repo");

      expect(result.status).toBe("no_changes");

      // The in-progress flag IS set before the no_changes check, then cleared in finally
      // So there should be 2 calls: set flag, then clear flag
      const updateCalls = (
        noChangeMockRepositoryService.updateRepository as ReturnType<typeof mock>
      ).mock.calls;

      // Due to the current implementation flow, the flag IS set before no_changes check
      // and then cleared by the finally block
      // First call sets updateInProgress=true, second call clears it
      expect(updateCalls.length).toBe(2);

      // First call sets the flag
      const firstUpdate = updateCalls[0]?.[0] as RepositoryInfo | undefined;
      expect(firstUpdate?.updateInProgress).toBe(true);

      // Second call clears the flag (in finally)
      const secondUpdate = updateCalls[1]?.[0] as RepositoryInfo | undefined;
      expect(secondUpdate?.updateInProgress).toBe(false);
    });

    it("should clear updateInProgress=false when ForcePushDetectedError occurs", async () => {
      // Track state updates to simulate real behavior
      let currentInProgressState = false;
      mockRepositoryService.updateRepository = mock(async (repo: RepositoryInfo) => {
        currentInProgressState = repo.updateInProgress ?? false;
      });
      mockRepositoryService.getRepository = mock(async () => ({
        ...testRepo,
        updateInProgress: currentInProgressState,
      }));

      mockGitHubClient.compareCommits = mock(async () => {
        throw new GitHubNotFoundError("Commit not found", "https://api.github.com/...");
      });

      // eslint-disable-next-line @typescript-eslint/await-thenable
      await expect(coordinator.updateRepository("test-repo")).rejects.toThrow(
        ForcePushDetectedError
      );

      const updateCalls = (mockRepositoryService.updateRepository as ReturnType<typeof mock>).mock
        .calls;

      // Should have 2 calls: set flag, then clear flag in finally
      expect(updateCalls.length).toBe(2);

      // First call sets the flag
      const firstUpdate = updateCalls[0]?.[0] as RepositoryInfo | undefined;
      expect(firstUpdate?.updateInProgress).toBe(true);

      // Last call should clear the flag
      const lastUpdate = updateCalls[updateCalls.length - 1]?.[0] as RepositoryInfo | undefined;
      expect(lastUpdate?.updateInProgress).toBe(false);
    });

    it("should clear updateInProgress=false when ChangeThresholdExceededError occurs", async () => {
      // Track state updates to simulate real behavior
      let currentInProgressState = false;
      mockRepositoryService.updateRepository = mock(async (repo: RepositoryInfo) => {
        currentInProgressState = repo.updateInProgress ?? false;
      });
      mockRepositoryService.getRepository = mock(async () => ({
        ...testRepo,
        updateInProgress: currentInProgressState,
      }));

      const largeComparison: CommitComparison = {
        ...comparison,
        files: Array.from({ length: 501 }, (_, i) => ({
          path: `file${i}.ts`,
          status: "added" as const,
        })),
      };
      mockGitHubClient.compareCommits = mock(async () => largeComparison);

      // eslint-disable-next-line @typescript-eslint/await-thenable
      await expect(coordinator.updateRepository("test-repo")).rejects.toThrow(
        ChangeThresholdExceededError
      );

      const updateCalls = (mockRepositoryService.updateRepository as ReturnType<typeof mock>).mock
        .calls;

      // Should have 2 calls: set flag, then clear flag in finally
      expect(updateCalls.length).toBe(2);

      // First call sets the flag
      const firstUpdate = updateCalls[0]?.[0] as RepositoryInfo | undefined;
      expect(firstUpdate?.updateInProgress).toBe(true);

      // Last call should clear the flag
      const lastUpdate = updateCalls[updateCalls.length - 1]?.[0] as RepositoryInfo | undefined;
      expect(lastUpdate?.updateInProgress).toBe(false);
    });

    it("should have updateStartedAt as valid ISO 8601 timestamp", async () => {
      await coordinator.updateRepository("test-repo");

      const updateCalls = (mockRepositoryService.updateRepository as ReturnType<typeof mock>).mock
        .calls;
      const firstUpdate = updateCalls[0]?.[0] as RepositoryInfo | undefined;

      expect(firstUpdate?.updateStartedAt).toBeDefined();
      // Validate ISO 8601 format
      const updateStartedAt = firstUpdate!.updateStartedAt as string;
      const date = new Date(updateStartedAt);
      expect(date.toISOString()).toBe(updateStartedAt);
    });
  });
});
