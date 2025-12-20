/**
 * Output Formatters for CLI
 *
 * Functions for formatting output as tables or JSON.
 */

import type { AggregateMetrics } from "../../services/metrics-types.js";

import Table from "cli-table3";
import chalk from "chalk";
import type { RepositoryInfo, UpdateHistoryEntry } from "../../repositories/types.js";
import type { SearchResult } from "../../services/types.js";

/**
 * Truncate a string to a maximum length, adding ellipsis if truncated
 *
 * @param str - String to truncate
 * @param maxLength - Maximum length
 * @returns Truncated string with ellipsis if needed
 */
function truncate(str: string, maxLength: number): string {
  if (maxLength < 4) return str.substring(0, maxLength);
  if (str.length <= maxLength) {
    return str;
  }
  return str.substring(0, maxLength - 3) + "...";
}

/**
 * Format a date string for display
 *
 * @param isoDate - ISO 8601 date string
 * @returns Formatted date string (YYYY-MM-DD HH:mm:ss)
 */
function formatDate(isoDate: string): string {
  try {
    const date = new Date(isoDate);
    return date.toISOString().replace("T", " ").substring(0, 19);
  } catch {
    return isoDate;
  }
}

/**
 * Get colored status indicator
 *
 * @param status - Repository status
 * @returns Colored status string
 */
function getStatusIndicator(status: string): string {
  switch (status) {
    case "ready":
      return chalk.green("✓ ready");
    case "indexing":
      return chalk.yellow("⟳ indexing");
    case "error":
      return chalk.red("✗ error");
    default:
      return status;
  }
}

/**
 * Format duration in milliseconds to human readable string
 *
 * @param ms - Duration in milliseconds
 * @returns Formatted duration string
 * @example
 * formatDuration(500) // "500ms"
 * formatDuration(2340) // "2.3s"
 * formatDuration(75000) // "1m 15s"
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/**
 * Format ISO timestamp as relative time from now
 *
 * Converts an ISO 8601 timestamp to a human-readable relative time string.
 * Handles past dates only - future dates are treated as "just now".
 *
 * @param isoDate - ISO 8601 timestamp string
 * @returns Formatted relative time string
 * @example
 * formatRelativeTime('2024-12-16T10:30:00Z') // "2h ago" (if now is 12:30)
 * formatRelativeTime('2024-12-15T10:00:00Z') // "1d ago"
 * formatRelativeTime('2024-11-16T10:00:00Z') // "Nov 16"
 */
function formatRelativeTime(isoDate: string): string {
  try {
    const date = new Date(isoDate);
    const now = new Date();

    // Handle invalid dates
    if (isNaN(date.getTime())) {
      return isoDate;
    }

    const diffMs = now.getTime() - date.getTime();

    // Future dates or same time
    if (diffMs < 0) {
      return "just now";
    }

    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);
    const diffWeeks = Math.floor(diffDays / 7);

    // Less than 1 minute
    if (diffSeconds < 60) {
      return "just now";
    }

    // Less than 60 minutes
    if (diffMinutes < 60) {
      return `${diffMinutes}m ago`;
    }

    // Less than 24 hours
    if (diffHours < 24) {
      return `${diffHours}h ago`;
    }

    // Less than 7 days
    if (diffDays < 7) {
      return `${diffDays}d ago`;
    }

    // Less than 30 days
    if (diffDays < 30) {
      return `${diffWeeks}w ago`;
    }

    // Less than 365 days - show "Mon DD"
    if (diffDays < 365) {
      const months = [
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec",
      ];
      return `${months[date.getMonth()]} ${date.getDate()}`;
    }

    // 365 days or more - show "MMM DD, YYYY"
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
  } catch {
    // Return original string on any error
    return isoDate;
  }
}

/**
 * Format Git SHA to short form
 *
 * Converts a full 40-character SHA to short 7-character form.
 * Returns "-" for undefined or empty SHAs.
 *
 * @param sha - Full Git commit SHA (40 characters) or undefined
 * @returns Short SHA (7 characters) or "-"
 * @example
 * formatShortSha('a1b2c3d4e5f6...') // "a1b2c3d"
 * formatShortSha(undefined) // "-"
 * formatShortSha('') // "-"
 */
function formatShortSha(sha: string | undefined): string {
  if (!sha || sha.length === 0) {
    return "-";
  }
  return sha.substring(0, 7);
}

/**
 * Format commit range with short SHAs
 *
 * @param previousCommit - Previous commit SHA (40 chars)
 * @param newCommit - New commit SHA (40 chars)
 * @returns Formatted commit range
 * @example
 * formatCommitRange("abc123...", "def456...") // "abc1234..def5678"
 */
function formatCommitRange(previousCommit: string, newCommit: string): string {
  return `${previousCommit.substring(0, 7)}..${newCommit.substring(0, 7)}`;
}

/**
 * Format file changes as "+2 ~3 -1"
 *
 * @param added - Files added count
 * @param modified - Files modified count
 * @param deleted - Files deleted count
 * @returns Formatted file changes string with colors
 */
function formatFileChanges(added: number, modified: number, deleted: number): string {
  const parts: string[] = [];
  if (added > 0) parts.push(chalk.green(`+${added}`));
  if (modified > 0) parts.push(chalk.yellow(`~${modified}`));
  if (deleted > 0) parts.push(chalk.red(`-${deleted}`));
  return parts.length > 0 ? parts.join(" ") : chalk.gray("0");
}

/**
 * Format chunk changes as "+15 -8"
 *
 * @param upserted - Chunks upserted count
 * @param deleted - Chunks deleted count
 * @returns Formatted chunk changes string with colors
 */
function formatChunkChanges(upserted: number, deleted: number): string {
  const parts: string[] = [];
  if (upserted > 0) parts.push(chalk.green(`+${upserted}`));
  if (deleted > 0) parts.push(chalk.red(`-${deleted}`));
  return parts.length > 0 ? parts.join(" ") : chalk.gray("0");
}

/**
 * Get colored status indicator for update history
 *
 * @param status - Update status
 * @param errorCount - Number of errors
 * @returns Colored status string
 */
function getUpdateStatusIndicator(
  status: "success" | "partial" | "failed",
  errorCount: number
): string {
  switch (status) {
    case "success":
      return chalk.green("✓ success");
    case "partial":
      return chalk.yellow(`⚠ partial (${errorCount} errors)`);
    case "failed":
      return chalk.red(`✗ failed (${errorCount} errors)`);
    default:
      return status;
  }
}

/**
 * Enhanced repository info with update status for display
 */
export interface RepositoryDisplayInfo extends RepositoryInfo {
  updateStatus?: "up-to-date" | "updates-available" | "unknown" | "error";
  remoteSha?: string;
  checkError?: string;
}

/**
 * Get enhanced status indicator (when --check is used)
 *
 * @param updateStatus - Update check status
 * @returns Colored status string
 */
function getEnhancedStatusIndicator(updateStatus: RepositoryDisplayInfo["updateStatus"]): string {
  switch (updateStatus) {
    case "up-to-date":
      return chalk.green("✓ up-to-date");
    case "updates-available":
      return chalk.yellow("⚠ updates available");
    case "unknown":
      return chalk.gray("? unknown");
    case "error":
      return chalk.red("✗ error");
    default:
      return chalk.gray("-");
  }
}

/**
 * Create a formatted table of repositories
 *
 * @param repositories - List of repository information
 * @returns Formatted table string ready to print
 */
export function createRepositoryTable(
  repositories: RepositoryInfo[] | RepositoryDisplayInfo[]
): string {
  if (repositories.length === 0) {
    return (
      chalk.yellow("No repositories indexed yet.") +
      "\n\n" +
      chalk.bold("Get started:") +
      "\n  " +
      chalk.gray("pk-mcp index <repository-url>") +
      "\n\n" +
      chalk.bold("Example:") +
      "\n  " +
      chalk.gray("pk-mcp index https://github.com/user/my-project.git")
    );
  }

  // Check if any repository has updateStatus (--check was used)
  const hasUpdateCheck = repositories.some(
    (repo) => "updateStatus" in repo && repo.updateStatus !== undefined
  );

  const table = new Table({
    head: [
      chalk.cyan("Repository"),
      chalk.cyan("Files"),
      chalk.cyan("Chunks"),
      chalk.cyan("Last Commit"),
      chalk.cyan("Last Update"),
      chalk.cyan("Updates"),
      chalk.cyan("Status"),
    ],
    colAligns: ["left", "right", "right", "left", "left", "right", "left"],
    colWidths: [20, 8, 8, 10, 15, 8, 20],
    style: {
      head: [],
      border: ["gray"],
    },
  });

  for (const repo of repositories) {
    const displayRepo = repo as RepositoryDisplayInfo;

    // Determine which timestamp to use for "Last Update"
    const updateTime = repo.lastIncrementalUpdateAt || repo.lastIndexedAt;

    // Determine status indicator
    let statusIndicator: string;
    if (hasUpdateCheck && displayRepo.updateStatus) {
      // Use enhanced status if --check was used
      statusIndicator = getEnhancedStatusIndicator(displayRepo.updateStatus);
    } else {
      // Use regular status
      statusIndicator = getStatusIndicator(repo.status);
    }

    table.push([
      truncate(repo.name, 18),
      repo.fileCount.toString(),
      repo.chunkCount.toString(),
      formatShortSha(repo.lastIndexedCommitSha),
      formatRelativeTime(updateTime),
      repo.incrementalUpdateCount !== undefined ? repo.incrementalUpdateCount.toString() : "-",
      statusIndicator,
    ]);
  }

  const summary = chalk.bold(`\nIndexed Repositories (${repositories.length} total)\n`);
  return summary + table.toString();
}

/**
 * Create a formatted table of search results
 *
 * @param results - List of search results
 * @param queryTimeMs - Total query time in milliseconds
 * @returns Formatted table string ready to print
 */
export function createSearchResultsTable(results: SearchResult[], queryTimeMs: number): string {
  if (results.length === 0) {
    return (
      chalk.yellow("No results found.") +
      "\n\n" +
      chalk.bold("Tips:") +
      "\n  • Try a different query" +
      "\n  • Lower the similarity threshold: " +
      chalk.gray("--threshold 0.5") +
      "\n  • Check indexed repositories: " +
      chalk.gray("pk-mcp status")
    );
  }

  const table = new Table({
    head: [
      chalk.cyan("#"),
      chalk.cyan("Repository"),
      chalk.cyan("File"),
      chalk.cyan("Snippet"),
      chalk.cyan("Score"),
    ],
    colAligns: ["right", "left", "left", "left", "right"],
    style: {
      head: [],
      border: ["gray"],
    },
  });

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (!result) continue; // Skip undefined entries

    const score = (result.similarity_score * 100).toFixed(0);

    table.push([
      (i + 1).toString(),
      truncate(result.repository, 20),
      truncate(result.file_path, 30),
      truncate(result.content_snippet, 60),
      chalk.green(`${score}%`),
    ]);
  }

  const header = chalk.bold(
    `\nFound ${results.length} result${results.length === 1 ? "" : "s"} in ${queryTimeMs}ms\n`
  );
  return header + table.toString();
}

/**
 * Format repositories as JSON
 *
 * @param repositories - List of repository information
 * @returns Pretty-printed JSON string
 */
export function formatRepositoriesJson(
  repositories: RepositoryInfo[] | RepositoryDisplayInfo[]
): string {
  return JSON.stringify(
    {
      totalRepositories: repositories.length,
      repositories: repositories.map((repo) => {
        const displayRepo = repo as RepositoryDisplayInfo;
        const baseInfo = {
          name: repo.name,
          url: repo.url,
          fileCount: repo.fileCount,
          chunkCount: repo.chunkCount,
          lastIndexedAt: repo.lastIndexedAt,
          indexDurationMs: repo.indexDurationMs,
          status: repo.status,
          branch: repo.branch,
          errorMessage: repo.errorMessage,
          // Add update fields if they exist
          lastIndexedCommitSha: repo.lastIndexedCommitSha,
          lastIncrementalUpdateAt: repo.lastIncrementalUpdateAt,
          incrementalUpdateCount: repo.incrementalUpdateCount,
        };

        // Add update check info if present
        if (displayRepo.updateStatus) {
          return {
            ...baseInfo,
            updateCheck: {
              remoteSha: displayRepo.remoteSha,
              status: displayRepo.updateStatus,
              error: displayRepo.checkError,
              checkedAt: new Date().toISOString(),
            },
          };
        }

        return baseInfo;
      }),
    },
    null,
    2
  );
}

/**
 * Format search results as JSON
 *
 * @param query - The search query
 * @param results - List of search results
 * @param queryTimeMs - Total query time in milliseconds
 * @param embeddingTimeMs - Embedding generation time
 * @param searchTimeMs - Vector search time
 * @param repositoriesSearched - List of repositories searched
 * @returns Pretty-printed JSON string
 */
export function formatSearchResultsJson(
  query: string,
  results: SearchResult[],
  queryTimeMs: number,
  embeddingTimeMs: number,
  searchTimeMs: number,
  repositoriesSearched: string[]
): string {
  return JSON.stringify(
    {
      query,
      totalMatches: results.length,
      queryTimeMs,
      embeddingTimeMs,
      searchTimeMs,
      repositoriesSearched,
      results: results.map((result, index) => ({
        rank: index + 1,
        repository: result.repository,
        filePath: result.file_path,
        contentSnippet: result.content_snippet,
        similarityScore: result.similarity_score,
        chunkIndex: result.chunk_index,
        metadata: result.metadata,
      })),
    },
    null,
    2
  );
}

/**
 * Create a formatted table of repository update history
 *
 * @param repositoryName - Repository name
 * @param history - List of update history entries (newest first)
 * @param repoInfo - Repository info for context
 * @returns Formatted table string ready to print
 */
export function createHistoryTable(
  repositoryName: string,
  history: UpdateHistoryEntry[],
  repoInfo: RepositoryInfo
): string {
  // Handle empty history
  if (history.length === 0) {
    return (
      chalk.yellow(`No update history found for ${chalk.cyan(repositoryName)}.`) +
      "\n\n" +
      chalk.bold("Repository status:") +
      "\n  " +
      chalk.gray(`Last indexed: ${formatDate(repoInfo.lastIndexedAt)}`) +
      "\n  " +
      chalk.gray(`File count: ${repoInfo.fileCount}`) +
      "\n  " +
      chalk.gray(`Chunk count: ${repoInfo.chunkCount}`) +
      "\n\n" +
      chalk.bold("Note:") +
      "\n  " +
      chalk.gray("Update history is recorded only for incremental updates.") +
      "\n  " +
      chalk.gray("Trigger an update: ") +
      chalk.cyan(`pk-mcp update ${repositoryName}`)
    );
  }

  const table = new Table({
    head: [
      chalk.cyan("Timestamp"),
      chalk.cyan("Commits"),
      chalk.cyan("Files"),
      chalk.cyan("Chunks"),
      chalk.cyan("Duration"),
      chalk.cyan("Status"),
    ],
    colAligns: ["left", "left", "left", "left", "right", "left"],
    colWidths: [20, 20, 15, 12, 10, 25],
    style: {
      head: [],
      border: ["gray"],
    },
  });

  for (const entry of history) {
    table.push([
      formatDate(entry.timestamp),
      formatCommitRange(entry.previousCommit, entry.newCommit),
      formatFileChanges(entry.filesAdded, entry.filesModified, entry.filesDeleted),
      formatChunkChanges(entry.chunksUpserted, entry.chunksDeleted),
      formatDuration(entry.durationMs),
      getUpdateStatusIndicator(entry.status, entry.errorCount),
    ]);
  }

  const header = chalk.bold(
    `\nUpdate History for ${chalk.cyan(repositoryName)} (${history.length} ${
      history.length === 1 ? "entry" : "entries"
    })\n`
  );
  return header + table.toString();
}

/**
 * Format update history as JSON
 *
 * @param repositoryName - Repository name
 * @param history - List of update history entries
 * @param repoInfo - Repository info for context
 * @returns Pretty-printed JSON string
 */
export function formatHistoryJson(
  repositoryName: string,
  history: UpdateHistoryEntry[],
  repoInfo: RepositoryInfo
): string {
  return JSON.stringify(
    {
      repository: repositoryName,
      totalEntries: history.length,
      repositoryInfo: {
        lastIndexedAt: repoInfo.lastIndexedAt,
        fileCount: repoInfo.fileCount,
        chunkCount: repoInfo.chunkCount,
        status: repoInfo.status,
      },
      history: history.map((entry) => ({
        timestamp: entry.timestamp,
        commitRange: formatCommitRange(entry.previousCommit, entry.newCommit),
        previousCommit: entry.previousCommit,
        newCommit: entry.newCommit,
        files: {
          added: entry.filesAdded,
          modified: entry.filesModified,
          deleted: entry.filesDeleted,
        },
        chunks: {
          upserted: entry.chunksUpserted,
          deleted: entry.chunksDeleted,
        },
        durationMs: entry.durationMs,
        errorCount: entry.errorCount,
        status: entry.status,
      })),
    },
    null,
    2
  );
}

/**
 * Create a formatted table of aggregate metrics
 *
 * Displays comprehensive metrics across all repositories including
 * totals, averages, success rates, and 7-day trends.
 *
 * @param metrics - Aggregate metrics to display
 * @returns Formatted table string ready to print
 */
export function createMetricsTable(metrics: AggregateMetrics): string {
  if (metrics.totalUpdates === 0) {
    return (
      chalk.yellow("\nNo update history available yet.") +
      "\n\n" +
      chalk.bold("Note:") +
      "\n  " +
      chalk.gray("Metrics are calculated from incremental update history.") +
      "\n  " +
      chalk.gray("Perform updates to start tracking metrics: ") +
      chalk.cyan("pk-mcp update <repository>")
    );
  }

  const table = new Table({
    head: [chalk.cyan("Metric"), chalk.cyan("Value")],
    colAligns: ["left", "right"],
    colWidths: [30, 20],
    style: {
      head: [],
      border: ["gray"],
    },
  });

  // All-time metrics
  table.push(
    [chalk.bold("All-Time Metrics"), ""],
    ["Total Updates", metrics.totalUpdates.toString()],
    ["Avg Duration", formatDuration(metrics.averageDurationMs)],
    ["Total Files Processed", metrics.totalFilesProcessed.toLocaleString()],
    ["Total Chunks Modified", metrics.totalChunksModified.toLocaleString()],
    [
      "Success Rate",
      metrics.successRate > 0
        ? chalk.green(`${(metrics.successRate * 100).toFixed(1)}%`)
        : chalk.gray("0%"),
    ],
    [
      "Error Rate",
      metrics.errorRate > 0
        ? chalk.yellow(`${(metrics.errorRate * 100).toFixed(1)}%`)
        : chalk.green("0%"),
    ]
  );

  // 7-day trend section
  if (metrics.last7DaysTrend.updateCount > 0) {
    table.push(
      ["", ""], // Blank row for separation
      [chalk.bold("Last 7 Days"), ""],
      ["Updates", metrics.last7DaysTrend.updateCount.toString()],
      ["Files Processed", metrics.last7DaysTrend.filesProcessed.toLocaleString()],
      ["Chunks Modified", metrics.last7DaysTrend.chunksModified.toLocaleString()],
      ["Avg Duration", formatDuration(metrics.last7DaysTrend.averageDurationMs)],
      [
        "Error Rate",
        metrics.last7DaysTrend.errorRate > 0
          ? chalk.yellow(`${(metrics.last7DaysTrend.errorRate * 100).toFixed(1)}%`)
          : chalk.green("0%"),
      ]
    );
  } else {
    table.push(
      ["", ""], // Blank row for separation
      [chalk.bold("Last 7 Days"), chalk.gray("No updates")]
    );
  }

  const header = chalk.bold("\nAggregate Update Metrics\n");
  return header + table.toString();
}

/**
 * Format aggregate metrics as JSON
 *
 * @param metrics - Aggregate metrics
 * @returns Pretty-printed JSON string
 */
export function formatMetricsJson(metrics: AggregateMetrics): string {
  return JSON.stringify(
    {
      allTime: {
        totalUpdates: metrics.totalUpdates,
        averageDurationMs: metrics.averageDurationMs,
        totalFilesProcessed: metrics.totalFilesProcessed,
        totalChunksModified: metrics.totalChunksModified,
        successRate: metrics.successRate,
        errorRate: metrics.errorRate,
      },
      last7Days: {
        updateCount: metrics.last7DaysTrend.updateCount,
        filesProcessed: metrics.last7DaysTrend.filesProcessed,
        chunksModified: metrics.last7DaysTrend.chunksModified,
        averageDurationMs: metrics.last7DaysTrend.averageDurationMs,
        errorRate: metrics.last7DaysTrend.errorRate,
      },
    },
    null,
    2
  );
}
