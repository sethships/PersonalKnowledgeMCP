/**
 * Remove Command - Remove a repository from the index
 *
 * Removes repository embeddings, metadata, and optionally local files.
 */

/* eslint-disable no-console */

import chalk from "chalk";
import { rm } from "fs/promises";
import { existsSync } from "fs";
import { resolve } from "path";
import type { CliDependencies } from "../utils/dependency-init.js";
import { confirm } from "../utils/prompts.js";
import { createRemoveSpinner, completeRemoveSpinner } from "../output/progress.js";

/**
 * Remove command options
 */
export interface RemoveCommandOptions {
  force?: boolean;
  deleteFiles?: boolean;
}

/**
 * Execute remove command
 *
 * Removes a repository from the knowledge base after confirmation.
 * Optionally deletes local repository files.
 *
 * @param repositoryName - Name of the repository to remove
 * @param options - Command options
 * @param deps - CLI dependencies
 */
export async function removeCommand(
  repositoryName: string,
  options: RemoveCommandOptions,
  deps: CliDependencies
): Promise<void> {
  // Check if repository exists
  const repo = await deps.repositoryService.getRepository(repositoryName);
  if (!repo) {
    throw new Error(
      `Repository '${repositoryName}' not found.\nRun 'pk-mcp status' to see indexed repositories.`
    );
  }

  // Interactive confirmation (unless --force)
  if (!options.force) {
    console.log(chalk.yellow(`\nRemove repository '${chalk.cyan(repositoryName)}'?\n`));
    console.log("This will delete:");
    console.log("  • Vector embeddings from ChromaDB");
    console.log("  • Repository metadata");
    if (options.deleteFiles) {
      console.log("  • Local repository files");
    }
    console.log();

    const confirmed = await confirm("Type 'yes' to confirm:");

    if (!confirmed) {
      console.log(chalk.gray("\nOperation cancelled."));
      return;
    }
  }

  // Create spinner
  const spinner = createRemoveSpinner(repositoryName);

  try {
    // Remove from ingestion service (deletes ChromaDB collection and metadata)
    await deps.ingestionService.removeRepository(repositoryName);

    // Delete local files if requested
    let filesDeleted = false;
    if (options.deleteFiles && repo.localPath && existsSync(repo.localPath)) {
      try {
        // Defensive: Ensure path is within expected clone directory
        const clonePath = resolve(Bun.env["CLONE_PATH"] || "./data/repositories");
        const repoPath = resolve(repo.localPath);

        if (!repoPath.startsWith(clonePath)) {
          throw new Error(
            `Security: Repository path '${repo.localPath}' is outside expected clone directory '${clonePath}'`
          );
        }

        // Recursively remove directory
        await rm(repo.localPath, { recursive: true, force: true });
        filesDeleted = true;
      } catch (error) {
        // Log warning but don't fail the entire operation
        spinner.warn(
          chalk.yellow(
            `Repository removed, but failed to delete local files at ${repo.localPath}`
          ) +
            "\n  " +
            chalk.gray(error instanceof Error ? error.message : String(error))
        );
        return;
      }
    }

    // Complete spinner with success
    completeRemoveSpinner(spinner, true, filesDeleted);
  } catch (error) {
    // Complete spinner with failure
    completeRemoveSpinner(spinner, false, false);
    throw error;
  }
}
