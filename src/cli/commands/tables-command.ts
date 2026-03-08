/**
 * Tables List Command - List extracted tables from indexed documents
 *
 * Queries ChromaDB for chunks with isTable: true metadata and groups them
 * by (filePath, tableIndex) to show unique tables across repositories.
 */

/* eslint-disable no-console */

import chalk from "chalk";
import type { CliDependencies } from "../utils/dependency-init.js";
import type { DocumentQueryResult, MetadataFilter } from "../../storage/types.js";
import {
  createTablesListTable,
  formatTablesListJson,
  type TableDisplayInfo,
} from "../output/tables-formatters.js";

/**
 * Tables list command options
 */
export interface TablesListCommandOptions {
  /** Filter to tables from a specific document path */
  document?: string;
  /** Filter to tables from documents within a folder */
  folder?: string;
  /** Filter to a specific repository */
  repo?: string;
  /** Output as JSON */
  json?: boolean;
}

/**
 * Execute tables list command
 *
 * Lists all extracted tables from indexed documents. Tables are identified
 * by the isTable metadata flag set during table content indexing.
 *
 * @param options - Command options
 * @param deps - CLI dependencies
 */
export async function tablesListCommand(
  options: TablesListCommandOptions,
  deps: CliDependencies
): Promise<void> {
  // Get repositories to search
  const allRepos = await deps.repositoryService.listRepositories();
  const repos = options.repo ? allRepos.filter((r) => r.name === options.repo) : allRepos;

  if (options.repo && repos.length === 0) {
    console.log(
      chalk.yellow(`Repository ${chalk.cyan(options.repo)} not found.`) +
        "\n\n" +
        chalk.bold("Check indexed repositories:") +
        "\n  " +
        chalk.gray("pk-mcp status")
    );
    return;
  }

  const allTables: TableDisplayInfo[] = [];

  for (const repo of repos) {
    // Build where clause for isTable chunks
    const where = buildWhereClause(options);

    let results: DocumentQueryResult[];
    try {
      results = await deps.chromaClient.getDocumentsByMetadata(repo.collectionName, where);
    } catch {
      // Collection might not exist or have no table chunks - skip silently
      continue;
    }

    // Post-filter by folder if specified (ChromaDB doesn't support prefix matching)
    const filtered = options.folder
      ? results.filter((r) => r.metadata.file_path.startsWith(options.folder!))
      : results;

    // Group chunks by (filePath, tableIndex) to get unique tables
    const grouped = groupTableChunks(filtered, repo.name);
    allTables.push(...grouped);
  }

  // Sort by repository, then filePath, then tableIndex
  allTables.sort((a, b) => {
    if (a.repository !== b.repository) return a.repository.localeCompare(b.repository);
    if (a.filePath !== b.filePath) return a.filePath.localeCompare(b.filePath);
    return a.tableIndex - b.tableIndex;
  });

  // Output
  if (options.json) {
    console.log(formatTablesListJson(allTables, options.repo));
  } else {
    console.log(createTablesListTable(allTables, options.repo));
    console.log(); // Blank line for spacing
  }
}

/**
 * Build ChromaDB where clause for table queries
 *
 * @param options - Command options with optional document filter
 * @returns MetadataFilter for ChromaDB query
 */
function buildWhereClause(options: TablesListCommandOptions): MetadataFilter {
  if (options.document) {
    return {
      $and: [{ isTable: true }, { file_path: options.document }],
    };
  }
  return { isTable: true };
}

/**
 * Group table chunks by (filePath, tableIndex) to get unique tables
 *
 * Large tables may be split into multiple chunks in ChromaDB. This function
 * consolidates them into a single TableDisplayInfo per unique table.
 *
 * @param chunks - Document query results from ChromaDB
 * @param repository - Repository name
 * @returns Array of unique table display info
 */
function groupTableChunks(chunks: DocumentQueryResult[], repository: string): TableDisplayInfo[] {
  const grouped = new Map<
    string,
    { chunks: DocumentQueryResult[]; metadata: DocumentQueryResult["metadata"] }
  >();

  for (const chunk of chunks) {
    const meta = chunk.metadata;
    // Use file_path and tableIndex to identify unique tables
    // tableIndex is stored as a generic metadata field alongside DocumentMetadata
    const metaRecord = meta as unknown as Record<string, unknown>;
    const tableIndex = metaRecord["tableIndex"] as number | undefined;
    if (tableIndex === undefined) continue;

    const key = `${meta.file_path}::${tableIndex}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.chunks.push(chunk);
    } else {
      grouped.set(key, { chunks: [chunk], metadata: meta });
    }
  }

  const tables: TableDisplayInfo[] = [];
  for (const [, group] of grouped) {
    const meta = group.metadata as unknown as Record<string, unknown>;
    tables.push({
      repository,
      filePath: group.metadata.file_path,
      tableIndex: (meta["tableIndex"] as number) ?? 0,
      caption: meta["tableCaption"] as string | undefined,
      columnCount: (meta["tableColumnCount"] as number) ?? 0,
      rowCount: (meta["tableRowCount"] as number) ?? 0,
      sourceType: (meta["tableSourceType"] as string) ?? "unknown",
      confidence: meta["tableConfidence"] as number | undefined,
      chunkCount: group.chunks.length,
    });
  }

  return tables;
}
