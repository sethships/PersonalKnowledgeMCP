/**
 * Status Command - List indexed repositories
 *
 * Shows all repositories indexed in the knowledge base with their status.
 */

/* eslint-disable no-console */

import chalk from "chalk";
import type { CliDependencies } from "../utils/dependency-init.js";
import {
  createRepositoryTable,
  formatRepositoriesJson,
  createMetricsTable,
  type RepositoryDisplayInfo,
} from "../output/formatters.js";
import { parseGitHubUrl } from "../../utils/git-url-parser.js";
import type { RepositoryInfo } from "../../repositories/types.js";
import { calculateAggregateMetrics } from "../../services/metrics-calculator.js";

/**
 * Status command options
 */
export interface StatusCommandOptions {
  json?: boolean;
  check?: boolean;
  metrics?: boolean;
}

/**
 * Execute status command
 *
 * Lists all indexed repositories with their metadata.
 * Supports JSON output format for programmatic use.
 * Optionally checks GitHub for available updates with --check flag.
 * Optionally displays aggregate metrics with --metrics flag.
 *
 * @param options - Command options
 * @param deps - CLI dependencies
 */
export async function statusCommand(
  options: StatusCommandOptions,
  deps: CliDependencies
): Promise<void> {
  // Fetch all repositories
  const repositories = await deps.repositoryService.listRepositories();

  // If --check option is provided, query GitHub for updates
  let displayRepos: RepositoryDisplayInfo[] = repositories;
  if (options.check) {
    displayRepos = await checkRepositoryUpdates(repositories, deps);
  }

  // Output as JSON if requested
  if (options.json) {
    if (options.metrics) {
      // Include metrics in JSON output (avoid double parse/stringify)
      const metrics = calculateAggregateMetrics(repositories);
      console.log(
        JSON.stringify(
          {
            totalRepositories: displayRepos.length,
            repositories: displayRepos.map((repo) => ({
              name: repo.name,
              url: repo.url,
              fileCount: repo.fileCount,
              chunkCount: repo.chunkCount,
              lastIndexedAt: repo.lastIndexedAt,
              indexDurationMs: repo.indexDurationMs,
              status: repo.status,
              branch: repo.branch,
              errorMessage: repo.errorMessage,
              lastIndexedCommitSha: repo.lastIndexedCommitSha,
              lastIncrementalUpdateAt: repo.lastIncrementalUpdateAt,
              incrementalUpdateCount: repo.incrementalUpdateCount,
              ...(repo.updateStatus && {
                updateCheck: {
                  remoteSha: repo.remoteSha,
                  status: repo.updateStatus,
                },
              }),
            })),
            metrics: {
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
          },
          null,
          2
        )
      );
    } else {
      console.log(formatRepositoriesJson(displayRepos));
    }
    return;
  }

  // Output as table (default)
  console.log(createRepositoryTable(displayRepos));

  // If --metrics option is provided, display aggregate metrics
  if (options.metrics) {
    const metrics = calculateAggregateMetrics(repositories);
    console.log(createMetricsTable(metrics));
  }

  console.log(); // Blank line for spacing
}

/**
 * Check repositories for available updates on GitHub
 *
 * @param repositories - List of repositories to check
 * @param deps - CLI dependencies
 * @returns Enhanced repository information with update status
 */
async function checkRepositoryUpdates(
  repositories: RepositoryInfo[],
  deps: CliDependencies
): Promise<RepositoryDisplayInfo[]> {
  if (repositories.length === 0) {
    return [];
  }

  console.log(
    chalk.gray(
      `\nChecking ${repositories.length} ${repositories.length === 1 ? "repository" : "repositories"} for updates...\n`
    )
  );

  const displayRepos: RepositoryDisplayInfo[] = [];
  const errors: string[] = [];

  for (const repo of repositories) {
    try {
      // Parse GitHub URL to extract owner/repo
      const parsed = parseGitHubUrl(repo.url);

      // If not a GitHub URL, mark as unknown
      if (!parsed) {
        displayRepos.push({
          ...repo,
          updateStatus: "unknown",
        });
        continue;
      }

      // If no lastIndexedCommitSha, we can't compare - mark as unknown
      if (!repo.lastIndexedCommitSha) {
        displayRepos.push({
          ...repo,
          updateStatus: "unknown",
        });
        continue;
      }

      // Fetch latest commit from GitHub
      const headCommit = await deps.githubClient.getHeadCommit(
        parsed.owner,
        parsed.repo,
        repo.branch
      );

      // Compare SHAs
      const updateStatus =
        headCommit.sha === repo.lastIndexedCommitSha ? "up-to-date" : "updates-available";

      displayRepos.push({
        ...repo,
        updateStatus,
        remoteSha: headCommit.sha,
      });
    } catch (error) {
      // Handle errors gracefully - don't fail entire command
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(`${repo.name}: ${errorMessage}`);

      displayRepos.push({
        ...repo,
        updateStatus: "error",
        checkError: errorMessage,
      });
    }
  }

  // Show warning summary if there were errors
  if (errors.length > 0) {
    console.log(
      chalk.yellow(
        `\n⚠ ${errors.length} ${errors.length === 1 ? "repository" : "repositories"} could not be checked:\n`
      )
    );
    for (const error of errors) {
      console.log(chalk.yellow(`  • ${error}`));
    }
    console.log();
  }

  return displayRepos;
}
