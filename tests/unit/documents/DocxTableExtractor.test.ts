/**
 * Unit tests for DocxTableExtractor.
 *
 * Tests the DOCX table extraction using mammoth HTML conversion and
 * DOM parsing. Uses Bun's mock.module to intercept mammoth imports and
 * supply controlled HTML output for deterministic testing.
 */

import { describe, test, expect, beforeAll, beforeEach, mock } from "bun:test";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { DEFAULT_EXTRACTOR_CONFIG } from "../../../src/documents/constants.js";
import {
  FileAccessError,
  FileTooLargeError,
  ExtractionError,
  ExtractionTimeoutError,
  UnsupportedFormatError,
} from "../../../src/documents/errors.js";
import {
  createTestDocxTableFiles,
  getDocxTablesFixturesDir,
} from "../../fixtures/documents/docx-table-fixtures.js";

// ── Mock setup ────────────────────────────────────────────────────

/** HTML that the mock mammoth.convertToHtml will return. */
let mockHtmlResult = "";

/** Error the mock mammoth will throw, if set. */
let mockError: Error | null = null;

/** Whether convertToHtml should hang (never resolve) to test timeout. */
let mockHang = false;

// Mock mammoth before importing DocxTableExtractor
void mock.module("mammoth", () => {
  return {
    default: {
      convertToHtml: (_input: {
        buffer: Buffer;
      }): Promise<{ value: string; messages: unknown[] }> => {
        if (mockHang) return new Promise(() => {}); // Never resolves

        if (mockError) {
          return Promise.reject(mockError);
        }

        return Promise.resolve({
          value: mockHtmlResult,
          messages: [],
        });
      },
      extractRawText: (_input: {
        buffer: Buffer;
      }): Promise<{ value: string; messages: unknown[] }> => {
        return Promise.resolve({ value: "", messages: [] });
      },
    },
  };
});

// Import after mock is set up
import { DocxTableExtractor } from "../../../src/documents/extractors/DocxTableExtractor.js";

// ── Fixture paths ─────────────────────────────────────────────────

const FIXTURES_DIR = path.join(__dirname, "../../fixtures/documents");
const DOCX_TABLES_DIR = getDocxTablesFixturesDir(FIXTURES_DIR);

// OLE2 signature for legacy .doc format
const OLE2_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

// Generate fixture files once before all tests
beforeAll(async () => {
  await createTestDocxTableFiles(FIXTURES_DIR);
});

// Reset mock state before each test
beforeEach(() => {
  mockHtmlResult = "";
  mockError = null;
  mockHang = false;
});

// ── Helper ────────────────────────────────────────────────────────

/**
 * Create a temporary DOCX file for testing.
 * Uses a minimal valid ZIP structure (PK signature).
 */
async function createTempDocx(content?: Buffer): Promise<string> {
  const tmpDir = path.join(FIXTURES_DIR, "docx-tables", "tmp");
  await fs.mkdir(tmpDir, { recursive: true });
  const filePath = path.join(
    tmpDir,
    `test-${Date.now()}-${Math.random().toString(36).slice(2)}.docx`
  );
  // Minimal ZIP file (PK\x03\x04 header) if no content provided
  const buffer = content ?? Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]);
  await fs.writeFile(filePath, buffer);
  return filePath;
}

// ── Tests ─────────────────────────────────────────────────────────

describe("DocxTableExtractor", () => {
  // ── Constructor and configuration ─────────────────────────────

  describe("constructor", () => {
    test("uses default configuration when no config provided", () => {
      const extractor = new DocxTableExtractor();
      const config = extractor.getConfig();

      expect(config.maxFileSizeBytes).toBe(DEFAULT_EXTRACTOR_CONFIG.maxFileSizeBytes);
      expect(config.timeoutMs).toBe(DEFAULT_EXTRACTOR_CONFIG.timeoutMs);
    });

    test("applies custom configuration overrides", () => {
      const extractor = new DocxTableExtractor({
        maxFileSizeBytes: 10_000_000,
        timeoutMs: 5000,
      });
      const config = extractor.getConfig();

      expect(config.maxFileSizeBytes).toBe(10_000_000);
      expect(config.timeoutMs).toBe(5000);
    });

    test("applies partial configuration with defaults for unset values", () => {
      const extractor = new DocxTableExtractor({
        timeoutMs: 15000,
      });
      const config = extractor.getConfig();

      expect(config.maxFileSizeBytes).toBe(DEFAULT_EXTRACTOR_CONFIG.maxFileSizeBytes);
      expect(config.timeoutMs).toBe(15000);
    });
  });

  // ── supports() ────────────────────────────────────────────────

  describe("supports()", () => {
    const extractor = new DocxTableExtractor();

    test("returns true for .docx extension", () => {
      expect(extractor.supports(".docx")).toBe(true);
    });

    test("returns true for .DOCX extension (case insensitive)", () => {
      expect(extractor.supports(".DOCX")).toBe(true);
    });

    test("returns false for .pdf extension", () => {
      expect(extractor.supports(".pdf")).toBe(false);
    });

    test("returns false for .doc extension", () => {
      expect(extractor.supports(".doc")).toBe(false);
    });

    test("returns false for .xlsx extension", () => {
      expect(extractor.supports(".xlsx")).toBe(false);
    });

    test("returns false for .txt extension", () => {
      expect(extractor.supports(".txt")).toBe(false);
    });

    test("returns false for empty string", () => {
      expect(extractor.supports("")).toBe(false);
    });
  });

  // ── Table extraction (mocked mammoth) ──────────────────────────

  describe("extract() — table detection", () => {
    test("extracts a simple 2-column, 3-row table", async () => {
      const extractor = new DocxTableExtractor();
      const filePath = await createTempDocx();

      mockHtmlResult = `
        <table>
          <tr><th>Name</th><th>Age</th></tr>
          <tr><td>Alice</td><td>30</td></tr>
          <tr><td>Bob</td><td>25</td></tr>
        </table>
      `;

      const results = await extractor.extract(filePath);

      expect(results.length).toBe(1);

      const table = results[0]!;
      expect(table.sourceType).toBe("docx");
      expect(table.tableIndex).toBe(0);
      expect(table.filePath).toBe(filePath);
      expect(table.confidence).toBe(1.0);
      expect(table.table.columnCount).toBe(2);
      expect(table.table.rows.length).toBe(3);

      // Header row (has <th> cells)
      expect(table.table.rows[0]!.isHeader).toBe(true);
      expect(table.table.rows[0]!.cells[0]!.content).toBe("Name");
      expect(table.table.rows[0]!.cells[1]!.content).toBe("Age");

      // Data rows
      expect(table.table.rows[1]!.isHeader).toBeFalsy();
      expect(table.table.rows[1]!.cells[0]!.content).toBe("Alice");
      expect(table.table.rows[1]!.cells[1]!.content).toBe("30");

      expect(table.table.rows[2]!.cells[0]!.content).toBe("Bob");
      expect(table.table.rows[2]!.cells[1]!.content).toBe("25");
    });

    test("detects multiple tables in document", async () => {
      const extractor = new DocxTableExtractor();
      const filePath = await createTempDocx();

      mockHtmlResult = `
        <table>
          <tr><td>A</td><td>B</td></tr>
          <tr><td>1</td><td>2</td></tr>
        </table>
        <p>Some text between tables</p>
        <table>
          <tr><td>X</td><td>Y</td></tr>
          <tr><td>3</td><td>4</td></tr>
        </table>
      `;

      const results = await extractor.extract(filePath);

      expect(results.length).toBe(2);

      expect(results[0]!.tableIndex).toBe(0);
      expect(results[0]!.table.rows[0]!.cells[0]!.content).toBe("A");
      expect(results[0]!.table.rows[0]!.cells[1]!.content).toBe("B");

      expect(results[1]!.tableIndex).toBe(1);
      expect(results[1]!.table.rows[0]!.cells[0]!.content).toBe("X");
      expect(results[1]!.table.rows[0]!.cells[1]!.content).toBe("Y");
    });

    test("returns empty array when no tables found", async () => {
      const extractor = new DocxTableExtractor();
      const filePath = await createTempDocx();

      mockHtmlResult = `<p>Just some text.</p><p>No tables here.</p>`;

      const results = await extractor.extract(filePath);

      expect(results).toEqual([]);
    });

    test("returns empty array for empty HTML", async () => {
      const extractor = new DocxTableExtractor();
      const filePath = await createTempDocx();

      mockHtmlResult = "";

      const results = await extractor.extract(filePath);

      expect(results).toEqual([]);
    });

    test("extracts 3-column table correctly", async () => {
      const extractor = new DocxTableExtractor();
      const filePath = await createTempDocx();

      mockHtmlResult = `
        <table>
          <tr><th>Name</th><th>Role</th><th>Level</th></tr>
          <tr><td>Alice</td><td>Engineer</td><td>Senior</td></tr>
        </table>
      `;

      const results = await extractor.extract(filePath);

      expect(results.length).toBe(1);
      expect(results[0]!.table.columnCount).toBe(3);
      expect(results[0]!.table.rows[0]!.cells.length).toBe(3);
      expect(results[0]!.table.rows[0]!.cells[2]!.content).toBe("Level");
      expect(results[0]!.table.rows[1]!.cells[2]!.content).toBe("Senior");
    });

    test("marks rows with <th> cells as header", async () => {
      const extractor = new DocxTableExtractor();
      const filePath = await createTempDocx();

      mockHtmlResult = `
        <table>
          <tr><th>H1</th><th>H2</th></tr>
          <tr><td>D1</td><td>D2</td></tr>
        </table>
      `;

      const results = await extractor.extract(filePath);

      expect(results.length).toBe(1);
      expect(results[0]!.table.rows[0]!.isHeader).toBe(true);
      expect(results[0]!.table.rows[1]!.isHeader).toBeFalsy();
    });

    test("marks rows with all <td> cells as non-header", async () => {
      const extractor = new DocxTableExtractor();
      const filePath = await createTempDocx();

      mockHtmlResult = `
        <table>
          <tr><td>A</td><td>B</td></tr>
          <tr><td>C</td><td>D</td></tr>
        </table>
      `;

      const results = await extractor.extract(filePath);

      expect(results.length).toBe(1);
      expect(results[0]!.table.rows[0]!.isHeader).toBeFalsy();
      expect(results[0]!.table.rows[1]!.isHeader).toBeFalsy();
    });

    test("does not set pageNumber for DOCX (page-less format)", async () => {
      const extractor = new DocxTableExtractor();
      const filePath = await createTempDocx();

      mockHtmlResult = `
        <table>
          <tr><td>A</td><td>B</td></tr>
          <tr><td>C</td><td>D</td></tr>
        </table>
      `;

      const results = await extractor.extract(filePath);

      expect(results.length).toBe(1);
      expect(results[0]!.pageNumber).toBeUndefined();
    });

    test("always returns confidence of 1.0 for DOCX", async () => {
      const extractor = new DocxTableExtractor();
      const filePath = await createTempDocx();

      mockHtmlResult = `
        <table>
          <tr><td>A</td><td>B</td></tr>
          <tr><td>C</td><td>D</td></tr>
        </table>
      `;

      const results = await extractor.extract(filePath);

      expect(results.length).toBe(1);
      expect(results[0]!.confidence).toBe(1.0);
    });
  });

  // ── Colspan handling ──────────────────────────────────────────

  describe("colspan handling", () => {
    test("reads colspan attribute from <td>", async () => {
      const extractor = new DocxTableExtractor();
      const filePath = await createTempDocx();

      mockHtmlResult = `
        <table>
          <tr><td colspan="2">Wide Header</td></tr>
          <tr><td>A</td><td>B</td></tr>
        </table>
      `;

      const results = await extractor.extract(filePath);

      expect(results.length).toBe(1);
      const wideCell = results[0]!.table.rows[0]!.cells[0]!;
      expect(wideCell.content).toBe("Wide Header");
      expect(wideCell.colSpan).toBe(2);
    });

    test("reads colspan attribute from <th>", async () => {
      const extractor = new DocxTableExtractor();
      const filePath = await createTempDocx();

      mockHtmlResult = `
        <table>
          <tr><th colspan="3">Title</th></tr>
          <tr><td>A</td><td>B</td><td>C</td></tr>
        </table>
      `;

      const results = await extractor.extract(filePath);

      expect(results.length).toBe(1);
      const headerCell = results[0]!.table.rows[0]!.cells[0]!;
      expect(headerCell.content).toBe("Title");
      expect(headerCell.colSpan).toBe(3);
    });

    test("does not set colSpan for colspan=1", async () => {
      const extractor = new DocxTableExtractor();
      const filePath = await createTempDocx();

      mockHtmlResult = `
        <table>
          <tr><td colspan="1">A</td><td>B</td></tr>
          <tr><td>C</td><td>D</td></tr>
        </table>
      `;

      const results = await extractor.extract(filePath);

      expect(results.length).toBe(1);
      expect(results[0]!.table.rows[0]!.cells[0]!.colSpan).toBeUndefined();
    });

    test("correctly computes columnCount with colspan", async () => {
      const extractor = new DocxTableExtractor();
      const filePath = await createTempDocx();

      mockHtmlResult = `
        <table>
          <tr><td colspan="3">Spanning header</td></tr>
          <tr><td>A</td><td>B</td><td>C</td></tr>
        </table>
      `;

      const results = await extractor.extract(filePath);

      expect(results.length).toBe(1);
      expect(results[0]!.table.columnCount).toBe(3);
    });
  });

  // ── Rowspan handling ──────────────────────────────────────────

  describe("rowspan handling", () => {
    test("reads rowspan attribute from <td>", async () => {
      const extractor = new DocxTableExtractor();
      const filePath = await createTempDocx();

      mockHtmlResult = `
        <table>
          <tr><td rowspan="2">Span</td><td>B1</td></tr>
          <tr><td>B2</td></tr>
        </table>
      `;

      const results = await extractor.extract(filePath);

      expect(results.length).toBe(1);
      const spanCell = results[0]!.table.rows[0]!.cells[0]!;
      expect(spanCell.content).toBe("Span");
      expect(spanCell.rowSpan).toBe(2);
    });

    test("does not set rowSpan for rowspan=1", async () => {
      const extractor = new DocxTableExtractor();
      const filePath = await createTempDocx();

      mockHtmlResult = `
        <table>
          <tr><td rowspan="1">A</td><td>B</td></tr>
          <tr><td>C</td><td>D</td></tr>
        </table>
      `;

      const results = await extractor.extract(filePath);

      expect(results.length).toBe(1);
      expect(results[0]!.table.rows[0]!.cells[0]!.rowSpan).toBeUndefined();
    });
  });

  // ── Nested tables ───────────────────────────────────────────────

  describe("nested table handling", () => {
    test("flattens nested table content into parent cell text", async () => {
      const extractor = new DocxTableExtractor();
      const filePath = await createTempDocx();

      mockHtmlResult = `
        <table>
          <tr>
            <td>Normal cell</td>
            <td>
              <table>
                <tr><td>Inner A</td><td>Inner B</td></tr>
              </table>
            </td>
          </tr>
          <tr><td>C</td><td>D</td></tr>
        </table>
      `;

      const results = await extractor.extract(filePath);

      // Should only extract the outer table
      expect(results.length).toBe(1);

      const outerTable = results[0]!.table;
      expect(outerTable.rows.length).toBe(2);

      // Second cell in first row should contain flattened nested table text
      const nestedCell = outerTable.rows[0]!.cells[1]!;
      expect(nestedCell.content).toContain("Inner A");
      expect(nestedCell.content).toContain("Inner B");
    });

    test("does not extract nested tables as separate results", async () => {
      const extractor = new DocxTableExtractor();
      const filePath = await createTempDocx();

      mockHtmlResult = `
        <table>
          <tr>
            <td>
              <table>
                <tr><td>Nested1</td></tr>
              </table>
            </td>
            <td>Outer</td>
          </tr>
          <tr><td>X</td><td>Y</td></tr>
        </table>
      `;

      const results = await extractor.extract(filePath);

      // Only the outer table should be extracted
      expect(results.length).toBe(1);
    });
  });

  // ── Error handling ────────────────────────────────────────────

  describe("error handling", () => {
    test("throws FileAccessError for non-existent file", async () => {
      const extractor = new DocxTableExtractor();

      try {
        await extractor.extract("/nonexistent/path/to/file.docx");
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(FileAccessError);
      }
    });

    test("throws FileTooLargeError for oversized file", async () => {
      const extractor = new DocxTableExtractor({ maxFileSizeBytes: 10 });
      const filePath = await createTempDocx(Buffer.alloc(100));

      try {
        await extractor.extract(filePath);
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(FileTooLargeError);
      }
    });

    test("throws UnsupportedFormatError for legacy .doc file", async () => {
      const extractor = new DocxTableExtractor();
      // Create a file with OLE2 signature
      const oleBuffer = Buffer.alloc(100);
      OLE2_SIGNATURE.copy(oleBuffer);
      const filePath = await createTempDocx(oleBuffer);

      try {
        await extractor.extract(filePath);
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(UnsupportedFormatError);
        expect((error as UnsupportedFormatError).extension).toBe(".doc");
      }
    });

    test("throws ExtractionError for corrupt DOCX", async () => {
      const extractor = new DocxTableExtractor();
      const filePath = await createTempDocx();

      mockError = new Error("Invalid DOCX structure");

      try {
        await extractor.extract(filePath);
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(ExtractionError);
      }
    });

    test("throws ExtractionTimeoutError when conversion hangs", async () => {
      const extractor = new DocxTableExtractor({ timeoutMs: 100 });
      const filePath = await createTempDocx();

      mockHang = true;

      try {
        await extractor.extract(filePath);
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(ExtractionTimeoutError);
        expect((error as ExtractionTimeoutError).retryable).toBe(true);
      }
    }, 5000);
  });

  // ── Edge cases ────────────────────────────────────────────────

  describe("edge cases", () => {
    test("handles empty table (no rows)", async () => {
      const extractor = new DocxTableExtractor();
      const filePath = await createTempDocx();

      mockHtmlResult = `<table></table>`;

      const results = await extractor.extract(filePath);

      // Empty table produces no results (0 rows)
      expect(results).toEqual([]);
    });

    test("handles table with empty cells", async () => {
      const extractor = new DocxTableExtractor();
      const filePath = await createTempDocx();

      mockHtmlResult = `
        <table>
          <tr><td></td><td>B</td></tr>
          <tr><td>C</td><td></td></tr>
        </table>
      `;

      const results = await extractor.extract(filePath);

      expect(results.length).toBe(1);
      expect(results[0]!.table.rows[0]!.cells[0]!.content).toBe("");
      expect(results[0]!.table.rows[0]!.cells[1]!.content).toBe("B");
      expect(results[0]!.table.rows[1]!.cells[0]!.content).toBe("C");
      expect(results[0]!.table.rows[1]!.cells[1]!.content).toBe("");
    });

    test("handles whitespace-only cells", async () => {
      const extractor = new DocxTableExtractor();
      const filePath = await createTempDocx();

      mockHtmlResult = `
        <table>
          <tr><td>   </td><td>data</td></tr>
          <tr><td>more</td><td>  \t  </td></tr>
        </table>
      `;

      const results = await extractor.extract(filePath);

      expect(results.length).toBe(1);
      // Whitespace should be trimmed
      expect(results[0]!.table.rows[0]!.cells[0]!.content).toBe("");
      expect(results[0]!.table.rows[0]!.cells[1]!.content).toBe("data");
    });

    test("handles table with single row", async () => {
      const extractor = new DocxTableExtractor();
      const filePath = await createTempDocx();

      mockHtmlResult = `
        <table>
          <tr><td>A</td><td>B</td></tr>
        </table>
      `;

      const results = await extractor.extract(filePath);

      expect(results.length).toBe(1);
      expect(results[0]!.table.rows.length).toBe(1);
    });

    test("handles table with single cell", async () => {
      const extractor = new DocxTableExtractor();
      const filePath = await createTempDocx();

      mockHtmlResult = `
        <table>
          <tr><td>Only cell</td></tr>
        </table>
      `;

      const results = await extractor.extract(filePath);

      expect(results.length).toBe(1);
      expect(results[0]!.table.rows[0]!.cells[0]!.content).toBe("Only cell");
      expect(results[0]!.table.columnCount).toBe(1);
    });

    test("strips HTML tags from cell content", async () => {
      const extractor = new DocxTableExtractor();
      const filePath = await createTempDocx();

      mockHtmlResult = `
        <table>
          <tr><td><strong>Bold</strong> text</td><td>Normal</td></tr>
          <tr><td><em>Italic</em></td><td><a href="#">Link</a></td></tr>
        </table>
      `;

      const results = await extractor.extract(filePath);

      expect(results.length).toBe(1);
      expect(results[0]!.table.rows[0]!.cells[0]!.content).toBe("Bold text");
      expect(results[0]!.table.rows[1]!.cells[0]!.content).toBe("Italic");
      expect(results[0]!.table.rows[1]!.cells[1]!.content).toBe("Link");
    });

    test("handles table inside thead/tbody/tfoot", async () => {
      const extractor = new DocxTableExtractor();
      const filePath = await createTempDocx();

      mockHtmlResult = `
        <table>
          <thead>
            <tr><th>Header1</th><th>Header2</th></tr>
          </thead>
          <tbody>
            <tr><td>Data1</td><td>Data2</td></tr>
          </tbody>
        </table>
      `;

      const results = await extractor.extract(filePath);

      expect(results.length).toBe(1);
      expect(results[0]!.table.rows.length).toBe(2);
      expect(results[0]!.table.rows[0]!.isHeader).toBe(true);
      expect(results[0]!.table.rows[0]!.cells[0]!.content).toBe("Header1");
      expect(results[0]!.table.rows[1]!.cells[0]!.content).toBe("Data1");
    });

    test("handles invalid colspan attribute gracefully", async () => {
      const extractor = new DocxTableExtractor();
      const filePath = await createTempDocx();

      mockHtmlResult = `
        <table>
          <tr><td colspan="abc">A</td><td>B</td></tr>
          <tr><td>C</td><td>D</td></tr>
        </table>
      `;

      const results = await extractor.extract(filePath);

      expect(results.length).toBe(1);
      // Invalid colspan should be ignored
      expect(results[0]!.table.rows[0]!.cells[0]!.colSpan).toBeUndefined();
    });
  });

  // ── Fixture integration tests ─────────────────────────────────

  describe("fixture files", () => {
    test("fixture files exist", async () => {
      const expectedFiles = [
        "simple-table.docx",
        "multi-table.docx",
        "with-headers.docx",
        "colspan.docx",
        "rowspan.docx",
        "no-table.docx",
        "empty-table.docx",
        "whitespace-cells.docx",
      ];

      for (const file of expectedFiles) {
        const filePath = path.join(DOCX_TABLES_DIR, file);
        const stats = await fs.stat(filePath);
        expect(stats.isFile()).toBe(true);
        expect(stats.size).toBeGreaterThan(0);
      }
    });
  });

  // ── Export verification ───────────────────────────────────────

  describe("module exports", () => {
    test("DocxTableExtractor is exported from extractors index", async () => {
      const mod = await import("../../../src/documents/extractors/index.js");
      expect(mod.DocxTableExtractor).toBeDefined();
    });

    test("DocxTableExtractor is exported from documents index", async () => {
      const mod = await import("../../../src/documents/index.js");
      expect(mod.DocxTableExtractor).toBeDefined();
    });
  });
});
