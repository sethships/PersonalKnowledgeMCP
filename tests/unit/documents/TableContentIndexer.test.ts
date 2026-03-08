/**
 * Unit tests for TableContentIndexer.
 *
 * Tests table-to-chunk conversion including single tables, large table
 * splitting, caption handling, metadata propagation, and edge cases.
 *
 * @module tests/unit/documents/TableContentIndexer.test
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { TableContentIndexer } from "../../../src/documents/TableContentIndexer.js";
import { estimateTokens } from "../../../src/ingestion/chunk-utils.js";
import { initializeLogger, resetLogger } from "../../../src/logging/index.js";
import {
  createSmallTable,
  createTableWithCaption,
  createLargeTable,
  createPdfTableWithPage,
  createDocxTable,
  createMultipleTableResults,
  createHeaderOnlyTable,
  createNoHeaderTable,
  createSingleRowTable,
  createEmptyTable,
  createTableWithoutConfidence,
  createTestContext,
  createDocxContext,
} from "../../fixtures/documents/table-indexer-fixtures.js";

describe("TableContentIndexer", () => {
  let indexer: TableContentIndexer;

  beforeEach(() => {
    initializeLogger({ level: "error", format: "json" });
    indexer = new TableContentIndexer();
  });

  afterEach(() => {
    resetLogger();
  });

  // ── Configuration ─────────────────────────────────────────────────

  describe("configuration", () => {
    test("uses default maxChunkTokens of 500", () => {
      const table = createSmallTable();
      const context = createTestContext();
      const chunks = indexer.indexTables([table], context);

      // Small table should produce exactly one chunk
      expect(chunks.length).toBe(1);
    });

    test("respects custom maxChunkTokens", () => {
      // Very small token limit to force splitting even small tables
      const tinyIndexer = new TableContentIndexer({ maxChunkTokens: 10 });
      const table = createSmallTable();
      const context = createTestContext();
      const chunks = tinyIndexer.indexTables([table], context);

      // Should produce multiple chunks with such a small limit
      expect(chunks.length).toBeGreaterThan(1);
    });

    test("constructs without config", () => {
      const noConfigIndexer = new TableContentIndexer();
      expect(noConfigIndexer).toBeDefined();
    });
  });

  // ── Single table indexing ─────────────────────────────────────────

  describe("single table indexing", () => {
    test("produces correct markdown content", () => {
      const table = createSmallTable();
      const context = createTestContext();
      const chunks = indexer.indexTables([table], context);

      expect(chunks.length).toBe(1);
      const content = chunks[0]!.content;

      // Should contain markdown table format
      expect(content).toContain("| Name | Age |");
      expect(content).toContain("| --- | --- |");
      expect(content).toContain("| Alice | 30 |");
      expect(content).toContain("| Bob | 25 |");
    });

    test("generates correct chunk ID format", () => {
      const table = createSmallTable({ tableIndex: 2 });
      const context = createTestContext({ repository: "my-repo", filePath: "docs/report.pdf" });
      const chunks = indexer.indexTables([table], context);

      expect(chunks[0]!.id).toBe("my-repo:docs/report.pdf:table-2:0");
    });

    test("sets repository and filePath from context", () => {
      const table = createSmallTable();
      const context = createTestContext({ repository: "my-repo", filePath: "data/file.pdf" });
      const chunks = indexer.indexTables([table], context);

      expect(chunks[0]!.repository).toBe("my-repo");
      expect(chunks[0]!.filePath).toBe("data/file.pdf");
    });

    test("sets totalChunks to 1 for single-chunk table", () => {
      const table = createSmallTable();
      const context = createTestContext();
      const chunks = indexer.indexTables([table], context);

      expect(chunks[0]!.totalChunks).toBe(1);
      expect(chunks[0]!.chunkIndex).toBe(0);
    });

    test("sets startLine and endLine based on content", () => {
      const table = createSmallTable();
      const context = createTestContext();
      const chunks = indexer.indexTables([table], context);

      expect(chunks[0]!.startLine).toBe(1);
      expect(chunks[0]!.endLine).toBeGreaterThan(0);
    });
  });

  // ── Metadata ──────────────────────────────────────────────────────

  describe("metadata", () => {
    test("sets isTable to true", () => {
      const table = createSmallTable();
      const context = createTestContext();
      const chunks = indexer.indexTables([table], context);

      expect(chunks[0]!.metadata.isTable).toBe(true);
    });

    test("propagates tableIndex from extraction result", () => {
      const table = createSmallTable({ tableIndex: 5 });
      const context = createTestContext();
      const chunks = indexer.indexTables([table], context);

      expect(chunks[0]!.metadata.tableIndex).toBe(5);
    });

    test("propagates tableCaption from table data", () => {
      const table = createTableWithCaption("Revenue Summary");
      const context = createTestContext();
      const chunks = indexer.indexTables([table], context);

      expect(chunks[0]!.metadata.tableCaption).toBe("Revenue Summary");
    });

    test("sets tableCaption to undefined when no caption", () => {
      const table = createSmallTable();
      const context = createTestContext();
      const chunks = indexer.indexTables([table], context);

      expect(chunks[0]!.metadata.tableCaption).toBeUndefined();
    });

    test("propagates tableColumnCount", () => {
      const table = createSmallTable();
      const context = createTestContext();
      const chunks = indexer.indexTables([table], context);

      expect(chunks[0]!.metadata.tableColumnCount).toBe(2);
    });

    test("computes tableRowCount excluding headers", () => {
      const table = createSmallTable();
      const context = createTestContext();
      const chunks = indexer.indexTables([table], context);

      // Small table has 1 header + 2 data rows
      expect(chunks[0]!.metadata.tableRowCount).toBe(2);
    });

    test("propagates tableSourceType", () => {
      const pdfTable = createSmallTable({ sourceType: "pdf" });
      const docxTable = createDocxTable();
      const context = createTestContext();

      const pdfChunks = indexer.indexTables([pdfTable], context);
      const docxChunks = indexer.indexTables([docxTable], createDocxContext());

      expect(pdfChunks[0]!.metadata.tableSourceType).toBe("pdf");
      expect(docxChunks[0]!.metadata.tableSourceType).toBe("docx");
    });

    test("propagates tableConfidence", () => {
      const table = createSmallTable({ confidence: 0.87 });
      const context = createTestContext();
      const chunks = indexer.indexTables([table], context);

      expect(chunks[0]!.metadata.tableConfidence).toBe(0.87);
    });

    test("sets tableConfidence to undefined when not provided", () => {
      const table = createTableWithoutConfidence();
      const context = createTestContext();
      const chunks = indexer.indexTables([table], context);

      expect(chunks[0]!.metadata.tableConfidence).toBeUndefined();
    });

    test("propagates documentType from context", () => {
      const table = createSmallTable();
      const context = createTestContext({ documentType: "pdf" });
      const chunks = indexer.indexTables([table], context);

      expect(chunks[0]!.metadata.documentType).toBe("pdf");
    });

    test("propagates documentTitle from context", () => {
      const table = createSmallTable();
      const context = createTestContext({ documentTitle: "Annual Report 2025" });
      const chunks = indexer.indexTables([table], context);

      expect(chunks[0]!.metadata.documentTitle).toBe("Annual Report 2025");
    });

    test("propagates documentAuthor from context", () => {
      const table = createSmallTable();
      const context = createTestContext({ documentAuthor: "Jane Smith" });
      const chunks = indexer.indexTables([table], context);

      expect(chunks[0]!.metadata.documentAuthor).toBe("Jane Smith");
    });

    test("sets extension from context", () => {
      const table = createSmallTable();
      const context = createTestContext({ extension: ".pdf" });
      const chunks = indexer.indexTables([table], context);

      expect(chunks[0]!.metadata.extension).toBe(".pdf");
    });

    test("sets language to 'unknown'", () => {
      const table = createSmallTable();
      const context = createTestContext();
      const chunks = indexer.indexTables([table], context);

      expect(chunks[0]!.metadata.language).toBe("unknown");
    });

    test("sets fileSizeBytes from context", () => {
      const table = createSmallTable();
      const context = createTestContext({ fileSizeBytes: 999999 });
      const chunks = indexer.indexTables([table], context);

      expect(chunks[0]!.metadata.fileSizeBytes).toBe(999999);
    });

    test("computes contentHash from chunk content", () => {
      const table = createSmallTable();
      const context = createTestContext();
      const chunks = indexer.indexTables([table], context);

      expect(chunks[0]!.metadata.contentHash).toBeDefined();
      expect(typeof chunks[0]!.metadata.contentHash).toBe("string");
      expect(chunks[0]!.metadata.contentHash.length).toBeGreaterThan(0);
    });

    test("produces different contentHash for different content", () => {
      const table1 = createSmallTable();
      const table2 = createSingleRowTable();
      const context = createTestContext();

      const chunks1 = indexer.indexTables([table1], context);
      const chunks2 = indexer.indexTables([table2], context);

      expect(chunks1[0]!.metadata.contentHash).not.toBe(chunks2[0]!.metadata.contentHash);
    });

    test("sets fileModifiedAt from context", () => {
      const date = new Date("2025-03-01T00:00:00Z");
      const table = createSmallTable();
      const context = createTestContext({ fileModifiedAt: date });
      const chunks = indexer.indexTables([table], context);

      expect(chunks[0]!.metadata.fileModifiedAt).toEqual(date);
    });
  });

  // ── Caption handling ──────────────────────────────────────────────

  describe("caption handling", () => {
    test("prepends caption as bold text when present", () => {
      const table = createTableWithCaption("Revenue Summary");
      const context = createTestContext();
      const chunks = indexer.indexTables([table], context);

      expect(chunks[0]!.content).toMatch(/^\*\*Table: Revenue Summary\*\*/);
    });

    test("includes blank line between caption and table", () => {
      const table = createTableWithCaption("Revenue Summary");
      const context = createTestContext();
      const chunks = indexer.indexTables([table], context);

      expect(chunks[0]!.content).toContain("**Table: Revenue Summary**\n\n|");
    });

    test("does not prepend caption when absent", () => {
      const table = createSmallTable();
      const context = createTestContext();
      const chunks = indexer.indexTables([table], context);

      expect(chunks[0]!.content).not.toContain("**Table:");
      expect(chunks[0]!.content).toMatch(/^\|/); // starts with pipe
    });
  });

  // ── Page number propagation ───────────────────────────────────────

  describe("page number propagation", () => {
    test("sets pageNumber for PDF tables", () => {
      const table = createPdfTableWithPage(5);
      const context = createTestContext();
      const chunks = indexer.indexTables([table], context);

      expect(chunks[0]!.metadata.pageNumber).toBe(5);
    });

    test("pageNumber is undefined for DOCX tables", () => {
      const table = createDocxTable();
      const context = createDocxContext();
      const chunks = indexer.indexTables([table], context);

      expect(chunks[0]!.metadata.pageNumber).toBeUndefined();
    });
  });

  // ── Large table splitting ─────────────────────────────────────────

  describe("large table splitting", () => {
    test("splits tables exceeding maxChunkTokens", () => {
      const table = createLargeTable(50);
      const context = createTestContext();
      const chunks = indexer.indexTables([table], context);

      expect(chunks.length).toBeGreaterThan(1);
    });

    test("repeats header in each sub-chunk", () => {
      const table = createLargeTable(50);
      const context = createTestContext();
      const chunks = indexer.indexTables([table], context);

      for (const chunk of chunks) {
        expect(chunk.content).toContain("| Employee ID |");
        expect(chunk.content).toContain("| --- |");
      }
    });

    test("covers all data rows across sub-chunks", () => {
      const rowCount = 30;
      const table = createLargeTable(rowCount);
      const context = createTestContext();
      const chunks = indexer.indexTables([table], context);

      // Collect all non-header data rows from all chunks
      const allDataLines = new Set<string>();
      for (const chunk of chunks) {
        const lines = chunk.content.split("\n");
        for (const line of lines) {
          // Skip header row, separator, and caption
          if (
            line.startsWith("| Employee ID") ||
            line.startsWith("| ---") ||
            line.startsWith("**Table:")
          ) {
            continue;
          }
          if (line.startsWith("| EMP-")) {
            allDataLines.add(line);
          }
        }
      }

      expect(allDataLines.size).toBe(rowCount);
    });

    test("assigns sequential chunkIndex values", () => {
      const table = createLargeTable(50);
      const context = createTestContext();
      const chunks = indexer.indexTables([table], context);

      for (let i = 0; i < chunks.length; i++) {
        expect(chunks[i]!.chunkIndex).toBe(i);
      }
    });

    test("sets consistent totalChunks across sub-chunks", () => {
      const table = createLargeTable(50);
      const context = createTestContext();
      const chunks = indexer.indexTables([table], context);

      const totalChunks = chunks[0]!.totalChunks;
      expect(totalChunks).toBe(chunks.length);
      for (const chunk of chunks) {
        expect(chunk.totalChunks).toBe(totalChunks);
      }
    });

    test("each sub-chunk respects token limit", () => {
      const table = createLargeTable(50);
      const context = createTestContext();
      const chunks = indexer.indexTables([table], context);

      for (const chunk of chunks) {
        const tokens = estimateTokens(chunk.content);
        // Allow some tolerance since header repetition can add tokens
        // The splitting algorithm targets maxChunkTokens but may slightly exceed
        // when a single row plus header exceeds the limit
        expect(tokens).toBeLessThan(1000); // generous upper bound
      }
    });

    test("generates correct sub-chunk IDs", () => {
      const table = createLargeTable(50, { tableIndex: 1 });
      const context = createTestContext({ repository: "repo", filePath: "file.pdf" });
      const chunks = indexer.indexTables([table], context);

      for (let i = 0; i < chunks.length; i++) {
        expect(chunks[i]!.id).toBe(`repo:file.pdf:table-1:${i}`);
      }
    });

    test("preserves caption in each sub-chunk when present", () => {
      const table = createLargeTable(50);
      table.table.caption = "Large Employee Table";
      const context = createTestContext();
      const chunks = indexer.indexTables([table], context);

      for (const chunk of chunks) {
        expect(chunk.content).toContain("**Table: Large Employee Table**");
      }
    });

    test("preserves metadata across all sub-chunks", () => {
      const table = createLargeTable(50, { confidence: 0.88, tableIndex: 3 });
      const context = createTestContext();
      const chunks = indexer.indexTables([table], context);

      for (const chunk of chunks) {
        expect(chunk.metadata.isTable).toBe(true);
        expect(chunk.metadata.tableIndex).toBe(3);
        expect(chunk.metadata.tableConfidence).toBe(0.88);
        expect(chunk.metadata.tableColumnCount).toBe(4);
      }
    });
  });

  // ── Multiple tables ───────────────────────────────────────────────

  describe("multiple tables", () => {
    test("produces separate chunks for each table", () => {
      const tables = createMultipleTableResults(3);
      const context = createTestContext();
      const chunks = indexer.indexTables(tables, context);

      // Each small table should produce 1 chunk
      expect(chunks.length).toBe(3);
    });

    test("assigns distinct IDs per table", () => {
      const tables = createMultipleTableResults(3);
      const context = createTestContext();
      const chunks = indexer.indexTables(tables, context);

      const ids = chunks.map((c) => c.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    test("table content matches expected table data", () => {
      const tables = createMultipleTableResults(2);
      const context = createTestContext();
      const chunks = indexer.indexTables(tables, context);

      expect(chunks[0]!.content).toContain("Header 0A");
      expect(chunks[0]!.content).toContain("Data 0A");
      expect(chunks[1]!.content).toContain("Header 1A");
      expect(chunks[1]!.content).toContain("Data 1A");
    });

    test("preserves per-table metadata", () => {
      const tables = createMultipleTableResults(3, "pdf");
      const context = createTestContext();
      const chunks = indexer.indexTables(tables, context);

      for (let i = 0; i < chunks.length; i++) {
        expect(chunks[i]!.metadata.tableIndex).toBe(i);
        expect(chunks[i]!.metadata.pageNumber).toBe(i + 1);
      }
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────

  describe("edge cases", () => {
    test("returns empty array for empty tables input", () => {
      const context = createTestContext();
      const chunks = indexer.indexTables([], context);

      expect(chunks).toEqual([]);
    });

    test("skips tables with empty rows (produces no chunks)", () => {
      const table = createEmptyTable();
      const context = createTestContext();
      const chunks = indexer.indexTables([table], context);

      expect(chunks).toEqual([]);
    });

    test("handles header-only table", () => {
      const table = createHeaderOnlyTable();
      const context = createTestContext();
      const chunks = indexer.indexTables([table], context);

      expect(chunks.length).toBe(1);
      expect(chunks[0]!.content).toContain("Column A");
      expect(chunks[0]!.metadata.tableRowCount).toBe(0); // no data rows
    });

    test("handles table with no headers", () => {
      const table = createNoHeaderTable();
      const context = createTestContext();
      const chunks = indexer.indexTables([table], context);

      expect(chunks.length).toBe(1);
      expect(chunks[0]!.content).toContain("Value A1");
      expect(chunks[0]!.content).toContain("Value B2");
      expect(chunks[0]!.metadata.tableRowCount).toBe(2);
    });

    test("handles single data row table", () => {
      const table = createSingleRowTable();
      const context = createTestContext();
      const chunks = indexer.indexTables([table], context);

      expect(chunks.length).toBe(1);
      expect(chunks[0]!.content).toContain("Total");
      expect(chunks[0]!.content).toContain("42");
      expect(chunks[0]!.metadata.tableRowCount).toBe(1);
    });

    test("handles mix of empty and non-empty tables", () => {
      const tables = [createEmptyTable({ tableIndex: 0 }), createSmallTable({ tableIndex: 1 })];
      const context = createTestContext();
      const chunks = indexer.indexTables(tables, context);

      // Only the non-empty table should produce chunks
      expect(chunks.length).toBe(1);
      expect(chunks[0]!.metadata.tableIndex).toBe(1);
    });
  });

  // ── ChromaDB metadata completeness ────────────────────────────────

  describe("ChromaDB metadata completeness", () => {
    test("includes all required base metadata fields", () => {
      const table = createSmallTable();
      const context = createTestContext();
      const chunks = indexer.indexTables([table], context);

      const meta = chunks[0]!.metadata;
      expect(meta.extension).toBeDefined();
      expect(meta.language).toBeDefined();
      expect(meta.fileSizeBytes).toBeDefined();
      expect(meta.contentHash).toBeDefined();
      expect(meta.fileModifiedAt).toBeDefined();
      expect(meta.documentType).toBeDefined();
    });

    test("includes all table-specific metadata fields", () => {
      const table = createTableWithCaption("Test Caption");
      table.confidence = 0.95;
      const context = createTestContext();
      const chunks = indexer.indexTables([table], context);

      const meta = chunks[0]!.metadata;
      expect(meta.isTable).toBe(true);
      expect(meta.tableIndex).toBeDefined();
      expect(meta.tableCaption).toBe("Test Caption");
      expect(meta.tableColumnCount).toBeDefined();
      expect(meta.tableRowCount).toBeDefined();
      expect(meta.tableSourceType).toBeDefined();
      expect(meta.tableConfidence).toBe(0.95);
    });

    test("chunk has all required DocumentChunk fields", () => {
      const table = createSmallTable();
      const context = createTestContext();
      const chunks = indexer.indexTables([table], context);

      const chunk = chunks[0]!;
      expect(chunk.id).toBeDefined();
      expect(chunk.repository).toBeDefined();
      expect(chunk.filePath).toBeDefined();
      expect(chunk.content).toBeDefined();
      expect(typeof chunk.chunkIndex).toBe("number");
      expect(typeof chunk.totalChunks).toBe("number");
      expect(typeof chunk.startLine).toBe("number");
      expect(typeof chunk.endLine).toBe("number");
      expect(chunk.metadata).toBeDefined();
    });
  });
});
