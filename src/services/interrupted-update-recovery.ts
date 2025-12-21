/**
 * Interrupted Update Recovery Service
 *
 * Provides recovery logic for interrupted update operations.
 * Evaluates the interrupted state and determines the appropriate
 * recovery strategy: resume, full re-index, or manual intervention.
 *
 * @module services/interrupted-update-recovery
 */

import { getComponentLogger } from "../logging/index.js";
import type { RepositoryMetadataService, RepositoryInfo } from "../repositories/types.js";
import type { IngestionService } from "./ingestion-service.js";
import type { IncrementalUpdateCoordinator } from "./incremental-update-coordinator.js";
import type { InterruptedUpdateInfo } from "./interrupted-update-detector.js";
import { clearInterruptedUpdateFlag, formatElapsedTime } from "./interrupted-update-detector.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recovery strategy type
 *
 * - `resume`: Attempt incremental update from last known commit
 * - `full_reindex`: Perform complete re-indexing of the repository
 * - `manual_required`: User intervention is required
 */
export type RecoveryStrategyType = "resume" | "full_reindex" | "manual_required";

/**
 * Recovery strategy recommendation
 */
export interface RecoveryStrategy {
  /**
   * Type of recovery action to take
   */
  type: RecoveryStrategyType;

  /**
   * Human-readable explanation for why this strategy was chosen
   */
  reason: string;

  /**
   * Estimated work description (e.g., "~50 files to process")
   */
  estimatedWork?: string;

  /**
   * Whether this strategy can be executed automatically
   */
  canAutoRecover: boolean;
}

/**
 * Result of executing a recovery operation
 */
export interface RecoveryResult {
  /**
   * The strategy that was executed
   */
  strategy: RecoveryStrategy;

  /**
   * Whether recovery completed successfully
   */
  success: boolean;

  /**
   * Name of the repository that was recovered
   */
  repositoryName: string;

  /**
   * Human-readable message about the recovery outcome
   */
  message: string;

  /**
   * Duration of recovery operation in milliseconds
   */
  durationMs: number;

  /**
   * Error message if recovery failed
   */
  error?: string;
}

/**
 * Dependencies required for recovery execution
 */
export interface RecoveryDependencies {
  repositoryService: RepositoryMetadataService;
  ingestionService: IngestionService;
  updateCoordinator: IncrementalUpdateCoordinator;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maximum age of an interrupted update before forcing full re-index (24 hours)
 */
const STALE_UPDATE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// Strategy Evaluation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evaluate the best recovery strategy for an interrupted update
 *
 * Analyzes the interrupted update state and determines whether to:
 * - Resume the update incrementally (if last commit is known and recent)
 * - Perform a full re-index (if state is stale or unrecoverable)
 * - Require manual intervention (if repository is inaccessible)
 *
 * @param interruptedInfo - Information about the interrupted update
 * @returns Recommended recovery strategy
 *
 * @example
 * ```typescript
 * const strategy = await evaluateRecoveryStrategy(interruptedInfo);
 * console.log(`Recommended: ${strategy.type} - ${strategy.reason}`);
 * ```
 */
export async function evaluateRecoveryStrategy(
  interruptedInfo: InterruptedUpdateInfo
): Promise<RecoveryStrategy> {
  const logger = getComponentLogger("services:interrupted-update-recovery");
  const { repositoryName, elapsedMs, lastKnownCommit, repository } = interruptedInfo;

  logger.debug(
    {
      repository: repositoryName,
      elapsedMs,
      hasLastKnownCommit: !!lastKnownCommit,
      status: repository.status,
    },
    "Evaluating recovery strategy"
  );

  // Check 1: Is the update stale (>24 hours old)?
  if (elapsedMs > STALE_UPDATE_THRESHOLD_MS) {
    const elapsed = formatElapsedTime(elapsedMs);
    logger.info(
      { repository: repositoryName, elapsed },
      "Update is stale, recommending full re-index"
    );
    return {
      type: "full_reindex",
      reason: `Update interrupted ${elapsed} ago (>24 hours). State may be inconsistent.`,
      canAutoRecover: true,
    };
  }

  // Check 2: Do we have a last known commit to resume from?
  if (!lastKnownCommit) {
    logger.info({ repository: repositoryName }, "No last known commit, recommending full re-index");
    return {
      type: "full_reindex",
      reason: "No previous commit reference available. Full re-index required.",
      canAutoRecover: true,
    };
  }

  // Check 3: Is the local repository path accessible?
  const localPathAccessible = await checkLocalPathAccessible(repository.localPath);
  if (!localPathAccessible) {
    logger.warn(
      { repository: repositoryName, localPath: repository.localPath },
      "Local repository path not accessible"
    );
    return {
      type: "manual_required",
      reason: `Local repository path not accessible: ${repository.localPath}`,
      canAutoRecover: false,
    };
  }

  // Check 4: Can we resume from the last known commit?
  // If we have a valid last commit and repository is accessible, try to resume
  const elapsed = formatElapsedTime(elapsedMs);
  logger.info(
    { repository: repositoryName, lastKnownCommit: lastKnownCommit.substring(0, 7), elapsed },
    "Can attempt incremental resume"
  );

  return {
    type: "resume",
    reason: `Update interrupted ${elapsed} ago. Last indexed commit: ${lastKnownCommit.substring(0, 7)}`,
    estimatedWork: "Will process changes since last indexed commit",
    canAutoRecover: true,
  };
}

/**
 * Check if a local file path is accessible
 *
 * @param path - Path to check
 * @returns true if path exists and is accessible
 *
 * @remarks
 * Uses Node.js fs.stat for cross-platform compatibility.
 * Returns false for any error (permission denied, not found, etc.)
 */
async function checkLocalPathAccessible(path: string): Promise<boolean> {
  try {
    // Use Node.js fs.stat for cross-platform directory check
    // Bun.file().exists() works for files, but for directories we need stat
    const { stat } = await import("node:fs/promises");
    const stats = await stat(path);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Recovery Execution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Execute a recovery operation based on the given strategy
 *
 * Performs the appropriate recovery action:
 * - `resume`: Attempts incremental update from last known commit
 * - `full_reindex`: Clears interrupted flag and triggers full re-index
 * - `manual_required`: Clears flag and sets error status
 *
 * @param interruptedInfo - Information about the interrupted update
 * @param strategy - Recovery strategy to execute
 * @param deps - Required dependencies
 * @returns Result of the recovery operation
 *
 * @example
 * ```typescript
 * const strategy = await evaluateRecoveryStrategy(info);
 * const result = await executeRecovery(info, strategy, deps);
 * if (result.success) {
 *   console.log(`Recovery successful: ${result.message}`);
 * }
 * ```
 */
export async function executeRecovery(
  interruptedInfo: InterruptedUpdateInfo,
  strategy: RecoveryStrategy,
  deps: RecoveryDependencies
): Promise<RecoveryResult> {
  const logger = getComponentLogger("services:interrupted-update-recovery");
  const { repositoryName } = interruptedInfo;
  const startTime = Date.now();

  logger.info(
    { repository: repositoryName, strategy: strategy.type, reason: strategy.reason },
    "Executing recovery"
  );

  try {
    switch (strategy.type) {
      case "resume":
        return await executeResumeRecovery(interruptedInfo, strategy, deps, startTime);

      case "full_reindex":
        return await executeFullReindexRecovery(interruptedInfo, strategy, deps, startTime);

      case "manual_required":
        return await executeManualRequiredRecovery(interruptedInfo, strategy, deps, startTime);

      default: {
        // This should never happen due to TypeScript exhaustiveness checking
        const _exhaustive: never = strategy.type;
        throw new Error(`Unknown recovery strategy type: ${String(_exhaustive)}`);
      }
    }
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error(
      { repository: repositoryName, strategy: strategy.type, error: errorMessage, durationMs },
      "Recovery failed with error"
    );

    return {
      strategy,
      success: false,
      repositoryName,
      message: `Recovery failed: ${errorMessage}`,
      durationMs,
      error: errorMessage,
    };
  }
}

/**
 * Execute resume recovery - attempt incremental update
 */
async function executeResumeRecovery(
  interruptedInfo: InterruptedUpdateInfo,
  strategy: RecoveryStrategy,
  deps: RecoveryDependencies,
  startTime: number
): Promise<RecoveryResult> {
  const logger = getComponentLogger("services:interrupted-update-recovery");
  const { repositoryName } = interruptedInfo;

  // First, clear the interrupted flag
  await clearInterruptedUpdateFlag(deps.repositoryService, repositoryName);
  logger.debug({ repository: repositoryName }, "Cleared interrupted update flag");

  // Attempt incremental update
  try {
    const result = await deps.updateCoordinator.updateRepository(repositoryName);
    const durationMs = Date.now() - startTime;

    if (result.status === "no_changes") {
      logger.info(
        { repository: repositoryName, durationMs },
        "Resume recovery: repository already up-to-date"
      );
      return {
        strategy,
        success: true,
        repositoryName,
        message: "Repository is already up-to-date (no changes since last commit)",
        durationMs,
      };
    }

    if (result.status === "updated") {
      const { filesAdded, filesModified, filesDeleted } = result.stats;
      logger.info(
        { repository: repositoryName, filesAdded, filesModified, filesDeleted, durationMs },
        "Resume recovery: incremental update successful"
      );
      return {
        strategy,
        success: true,
        repositoryName,
        message: `Incremental update completed: +${filesAdded} ~${filesModified} -${filesDeleted} files`,
        durationMs,
      };
    }

    // Partial or failed status
    const durationMsFinal = Date.now() - startTime;
    logger.warn(
      { repository: repositoryName, status: result.status, errors: result.errors.length },
      "Resume recovery completed with errors"
    );
    return {
      strategy,
      success: result.status !== "failed",
      repositoryName,
      message: `Update ${result.status}: ${result.errors.length} error(s)`,
      durationMs: durationMsFinal,
    };
  } catch (error) {
    // If incremental update fails, fall back to full re-index
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn(
      { repository: repositoryName, error: errorMessage },
      "Resume recovery failed, falling back to full re-index"
    );

    // Attempt full re-index as fallback
    return await executeFullReindexRecovery(
      interruptedInfo,
      {
        ...strategy,
        type: "full_reindex",
        reason: `Resume failed (${errorMessage}), falling back to full re-index`,
      },
      deps,
      startTime
    );
  }
}

/**
 * Execute full re-index recovery
 */
async function executeFullReindexRecovery(
  interruptedInfo: InterruptedUpdateInfo,
  strategy: RecoveryStrategy,
  deps: RecoveryDependencies,
  startTime: number
): Promise<RecoveryResult> {
  const logger = getComponentLogger("services:interrupted-update-recovery");
  const { repositoryName, repository } = interruptedInfo;

  // Clear the interrupted flag first
  await clearInterruptedUpdateFlag(deps.repositoryService, repositoryName);
  logger.debug({ repository: repositoryName }, "Cleared interrupted update flag");

  // Perform full re-index
  const result = await deps.ingestionService.indexRepository(repository.url, {
    branch: repository.branch,
    force: true,
  });

  const durationMs = Date.now() - startTime;

  if (result.status === "success" && result.stats) {
    logger.info(
      {
        repository: repositoryName,
        filesProcessed: result.stats.filesProcessed,
        chunksCreated: result.stats.chunksCreated,
        durationMs,
      },
      "Full re-index recovery successful"
    );
    return {
      strategy,
      success: true,
      repositoryName,
      message: `Full re-index completed: ${result.stats.filesProcessed} files, ${result.stats.chunksCreated} chunks`,
      durationMs,
    };
  }

  logger.error(
    { repository: repositoryName, status: result.status, durationMs },
    "Full re-index recovery failed"
  );
  return {
    strategy,
    success: false,
    repositoryName,
    message: `Full re-index failed: ${result.status}`,
    durationMs,
    error: result.status === "failed" ? "Re-indexing failed" : undefined,
  };
}

/**
 * Execute manual required recovery - just clear flag and set error status
 */
async function executeManualRequiredRecovery(
  interruptedInfo: InterruptedUpdateInfo,
  strategy: RecoveryStrategy,
  deps: RecoveryDependencies,
  startTime: number
): Promise<RecoveryResult> {
  const logger = getComponentLogger("services:interrupted-update-recovery");
  const { repositoryName, updateStartedAt } = interruptedInfo;

  // Get current repository state
  const repo = await deps.repositoryService.getRepository(repositoryName);
  if (!repo) {
    throw new Error(`Repository '${repositoryName}' not found`);
  }

  // Update repository to error status with clear message
  const updatedRepo: RepositoryInfo = {
    ...repo,
    updateInProgress: false,
    updateStartedAt: undefined,
    status: "error",
    errorMessage: `Update interrupted at ${updateStartedAt}. Manual intervention required: ${strategy.reason}`,
  };

  await deps.repositoryService.updateRepository(updatedRepo);

  const durationMs = Date.now() - startTime;

  logger.info(
    { repository: repositoryName, reason: strategy.reason, durationMs },
    "Manual recovery required - cleared flag and set error status"
  );

  return {
    strategy,
    success: true, // Flag cleared successfully
    repositoryName,
    message: `Cleared interrupted flag. Manual action required: ${strategy.reason}`,
    durationMs,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Batch Recovery
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Result of recovering multiple repositories
 */
export interface BatchRecoveryResult {
  /**
   * Total repositories processed
   */
  total: number;

  /**
   * Number of successful recoveries
   */
  successful: number;

  /**
   * Number of failed recoveries
   */
  failed: number;

  /**
   * Number requiring manual intervention
   */
  manualRequired: number;

  /**
   * Individual recovery results
   */
  results: RecoveryResult[];

  /**
   * Total duration in milliseconds
   */
  durationMs: number;
}

/**
 * Recover multiple interrupted updates
 *
 * Evaluates and executes recovery for a list of interrupted updates.
 * Processes sequentially to avoid overwhelming resources.
 *
 * @param interruptedList - List of interrupted updates to recover
 * @param deps - Required dependencies
 * @returns Batch recovery results
 */
export async function recoverMultiple(
  interruptedList: InterruptedUpdateInfo[],
  deps: RecoveryDependencies
): Promise<BatchRecoveryResult> {
  const logger = getComponentLogger("services:interrupted-update-recovery");
  const startTime = Date.now();
  const results: RecoveryResult[] = [];

  logger.info({ count: interruptedList.length }, "Starting batch recovery");

  for (const interrupted of interruptedList) {
    const strategy = await evaluateRecoveryStrategy(interrupted);

    // Execute recovery for all strategies (including manual_required to clear flag)
    const result = await executeRecovery(interrupted, strategy, deps);
    results.push(result);
  }

  const durationMs = Date.now() - startTime;
  const successful = results.filter(
    (r) => r.success && r.strategy.type !== "manual_required"
  ).length;
  const failed = results.filter((r) => !r.success).length;
  const manualRequired = results.filter((r) => r.strategy.type === "manual_required").length;

  logger.info(
    { total: interruptedList.length, successful, failed, manualRequired, durationMs },
    "Batch recovery completed"
  );

  return {
    total: interruptedList.length,
    successful,
    failed,
    manualRequired,
    results,
    durationMs,
  };
}
