/**
 * Status Command - List indexed repositories
 *
 * Shows all repositories indexed in the knowledge base with their status.
 */

/* eslint-disable no-console */

import type { CliDependencies } from "../utils/dependency-init.js";
import { createRepositoryTable, formatRepositoriesJson } from "../output/formatters.js";

/**
 * Status command options
 */
export interface StatusCommandOptions {
  json?: boolean;
}

/**
 * Execute status command
 *
 * Lists all indexed repositories with their metadata.
 * Supports JSON output format for programmatic use.
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

  // Output as JSON if requested
  if (options.json) {
    console.log(formatRepositoriesJson(repositories));
    return;
  }

  // Output as table (default)
  console.log(createRepositoryTable(repositories));
  console.log(); // Blank line for spacing
}
