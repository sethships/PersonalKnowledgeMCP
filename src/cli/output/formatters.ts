/**
 * Output Formatters for CLI
 *
 * Functions for formatting output as tables or JSON.
 */

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
 * Create a formatted table of repositories
 *
 * @param repositories - List of repository information
 * @returns Formatted table string ready to print
 */
export function createRepositoryTable(repositories: RepositoryInfo[]): string {
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

  const table = new Table({
    head: [
      chalk.cyan("Repository"),
      chalk.cyan("URL"),
      chalk.cyan("Files"),
      chalk.cyan("Chunks"),
      chalk.cyan("Last Indexed"),
      chalk.cyan("Status"),
    ],
    colAligns: ["left", "left", "right", "right", "left", "left"],
    style: {
      head: [],
      border: ["gray"],
    },
  });

  for (const repo of repositories) {
    table.push([
      repo.name,
      truncate(repo.url, 40),
      repo.fileCount.toString(),
      repo.chunkCount.toString(),
      formatDate(repo.lastIndexedAt),
      getStatusIndicator(repo.status),
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
export function formatRepositoriesJson(repositories: RepositoryInfo[]): string {
  return JSON.stringify(
    {
      totalRepositories: repositories.length,
      repositories: repositories.map((repo) => ({
        name: repo.name,
        url: repo.url,
        fileCount: repo.fileCount,
        chunkCount: repo.chunkCount,
        lastIndexedAt: repo.lastIndexedAt,
        indexDurationMs: repo.indexDurationMs,
        status: repo.status,
        branch: repo.branch,
        errorMessage: repo.errorMessage,
      })),
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
