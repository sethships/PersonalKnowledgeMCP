/**
 * Test fixtures for TableContentIndexer tests.
 *
 * Provides builder functions for creating {@link TableExtractionResult}
 * and {@link TableIndexerContext} objects for testing table-to-chunk
 * conversion with various table sizes, structures, and metadata.
 *
 * @module tests/fixtures/documents/table-indexer-fixtures
 */

import type {
  TableExtractionResult,
  TableRow,
  TableSourceType,
} from "../../../src/documents/types.js";
import type { TableIndexerContext } from "../../../src/documents/TableContentIndexer.js";

// ── Context builders ────────────────────────────────────────────────

/**
 * Default context for table indexer tests.
 */
const DEFAULT_CONTEXT: TableIndexerContext = {
  repository: "test-docs",
  filePath: "reports/quarterly.pdf",
  extension: ".pdf",
  fileSizeBytes: 102400,
  fileModifiedAt: new Date("2025-06-15T10:00:00Z"),
  documentType: "pdf",
  documentTitle: "Quarterly Report",
  documentAuthor: "Test Author",
};

/**
 * Create a test context with optional overrides.
 *
 * @param overrides - Partial overrides for the context
 * @returns Complete TableIndexerContext
 */
export function createTestContext(
  overrides?: Partial<TableIndexerContext>
): TableIndexerContext {
  return { ...DEFAULT_CONTEXT, ...overrides };
}

/**
 * Create a DOCX-specific test context.
 *
 * @param overrides - Optional additional overrides
 * @returns Context configured for DOCX documents
 */
export function createDocxContext(
  overrides?: Partial<TableIndexerContext>
): TableIndexerContext {
  return createTestContext({
    filePath: "docs/specification.docx",
    extension: ".docx",
    documentType: "docx",
    documentTitle: "Technical Specification",
    ...overrides,
  });
}

// ── Table builders ──────────────────────────────────────────────────

/**
 * Create a small 2-column, 2-data-row table.
 *
 * Layout:
 * ```
 * Name  | Age
 * Alice | 30
 * Bob   | 25
 * ```
 */
export function createSmallTable(
  overrides?: Partial<TableExtractionResult>
): TableExtractionResult {
  return {
    table: {
      rows: [
        { cells: [{ content: "Name" }, { content: "Age" }], isHeader: true },
        { cells: [{ content: "Alice" }, { content: "30" }] },
        { cells: [{ content: "Bob" }, { content: "25" }] },
      ],
      columnCount: 2,
    },
    filePath: "/docs/test.pdf",
    sourceType: "pdf",
    tableIndex: 0,
    confidence: 0.95,
    ...overrides,
  };
}

/**
 * Create a table with a caption.
 *
 * @param caption - Caption text
 * @param overrides - Additional overrides
 */
export function createTableWithCaption(
  caption: string = "Employee Directory",
  overrides?: Partial<TableExtractionResult>
): TableExtractionResult {
  const base = createSmallTable(overrides);
  return {
    ...base,
    table: {
      ...base.table,
      caption,
    },
  };
}

/**
 * Create a large table that will exceed the default 500-token limit.
 *
 * Generates a table with the specified number of data rows,
 * each containing 4 columns of descriptive text.
 *
 * @param rowCount - Number of data rows (default 50)
 * @param overrides - Additional overrides
 */
export function createLargeTable(
  rowCount: number = 50,
  overrides?: Partial<TableExtractionResult>
): TableExtractionResult {
  const headerRow: TableRow = {
    cells: [
      { content: "Employee ID" },
      { content: "Full Name" },
      { content: "Department" },
      { content: "Annual Salary" },
    ],
    isHeader: true,
  };

  const dataRows: TableRow[] = [];
  for (let i = 0; i < rowCount; i++) {
    dataRows.push({
      cells: [
        { content: `EMP-${String(i + 1).padStart(4, "0")}` },
        { content: `Employee Number ${i + 1} with a longer name` },
        { content: `Department of Engineering and Research ${i + 1}` },
        { content: `$${(50000 + i * 1000).toLocaleString()}` },
      ],
    });
  }

  return {
    table: {
      rows: [headerRow, ...dataRows],
      columnCount: 4,
    },
    filePath: "/docs/employees.pdf",
    sourceType: "pdf",
    tableIndex: 0,
    confidence: 0.92,
    ...overrides,
  };
}

/**
 * Create a PDF table with a page number.
 *
 * @param pageNumber - 1-based page number
 * @param tableIndex - 0-based table index
 * @param overrides - Additional overrides
 */
export function createPdfTableWithPage(
  pageNumber: number = 3,
  tableIndex: number = 0,
  overrides?: Partial<TableExtractionResult>
): TableExtractionResult {
  return createSmallTable({
    pageNumber,
    tableIndex,
    sourceType: "pdf",
    ...overrides,
  });
}

/**
 * Create a DOCX table extraction result (no page number).
 *
 * @param tableIndex - 0-based table index
 * @param overrides - Additional overrides
 */
export function createDocxTable(
  tableIndex: number = 0,
  overrides?: Partial<TableExtractionResult>
): TableExtractionResult {
  return createSmallTable({
    filePath: "/docs/spec.docx",
    sourceType: "docx",
    tableIndex,
    pageNumber: undefined,
    ...overrides,
  });
}

/**
 * Create a set of multiple tables as if from a single document.
 *
 * @param count - Number of tables (default 3)
 * @param sourceType - Source type (default "pdf")
 */
export function createMultipleTableResults(
  count: number = 3,
  sourceType: TableSourceType = "pdf"
): TableExtractionResult[] {
  const results: TableExtractionResult[] = [];

  for (let i = 0; i < count; i++) {
    results.push({
      table: {
        rows: [
          {
            cells: [{ content: `Header ${i}A` }, { content: `Header ${i}B` }],
            isHeader: true,
          },
          {
            cells: [{ content: `Data ${i}A` }, { content: `Data ${i}B` }],
          },
        ],
        columnCount: 2,
      },
      filePath: sourceType === "pdf" ? "/docs/multi.pdf" : "/docs/multi.docx",
      sourceType,
      tableIndex: i,
      pageNumber: sourceType === "pdf" ? i + 1 : undefined,
      confidence: 0.9 + i * 0.02,
    });
  }

  return results;
}

/**
 * Create a header-only table (no data rows).
 */
export function createHeaderOnlyTable(
  overrides?: Partial<TableExtractionResult>
): TableExtractionResult {
  return {
    table: {
      rows: [
        {
          cells: [{ content: "Column A" }, { content: "Column B" }, { content: "Column C" }],
          isHeader: true,
        },
      ],
      columnCount: 3,
    },
    filePath: "/docs/empty-data.pdf",
    sourceType: "pdf",
    tableIndex: 0,
    ...overrides,
  };
}

/**
 * Create a table with no header rows.
 */
export function createNoHeaderTable(
  overrides?: Partial<TableExtractionResult>
): TableExtractionResult {
  return {
    table: {
      rows: [
        { cells: [{ content: "Value A1" }, { content: "Value B1" }] },
        { cells: [{ content: "Value A2" }, { content: "Value B2" }] },
      ],
      columnCount: 2,
    },
    filePath: "/docs/no-header.pdf",
    sourceType: "pdf",
    tableIndex: 0,
    ...overrides,
  };
}

/**
 * Create a single-row (data) table.
 */
export function createSingleRowTable(
  overrides?: Partial<TableExtractionResult>
): TableExtractionResult {
  return {
    table: {
      rows: [
        { cells: [{ content: "Name" }, { content: "Value" }], isHeader: true },
        { cells: [{ content: "Total" }, { content: "42" }] },
      ],
      columnCount: 2,
    },
    filePath: "/docs/single-row.pdf",
    sourceType: "pdf",
    tableIndex: 0,
    ...overrides,
  };
}

/**
 * Create an empty table (no rows at all).
 */
export function createEmptyTable(
  overrides?: Partial<TableExtractionResult>
): TableExtractionResult {
  return {
    table: {
      rows: [],
      columnCount: 0,
    },
    filePath: "/docs/empty.pdf",
    sourceType: "pdf",
    tableIndex: 0,
    ...overrides,
  };
}

/**
 * Create a table without confidence score.
 */
export function createTableWithoutConfidence(
  overrides?: Partial<TableExtractionResult>
): TableExtractionResult {
  const { confidence: _, ...base } = createSmallTable(overrides);
  return base as TableExtractionResult;
}
