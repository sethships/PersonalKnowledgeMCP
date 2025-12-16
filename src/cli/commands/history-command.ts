/**
 * History Command - Display repository update history
 *
 * Shows audit trail of incremental updates for a repository.
 */

/* eslint-disable no-console */

import type { CliDependencies } from "../utils/dependency-init.js";
import { createHistoryTable, formatHistoryJson } from "../output/formatters.js";

/**
 * History command options (after zod validation/transformation)
 */
export interface HistoryCommandOptions {
  limit: number;
  json?: boolean;
}

/**
 * Execute history command
 *
 * Displays the update history for a specific repository.
 * Supports JSON output format for programmatic use.
 *
 * @param repositoryName - Repository name to fetch history for
 * @param options - Command options
 * @param deps - CLI dependencies
 */
export async function historyCommand(
  repositoryName: string,
  options: HistoryCommandOptions,
  deps: CliDependencies
): Promise<void> {
  // Fetch repository metadata
  const repo = await deps.repositoryService.getRepository(repositoryName);

  // Handle repository not found
  if (!repo) {
    throw new Error(
      `Repository '${repositoryName}' not found.\n` + "Check indexed repositories: pk-mcp status"
    );
  }

  // Extract update history (default to empty array if undefined)
  const history = repo.updateHistory || [];

  // Apply limit (history already newest-first)
  const limitedHistory = history.slice(0, options.limit);

  // Output as JSON if requested
  if (options.json) {
    console.log(formatHistoryJson(repositoryName, limitedHistory, repo));
    return;
  }

  // Output as table (default)
  console.log(createHistoryTable(repositoryName, limitedHistory, repo));
  console.log(); // Blank line for spacing
}
