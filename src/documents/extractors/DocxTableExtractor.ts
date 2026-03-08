/**
 * DOCX table extractor using mammoth HTML conversion.
 *
 * Extracts structured table data from DOCX files by converting to HTML
 * via mammoth, then parsing `<table>` elements with @xmldom/xmldom.
 * Handles `<th>`/`<td>` elements, colspan/rowspan attributes, and
 * nested tables (flattened into parent cell content).
 *
 * @module documents/extractors/DocxTableExtractor
 */

import mammoth from "mammoth";
import { DOMParser } from "@xmldom/xmldom";
import { DOCUMENT_EXTENSIONS, DEFAULT_EXTRACTOR_CONFIG } from "../constants.js";
import { ExtractionError, ExtractionTimeoutError, UnsupportedFormatError } from "../errors.js";
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
 * Configuration for the DOCX table extractor.
 *
 * Extends {@link TableExtractorConfig} with DOCX-specific options.
 * Currently inherits only `maxFileSizeBytes` and `timeoutMs`.
 *
 * @example
 * ```typescript
 * const config: DocxTableExtractorConfig = {
 *   maxFileSizeBytes: 52428800,
 *   timeoutMs: 30000,
 * };
 * ```
 */
export interface DocxTableExtractorConfig extends TableExtractorConfig {
  // No DOCX-specific options needed initially.
  // TableExtractorConfig provides maxFileSizeBytes and timeoutMs.
}

/** OLE2 Compound Document signature for legacy .doc files. */
const OLE2_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

// ── Extractor class ───────────────────────────────────────────────

/**
 * Extracts structured table data from DOCX documents.
 *
 * Uses mammoth to convert the DOCX to HTML, then parses `<table>` elements
 * using @xmldom/xmldom. Because DOCX is a structured format, the HTML output
 * contains proper `<table>`, `<tr>`, `<th>`, `<td>` elements with `colspan`
 * and `rowspan` attributes, making extraction reliable (confidence = 1.0).
 *
 * @extends {BaseExtractor<Required<DocxTableExtractorConfig>, TableExtractionResult[]>}
 * @implements {TableExtractor}
 *
 * @example
 * ```typescript
 * const extractor = new DocxTableExtractor();
 *
 * if (extractor.supports(".docx")) {
 *   const tables = await extractor.extract("/path/to/document.docx");
 *   for (const result of tables) {
 *     console.log(`Table ${result.tableIndex}, ${result.table.columnCount} columns`);
 *   }
 * }
 * ```
 */
export class DocxTableExtractor
  extends BaseExtractor<Required<DocxTableExtractorConfig>, TableExtractionResult[]>
  implements TableExtractor
{
  /**
   * Creates a new DocxTableExtractor instance.
   *
   * @param config - Optional configuration overrides
   */
  constructor(config?: DocxTableExtractorConfig) {
    super("documents:docx-table-extractor", {
      maxFileSizeBytes: config?.maxFileSizeBytes ?? DEFAULT_EXTRACTOR_CONFIG.maxFileSizeBytes,
      timeoutMs: config?.timeoutMs ?? DEFAULT_EXTRACTOR_CONFIG.timeoutMs,
    });
  }

  /**
   * Extract tables from a DOCX file.
   *
   * @param filePath - Absolute path to the DOCX file
   * @returns Promise resolving to an array of table extraction results
   * @throws {FileAccessError} If file cannot be accessed
   * @throws {FileTooLargeError} If file exceeds maximum size
   * @throws {UnsupportedFormatError} If file is a legacy .doc format
   * @throws {ExtractionError} If DOCX parsing fails
   * @throws {ExtractionTimeoutError} If extraction times out
   */
  async extract(filePath: string): Promise<TableExtractionResult[]> {
    const logger = this.getLogger();

    // 1. Validate file access and size
    const stats = await this.getFileStats(filePath);
    this.validateFileSize(stats.size, filePath);

    // 2. Read file buffer
    const buffer = await this.readFileBuffer(filePath);

    // 3. Check for legacy .doc format (OLE2 compound document)
    if (buffer.length >= OLE2_SIGNATURE.length && buffer.subarray(0, 8).equals(OLE2_SIGNATURE)) {
      throw new UnsupportedFormatError(
        "Legacy .doc format is not supported. Please convert to .docx",
        ".doc",
        { filePath }
      );
    }

    // 4. Convert to HTML with timeout
    const html = await this.convertToHtml(buffer, filePath);

    // 5. Parse HTML tables
    const results = this.parseHtmlTables(html, filePath);

    logger.debug(`Extracted ${results.length} table(s) from ${filePath}`);

    return results;
  }

  /**
   * Check if this extractor supports a given file extension.
   *
   * @param extension - File extension including dot (e.g., ".docx")
   * @returns true if this extractor can handle the extension
   */
  supports(extension: string): boolean {
    const normalizedExt = extension.toLowerCase();
    return DOCUMENT_EXTENSIONS.docx.includes(
      normalizedExt as (typeof DOCUMENT_EXTENSIONS.docx)[number]
    );
  }

  // ── HTML conversion ──────────────────────────────────────────────

  /**
   * Convert DOCX buffer to HTML using mammoth with timeout protection.
   *
   * @param buffer - DOCX file contents
   * @param filePath - File path for error context
   * @returns HTML string from mammoth conversion
   */
  private convertToHtml(buffer: Buffer, filePath: string): Promise<string> {
    let settled = false;

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        // NOTE: In-flight mammoth operations continue in background after timeout.
        // Neither mammoth nor the JS runtime provides a cancellation mechanism.
        // Consider worker threads for isolation if this becomes a production issue.
        reject(
          new ExtractionTimeoutError(
            `DOCX table extraction timed out after ${this.config.timeoutMs}ms`,
            this.config.timeoutMs,
            { filePath, retryable: true }
          )
        );
      }, this.config.timeoutMs);

      mammoth
        .convertToHtml({ buffer })
        .then((result) => {
          clearTimeout(timeoutId);
          if (settled) return;
          settled = true;
          resolve(result.value);
        })
        .catch((error: Error) => {
          clearTimeout(timeoutId);
          if (settled) return;
          settled = true;
          reject(
            new ExtractionError(`Failed to extract DOCX tables: ${error.message}`, {
              filePath,
              cause: error,
            })
          );
        });
    });
  }

  // ── HTML table parsing ───────────────────────────────────────────

  /**
   * Parse HTML string to extract all top-level tables.
   *
   * @param html - HTML output from mammoth
   * @param filePath - Source file path for results
   * @returns Array of table extraction results
   */
  private parseHtmlTables(html: string, filePath: string): TableExtractionResult[] {
    // Wrap in a root element for valid XML parsing
    const wrappedHtml = `<root>${html}</root>`;
    const logger = this.getLogger();
    const doc = new DOMParser({
      errorHandler: {
        warning: () => {},
        error: (msg: string) => {
          logger.debug(`DOMParser error (ignored): ${msg}`);
        },
        fatalError: () => {},
      },
    }).parseFromString(wrappedHtml, "text/html");

    const results: TableExtractionResult[] = [];
    const tables = this.getTopLevelTables(doc);

    for (let i = 0; i < tables.length; i++) {
      const tableElement = tables[i]!;
      const tableData = this.parseTableElement(tableElement);

      if (tableData.rows.length > 0) {
        results.push({
          table: tableData,
          filePath,
          sourceType: "docx",
          tableIndex: i,
          confidence: 1.0,
        });
      }
    }

    return results;
  }

  /**
   * Get top-level table elements, excluding tables nested inside other tables.
   *
   * @param doc - Parsed DOM document
   * @returns Array of top-level table elements
   */
  private getTopLevelTables(doc: Document): Element[] {
    const allTables = doc.getElementsByTagName("table");
    const topLevel: Element[] = [];

    for (let i = 0; i < allTables.length; i++) {
      const table = allTables[i]!;
      if (!this.hasTableAncestor(table)) {
        topLevel.push(table);
      }
    }

    return topLevel;
  }

  /**
   * Check if an element has a `<table>` ancestor (i.e., is nested).
   *
   * @param element - DOM element to check
   * @returns true if element is inside another table
   */
  private hasTableAncestor(element: Element): boolean {
    let parent = element.parentNode;
    while (parent) {
      if (parent.nodeName?.toLowerCase() === "table") {
        return true;
      }
      parent = parent.parentNode;
    }
    return false;
  }

  /**
   * Parse a single `<table>` element into structured TableData.
   *
   * @param tableElement - DOM table element
   * @returns Parsed table data
   */
  private parseTableElement(tableElement: Element): TableData {
    const rows: TableRow[] = [];
    let maxColumns = 0;

    // Get all direct <tr> children (may be inside <thead>, <tbody>, <tfoot>)
    const trElements = tableElement.getElementsByTagName("tr");

    for (let i = 0; i < trElements.length; i++) {
      const tr = trElements[i]!;

      // Skip <tr> elements from nested tables
      if (this.getClosestTable(tr) !== tableElement) {
        continue;
      }

      const { cells, hasHeaderCells } = this.parseRowCells(tr, tableElement);
      const effectiveColumnCount = cells.reduce((sum, cell) => sum + (cell.colSpan ?? 1), 0);

      if (effectiveColumnCount > maxColumns) {
        maxColumns = effectiveColumnCount;
      }

      rows.push({
        cells,
        isHeader: hasHeaderCells,
      });
    }

    return {
      rows,
      columnCount: maxColumns,
    };
  }

  /**
   * Parse cells from a `<tr>` element.
   *
   * Reads `<th>` and `<td>` elements, extracting text content,
   * colspan, and rowspan. Nested tables are flattened to text.
   *
   * @param tr - DOM tr element
   * @param ownerTable - The top-level table element this row belongs to
   * @returns Object with cells array and whether any cells are header cells
   */
  private parseRowCells(
    tr: Element,
    ownerTable: Element
  ): { cells: TableCell[]; hasHeaderCells: boolean } {
    const cells: TableCell[] = [];
    let hasHeaderCells = false;

    const childNodes = tr.childNodes;
    for (let i = 0; i < childNodes.length; i++) {
      const node = childNodes[i]!;
      const nodeName = node.nodeName?.toLowerCase();

      if (nodeName !== "th" && nodeName !== "td") {
        continue;
      }

      const cellElement = node as Element;

      if (nodeName === "th") {
        hasHeaderCells = true;
      }

      // Extract text content, flattening nested tables
      const content = this.extractCellText(cellElement, ownerTable).trim();

      const cell: TableCell = { content };

      // Read colspan attribute
      const colSpanAttr = cellElement.getAttribute("colspan");
      if (colSpanAttr) {
        const colSpan = parseInt(colSpanAttr, 10);
        if (!isNaN(colSpan) && colSpan > 1) {
          cell.colSpan = colSpan;
        }
      }

      // Read rowspan attribute
      const rowSpanAttr = cellElement.getAttribute("rowspan");
      if (rowSpanAttr) {
        const rowSpan = parseInt(rowSpanAttr, 10);
        if (!isNaN(rowSpan) && rowSpan > 1) {
          cell.rowSpan = rowSpan;
        }
      }

      cells.push(cell);
    }

    return { cells, hasHeaderCells };
  }

  /**
   * Extract text content from a cell element.
   *
   * If the cell contains a nested table, the nested table's content
   * is flattened to text (rows separated by spaces, cells separated
   * by spaces). Other HTML tags are stripped.
   *
   * @param cellElement - DOM td/th element
   * @param ownerTable - The top-level table to identify nested tables
   * @returns Plain text content of the cell
   */
  private extractCellText(cellElement: Element, ownerTable: Element): string {
    // Check if cell contains nested tables
    const nestedTables = cellElement.getElementsByTagName("table");
    if (nestedTables.length > 0) {
      return this.flattenNestedContent(cellElement, ownerTable);
    }

    // No nested tables — extract text content directly
    return this.getTextContent(cellElement);
  }

  /**
   * Flatten cell content that includes nested tables into plain text.
   *
   * Walks child nodes: text nodes are taken as-is, nested table elements
   * have their cell contents joined with spaces, other elements recurse.
   *
   * @param element - DOM element to flatten
   * @param ownerTable - The top-level table
   * @returns Flattened text
   */
  private flattenNestedContent(element: Element, ownerTable: Element): string {
    const parts: string[] = [];

    const childNodes = element.childNodes;
    for (let i = 0; i < childNodes.length; i++) {
      const child = childNodes[i]!;

      if (child.nodeType === 3) {
        // Text node
        const text = child.nodeValue?.trim();
        if (text) {
          parts.push(text);
        }
      } else if (child.nodeName?.toLowerCase() === "table") {
        // Nested table — flatten all its cell text
        const nestedText = this.getTextContent(child as Element);
        if (nestedText.trim()) {
          parts.push(nestedText.trim());
        }
      } else if (child.nodeType === 1) {
        // Other element — recurse
        const text = this.flattenNestedContent(child as Element, ownerTable);
        if (text.trim()) {
          parts.push(text.trim());
        }
      }
    }

    return parts.join(" ");
  }

  /**
   * Get text content from a DOM element, stripping all HTML tags.
   *
   * @param element - DOM element
   * @returns Plain text content
   */
  private getTextContent(element: Element | Node): string {
    if (element.nodeType === 3) {
      return element.nodeValue ?? "";
    }

    let text = "";
    const children = element.childNodes;
    for (let i = 0; i < children.length; i++) {
      text += this.getTextContent(children[i]!);
    }
    return text;
  }

  /**
   * Find the closest ancestor `<table>` element for a given element.
   *
   * @param element - DOM element
   * @returns The closest table ancestor, or null
   */
  private getClosestTable(element: Element): Element | null {
    let parent = element.parentNode;
    while (parent) {
      if (parent.nodeName?.toLowerCase() === "table") {
        return parent as Element;
      }
      parent = parent.parentNode;
    }
    return null;
  }
}
