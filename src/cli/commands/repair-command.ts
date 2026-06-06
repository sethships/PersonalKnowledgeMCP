/**
 * Repair Command - Targeted re-index for incomplete repository indexes
 *
 * Diagnoses an index by diffing eligible files on disk against the files
 * actually present in the vector store, then either re-embeds only the missing
 * files or corrects drifted `fileCount` metadata. This recovers small
 * completeness gaps without the full re-clone + re-embed that `update --force`
 * performs.
 *
 * @module cli/commands/repair-command
 */

/* eslint-disable no-console */

import chalk from "chalk";
import ora from "ora";
import type { CliDependencies } from "../utils/dependency-init.js";
import { IndexRepairService } from "../../services/index-repair-service.js";
import { IndexCompletenessChecker } from "../../services/index-completeness-checker.js";
import type { RepairResult } from "../../services/index-repair-service.js";

/**
 * Repair command options.
 */
export interface RepairCommandOptions {
  dryRun?: boolean;
  json?: boolean;
}

/**
 * Format the repair result as a JSON-friendly object.
 */
function formatResultJson(result: RepairResult): object {
  return {
    repository: result.repository,
    status: result.status,
    action: result.action,
    dryRun: result.dryRun,
    eligibleFiles: result.eligibleFileCount,
    indexedFiles: result.indexedFileCount,
    storedFileCount: result.storedFileCount,
    missingFileCount: result.missingFiles.length,
    missingFiles: result.missingFiles,
    extraFileCount: result.extraFiles.length,
    extraFiles: result.extraFiles,
    filesBackfilled: result.filesBackfilled,
    chunksUpserted: result.chunksUpserted,
    backfillErrorCount: result.backfillErrors.length,
    backfillErrors: result.backfillErrors,
    ...(result.completenessAfter && {
      completenessAfter: result.completenessAfter.status,
    }),
  };
}

/**
 * Human-readable label for a repair status.
 */
function statusLabel(status: RepairResult["status"]): string {
  switch (status) {
    case "complete":
      return chalk.green("complete");
    case "metadata_drift":
      return chalk.yellow("metadata drift");
    case "missing_files":
      return chalk.yellow("missing files");
  }
}

/**
 * Execute the repair command.
 *
 * @param repositoryName - Repository to repair
 * @param options - Command options (dryRun, json)
 * @param deps - CLI dependencies
 */
export async function repairCommand(
  repositoryName: string,
  options: RepairCommandOptions,
  deps: CliDependencies
): Promise<void> {
  const repo = await deps.repositoryService.getRepository(repositoryName);
  if (!repo) {
    console.error(chalk.red(`Repository '${repositoryName}' not found.`));
    console.error(chalk.gray("List indexed repositories: ") + chalk.cyan("pk-mcp status"));
    process.exit(1);
  }

  const service = new IndexRepairService(
    deps.fileScanner,
    deps.chromaClient,
    deps.updatePipeline,
    deps.repositoryService,
    new IndexCompletenessChecker(deps.fileScanner)
  );

  const dryRun = options.dryRun ?? false;
  const spinner = ora({
    text: `${dryRun ? "Diagnosing" : "Repairing"} ${chalk.cyan(repositoryName)}...`,
    spinner: "dots",
  }).start();

  let result: RepairResult;
  try {
    result = await service.repair(repo, { dryRun });
  } catch (error) {
    spinner.fail(chalk.red(`✗ Repair failed for ${repositoryName}`));
    throw error;
  }

  if (result.status === "complete") {
    spinner.succeed(chalk.green(`✓ ${repositoryName} index is complete`));
  } else if (dryRun) {
    spinner.warn(chalk.yellow(`⚠ ${repositoryName}: ${result.status.replace("_", " ")} detected`));
  } else if (result.action === "backfilled" && result.backfillErrors.length > 0) {
    // Partial success: some files failed to embed, so the index is not fully
    // healed. Warn rather than report unqualified success.
    spinner.warn(
      chalk.yellow(
        `⚠ ${repositoryName}: backfilled ${result.filesBackfilled} file(s), ` +
          `but ${result.backfillErrors.length} failed to embed`
      )
    );
  } else if (result.action === "backfilled") {
    spinner.succeed(
      chalk.green(`✓ Backfilled ${result.filesBackfilled} file(s) in ${repositoryName}`)
    );
  } else if (result.action === "metadata_repaired") {
    spinner.succeed(chalk.green(`✓ Repaired metadata for ${repositoryName} (no re-embed)`));
  } else {
    spinner.info(chalk.cyan(`${repositoryName}: no action taken`));
  }

  if (options.json) {
    console.log(JSON.stringify(formatResultJson(result), null, 2));
    return;
  }

  console.log("");
  console.log(`  ${chalk.gray("Status:")} ${statusLabel(result.status)}`);
  console.log(`  ${chalk.gray("Eligible on disk:")} ${result.eligibleFileCount}`);
  console.log(`  ${chalk.gray("Indexed:")} ${result.indexedFileCount}`);
  console.log(`  ${chalk.gray("Stored fileCount:")} ${result.storedFileCount}`);

  if (result.missingFiles.length > 0) {
    console.log(`  ${chalk.gray("Missing:")} ${result.missingFiles.length}`);
    const preview = result.missingFiles.slice(0, 10);
    for (const f of preview) {
      console.log(chalk.gray(`    • ${f}`));
    }
    if (result.missingFiles.length > preview.length) {
      console.log(chalk.gray(`    ... and ${result.missingFiles.length - preview.length} more`));
    }
  }

  if (result.extraFiles.length > 0) {
    const verb = dryRun ? "Orphaned (to remove):" : "Orphans removed:";
    console.log(`  ${chalk.gray(verb)} ${result.extraFiles.length}`);
    const preview = result.extraFiles.slice(0, 10);
    for (const f of preview) {
      console.log(chalk.gray(`    • ${f}`));
    }
    if (result.extraFiles.length > preview.length) {
      console.log(chalk.gray(`    ... and ${result.extraFiles.length - preview.length} more`));
    }
  }

  if (!dryRun && result.action === "backfilled") {
    console.log(`  ${chalk.gray("Chunks upserted:")} ${result.chunksUpserted}`);
  }

  if (result.backfillErrors.length > 0) {
    console.log(chalk.yellow(`  Failed to embed: ${result.backfillErrors.length}`));
    for (const f of result.backfillErrors.slice(0, 10)) {
      console.log(chalk.yellow(`    • ${f}`));
    }
    console.log(
      chalk.cyan(`  Index still incomplete — re-run `) +
        chalk.bold(`pk-mcp repair ${repositoryName}`)
    );
  }

  if (result.completenessAfter) {
    const after = result.completenessAfter.status;
    const colored = after === "complete" ? chalk.green(after) : chalk.yellow(after);
    console.log(`  ${chalk.gray("Completeness after:")} ${colored}`);
  }

  if (dryRun && result.status !== "complete") {
    console.log(
      chalk.cyan(`\n  Re-run without --dry-run to apply: `) +
        chalk.bold(`pk-mcp repair ${repositoryName}`)
    );
  }

  console.log("");
}
