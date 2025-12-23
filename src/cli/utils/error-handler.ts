/**
 * Centralized Error Handler for CLI Commands
 *
 * Maps service errors to user-friendly messages with actionable next steps.
 */

/* eslint-disable no-console */

import chalk from "chalk";
import type { Ora } from "ora";
import {
  RepositoryAlreadyExistsError,
  IndexingInProgressError,
  CloneError,
  CollectionCreationError,
  IngestionError,
} from "../../services/ingestion-errors.js";
import {
  SearchValidationError,
  RepositoryNotFoundError,
  RepositoryNotReadyError,
  NoRepositoriesAvailableError,
  SearchOperationError,
} from "../../services/errors.js";
import { RepositoryMetadataError } from "../../repositories/errors.js";
import {
  ForcePushDetectedError,
  ChangeThresholdExceededError,
  GitPullError,
  MissingCommitShaError,
} from "../../services/incremental-update-coordinator-errors.js";
import {
  TokenValidationError,
  TokenNotFoundError,
  TokenStorageError,
  TokenGenerationError,
} from "../../auth/errors.js";

/**
 * Handle command errors and exit with appropriate status code
 *
 * This function stops any active spinner, displays a formatted error message,
 * and exits the process with code 1.
 *
 * @param error - The error to handle
 * @param spinner - Optional spinner to stop before showing error
 */
export function handleCommandError(error: unknown, spinner?: Ora): never {
  // Stop spinner if provided
  if (spinner && spinner.isSpinning) {
    spinner.stop();
  }

  console.error(); // Blank line for spacing

  // Handle known ingestion errors
  if (error instanceof RepositoryAlreadyExistsError) {
    console.error(chalk.red("✗ Repository Already Indexed"));
    console.error("\nThe repository is already indexed in the knowledge base.");
    console.error("\n" + chalk.bold("Next steps:"));
    console.error(
      "  • Use " +
        chalk.cyan("--force") +
        " to reindex: " +
        chalk.gray(`pk-mcp index <url> --force`)
    );
    console.error("  • Check indexed repositories: " + chalk.gray("pk-mcp status"));
    process.exit(1);
  }

  if (error instanceof IndexingInProgressError) {
    console.error(chalk.red("✗ Indexing In Progress"));
    console.error("\nAnother indexing operation is currently in progress.");
    console.error("Only one repository can be indexed at a time.");
    console.error("\n" + chalk.bold("Next steps:"));
    console.error("  • Wait for the current operation to complete");
    console.error("  • Check status: " + chalk.gray("pk-mcp status"));
    process.exit(1);
  }

  if (error instanceof CloneError) {
    console.error(chalk.red("✗ Repository Clone Failed"));
    console.error(`\n${error.message}`);
    console.error("\n" + chalk.bold("Common causes:"));
    console.error("  • Invalid repository URL");
    console.error("  • Repository does not exist or is private (missing credentials)");
    console.error("  • Network connectivity issues");
    console.error("  • Git not installed or not in PATH");
    console.error("\n" + chalk.bold("Next steps:"));
    console.error("  • Verify the repository URL is correct");
    console.error("  • For private repositories, ensure Git credentials are configured");
    console.error("  • Check network connection");
    process.exit(1);
  }

  if (error instanceof CollectionCreationError) {
    console.error(chalk.red("✗ ChromaDB Collection Error"));
    console.error(`\n${error.message}`);
    console.error("\n" + chalk.bold("Next steps:"));
    console.error("  • Verify ChromaDB is running: " + chalk.gray("docker-compose up -d"));
    console.error("  • Check ChromaDB logs: " + chalk.gray("docker-compose logs chromadb"));
    console.error("  • Verify ChromaDB connection settings in .env file");
    process.exit(1);
  }

  if (error instanceof IngestionError) {
    console.error(chalk.red("✗ Indexing Error"));
    console.error(`\n${error.message}`);
    if (error.retryable) {
      console.error("\n" + chalk.yellow("This error may be transient. You can try again."));
    }
    console.error("\n" + chalk.bold("Next steps:"));
    console.error("  • Check the error message above for specific details");
    console.error(
      "  • Enable verbose logging: " + chalk.gray("LOG_LEVEL=debug pk-mcp index <url>")
    );
    process.exit(1);
  }

  // Handle known search errors
  if (error instanceof SearchValidationError) {
    console.error(chalk.red("✗ Invalid Search Parameters"));
    console.error(`\n${error.message}`);
    console.error("\n" + chalk.bold("Valid parameter ranges:"));
    console.error("  • Query: 1-1000 characters");
    console.error("  • Limit: 1-100 (default: 10)");
    console.error("  • Threshold: 0.0-1.0 (default: 0.7)");
    console.error("\n" + chalk.bold("Example:"));
    console.error("  " + chalk.gray('pk-mcp search "authentication" --limit 5 --threshold 0.8'));
    process.exit(1);
  }

  if (error instanceof RepositoryNotFoundError) {
    console.error(chalk.red("✗ Repository Not Found"));
    console.error(`\n${error.message}`);
    console.error("\n" + chalk.bold("Next steps:"));
    console.error("  • Check indexed repositories: " + chalk.gray("pk-mcp status"));
    console.error("  • Index a repository: " + chalk.gray("pk-mcp index <url>"));
    process.exit(1);
  }

  if (error instanceof RepositoryNotReadyError) {
    console.error(chalk.red("✗ Repository Not Ready"));
    console.error(`\n${error.message}`);
    console.error("\nThe repository is still being indexed or encountered an error.");
    console.error("\n" + chalk.bold("Next steps:"));
    console.error("  • Check repository status: " + chalk.gray("pk-mcp status"));
    console.error("  • Wait for indexing to complete if in progress");
    console.error("  • Reindex if status is 'error': " + chalk.gray("pk-mcp index <url> --force"));
    process.exit(1);
  }

  if (error instanceof NoRepositoriesAvailableError) {
    console.error(chalk.red("✗ No Repositories Indexed"));
    console.error("\nNo repositories have been indexed yet.");
    console.error("\n" + chalk.bold("Get started:"));
    console.error("  " + chalk.gray("pk-mcp index https://github.com/user/my-project.git"));
    console.error("\n" + chalk.bold("Example:"));
    console.error(
      "  " + chalk.gray("pk-mcp index https://github.com/sethb75/PersonalKnowledgeMCP.git")
    );
    process.exit(1);
  }

  if (error instanceof SearchOperationError) {
    console.error(chalk.red("✗ Search Operation Failed"));
    console.error(`\n${error.message}`);
    if (error.retryable) {
      console.error("\n" + chalk.yellow("This error may be transient. You can try again."));
    }
    console.error("\n" + chalk.bold("Next steps:"));
    console.error("  • Verify ChromaDB is running: " + chalk.gray("pk-mcp health"));
    console.error(
      "  • Enable verbose logging: " + chalk.gray("LOG_LEVEL=debug pk-mcp search <query>")
    );
    process.exit(1);
  }

  // Handle repository metadata errors
  if (error instanceof RepositoryMetadataError) {
    console.error(chalk.red("✗ Repository Metadata Error"));
    console.error(`\n${error.message}`);
    console.error("\n" + chalk.bold("Next steps:"));
    console.error("  • Check file permissions in DATA_PATH directory");
    console.error("  • Verify repositories.json is not corrupted");
    console.error("  • Enable verbose logging: " + chalk.gray("LOG_LEVEL=debug pk-mcp <command>"));
    process.exit(1);
  }

  // Handle incremental update coordinator errors
  if (error instanceof ForcePushDetectedError) {
    console.error(chalk.red("✗ Force Push Detected"));
    console.error(`\n${error.message}`);
    console.error("\nThe repository's commit history has been rewritten (force push).");
    console.error("Incremental update cannot determine the changes since the last index.");
    console.error("\n" + chalk.bold("Next steps:"));
    console.error("  • Trigger full re-index: " + chalk.gray("pk-mcp index <url> --force"));
    console.error(
      "  • Or use update command with force flag: " + chalk.gray("pk-mcp update <repo> --force")
    );
    process.exit(1);
  }

  if (error instanceof ChangeThresholdExceededError) {
    console.error(chalk.red("✗ Too Many Changes for Incremental Update"));
    console.error(`\n${error.message}`);
    console.error(`\nMore than ${error.threshold} files have changed since the last index.`);
    console.error("Full re-indexing is more efficient than incremental update.");
    console.error("\n" + chalk.bold("Next steps:"));
    console.error("  • Trigger full re-index: " + chalk.gray("pk-mcp index <url> --force"));
    console.error(
      "  • Or use update command with force flag: " + chalk.gray("pk-mcp update <repo> --force")
    );
    process.exit(1);
  }

  if (error instanceof GitPullError) {
    console.error(chalk.red("✗ Git Pull Failed"));
    console.error(`\n${error.message}`);
    console.error("\n" + chalk.bold("Common causes:"));
    console.error("  • Local repository has uncommitted changes or conflicts");
    console.error("  • Network connectivity issues");
    console.error("  • Remote repository unavailable");
    console.error("\n" + chalk.bold("Next steps:"));
    console.error("  • Check local repository status manually");
    console.error("  • Resolve any merge conflicts or uncommitted changes");
    console.error("  • Retry the update command");
    console.error("  • Or trigger full re-index: " + chalk.gray("pk-mcp update <repo> --force"));
    process.exit(1);
  }

  if (error instanceof MissingCommitShaError) {
    console.error(chalk.red("✗ Missing Commit SHA"));
    console.error(`\n${error.message}`);
    console.error("\nThe repository has no recorded commit SHA from initial indexing.");
    console.error("This typically indicates the repository was never fully indexed.");
    console.error("\n" + chalk.bold("Next steps:"));
    console.error("  • Trigger full re-index: " + chalk.gray("pk-mcp index <url> --force"));
    console.error(
      "  • Or remove and re-index: " + chalk.gray("pk-mcp remove <repo> && pk-mcp index <url>")
    );
    process.exit(1);
  }

  // Handle authentication/token errors
  if (error instanceof TokenValidationError) {
    console.error(chalk.red("✗ Invalid Token Parameters"));
    console.error(`\n${error.message}`);
    console.error("\n" + chalk.bold("Valid token parameters:"));
    console.error("  • Name: 1-100 characters (alphanumeric, space, _, -, .)");
    console.error("  • Scopes: read, write, admin");
    console.error("  • Instances: private, work, public");
    console.error("  • Expires: 30d, 1y, 12h, 2w, 3m, or never");
    console.error("\n" + chalk.bold("Example:"));
    console.error(
      "  " + chalk.gray('pk-mcp token create -n "Cursor IDE" -s read,write -i work -e 1y')
    );
    process.exit(1);
  }

  if (error instanceof TokenNotFoundError) {
    console.error(chalk.red("✗ Token Not Found"));
    console.error(`\n${error.message}`);
    console.error("\n" + chalk.bold("Next steps:"));
    console.error("  • List available tokens: " + chalk.gray("pk-mcp token list"));
    console.error("  • Include all tokens: " + chalk.gray("pk-mcp token list --all"));
    console.error("  • Create a new token: " + chalk.gray('pk-mcp token create -n "My Token"'));
    process.exit(1);
  }

  if (error instanceof TokenStorageError) {
    console.error(chalk.red("✗ Token Storage Error"));
    console.error(`\n${error.message}`);
    console.error("\n" + chalk.bold("Common causes:"));
    console.error("  • DATA_PATH directory does not exist or is not writable");
    console.error("  • tokens.json file is corrupted");
    console.error("  • Insufficient disk space");
    console.error("\n" + chalk.bold("Next steps:"));
    console.error("  • Verify DATA_PATH in .env file (default: ./data)");
    console.error("  • Check file permissions on the data directory");
    console.error("  • Enable verbose logging: " + chalk.gray("LOG_LEVEL=debug pk-mcp token list"));
    process.exit(1);
  }

  if (error instanceof TokenGenerationError) {
    console.error(chalk.red("✗ Token Generation Failed"));
    console.error(`\n${error.message}`);
    console.error("\n" + chalk.bold("Common causes:"));
    console.error("  • Insufficient system entropy for random generation");
    console.error("  • DATA_PATH directory not writable");
    console.error("  • Internal error during token creation");
    console.error("\n" + chalk.bold("Next steps:"));
    console.error("  • Check DATA_PATH permissions");
    console.error("  • Try again (transient issues may resolve)");
    console.error(
      "  • Enable verbose logging: " + chalk.gray("LOG_LEVEL=debug pk-mcp token create")
    );
    process.exit(1);
  }

  // Handle generic Error instances
  if (error instanceof Error) {
    console.error(chalk.red("✗ Error"));
    console.error(`\n${error.message}`);

    // Show stack trace in verbose mode
    if (Bun.env["LOG_LEVEL"] === "debug" || Bun.env["LOG_LEVEL"] === "trace") {
      console.error("\n" + chalk.gray(error.stack || "No stack trace available"));
    }

    console.error("\n" + chalk.bold("Next steps:"));
    console.error("  • Enable verbose logging: " + chalk.gray("LOG_LEVEL=debug pk-mcp <command>"));
    console.error("  • Check configuration in .env file");
    console.error(
      "  • Report issue: " + chalk.cyan("https://github.com/sethb75/PersonalKnowledgeMCP/issues")
    );
    process.exit(1);
  }

  // Handle unknown error types
  console.error(chalk.red("✗ Unknown Error"));
  console.error(`\n${String(error)}`);
  console.error("\n" + chalk.bold("Next steps:"));
  console.error("  • Enable verbose logging: " + chalk.gray("LOG_LEVEL=debug pk-mcp <command>"));
  console.error(
    "  • Report issue: " + chalk.cyan("https://github.com/sethb75/PersonalKnowledgeMCP/issues")
  );
  process.exit(1);
}
