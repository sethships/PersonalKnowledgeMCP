/**
 * Update All Command - Update all repositories with latest changes
 *
 * Triggers incremental updates for all repositories with status "ready".
 */

/* eslint-disable no-console */

import chalk from "chalk";
import ora from "ora";
import Table from "cli-table3";
import type { CliDependencies } from "../utils/dependency-init.js";
import type { CoordinatorResult } from "../../services/incremental-update-coordinator-types.js";

/**
 * Update all repositories command options
 */
export interface UpdateAllCommandOptions {
  json?: boolean;
}

/**
 * Result of updating a single repository
 */
interface UpdateResult {
  repository: string;
  result?: CoordinatorResult;
  error?: string;
}

/**
 * Format file changes as "+2 ~3 -1"
 */
function formatFileChanges(stats: CoordinatorResult["stats"]): string {
  const parts: string[] = [];
  if (stats.filesAdded > 0) parts.push(`+${stats.filesAdded}`);
  if (stats.filesModified > 0) parts.push(`~${stats.filesModified}`);
  if (stats.filesDeleted > 0) parts.push(`-${stats.filesDeleted}`);
  return parts.length > 0 ? parts.join(" ") : "-";
}

/**
 * Format chunk changes as "+15 -8"
 */
function formatChunkChanges(stats: CoordinatorResult["stats"]): string {
  const parts: string[] = [];
  if (stats.chunksUpserted > 0) parts.push(`+${stats.chunksUpserted}`);
  if (stats.chunksDeleted > 0) parts.push(`-${stats.chunksDeleted}`);
  return parts.length > 0 ? parts.join(" ") : "-";
}

/**
 * Create table for update-all results
 */
function createUpdateAllTable(
  results: UpdateResult[]
): InstanceType<typeof Table> {
  const table = new Table({
    head: [
      chalk.bold("Repository"),
      chalk.bold("Status"),
      chalk.bold("Commits"),
      chalk.bold("Files"),
      chalk.bold("Chunks"),
      chalk.bold("Duration"),
    ],
    colWidths: [20, 12, 15, 12, 12, 12],
  });

  for (const { repository, result, error } of results) {
    if (error) {
      table.push([
        repository,
        chalk.red("Failed"),
        chalk.gray("Error"),
        chalk.gray("-"),
        chalk.gray("-"),
        chalk.gray("-"),
      ]);
    } else if (!result) {
      table.push([
        repository,
        chalk.gray("Skipped"),
        chalk.gray("-"),
        chalk.gray("-"),
        chalk.gray("-"),
        chalk.gray("-"),
      ]);
    } else if (result.status === "no_changes") {
      table.push([
        repository,
        chalk.cyan("Current"),
        chalk.gray("-"),
        chalk.gray("-"),
        chalk.gray("-"),
        `${result.durationMs}ms`,
      ]);
    } else if (result.status === "updated") {
      const commitRange = result.commitSha ? result.commitSha.substring(0, 7) : "-";
      table.push([
        repository,
        chalk.green("Updated"),
        commitRange,
        formatFileChanges(result.stats),
        formatChunkChanges(result.stats),
        `${result.stats.durationMs}ms`,
      ]);
    } else if (result.status === "failed") {
      table.push([
        repository,
        chalk.red("Failed"),
        chalk.gray(`${result.errors.length} errors`),
        formatFileChanges(result.stats),
        formatChunkChanges(result.stats),
        `${result.stats.durationMs}ms`,
      ]);
    }
  }

  return table;
}

/**
 * Execute update-all command
 *
 * Updates all repositories with status "ready" sequentially.
 *
 * @param options - Command options
 * @param deps - CLI dependencies
 */
export async function updateAllCommand(
  options: UpdateAllCommandOptions,
  deps: CliDependencies
): Promise<void> {
  // Get all repositories with status "ready"
  const allRepos = await deps.repositoryService.listRepositories();
  const readyRepos = allRepos.filter((repo) => repo.status === "ready");

  if (readyRepos.length === 0) {
    console.log(chalk.yellow("No repositories with status 'ready' found"));
    console.log("\n" + chalk.bold("Next steps:"));
    console.log("  • Check repository status: " + chalk.gray("pk-mcp status"));
    console.log("  • Index a repository: " + chalk.gray("pk-mcp index <url>"));
    return;
  }

  console.log(chalk.bold(`\nUpdating ${readyRepos.length} repositories...\n`));

  const results: UpdateResult[] = [];

  // Update each repository sequentially
  for (const repo of readyRepos) {
    const spinner = ora({
      text: `Updating ${chalk.cyan(repo.name)}...`,
      spinner: "dots",
    }).start();

    try {
      const result = await deps.updateCoordinator.updateRepository(repo.name);

      // Stop spinner based on result
      if (result.status === "no_changes") {
        spinner.info(chalk.cyan(`${repo.name} is already up-to-date`));
      } else if (result.status === "updated") {
        if (result.errors.length > 0) {
          spinner.warn(chalk.yellow(`${repo.name} updated with ${result.errors.length} warnings`));
        } else {
          spinner.succeed(chalk.green(`${repo.name} updated`));
        }
      } else if (result.status === "failed") {
        spinner.fail(chalk.red(`${repo.name} failed`));
      }

      results.push({ repository: repo.name, result });
    } catch (error) {
      spinner.fail(chalk.red(`${repo.name} failed`));
      results.push({
        repository: repo.name,
        error: error instanceof Error ? error.message : String(error),
      });
      // Continue to next repository instead of failing entire batch
    }
  }

  // Display summary
  console.log(); // Blank line

  if (options.json) {
    const summary = {
      total: results.length,
      updated: results.filter((r) => r.result?.status === "updated").length,
      current: results.filter((r) => r.result?.status === "no_changes").length,
      failed: results.filter((r) => r.error || r.result?.status === "failed").length,
    };

    console.log(
      JSON.stringify(
        {
          summary,
          results: results.map((r) => ({
            repository: r.repository,
            status: r.error ? "error" : r.result?.status || "unknown",
            error: r.error,
            stats: r.result?.stats,
            durationMs: r.result?.durationMs,
          })),
        },
        null,
        2
      )
    );
  } else {
    console.log(createUpdateAllTable(results).toString());
    console.log(); // Blank line

    // Summary line
    const updated = results.filter((r) => r.result?.status === "updated").length;
    const current = results.filter((r) => r.result?.status === "no_changes").length;
    const failed = results.filter((r) => r.error || r.result?.status === "failed").length;

    const summaryParts: string[] = [];
    if (updated > 0) summaryParts.push(chalk.green(`${updated} updated`));
    if (current > 0) summaryParts.push(chalk.cyan(`${current} current`));
    if (failed > 0) summaryParts.push(chalk.red(`${failed} failed`));

    console.log(chalk.bold("Summary: ") + summaryParts.join(", "));
  }
}
