/**
 * Metrics Calculator Service
 *
 * Calculates aggregate metrics from repository update history.
 * All metrics are computed on-demand from existing update history data,
 * ensuring accuracy and consistency without maintaining separate state.
 *
 * @module services/metrics-calculator
 */

import type { RepositoryInfo, UpdateHistoryEntry } from "../repositories/types.js";
import type { AggregateMetrics, TrendMetrics, RepositoryMetrics } from "./metrics-types.js";

/**
 * Calculate aggregate metrics across all repositories.
 *
 * Computes comprehensive statistics from update history including:
 * - Total update count
 * - Average duration
 * - File and chunk processing totals
 * - Success and error rates
 * - Last 7-day trend

 *
 * @param repositories - List of all repositories with update history
 * @returns Aggregate metrics across all repositories
 *
 * @example
 * ```typescript
 * const repos = await repositoryService.listRepositories();
 * const metrics = calculateAggregateMetrics(repos);
 * console.log(`Total updates: ${metrics.totalUpdates}`);
 * console.log(`Success rate: ${(metrics.successRate * 100).toFixed(1)}%`);
 * ```
 */
export function calculateAggregateMetrics(repositories: RepositoryInfo[]): AggregateMetrics {
  // Collect all update history entries from all repositories
  const allHistoryEntries: UpdateHistoryEntry[] = [];
  for (const repo of repositories) {
    if (repo.updateHistory && repo.updateHistory.length > 0) {
      allHistoryEntries.push(...repo.updateHistory);
    }
  }

  // Handle empty history case
  if (allHistoryEntries.length === 0) {
    return {
      totalUpdates: 0,
      averageDurationMs: 0,
      totalFilesProcessed: 0,
      totalChunksModified: 0,
      errorRate: 0,
      successRate: 0,
      last7DaysTrend: {
        updateCount: 0,
        filesProcessed: 0,
        chunksModified: 0,
        averageDurationMs: 0,
        errorRate: 0,
      },
    };
  }

  // Calculate aggregate statistics
  let totalDurationMs = 0;
  let totalFilesProcessed = 0;
  let totalChunksModified = 0;
  let successfulUpdates = 0;
  let failedOrPartialUpdates = 0;

  for (const entry of allHistoryEntries) {
    totalDurationMs += entry.durationMs;
    totalFilesProcessed += entry.filesAdded + entry.filesModified + entry.filesDeleted;
    totalChunksModified += entry.chunksUpserted + entry.chunksDeleted;

    if (entry.status === "success") {
      successfulUpdates++;
    } else {
      failedOrPartialUpdates++;
    }
  }

  const totalUpdates = allHistoryEntries.length;
  const averageDurationMs = totalDurationMs / totalUpdates;
  const errorRate = failedOrPartialUpdates / totalUpdates;
  const successRate = successfulUpdates / totalUpdates;

  // Calculate 7-day trend
  const last7DaysTrend = calculateTrendMetrics(allHistoryEntries, 7);

  return {
    totalUpdates,
    averageDurationMs,
    totalFilesProcessed,
    totalChunksModified,
    errorRate,
    successRate,
    last7DaysTrend,
  };
}

/**
 * Calculate metrics for a specific repository.
 *
 * Computes statistics for a single repository's update history.
 *
 * @param repo - Repository with update history
 * @returns Repository-specific metrics
 *
 * @example
 * ```typescript
 * const repo = await repositoryService.getRepository("my-api");
 * if (repo) {
 *   const metrics = calculateRepositoryMetrics(repo);
 *   console.log(`${repo.name}: ${metrics.totalUpdates} updates`);
 * }
 * ```
 */
export function calculateRepositoryMetrics(repo: RepositoryInfo): RepositoryMetrics {
  const history = repo.updateHistory || [];

  if (history.length === 0) {
    return {
      repositoryName: repo.name,
      totalUpdates: 0,
      averageDurationMs: 0,
      totalFilesProcessed: 0,
      totalChunksModified: 0,
      errorRate: 0,
      successRate: 0,
    };
  }

  let totalDurationMs = 0;
  let totalFilesProcessed = 0;
  let totalChunksModified = 0;
  let successfulUpdates = 0;
  let failedOrPartialUpdates = 0;

  for (const entry of history) {
    totalDurationMs += entry.durationMs;
    totalFilesProcessed += entry.filesAdded + entry.filesModified + entry.filesDeleted;
    totalChunksModified += entry.chunksUpserted + entry.chunksDeleted;

    if (entry.status === "success") {
      successfulUpdates++;
    } else {
      failedOrPartialUpdates++;
    }
  }

  const totalUpdates = history.length;
  const averageDurationMs = totalDurationMs / totalUpdates;
  const errorRate = failedOrPartialUpdates / totalUpdates;
  const successRate = successfulUpdates / totalUpdates;

  return {
    repositoryName: repo.name,
    totalUpdates,
    averageDurationMs,
    totalFilesProcessed,
    totalChunksModified,
    errorRate,
    successRate,
  };
}

/**
 * Calculate trend metrics for a specific time period.
 *
 * Filters update history to entries within the specified number of days
 * from now and computes statistics for that period.
 *
 * @param history - Update history entries (from one or more repositories)
 * @param daysBack - Number of days to look back from now
 * @returns Trend metrics for the specified time period
 *
 * @example
 * ```typescript
 * const allHistory = repos.flatMap(r => r.updateHistory || []);
 * const weekTrend = calculateTrendMetrics(allHistory, 7);
 * console.log(`Last 7 days: ${weekTrend.updateCount} updates`);
 * ```
 */
export function calculateTrendMetrics(
  history: UpdateHistoryEntry[],
  daysBack: number
): TrendMetrics {
  // Calculate cutoff timestamp (daysBack days ago)
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysBack);
  const cutoffTimestamp = cutoffDate.toISOString();

  // Filter history to entries within the time period
  const recentHistory = history.filter((entry) => entry.timestamp >= cutoffTimestamp);

  // Handle empty filtered history
  if (recentHistory.length === 0) {
    return {
      updateCount: 0,
      filesProcessed: 0,
      chunksModified: 0,
      averageDurationMs: 0,
      errorRate: 0,
    };
  }

  // Calculate trend statistics
  let totalDurationMs = 0;
  let filesProcessed = 0;
  let chunksModified = 0;
  let failedOrPartialUpdates = 0;

  for (const entry of recentHistory) {
    totalDurationMs += entry.durationMs;
    filesProcessed += entry.filesAdded + entry.filesModified + entry.filesDeleted;
    chunksModified += entry.chunksUpserted + entry.chunksDeleted;

    if (entry.status !== "success") {
      failedOrPartialUpdates++;
    }
  }

  const updateCount = recentHistory.length;
  const averageDurationMs = totalDurationMs / updateCount;
  const errorRate = failedOrPartialUpdates / updateCount;

  return {
    updateCount,
    filesProcessed,
    chunksModified,
    averageDurationMs,
    errorRate,
  };
}
