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

    it("should return no_changes when HEAD commit matches last indexed commit", async () => {
      const sameCommit: CommitInfo = {
        ...headCommit,
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        sha: testRepo.lastIndexedCommitSha!,
      };
      mockGitHubClient.getHeadCommit = mock(async () => sameCommit);

      const result = await coordinator.updateRepository("test-repo");

      expect(result.status).toBe("no_changes");
      expect(result.commitSha).toBe(testRepo.lastIndexedCommitSha);
      expect(result.stats.filesAdded).toBe(0);
      expect(result.stats.filesModified).toBe(0);
      expect(result.stats.filesDeleted).toBe(0);
      expect(result.errors).toHaveLength(0);

      // Verify pipeline was NOT called
      expect(mockUpdatePipeline.processChanges).not.toHaveBeenCalled();

      // Verify metadata was NOT updated
      expect(mockRepositoryService.updateRepository).not.toHaveBeenCalled();
    });

    it("should throw ForcePushDetectedError when base commit not found", async () => {
      mockGitHubClient.compareCommits = mock(async () => {
        throw new GitHubNotFoundError("Commit not found", "https://api.github.com/...");
      });

      // eslint-disable-next-line @typescript-eslint/await-thenable
      await expect(coordinator.updateRepository("test-repo")).rejects.toThrow(
        ForcePushDetectedError
      );

      // Verify metadata was NOT updated
      expect(mockRepositoryService.updateRepository).not.toHaveBeenCalled();
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

      // Verify metadata was NOT updated
      expect(mockRepositoryService.updateRepository).not.toHaveBeenCalled();
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
      expect(mockGitHubClient.getHeadCommit).toHaveBeenCalledWith("owner", "test-repo", "main");
      expect(mockGitHubClient.compareCommits).toHaveBeenCalledWith(
        "owner",
        "test-repo",
        testRepo.lastIndexedCommitSha,
        headCommit.sha
      );

      // Verify pipeline was called with correct options
      expect(mockUpdatePipeline.processChanges).toHaveBeenCalledWith(comparison.files, {
        repository: testRepo.name,
        localPath: testRepo.localPath,
        collectionName: testRepo.collectionName,
        includeExtensions: testRepo.includeExtensions,
        excludePatterns: testRepo.excludePatterns,
      });

      // Verify metadata was updated
      expect(mockRepositoryService.updateRepository).toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      const updatedRepo = mockRepositoryService.updateRepository.mock.calls[0]?.[0];
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
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      const updatedRepo = mockRepositoryService.updateRepository.mock.calls[0]?.[0];
      expect(updatedRepo).toBeDefined();
      if (updatedRepo) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        expect(updatedRepo.lastIndexedCommitSha).toBe(headCommit.sha);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        expect(updatedRepo.status).toBe("error");
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        expect(updatedRepo.errorMessage).toContain("2 error");
      }
    });

    it("should parse HTTPS GitHub URLs correctly", async () => {
      await coordinator.updateRepository("test-repo");

      // Verify GitHub client was called with parsed owner/repo
      expect(mockGitHubClient.getHeadCommit).toHaveBeenCalledWith("owner", "test-repo", "main");
    });

    it("should parse SSH GitHub URLs correctly", async () => {
      const sshRepo: RepositoryInfo = {
        ...testRepo,
        url: "git@github.com:owner/test-repo.git",
      };
      mockRepositoryService.getRepository = mock(async () => sshRepo);

      await coordinator.updateRepository("test-repo");

      // Verify GitHub client was called with parsed owner/repo
      expect(mockGitHubClient.getHeadCommit).toHaveBeenCalledWith("owner", "test-repo", "main");
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
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      let updatedRepo = mockRepositoryService.updateRepository.mock.calls[0]?.[0];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(updatedRepo?.incrementalUpdateCount).toBe(1);

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
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      updatedRepo = mockRepositoryService.updateRepository.mock.calls[1]?.[0];
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

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      const updatedRepo = mockRepositoryService.updateRepository.mock.calls[0]?.[0];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(updatedRepo?.incrementalUpdateCount).toBe(1);
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
  });

  describe("parseGitHubUrl", () => {
    it("should parse HTTPS URL without .git suffix", async () => {
      const repoWithoutGit: RepositoryInfo = {
        ...testRepo,
        url: "https://github.com/owner/test-repo",
      };
      mockRepositoryService.getRepository = mock(async () => repoWithoutGit);

      await coordinator.updateRepository("test-repo");
      expect(mockGitHubClient.getHeadCommit).toHaveBeenCalledWith("owner", "test-repo", "main");
    });

    it("should parse SSH URL without .git suffix", async () => {
      const repoWithoutGit: RepositoryInfo = {
        ...testRepo,
        url: "git@github.com:owner/test-repo",
      };
      mockRepositoryService.getRepository = mock(async () => repoWithoutGit);

      await coordinator.updateRepository("test-repo");
      expect(mockGitHubClient.getHeadCommit).toHaveBeenCalledWith("owner", "test-repo", "main");
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
        "main"
      );
    });
  });
});
