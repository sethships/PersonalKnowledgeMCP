/**
 * Table export formatter utility.
 *
 * Converts {@link TableData} to Markdown, CSV (RFC 4180), and JSON formats.
 * All methods are pure functions with no side effects.
 *
 * @module documents/TableFormatter
 */

import type { TableData, TableCell } from "./types.js";

/**
 * Formats {@link TableData} into common export formats.
 *
 * @example
 * ```typescript
 * const table: TableData = {
 *   rows: [
 *     { cells: [{ content: "Name" }, { content: "Age" }], isHeader: true },
 *     { cells: [{ content: "Alice" }, { content: "30" }] },
 *   ],
 *   columnCount: 2,
 * };
 *
 * const md = TableFormatter.toMarkdown(table);
 * const csv = TableFormatter.toCsv(table);
 * const json = TableFormatter.toJson(table);
 * ```
 */
export class TableFormatter {
  /**
   * Convert a table to GitHub-flavored Markdown.
   *
   * - Pipe characters and backslashes in cell content are escaped.
   * - Newlines in cell content are replaced with `<br>`.
   * - A separator row (`---`) is inserted after the first header row.
   * - If no rows exist, returns an empty string.
   *
   * @param table - Table data to format
   * @returns Markdown table string
   */
  static toMarkdown(table: TableData): string {
    if (table.rows.length === 0) {
      return "";
    }

    const lines: string[] = [];
    let separatorInserted = false;

    for (const row of table.rows) {
      const cellTexts = this.expandCells(row.cells, table.columnCount).map((cell) =>
        this.escapeMarkdown(cell.content)
      );

      lines.push(`| ${cellTexts.join(" | ")} |`);

      if (row.isHeader && !separatorInserted) {
        const separators = new Array(table.columnCount).fill("---");
        lines.push(`| ${separators.join(" | ")} |`);
        separatorInserted = true;
      }
    }

    return lines.join("\n");
  }

  /**
   * Convert a table to RFC 4180 compliant CSV.
   *
   * - Fields containing commas, double quotes, or newlines are quoted.
   * - Double quotes within fields are escaped by doubling them.
   * - Uses CRLF line endings per RFC 4180.
   *
   * @param table - Table data to format
   * @returns CSV string
   */
  static toCsv(table: TableData): string {
    if (table.rows.length === 0) {
      return "";
    }

    const lines: string[] = [];

    for (const row of table.rows) {
      const fields = this.expandCells(row.cells, table.columnCount).map((cell) =>
        this.escapeCsv(cell.content)
      );

      lines.push(fields.join(","));
    }

    return lines.join("\r\n");
  }

  /**
   * Convert a table to pretty-printed JSON.
   *
   * Preserves optional fields (`caption`, `rowSpan`, `colSpan`, `isHeader`)
   * only when they are present on the source objects.
   *
   * @param table - Table data to format
   * @returns Pretty-printed JSON string
   */
  static toJson(table: TableData): string {
    return JSON.stringify(table, null, 2);
  }

  // ── Private helpers ──────────────────────────────────────────────

  /**
   * Expand cells to fill all column positions, accounting for colSpan.
   *
   * When a cell has `colSpan > 1`, subsequent positions are filled with
   * empty cells so the total matches `columnCount`.
   */
  private static expandCells(cells: TableCell[], columnCount: number): TableCell[] {
    const expanded: TableCell[] = [];

    for (const cell of cells) {
      expanded.push(cell);
      const span = (cell.colSpan ?? 1) - 1;
      for (let i = 0; i < span; i++) {
        expanded.push({ content: "" });
      }
    }

    // Pad or truncate to match columnCount
    while (expanded.length < columnCount) {
      expanded.push({ content: "" });
    }

    return expanded.slice(0, columnCount);
  }

  /**
   * Escape a cell value for Markdown table rendering.
   *
   * - Backslashes are escaped first (to avoid double-escaping).
   * - Pipe characters (`|`) are escaped with a backslash.
   * - Newlines are replaced with `<br>`.
   */
  private static escapeMarkdown(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, "<br>");
  }

  /**
   * Escape a field value for CSV output per RFC 4180.
   *
   * Fields are quoted if they contain commas, double quotes, or newlines.
   * Double quotes within the field are doubled.
   */
  private static escapeCsv(value: string): string {
    if (
      value.includes(",") ||
      value.includes('"') ||
      value.includes("\n") ||
      value.includes("\r")
    ) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}
