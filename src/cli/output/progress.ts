/**
 * Progress Indicators for CLI
 *
 * Functions for creating and updating progress spinners during long operations.
 */

import ora, { type Ora } from "ora";
import chalk from "chalk";
import type { IndexProgress, IndexResult } from "../../services/ingestion-types.js";

/**
 * Create a spinner for indexing operation
 *
 * @param repositoryName - Name of the repository being indexed
 * @returns Ora spinner instance
 */
export function createIndexSpinner(repositoryName: string): Ora {
  const spinner = ora({
    text: `Indexing ${chalk.cyan(repositoryName)}...`,
    color: "cyan",
  }).start();

  return spinner;
}

/**
 * Update spinner text based on indexing progress
 *
 * @param spinner - Ora spinner instance
 * @param progress - Current progress information
 */
export function updateIndexSpinner(spinner: Ora, progress: IndexProgress): void {
  const { phase, details } = progress;

  switch (phase) {
    case "cloning":
      spinner.text = "Cloning repository...";
      break;

    case "scanning":
      if (details.filesScanned !== undefined) {
        spinner.text = `Scanning files (${details.filesScanned} found)...`;
      } else {
        spinner.text = "Scanning files...";
      }
      break;

    case "chunking":
      if (details.filesProcessed !== undefined && details.totalFiles !== undefined) {
        const percent = Math.round((details.filesProcessed / details.totalFiles) * 100);
        spinner.text = `Processing files (${details.filesProcessed}/${details.totalFiles} - ${percent}%)...`;
      } else if (details.filesProcessed !== undefined) {
        spinner.text = `Processing files (${details.filesProcessed} processed)...`;
      } else {
        spinner.text = "Processing files...";
      }
      break;

    case "embedding":
      if (details.currentBatch !== undefined && details.totalBatches !== undefined) {
        const percent = Math.round((details.currentBatch / details.totalBatches) * 100);
        spinner.text = `Generating embeddings (batch ${details.currentBatch}/${details.totalBatches} - ${percent}%)...`;
      } else if (details.embeddingsGenerated !== undefined) {
        spinner.text = `Generating embeddings (${details.embeddingsGenerated} created)...`;
      } else {
        spinner.text = "Generating embeddings...";
      }
      break;

    case "storing":
      if (details.documentsStored !== undefined) {
        spinner.text = `Storing in vector database (${details.documentsStored} stored)...`;
      } else {
        spinner.text = "Storing in vector database...";
      }
      break;

    case "updating_metadata":
      spinner.text = "Finalizing...";
      break;

    default:
      spinner.text = `Indexing (${phase as string})...`;
  }
}

/**
 * Complete spinner with success or failure message
 *
 * @param spinner - Ora spinner instance
 * @param success - Whether the operation succeeded
 * @param stats - Indexing statistics (if successful)
 * @param errorMessage - Error message (if failed)
 */
export function completeIndexSpinner(
  spinner: Ora,
  success: boolean,
  stats?: IndexResult["stats"],
  errorMessage?: string
): void {
  if (success && stats) {
    const durationSec = (stats.durationMs / 1000).toFixed(1);
    spinner.succeed(
      chalk.green("Indexing complete!") +
        "\n" +
        `  Files processed: ${chalk.cyan(stats.filesProcessed.toString())}` +
        "\n" +
        `  Chunks created: ${chalk.cyan(stats.chunksCreated.toString())}` +
        "\n" +
        `  Embeddings generated: ${chalk.cyan(stats.embeddingsGenerated.toString())}` +
        "\n" +
        `  Duration: ${chalk.cyan(durationSec + "s")}`
    );
  } else {
    spinner.fail(chalk.red("Indexing failed") + (errorMessage ? `\n  ${errorMessage}` : ""));
  }
}

/**
 * Create a simple spinner for remove operation
 *
 * @param repositoryName - Name of the repository being removed
 * @returns Ora spinner instance
 */
export function createRemoveSpinner(repositoryName: string): Ora {
  const spinner = ora({
    text: `Removing ${chalk.cyan(repositoryName)}...`,
    color: "yellow",
  }).start();

  return spinner;
}

/**
 * Complete remove spinner
 *
 * @param spinner - Ora spinner instance
 * @param success - Whether the operation succeeded
 * @param deletedFiles - Whether local files were deleted
 */
export function completeRemoveSpinner(spinner: Ora, success: boolean, deletedFiles: boolean): void {
  if (success) {
    let message = chalk.green("Repository removed successfully!");
    if (deletedFiles) {
      message +=
        "\n  • Vector embeddings deleted from ChromaDB\n  • Repository metadata removed\n  • Local repository files deleted";
    } else {
      message +=
        "\n  • Vector embeddings deleted from ChromaDB\n  • Repository metadata removed\n  • Local repository files preserved";
    }
    spinner.succeed(message);
  } else {
    spinner.fail(chalk.red("Failed to remove repository"));
  }
}
