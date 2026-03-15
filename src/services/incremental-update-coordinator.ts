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
import { parseGitHubUrl } from "../utils/git-url-parser.js";
import type { Logger } from "pino";
import { getComponentLogger } from "../logging/index.js";
import type { GitHubClient, CommitComparison } from "./github-client-types.js";
import type {
  RepositoryMetadataService,
  RepositoryInfo,
  UpdateHistoryEntry,
} from "../repositories/types.js";
import type { IncrementalUpdatePipeline } from "./incremental-update-pipeline.js";
import { addHistoryEntry } from "../repositories/metadata-store.js";
import { GitHubNotFoundError } from "./github-client-errors.js";
import type {
  CoordinatorConfig,
  CoordinatorResult,
  GitHubRepoInfo,
} from "./incremental-update-coordinator-types.js";
import type { IndexCompletenessChecker } from "./index-completeness-checker.js";
import type { CompletenessCheckResult } from "./index-completeness-types.js";
import {
  RepositoryNotFoundError,
  ForcePushDetectedError,
  ChangeThresholdExceededError,
  GitPullError,
  MissingCommitShaError,
  ConcurrentUpdateError,
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
   * Maximum number of update history entries to retain per repository.
   *
   * When the number of history entries exceeds this limit, the oldest
   * entries are automatically rotated out (FIFO).
   *
   * @default 20
   */
  private readonly updateHistoryLimit: number;

  /**
   * Lazy-initialized logger instance.
   */
  private _logger: Logger | null = null;

  /**
   * Optional custom git pull implementation for testing.
   */
  private readonly customGitPull?: (localPath: string, branch: string) => Promise<void>;

  /**
   * Optional completeness checker for post-update index validation.
   */
  private readonly completenessChecker?: IndexCompletenessChecker;

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
      completenessChecker?: IndexCompletenessChecker;
    } = {}
  ) {
    this.changeFileThreshold = config.changeFileThreshold ?? 500;
    this.updateHistoryLimit = config.updateHistoryLimit ?? 20;
    this.customGitPull = config.customGitPull;
    this.completenessChecker = config.completenessChecker;
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
   * Generate a unique correlation ID for tracing update operations.
   *
   * Format: update-{timestamp}-{shortHash}
   * - timestamp: Unix epoch seconds (10 digits)
   * - shortHash: 5-character random hex string
   *
   * @returns Correlation ID string
   *
   * @example "update-1734367200-a3c9f"
   */
  private generateCorrelationId(): string {
    const timestamp = Math.floor(Date.now() / 1000);
    const randomHex = Math.random().toString(16).substring(2, 7);
    return `update-${timestamp}-${randomHex}`;
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

    // Generate correlation ID for tracing this update operation
    const correlationId = this.generateCorrelationId();

    // Create correlation-aware logger
    const logger = this.logger.child({ correlationId });

    logger.info(
      { operation: "coordinator_update_repository", repository: repositoryName },
      "Starting incremental update"
    );

    // Track whether we've set the in-progress flag (for cleanup in finally)
    let inProgressFlagSet = false;
    // Keep reference to loaded repository for finally block
    let repo: RepositoryInfo | null = null;

    try {
      // Step 1: Load repository metadata
      repo = await this.repositoryService.getRepository(repositoryName);
      if (!repo) {
        throw new RepositoryNotFoundError(repositoryName);
      }

      logger.debug(
        { operation: "coordinator_load_metadata", repository: repositoryName, url: repo.url },
        "Repository metadata loaded"
      );

      // Check if repository has a commit SHA recorded
      if (!repo.lastIndexedCommitSha) {
        throw new MissingCommitShaError(repositoryName);
      }

      // Check if an update is already in progress (concurrent update prevention)
      if (repo.updateInProgress && repo.updateStartedAt) {
        throw new ConcurrentUpdateError(repositoryName, repo.updateStartedAt);
      }

      // Step 1b: Mark update as in-progress BEFORE doing any work
      // This allows detection of interrupted updates if service crashes
      const updateStartedAt = new Date().toISOString();
      await this.repositoryService.updateRepository({
        ...repo,
        updateInProgress: true,
        updateStartedAt,
      });
      inProgressFlagSet = true;

      logger.debug(
        { operation: "coordinator_set_in_progress", repository: repositoryName, updateStartedAt },
        "Update marked as in-progress"
      );

      // Step 2-5: Detect changes — via GitHub API for github.com repos,
      // or via local git diff for all other hosts and local paths.
      const parsedUrl = parseGitHubUrl(repo.url);
      const isGitHub = parsedUrl?.isGitHub === true;

      let headCommit: import("./github-client-types.js").CommitInfo;
      let comparison: CommitComparison;

      if (isGitHub && parsedUrl) {
        const { owner, repo: repoName } = parsedUrl;

        logger.debug(
          { operation: "coordinator_parse_url", owner, repo: repoName, branch: repo.branch },
          "Parsed GitHub repository info"
        );

        // Fetch HEAD commit from GitHub API
        headCommit = await this.githubClient.getHeadCommit(
          owner,
          repoName,
          repo.branch,
          correlationId
        );

        logger.info(
          {
            repository: repositoryName,
            headSha: headCommit.sha.substring(0, 7),
            message: headCommit.message,
          },
          "Fetched HEAD commit from GitHub"
        );

        // Short-circuit if no changes
        if (repo.lastIndexedCommitSha === headCommit.sha) {
          const durationMs = Date.now() - startTime;
          logger.info(
            { repository: repositoryName, durationMs },
            "No changes detected - repository is up-to-date"
          );

          const noChangesCompletenessCheck = await this.runCompletenessCheck(
            repositoryName,
            logger
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
            completenessCheck: noChangesCompletenessCheck,
          };
        }

        // Detect force push and get changed file list via GitHub API
        try {
          comparison = await this.githubClient.compareCommits(
            owner,
            repoName,
            repo.lastIndexedCommitSha,
            headCommit.sha,
            correlationId
          );

          logger.info(
            {
              repository: repositoryName,
              baseSha: comparison.baseSha.substring(0, 7),
              headSha: comparison.headSha.substring(0, 7),
              totalCommits: comparison.totalCommits,
              filesChanged: comparison.files.length,
            },
            "Compared commits via GitHub API"
          );
        } catch (error) {
          if (error instanceof GitHubNotFoundError) {
            logger.warn(
              {
                repository: repositoryName,
                lastIndexedSha: repo.lastIndexedCommitSha.substring(0, 7),
              },
              "Force push detected - base commit not found"
            );
            throw new ForcePushDetectedError(
              repositoryName,
              repo.lastIndexedCommitSha,
              headCommit.sha
            );
          }
          throw error;
        }
      } else {
        // Non-GitHub host or local path — use local git operations for change detection
        const localResult = await this.buildLocalGitComparison(
          repo.localPath,
          repo.branch,
          repo.lastIndexedCommitSha,
          repo.url,
          logger
        );

        if (!localResult) {
          // No changes detected
          const durationMs = Date.now() - startTime;
          logger.info(
            { repository: repositoryName, durationMs },
            "No changes detected - repository is up-to-date"
          );
          const noChangesCompletenessCheck = await this.runCompletenessCheck(
            repositoryName,
            logger
          );
          return {
            status: "no_changes",
            commitSha: repo.lastIndexedCommitSha,
            commitMessage: "up-to-date",
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
            completenessCheck: noChangesCompletenessCheck,
          };
        }

        headCommit = localResult.headCommit;
        comparison = localResult.comparison;

        logger.info(
          {
            repository: repositoryName,
            headSha: headCommit.sha.substring(0, 7),
            filesChanged: comparison.files.length,
          },
          "Detected changes via local git diff"
        );
      }

      // Step 6: Check change threshold (>500 files triggers full re-index)
      if (comparison.files.length > this.changeFileThreshold) {
        logger.warn(
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

      // Step 7: Update local clone (git pull).
      // Skipped for local-path repos — the directory is managed by the user, not cloned.
      if (!this.isLocalPathUrl(repo.url)) {
        await this.updateLocalClone(repo.localPath, repo.branch);
        logger.info(
          { repository: repositoryName, localPath: repo.localPath },
          "Updated local clone"
        );
      } else {
        logger.debug({ repository: repositoryName }, "Skipping git pull — local path repository");
      }

      // Step 8: Process changes via pipeline
      const pipelineResult = await this.updatePipeline.processChanges(comparison.files, {
        repository: repo.name,
        localPath: repo.localPath,
        collectionName: repo.collectionName,
        includeExtensions: repo.includeExtensions,
        excludePatterns: repo.excludePatterns,
        correlationId,
      });

      logger.info(
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
      // Determine history entry status based on error count
      const totalFilesProcessed =
        pipelineResult.stats.filesAdded +
        pipelineResult.stats.filesModified +
        pipelineResult.stats.filesDeleted;

      // Guard: If eligible files existed in diff but 0 were processed and 0 errors,
      // this indicates a filtering misconfiguration. Don't advance SHA.
      const allEligibleFiltered =
        pipelineResult.filterStats.eligibleChanges > 0 &&
        totalFilesProcessed === 0 &&
        pipelineResult.errors.length === 0;

      let historyStatus: "success" | "partial" | "failed" | "incomplete";
      if (allEligibleFiltered) {
        historyStatus = "incomplete";
        logger.warn(
          {
            operation: "coordinator_sha_guard",
            repository: repositoryName,
            eligibleChanges: pipelineResult.filterStats.eligibleChanges,
            totalChanges: pipelineResult.filterStats.totalChanges,
            filteredChanges: pipelineResult.filterStats.filteredChanges,
          },
          "SHA advancement blocked: eligible files existed but none were processed. " +
            "This likely indicates a filtering misconfiguration. " +
            "Index remains at previous commit to prevent data loss."
        );
      } else if (pipelineResult.errors.length === 0) {
        historyStatus = "success";
      } else if (totalFilesProcessed === 0) {
        // Errors occurred but no files were tracked as changed - treat as failed
        historyStatus = "failed";
      } else if (pipelineResult.errors.length >= totalFilesProcessed) {
        historyStatus = "failed";
      } else {
        historyStatus = "partial";
      }

      // Create history entry
      const historyEntry: UpdateHistoryEntry = {
        timestamp: new Date().toISOString(),
        // Validated above - throws MissingCommitShaError if undefined
        previousCommit: repo.lastIndexedCommitSha,
        // If guard triggered, don't record HEAD as newCommit (SHA not advanced)
        newCommit: allEligibleFiltered ? repo.lastIndexedCommitSha : headCommit.sha,
        filesAdded: pipelineResult.stats.filesAdded,
        filesModified: pipelineResult.stats.filesModified,
        filesDeleted: pipelineResult.stats.filesDeleted,
        chunksUpserted: pipelineResult.stats.chunksUpserted,
        chunksDeleted: pipelineResult.stats.chunksDeleted,
        durationMs: pipelineResult.stats.durationMs,
        errorCount: pipelineResult.errors.length,
        status: historyStatus,
        skippedFileCount: pipelineResult.filterStats.skippedChanges,
        eligibleFileCount: pipelineResult.filterStats.eligibleChanges,
        // Include graph stats if graph service was configured
        ...(pipelineResult.stats.graph && {
          graphNodesCreated: pipelineResult.stats.graph.graphNodesCreated,
          graphNodesDeleted: pipelineResult.stats.graph.graphNodesDeleted,
          graphRelationshipsCreated: pipelineResult.stats.graph.graphRelationshipsCreated,
          graphRelationshipsDeleted: pipelineResult.stats.graph.graphRelationshipsDeleted,
          graphFilesProcessed: pipelineResult.stats.graph.graphFilesProcessed,
          graphFilesSkipped: pipelineResult.stats.graph.graphFilesSkipped,
          graphErrorCount: pipelineResult.stats.graph.graphErrors.length,
        }),
      };

      // Add to history with rotation
      const updatedHistory = addHistoryEntry(
        repo.updateHistory,
        historyEntry,
        this.updateHistoryLimit
      );

      const updatedMetadata: RepositoryInfo = {
        ...repo,
        updateHistory: updatedHistory,
        // Only advance SHA when files were actually processed (or no eligible files existed)
        lastIndexedCommitSha: allEligibleFiltered ? repo.lastIndexedCommitSha : headCommit.sha,
        lastIncrementalUpdateAt: new Date().toISOString(),
        incrementalUpdateCount: (repo.incrementalUpdateCount || 0) + 1,
        // Update file and chunk counts based on pipeline results
        fileCount:
          repo.fileCount + pipelineResult.stats.filesAdded - pipelineResult.stats.filesDeleted,
        chunkCount:
          repo.chunkCount +
          pipelineResult.stats.chunksUpserted -
          pipelineResult.stats.chunksDeleted,
        // Only set "error" when ALL files failed (historyStatus === "failed")
        // Partial success is still usable for search
        status: historyStatus === "failed" ? "error" : "ready",
        errorMessage:
          historyStatus === "failed"
            ? `Incremental update completed with ${pipelineResult.errors.length} error(s)`
            : allEligibleFiltered
              ? `Incremental update incomplete: ${pipelineResult.filterStats.eligibleChanges} eligible file(s) were filtered out`
              : undefined,
        // Clear the in-progress flag (update completed successfully or with partial errors)
        updateInProgress: false,
        updateStartedAt: undefined,
      };

      await this.repositoryService.updateRepository(updatedMetadata);
      inProgressFlagSet = false; // Flag cleared in metadata

      logger.info(
        {
          repository: repositoryName,
          newCommitSha: updatedMetadata.lastIndexedCommitSha?.substring(0, 7),
        },
        "Repository metadata updated"
      );

      // Step 10: Run completeness check after update (skip on failed pipeline)
      const shouldRunCompleteness = pipelineResult.errors.length === 0;
      const updatedCompletenessCheck = shouldRunCompleteness
        ? await this.runCompletenessCheck(repositoryName, logger)
        : undefined;

      // Step 11: Return result
      const durationMs = Date.now() - startTime;

      let resultStatus: CoordinatorResult["status"];
      if (allEligibleFiltered) {
        resultStatus = "incomplete";
      } else if (historyStatus === "failed") {
        resultStatus = "failed";
      } else {
        resultStatus = "updated"; // includes partial success
      }

      logger.info(
        {
          metric: "incremental_update_duration_ms",
          value: durationMs,
          repository: repositoryName,
          status: resultStatus,
        },
        "Incremental update completed"
      );

      return {
        status: resultStatus,
        commitSha: headCommit.sha,
        commitMessage: headCommit.message,
        stats: pipelineResult.stats,
        errors: pipelineResult.errors,
        durationMs,
        completenessCheck: updatedCompletenessCheck,
      };
    } catch (error) {
      // Log error and re-throw (let caller handle specific error types)
      const durationMs = Date.now() - startTime;
      logger.error(
        {
          error: error instanceof Error ? error.message : String(error),
          repository: repositoryName,
          durationMs,
        },
        "Incremental update failed"
      );

      // Re-throw known coordinator errors and other errors
      throw error;
    } finally {
      // Always clear the in-progress flag if we set it, even on error
      // This prevents false "interrupted update" detection for handled errors
      if (inProgressFlagSet && repo) {
        try {
          // Re-fetch current metadata to avoid overwriting any changes made during processing.
          // This is necessary because the main try block may have already updated metadata
          // (e.g., for successful updates), and we don't want to revert those changes.
          const currentRepo = await this.repositoryService.getRepository(repositoryName);
          if (currentRepo && currentRepo.updateInProgress) {
            await this.repositoryService.updateRepository({
              ...currentRepo,
              updateInProgress: false,
              updateStartedAt: undefined,
            });
            logger.debug({ repository: repositoryName }, "Cleared in-progress flag after error");
          }
        } catch (cleanupError) {
          // Log but don't throw - the original error is more important
          logger.warn(
            {
              repository: repositoryName,
              error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
            },
            "Failed to clear in-progress flag during error cleanup. Manual verification recommended."
          );
        }
      }
    }
  }

  /**
   * Run post-update completeness check if checker is configured.
   *
   * Non-blocking: errors are logged as warnings and the method returns undefined
   * rather than propagating errors to the caller.
   *
   * @param repositoryName - Name of the repository to check
   * @param logger - Correlation-aware logger for the current operation
   * @returns Completeness check result, or undefined if checker is not configured or check fails
   */
  private async runCompletenessCheck(
    repositoryName: string,
    logger: Logger
  ): Promise<CompletenessCheckResult | undefined> {
    if (!this.completenessChecker) {
      return undefined;
    }

    try {
      // Re-fetch repo metadata to get the most recent fileCount
      const repo = await this.repositoryService.getRepository(repositoryName);
      if (!repo) {
        logger.warn(
          { repository: repositoryName },
          "Cannot run completeness check - repository not found after update"
        );
        return undefined;
      }

      const result = await this.completenessChecker.checkCompleteness(repo);

      if (result.status === "incomplete") {
        logger.warn(
          {
            repository: repositoryName,
            indexedFileCount: result.indexedFileCount,
            eligibleFileCount: result.eligibleFileCount,
            missingFileCount: result.missingFileCount,
            divergencePercent: result.divergencePercent,
          },
          "Index completeness check detected incomplete index"
        );
      }

      return result;
    } catch (error) {
      logger.warn(
        {
          repository: repositoryName,
          error: error instanceof Error ? error.message : String(error),
        },
        "Completeness check failed (non-blocking)"
      );
      return undefined;
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
    const httpsMatch = url.match(/github\.com[/:]([\w.-]+)\/([\w.-]+)(\.git)?$/);
    if (httpsMatch && httpsMatch[1] && httpsMatch[2]) {
      return {
        owner: httpsMatch[1],
        repo: httpsMatch[2].replace(/\.git$/, ""),
      };
    }

    // Handle SSH format: git@github.com:owner/repo.git
    const sshMatch = url.match(/git@github\.com:([\w.-]+)\/([\w.-]+)(\.git)?$/);
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
  /**
   * Detect whether a stored URL is actually a local filesystem path.
   */
  private isLocalPathUrl(url: string): boolean {
    if (!url) return false;
    const s = url.trim();
    return (
      /^[A-Za-z]:[/\\]/.test(s) || s.startsWith("/") || s.startsWith("./") || s.startsWith("../")
    );
  }

  /**
   * Build a CommitComparison using local git operations instead of the GitHub API.
   *
   * Used for non-GitHub hosts and local-path repositories. For remote repos the
   * clone is fetched first so the local state reflects the remote HEAD.
   *
   * @returns `null` when there are no new changes, otherwise the head commit and comparison.
   */
  private async buildLocalGitComparison(
    localPath: string,
    branch: string,
    lastIndexedCommitSha: string,
    repoUrl: string,
    logger: Logger
  ): Promise<{
    headCommit: import("./github-client-types.js").CommitInfo;
    comparison: CommitComparison;
  } | null> {
    const git = simpleGit(localPath);

    // For remote (non-local-path) repos, fetch to get latest remote state
    if (!this.isLocalPathUrl(repoUrl)) {
      try {
        await git.fetch(["origin", branch, "--depth", "100"]);
        logger.debug({ localPath, branch }, "Fetched latest from remote for change detection");
      } catch (err) {
        logger.warn(
          { localPath, branch, err },
          "git fetch failed; comparing against current local HEAD"
        );
      }
    }

    // Get current HEAD SHA (after fetch for remote repos)
    const headSha = (await git.revparse(["HEAD"])).trim();

    if (headSha === lastIndexedCommitSha) {
      return null; // No changes
    }

    // Get commit metadata for the new HEAD
    const logResult = await git.log({ from: headSha, to: headSha, maxCount: 1 });
    const latestLog = logResult.latest;
    const headCommit: import("./github-client-types.js").CommitInfo = {
      sha: headSha,
      message: latestLog?.message ?? "",
      author: latestLog?.author_name ?? "",
      date: latestLog?.date ?? new Date().toISOString(),
    };

    // Get changed files between last indexed commit and new HEAD
    let diffOutput: string;
    try {
      diffOutput = await git.diff(["--name-status", lastIndexedCommitSha, headSha]);
    } catch {
      // If the base commit is no longer reachable (shallow clone / history rewrite),
      // treat everything as modified to force a full rescan.
      logger.warn(
        { localPath, lastIndexedCommitSha },
        "Base commit not reachable; marking all tracked files as modified"
      );
      diffOutput = "";
    }

    const files: import("./github-client-types.js").FileChange[] = [];
    for (const line of diffOutput.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const parts = trimmed.split(/\t+/);
      const statusCode = parts[0]?.charAt(0);

      if (!statusCode || !parts[1]) continue;

      const status =
        statusCode === "A"
          ? "added"
          : statusCode === "D"
            ? "deleted"
            : statusCode === "R"
              ? "renamed"
              : "modified";

      if (status === "renamed" && parts[2]) {
        files.push({ path: parts[2], status, previousPath: parts[1] });
      } else {
        files.push({ path: parts[1], status: status as "added" | "modified" | "deleted" });
      }
    }

    // Count commits between base and head (best-effort)
    let totalCommits = 1;
    try {
      const logBetween = await git.log({ from: lastIndexedCommitSha, to: headSha });
      totalCommits = logBetween.total;
    } catch {
      // ignore
    }

    const comparison: CommitComparison = {
      baseSha: lastIndexedCommitSha,
      headSha,
      totalCommits,
      files,
    };

    return { headCommit, comparison };
  }

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
