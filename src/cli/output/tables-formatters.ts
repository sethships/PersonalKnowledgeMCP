/**
 * Output Formatters for Tables List Command
 *
 * Functions for formatting extracted table information as CLI tables or JSON.
 */

import Table from "cli-table3";
import chalk from "chalk";

/**
 * Display information for an extracted table
 *
 * Represents a unique table aggregated from one or more ChromaDB chunks.
 */
export interface TableDisplayInfo {
  /** Repository name containing the table */
  repository: string;
  /** File path of the source document */
  filePath: string;
  /** Zero-based table index within the document */
  tableIndex: number;
  /** Table caption text, if present */
  caption: string | undefined;
  /** Number of columns in the table */
  columnCount: number;
  /** Number of data rows in the table */
  rowCount: number;
  /** Source document type (e.g., "pdf", "docx") */
  sourceType: string;
  /** Extraction confidence score (0-1) */
  confidence: number | undefined;
  /** Number of sub-chunks for this table in ChromaDB */
  chunkCount: number;
}

/**
 * Truncate a string to a maximum length, adding ellipsis if truncated
 *
 * @param str - String to truncate
 * @param maxLength - Maximum length
 * @returns Truncated string with ellipsis if needed
 */
function truncate(str: string, maxLength: number): string {
  if (maxLength < 4) return str.substring(0, maxLength);
  if (str.length <= maxLength) {
    return str;
  }
  return str.substring(0, maxLength - 3) + "...";
}

/**
 * Create a formatted CLI table of extracted tables
 *
 * @param tables - List of table display info
 * @param repoName - Optional repository name filter (shown in header)
 * @returns Formatted table string ready to print
 */
export function createTablesListTable(tables: TableDisplayInfo[], repoName?: string): string {
  if (tables.length === 0) {
    const scopeMsg = repoName ? ` in repository ${chalk.cyan(repoName)}` : "";
    return (
      chalk.yellow(`No tables found${scopeMsg}.`) +
      "\n\n" +
      chalk.bold("Tips:") +
      "\n  " +
      chalk.gray("Index documents containing tables first.") +
      "\n  " +
      chalk.gray("Check indexed repositories: pk-mcp status")
    );
  }

  const table = new Table({
    head: [
      chalk.cyan("Repository"),
      chalk.cyan("Document"),
      chalk.cyan("Table #"),
      chalk.cyan("Caption"),
      chalk.cyan("Size"),
      chalk.cyan("Source"),
      chalk.cyan("Confidence"),
      chalk.cyan("Chunks"),
    ],
    colAligns: ["left", "left", "right", "left", "left", "left", "right", "right"],
    colWidths: [16, 30, 9, 24, 12, 8, 12, 9],
    style: {
      head: [],
      border: ["gray"],
    },
  });

  for (const t of tables) {
    const size = `${t.rowCount}x${t.columnCount}`;
    const confidence =
      t.confidence !== undefined ? `${(t.confidence * 100).toFixed(0)}%` : chalk.gray("-");

    table.push([
      truncate(t.repository, 14),
      truncate(t.filePath, 28),
      t.tableIndex.toString(),
      t.caption ? truncate(t.caption, 22) : chalk.gray("(none)"),
      size,
      t.sourceType,
      confidence,
      t.chunkCount.toString(),
    ]);
  }

  const scopeMsg = repoName ? ` in ${chalk.cyan(repoName)}` : "";
  const header = chalk.bold(`\nExtracted Tables (${tables.length} total${scopeMsg})\n`);
  return header + table.toString();
}

/**
 * Format extracted tables as JSON
 *
 * @param tables - List of table display info
 * @param repoName - Optional repository name filter
 * @returns Pretty-printed JSON string
 */
export function formatTablesListJson(tables: TableDisplayInfo[], repoName?: string): string {
  return JSON.stringify(
    {
      totalTables: tables.length,
      ...(repoName && { repository: repoName }),
      tables: tables.map((t) => ({
        repository: t.repository,
        filePath: t.filePath,
        tableIndex: t.tableIndex,
        caption: t.caption ?? null,
        columnCount: t.columnCount,
        rowCount: t.rowCount,
        sourceType: t.sourceType,
        confidence: t.confidence ?? null,
        chunkCount: t.chunkCount,
      })),
    },
    null,
    2
  );
}
