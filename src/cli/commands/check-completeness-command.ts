/**
 * Check-Completeness Command - Validate index completeness for repositories
 *
 * Compares stored file counts against actual eligible files on disk to detect
 * incomplete indexes that may have diverged during incremental updates.
 *
 * @module cli/commands/check-completeness-command
 */

/* eslint-disable no-console */

import chalk from "chalk";
import type { CliDependencies } from "../utils/dependency-init.js";
import { IndexCompletenessChecker } from "../../services/index-completeness-checker.js";
import { FileScanner } from "../../ingestion/file-scanner.js";
import type { CompletenessCheckResult } from "../../services/index-completeness-types.js";

/**
 * Check-completeness command options
 */
export interface CheckCompletenessCommandOptions {
  json?: boolean;
}

/**
 * Status icon for completeness check result
 */
function getStatusIcon(status: CompletenessCheckResult["status"]): string {
  switch (status) {
    case "complete":
      return chalk.green("OK");
    case "incomplete":
      return chalk.yellow("INCOMPLETE");
    case "error":
      return chalk.red("ERROR");
  }
}

/**
 * Execute check-completeness command
 *
 * Checks one or all repositories for index completeness by comparing
 * stored file count against actual eligible files on disk.
 *
 * @param repositoryName - Optional repository name (checks all if omitted)
 * @param options - Command options
 * @param deps - CLI dependencies
 */
export async function checkCompletenessCommand(
  repositoryName: string | undefined,
  options: CheckCompletenessCommandOptions,
  deps: CliDependencies
): Promise<void> {
  const fileScanner = new FileScanner();
  const checker = new IndexCompletenessChecker(fileScanner);

  // Get repositories to check
  let repoNames: string[];
  if (repositoryName) {
    const repo = await deps.repositoryService.getRepository(repositoryName);
    if (!repo) {
      console.error(chalk.red(`Repository '${repositoryName}' not found.`));
      process.exit(1);
    }
    repoNames = [repositoryName];
  } else {
    const repos = await deps.repositoryService.listRepositories();
    if (repos.length === 0) {
      console.log("No indexed repositories found.");
      return;
    }
    repoNames = repos.map((r) => r.name);
  }

  // Run completeness checks
  const results: Array<{ name: string; result: CompletenessCheckResult }> = [];
  for (const name of repoNames) {
    const repo = await deps.repositoryService.getRepository(name);
    if (!repo) continue;
    const result = await checker.checkCompleteness(repo);
    results.push({ name, result });
  }

  // Output results
  if (options.json) {
    const jsonOutput = results.map(({ name, result }) => ({
      repository: name,
      status: result.status,
      indexed_files: result.indexedFileCount,
      eligible_files: result.eligibleFileCount,
      missing_files: result.missingFileCount,
      divergence_percent: result.divergencePercent,
      duration_ms: result.durationMs,
      ...(result.errorMessage && { error: result.errorMessage }),
    }));
    console.log(JSON.stringify(jsonOutput, null, 2));
  } else {
    // Table output
    console.log("");
    console.log(chalk.bold("Index Completeness Report"));
    console.log("=".repeat(90));
    console.log(
      chalk.gray(
        padRight("Status", 14) +
          padRight("Repository", 25) +
          padRight("Indexed", 10) +
          padRight("Eligible", 10) +
          padRight("Missing", 10) +
          padRight("Divergence", 12)
      )
    );
    console.log("-".repeat(90));

    for (const { name, result } of results) {
      const icon = getStatusIcon(result.status);
      const divergence =
        result.status === "error"
          ? chalk.red(result.errorMessage ?? "unknown error")
          : `${result.divergencePercent}%`;

      console.log(
        padRight(icon, 14) +
          padRight(name, 25) +
          padRight(String(result.indexedFileCount), 10) +
          padRight(String(result.eligibleFileCount), 10) +
          padRight(String(result.missingFileCount), 10) +
          padRight(divergence, 12)
      );
    }

    console.log("");
  }

  // Exit code 1 if any repository is incomplete (useful for CI)
  const hasIncomplete = results.some((r) => r.result.status === "incomplete");
  if (hasIncomplete) {
    process.exit(1);
  }
}

/**
 * Pad string to the right with spaces
 */
function padRight(str: string, width: number): string {
  // Strip ANSI codes for length calculation
  // eslint-disable-next-line no-control-regex
  const stripped = str.replace(/\x1b\[[0-9;]*m/g, "");
  const padding = Math.max(0, width - stripped.length);
  return str + " ".repeat(padding);
}
