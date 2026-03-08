/**
 * Tables Commands - List and export extracted tables from indexed documents
 *
 * Queries ChromaDB for chunks with isTable: true metadata and groups them
 * by (filePath, tableIndex) to show unique tables across repositories.
 * The export command reconstructs table data from stored Markdown chunks
 * and outputs it in CSV or JSON format.
 */

/* eslint-disable no-console */

import chalk from "chalk";
import { writeFile } from "node:fs/promises";
import type { CliDependencies } from "../utils/dependency-init.js";
import type { DocumentQueryResult, MetadataFilter } from "../../storage/types.js";
import { StorageError } from "../../storage/errors.js";
import {
  createTablesListTable,
  formatTablesListJson,
  formatTableExportSuccess,
  type TableDisplayInfo,
} from "../output/tables-formatters.js";
import { MarkdownTableParser } from "../../documents/MarkdownTableParser.js";
import { TableFormatter } from "../../documents/TableFormatter.js";
import type { TableData } from "../../documents/types.js";

/** Table metadata field names as stored in ChromaDB by TableContentIndexer */
const TABLE_META_FIELDS = {
  isTable: "isTable",
  tableIndex: "tableIndex",
  tableCaption: "tableCaption",
  tableColumnCount: "tableColumnCount",
  tableRowCount: "tableRowCount",
  tableSourceType: "tableSourceType",
  tableConfidence: "tableConfidence",
} as const;

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

  // Build where clause once - it is loop-invariant (depends only on options)
  const where = buildWhereClause(options);

  for (const repo of repos) {
    // TODO: Add --limit/--offset pagination for large table sets (see follow-up issue)
    let results: DocumentQueryResult[];
    try {
      results = await deps.chromaClient.getDocumentsByMetadata(repo.collectionName, where);
    } catch (error) {
      if (error instanceof StorageError) {
        // Collection might not exist or have no table chunks - skip silently
        continue;
      }
      throw error;
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
    const tableIndex = metaRecord[TABLE_META_FIELDS.tableIndex] as number | undefined;
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
      tableIndex: (meta[TABLE_META_FIELDS.tableIndex] as number) ?? 0,
      caption: meta[TABLE_META_FIELDS.tableCaption] as string | undefined,
      columnCount: (meta[TABLE_META_FIELDS.tableColumnCount] as number) ?? 0,
      rowCount: (meta[TABLE_META_FIELDS.tableRowCount] as number) ?? 0,
      sourceType: (meta[TABLE_META_FIELDS.tableSourceType] as string) ?? "unknown",
      confidence: meta[TABLE_META_FIELDS.tableConfidence] as number | undefined,
      chunkCount: group.chunks.length,
    });
  }

  return tables;
}

// ============================================================================
// Tables Export Command
// ============================================================================

/**
 * Tables export command options
 */
export interface TablesExportCommandOptions {
  /** Export format: csv or json */
  format: "csv" | "json";
  /** Optional output file path (default: stdout) */
  output?: string;
}

/**
 * Parse a composite table ID into its components.
 *
 * Table IDs use the format `repository:filePath:tableIndex` where the
 * file path may contain colons (unlikely but technically possible).
 * We split from the end to handle that case safely.
 *
 * @param tableId - Composite table identifier
 * @returns Parsed components
 * @throws Error if the format is invalid
 */
export function parseTableId(tableId: string): {
  repository: string;
  filePath: string;
  tableIndex: number;
} {
  // Split on colons - minimum 3 parts: repo, path, index
  const parts = tableId.split(":");
  if (parts.length < 3) {
    throw new Error(
      `Invalid table ID format: "${tableId}". ` +
        "Expected format: <repository>:<filePath>:<tableIndex> " +
        '(e.g., "my-repo:docs/report.pdf:0")'
    );
  }

  // Last part is always tableIndex
  const indexStr = parts[parts.length - 1]!;
  const tableIndex = parseInt(indexStr, 10);
  if (isNaN(tableIndex) || tableIndex < 0) {
    throw new Error(
      `Invalid table index "${indexStr}" in table ID "${tableId}". ` +
        "Table index must be a non-negative integer."
    );
  }

  // First part is repository
  const repository = parts[0]!;
  if (repository.length === 0) {
    throw new Error(`Invalid table ID format: "${tableId}". Repository name cannot be empty.`);
  }

  // Middle parts (joined) are the file path
  const filePath = parts.slice(1, -1).join(":");
  if (filePath.length === 0) {
    throw new Error(`Invalid table ID format: "${tableId}". File path cannot be empty.`);
  }

  return { repository, filePath, tableIndex };
}

/**
 * Reconstruct a {@link TableData} from ordered ChromaDB chunks.
 *
 * Extracts the Markdown content from each chunk, then uses
 * {@link MarkdownTableParser.parseMultiChunk} to rebuild the
 * structured table with header deduplication.
 *
 * @param chunks - Document query results sorted by chunk_index
 * @returns Reconstructed table data
 */
export function reconstructTableFromChunks(chunks: DocumentQueryResult[]): TableData {
  const markdownChunks = chunks.map((chunk) => chunk.content);
  return MarkdownTableParser.parseMultiChunk(markdownChunks);
}

/**
 * Execute tables export command
 *
 * Exports a specific table identified by its composite ID to CSV or JSON format.
 * The table is reconstructed from stored Markdown chunks and formatted using
 * {@link TableFormatter.toCsv} or {@link TableFormatter.toJson}.
 *
 * @param tableId - Composite table identifier (repo:filePath:tableIndex)
 * @param options - Export options (format, output path)
 * @param deps - CLI dependencies
 */
export async function tablesExportCommand(
  tableId: string,
  options: TablesExportCommandOptions,
  deps: CliDependencies
): Promise<void> {
  // Parse the composite table ID
  const { repository, filePath, tableIndex } = parseTableId(tableId);

  // Find the repository
  const allRepos = await deps.repositoryService.listRepositories();
  const repo = allRepos.find((r) => r.name === repository);

  if (!repo) {
    console.log(
      chalk.yellow(`Repository ${chalk.cyan(repository)} not found.`) +
        "\n\n" +
        chalk.bold("Check indexed repositories:") +
        "\n  " +
        chalk.gray("pk-mcp status")
    );
    return;
  }

  // Query ChromaDB for the specific table chunks
  const where: MetadataFilter = {
    $and: [{ isTable: true }, { file_path: filePath }, { tableIndex: tableIndex }],
  };

  let results: DocumentQueryResult[];
  try {
    results = await deps.chromaClient.getDocumentsByMetadata(repo.collectionName, where);
  } catch (error) {
    if (error instanceof StorageError) {
      console.log(
        chalk.yellow("Table not found.") +
          "\n\n" +
          chalk.bold("The collection may not exist or contain no table chunks.") +
          "\n  " +
          chalk.gray("pk-mcp tables list --repo " + repository)
      );
      return;
    }
    throw error;
  }

  if (results.length === 0) {
    console.log(
      chalk.yellow("Table not found.") +
        "\n\n" +
        chalk.bold("No table matching the given ID was found.") +
        "\n  ID: " +
        chalk.cyan(tableId) +
        "\n\n" +
        chalk.bold("List available tables:") +
        "\n  " +
        chalk.gray("pk-mcp tables list --repo " + repository)
    );
    return;
  }

  // Sort chunks by chunk_index for correct reconstruction
  results.sort((a, b) => a.metadata.chunk_index - b.metadata.chunk_index);

  // Reconstruct the table from chunks
  const tableData = reconstructTableFromChunks(results);

  if (tableData.rows.length === 0) {
    console.log(chalk.yellow("Table has no data rows to export."));
    return;
  }

  // Format the table
  const formatted =
    options.format === "json" ? TableFormatter.toJson(tableData) : TableFormatter.toCsv(tableData);

  // Output
  if (options.output) {
    await writeFile(options.output, formatted, "utf-8");
    console.log(formatTableExportSuccess(options.output, options.format));
  } else {
    console.log(formatted);
  }
}
