/**
 * Tests for Tables List Output Formatters
 *
 * Tests formatting functions for extracted table displays:
 * - createTablesListTable: CLI table display
 * - formatTablesListJson: JSON output
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import { describe, it, expect } from "bun:test";
import {
  createTablesListTable,
  formatTablesListJson,
  formatTableExportSuccess,
  type TableDisplayInfo,
} from "../../../src/cli/output/tables-formatters.js";

/**
 * Create test table display info with sensible defaults
 */
function createTestTable(overrides: Partial<TableDisplayInfo> = {}): TableDisplayInfo {
  return {
    repository: "test-repo",
    filePath: "docs/report.pdf",
    tableIndex: 0,
    caption: "Test Table",
    columnCount: 3,
    rowCount: 5,
    sourceType: "pdf",
    confidence: 0.95,
    chunkCount: 1,
    ...overrides,
  };
}

describe("Tables Formatters", () => {
  describe("createTablesListTable", () => {
    it("should create a table for extracted tables", () => {
      const tables: TableDisplayInfo[] = [
        createTestTable({
          filePath: "docs/report.pdf",
          tableIndex: 0,
          caption: "Revenue Data",
          columnCount: 4,
          rowCount: 10,
        }),
        createTestTable({
          filePath: "docs/report.pdf",
          tableIndex: 1,
          caption: "Expense Summary",
          columnCount: 3,
          rowCount: 8,
        }),
      ];

      const output = createTablesListTable(tables);

      expect(output).toContain("docs/report.pdf");
      expect(output).toContain("Revenue Data");
      expect(output).toContain("Expense Summary");
      expect(output).toContain("10x4");
      expect(output).toContain("8x3");
      expect(output).toContain("2 total");
    });

    it("should show empty state when no tables found", () => {
      const output = createTablesListTable([]);

      expect(output).toContain("No tables found");
      expect(output).toContain("pk-mcp status");
    });

    it("should show repository name in empty state when filtered", () => {
      const output = createTablesListTable([], "my-repo");

      expect(output).toContain("No tables found");
      expect(output).toContain("my-repo");
    });

    it("should show repository name in header when filtered", () => {
      const tables: TableDisplayInfo[] = [createTestTable()];

      const output = createTablesListTable(tables, "my-repo");

      expect(output).toContain("my-repo");
      expect(output).toContain("1 total");
    });

    it("should show confidence as percentage", () => {
      const tables: TableDisplayInfo[] = [createTestTable({ confidence: 0.85 })];

      const output = createTablesListTable(tables);

      expect(output).toContain("85%");
    });

    it("should show dash for undefined confidence", () => {
      const tables: TableDisplayInfo[] = [createTestTable({ confidence: undefined })];

      const output = createTablesListTable(tables);

      expect(output).toContain("-");
    });

    it("should show (none) for undefined caption", () => {
      const tables: TableDisplayInfo[] = [createTestTable({ caption: undefined })];

      const output = createTablesListTable(tables);

      expect(output).toContain("(none)");
    });

    it("should truncate long file paths", () => {
      const tables: TableDisplayInfo[] = [
        createTestTable({
          filePath: "very/deeply/nested/folder/structure/with/long/path/document.pdf",
        }),
      ];

      const output = createTablesListTable(tables);

      // Should be truncated with ellipsis
      expect(output).toContain("...");
    });

    it("should truncate long captions", () => {
      const tables: TableDisplayInfo[] = [
        createTestTable({
          caption: "This is a very long table caption that should be truncated for display",
        }),
      ];

      const output = createTablesListTable(tables);

      expect(output).toContain("...");
    });

    it("should display multiple chunk counts", () => {
      const tables: TableDisplayInfo[] = [createTestTable({ chunkCount: 3 })];

      const output = createTablesListTable(tables);

      expect(output).toContain("3");
    });

    it("should display tables from multiple repositories", () => {
      const tables: TableDisplayInfo[] = [
        createTestTable({ repository: "repo-a", filePath: "a.pdf" }),
        createTestTable({ repository: "repo-b", filePath: "b.docx", sourceType: "docx" }),
      ];

      const output = createTablesListTable(tables);

      expect(output).toContain("repo-a");
      expect(output).toContain("repo-b");
      expect(output).toContain("2 total");
    });
  });

  describe("formatTablesListJson", () => {
    it("should format tables as JSON", () => {
      const tables: TableDisplayInfo[] = [
        createTestTable({
          repository: "my-repo",
          filePath: "docs/report.pdf",
          tableIndex: 0,
          caption: "Revenue Data",
          columnCount: 4,
          rowCount: 10,
          sourceType: "pdf",
          confidence: 0.95,
          chunkCount: 2,
        }),
      ];

      const json = formatTablesListJson(tables);
      const parsed = JSON.parse(json);

      expect(parsed.totalTables).toBe(1);
      expect(parsed.tables).toHaveLength(1);
      expect(parsed.tables[0].repository).toBe("my-repo");
      expect(parsed.tables[0].filePath).toBe("docs/report.pdf");
      expect(parsed.tables[0].tableIndex).toBe(0);
      expect(parsed.tables[0].caption).toBe("Revenue Data");
      expect(parsed.tables[0].columnCount).toBe(4);
      expect(parsed.tables[0].rowCount).toBe(10);
      expect(parsed.tables[0].sourceType).toBe("pdf");
      expect(parsed.tables[0].confidence).toBe(0.95);
      expect(parsed.tables[0].chunkCount).toBe(2);
    });

    it("should include repository name when filtered", () => {
      const tables: TableDisplayInfo[] = [createTestTable()];

      const json = formatTablesListJson(tables, "my-repo");
      const parsed = JSON.parse(json);

      expect(parsed.repository).toBe("my-repo");
    });

    it("should not include repository key when not filtered", () => {
      const tables: TableDisplayInfo[] = [createTestTable()];

      const json = formatTablesListJson(tables);
      const parsed = JSON.parse(json);

      expect(parsed.repository).toBeUndefined();
    });

    it("should format empty results", () => {
      const json = formatTablesListJson([]);
      const parsed = JSON.parse(json);

      expect(parsed.totalTables).toBe(0);
      expect(parsed.tables).toHaveLength(0);
    });

    it("should output null for undefined caption", () => {
      const tables: TableDisplayInfo[] = [createTestTable({ caption: undefined })];

      const json = formatTablesListJson(tables);
      const parsed = JSON.parse(json);

      expect(parsed.tables[0].caption).toBeNull();
    });

    it("should output null for undefined confidence", () => {
      const tables: TableDisplayInfo[] = [createTestTable({ confidence: undefined })];

      const json = formatTablesListJson(tables);
      const parsed = JSON.parse(json);

      expect(parsed.tables[0].confidence).toBeNull();
    });

    it("should format multiple tables", () => {
      const tables: TableDisplayInfo[] = [
        createTestTable({ tableIndex: 0 }),
        createTestTable({ tableIndex: 1 }),
        createTestTable({ tableIndex: 2 }),
      ];

      const json = formatTablesListJson(tables);
      const parsed = JSON.parse(json);

      expect(parsed.totalTables).toBe(3);
      expect(parsed.tables).toHaveLength(3);
    });
  });

  describe("formatTableExportSuccess", () => {
    it("should format success message with file path and format", () => {
      const output = formatTableExportSuccess("/tmp/output.csv", "csv");

      expect(output).toContain("exported successfully");
      expect(output).toContain("/tmp/output.csv");
      expect(output).toContain("CSV");
    });

    it("should handle json format", () => {
      const output = formatTableExportSuccess("/tmp/output.json", "json");

      expect(output).toContain("exported successfully");
      expect(output).toContain("/tmp/output.json");
      expect(output).toContain("JSON");
    });
  });
});
