/**
 * Output Formatters for CLI
 *
 * Functions for formatting output as tables or JSON.
 */

import Table from "cli-table3";
import chalk from "chalk";
import type { RepositoryInfo } from "../../repositories/types.js";
import type { SearchResult } from "../../services/types.js";

/**
 * Truncate a string to a maximum length, adding ellipsis if truncated
 *
 * @param str - String to truncate
 * @param maxLength - Maximum length
 * @returns Truncated string with ellipsis if needed
 */
function truncate(str: string, maxLength: number): string {
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
