/**
 * Unit tests for TableFormatter.
 *
 * Tests Markdown, CSV, and JSON export of TableData structures including
 * simple tables, merged cells, special characters, and edge cases.
 */

import { describe, test, expect } from "bun:test";
import { TableFormatter } from "../../../src/documents/TableFormatter.js";
import type { TableData } from "../../../src/documents/types.js";

// ── Helpers ──────────────────────────────────────────────────────

/** Build a simple TableData for common test scenarios. */
function makeTable(overrides?: Partial<TableData>): TableData {
  return {
    rows: [
      { cells: [{ content: "Name" }, { content: "Age" }], isHeader: true },
      { cells: [{ content: "Alice" }, { content: "30" }] },
      { cells: [{ content: "Bob" }, { content: "25" }] },
    ],
    columnCount: 2,
    ...overrides,
  };
}

// ── Markdown export ──────────────────────────────────────────────

describe("TableFormatter.toMarkdown()", () => {
  test("renders a simple 2-column table", () => {
    const md = TableFormatter.toMarkdown(makeTable());

    expect(md).toContain("| Name | Age |");
    expect(md).toContain("| --- | --- |");
    expect(md).toContain("| Alice | 30 |");
    expect(md).toContain("| Bob | 25 |");
  });

  test("header row is followed by separator", () => {
    const md = TableFormatter.toMarkdown(makeTable());
    const lines = md.split("\n");

    expect(lines[0]).toBe("| Name | Age |");
    expect(lines[1]).toBe("| --- | --- |");
  });

  test("returns empty string for table with no rows", () => {
    const table: TableData = { rows: [], columnCount: 2 };

    expect(TableFormatter.toMarkdown(table)).toBe("");
  });

  test("renders empty cells as blank", () => {
    const table: TableData = {
      rows: [
        { cells: [{ content: "A" }, { content: "" }], isHeader: true },
        { cells: [{ content: "" }, { content: "B" }] },
      ],
      columnCount: 2,
    };

    const md = TableFormatter.toMarkdown(table);
    expect(md).toContain("| A |  |");
    expect(md).toContain("|  | B |");
  });

  test("escapes pipe characters in cell content", () => {
    const table: TableData = {
      rows: [
        { cells: [{ content: "A|B" }, { content: "C" }], isHeader: true },
        { cells: [{ content: "D" }, { content: "E" }] },
      ],
      columnCount: 2,
    };

    const md = TableFormatter.toMarkdown(table);
    expect(md).toContain("A\\|B");
  });

  test("replaces newlines with <br>", () => {
    const table: TableData = {
      rows: [
        { cells: [{ content: "H1" }, { content: "H2" }], isHeader: true },
        { cells: [{ content: "line1\nline2" }, { content: "ok" }] },
      ],
      columnCount: 2,
    };

    const md = TableFormatter.toMarkdown(table);
    expect(md).toContain("line1<br>line2");
  });

  test("replaces Windows-style CRLF and bare CR with <br>", () => {
    const table: TableData = {
      rows: [
        { cells: [{ content: "H1" }, { content: "H2" }], isHeader: true },
        { cells: [{ content: "a\r\nb" }, { content: "c\rd" }] },
      ],
      columnCount: 2,
    };

    const md = TableFormatter.toMarkdown(table);
    expect(md).toContain("a<br>b");
    expect(md).toContain("c<br>d");
  });

  test("escapes backslashes in cell content", () => {
    const table: TableData = {
      rows: [
        { cells: [{ content: "H1" }, { content: "H2" }], isHeader: true },
        { cells: [{ content: "C:\\path" }, { content: "ok" }] },
      ],
      columnCount: 2,
    };

    const md = TableFormatter.toMarkdown(table);
    expect(md).toContain("C:\\\\path");
  });

  test("expands colSpan cells with empty placeholders", () => {
    const table: TableData = {
      rows: [
        { cells: [{ content: "Wide", colSpan: 2 }], isHeader: true },
        { cells: [{ content: "A" }, { content: "B" }] },
      ],
      columnCount: 2,
    };

    const md = TableFormatter.toMarkdown(table);
    const lines = md.split("\n");
    // Header row should have 2 columns: "Wide" and empty
    expect(lines[0]).toBe("| Wide |  |");
  });

  test("pads rows with fewer cells than columnCount", () => {
    const table: TableData = {
      rows: [
        { cells: [{ content: "H1" }, { content: "H2" }, { content: "H3" }], isHeader: true },
        { cells: [{ content: "A" }] }, // only 1 cell for 3-column table
      ],
      columnCount: 3,
    };

    const md = TableFormatter.toMarkdown(table);
    const lines = md.split("\n");
    expect(lines[2]).toBe("| A |  |  |");
  });

  test("inserts separator only once even if multiple header rows", () => {
    const table: TableData = {
      rows: [
        { cells: [{ content: "H1" }, { content: "H2" }], isHeader: true },
        { cells: [{ content: "H3" }, { content: "H4" }], isHeader: true },
        { cells: [{ content: "A" }, { content: "B" }] },
      ],
      columnCount: 2,
    };

    const md = TableFormatter.toMarkdown(table);
    const separatorCount = (md.match(/\| --- \| --- \|/g) || []).length;
    expect(separatorCount).toBe(1);
  });
});

// ── CSV export ───────────────────────────────────────────────────

describe("TableFormatter.toCsv()", () => {
  test("renders a simple table as CSV", () => {
    const csv = TableFormatter.toCsv(makeTable());
    const lines = csv.split("\r\n");

    expect(lines[0]).toBe("Name,Age");
    expect(lines[1]).toBe("Alice,30");
    expect(lines[2]).toBe("Bob,25");
  });

  test("uses CRLF line endings per RFC 4180", () => {
    const csv = TableFormatter.toCsv(makeTable());

    expect(csv).toContain("\r\n");
    expect(csv.split("\r\n").length).toBe(3);
  });

  test("quotes fields containing commas", () => {
    const table: TableData = {
      rows: [
        { cells: [{ content: "Name" }, { content: "Address" }], isHeader: true },
        { cells: [{ content: "Alice" }, { content: "123 Main St, Apt 4" }] },
      ],
      columnCount: 2,
    };

    const csv = TableFormatter.toCsv(table);
    expect(csv).toContain('"123 Main St, Apt 4"');
  });

  test("double-escapes quotes inside fields", () => {
    const table: TableData = {
      rows: [
        { cells: [{ content: "Key" }, { content: "Value" }], isHeader: true },
        { cells: [{ content: "quote" }, { content: 'She said "hello"' }] },
      ],
      columnCount: 2,
    };

    const csv = TableFormatter.toCsv(table);
    expect(csv).toContain('"She said ""hello"""');
  });

  test("quotes fields containing newlines", () => {
    const table: TableData = {
      rows: [
        { cells: [{ content: "Key" }, { content: "Value" }], isHeader: true },
        { cells: [{ content: "multi" }, { content: "line1\nline2" }] },
      ],
      columnCount: 2,
    };

    const csv = TableFormatter.toCsv(table);
    expect(csv).toContain('"line1\nline2"');
  });

  test("includes header row as first CSV line", () => {
    const csv = TableFormatter.toCsv(makeTable());
    const firstLine = csv.split("\r\n")[0];

    expect(firstLine).toBe("Name,Age");
  });

  test("renders empty cells as empty fields", () => {
    const table: TableData = {
      rows: [
        { cells: [{ content: "A" }, { content: "" }], isHeader: true },
        { cells: [{ content: "" }, { content: "B" }] },
      ],
      columnCount: 2,
    };

    const csv = TableFormatter.toCsv(table);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("A,");
    expect(lines[1]).toBe(",B");
  });

  test("returns empty string for table with no rows", () => {
    const table: TableData = { rows: [], columnCount: 2 };

    expect(TableFormatter.toCsv(table)).toBe("");
  });

  test("expands colSpan cells in CSV output", () => {
    const table: TableData = {
      rows: [
        { cells: [{ content: "Wide", colSpan: 3 }], isHeader: true },
        { cells: [{ content: "A" }, { content: "B" }, { content: "C" }] },
      ],
      columnCount: 3,
    };

    const csv = TableFormatter.toCsv(table);
    const lines = csv.split("\r\n");
    // "Wide" + 2 empty spans
    expect(lines[0]).toBe("Wide,,");
  });

  test("handles carriage return in field values", () => {
    const table: TableData = {
      rows: [
        { cells: [{ content: "K" }, { content: "V" }], isHeader: true },
        { cells: [{ content: "a" }, { content: "b\rc" }] },
      ],
      columnCount: 2,
    };

    const csv = TableFormatter.toCsv(table);
    expect(csv).toContain('"b\rc"');
  });
});

// ── JSON export ──────────────────────────────────────────────────

describe("TableFormatter.toJson()", () => {
  test("output is valid JSON", () => {
    const json = TableFormatter.toJson(makeTable());

    expect(() => JSON.parse(json) as unknown).not.toThrow();
  });

  test("preserves table structure", () => {
    const table = makeTable();
    const parsed = JSON.parse(TableFormatter.toJson(table)) as TableData;

    expect(parsed.columnCount).toBe(2);
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.rows[0]!.cells[0]!.content).toBe("Name");
  });

  test("includes optional fields when present", () => {
    const table: TableData = {
      rows: [
        { cells: [{ content: "H1", colSpan: 2 }], isHeader: true },
        { cells: [{ content: "A", rowSpan: 2 }, { content: "B" }] },
      ],
      columnCount: 2,
      caption: "Test table",
    };

    const parsed = JSON.parse(TableFormatter.toJson(table)) as TableData;

    expect(parsed.caption).toBe("Test table");
    expect(parsed.rows[0]!.isHeader).toBe(true);
    expect(parsed.rows[0]!.cells[0]!.colSpan).toBe(2);
    expect(parsed.rows[1]!.cells[0]!.rowSpan).toBe(2);
  });

  test("omits optional fields when not present", () => {
    const table: TableData = {
      rows: [{ cells: [{ content: "A" }, { content: "B" }] }],
      columnCount: 2,
    };

    const parsed = JSON.parse(TableFormatter.toJson(table)) as TableData;

    expect(parsed.caption).toBeUndefined();
    expect(parsed.rows[0]!.isHeader).toBeUndefined();
    expect(parsed.rows[0]!.cells[0]!.colSpan).toBeUndefined();
    expect(parsed.rows[0]!.cells[0]!.rowSpan).toBeUndefined();
  });

  test("empty table produces valid JSON", () => {
    const table: TableData = { rows: [], columnCount: 0 };
    const json = TableFormatter.toJson(table);
    const parsed = JSON.parse(json) as TableData;

    expect(parsed.rows).toEqual([]);
    expect(parsed.columnCount).toBe(0);
  });
});
