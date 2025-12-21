/**
 * Update Repository Command - Update a repository with latest changes
 *
 * Triggers incremental update for a repository or forces full re-index.
 */

/* eslint-disable no-console */

import chalk from "chalk";
import ora from "ora";
import type { CliDependencies } from "../utils/dependency-init.js";
import type { CoordinatorResult } from "../../services/incremental-update-coordinator-types.js";
import {
  clearInterruptedUpdateFlag,
  formatElapsedTime,
} from "../../services/interrupted-update-detector.js";

/**
 * Update repository command options
 */
export interface UpdateCommandOptions {
  force?: boolean;
  json?: boolean;
}

/**
 * Format file changes as "+2 ~3 -1"
 *
 * @param stats - Update statistics
 * @returns Formatted string
 */
function formatFileChanges(stats: CoordinatorResult["stats"]): string {
  const parts: string[] = [];
  if (stats.filesAdded > 0) parts.push(chalk.green(`+${stats.filesAdded}`));
  if (stats.filesModified > 0) parts.push(chalk.yellow(`~${stats.filesModified}`));
  if (stats.filesDeleted > 0) parts.push(chalk.red(`-${stats.filesDeleted}`));
  return parts.length > 0 ? parts.join(" ") : chalk.gray("no changes");
}

/**
 * Format chunk changes as "+15 -8"
 *
 * @param stats - Update statistics
 * @returns Formatted string
 */
function formatChunkChanges(stats: CoordinatorResult["stats"]): string {
  const parts: string[] = [];
  if (stats.chunksUpserted > 0) parts.push(chalk.green(`+${stats.chunksUpserted}`));
  if (stats.chunksDeleted > 0) parts.push(chalk.red(`-${stats.chunksDeleted}`));
  return parts.length > 0 ? parts.join(" ") : chalk.gray("no changes");
}

/**
 * Format commit range as "abc1234..def5678"
 *
 * @param baseSha - Base commit SHA (from metadata)
 * @param headSha - Head commit SHA
 * @returns Formatted commit range
 */
function formatCommitRange(baseSha: string | undefined, headSha: string): string {
  if (!baseSha) return headSha.substring(0, 7);
  return `${baseSha.substring(0, 7)}..${headSha.substring(0, 7)}`;
}

/**
 * Format update result as JSON
 *
 * @param repositoryName - Repository name
 * @param result - Coordinator result
 * @param baseSha - Base commit SHA for commit range
 * @returns JSON object
 */
function formatUpdateResultJson(
  repositoryName: string,
  result: CoordinatorResult,
  baseSha?: string
): object {
  return {
    repository: repositoryName,
    status: result.status,
    commitRange: baseSha
      ? formatCommitRange(baseSha, result.commitSha ?? "unknown")
      : result.commitSha?.substring(0, 7),
    commitMessage: result.commitMessage,
    stats: result.stats,
    errors: result.errors.map((e) => ({ path: e.path, error: e.error })),
    durationMs: result.durationMs,
  };
}

/**
 * Execute update repository command
 *
 * Updates a repository incrementally or forces full re-index.
 *
 * @param repositoryName - Repository name to update
 * @param options - Command options
 * @param deps - CLI dependencies
 */
export async function updateRepositoryCommand(
  repositoryName: string,
  options: UpdateCommandOptions,
  deps: CliDependencies
): Promise<void> {
  // Get repository metadata to access URL
  const repo = await deps.repositoryService.getRepository(repositoryName);
  if (!repo) {
    throw new Error(
      `Repository '${repositoryName}' not found.\n` +
        "Check indexed repositories: " +
        chalk.gray("pk-mcp status")
    );
  }

  // Handle force re-index
  if (options.force) {
    // Check if this is recovering from an interrupted update
    if (repo.updateInProgress) {
      const elapsed = repo.updateStartedAt
        ? formatElapsedTime(Date.now() - new Date(repo.updateStartedAt).getTime())
        : "unknown time";

      console.log(chalk.yellow(`⚠ Recovering from interrupted update (started ${elapsed} ago)`));

      // Clear the interrupted flag before re-indexing
      await clearInterruptedUpdateFlag(deps.repositoryService, repositoryName);
      console.log(chalk.gray("  Cleared interrupted update flag"));
    }

    const spinner = ora({
      text: `Force re-indexing ${chalk.cyan(repositoryName)}...`,
      spinner: "dots",
    }).start();

    try {
      const result = await deps.ingestionService.indexRepository(repo.url, {
        branch: repo.branch,
        force: true,
        onProgress: (progress) => {
          spinner.text = `Force re-indexing ${chalk.cyan(repositoryName)} - ${progress.phase}...`;
        },
      });

      if (result.status === "success" && result.stats) {
        spinner.succeed(chalk.green(`✓ Re-indexed ${repositoryName}`));

        if (options.json) {
          console.log(
            JSON.stringify(
              {
                repository: repositoryName,
                status: "re-indexed",
                fileCount: result.stats.filesProcessed,
                chunkCount: result.stats.chunksCreated,
                durationMs: result.stats.durationMs,
              },
              null,
              2
            )
          );
        } else {
          console.log(`  ${chalk.gray("Files:")} ${result.stats.filesProcessed}`);
          console.log(`  ${chalk.gray("Chunks:")} ${result.stats.chunksCreated}`);
          console.log(`  ${chalk.gray("Duration:")} ${result.stats.durationMs}ms`);
        }
      } else {
        spinner.fail(chalk.red(`✗ Re-index failed for ${repositoryName}`));
        throw new Error("Re-index failed");
      }
    } catch (error) {
      if (spinner.isSpinning) {
        spinner.fail(chalk.red(`✗ Re-index failed for ${repositoryName}`));
      }
      throw error;
    }
    return;
  }

  // Check for existing interrupted update and warn user
  if (repo.updateInProgress) {
    const elapsed = repo.updateStartedAt
      ? formatElapsedTime(Date.now() - new Date(repo.updateStartedAt).getTime())
      : "unknown time";
    console.log(chalk.yellow(`⚠ Repository has an interrupted update from ${elapsed} ago.`));
    console.log(chalk.yellow(`  Use --force to clear and re-index, or proceed with caution.`));
  }

  // Handle incremental update
  const spinner = ora({
    text: `Updating ${chalk.cyan(repositoryName)}...`,
    spinner: "dots",
  }).start();

  try {
    const result = await deps.updateCoordinator.updateRepository(repositoryName);

    // Handle no changes
    if (result.status === "no_changes") {
      spinner.info(chalk.cyan(`Repository ${repositoryName} is already up-to-date`));

      if (options.json) {
        console.log(
          JSON.stringify(
            formatUpdateResultJson(repositoryName, result, repo.lastIndexedCommitSha),
            null,
            2
          )
        );
      } else {
        console.log(`  ${chalk.gray("Commit:")} ${result.commitSha?.substring(0, 7)}`);
        console.log(`  ${chalk.gray("Message:")} ${result.commitMessage}`);
      }
      return;
    }

    // Handle updated status
    if (result.status === "updated") {
      spinner.succeed(chalk.green(`✓ Updated ${repositoryName}`));

      if (options.json) {
        console.log(
          JSON.stringify(
            formatUpdateResultJson(repositoryName, result, repo.lastIndexedCommitSha),
            null,
            2
          )
        );
      } else {
        console.log(
          `  ${chalk.gray("Commits:")} ${formatCommitRange(repo.lastIndexedCommitSha, result.commitSha ?? "unknown")} (${result.commitMessage ?? ""})`
        );
        console.log(`  ${chalk.gray("Files:")} ${formatFileChanges(result.stats)}`);
        console.log(`  ${chalk.gray("Chunks:")} ${formatChunkChanges(result.stats)}`);
        console.log(`  ${chalk.gray("Duration:")} ${result.stats.durationMs}ms`);
      }

      // Warn about partial failures
      if (result.errors.length > 0) {
        console.log(
          chalk.yellow(`\n⚠ Update completed with ${result.errors.length} file error(s)`)
        );
        if (!options.json) {
          console.log(chalk.gray("  First few errors:"));
          for (const error of result.errors.slice(0, 3)) {
            console.log(chalk.gray(`    • ${error.path}: ${error.error}`));
          }
          if (result.errors.length > 3) {
            console.log(chalk.gray(`    ... and ${result.errors.length - 3} more`));
          }
        }
      }
      return;
    }

    // Handle failed status
    if (result.status === "failed") {
      spinner.fail(chalk.red(`✗ Update failed for ${repositoryName}`));

      if (options.json) {
        console.log(
          JSON.stringify(
            formatUpdateResultJson(repositoryName, result, repo.lastIndexedCommitSha),
            null,
            2
          )
        );
      } else {
        console.log(chalk.red(`\n${result.errors.length} error(s) occurred during update`));
        console.log(chalk.gray("  First few errors:"));
        for (const error of result.errors.slice(0, 5)) {
          console.log(chalk.gray(`    • ${error.path}: ${error.error}`));
        }
        if (result.errors.length > 5) {
          console.log(chalk.gray(`    ... and ${result.errors.length - 5} more`));
        }
      }

      throw new Error(`Update failed with ${result.errors.length} errors`);
    }
  } catch (error) {
    if (spinner.isSpinning) {
      spinner.fail(chalk.red(`✗ Update failed for ${repositoryName}`));
    }
    throw error;
  }
}
