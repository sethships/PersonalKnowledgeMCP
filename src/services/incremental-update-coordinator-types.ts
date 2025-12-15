/**
 * Type definitions for incremental update coordinator.
 *
 * @module services/incremental-update-coordinator-types
 */

import type { UpdateStats, FileProcessingError } from "./incremental-update-types.js";

/**
 * Configuration options for the incremental update coordinator.
 *
 * Allows customization of coordinator behavior without modifying the service.
 *
 * @example
 * ```typescript
 * const config: CoordinatorConfig = {
 *   changeFileThreshold: 1000 // Trigger re-index at 1000 files instead of 500
 * };
 * ```
 */
export interface CoordinatorConfig {
  /**
   * Maximum number of changed files before triggering full re-index.
   *
   * When file changes exceed this threshold, a full re-index is more
   * efficient than incremental updates.
   *
   * @default 500
   */
  changeFileThreshold?: number;
}

/**
 * Result status for an incremental update operation.
 *
 * Indicates the outcome of the update attempt:
 * - `no_changes`: HEAD commit matches last indexed commit, no action taken
 * - `updated`: Incremental update completed successfully
 * - `failed`: Update failed with errors (partial or complete failure)
 */
export type CoordinatorStatus = "no_changes" | "updated" | "failed";

/**
 * Complete result of an incremental update operation.
 *
 * Provides status, statistics, commit information, and any errors encountered.
 *
 * @example
 * ```typescript
 * const result: CoordinatorResult = {
 *   status: "updated",
 *   commitSha: "abc123def456...",
 *   commitMessage: "feat: add new feature",
 *   stats: {
 *     filesAdded: 3,
 *     filesModified: 5,
 *     filesDeleted: 1,
 *     chunksUpserted: 47,
 *     chunksDeleted: 12,
 *     durationMs: 2340
 *   },
 *   errors: [],
 *   durationMs: 5230
 * };
 * ```
 */
export interface CoordinatorResult {
  /**
   * Overall status of the update operation.
   *
   * Indicates whether changes were found and processed.
   */
  status: CoordinatorStatus;

  /**
   * Commit SHA that was indexed.
   *
   * The new HEAD commit SHA after successful update.
   * Undefined if status is "no_changes" or "failed".
   */
  commitSha?: string;

  /**
   * First line of the commit message.
   *
   * Provides context about what changed in this commit.
   * Undefined if status is "no_changes" or "failed".
   */
  commitMessage?: string;

  /**
   * Statistics about files and chunks processed.
   *
   * Tracks counts of operations performed during the update.
   */
  stats: UpdateStats;

  /**
   * Errors encountered during processing.
   *
   * Empty array indicates all files processed successfully.
   * Non-empty array indicates partial success or complete failure.
   *
   * Even when errors exist, the update may have partially succeeded
   * and metadata will be updated with the new commit SHA.
   */
  errors: FileProcessingError[];

  /**
   * Total duration of the coordinator operation in milliseconds.
   *
   * Includes all steps: metadata lookup, GitHub API calls,
   * git pull, pipeline processing, and metadata update.
   */
  durationMs: number;
}

/**
 * Parsed GitHub repository information from URL.
 *
 * Used internally to extract owner and repo name from GitHub URLs.
 *
 * @example
 * ```typescript
 * const parsed: GitHubRepoInfo = {
 *   owner: "sethb75",
 *   repo: "PersonalKnowledgeMCP"
 * };
 * ```
 */
export interface GitHubRepoInfo {
  /**
   * Repository owner (user or organization).
   *
   * @example "sethb75", "facebook", "microsoft"
   */
  owner: string;

  /**
   * Repository name (without .git suffix).
   *
   * @example "PersonalKnowledgeMCP", "react", "typescript"
   */
  repo: string;
}
