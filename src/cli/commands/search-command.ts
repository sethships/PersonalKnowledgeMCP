/**
 * Search Command - Perform semantic search
 *
 * Searches indexed repositories using vector similarity search.
 */

/* eslint-disable no-console */

import type { CliDependencies } from "../utils/dependency-init.js";
import { createSearchResultsTable, formatSearchResultsJson } from "../output/formatters.js";

/**
 * Search command options
 */
export interface SearchCommandOptions {
  limit?: string;
  threshold?: string;
  repo?: string;
  json?: boolean;
}

/**
 * Execute search command
 *
 * Performs semantic search across indexed repositories and displays results.
 * Supports JSON output format for programmatic use.
 *
 * @param query - Search query string
 * @param options - Command options
 * @param deps - CLI dependencies
 */
export async function searchCommand(
  query: string,
  options: SearchCommandOptions,
  deps: CliDependencies
): Promise<void> {
  // Parse and validate options
  const limit = options.limit ? parseInt(options.limit, 10) : 10;
  const threshold = options.threshold ? parseFloat(options.threshold) : 0.7;

  // Validate parsed values
  if (isNaN(limit) || limit < 1 || limit > 100) {
    throw new Error("Invalid limit. Must be a number between 1 and 100.");
  }

  if (isNaN(threshold) || threshold < 0 || threshold > 1) {
    throw new Error("Invalid threshold. Must be a number between 0.0 and 1.0.");
  }

  // Execute search
  const response = await deps.searchService.search({
    query,
    limit,
    threshold,
    repository: options.repo,
  });

  // Output as JSON if requested
  if (options.json) {
    console.log(
      formatSearchResultsJson(
        query,
        response.results,
        response.metadata.query_time_ms,
        response.metadata.embedding_time_ms,
        response.metadata.search_time_ms,
        response.metadata.repositories_searched
      )
    );
    return;
  }

  // Output as table (default)
  console.log(createSearchResultsTable(response.results, response.metadata.query_time_ms));
  console.log(); // Blank line for spacing
}
