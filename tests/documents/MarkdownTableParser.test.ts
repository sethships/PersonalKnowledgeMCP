/**
 * Tests for MarkdownTableParser
 *
 * Verifies parsing of Markdown table text back into structured TableData,
 * including caption extraction, escape reversal, separator handling,
 * and multi-chunk header deduplication.
 */

import { describe, it, expect } from "bun:test";
import { MarkdownTableParser } from "../../src/documents/MarkdownTableParser.js";
import { TableFormatter } from "../../src/documents/TableFormatter.js";
import type { TableData } from "../../src/documents/types.js";

describe("MarkdownTableParser", () => {
  describe("parse", () => {
    it("should parse a simple markdown table", () => {
      const markdown = "| Name | Age |\n| --- | --- |\n| Alice | 30 |\n| Bob | 25 |";

      const result = MarkdownTableParser.parse(markdown);

      expect(result.columnCount).toBe(2);
      expect(result.rows).toHaveLength(3);
      expect(result.rows[0]!.isHeader).toBe(true);
      expect(result.rows[0]!.cells[0]!.content).toBe("Name");
      expect(result.rows[0]!.cells[1]!.content).toBe("Age");
      expect(result.rows[1]!.cells[0]!.content).toBe("Alice");
      expect(result.rows[1]!.cells[1]!.content).toBe("30");
      expect(result.rows[2]!.cells[0]!.content).toBe("Bob");
      expect(result.rows[2]!.cells[1]!.content).toBe("25");
    });

    it("should parse a table with caption", () => {
      const markdown = "**Table: Revenue Data**\n\n| Q1 | Q2 |\n| --- | --- |\n| 100 | 200 |";

      const result = MarkdownTableParser.parse(markdown);

      expect(result.caption).toBe("Revenue Data");
      expect(result.columnCount).toBe(2);
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0]!.isHeader).toBe(true);
      expect(result.rows[0]!.cells[0]!.content).toBe("Q1");
    });

    it("should handle escaped pipe characters", () => {
      const markdown = "| Content |\n| --- |\n| value with \\| pipe |";

      const result = MarkdownTableParser.parse(markdown);

      expect(result.rows[1]!.cells[0]!.content).toBe("value with | pipe");
    });

    it("should handle escaped backslashes", () => {
      const markdown = "| Path |\n| --- |\n| C:\\\\Users\\\\test |";

      const result = MarkdownTableParser.parse(markdown);

      expect(result.rows[1]!.cells[0]!.content).toBe("C:\\Users\\test");
    });

    it("should convert <br> back to newlines", () => {
      const markdown = "| Notes |\n| --- |\n| line1<br>line2 |";

      const result = MarkdownTableParser.parse(markdown);

      expect(result.rows[1]!.cells[0]!.content).toBe("line1\nline2");
    });

    it("should handle combined escape sequences", () => {
      const markdown = "| Data |\n| --- |\n| a\\|b<br>c\\\\d |";

      const result = MarkdownTableParser.parse(markdown);

      expect(result.rows[1]!.cells[0]!.content).toBe("a|b\nc\\d");
    });

    it("should handle empty input", () => {
      const result = MarkdownTableParser.parse("");

      expect(result.rows).toHaveLength(0);
      expect(result.columnCount).toBe(0);
    });

    it("should handle whitespace-only input", () => {
      const result = MarkdownTableParser.parse("   \n  \n  ");

      expect(result.rows).toHaveLength(0);
      expect(result.columnCount).toBe(0);
    });

    it("should handle a table with no headers (no separator row)", () => {
      const markdown = "| Alice | 30 |\n| Bob | 25 |";

      const result = MarkdownTableParser.parse(markdown);

      expect(result.columnCount).toBe(2);
      expect(result.rows).toHaveLength(2);
      // Without a separator row, no row is marked as header
      expect(result.rows[0]!.isHeader).toBeUndefined();
      expect(result.rows[1]!.isHeader).toBeUndefined();
    });

    it("should handle a single-row table", () => {
      const markdown = "| Only |\n| --- |";

      const result = MarkdownTableParser.parse(markdown);

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]!.isHeader).toBe(true);
      expect(result.rows[0]!.cells[0]!.content).toBe("Only");
    });

    it("should handle a table with extra whitespace in cells", () => {
      const markdown = "|  Name  |  Age  |\n| --- | --- |\n|  Alice  |  30  |";

      const result = MarkdownTableParser.parse(markdown);

      expect(result.rows[0]!.cells[0]!.content).toBe("Name");
      expect(result.rows[1]!.cells[0]!.content).toBe("Alice");
      expect(result.rows[1]!.cells[1]!.content).toBe("30");
    });

    it("should handle varying column counts across rows", () => {
      const markdown = "| A | B | C |\n| --- | --- | --- |\n| 1 | 2 |";

      const result = MarkdownTableParser.parse(markdown);

      // columnCount should be the max across all rows
      expect(result.columnCount).toBe(3);
      expect(result.rows[1]!.cells).toHaveLength(2);
    });

    it("should handle caption with extra whitespace", () => {
      const markdown = "**Table:   Spaced Caption  **\n\n| A |\n| --- |\n| 1 |";

      const result = MarkdownTableParser.parse(markdown);

      expect(result.caption).toBe("Spaced Caption");
    });
  });

  describe("parseMultiChunk", () => {
    it("should handle empty chunks array", () => {
      const result = MarkdownTableParser.parseMultiChunk([]);

      expect(result.rows).toHaveLength(0);
      expect(result.columnCount).toBe(0);
    });

    it("should handle single chunk", () => {
      const markdown = "| Name | Age |\n| --- | --- |\n| Alice | 30 |";

      const result = MarkdownTableParser.parseMultiChunk([markdown]);

      expect(result.rows).toHaveLength(2);
      expect(result.rows[0]!.isHeader).toBe(true);
    });

    it("should deduplicate headers across chunks", () => {
      const chunk1 =
        "**Table: Test**\n\n| Name | Age |\n| --- | --- |\n| Alice | 30 |\n| Bob | 25 |";
      const chunk2 = "**Table: Test**\n\n| Name | Age |\n| --- | --- |\n| Carol | 35 |";

      const result = MarkdownTableParser.parseMultiChunk([chunk1, chunk2]);

      expect(result.caption).toBe("Test");
      expect(result.rows).toHaveLength(4); // 1 header + 3 data
      expect(result.rows[0]!.isHeader).toBe(true);
      expect(result.rows[0]!.cells[0]!.content).toBe("Name");
      expect(result.rows[1]!.cells[0]!.content).toBe("Alice");
      expect(result.rows[2]!.cells[0]!.content).toBe("Bob");
      expect(result.rows[3]!.cells[0]!.content).toBe("Carol");
    });

    it("should handle three chunks with header deduplication", () => {
      const header = "| Col1 | Col2 |\n| --- | --- |";
      const chunk1 = `${header}\n| A | 1 |`;
      const chunk2 = `${header}\n| B | 2 |`;
      const chunk3 = `${header}\n| C | 3 |`;

      const result = MarkdownTableParser.parseMultiChunk([chunk1, chunk2, chunk3]);

      expect(result.rows).toHaveLength(4); // 1 header + 3 data
      expect(result.rows[0]!.isHeader).toBe(true);
      expect(result.rows[1]!.cells[0]!.content).toBe("A");
      expect(result.rows[2]!.cells[0]!.content).toBe("B");
      expect(result.rows[3]!.cells[0]!.content).toBe("C");
    });

    it("should preserve caption from first chunk only", () => {
      const chunk1 = "**Table: My Table**\n\n| A |\n| --- |\n| 1 |";
      const chunk2 = "**Table: My Table**\n\n| A |\n| --- |\n| 2 |";

      const result = MarkdownTableParser.parseMultiChunk([chunk1, chunk2]);

      expect(result.caption).toBe("My Table");
    });
  });

  describe("round-trip with TableFormatter", () => {
    it("should round-trip a simple table through format and parse", () => {
      const original: TableData = {
        rows: [
          { cells: [{ content: "Name" }, { content: "Age" }], isHeader: true },
          { cells: [{ content: "Alice" }, { content: "30" }] },
          { cells: [{ content: "Bob" }, { content: "25" }] },
        ],
        columnCount: 2,
      };

      const markdown = TableFormatter.toMarkdown(original);
      const parsed = MarkdownTableParser.parse(markdown);

      expect(parsed.columnCount).toBe(2);
      expect(parsed.rows).toHaveLength(3);
      expect(parsed.rows[0]!.isHeader).toBe(true);
      expect(parsed.rows[0]!.cells[0]!.content).toBe("Name");
      expect(parsed.rows[1]!.cells[0]!.content).toBe("Alice");
      expect(parsed.rows[2]!.cells[1]!.content).toBe("25");
    });

    it("should round-trip a table with special characters", () => {
      const original: TableData = {
        rows: [
          { cells: [{ content: "Key" }], isHeader: true },
          { cells: [{ content: "value|with|pipes" }] },
          { cells: [{ content: "back\\slash" }] },
          { cells: [{ content: "line1\nline2" }] },
        ],
        columnCount: 1,
      };

      const markdown = TableFormatter.toMarkdown(original);
      const parsed = MarkdownTableParser.parse(markdown);

      expect(parsed.rows[1]!.cells[0]!.content).toBe("value|with|pipes");
      expect(parsed.rows[2]!.cells[0]!.content).toBe("back\\slash");
      expect(parsed.rows[3]!.cells[0]!.content).toBe("line1\nline2");
    });

    it("should round-trip a table with caption", () => {
      const original: TableData = {
        rows: [
          { cells: [{ content: "A" }, { content: "B" }], isHeader: true },
          { cells: [{ content: "1" }, { content: "2" }] },
        ],
        columnCount: 2,
        caption: "Test Caption",
      };

      const markdown = `**Table: ${original.caption}**\n\n${TableFormatter.toMarkdown(original)}`;
      const parsed = MarkdownTableParser.parse(markdown);

      expect(parsed.caption).toBe("Test Caption");
      expect(parsed.rows).toHaveLength(2);
    });
  });
});
