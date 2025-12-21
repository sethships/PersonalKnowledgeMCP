/**
 * Reset Update Command - Reset stuck update state for a repository
 *
 * Clears the interrupted update flag and optionally attempts automatic recovery.
 */

/* eslint-disable no-console */

import chalk from "chalk";
import ora from "ora";
import type { CliDependencies } from "../utils/dependency-init.js";
import {
  detectInterruptedUpdates,
  formatElapsedTime,
} from "../../services/interrupted-update-detector.js";
import {
  evaluateRecoveryStrategy,
  executeRecovery,
  type RecoveryResult,
} from "../../services/interrupted-update-recovery.js";

/**
 * Reset update command options
 */
export interface ResetUpdateOptions {
  /** Skip confirmation prompt */
  force?: boolean;
  /** Attempt automatic recovery instead of just clearing flag */
  recover?: boolean;
  /** Output as JSON */
  json?: boolean;
}

/**
 * Format recovery result as JSON
 */
function formatResultJson(result: RecoveryResult): object {
  return {
    repository: result.repositoryName,
    strategy: result.strategy.type,
    reason: result.strategy.reason,
    success: result.success,
    message: result.message,
    durationMs: result.durationMs,
    error: result.error,
  };
}

/**
 * Execute reset-update command
 *
 * Resets the interrupted update state for a repository.
 * With --recover, attempts automatic recovery based on the evaluated strategy.
 *
 * @param repositoryName - Repository name to reset
 * @param options - Command options
 * @param deps - CLI dependencies
 */
export async function resetUpdateCommand(
  repositoryName: string,
  options: ResetUpdateOptions,
  deps: CliDependencies
): Promise<void> {
  // Get repository metadata
  const repo = await deps.repositoryService.getRepository(repositoryName);
  if (!repo) {
    throw new Error(
      `Repository '${repositoryName}' not found.\n` +
        "Check indexed repositories: " +
        chalk.gray("pk-mcp status")
    );
  }

  // Check if repository actually has an interrupted update
  if (!repo.updateInProgress) {
    if (options.json) {
      console.log(
        JSON.stringify({
          repository: repositoryName,
          status: "no_action",
          message: "Repository does not have an interrupted update",
        })
      );
    } else {
      console.log(
        chalk.yellow(`Repository '${repositoryName}' does not have an interrupted update.`)
      );
      console.log(chalk.gray("No action needed."));
    }
    return;
  }

  // Show current interrupted state
  const elapsed = repo.updateStartedAt
    ? formatElapsedTime(Date.now() - new Date(repo.updateStartedAt).getTime())
    : "unknown time";

  if (!options.json) {
    console.log(chalk.cyan(`\nRepository: ${repositoryName}`));
    console.log(chalk.yellow(`  Status: Update interrupted ${elapsed} ago`));
    if (repo.updateStartedAt) {
      console.log(chalk.gray(`  Started: ${repo.updateStartedAt}`));
    }
    if (repo.lastIndexedCommitSha) {
      console.log(chalk.gray(`  Last commit: ${repo.lastIndexedCommitSha.substring(0, 7)}`));
    }
    console.log();
  }

  // Get interrupted update info for recovery evaluation
  const detectionResult = await detectInterruptedUpdates(deps.repositoryService);
  const interruptedInfo = detectionResult.interrupted.find(
    (i) => i.repositoryName === repositoryName
  );

  if (!interruptedInfo) {
    // This shouldn't happen if repo.updateInProgress is true, but handle gracefully
    throw new Error("Failed to get interrupted update details");
  }

  // Evaluate recovery strategy
  const strategy = await evaluateRecoveryStrategy(interruptedInfo);

  if (!options.json) {
    console.log(chalk.white("Recovery Strategy:"));
    console.log(`  ${chalk.bold("Type:")} ${formatStrategyType(strategy.type)}`);
    console.log(`  ${chalk.gray("Reason:")} ${strategy.reason}`);
    if (strategy.estimatedWork) {
      console.log(`  ${chalk.gray("Work:")} ${strategy.estimatedWork}`);
    }
    console.log();
  }

  // If not using --recover, just clear the flag
  if (!options.recover) {
    if (!options.force && !options.json) {
      console.log(
        chalk.yellow("This will clear the interrupted flag without attempting recovery.")
      );
      console.log(chalk.yellow("Use --recover to attempt automatic recovery instead."));
      console.log();

      // Prompt for confirmation
      const confirmed = await promptConfirmation("Clear interrupted flag and mark as error?");
      if (!confirmed) {
        console.log(chalk.gray("Operation cancelled."));
        return;
      }
    }

    // Execute manual_required strategy to just clear flag
    const result = await executeRecovery(
      interruptedInfo,
      {
        type: "manual_required",
        reason: "User requested flag clear without recovery",
        canAutoRecover: false,
      },
      {
        repositoryService: deps.repositoryService,
        ingestionService: deps.ingestionService,
        updateCoordinator: deps.updateCoordinator,
      }
    );

    if (options.json) {
      console.log(JSON.stringify(formatResultJson(result), null, 2));
    } else {
      console.log(chalk.green("Interrupted update flag cleared."));
      console.log(
        chalk.gray(
          `Repository marked as 'error'. Use 'pk-mcp update ${repositoryName} --force' to re-index.`
        )
      );
    }
    return;
  }

  // Attempt automatic recovery
  if (!strategy.canAutoRecover) {
    if (options.json) {
      console.log(
        JSON.stringify({
          repository: repositoryName,
          status: "manual_required",
          strategy: strategy.type,
          reason: strategy.reason,
          message: "Automatic recovery not possible",
        })
      );
    } else {
      console.log(chalk.red("Automatic recovery not possible."));
      console.log(chalk.yellow(`Reason: ${strategy.reason}`));
      console.log();
      console.log(chalk.gray("You may need to:"));
      console.log(chalk.gray("  1. Check if the repository path is accessible"));
      console.log(chalk.gray("  2. Run 'pk-mcp remove <repo>' and re-index"));
    }
    return;
  }

  // Confirm before recovery
  if (!options.force && !options.json) {
    const actionDesc =
      strategy.type === "resume" ? "attempt incremental update" : "perform full re-index";
    const confirmed = await promptConfirmation(`${actionDesc}?`);
    if (!confirmed) {
      console.log(chalk.gray("Operation cancelled."));
      return;
    }
  }

  // Execute recovery
  const spinner = ora({
    text: `Recovering ${chalk.cyan(repositoryName)}...`,
    spinner: "dots",
  }).start();

  try {
    const result = await executeRecovery(interruptedInfo, strategy, {
      repositoryService: deps.repositoryService,
      ingestionService: deps.ingestionService,
      updateCoordinator: deps.updateCoordinator,
    });

    if (result.success) {
      spinner.succeed(chalk.green(`Recovery successful for ${repositoryName}`));

      if (options.json) {
        console.log(JSON.stringify(formatResultJson(result), null, 2));
      } else {
        console.log(`  ${chalk.gray("Strategy:")} ${formatStrategyType(result.strategy.type)}`);
        console.log(`  ${chalk.gray("Message:")} ${result.message}`);
        console.log(`  ${chalk.gray("Duration:")} ${result.durationMs}ms`);
      }
    } else {
      spinner.fail(chalk.red(`Recovery failed for ${repositoryName}`));

      if (options.json) {
        console.log(JSON.stringify(formatResultJson(result), null, 2));
      } else {
        console.log(`  ${chalk.red("Error:")} ${result.error || result.message}`);
        console.log();
        console.log(chalk.gray("Try running:"));
        console.log(chalk.gray(`  pk-mcp update ${repositoryName} --force`));
      }

      // Throw to indicate failure
      throw new Error(result.error || result.message);
    }
  } catch (error) {
    if (spinner.isSpinning) {
      spinner.fail(chalk.red(`Recovery failed for ${repositoryName}`));
    }
    throw error;
  }
}

/**
 * Format strategy type for display
 */
function formatStrategyType(type: string): string {
  switch (type) {
    case "resume":
      return chalk.green("Resume (incremental update)");
    case "full_reindex":
      return chalk.yellow("Full re-index");
    case "manual_required":
      return chalk.red("Manual intervention required");
    default:
      return type;
  }
}

/**
 * Prompt for user confirmation
 *
 * @param question - Question to ask
 * @returns true if user confirmed
 */
async function promptConfirmation(question: string): Promise<boolean> {
  const readline = await import("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${question} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}
