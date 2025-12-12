/**
 * Search Command - Perform semantic search
 *
 * Searches indexed repositories using vector similarity search.
 */

/* eslint-disable no-console */

import type { CliDependencies } from "../utils/dependency-init.js";
import { createSearchResultsTable, formatSearchResultsJson } from "../output/formatters.js";

/**
 * Search command options (after zod validation/transformation)
 */
export interface SearchCommandOptions {
  limit: number;
  threshold: number;
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
  // Options are already validated and transformed by zod schema
  const limit = options.limit;
  const threshold = options.threshold;

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
