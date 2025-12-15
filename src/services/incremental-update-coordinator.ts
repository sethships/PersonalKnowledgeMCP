/**
 * Incremental Update Coordinator Service
 *
 * Orchestrates the complete incremental update workflow for repositories.
 * Coordinates GitHub API client, repository metadata, git operations, and
 * the incremental update pipeline to efficiently update the knowledge base.
 *
 * @module services/incremental-update-coordinator
 */

import simpleGit from "simple-git";
import type { Logger } from "pino";
import { getComponentLogger } from "../logging/index.js";
import type { GitHubClient, CommitComparison } from "./github-client-types.js";
import type { RepositoryMetadataService, RepositoryInfo } from "../repositories/types.js";
import type { IncrementalUpdatePipeline } from "./incremental-update-pipeline.js";
import { GitHubNotFoundError } from "./github-client-errors.js";
import type {
  CoordinatorConfig,
  CoordinatorResult,
  GitHubRepoInfo,
} from "./incremental-update-coordinator-types.js";
import {
  RepositoryNotFoundError,
  ForcePushDetectedError,
  ChangeThresholdExceededError,
  GitPullError,
  MissingCommitShaError,
} from "./incremental-update-coordinator-errors.js";

/**
 * Service for orchestrating incremental repository updates.
 *
 * Coordinates all steps of the update workflow:
 * 1. Load repository metadata
 * 2. Parse GitHub owner/repo from URL
 * 3. Fetch HEAD commit from GitHub API
 * 4. Compare with last indexed commit
 * 5. Handle special cases (no changes, force push, threshold exceeded)
 * 6. Update local clone via git pull
 * 7. Process changes through pipeline
 * 8. Update repository metadata with new commit SHA
 *
 * @example
 * ```typescript
 * const coordinator = new IncrementalUpdateCoordinator(
 *   githubClient,
 *   repositoryService,
 *   updatePipeline
 * );
 *
 * try {
 *   const result = await coordinator.updateRepository("my-api");
 *   if (result.status === "no_changes") {
 *     console.log("Repository is up-to-date");
 *   } else {
 *     console.log(`Updated to commit ${result.commitSha}`);
 *   }
 * } catch (error) {
 *   if (error instanceof ForcePushDetectedError) {
 *     console.log("Force push detected - trigger full re-index");
 *   } else if (error instanceof ChangeThresholdExceededError) {
 *     console.log("Too many changes - trigger full re-index");
 *   }
 * }
 * ```
 */
export class IncrementalUpdateCoordinator {
  /**
   * Maximum number of changed files before triggering full re-index.
   *
   * When more than this many files change, full re-indexing is more
   * efficient than incremental updates.
   *
   * @default 500
   */
  private readonly changeFileThreshold: number;

  /**
   * Lazy-initialized logger instance.
   */
  private _logger: Logger | null = null;

  /**
   * Optional custom git pull implementation for testing.
   */
  private readonly customGitPull?: (localPath: string, branch: string) => Promise<void>;

  /**
   * Create an incremental update coordinator.
   *
   * @param githubClient - GitHub API client for commit detection
   * @param repositoryService - Service for repository metadata management
   * @param updatePipeline - Pipeline for processing file changes
   * @param config - Optional configuration (threshold, custom git pull for testing, etc.)
   */
  constructor(
    private readonly githubClient: GitHubClient,
    private readonly repositoryService: RepositoryMetadataService,
    private readonly updatePipeline: IncrementalUpdatePipeline,
    config: CoordinatorConfig & {
      customGitPull?: (localPath: string, branch: string) => Promise<void>;
    } = {}
  ) {
    this.changeFileThreshold = config.changeFileThreshold ?? 500;
    this.customGitPull = config.customGitPull;
  }

  /**
   * Get logger instance (lazy initialization).
   */
  private get logger(): Logger {
    if (!this._logger) {
      this._logger = getComponentLogger("services:incremental-update-coordinator");
    }
    return this._logger;
  }

  /**
   * Orchestrate incremental update for a repository.
   *
   * Performs the complete update workflow:
   * 1. Validates repository exists in metadata
   * 2. Fetches HEAD commit from GitHub
   * 3. Compares with last indexed commit
   * 4. Short-circuits if no changes
   * 5. Detects force push (base commit not found)
   * 6. Checks change threshold (>500 files)
   * 7. Updates local clone (git pull)
   * 8. Processes changes via pipeline
   * 9. Updates metadata with new commit SHA
   *
   * @param repositoryName - Name of repository to update (metadata key)
   * @returns Result with status, statistics, and any errors
   *
   * @throws {RepositoryNotFoundError} If repository not in metadata store
   * @throws {MissingCommitShaError} If no lastIndexedCommitSha recorded
   * @throws {ForcePushDetectedError} If base commit no longer exists (force push)
   * @throws {ChangeThresholdExceededError} If changes exceed 500 files
   * @throws {GitPullError} If local clone update fails
   * @throws {Error} For GitHub API errors, network issues, etc.
   *
   * @example
   * ```typescript
   * const result = await coordinator.updateRepository("my-api");
   * console.log(`Status: ${result.status}`);
   * console.log(`Files added: ${result.stats.filesAdded}`);
   * console.log(`Files modified: ${result.stats.filesModified}`);
   * ```
   */
  async updateRepository(repositoryName: string): Promise<CoordinatorResult> {
    const startTime = Date.now();

    this.logger.info({ repository: repositoryName }, "Starting incremental update");

    try {
      // Step 1: Load repository metadata
      const repo = await this.repositoryService.getRepository(repositoryName);
      if (!repo) {
        throw new RepositoryNotFoundError(repositoryName);
      }

      this.logger.debug(
        { repository: repositoryName, url: repo.url },
        "Repository metadata loaded"
      );

      // Check if repository has a commit SHA recorded
      if (!repo.lastIndexedCommitSha) {
        throw new MissingCommitShaError(repositoryName);
      }

      // Step 2: Parse GitHub owner/repo from URL
      const { owner, repo: repoName } = this.parseGitHubUrl(repo.url);

      this.logger.debug(
        { owner, repo: repoName, branch: repo.branch },
        "Parsed GitHub repository info"
      );

      // Step 3: Fetch HEAD commit from GitHub API
      const headCommit = await this.githubClient.getHeadCommit(owner, repoName, repo.branch);

      this.logger.info(
        {
          repository: repositoryName,
          headSha: headCommit.sha.substring(0, 7),
          message: headCommit.message,
        },
        "Fetched HEAD commit from GitHub"
      );

      // Step 4: Compare with last indexed commit (short-circuit if no changes)
      if (repo.lastIndexedCommitSha === headCommit.sha) {
        const durationMs = Date.now() - startTime;
        this.logger.info(
          { repository: repositoryName, durationMs },
          "No changes detected - repository is up-to-date"
        );

        return {
          status: "no_changes",
          commitSha: headCommit.sha,
          commitMessage: headCommit.message,
          stats: {
            filesAdded: 0,
            filesModified: 0,
            filesDeleted: 0,
            chunksUpserted: 0,
            chunksDeleted: 0,
            durationMs: 0,
          },
          errors: [],
          durationMs,
        };
      }

      // Step 5: Detect force push and change threshold
      let comparison: CommitComparison;
      try {
        comparison = await this.githubClient.compareCommits(
          owner,
          repoName,
          repo.lastIndexedCommitSha,
          headCommit.sha
        );

        this.logger.info(
          {
            repository: repositoryName,
            baseSha: comparison.baseSha.substring(0, 7),
            headSha: comparison.headSha.substring(0, 7),
            totalCommits: comparison.totalCommits,
            filesChanged: comparison.files.length,
          },
          "Compared commits"
        );
      } catch (error) {
        // Force push detected - base commit not found
        if (error instanceof GitHubNotFoundError) {
          this.logger.warn(
            {
              repository: repositoryName,
              lastIndexedSha: repo.lastIndexedCommitSha.substring(0, 7),
              currentHeadSha: headCommit.sha.substring(0, 7),
            },
            "Force push detected - base commit not found"
          );
          throw new ForcePushDetectedError(
            repositoryName,
            repo.lastIndexedCommitSha,
            headCommit.sha
          );
        }
        // Re-throw other errors
        throw error;
      }

      // Step 6: Check change threshold (>500 files triggers full re-index)
      if (comparison.files.length > this.changeFileThreshold) {
        this.logger.warn(
          {
            repository: repositoryName,
            filesChanged: comparison.files.length,
            threshold: this.changeFileThreshold,
          },
          "Change count exceeds threshold"
        );
        throw new ChangeThresholdExceededError(
          repositoryName,
          comparison.files.length,
          this.changeFileThreshold
        );
      }

      // Step 7: Update local clone (git pull)
      await this.updateLocalClone(repo.localPath, repo.branch);

      this.logger.info(
        { repository: repositoryName, localPath: repo.localPath },
        "Updated local clone"
      );

      // Step 8: Process changes via pipeline
      const pipelineResult = await this.updatePipeline.processChanges(comparison.files, {
        repository: repo.name,
        localPath: repo.localPath,
        collectionName: repo.collectionName,
        includeExtensions: repo.includeExtensions,
        excludePatterns: repo.excludePatterns,
      });

      this.logger.info(
        {
          repository: repositoryName,
          filesAdded: pipelineResult.stats.filesAdded,
          filesModified: pipelineResult.stats.filesModified,
          filesDeleted: pipelineResult.stats.filesDeleted,
          chunksUpserted: pipelineResult.stats.chunksUpserted,
          chunksDeleted: pipelineResult.stats.chunksDeleted,
          errorCount: pipelineResult.errors.length,
        },
        "Pipeline processing completed"
      );

      // Step 9: Update repository metadata with new commit SHA
      const updatedMetadata: RepositoryInfo = {
        ...repo,
        lastIndexedCommitSha: headCommit.sha,
        lastIncrementalUpdateAt: new Date().toISOString(),
        incrementalUpdateCount: (repo.incrementalUpdateCount || 0) + 1,
        // Update file and chunk counts based on pipeline results
        fileCount:
          repo.fileCount + pipelineResult.stats.filesAdded - pipelineResult.stats.filesDeleted,
        chunkCount:
          repo.chunkCount +
          pipelineResult.stats.chunksUpserted -
          pipelineResult.stats.chunksDeleted,
        // Update status based on whether errors occurred
        status: pipelineResult.errors.length > 0 ? "error" : "ready",
        errorMessage:
          pipelineResult.errors.length > 0
            ? `Incremental update completed with ${pipelineResult.errors.length} error(s)`
            : undefined,
      };

      await this.repositoryService.updateRepository(updatedMetadata);

      this.logger.info(
        { repository: repositoryName, newCommitSha: headCommit.sha.substring(0, 7) },
        "Repository metadata updated"
      );

      // Step 10: Return result
      const durationMs = Date.now() - startTime;
      const status = pipelineResult.errors.length > 0 ? "failed" : "updated";

      this.logger.info(
        {
          metric: "incremental_update_duration_ms",
          value: durationMs,
          repository: repositoryName,
          status,
        },
        "Incremental update completed"
      );

      return {
        status,
        commitSha: headCommit.sha,
        commitMessage: headCommit.message,
        stats: pipelineResult.stats,
        errors: pipelineResult.errors,
        durationMs,
      };
    } catch (error) {
      // Log error and re-throw (let caller handle specific error types)
      const durationMs = Date.now() - startTime;
      this.logger.error(
        {
          error: error instanceof Error ? error.message : String(error),
          repository: repositoryName,
          durationMs,
        },
        "Incremental update failed"
      );

      // Re-throw known coordinator errors and other errors
      throw error;
    }
  }

  /**
   * Parse GitHub owner and repository name from URL.
   *
   * Handles both HTTPS and SSH URL formats:
   * - HTTPS: `https://github.com/owner/repo.git`
   * - SSH: `git@github.com:owner/repo.git`
   *
   * @param url - GitHub repository URL
   * @returns Parsed owner and repo name
   * @throws {Error} If URL format is invalid or cannot be parsed
   *
   * @example
   * ```typescript
   * parseGitHubUrl("https://github.com/user/my-api.git")
   * // Returns: { owner: "user", repo: "my-api" }
   *
   * parseGitHubUrl("git@github.com:user/my-api.git")
   * // Returns: { owner: "user", repo: "my-api" }
   * ```
   */
  private parseGitHubUrl(url: string): GitHubRepoInfo {
    // Handle HTTPS format: https://github.com/owner/repo.git
    const httpsMatch = url.match(/github\.com[/:]([\w-]+)\/([\w-]+)(\.git)?$/);
    if (httpsMatch && httpsMatch[1] && httpsMatch[2]) {
      return {
        owner: httpsMatch[1],
        repo: httpsMatch[2].replace(/\.git$/, ""),
      };
    }

    // Handle SSH format: git@github.com:owner/repo.git
    const sshMatch = url.match(/git@github\.com:([\w-]+)\/([\w-]+)(\.git)?$/);
    if (sshMatch && sshMatch[1] && sshMatch[2]) {
      return {
        owner: sshMatch[1],
        repo: sshMatch[2].replace(/\.git$/, ""),
      };
    }

    throw new Error(
      `Cannot parse GitHub URL: ${url}. Expected format: https://github.com/owner/repo.git or git@github.com:owner/repo.git`
    );
  }

  /**
   * Update local repository clone via git pull.
   *
   * Performs `git pull origin <branch>` on the local clone to sync with
   * remote repository before processing changes.
   *
   * Uses custom git pull implementation if provided (for testing),
   * otherwise uses simple-git.
   *
   * @param localPath - Absolute path to local repository clone
   * @param branch - Branch name to pull
   * @throws {GitPullError} If git pull fails (conflicts, network issues, etc.)
   *
   * @example
   * ```typescript
   * await updateLocalClone("/repos/my-api", "main");
   * ```
   */
  private async updateLocalClone(localPath: string, branch: string): Promise<void> {
    this.logger.debug({ localPath, branch }, "Updating local clone via git pull");

    try {
      // Use custom git pull implementation if provided (for testing)
      if (this.customGitPull) {
        await this.customGitPull(localPath, branch);
        this.logger.debug({ localPath, branch }, "Git pull completed (custom implementation)");
        return;
      }

      // Otherwise use simple-git
      const git = simpleGit(localPath);

      // Perform git pull origin <branch>
      const result = await git.pull("origin", branch);

      this.logger.debug(
        {
          localPath,
          branch,
          files: result.files,
          insertions: result.insertions,
          deletions: result.deletions,
          summary: result.summary,
        },
        "Git pull completed"
      );
    } catch (error) {
      // Extract error message
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.logger.error({ localPath, branch, error: errorMessage }, "Git pull failed");

      throw new GitPullError(localPath, errorMessage);
    }
  }
}
