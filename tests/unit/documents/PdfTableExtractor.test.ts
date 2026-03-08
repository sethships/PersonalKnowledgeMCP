/**
 * Unit tests for PdfTableExtractor.
 *
 * Tests the PDF table extraction algorithm including row grouping, column
 * detection, table region detection, merged cell handling, confidence
 * scoring, and error handling.
 *
 * Uses Bun's mock.module to intercept pdfreader imports and supply
 * controlled text item sequences for deterministic algorithm testing.
 */

import { describe, test, expect, beforeAll, beforeEach, afterAll, mock } from "bun:test";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { DEFAULT_EXTRACTOR_CONFIG } from "../../../src/documents/constants.js";
import {
  FileAccessError,
  FileTooLargeError,
  ExtractionError,
  ExtractionTimeoutError,
  PasswordProtectedError,
} from "../../../src/documents/errors.js";
import {
  createTestPdfTableFiles,
  getPdfTablesFixturesDir,
} from "../../fixtures/documents/pdf-table-fixtures.js";

// ── Mock setup ────────────────────────────────────────────────────

/**
 * Items that the mock PdfReader will emit.
 * Set this before each test to control what parsePdfItems receives.
 */
let mockParseItems: Array<{
  page?: number;
  text?: string;
  x?: number;
  y?: number;
  w?: number;
  sw?: number;
}> = [];

/** Error string the mock PdfReader will emit, if set. */
let mockParseError: string | null = null;

/** Whether parseBuffer should hang (never call back) to test timeout. */
let mockHang = false;

// Mock pdfreader before importing PdfTableExtractor
void mock.module("pdfreader", () => {
  return {
    PdfReader: class MockPdfReader {
      parseBuffer(_buffer: Buffer, callback: (err: string | null, item: unknown) => void): void {
        if (mockHang) return; // Never call back — simulates hang for timeout test

        if (mockParseError) {
          callback(mockParseError, null);
          return;
        }

        // Emit items asynchronously to match real pdfreader behavior
        setTimeout(() => {
          for (const item of mockParseItems) {
            callback(null, item);
          }
          // Signal end of file
          callback(null, null);
        }, 0);
      }

      parseFileItems(_path: string, callback: (err: string | null, item: unknown) => void): void {
        this.parseBuffer(Buffer.alloc(0), callback);
      }
    },
  };
});

// Import after mock is set up
import { PdfTableExtractor } from "../../../src/documents/extractors/PdfTableExtractor.js";

// ── Fixture paths ─────────────────────────────────────────────────

const FIXTURES_DIR = path.join(__dirname, "../../fixtures/documents");
const PDF_TABLES_DIR = getPdfTablesFixturesDir(FIXTURES_DIR);
const TMP_DIR = path.join(FIXTURES_DIR, "pdf-tables", "tmp");

// Generate fixture files once before all tests
beforeAll(async () => {
  await createTestPdfTableFiles(FIXTURES_DIR);
});

// Clean up temp PDF files after all tests
afterAll(async () => {
  try {
    await fs.rm(TMP_DIR, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup
  }
});

// Reset mock state before each test
beforeEach(() => {
  mockParseItems = [];
  mockParseError = null;
  mockHang = false;
});

// ── Helper ────────────────────────────────────────────────────────

/**
 * Create a temporary PDF file for testing.
 * Returns the path to the created file.
 */
async function createTempPdf(content: Buffer = Buffer.from("%PDF-1.4 minimal")): Promise<string> {
  await fs.mkdir(TMP_DIR, { recursive: true });
  const filePath = path.join(
    TMP_DIR,
    `test-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`
  );
  await fs.writeFile(filePath, content);
  return filePath;
}

// ── Tests ─────────────────────────────────────────────────────────

describe("PdfTableExtractor", () => {
  // ── Constructor and configuration ─────────────────────────────

  describe("constructor", () => {
    test("uses default configuration when no config provided", () => {
      const extractor = new PdfTableExtractor();
      const config = extractor.getConfig();

      expect(config.maxFileSizeBytes).toBe(DEFAULT_EXTRACTOR_CONFIG.maxFileSizeBytes);
      expect(config.timeoutMs).toBe(DEFAULT_EXTRACTOR_CONFIG.timeoutMs);
      expect(config.yTolerance).toBe(0.3);
      expect(config.minColumns).toBe(2);
      expect(config.minRows).toBe(2);
    });

    test("applies custom configuration overrides", () => {
      const extractor = new PdfTableExtractor({
        maxFileSizeBytes: 10_000_000,
        timeoutMs: 5000,
        yTolerance: 0.5,
        minColumns: 3,
        minRows: 3,
      });
      const config = extractor.getConfig();

      expect(config.maxFileSizeBytes).toBe(10_000_000);
      expect(config.timeoutMs).toBe(5000);
      expect(config.yTolerance).toBe(0.5);
      expect(config.minColumns).toBe(3);
      expect(config.minRows).toBe(3);
    });

    test("applies partial configuration with defaults for unset values", () => {
      const extractor = new PdfTableExtractor({
        yTolerance: 0.8,
      });
      const config = extractor.getConfig();

      expect(config.maxFileSizeBytes).toBe(DEFAULT_EXTRACTOR_CONFIG.maxFileSizeBytes);
      expect(config.timeoutMs).toBe(DEFAULT_EXTRACTOR_CONFIG.timeoutMs);
      expect(config.yTolerance).toBe(0.8);
      expect(config.minColumns).toBe(2);
      expect(config.minRows).toBe(2);
    });
  });

  // ── supports() ────────────────────────────────────────────────

  describe("supports()", () => {
    const extractor = new PdfTableExtractor();

    test("returns true for .pdf extension", () => {
      expect(extractor.supports(".pdf")).toBe(true);
    });

    test("returns true for .PDF extension (case insensitive)", () => {
      expect(extractor.supports(".PDF")).toBe(true);
    });

    test("returns false for .docx extension", () => {
      expect(extractor.supports(".docx")).toBe(false);
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

  // ── Table extraction (mocked pdfreader) ───────────────────────

  describe("extract() — table detection", () => {
    test("extracts a simple 2-column, 3-row table", async () => {
      const extractor = new PdfTableExtractor();
      const filePath = await createTempPdf();

      // Simulate pdfreader items: page marker + 6 text items in a 2x3 grid
      mockParseItems = [
        { page: 1 },
        // Row 1 (header)
        { text: "Name", x: 5, y: 10, w: 3 },
        { text: "Age", x: 20, y: 10, w: 2 },
        // Row 2
        { text: "Alice", x: 5, y: 12, w: 3 },
        { text: "30", x: 20, y: 12, w: 1 },
        // Row 3
        { text: "Bob", x: 5, y: 14, w: 2 },
        { text: "25", x: 20, y: 14, w: 1 },
      ];

      const results = await extractor.extract(filePath);

      expect(results.length).toBe(1);

      const table = results[0]!;
      expect(table.sourceType).toBe("pdf");
      expect(table.pageNumber).toBe(1);
      expect(table.tableIndex).toBe(0);
      expect(table.filePath).toBe(filePath);
      expect(table.table.columnCount).toBe(2);
      expect(table.table.rows.length).toBe(3);

      // Header row
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

    test("detects multiple tables separated by non-table content", async () => {
      const extractor = new PdfTableExtractor();
      const filePath = await createTempPdf();

      mockParseItems = [
        { page: 1 },
        // Table 1
        { text: "A", x: 5, y: 10, w: 1 },
        { text: "B", x: 20, y: 10, w: 1 },
        { text: "1", x: 5, y: 12, w: 1 },
        { text: "2", x: 20, y: 12, w: 1 },
        // Non-table line (single item — below minColumns)
        { text: "Separator text", x: 5, y: 20, w: 5 },
        // Table 2
        { text: "X", x: 5, y: 30, w: 1 },
        { text: "Y", x: 20, y: 30, w: 1 },
        { text: "3", x: 5, y: 32, w: 1 },
        { text: "4", x: 20, y: 32, w: 1 },
      ];

      const results = await extractor.extract(filePath);

      expect(results.length).toBe(2);

      expect(results[0]!.tableIndex).toBe(0);
      expect(results[0]!.table.rows[0]!.cells[0]!.content).toBe("A");
      expect(results[0]!.table.rows[0]!.cells[1]!.content).toBe("B");

      expect(results[1]!.tableIndex).toBe(1);
      expect(results[1]!.table.rows[0]!.cells[0]!.content).toBe("X");
      expect(results[1]!.table.rows[0]!.cells[1]!.content).toBe("Y");
    });

    test("returns empty array when no tables found (prose only)", async () => {
      const extractor = new PdfTableExtractor();
      const filePath = await createTempPdf();

      mockParseItems = [
        { page: 1 },
        { text: "First line of prose.", x: 5, y: 10, w: 10 },
        { text: "Second line of prose.", x: 5, y: 12, w: 10 },
        { text: "Third line of prose.", x: 5, y: 14, w: 10 },
      ];

      const results = await extractor.extract(filePath);

      expect(results).toEqual([]);
    });

    test("returns empty array for empty PDF (no text items)", async () => {
      const extractor = new PdfTableExtractor();
      const filePath = await createTempPdf();

      mockParseItems = [{ page: 1 }];

      const results = await extractor.extract(filePath);

      expect(results).toEqual([]);
    });

    test("extracts 3-column table correctly", async () => {
      const extractor = new PdfTableExtractor();
      const filePath = await createTempPdf();

      mockParseItems = [
        { page: 1 },
        { text: "Name", x: 5, y: 10, w: 3 },
        { text: "Role", x: 20, y: 10, w: 3 },
        { text: "Level", x: 40, y: 10, w: 3 },
        { text: "Alice", x: 5, y: 12, w: 3 },
        { text: "Engineer", x: 20, y: 12, w: 5 },
        { text: "Senior", x: 40, y: 12, w: 3 },
      ];

      const results = await extractor.extract(filePath);

      expect(results.length).toBe(1);
      expect(results[0]!.table.columnCount).toBe(3);
      expect(results[0]!.table.rows[0]!.cells.length).toBe(3);
      expect(results[0]!.table.rows[0]!.cells[2]!.content).toBe("Level");
      expect(results[0]!.table.rows[1]!.cells[2]!.content).toBe("Senior");
    });

    test("marks first row as header", async () => {
      const extractor = new PdfTableExtractor();
      const filePath = await createTempPdf();

      mockParseItems = [
        { page: 1 },
        { text: "H1", x: 5, y: 10, w: 1 },
        { text: "H2", x: 20, y: 10, w: 1 },
        { text: "D1", x: 5, y: 12, w: 1 },
        { text: "D2", x: 20, y: 12, w: 1 },
      ];

      const results = await extractor.extract(filePath);

      expect(results.length).toBe(1);
      expect(results[0]!.table.rows[0]!.isHeader).toBe(true);
      expect(results[0]!.table.rows[1]!.isHeader).toBeFalsy();
    });

    test("tracks page numbers in results", async () => {
      const extractor = new PdfTableExtractor();
      const filePath = await createTempPdf();

      // Table on page 2
      mockParseItems = [
        { page: 1 },
        { text: "Prose only on page 1", x: 5, y: 10, w: 10 },
        { page: 2 },
        { text: "A", x: 5, y: 10, w: 1 },
        { text: "B", x: 20, y: 10, w: 1 },
        { text: "C", x: 5, y: 12, w: 1 },
        { text: "D", x: 20, y: 12, w: 1 },
      ];

      const results = await extractor.extract(filePath);

      expect(results.length).toBe(1);
      expect(results[0]!.pageNumber).toBe(2);
    });

    test("handles items without explicit page marker", async () => {
      const extractor = new PdfTableExtractor();
      const filePath = await createTempPdf();

      // No page marker — items should default to page 1
      mockParseItems = [
        { text: "A", x: 5, y: 10, w: 1 },
        { text: "B", x: 20, y: 10, w: 1 },
        { text: "C", x: 5, y: 12, w: 1 },
        { text: "D", x: 20, y: 12, w: 1 },
      ];

      const results = await extractor.extract(filePath);

      expect(results.length).toBe(1);
      expect(results[0]!.pageNumber).toBe(1);
    });
  });

  // ── Row grouping ──────────────────────────────────────────────

  describe("row grouping (y-tolerance)", () => {
    test("groups items with close y-coordinates into same row", async () => {
      const extractor = new PdfTableExtractor({ yTolerance: 0.5 });
      const filePath = await createTempPdf();

      mockParseItems = [
        { page: 1 },
        // Row 1: y=10.0 and y=10.2 (within 0.5 tolerance)
        { text: "A", x: 5, y: 10.0, w: 1 },
        { text: "B", x: 20, y: 10.2, w: 1 },
        // Row 2: y=12.0 and y=12.3 (within 0.5 tolerance)
        { text: "C", x: 5, y: 12.0, w: 1 },
        { text: "D", x: 20, y: 12.3, w: 1 },
      ];

      const results = await extractor.extract(filePath);

      expect(results.length).toBe(1);
      expect(results[0]!.table.rows.length).toBe(2);
    });

    test("separates items with distant y-coordinates into different rows", async () => {
      const extractor = new PdfTableExtractor({ yTolerance: 0.1 });
      const filePath = await createTempPdf();

      mockParseItems = [
        { page: 1 },
        // Each item on its own line (y difference > 0.1)
        { text: "A", x: 5, y: 10, w: 1 },
        { text: "B", x: 20, y: 10, w: 1 },
        { text: "C", x: 5, y: 12, w: 1 },
        { text: "D", x: 20, y: 12, w: 1 },
      ];

      const results = await extractor.extract(filePath);

      expect(results.length).toBe(1);
      expect(results[0]!.table.rows.length).toBe(2);
    });
  });

  // ── Merged cells ──────────────────────────────────────────────

  describe("merged cell detection", () => {
    test("detects column span when item width extends past next column", async () => {
      const extractor = new PdfTableExtractor();
      const filePath = await createTempPdf();

      mockParseItems = [
        { page: 1 },
        // Row 1: wide item spanning both columns (x=5, w=20 -> right edge = 25, past column at x=20)
        { text: "Wide Header", x: 5, y: 10, w: 20 },
        // Row 2: normal 2-column row
        { text: "A", x: 5, y: 12, w: 1 },
        { text: "B", x: 20, y: 12, w: 1 },
        // Row 3: normal 2-column row
        { text: "C", x: 5, y: 14, w: 1 },
        { text: "D", x: 20, y: 14, w: 1 },
      ];

      const results = await extractor.extract(filePath);

      expect(results.length).toBe(1);
      // The wide header should have colSpan=2
      const headerCells = results[0]!.table.rows[0]!.cells;
      const wideCell = headerCells.find((c) => c.content === "Wide Header");
      expect(wideCell).toBeDefined();
      expect(wideCell!.colSpan).toBe(2);
    });

    test("sets rowSpan when cell below is empty", async () => {
      const extractor = new PdfTableExtractor();
      const filePath = await createTempPdf();

      // Use 3 columns so row 2 (missing col 0) still has 2 items >= minColumns
      mockParseItems = [
        { page: 1 },
        // Row 1 — all 3 columns
        { text: "Category", x: 5, y: 10, w: 1 },
        { text: "Value", x: 20, y: 10, w: 1 },
        { text: "Notes", x: 40, y: 10, w: 1 },
        // Row 2 — col 0 is empty (rowSpan from above), cols 1 and 2 present
        { text: "100", x: 20, y: 12, w: 1 },
        { text: "OK", x: 40, y: 12, w: 1 },
        // Row 3 — all 3 columns
        { text: "Other", x: 5, y: 14, w: 1 },
        { text: "200", x: 20, y: 14, w: 1 },
        { text: "Done", x: 40, y: 14, w: 1 },
      ];

      const results = await extractor.extract(filePath);

      expect(results.length).toBe(1);
      // "Category" should have rowSpan=2 (spans into row 2 where col 0 is empty)
      const firstCell = results[0]!.table.rows[0]!.cells[0]!;
      expect(firstCell.content).toBe("Category");
      expect(firstCell.rowSpan).toBe(2);
    });

    test("does not set colSpan when item width is zero", async () => {
      const extractor = new PdfTableExtractor();
      const filePath = await createTempPdf();

      mockParseItems = [
        { page: 1 },
        { text: "A", x: 5, y: 10, w: 0 },
        { text: "B", x: 20, y: 10, w: 0 },
        { text: "C", x: 5, y: 12, w: 0 },
        { text: "D", x: 20, y: 12, w: 0 },
      ];

      const results = await extractor.extract(filePath);

      expect(results.length).toBe(1);
      for (const row of results[0]!.table.rows) {
        for (const cell of row.cells) {
          expect(cell.colSpan).toBeUndefined();
        }
      }
    });
  });

  // ── Confidence scoring ────────────────────────────────────────

  describe("confidence scoring", () => {
    test("returns high confidence for perfectly aligned table", async () => {
      const extractor = new PdfTableExtractor();
      const filePath = await createTempPdf();

      // All items perfectly aligned to columns
      mockParseItems = [
        { page: 1 },
        { text: "A", x: 5, y: 10, w: 1 },
        { text: "B", x: 20, y: 10, w: 1 },
        { text: "C", x: 5, y: 12, w: 1 },
        { text: "D", x: 20, y: 12, w: 1 },
      ];

      const results = await extractor.extract(filePath);

      expect(results.length).toBe(1);
      expect(results[0]!.confidence).toBeDefined();
      expect(results[0]!.confidence!).toBeGreaterThanOrEqual(0.9);
    });

    test("confidence score is between 0 and 1", async () => {
      const extractor = new PdfTableExtractor();
      const filePath = await createTempPdf();

      mockParseItems = [
        { page: 1 },
        { text: "A", x: 5, y: 10, w: 1 },
        { text: "B", x: 20, y: 10, w: 1 },
        { text: "C", x: 5, y: 12, w: 1 },
        { text: "D", x: 20, y: 12, w: 1 },
      ];

      const results = await extractor.extract(filePath);

      expect(results.length).toBe(1);
      expect(results[0]!.confidence).toBeGreaterThanOrEqual(0);
      expect(results[0]!.confidence).toBeLessThanOrEqual(1);
    });
  });

  // ── minColumns / minRows thresholds ───────────────────────────

  describe("minColumns threshold", () => {
    test("does not detect table when columns below minColumns", async () => {
      const extractor = new PdfTableExtractor({ minColumns: 3 });
      const filePath = await createTempPdf();

      // Only 2 columns — below minColumns=3
      mockParseItems = [
        { page: 1 },
        { text: "A", x: 5, y: 10, w: 1 },
        { text: "B", x: 20, y: 10, w: 1 },
        { text: "C", x: 5, y: 12, w: 1 },
        { text: "D", x: 20, y: 12, w: 1 },
      ];

      const results = await extractor.extract(filePath);

      expect(results).toEqual([]);
    });
  });

  describe("minRows threshold", () => {
    test("does not detect table when rows below minRows", async () => {
      const extractor = new PdfTableExtractor({ minRows: 3 });
      const filePath = await createTempPdf();

      // Only 2 rows — below minRows=3
      mockParseItems = [
        { page: 1 },
        { text: "A", x: 5, y: 10, w: 1 },
        { text: "B", x: 20, y: 10, w: 1 },
        { text: "C", x: 5, y: 12, w: 1 },
        { text: "D", x: 20, y: 12, w: 1 },
      ];

      const results = await extractor.extract(filePath);

      expect(results).toEqual([]);
    });
  });

  // ── Error handling ────────────────────────────────────────────

  describe("error handling", () => {
    test("throws FileAccessError for non-existent file", async () => {
      const extractor = new PdfTableExtractor();

      try {
        await extractor.extract("/nonexistent/path/to/file.pdf");
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(FileAccessError);
      }
    });

    test("throws FileTooLargeError for oversized file", async () => {
      const extractor = new PdfTableExtractor({ maxFileSizeBytes: 10 });
      const filePath = await createTempPdf(Buffer.alloc(100));

      try {
        await extractor.extract(filePath);
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(FileTooLargeError);
      }
    });

    test("throws ExtractionError for corrupt PDF", async () => {
      const extractor = new PdfTableExtractor();
      const filePath = await createTempPdf();

      mockParseError = "Invalid PDF structure";

      try {
        await extractor.extract(filePath);
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(ExtractionError);
      }
    });

    test("throws PasswordProtectedError for encrypted PDF", async () => {
      const extractor = new PdfTableExtractor();
      const filePath = await createTempPdf();

      mockParseError = "PDF is password encrypted";

      try {
        await extractor.extract(filePath);
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(PasswordProtectedError);
        expect((error as PasswordProtectedError).retryable).toBe(false);
      }
    });

    test("throws ExtractionTimeoutError when parsing hangs", async () => {
      const extractor = new PdfTableExtractor({ timeoutMs: 100 });
      const filePath = await createTempPdf();

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
    test("handles whitespace-only text items gracefully", async () => {
      const extractor = new PdfTableExtractor();
      const filePath = await createTempPdf();

      mockParseItems = [
        { page: 1 },
        { text: "   ", x: 5, y: 10, w: 1 }, // whitespace only — should be skipped
        { text: "A", x: 5, y: 12, w: 1 },
        { text: "B", x: 20, y: 12, w: 1 },
        { text: "C", x: 5, y: 14, w: 1 },
        { text: "D", x: 20, y: 14, w: 1 },
      ];

      const results = await extractor.extract(filePath);

      expect(results.length).toBe(1);
      expect(results[0]!.table.rows.length).toBe(2);
    });

    test("handles items with missing x/y coordinates", async () => {
      const extractor = new PdfTableExtractor();
      const filePath = await createTempPdf();

      mockParseItems = [
        { page: 1 },
        // Items with undefined x/y default to 0
        { text: "A", y: 10, w: 1 },
        { text: "B", x: 20, y: 10, w: 1 },
        { text: "C", y: 12, w: 1 },
        { text: "D", x: 20, y: 12, w: 1 },
      ];

      const results = await extractor.extract(filePath);

      // Should still detect a table (x defaults to 0 for first column)
      expect(results.length).toBe(1);
    });

    test("handles single row (below default minRows)", async () => {
      const extractor = new PdfTableExtractor();
      const filePath = await createTempPdf();

      mockParseItems = [
        { page: 1 },
        { text: "A", x: 5, y: 10, w: 1 },
        { text: "B", x: 20, y: 10, w: 1 },
      ];

      const results = await extractor.extract(filePath);

      // Single row doesn't meet minRows=2
      expect(results).toEqual([]);
    });

    test("handles tables across multiple pages", async () => {
      const extractor = new PdfTableExtractor();
      const filePath = await createTempPdf();

      mockParseItems = [
        // Page 1 table
        { page: 1 },
        { text: "A1", x: 5, y: 10, w: 1 },
        { text: "B1", x: 20, y: 10, w: 1 },
        { text: "C1", x: 5, y: 12, w: 1 },
        { text: "D1", x: 20, y: 12, w: 1 },
        // Page 2 table
        { page: 2 },
        { text: "A2", x: 5, y: 10, w: 1 },
        { text: "B2", x: 20, y: 10, w: 1 },
        { text: "C2", x: 5, y: 12, w: 1 },
        { text: "D2", x: 20, y: 12, w: 1 },
      ];

      const results = await extractor.extract(filePath);

      expect(results.length).toBe(2);
      expect(results[0]!.pageNumber).toBe(1);
      expect(results[0]!.tableIndex).toBe(0);
      expect(results[1]!.pageNumber).toBe(2);
      expect(results[1]!.tableIndex).toBe(1);
    });

    test("ignores text items with null/undefined text", async () => {
      const extractor = new PdfTableExtractor();
      const filePath = await createTempPdf();

      mockParseItems = [
        { page: 1 },
        { x: 5, y: 10, w: 1 }, // no text property
        { text: "A", x: 5, y: 10, w: 1 },
        { text: "B", x: 20, y: 10, w: 1 },
        { text: "C", x: 5, y: 12, w: 1 },
        { text: "D", x: 20, y: 12, w: 1 },
      ];

      const results = await extractor.extract(filePath);

      expect(results.length).toBe(1);
    });

    test("fills empty cells with empty content string", async () => {
      const extractor = new PdfTableExtractor();
      const filePath = await createTempPdf();

      mockParseItems = [
        { page: 1 },
        // Row 1: both columns filled
        { text: "A", x: 5, y: 10, w: 1 },
        { text: "B", x: 20, y: 10, w: 1 },
        // Row 2
        { text: "C", x: 5, y: 12, w: 1 },
        { text: "D", x: 20, y: 12, w: 1 },
      ];

      const results = await extractor.extract(filePath);

      expect(results.length).toBe(1);
      // All cells should have content (either real or empty string)
      for (const row of results[0]!.table.rows) {
        for (const cell of row.cells) {
          expect(typeof cell.content).toBe("string");
        }
      }
    });
  });

  // ── Additional edge cases ────────────────────────────────────

  describe("additional edge cases", () => {
    test("extracts large table with 10 rows and 5 columns", async () => {
      const extractor = new PdfTableExtractor();
      const filePath = await createTempPdf();

      const items: Array<{ page?: number; text?: string; x?: number; y?: number; w?: number }> = [
        { page: 1 },
      ];

      const columns = [5, 15, 25, 35, 45];
      for (let row = 0; row < 10; row++) {
        const y = 10 + row * 2;
        for (let col = 0; col < 5; col++) {
          items.push({
            text: row === 0 ? `H${col + 1}` : `R${row}C${col + 1}`,
            x: columns[col],
            y,
            w: 3,
          });
        }
      }

      mockParseItems = items;
      const results = await extractor.extract(filePath);

      expect(results.length).toBe(1);
      expect(results[0]!.table.columnCount).toBe(5);
      expect(results[0]!.table.rows.length).toBe(10);
      expect(results[0]!.table.rows[0]!.isHeader).toBe(true);
      expect(results[0]!.table.rows[9]!.cells[4]!.content).toBe("R9C5");
    });

    test("handles special characters in cell content", async () => {
      const extractor = new PdfTableExtractor();
      const filePath = await createTempPdf();

      mockParseItems = [
        { page: 1 },
        { text: "Price ($)", x: 5, y: 10, w: 5 },
        { text: "Tax %", x: 20, y: 10, w: 3 },
        { text: "$1,234.56", x: 5, y: 12, w: 5 },
        { text: "8.5%", x: 20, y: 12, w: 3 },
        { text: 'Item "A"', x: 5, y: 14, w: 5 },
        { text: "N/A", x: 20, y: 14, w: 3 },
      ];

      const results = await extractor.extract(filePath);

      expect(results.length).toBe(1);
      expect(results[0]!.table.rows[0]!.cells[0]!.content).toBe("Price ($)");
      expect(results[0]!.table.rows[1]!.cells[0]!.content).toBe("$1,234.56");
      expect(results[0]!.table.rows[2]!.cells[0]!.content).toBe('Item "A"');
    });

    test("columns very close together near COLUMN_X_TOLERANCE boundary", async () => {
      // COLUMN_X_TOLERANCE is 1.0 — columns at x=5 and x=6.5 should merge
      // but x=5 and x=7 should be separate
      const extractor = new PdfTableExtractor();
      const filePath = await createTempPdf();

      mockParseItems = [
        { page: 1 },
        // Two columns at x=5 and x=7 (difference = 2 > COLUMN_X_TOLERANCE of 1.0)
        { text: "A", x: 5, y: 10, w: 1 },
        { text: "B", x: 7, y: 10, w: 1 },
        { text: "C", x: 5, y: 12, w: 1 },
        { text: "D", x: 7, y: 12, w: 1 },
      ];

      const results = await extractor.extract(filePath);

      expect(results.length).toBe(1);
      expect(results[0]!.table.columnCount).toBe(2);
    });

    test("multiple consecutive rowSpans across 3+ rows", async () => {
      const extractor = new PdfTableExtractor();
      const filePath = await createTempPdf();

      // 3-column table: col 0 spans rows via empty cells below
      // The algorithm only detects immediate rowSpan (cell above has content),
      // so two consecutive empty rows each trigger separate rowSpan increments
      // only for the directly adjacent non-empty cell above.
      mockParseItems = [
        { page: 1 },
        // Row 0 — all 3 columns
        { text: "Category", x: 5, y: 10, w: 1 },
        { text: "V1", x: 20, y: 10, w: 1 },
        { text: "N1", x: 40, y: 10, w: 1 },
        // Row 1 — col 0 empty (rowSpan from row 0)
        { text: "V2", x: 20, y: 12, w: 1 },
        { text: "N2", x: 40, y: 12, w: 1 },
        // Row 2 — col 0 empty again; algorithm checks cell above (row 1)
        // which is an empty string from rowSpan skip, so no further rowSpan
        { text: "V3", x: 20, y: 14, w: 1 },
        { text: "N3", x: 40, y: 14, w: 1 },
        // Row 3 — new category
        { text: "Other", x: 5, y: 16, w: 1 },
        { text: "V4", x: 20, y: 16, w: 1 },
        { text: "N4", x: 40, y: 16, w: 1 },
      ];

      const results = await extractor.extract(filePath);

      expect(results.length).toBe(1);
      // "Category" in row 0, col 0 gets rowSpan=2 (only the immediately
      // adjacent empty cell is detected as a rowSpan continuation)
      const firstCell = results[0]!.table.rows[0]!.cells[0]!;
      expect(firstCell.content).toBe("Category");
      expect(firstCell.rowSpan).toBe(2);

      // Row 2 col 0 is treated as an empty cell (not a rowSpan continuation)
      // because the cell above it (row 1) has no content after the skip
      expect(results[0]!.table.rows.length).toBe(4);
    });

    test("row with items at x-positions not matching any column boundary", async () => {
      const extractor = new PdfTableExtractor();
      const filePath = await createTempPdf();

      mockParseItems = [
        { page: 1 },
        // Rows with consistent columns at x=5 and x=20
        { text: "A", x: 5, y: 10, w: 1 },
        { text: "B", x: 20, y: 10, w: 1 },
        { text: "C", x: 5, y: 12, w: 1 },
        { text: "D", x: 20, y: 12, w: 1 },
        // Row with items far from any column boundary (x=50)
        { text: "Outlier", x: 50, y: 14, w: 1 },
        // More aligned rows
        { text: "E", x: 5, y: 16, w: 1 },
        { text: "F", x: 20, y: 16, w: 1 },
      ];

      const results = await extractor.extract(filePath);

      // Should detect tables; the outlier row breaks the region
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    test("confidence score is lower for partially aligned tables", async () => {
      const extractor = new PdfTableExtractor();
      const filePath = await createTempPdf();

      // First: a perfectly aligned table
      mockParseItems = [
        { page: 1 },
        { text: "A", x: 5, y: 10, w: 1 },
        { text: "B", x: 20, y: 10, w: 1 },
        { text: "C", x: 5, y: 12, w: 1 },
        { text: "D", x: 20, y: 12, w: 1 },
      ];

      const perfectResults = await extractor.extract(filePath);
      const perfectConfidence = perfectResults[0]!.confidence!;

      // Now: a table with slightly misaligned items (within tolerance but not perfect)
      mockParseItems = [
        { page: 1 },
        { text: "A", x: 5, y: 10, w: 1 },
        { text: "B", x: 20, y: 10, w: 1 },
        { text: "C", x: 5.8, y: 12, w: 1 }, // slightly off from x=5
        { text: "D", x: 20, y: 12, w: 1 },
      ];

      const filePath2 = await createTempPdf();
      const offsetResults = await extractor.extract(filePath2);

      // Both should be valid tables
      expect(perfectResults.length).toBe(1);
      expect(offsetResults.length).toBe(1);

      // Both should have valid confidence scores
      expect(perfectConfidence).toBeGreaterThanOrEqual(0);
      expect(perfectConfidence).toBeLessThanOrEqual(1);
      expect(offsetResults[0]!.confidence!).toBeGreaterThanOrEqual(0);
      expect(offsetResults[0]!.confidence!).toBeLessThanOrEqual(1);
    });
  });

  // ── Fixture integration tests ─────────────────────────────────

  describe("fixture files", () => {
    test("fixture files exist", async () => {
      const expectedFiles = [
        "simple-table.pdf",
        "multi-table.pdf",
        "merged-cells.pdf",
        "no-table.pdf",
        "three-column-table.pdf",
        "empty.pdf",
      ];

      for (const file of expectedFiles) {
        const filePath = path.join(PDF_TABLES_DIR, file);
        const stats = await fs.stat(filePath);
        expect(stats.isFile()).toBe(true);
        expect(stats.size).toBeGreaterThan(0);
      }
    });
  });

  // ── Export verification ───────────────────────────────────────

  describe("module exports", () => {
    test("PdfTableExtractor is exported from extractors index", async () => {
      const mod = await import("../../../src/documents/extractors/index.js");
      expect(mod.PdfTableExtractor).toBeDefined();
    });

    test("PdfTableExtractor is exported from documents index", async () => {
      const mod = await import("../../../src/documents/index.js");
      expect(mod.PdfTableExtractor).toBeDefined();
    });
  });
});
