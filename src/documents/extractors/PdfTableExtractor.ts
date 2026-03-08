/**
 * PDF table extractor using pdfreader.
 *
 * Extracts structured table data from PDF files by analyzing text item
 * spatial coordinates (x, y, w) to detect row groupings, column boundaries,
 * and table regions. Supports merged cell detection (colSpan and rowSpan).
 *
 * @module documents/extractors/PdfTableExtractor
 */

import { PdfReader } from "pdfreader";
import { DOCUMENT_EXTENSIONS, DEFAULT_EXTRACTOR_CONFIG } from "../constants.js";
import { ExtractionError, ExtractionTimeoutError, PasswordProtectedError } from "../errors.js";
import { BaseExtractor } from "./BaseExtractor.js";
import type {
  TableExtractor,
  TableExtractorConfig,
  TableExtractionResult,
  TableData,
  TableRow,
  TableCell,
} from "../types.js";

// ── Configuration ─────────────────────────────────────────────────

/**
 * Configuration for the PDF table extractor.
 *
 * Extends {@link TableExtractorConfig} with PDF-specific options for
 * controlling row grouping tolerance and minimum table dimensions.
 *
 * @example
 * ```typescript
 * const config: PdfTableExtractorConfig = {
 *   maxFileSizeBytes: 52428800,
 *   timeoutMs: 30000,
 *   yTolerance: 0.3,
 *   minColumns: 2,
 *   minRows: 2,
 * };
 * ```
 */
export interface PdfTableExtractorConfig extends TableExtractorConfig {
  /**
   * Y-coordinate tolerance for grouping text items into the same row.
   *
   * Items whose y-coordinates differ by less than this value are
   * considered part of the same row.
   *
   * @default 0.3
   */
  yTolerance?: number;

  /**
   * Minimum number of columns required to qualify as a table.
   *
   * Rows with fewer aligned items are not considered table rows.
   *
   * @default 2
   */
  minColumns?: number;

  /**
   * Minimum number of data rows required to qualify as a table.
   *
   * Regions with fewer consecutive aligned rows are not detected
   * as tables.
   *
   * @default 2
   */
  minRows?: number;
}

// ── Internal types ────────────────────────────────────────────────

/** Text item parsed from a PDF page with spatial coordinates. */
interface PdfTextItem {
  /** Text content of the item. */
  text: string;
  /** Horizontal position (left edge). */
  x: number;
  /** Vertical position (top edge). */
  y: number;
  /** Width of the text item. */
  w: number;
}

/** A row of text items grouped by y-coordinate proximity. */
interface GroupedRow {
  /** Representative y-coordinate for this row. */
  y: number;
  /** Items in this row, sorted by x-coordinate. */
  items: PdfTextItem[];
}

/** A detected column boundary. */
interface ColumnBoundary {
  /** X-coordinate of the column's left edge. */
  x: number;
}

/** A contiguous region of rows that form a table. */
interface TableRegion {
  /** Start index (inclusive) in the rows array. */
  startRow: number;
  /** End index (exclusive) in the rows array. */
  endRow: number;
}

// ── Default values ────────────────────────────────────────────────

/** Default y-coordinate tolerance for same-row grouping. */
const DEFAULT_Y_TOLERANCE = 0.3;

/** Default minimum columns to qualify as a table. */
const DEFAULT_MIN_COLUMNS = 2;

/** Default minimum rows to qualify as a table. */
const DEFAULT_MIN_ROWS = 2;

/** X-coordinate tolerance for column boundary clustering. */
const COLUMN_X_TOLERANCE = 1.0;

// ── Extractor class ───────────────────────────────────────────────

/**
 * Extracts structured table data from PDF documents.
 *
 * Uses the pdfreader library to parse PDF files into text items with
 * spatial coordinates, then applies a multi-step algorithm to detect
 * tables:
 *
 * 1. Parse PDF into text items per page
 * 2. Group items into rows by y-coordinate proximity
 * 3. Detect column boundaries from x-position clustering
 * 4. Find contiguous table regions where rows align with columns
 * 5. Build structured TableData with merged cell detection
 *
 * @extends {BaseExtractor<Required<PdfTableExtractorConfig>, TableExtractionResult[]>}
 * @implements {TableExtractor}
 *
 * @example
 * ```typescript
 * const extractor = new PdfTableExtractor();
 *
 * if (extractor.supports(".pdf")) {
 *   const tables = await extractor.extract("/path/to/document.pdf");
 *   for (const result of tables) {
 *     console.log(`Table on page ${result.pageNumber}, ${result.table.columnCount} columns`);
 *   }
 * }
 * ```
 */
export class PdfTableExtractor
  extends BaseExtractor<Required<PdfTableExtractorConfig>, TableExtractionResult[]>
  implements TableExtractor
{
  /**
   * Creates a new PdfTableExtractor instance.
   *
   * @param config - Optional configuration overrides
   */
  constructor(config?: PdfTableExtractorConfig) {
    super("documents:pdf-table-extractor", {
      maxFileSizeBytes: config?.maxFileSizeBytes ?? DEFAULT_EXTRACTOR_CONFIG.maxFileSizeBytes,
      timeoutMs: config?.timeoutMs ?? DEFAULT_EXTRACTOR_CONFIG.timeoutMs,
      yTolerance: config?.yTolerance ?? DEFAULT_Y_TOLERANCE,
      minColumns: config?.minColumns ?? DEFAULT_MIN_COLUMNS,
      minRows: config?.minRows ?? DEFAULT_MIN_ROWS,
    });
  }

  /**
   * Extract tables from a PDF file.
   *
   * @param filePath - Absolute path to the PDF file
   * @returns Promise resolving to an array of table extraction results
   * @throws {FileAccessError} If file cannot be accessed
   * @throws {FileTooLargeError} If file exceeds maximum size
   * @throws {PasswordProtectedError} If PDF is password-protected
   * @throws {ExtractionError} If PDF parsing fails
   * @throws {ExtractionTimeoutError} If extraction times out
   */
  async extract(filePath: string): Promise<TableExtractionResult[]> {
    const logger = this.getLogger();

    // 1. Validate file access and size
    const stats = await this.getFileStats(filePath);
    this.validateFileSize(stats.size, filePath);

    // 2. Read file buffer
    const buffer = await this.readFileBuffer(filePath);

    // 3. Parse PDF into text items grouped by page
    const pageItems = await this.parsePdfItems(buffer, filePath);

    // 4. Process each page to find tables
    const results: TableExtractionResult[] = [];
    let globalTableIndex = 0;

    for (const [pageNumber, items] of pageItems.entries()) {
      if (items.length === 0) {
        continue;
      }

      // Group items into rows
      const rows = this.groupIntoRows(items);

      // Detect column boundaries across all rows
      const columns = this.detectColumnBoundaries(rows);

      if (columns.length < this.config.minColumns) {
        continue;
      }

      // Find table regions (contiguous runs of aligned rows)
      const regions = this.detectTableRegions(rows, columns);

      // Build TableData for each region
      for (const region of regions) {
        const tableRows = rows.slice(region.startRow, region.endRow);
        const tableData = this.buildTableData(tableRows, columns);

        if (tableData.rows.length >= this.config.minRows) {
          const confidence = this.computeConfidence(tableRows, columns);

          results.push({
            table: tableData,
            filePath,
            sourceType: "pdf",
            pageNumber,
            tableIndex: globalTableIndex,
            confidence,
          });

          globalTableIndex++;
        }
      }
    }

    logger.debug(
      `Extracted ${results.length} table(s) from ${pageItems.size} page(s) of ${filePath}`
    );

    return results;
  }

  /**
   * Check if this extractor supports a given file extension.
   *
   * @param extension - File extension including dot (e.g., ".pdf")
   * @returns true if this extractor can handle the extension
   */
  supports(extension: string): boolean {
    const normalizedExt = extension.toLowerCase();
    return DOCUMENT_EXTENSIONS.pdf.includes(
      normalizedExt as (typeof DOCUMENT_EXTENSIONS.pdf)[number]
    );
  }

  // ── PDF parsing ───────────────────────────────────────────────

  /**
   * Parse a PDF buffer into text items grouped by page number.
   *
   * Wraps pdfreader's callback-based API in a Promise with timeout.
   *
   * @param buffer - PDF file contents
   * @param filePath - File path for error context
   * @returns Map of 1-based page number to array of text items
   */
  private parsePdfItems(buffer: Buffer, filePath: string): Promise<Map<number, PdfTextItem[]>> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const pageItems = new Map<number, PdfTextItem[]>();
      let currentPage = 0;

      const timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(
          new ExtractionTimeoutError(
            `PDF table extraction timed out after ${this.config.timeoutMs}ms`,
            this.config.timeoutMs,
            { filePath, retryable: true }
          )
        );
      }, this.config.timeoutMs);

      const reader = new PdfReader();

      reader.parseBuffer(buffer, (err, item) => {
        if (settled) return;

        if (err) {
          clearTimeout(timeoutId);
          settled = true;

          const errorMessage = typeof err === "string" ? err : String(err);
          const lowerMessage = errorMessage.toLowerCase();

          if (
            lowerMessage.includes("password") ||
            lowerMessage.includes("encrypted") ||
            lowerMessage.includes("decrypt")
          ) {
            reject(
              new PasswordProtectedError("PDF is password-protected and cannot be extracted", {
                filePath,
              })
            );
            return;
          }

          reject(
            new ExtractionError(`Failed to parse PDF for table extraction: ${errorMessage}`, {
              filePath,
            })
          );
          return;
        }

        // null item signals end of file
        if (item === null || item === undefined) {
          clearTimeout(timeoutId);
          if (settled) return;
          settled = true;
          resolve(pageItems);
          return;
        }

        // Page marker (has page property but no text)
        if (item.page !== undefined && item.page !== null) {
          currentPage = item.page;
          if (!pageItems.has(currentPage)) {
            pageItems.set(currentPage, []);
          }
        }

        // Text item
        if (item.text !== undefined && item.text !== null && item.text.trim().length > 0) {
          if (currentPage === 0) {
            currentPage = 1;
            if (!pageItems.has(currentPage)) {
              pageItems.set(currentPage, []);
            }
          }

          const items = pageItems.get(currentPage);
          if (items) {
            items.push({
              text: item.text.trim(),
              x: item.x ?? 0,
              y: item.y ?? 0,
              w: item.w ?? 0,
            });
          }
        }
      });
    });
  }

  // ── Row grouping ──────────────────────────────────────────────

  /**
   * Group text items into rows by y-coordinate proximity.
   *
   * Items whose y-coordinates differ by less than `yTolerance` are
   * placed in the same row. Within each row, items are sorted by
   * x-coordinate.
   *
   * @param items - Text items from a single page
   * @returns Grouped rows sorted by y-coordinate
   */
  private groupIntoRows(items: PdfTextItem[]): GroupedRow[] {
    if (items.length === 0) return [];

    // Sort by y first, then x
    const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);

    const rows: GroupedRow[] = [];
    const firstItem = sorted[0]!;
    let currentRow: GroupedRow = { y: firstItem.y, items: [firstItem] };

    for (let i = 1; i < sorted.length; i++) {
      const item = sorted[i]!;

      if (Math.abs(item.y - currentRow.y) <= this.config.yTolerance) {
        // Same row
        currentRow.items.push(item);
      } else {
        // New row — finalize current
        currentRow.items.sort((a, b) => a.x - b.x);
        rows.push(currentRow);
        currentRow = { y: item.y, items: [item] };
      }
    }

    // Push last row
    currentRow.items.sort((a, b) => a.x - b.x);
    rows.push(currentRow);

    return rows;
  }

  // ── Column detection ──────────────────────────────────────────

  /**
   * Detect column boundaries from all rows' x-positions.
   *
   * Clusters x-coordinates from all items across all rows into
   * column positions using a tolerance-based merge algorithm.
   *
   * @param rows - All grouped rows from a page
   * @returns Sorted array of column boundaries
   */
  private detectColumnBoundaries(rows: GroupedRow[]): ColumnBoundary[] {
    // Collect all x positions
    const allX: number[] = [];
    for (const row of rows) {
      for (const item of row.items) {
        allX.push(item.x);
      }
    }

    if (allX.length === 0) return [];

    // Sort x positions
    allX.sort((a, b) => a - b);

    // Cluster x positions within tolerance
    const clusters: number[][] = [[allX[0]!]];

    for (let i = 1; i < allX.length; i++) {
      const lastCluster = clusters[clusters.length - 1]!;
      const clusterMean = lastCluster.reduce((sum, x) => sum + x, 0) / lastCluster.length;
      const xVal = allX[i]!;

      if (xVal - clusterMean <= COLUMN_X_TOLERANCE) {
        lastCluster.push(xVal);
      } else {
        clusters.push([xVal]);
      }
    }

    // Convert clusters to column boundaries (use mean of cluster)
    return clusters.map((cluster) => ({
      x: cluster.reduce((sum, x) => sum + x, 0) / cluster.length,
    }));
  }

  // ── Table region detection ────────────────────────────────────

  /**
   * Find contiguous regions of rows that align with detected columns.
   *
   * A row is "aligned" if it has at least one item whose x-position
   * (or spanned width) covers column boundaries. The overall column
   * count is already validated before this method is called, so the
   * per-row threshold is kept low to accommodate rows with spanning
   * cells or empty cells (rowSpan continuations).
   *
   * @param rows - All grouped rows from a page
   * @param columns - Detected column boundaries
   * @returns Array of table regions
   */
  private detectTableRegions(rows: GroupedRow[], columns: ColumnBoundary[]): TableRegion[] {
    const regions: TableRegion[] = [];
    let regionStart: number | null = null;

    // Per-row threshold: a row qualifies if its items cover at least
    // minColumns column positions (counting spanned columns).
    // But we use min(minColumns, columns.length) to be safe.
    const perRowThreshold = this.config.minColumns;

    for (let i = 0; i < rows.length; i++) {
      const coveredCount = this.countCoveredColumns(rows[i]!, columns);

      if (coveredCount >= perRowThreshold) {
        if (regionStart === null) {
          regionStart = i;
        }
      } else {
        if (regionStart !== null) {
          const rowCount = i - regionStart;
          if (rowCount >= this.config.minRows) {
            regions.push({ startRow: regionStart, endRow: i });
          }
          regionStart = null;
        }
      }
    }

    // Handle region at end of rows
    if (regionStart !== null) {
      const rowCount = rows.length - regionStart;
      if (rowCount >= this.config.minRows) {
        regions.push({ startRow: regionStart, endRow: rows.length });
      }
    }

    return regions;
  }

  /**
   * Count how many column positions a row's items cover.
   *
   * Unlike a simple item count, this accounts for items whose width
   * spans multiple columns. A single wide item covering 3 column
   * boundaries counts as 3 covered columns.
   *
   * @param row - A grouped row
   * @param columns - Column boundaries
   * @returns Number of distinct column positions covered
   */
  private countCoveredColumns(row: GroupedRow, columns: ColumnBoundary[]): number {
    const coveredSet = new Set<number>();

    for (const item of row.items) {
      const colIdx = this.findNearestColumn(item.x, columns);
      if (colIdx === -1) continue;

      coveredSet.add(colIdx);

      // Also count columns spanned by item width
      if (item.w > 0) {
        const rightEdge = item.x + item.w;
        for (let c = colIdx + 1; c < columns.length; c++) {
          if (rightEdge > columns[c]!.x + COLUMN_X_TOLERANCE) {
            coveredSet.add(c);
          } else {
            break;
          }
        }
      }
    }

    return coveredSet.size;
  }

  /**
   * Find the nearest column index for an x-coordinate.
   *
   * @param x - X-coordinate to match
   * @param columns - Column boundaries
   * @returns Column index, or -1 if no column is within tolerance
   */
  private findNearestColumn(x: number, columns: ColumnBoundary[]): number {
    let bestIndex = -1;
    let bestDist = COLUMN_X_TOLERANCE + 1;

    for (let i = 0; i < columns.length; i++) {
      const dist = Math.abs(x - columns[i]!.x);
      if (dist <= COLUMN_X_TOLERANCE && dist < bestDist) {
        bestDist = dist;
        bestIndex = i;
      }
    }

    return bestIndex;
  }

  // ── Table building ────────────────────────────────────────────

  /**
   * Build structured TableData from table rows and column boundaries.
   *
   * Maps each item to a cell based on its nearest column boundary.
   * Detects column-spanning cells (colSpan) when an item's width
   * extends past the next column boundary.
   *
   * @param tableRows - Rows belonging to a single table region
   * @param columns - Detected column boundaries
   * @returns Structured table data
   */
  private buildTableData(tableRows: GroupedRow[], columns: ColumnBoundary[]): TableData {
    const columnCount = columns.length;
    const builtRows: TableRow[] = [];

    for (let rowIdx = 0; rowIdx < tableRows.length; rowIdx++) {
      const row = tableRows[rowIdx]!;
      const cells: (TableCell | null)[] = new Array<TableCell | null>(columnCount).fill(null);

      for (const item of row.items) {
        const colIdx = this.findNearestColumn(item.x, columns);
        if (colIdx === -1) continue;

        // Detect colSpan: check if item width extends past next column boundaries
        let colSpan = 1;
        if (item.w > 0) {
          const rightEdge = item.x + item.w;
          for (let c = colIdx + 1; c < columns.length; c++) {
            if (rightEdge > columns[c]!.x + COLUMN_X_TOLERANCE) {
              colSpan++;
            } else {
              break;
            }
          }
        }

        const cell: TableCell = {
          content: item.text,
        };

        if (colSpan > 1) {
          cell.colSpan = colSpan;
        }

        cells[colIdx] = cell;
      }

      // Fill empty cells and detect rowSpan
      const finalCells: TableCell[] = [];
      for (let c = 0; c < columnCount; c++) {
        if (cells[c] !== null) {
          finalCells.push(cells[c]!);
        } else {
          // Check if this is a rowSpan from the cell above
          if (rowIdx > 0 && this.isRowSpanCell(rowIdx, c, builtRows, tableRows, columns)) {
            // Increment rowSpan on the cell above — skip this empty cell
            this.incrementRowSpan(rowIdx, c, builtRows);
          } else {
            finalCells.push({ content: "" });
          }
        }
      }

      builtRows.push({
        cells: finalCells,
        isHeader: rowIdx === 0,
      });
    }

    return {
      rows: builtRows,
      columnCount,
    };
  }

  /**
   * Check if an empty cell position is likely a rowSpan continuation.
   *
   * A cell is considered a rowSpan continuation when:
   * - The cell above (in built rows) exists and has content
   * - The current position has no text item
   *
   * @param rowIdx - Current row index in the table region
   * @param colIdx - Column index
   * @param builtRows - Previously built rows
   * @param tableRows - Source grouped rows
   * @param columns - Column boundaries
   * @returns true if this appears to be a rowSpan continuation
   */
  private isRowSpanCell(
    rowIdx: number,
    colIdx: number,
    builtRows: TableRow[],
    _tableRows: GroupedRow[],
    _columns: ColumnBoundary[]
  ): boolean {
    if (rowIdx === 0 || builtRows.length === 0) return false;

    const prevRow = builtRows[builtRows.length - 1]!;
    if (colIdx >= prevRow.cells.length) return false;

    const cellAbove = prevRow.cells[colIdx]!;
    return cellAbove.content.length > 0;
  }

  /**
   * Increment the rowSpan of a cell above the current position.
   *
   * @param _rowIdx - Current row index (unused, for context)
   * @param colIdx - Column index
   * @param builtRows - Previously built rows
   */
  private incrementRowSpan(_rowIdx: number, colIdx: number, builtRows: TableRow[]): void {
    // Walk up to find the cell that starts the span
    for (let r = builtRows.length - 1; r >= 0; r--) {
      const row = builtRows[r]!;
      if (colIdx < row.cells.length) {
        const cell = row.cells[colIdx]!;
        if (cell.content.length > 0) {
          cell.rowSpan = (cell.rowSpan ?? 1) + 1;
          return;
        }
      }
    }
  }

  // ── Confidence scoring ────────────────────────────────────────

  /**
   * Compute a confidence score for a detected table.
   *
   * Score is based on how consistently items align with column
   * boundaries across all rows. A score of 1.0 means every item
   * in every row aligns perfectly with a column boundary.
   *
   * @param tableRows - Rows in the table region
   * @param columns - Detected column boundaries
   * @returns Confidence score between 0.0 and 1.0
   */
  private computeConfidence(tableRows: GroupedRow[], columns: ColumnBoundary[]): number {
    let totalItems = 0;
    let alignedItems = 0;

    for (const row of tableRows) {
      for (const item of row.items) {
        totalItems++;
        if (this.findNearestColumn(item.x, columns) !== -1) {
          alignedItems++;
        }
      }
    }

    if (totalItems === 0) return 0;

    // Round to 2 decimal places
    return Math.round((alignedItems / totalItems) * 100) / 100;
  }
}
