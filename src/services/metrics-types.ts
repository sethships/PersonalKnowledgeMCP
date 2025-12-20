/**
 * Type definitions for metrics tracking and calculation.
 *
 * Provides interfaces for aggregate metrics and trend analysis across
 * repository update operations.
 *
 * @module services/metrics-types
 */

/**
 * Trend metrics for a specific time period.
 *
 * Captures statistics filtered to a time range (e.g., last 7 days).
 *
 * @example
 * ```typescript
 * const trend: TrendMetrics = {
 *   updateCount: 12,
 *   filesProcessed: 156,
 *   chunksModified: 478,
 *   averageDurationMs: 1800,
 *   errorRate: 0.08
 * };
 * ```
 */
export interface TrendMetrics {
  /**
   * Number of updates in the time period.
   *
   * @example 12
   */
  updateCount: number;

  /**
   * Total files processed (added + modified + deleted).
   *
   * @example 156
   */
  filesProcessed: number;

  /**
   * Total chunks modified (upserted + deleted).
   *
   * @example 478
   */
  chunksModified: number;

  /**
   * Average update duration in milliseconds.
   *
   * Mean duration across all updates in the time period.
   *
   * @example 1800 (1.8 seconds)
   */
  averageDurationMs: number;

  /**
   * Error rate (0.0 to 1.0).
   *
   * Ratio of failed or partial updates to total updates.
   *
   * @example 0.08 (8% error rate)
   */
  errorRate: number;
}

/**
 * Aggregate metrics across all repositories.
 *
 * Provides comprehensive statistics about update operations including
 * totals, averages, success rates, and trend analysis.
 *
 * @example
 * ```typescript
 * const metrics: AggregateMetrics = {
 *   totalUpdates: 47,
 *   averageDurationMs: 2300,
 *   totalFilesProcessed: 1234,
 *   totalChunksModified: 5678,
 *   errorRate: 0.043,
 *   successRate: 0.957,
 *   last7DaysTrend: {
 *     updateCount: 12,
 *     filesProcessed: 156,
 *     chunksModified: 478,
 *     averageDurationMs: 1800,
 *     errorRate: 0.08
 *   }
 * };
 * ```
 */
export interface AggregateMetrics {
  /**
   * Total number of incremental updates across all repositories (all time).
   *
   * @example 47
   */
  totalUpdates: number;

  /**
   * Average update duration in milliseconds.
   *
   * Mean duration across all update history entries.
   *
   * @example 2300 (2.3 seconds)
   */
  averageDurationMs: number;

  /**
   * Total files processed across all updates (added + modified + deleted).
   *
   * @example 1234
   */
  totalFilesProcessed: number;

  /**
   * Total chunks modified across all updates (upserted + deleted).
   *
   * @example 5678
   */
  totalChunksModified: number;

  /**
   * Overall error rate (0.0 to 1.0).
   *
   * Ratio of failed or partial updates to total updates.
   *
   * @example 0.043 (4.3% error rate)
   */
  errorRate: number;

  /**
   * Overall success rate (0.0 to 1.0).
   *
   * Ratio of successful updates to total updates.
   *
   * @example 0.957 (95.7% success rate)
   */
  successRate: number;

  /**
   * Trend metrics for the last 7 days.
   *
   * Statistics filtered to updates within the past 7 days.
   */
  last7DaysTrend: TrendMetrics;
}

/**
 * Per-repository metrics summary.
 *
 * Provides aggregate statistics for a single repository's update history.
 *
 * @example
 * ```typescript
 * const repoMetrics: RepositoryMetrics = {
 *   repositoryName: "my-api",
 *   totalUpdates: 8,
 *   averageDurationMs: 1500,
 *   totalFilesProcessed: 42,
 *   totalChunksModified: 187,
 *   errorRate: 0.0,
 *   successRate: 1.0
 * };
 * ```
 */
export interface RepositoryMetrics {
  /**
   * Repository name.
   *
   * @example "my-api"
   */
  repositoryName: string;

  /**
   * Total incremental updates for this repository.
   *
   * @example 8
   */
  totalUpdates: number;

  /**
   * Average update duration in milliseconds.
   *
   * @example 1500 (1.5 seconds)
   */
  averageDurationMs: number;

  /**
   * Total files processed (added + modified + deleted).
   *
   * @example 42
   */
  totalFilesProcessed: number;

  /**
   * Total chunks modified (upserted + deleted).
   *
   * @example 187
   */
  totalChunksModified: number;

  /**
   * Error rate for this repository (0.0 to 1.0).
   *
   * @example 0.0 (0% error rate)
   */
  errorRate: number;

  /**
   * Success rate for this repository (0.0 to 1.0).
   *
   * @example 1.0 (100% success rate)
   */
  successRate: number;
}
