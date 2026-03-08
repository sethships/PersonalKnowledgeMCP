/**
 * Markdown table parser utility.
 *
 * Parses Markdown-formatted table text (as produced by {@link TableFormatter.toMarkdown})
 * back into structured {@link TableData} objects. Supports caption extraction,
 * escape sequence reversal, and multi-chunk header deduplication.
 *
 * @module documents/MarkdownTableParser
 */

import type { TableData, TableRow, TableCell } from "./types.js";

/**
 * Parses Markdown table text back into structured {@link TableData}.
 *
 * This is the inverse of {@link TableFormatter.toMarkdown}. It handles:
 * - Optional caption prefix (`**Table: ...**`)
 * - Pipe-separated row parsing
 * - Separator row detection (`| --- | --- |`)
 * - Escape reversal (`\|` to `|`, `\\` to `\`, `<br>` to newline)
 * - Multi-chunk reconstruction with header deduplication
 *
 * @example
 * ```typescript
 * const markdown = "| Name | Age |\n| --- | --- |\n| Alice | 30 |";
 * const table = MarkdownTableParser.parse(markdown);
 * // table.rows[0].isHeader === true
 * // table.rows[1].cells[0].content === "Alice"
 * ```
 */
export class MarkdownTableParser {
  /**
   * Parse a Markdown table string into structured {@link TableData}.
   *
   * @param markdown - Markdown text containing a table
   * @returns Parsed table data
   */
  static parse(markdown: string): TableData {
    if (!markdown || markdown.trim().length === 0) {
      return { rows: [], columnCount: 0 };
    }

    const { caption, tableText } = this.extractCaption(markdown);
    const lines = tableText.split("\n").filter((line) => line.trim().length > 0);

    if (lines.length === 0) {
      return { rows: [], columnCount: 0, caption };
    }

    const rows: TableRow[] = [];
    let columnCount = 0;
    let nextRowIsHeader = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.trim();

      // Check if this is a separator row (| --- | --- |)
      if (this.isSeparatorRow(line)) {
        // The previous row (if any) is a header row
        if (rows.length > 0) {
          rows[rows.length - 1]!.isHeader = true;
        }
        // The row before the separator is already pushed; skip the separator
        nextRowIsHeader = false;
        continue;
      }

      // Parse a data/header row
      const cells = this.parseRow(line);
      if (cells.length > columnCount) {
        columnCount = cells.length;
      }

      rows.push({
        cells,
        ...(nextRowIsHeader ? { isHeader: true } : {}),
      });
      nextRowIsHeader = false;
    }

    return {
      rows,
      columnCount,
      ...(caption ? { caption } : {}),
    };
  }

  /**
   * Parse and reconstruct a table from multiple Markdown chunks.
   *
   * When large tables are split into multiple chunks by {@link TableContentIndexer},
   * the header rows are repeated in each chunk. This method concatenates the chunks
   * and deduplicates repeated headers.
   *
   * @param chunks - Array of Markdown table text chunks, in order
   * @returns Reconstructed table data
   */
  static parseMultiChunk(chunks: string[]): TableData {
    if (chunks.length === 0) {
      return { rows: [], columnCount: 0 };
    }

    if (chunks.length === 1) {
      return this.parse(chunks[0]!);
    }

    // Parse first chunk to get the full structure including headers
    const firstTable = this.parse(chunks[0]!);
    const headerRows = firstTable.rows.filter((r) => r.isHeader);
    const dataRows = firstTable.rows.filter((r) => !r.isHeader);

    // Parse subsequent chunks and collect only non-header rows
    for (let i = 1; i < chunks.length; i++) {
      const chunkTable = this.parse(chunks[i]!);
      const chunkDataRows = chunkTable.rows.filter((r) => !r.isHeader);
      dataRows.push(...chunkDataRows);
    }

    const allRows = [...headerRows, ...dataRows];
    const columnCount = Math.max(firstTable.columnCount, ...allRows.map((r) => r.cells.length));

    return {
      rows: allRows,
      columnCount,
      ...(firstTable.caption ? { caption: firstTable.caption } : {}),
    };
  }

  // ── Private helpers ──────────────────────────────────────────────

  /**
   * Extract an optional caption prefix from the markdown text.
   *
   * Captions are formatted as `**Table: <caption>**` on the first line,
   * followed by blank lines and then the table content.
   *
   * @param markdown - Full markdown text
   * @returns Caption (if found) and remaining table text
   */
  private static extractCaption(markdown: string): { caption?: string; tableText: string } {
    const captionMatch = markdown.match(/^\*\*Table:\s*(.+?)\*\*\s*\n/);
    if (captionMatch && captionMatch[1]) {
      const caption = captionMatch[1].trim();
      const tableText = markdown.slice(captionMatch[0].length);
      return { caption, tableText };
    }
    return { tableText: markdown };
  }

  /**
   * Determine if a line is a Markdown table separator row.
   *
   * Separator rows consist of `| --- | --- |` patterns where each cell
   * contains only dashes and optional colons (for alignment).
   *
   * @param line - Trimmed line text
   * @returns True if the line is a separator
   */
  private static isSeparatorRow(line: string): boolean {
    // Must start and end with pipe
    if (!line.startsWith("|") || !line.endsWith("|")) {
      return false;
    }

    // Split by unescaped pipes and check each cell
    const cells = this.splitPipeCells(line);
    if (cells.length === 0) {
      return false;
    }

    // Every cell must match the separator pattern: optional colons, dashes, optional colons
    return cells.every((cell) => /^:?-{1,}:?$/.test(cell.trim()));
  }

  /**
   * Parse a pipe-delimited row into cells with unescaped content.
   *
   * @param line - Trimmed line text (e.g., `| Alice | 30 |`)
   * @returns Array of parsed cells
   */
  private static parseRow(line: string): TableCell[] {
    const rawCells = this.splitPipeCells(line);
    return rawCells.map((raw) => ({
      content: this.unescapeMarkdown(raw.trim()),
    }));
  }

  /**
   * Split a pipe-delimited row into raw cell strings.
   *
   * Handles escaped pipes (`\|`) by not splitting on them.
   * Strips the leading and trailing pipe characters.
   *
   * @param line - Trimmed line text
   * @returns Array of raw cell content strings
   */
  private static splitPipeCells(line: string): string[] {
    // Remove leading and trailing pipe
    let content = line;
    if (content.startsWith("|")) {
      content = content.slice(1);
    }
    if (content.endsWith("|")) {
      content = content.slice(0, -1);
    }

    // Split on unescaped pipes (pipes not preceded by a backslash)
    const cells: string[] = [];
    let current = "";

    for (let i = 0; i < content.length; i++) {
      const char = content[i]!;

      if (char === "|" && (i === 0 || content[i - 1] !== "\\")) {
        cells.push(current);
        current = "";
      } else {
        current += char;
      }
    }
    cells.push(current);

    return cells;
  }

  /**
   * Reverse Markdown escape sequences applied by {@link TableFormatter.toMarkdown}.
   *
   * Converts:
   * - `<br>` back to `\n`
   * - `\|` back to `|`
   * - `\\` back to `\`
   *
   * Order matters: `<br>` first (contains no escape sequences),
   * then `\|`, then `\\` (to avoid double-unescaping).
   *
   * @param value - Escaped cell content
   * @returns Unescaped content
   */
  private static unescapeMarkdown(value: string): string {
    return value.replace(/<br>/g, "\n").replace(/\\\|/g, "|").replace(/\\\\/g, "\\");
  }
}
