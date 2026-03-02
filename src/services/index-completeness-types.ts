/**
 * Type definitions for index completeness detection.
 *
 * Provides types for checking whether a repository's stored file count
 * matches the actual number of eligible files on disk, detecting incomplete
 * indexes that may have diverged during incremental updates.
 *
 * @module services/index-completeness-types
 */

/**
 * Status of an index completeness check.
 *
 * - `complete`: Stored file count is within acceptable thresholds of eligible files on disk
 * - `incomplete`: Divergence exceeds one or both configured thresholds
 * - `error`: The check itself failed (e.g., file scanner error)
 */
export type CompletenessStatus = "complete" | "incomplete" | "error";

/**
 * Result of an index completeness check for a single repository.
 *
 * Captures both the raw counts and the computed divergence,
 * along with the final status determination.
 *
 * @example
 * ```typescript
 * const result: CompletenessCheckResult = {
 *   status: "incomplete",
 *   indexedFileCount: 89,
 *   eligibleFileCount: 424,
 *   missingFileCount: 335,
 *   divergencePercent: 79.0,
 *   durationMs: 142,
 * };
 * ```
 */
export interface CompletenessCheckResult {
  /** Overall status of the completeness check. */
  status: CompletenessStatus;

  /** Number of files recorded in repository metadata (stored file count). */
  indexedFileCount: number;

  /** Number of eligible files found on disk by file scanner. */
  eligibleFileCount: number;

  /**
   * Number of files present on disk but not in the index.
   *
   * Calculated as `max(0, eligibleFileCount - indexedFileCount)`.
   * When indexed exceeds eligible (e.g., after file deletions not yet reflected),
   * this is clamped to 0.
   */
  missingFileCount: number;

  /**
   * Percentage of eligible files that are missing from the index.
   *
   * Calculated as `(missingFileCount / eligibleFileCount) * 100`.
   * Zero when eligibleFileCount is zero or missingFileCount is zero.
   */
  divergencePercent: number;

  /** Duration of the completeness check in milliseconds. */
  durationMs: number;

  /** Error message when status is "error". */
  errorMessage?: string;
}

/**
 * Configurable thresholds for determining index incompleteness.
 *
 * A repository is considered "incomplete" if EITHER threshold is exceeded (OR logic):
 * - Percent threshold: percentage of eligible files missing
 * - Absolute threshold: raw count of missing files
 *
 * @example
 * ```typescript
 * const thresholds: CompletenessThresholds = {
 *   completenessThresholdPercent: 20,  // Flag if >20% files missing
 *   completenessThresholdAbsolute: 50, // Flag if >50 files missing
 * };
 * ```
 */
export interface CompletenessThresholds {
  /**
   * Maximum acceptable percentage of missing files before flagging as incomplete.
   *
   * @default 20
   */
  completenessThresholdPercent: number;

  /**
   * Maximum acceptable absolute count of missing files before flagging as incomplete.
   *
   * @default 50
   */
  completenessThresholdAbsolute: number;
}
