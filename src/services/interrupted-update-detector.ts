/**
 * Interrupted Update Detector Service
 *
 * Provides detection and recovery capabilities for interrupted update operations.
 * When the service crashes during an update, the `updateInProgress` flag remains
 * set to `true`. This service detects such cases and provides recovery options.
 *
 * @module services/interrupted-update-detector
 */

import { getComponentLogger } from "../logging/index.js";
import type {
  RepositoryMetadataService,
  RepositoryInfo,
  RepositoryStatus,
} from "../repositories/types.js";

/**
 * Information about a repository with an interrupted update
 */
export interface InterruptedUpdateInfo {
  /**
   * Name of the repository with interrupted update
   */
  repositoryName: string;

  /**
   * ISO 8601 timestamp when the interrupted update started
   */
  updateStartedAt: string;

  /**
   * Elapsed time since update started in milliseconds
   */
  elapsedMs: number;

  /**
   * Current repository status
   */
  status: RepositoryStatus;

  /**
   * Last known indexed commit SHA (if available)
   */
  lastKnownCommit?: string;

  /**
   * Full repository information for recovery operations
   */
  repository: RepositoryInfo;
}

/**
 * Result of interrupted update detection
 */
export interface DetectionResult {
  /**
   * Array of repositories with interrupted updates
   */
  interrupted: InterruptedUpdateInfo[];

  /**
   * Total number of repositories checked
   */
  totalRepositories: number;

  /**
   * Duration of detection operation in milliseconds
   */
  detectionDurationMs: number;
}

/**
 * Detect repositories with interrupted updates
 *
 * Scans all repositories in the metadata store and identifies any with
 * `updateInProgress: true`. These are updates that started but never
 * completed, indicating a potential crash or interruption.
 *
 * @param repositoryService - Repository metadata service instance
 * @returns Detection result with list of interrupted updates
 *
 * @example
 * ```typescript
 * const result = await detectInterruptedUpdates(repositoryService);
 * if (result.interrupted.length > 0) {
 *   console.log(`Found ${result.interrupted.length} interrupted updates`);
 *   for (const info of result.interrupted) {
 *     console.log(`  - ${info.repositoryName}: started ${info.updateStartedAt}`);
 *   }
 * }
 * ```
 */
export async function detectInterruptedUpdates(
  repositoryService: RepositoryMetadataService
): Promise<DetectionResult> {
  const logger = getComponentLogger("services:interrupted-update-detector");
  const startTime = Date.now();

  logger.debug("Checking for interrupted updates");

  const repositories = await repositoryService.listRepositories();
  const interrupted: InterruptedUpdateInfo[] = [];

  const now = Date.now();

  for (const repo of repositories) {
    if (repo.updateInProgress === true) {
      // Fallback to current time if updateStartedAt is missing (should not happen in normal operation)
      const updateStartedAt = repo.updateStartedAt ?? new Date().toISOString();
      const startedAtMs = new Date(updateStartedAt).getTime();
      const elapsedMs = now - startedAtMs;

      interrupted.push({
        repositoryName: repo.name,
        updateStartedAt,
        elapsedMs,
        status: repo.status,
        lastKnownCommit: repo.lastIndexedCommitSha,
        repository: repo,
      });

      logger.warn(
        {
          repository: repo.name,
          updateStartedAt,
          elapsedMs,
          status: repo.status,
        },
        "Detected interrupted update"
      );
    }
  }

  const detectionDurationMs = Date.now() - startTime;

  logger.info(
    {
      totalRepositories: repositories.length,
      interruptedCount: interrupted.length,
      detectionDurationMs,
    },
    interrupted.length > 0 ? "Interrupted updates detected" : "No interrupted updates detected"
  );

  return {
    interrupted,
    totalRepositories: repositories.length,
    detectionDurationMs,
  };
}

/**
 * Clear the interrupted update flag for a repository
 *
 * Resets the `updateInProgress` and `updateStartedAt` fields without
 * modifying other metadata. Use this when manually recovering from
 * an interrupted update or when the issue has been resolved.
 *
 * @param repositoryService - Repository metadata service instance
 * @param repositoryName - Name of repository to clear flag for
 * @returns Updated repository info
 * @throws {Error} If repository not found
 *
 * @example
 * ```typescript
 * const updated = await clearInterruptedUpdateFlag(repositoryService, "my-repo");
 * console.log(`Cleared flag for ${updated.name}`);
 * ```
 */
export async function clearInterruptedUpdateFlag(
  repositoryService: RepositoryMetadataService,
  repositoryName: string
): Promise<RepositoryInfo> {
  const logger = getComponentLogger("services:interrupted-update-detector");

  const repo = await repositoryService.getRepository(repositoryName);
  if (!repo) {
    throw new Error(`Repository '${repositoryName}' not found`);
  }

  const updatedRepo: RepositoryInfo = {
    ...repo,
    updateInProgress: false,
    updateStartedAt: undefined,
  };

  await repositoryService.updateRepository(updatedRepo);

  logger.info({ repository: repositoryName }, "Cleared interrupted update flag");

  return updatedRepo;
}

/**
 * Mark a repository as having an interrupted update with error status
 *
 * Sets the repository status to "error" and clears the in-progress flag.
 * Use this when an interrupted update is detected and the repository
 * should be flagged as potentially inconsistent.
 *
 * @param repositoryService - Repository metadata service instance
 * @param repositoryName - Name of repository to mark
 * @param updateStartedAt - When the interrupted update started
 * @returns Updated repository info
 * @throws {Error} If repository not found
 *
 * @example
 * ```typescript
 * const updated = await markAsInterrupted(
 *   repositoryService,
 *   "my-repo",
 *   "2024-12-14T15:30:00.000Z"
 * );
 * console.log(`Marked ${updated.name} as interrupted`);
 * ```
 */
export async function markAsInterrupted(
  repositoryService: RepositoryMetadataService,
  repositoryName: string,
  updateStartedAt: string
): Promise<RepositoryInfo> {
  const logger = getComponentLogger("services:interrupted-update-detector");

  const repo = await repositoryService.getRepository(repositoryName);
  if (!repo) {
    throw new Error(`Repository '${repositoryName}' not found`);
  }

  const updatedRepo: RepositoryInfo = {
    ...repo,
    updateInProgress: false,
    updateStartedAt: undefined,
    status: "error",
    errorMessage: `Update interrupted at ${updateStartedAt}. Run 'pk-mcp update ${repositoryName} --force' to re-index.`,
  };

  await repositoryService.updateRepository(updatedRepo);

  logger.warn(
    { repository: repositoryName, updateStartedAt },
    "Marked repository as interrupted with error status"
  );

  return updatedRepo;
}

/**
 * Format human-readable elapsed time
 *
 * Converts milliseconds to a human-readable duration string.
 *
 * @param elapsedMs - Elapsed time in milliseconds
 * @returns Formatted string like "2h 15m", "45m 30s", or "30s"
 *
 * @example
 * ```typescript
 * formatElapsedTime(7200000) // "2h 0m"
 * formatElapsedTime(2730000) // "45m 30s"
 * formatElapsedTime(30000)   // "30s"
 * ```
 */
export function formatElapsedTime(elapsedMs: number): string {
  const seconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}
