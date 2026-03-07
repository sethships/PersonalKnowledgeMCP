/**
 * Unit tests for table extraction types.
 *
 * Validates that all table-related types are importable, structurally
 * correct, and compatible with the existing extractor type hierarchy.
 */

import { describe, test, expect } from "bun:test";
import type {
  TableSourceType,
  TableCell,
  TableRow,
  TableData,
  TableExtractionResult,
  TableExtractorConfig,
  TableExtractor,
  DocumentExtractor,
  ExtractorConfig,
} from "../../../src/documents/index.js";
import { DEFAULT_EXTRACTOR_CONFIG } from "../../../src/documents/index.js";

describe("TableSourceType", () => {
  test("accepts 'pdf' as a valid source type", () => {
    const source: TableSourceType = "pdf";
    expect(source).toBe("pdf");
  });

  test("accepts 'docx' as a valid source type", () => {
    const source: TableSourceType = "docx";
    expect(source).toBe("docx");
  });
});

describe("TableCell", () => {
  test("can be constructed with only required fields", () => {
    const cell: TableCell = { content: "Hello" };
    expect(cell.content).toBe("Hello");
    expect(cell.rowSpan).toBeUndefined();
    expect(cell.colSpan).toBeUndefined();
  });

  test("can be constructed with all fields", () => {
    const cell: TableCell = { content: "Merged", rowSpan: 2, colSpan: 3 };
    expect(cell.content).toBe("Merged");
    expect(cell.rowSpan).toBe(2);
    expect(cell.colSpan).toBe(3);
  });

  test("allows empty string content", () => {
    const cell: TableCell = { content: "" };
    expect(cell.content).toBe("");
  });
});

describe("TableRow", () => {
  test("can be constructed with only required fields", () => {
    const row: TableRow = { cells: [{ content: "A" }] };
    expect(row.cells).toHaveLength(1);
    expect(row.isHeader).toBeUndefined();
  });

  test("can be constructed with isHeader flag", () => {
    const row: TableRow = {
      cells: [{ content: "Name" }, { content: "Value" }],
      isHeader: true,
    };
    expect(row.cells).toHaveLength(2);
    expect(row.isHeader).toBe(true);
  });

  test("supports empty cells array", () => {
    const row: TableRow = { cells: [] };
    expect(row.cells).toHaveLength(0);
  });
});

describe("TableData", () => {
  test("can be constructed with required fields only", () => {
    const table: TableData = {
      rows: [{ cells: [{ content: "A" }] }],
      columnCount: 1,
    };
    expect(table.rows).toHaveLength(1);
    expect(table.columnCount).toBe(1);
    expect(table.caption).toBeUndefined();
  });

  test("can be constructed with caption", () => {
    const table: TableData = {
      rows: [],
      columnCount: 0,
      caption: "Sales Data Q1",
    };
    expect(table.caption).toBe("Sales Data Q1");
  });

  test("supports multi-row tables with header", () => {
    const table: TableData = {
      rows: [
        { cells: [{ content: "Name" }, { content: "Age" }], isHeader: true },
        { cells: [{ content: "Alice" }, { content: "30" }] },
        { cells: [{ content: "Bob" }, { content: "25" }] },
      ],
      columnCount: 2,
    };
    expect(table.rows).toHaveLength(3);
    expect(table.rows[0]!.isHeader).toBe(true);
    expect(table.rows[1]!.isHeader).toBeUndefined();
  });
});

describe("TableExtractionResult", () => {
  const minimalTable: TableData = { rows: [], columnCount: 0 };

  test("can be constructed with required fields only", () => {
    const result: TableExtractionResult = {
      table: minimalTable,
      filePath: "/docs/report.pdf",
      sourceType: "pdf",
      tableIndex: 0,
    };
    expect(result.table).toBe(minimalTable);
    expect(result.filePath).toBe("/docs/report.pdf");
    expect(result.sourceType).toBe("pdf");
    expect(result.tableIndex).toBe(0);
    expect(result.pageNumber).toBeUndefined();
    expect(result.confidence).toBeUndefined();
  });

  test("can be constructed with all optional fields", () => {
    const result: TableExtractionResult = {
      table: minimalTable,
      filePath: "/docs/report.pdf",
      sourceType: "pdf",
      tableIndex: 2,
      pageNumber: 4,
      confidence: 0.95,
    };
    expect(result.pageNumber).toBe(4);
    expect(result.confidence).toBe(0.95);
    expect(result.tableIndex).toBe(2);
  });

  test("supports docx source type", () => {
    const result: TableExtractionResult = {
      table: minimalTable,
      filePath: "/docs/spec.docx",
      sourceType: "docx",
      tableIndex: 0,
    };
    expect(result.sourceType).toBe("docx");
  });

  test("confidence at boundary values (0.0 and 1.0)", () => {
    const low: TableExtractionResult = {
      table: minimalTable,
      filePath: "/test.pdf",
      sourceType: "pdf",
      tableIndex: 0,
      confidence: 0.0,
    };
    const high: TableExtractionResult = {
      table: minimalTable,
      filePath: "/test.pdf",
      sourceType: "pdf",
      tableIndex: 0,
      confidence: 1.0,
    };
    expect(low.confidence).toBe(0.0);
    expect(high.confidence).toBe(1.0);
  });

  test("span fields at boundary values", () => {
    const cell: TableCell = { content: "span-test", rowSpan: 1, colSpan: 1 };
    expect(cell.rowSpan).toBe(1);
    expect(cell.colSpan).toBe(1);

    const largeSpan: TableCell = { content: "large", rowSpan: 100, colSpan: 50 };
    expect(largeSpan.rowSpan).toBe(100);
    expect(largeSpan.colSpan).toBe(50);
  });
});

describe("TableExtractorConfig", () => {
  test("is compatible with ExtractorConfig", () => {
    const config: TableExtractorConfig = {
      maxFileSizeBytes: 10_000_000,
      timeoutMs: 15_000,
    };
    // Assignable to base ExtractorConfig
    const baseConfig: ExtractorConfig = config;
    expect(baseConfig.maxFileSizeBytes).toBe(10_000_000);
    expect(baseConfig.timeoutMs).toBe(15_000);
  });

  test("can be constructed empty (all fields optional)", () => {
    const config: TableExtractorConfig = {};
    expect(config.maxFileSizeBytes).toBeUndefined();
    expect(config.timeoutMs).toBeUndefined();
  });

  test("is compatible with DEFAULT_EXTRACTOR_CONFIG", () => {
    const config: TableExtractorConfig = { ...DEFAULT_EXTRACTOR_CONFIG };
    expect(config.maxFileSizeBytes).toBe(DEFAULT_EXTRACTOR_CONFIG.maxFileSizeBytes);
    expect(config.timeoutMs).toBe(DEFAULT_EXTRACTOR_CONFIG.timeoutMs);
  });
});

describe("TableExtractor", () => {
  test("mock implementation satisfies the interface contract", async () => {
    const mockExtractor: TableExtractor = {
      async extract(filePath: string): Promise<TableExtractionResult[]> {
        return [
          {
            table: {
              rows: [{ cells: [{ content: "data" }] }],
              columnCount: 1,
            },
            filePath,
            sourceType: "pdf",
            tableIndex: 0,
          },
        ];
      },
      supports(extension: string): boolean {
        return extension === ".pdf";
      },
    };

    expect(mockExtractor.supports(".pdf")).toBe(true);
    expect(mockExtractor.supports(".docx")).toBe(false);

    const results = await mockExtractor.extract("/test.pdf");
    expect(results).toHaveLength(1);
    expect(results[0]!.table.columnCount).toBe(1);
    expect(results[0]!.filePath).toBe("/test.pdf");
    expect(results[0]!.sourceType).toBe("pdf");
    expect(results[0]!.tableIndex).toBe(0);
  });

  test("extends DocumentExtractor structural contract", () => {
    // A TableExtractor must be assignable to DocumentExtractor<TableExtractionResult[]>
    const extractor: TableExtractor = {
      async extract(_filePath: string): Promise<TableExtractionResult[]> {
        return [];
      },
      supports(_ext: string): boolean {
        return false;
      },
    };

    const docExtractor: DocumentExtractor<TableExtractionResult[]> = extractor;
    expect(docExtractor.supports).toBeDefined();
    expect(docExtractor.extract).toBeDefined();
  });

  test("extract returns empty array when no tables found", async () => {
    const extractor: TableExtractor = {
      async extract(): Promise<TableExtractionResult[]> {
        return [];
      },
      supports(): boolean {
        return true;
      },
    };

    const results = await extractor.extract("/empty.pdf");
    expect(results).toEqual([]);
  });
});
