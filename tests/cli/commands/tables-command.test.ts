/**
 * Tests for Tables List Command
 *
 * Tests the tablesListCommand function that queries ChromaDB for
 * table chunks and displays them in a formatted table or JSON.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/await-thenable */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import { describe, it, expect, beforeEach, vi, type Mock } from "bun:test";
import {
  tablesListCommand,
  tablesExportCommand,
  parseTableId,
  reconstructTableFromChunks,
} from "../../../src/cli/commands/tables-command.js";
import type { CliDependencies } from "../../../src/cli/utils/dependency-init.js";
import type { RepositoryInfo } from "../../../src/repositories/types.js";
import type { DocumentQueryResult, DocumentMetadata } from "../../../src/storage/types.js";
import { StorageError } from "../../../src/storage/errors.js";

/**
 * Create a mock table chunk result from ChromaDB
 */
function createTableChunk(
  overrides: {
    filePath?: string;
    tableIndex?: number;
    tableCaption?: string;
    tableColumnCount?: number;
    tableRowCount?: number;
    tableSourceType?: string;
    tableConfidence?: number;
    chunkIndex?: number;
  } = {}
): DocumentQueryResult {
  const filePath = overrides.filePath ?? "docs/report.pdf";
  const tableIndex = overrides.tableIndex ?? 0;
  const chunkIndex = overrides.chunkIndex ?? 0;

  return {
    id: `test-repo:${filePath}:table${tableIndex}:${chunkIndex}`,
    content: "Table content here",
    metadata: {
      file_path: filePath,
      repository: "test-repo",
      chunk_index: chunkIndex,
      total_chunks: 1,
      chunk_start_line: 1,
      chunk_end_line: 10,
      file_extension: ".pdf",
      language: "unknown",
      file_size_bytes: 1024,
      content_hash: "abc123",
      indexed_at: "2024-12-15T10:00:00Z",
      file_modified_at: "2024-12-14T10:00:00Z",
      // Table-specific metadata stored as generic metadata fields
      isTable: true,
      tableIndex: tableIndex,
      tableCaption: overrides.tableCaption ?? "Test Caption",
      tableColumnCount: overrides.tableColumnCount ?? 3,
      tableRowCount: overrides.tableRowCount ?? 5,
      tableSourceType: overrides.tableSourceType ?? "pdf",
      tableConfidence: overrides.tableConfidence ?? 0.95,
    } as DocumentMetadata & Record<string, unknown>,
  };
}

const mockRepo: RepositoryInfo = {
  name: "test-repo",
  url: "https://github.com/test/test-repo.git",
  collectionName: "repo_test_repo",
  localPath: "/tmp/test-repo",
  fileCount: 100,
  chunkCount: 500,
  lastIndexedAt: "2024-12-15T10:00:00Z",
  lastIndexedCommitSha: "abc123",
  indexDurationMs: 5000,
  status: "ready" as const,
  branch: "main",
  includeExtensions: [],
  excludePatterns: [],
};

const mockRepo2: RepositoryInfo = {
  name: "docs-repo",
  url: "https://github.com/test/docs-repo.git",
  collectionName: "repo_docs_repo",
  localPath: "/tmp/docs-repo",
  fileCount: 50,
  chunkCount: 200,
  lastIndexedAt: "2024-12-15T10:00:00Z",
  lastIndexedCommitSha: "def456",
  indexDurationMs: 3000,
  status: "ready" as const,
  branch: "main",
  includeExtensions: [],
  excludePatterns: [],
};

/**
 * Helper to get the first console.log output safely
 */
function getFirstLogOutput(spy: Mock<(...args: any[]) => void>): string {
  const calls = spy.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[0]![0] as string;
}

describe("Tables List Command", () => {
  let mockDeps: CliDependencies;
  let mockListRepositories: Mock<() => Promise<RepositoryInfo[]>>;
  let mockGetDocumentsByMetadata: Mock<() => Promise<DocumentQueryResult[]>>;
  let consoleLogSpy: Mock<(...args: any[]) => void>;

  beforeEach(() => {
    mockListRepositories = vi.fn();
    mockGetDocumentsByMetadata = vi.fn();

    if (consoleLogSpy) {
      consoleLogSpy.mockClear();
    } else {
      consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    }

    mockDeps = {
      repositoryService: {
        listRepositories: mockListRepositories,
      },
      chromaClient: {
        getDocumentsByMetadata: mockGetDocumentsByMetadata,
      },
    } as unknown as CliDependencies;
  });

  describe("Basic table listing", () => {
    it("should list tables across all repositories", async () => {
      mockListRepositories.mockResolvedValue([mockRepo]);
      mockGetDocumentsByMetadata.mockResolvedValue([
        createTableChunk({ filePath: "docs/a.pdf", tableIndex: 0 }),
        createTableChunk({ filePath: "docs/a.pdf", tableIndex: 1 }),
      ]);

      await tablesListCommand({}, mockDeps);

      expect(mockListRepositories).toHaveBeenCalled();
      expect(mockGetDocumentsByMetadata).toHaveBeenCalledWith("repo_test_repo", { isTable: true });
      expect(consoleLogSpy).toHaveBeenCalled();
      const output = getFirstLogOutput(consoleLogSpy);
      expect(output).toContain("2 total");
    });

    it("should handle no tables found", async () => {
      mockListRepositories.mockResolvedValue([mockRepo]);
      mockGetDocumentsByMetadata.mockResolvedValue([]);

      await tablesListCommand({}, mockDeps);

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = getFirstLogOutput(consoleLogSpy);
      expect(output).toContain("No tables found");
    });

    it("should handle no repositories indexed", async () => {
      mockListRepositories.mockResolvedValue([]);

      await tablesListCommand({}, mockDeps);

      expect(mockGetDocumentsByMetadata).not.toHaveBeenCalled();
      const output = getFirstLogOutput(consoleLogSpy);
      expect(output).toContain("No tables found");
    });

    it("should consolidate multi-chunk tables", async () => {
      mockListRepositories.mockResolvedValue([mockRepo]);
      // Same table split into 3 chunks
      mockGetDocumentsByMetadata.mockResolvedValue([
        createTableChunk({ filePath: "docs/big.pdf", tableIndex: 0, chunkIndex: 0 }),
        createTableChunk({ filePath: "docs/big.pdf", tableIndex: 0, chunkIndex: 1 }),
        createTableChunk({ filePath: "docs/big.pdf", tableIndex: 0, chunkIndex: 2 }),
      ]);

      await tablesListCommand({ json: true }, mockDeps);

      const output = getFirstLogOutput(consoleLogSpy);
      const parsed = JSON.parse(output);

      expect(parsed.totalTables).toBe(1);
      expect(parsed.tables[0].chunkCount).toBe(3);
    });

    it("should not skip tableIndex 0 (falsy guard regression)", async () => {
      mockListRepositories.mockResolvedValue([mockRepo]);
      mockGetDocumentsByMetadata.mockResolvedValue([
        createTableChunk({ filePath: "docs/a.pdf", tableIndex: 0 }),
      ]);

      await tablesListCommand({ json: true }, mockDeps);

      const output = getFirstLogOutput(consoleLogSpy);
      const parsed = JSON.parse(output);

      expect(parsed.totalTables).toBe(1);
      expect(parsed.tables[0].tableIndex).toBe(0);
    });

    it("should list tables from multiple repositories", async () => {
      mockListRepositories.mockResolvedValue([mockRepo, mockRepo2]);
      mockGetDocumentsByMetadata
        .mockResolvedValueOnce([createTableChunk({ filePath: "docs/a.pdf", tableIndex: 0 })])
        .mockResolvedValueOnce([
          createTableChunk({ filePath: "docs/b.docx", tableIndex: 0, tableSourceType: "docx" }),
        ]);

      await tablesListCommand({ json: true }, mockDeps);

      const output = getFirstLogOutput(consoleLogSpy);
      const parsed = JSON.parse(output);

      expect(parsed.totalTables).toBe(2);
      expect(mockGetDocumentsByMetadata).toHaveBeenCalledTimes(2);
    });
  });

  describe("Filtering", () => {
    it("should filter by --repo", async () => {
      mockListRepositories.mockResolvedValue([mockRepo, mockRepo2]);
      mockGetDocumentsByMetadata.mockResolvedValue([
        createTableChunk({ filePath: "docs/a.pdf", tableIndex: 0 }),
      ]);

      await tablesListCommand({ repo: "test-repo" }, mockDeps);

      // Should only query the filtered repository
      expect(mockGetDocumentsByMetadata).toHaveBeenCalledTimes(1);
      expect(mockGetDocumentsByMetadata).toHaveBeenCalledWith("repo_test_repo", { isTable: true });
    });

    it("should handle --repo not found", async () => {
      mockListRepositories.mockResolvedValue([mockRepo]);

      await tablesListCommand({ repo: "nonexistent" }, mockDeps);

      expect(mockGetDocumentsByMetadata).not.toHaveBeenCalled();
      const output = getFirstLogOutput(consoleLogSpy);
      expect(output).toContain("not found");
    });

    it("should filter by --document", async () => {
      mockListRepositories.mockResolvedValue([mockRepo]);
      mockGetDocumentsByMetadata.mockResolvedValue([
        createTableChunk({ filePath: "docs/specific.pdf", tableIndex: 0 }),
      ]);

      await tablesListCommand({ document: "docs/specific.pdf" }, mockDeps);

      expect(mockGetDocumentsByMetadata).toHaveBeenCalledWith("repo_test_repo", {
        $and: [{ isTable: true }, { file_path: "docs/specific.pdf" }],
      });
    });

    it("should filter by --folder with post-filtering", async () => {
      mockListRepositories.mockResolvedValue([mockRepo]);
      mockGetDocumentsByMetadata.mockResolvedValue([
        createTableChunk({ filePath: "docs/reports/a.pdf", tableIndex: 0 }),
        createTableChunk({ filePath: "docs/reports/b.pdf", tableIndex: 0 }),
        createTableChunk({ filePath: "other/c.pdf", tableIndex: 0 }),
      ]);

      await tablesListCommand({ folder: "docs/reports/", json: true }, mockDeps);

      const output = getFirstLogOutput(consoleLogSpy);
      const parsed = JSON.parse(output);

      // Should only include the 2 tables from docs/reports/
      expect(parsed.totalTables).toBe(2);
      expect(parsed.tables[0].filePath).toBe("docs/reports/a.pdf");
      expect(parsed.tables[1].filePath).toBe("docs/reports/b.pdf");
    });

    it("should combine --repo and --document filters", async () => {
      mockListRepositories.mockResolvedValue([mockRepo, mockRepo2]);
      mockGetDocumentsByMetadata.mockResolvedValue([
        createTableChunk({ filePath: "docs/target.pdf", tableIndex: 0 }),
      ]);

      await tablesListCommand({ repo: "test-repo", document: "docs/target.pdf" }, mockDeps);

      expect(mockGetDocumentsByMetadata).toHaveBeenCalledTimes(1);
      expect(mockGetDocumentsByMetadata).toHaveBeenCalledWith("repo_test_repo", {
        $and: [{ isTable: true }, { file_path: "docs/target.pdf" }],
      });
    });
  });

  describe("JSON output", () => {
    it("should output valid JSON with --json flag", async () => {
      mockListRepositories.mockResolvedValue([mockRepo]);
      mockGetDocumentsByMetadata.mockResolvedValue([
        createTableChunk({
          filePath: "docs/report.pdf",
          tableIndex: 0,
          tableCaption: "Revenue",
          tableColumnCount: 4,
          tableRowCount: 10,
          tableConfidence: 0.92,
        }),
      ]);

      await tablesListCommand({ json: true }, mockDeps);

      const output = getFirstLogOutput(consoleLogSpy);
      const parsed = JSON.parse(output);

      expect(parsed.totalTables).toBe(1);
      expect(parsed.tables[0]).toEqual({
        repository: "test-repo",
        filePath: "docs/report.pdf",
        tableIndex: 0,
        caption: "Revenue",
        columnCount: 4,
        rowCount: 10,
        sourceType: "pdf",
        confidence: 0.92,
        chunkCount: 1,
      });
    });

    it("should include repo filter in JSON when --repo specified", async () => {
      mockListRepositories.mockResolvedValue([mockRepo]);
      mockGetDocumentsByMetadata.mockResolvedValue([]);

      await tablesListCommand({ repo: "test-repo", json: true }, mockDeps);

      const output = getFirstLogOutput(consoleLogSpy);
      const parsed = JSON.parse(output);

      expect(parsed.repository).toBe("test-repo");
    });

    it("should output empty JSON when no tables found", async () => {
      mockListRepositories.mockResolvedValue([mockRepo]);
      mockGetDocumentsByMetadata.mockResolvedValue([]);

      await tablesListCommand({ json: true }, mockDeps);

      const output = getFirstLogOutput(consoleLogSpy);
      const parsed = JSON.parse(output);

      expect(parsed.totalTables).toBe(0);
      expect(parsed.tables).toHaveLength(0);
    });
  });

  describe("Error handling", () => {
    it("should skip repositories where ChromaDB query fails with StorageError", async () => {
      mockListRepositories.mockResolvedValue([mockRepo, mockRepo2]);
      mockGetDocumentsByMetadata
        .mockRejectedValueOnce(new StorageError("Collection not found"))
        .mockResolvedValueOnce([createTableChunk({ filePath: "docs/b.pdf", tableIndex: 0 })]);

      await tablesListCommand({ json: true }, mockDeps);

      const output = getFirstLogOutput(consoleLogSpy);
      const parsed = JSON.parse(output);

      // Should still show the table from the second repo
      expect(parsed.totalTables).toBe(1);
    });

    it("should handle all repositories failing gracefully with StorageError", async () => {
      mockListRepositories.mockResolvedValue([mockRepo]);
      mockGetDocumentsByMetadata.mockRejectedValue(new StorageError("Connection failed"));

      await tablesListCommand({ json: true }, mockDeps);

      const output = getFirstLogOutput(consoleLogSpy);
      const parsed = JSON.parse(output);

      expect(parsed.totalTables).toBe(0);
    });

    it("should re-throw non-StorageError errors", async () => {
      mockListRepositories.mockResolvedValue([mockRepo]);
      mockGetDocumentsByMetadata.mockRejectedValue(new TypeError("Unexpected type"));

      await expect(tablesListCommand({ json: true }, mockDeps)).rejects.toThrow("Unexpected type");
    });
  });

  describe("Sorting", () => {
    it("should sort by repository, filePath, then tableIndex", async () => {
      mockListRepositories.mockResolvedValue([mockRepo, mockRepo2]);
      mockGetDocumentsByMetadata
        .mockResolvedValueOnce([
          createTableChunk({ filePath: "docs/z.pdf", tableIndex: 1 }),
          createTableChunk({ filePath: "docs/a.pdf", tableIndex: 0 }),
          createTableChunk({ filePath: "docs/z.pdf", tableIndex: 0 }),
        ])
        .mockResolvedValueOnce([createTableChunk({ filePath: "docs/b.pdf", tableIndex: 0 })]);

      await tablesListCommand({ json: true }, mockDeps);

      const output = getFirstLogOutput(consoleLogSpy);
      const parsed = JSON.parse(output);

      expect(parsed.totalTables).toBe(4);
      // docs-repo comes before test-repo alphabetically
      expect(parsed.tables[0].repository).toBe("docs-repo");
      expect(parsed.tables[1].repository).toBe("test-repo");
      expect(parsed.tables[1].filePath).toBe("docs/a.pdf");
      expect(parsed.tables[2].filePath).toBe("docs/z.pdf");
      expect(parsed.tables[2].tableIndex).toBe(0);
      expect(parsed.tables[3].filePath).toBe("docs/z.pdf");
      expect(parsed.tables[3].tableIndex).toBe(1);
    });
  });
});

// ============================================================================
// parseTableId Tests
// ============================================================================

describe("parseTableId", () => {
  it("should parse a standard table ID", () => {
    const result = parseTableId("my-repo:docs/report.pdf:0");

    expect(result.repository).toBe("my-repo");
    expect(result.filePath).toBe("docs/report.pdf");
    expect(result.tableIndex).toBe(0);
  });

  it("should parse table ID with nested path", () => {
    const result = parseTableId("test-repo:src/docs/quarterly/report.pdf:3");

    expect(result.repository).toBe("test-repo");
    expect(result.filePath).toBe("src/docs/quarterly/report.pdf");
    expect(result.tableIndex).toBe(3);
  });

  it("should parse table ID with colon in file path", () => {
    const result = parseTableId("repo:C:file.pdf:1");

    expect(result.repository).toBe("repo");
    expect(result.filePath).toBe("C:file.pdf");
    expect(result.tableIndex).toBe(1);
  });

  it("should throw on missing parts", () => {
    expect(() => parseTableId("my-repo:only")).toThrow("Invalid table ID format");
  });

  it("should throw on single value", () => {
    expect(() => parseTableId("just-a-string")).toThrow("Invalid table ID format");
  });

  it("should throw on negative table index", () => {
    expect(() => parseTableId("repo:file.pdf:-1")).toThrow("non-negative integer");
  });

  it("should throw on non-numeric table index", () => {
    expect(() => parseTableId("repo:file.pdf:abc")).toThrow("non-negative integer");
  });

  it("should throw on empty repository", () => {
    expect(() => parseTableId(":file.pdf:0")).toThrow("Repository name cannot be empty");
  });

  it("should throw on empty file path", () => {
    expect(() => parseTableId("repo::0")).toThrow("File path cannot be empty");
  });
});

// ============================================================================
// reconstructTableFromChunks Tests
// ============================================================================

describe("reconstructTableFromChunks", () => {
  it("should reconstruct a single-chunk table", () => {
    const chunk: DocumentQueryResult = {
      id: "test:doc.pdf:table-0:0",
      content: "| Name | Age |\n| --- | --- |\n| Alice | 30 |",
      metadata: {
        file_path: "doc.pdf",
        repository: "test",
        chunk_index: 0,
        total_chunks: 1,
        chunk_start_line: 1,
        chunk_end_line: 3,
        file_extension: ".pdf",
        language: "unknown",
        file_size_bytes: 100,
        content_hash: "abc",
        indexed_at: "2024-01-01",
        file_modified_at: "2024-01-01",
      },
    };

    const result = reconstructTableFromChunks([chunk]);

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]!.isHeader).toBe(true);
    expect(result.rows[1]!.cells[0]!.content).toBe("Alice");
  });

  it("should reconstruct a multi-chunk table with header dedup", () => {
    const makeChunk = (index: number, content: string): DocumentQueryResult => ({
      id: `test:doc.pdf:table-0:${index}`,
      content,
      metadata: {
        file_path: "doc.pdf",
        repository: "test",
        chunk_index: index,
        total_chunks: 2,
        chunk_start_line: 1,
        chunk_end_line: 3,
        file_extension: ".pdf",
        language: "unknown",
        file_size_bytes: 100,
        content_hash: "abc",
        indexed_at: "2024-01-01",
        file_modified_at: "2024-01-01",
      },
    });

    const chunks = [
      makeChunk(0, "| Name | Age |\n| --- | --- |\n| Alice | 30 |\n| Bob | 25 |"),
      makeChunk(1, "| Name | Age |\n| --- | --- |\n| Carol | 35 |"),
    ];

    const result = reconstructTableFromChunks(chunks);

    expect(result.rows).toHaveLength(4); // 1 header + 3 data
    expect(result.rows[0]!.isHeader).toBe(true);
    expect(result.rows[1]!.cells[0]!.content).toBe("Alice");
    expect(result.rows[2]!.cells[0]!.content).toBe("Bob");
    expect(result.rows[3]!.cells[0]!.content).toBe("Carol");
  });
});

// ============================================================================
// Tables Export Command Tests
// ============================================================================

/**
 * Create a table chunk with Markdown table content for export tests
 */
function createExportTableChunk(
  overrides: {
    filePath?: string;
    tableIndex?: number;
    chunkIndex?: number;
    totalChunks?: number;
    content?: string;
  } = {}
): DocumentQueryResult {
  const filePath = overrides.filePath ?? "docs/report.pdf";
  const tableIndex = overrides.tableIndex ?? 0;
  const chunkIndex = overrides.chunkIndex ?? 0;
  const content =
    overrides.content ?? "| Name | Age |\n| --- | --- |\n| Alice | 30 |\n| Bob | 25 |";

  return {
    id: `test-repo:${filePath}:table-${tableIndex}:${chunkIndex}`,
    content,
    metadata: {
      file_path: filePath,
      repository: "test-repo",
      chunk_index: chunkIndex,
      total_chunks: overrides.totalChunks ?? 1,
      chunk_start_line: 1,
      chunk_end_line: 10,
      file_extension: ".pdf",
      language: "unknown",
      file_size_bytes: 1024,
      content_hash: "abc123",
      indexed_at: "2024-12-15T10:00:00Z",
      file_modified_at: "2024-12-14T10:00:00Z",
      isTable: true,
      tableIndex: tableIndex,
      tableCaption: "Test Table",
      tableColumnCount: 2,
      tableRowCount: 2,
      tableSourceType: "pdf",
      tableConfidence: 0.95,
    } as DocumentMetadata & Record<string, unknown>,
  };
}

describe("Tables Export Command", () => {
  let mockDeps: CliDependencies;
  let mockListRepositories: Mock<() => Promise<RepositoryInfo[]>>;
  let mockGetDocumentsByMetadata: Mock<() => Promise<DocumentQueryResult[]>>;
  let consoleLogSpy: Mock<(...args: any[]) => void>;

  beforeEach(() => {
    mockListRepositories = vi.fn();
    mockGetDocumentsByMetadata = vi.fn();

    if (consoleLogSpy) {
      consoleLogSpy.mockClear();
    } else {
      consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      // Clear any accumulated calls from previous describe blocks sharing this spy
      consoleLogSpy.mockClear();
    }

    mockDeps = {
      repositoryService: {
        listRepositories: mockListRepositories,
      },
      chromaClient: {
        getDocumentsByMetadata: mockGetDocumentsByMetadata,
      },
    } as unknown as CliDependencies;
  });

  describe("CSV export to stdout", () => {
    it("should export table as CSV to stdout by default", async () => {
      mockListRepositories.mockResolvedValue([mockRepo]);
      mockGetDocumentsByMetadata.mockResolvedValue([createExportTableChunk()]);

      await tablesExportCommand("test-repo:docs/report.pdf:0", { format: "csv" }, mockDeps);

      expect(mockGetDocumentsByMetadata).toHaveBeenCalledWith("repo_test_repo", {
        $and: [{ isTable: true }, { file_path: "docs/report.pdf" }, { tableIndex: 0 }],
      });

      const output = getFirstLogOutput(consoleLogSpy);
      // CSV format: header row, then data rows with CRLF
      expect(output).toContain("Name,Age");
      expect(output).toContain("Alice,30");
      expect(output).toContain("Bob,25");
    });
  });

  describe("JSON export to stdout", () => {
    it("should export table as JSON when format is json", async () => {
      mockListRepositories.mockResolvedValue([mockRepo]);
      mockGetDocumentsByMetadata.mockResolvedValue([createExportTableChunk()]);

      await tablesExportCommand("test-repo:docs/report.pdf:0", { format: "json" }, mockDeps);

      const output = getFirstLogOutput(consoleLogSpy);
      const parsed = JSON.parse(output);

      expect(parsed.rows).toBeDefined();
      expect(parsed.columnCount).toBe(2);
      expect(parsed.rows).toHaveLength(3); // 1 header + 2 data
    });
  });

  describe("File output", () => {
    it("should show success message when writing to file", async () => {
      // Mock writeFile by providing a non-existent temp path
      // We test the success output format, not actual file I/O
      mockListRepositories.mockResolvedValue([mockRepo]);
      mockGetDocumentsByMetadata.mockResolvedValue([createExportTableChunk()]);

      // Use a temp file that we can clean up
      const tempPath = `/tmp/test-export-${Date.now()}.csv`;

      await tablesExportCommand(
        "test-repo:docs/report.pdf:0",
        { format: "csv", output: tempPath },
        mockDeps
      );

      const output = getFirstLogOutput(consoleLogSpy);
      expect(output).toContain("exported successfully");
      expect(output).toContain(tempPath);
      expect(output).toContain("CSV");

      // Clean up
      try {
        const { unlink } = await import("node:fs/promises");
        await unlink(tempPath);
      } catch {
        // Ignore cleanup failures
      }
    });
  });

  describe("File output", () => {
    it("should handle writeFile failure gracefully", async () => {
      mockListRepositories.mockResolvedValue([mockRepo]);
      mockGetDocumentsByMetadata.mockResolvedValue([createExportTableChunk()]);

      // Use a path that will fail (non-existent directory)
      const badPath = "/nonexistent-dir-abc123/output.csv";

      await tablesExportCommand(
        "test-repo:docs/report.pdf:0",
        { format: "csv", output: badPath },
        mockDeps
      );

      const output = getFirstLogOutput(consoleLogSpy);
      expect(output).toContain("Failed to write output file");
      expect(output).toContain(badPath);
    });
  });

  describe("Error handling", () => {
    it("should handle invalid table ID format", async () => {
      await expect(tablesExportCommand("invalid-id", { format: "csv" }, mockDeps)).rejects.toThrow(
        "Invalid table ID format"
      );
    });

    it("should handle repository not found", async () => {
      mockListRepositories.mockResolvedValue([mockRepo]);

      await tablesExportCommand("nonexistent:docs/file.pdf:0", { format: "csv" }, mockDeps);

      const output = getFirstLogOutput(consoleLogSpy);
      expect(output).toContain("not found");
    });

    it("should handle table not found (empty results)", async () => {
      mockListRepositories.mockResolvedValue([mockRepo]);
      mockGetDocumentsByMetadata.mockResolvedValue([]);

      await tablesExportCommand("test-repo:docs/missing.pdf:99", { format: "csv" }, mockDeps);

      const output = getFirstLogOutput(consoleLogSpy);
      expect(output).toContain("Table not found");
    });

    it("should handle StorageError gracefully", async () => {
      mockListRepositories.mockResolvedValue([mockRepo]);
      mockGetDocumentsByMetadata.mockRejectedValue(new StorageError("Collection not found"));

      await tablesExportCommand("test-repo:docs/report.pdf:0", { format: "csv" }, mockDeps);

      const output = getFirstLogOutput(consoleLogSpy);
      expect(output).toContain("Table not found");
    });

    it("should re-throw non-StorageError errors", async () => {
      mockListRepositories.mockResolvedValue([mockRepo]);
      mockGetDocumentsByMetadata.mockRejectedValue(new TypeError("Unexpected"));

      await expect(
        tablesExportCommand("test-repo:docs/report.pdf:0", { format: "csv" }, mockDeps)
      ).rejects.toThrow("Unexpected");
    });
  });

  describe("Multi-chunk table reconstruction", () => {
    it("should reconstruct and export a multi-chunk table", async () => {
      mockListRepositories.mockResolvedValue([mockRepo]);
      mockGetDocumentsByMetadata.mockResolvedValue([
        createExportTableChunk({
          chunkIndex: 0,
          totalChunks: 2,
          content: "| Name | Age |\n| --- | --- |\n| Alice | 30 |",
        }),
        createExportTableChunk({
          chunkIndex: 1,
          totalChunks: 2,
          content: "| Name | Age |\n| --- | --- |\n| Bob | 25 |",
        }),
      ]);

      await tablesExportCommand("test-repo:docs/report.pdf:0", { format: "csv" }, mockDeps);

      const output = getFirstLogOutput(consoleLogSpy);
      expect(output).toContain("Name,Age");
      expect(output).toContain("Alice,30");
      expect(output).toContain("Bob,25");
    });

    it("should sort chunks by chunk_index before reconstruction", async () => {
      mockListRepositories.mockResolvedValue([mockRepo]);
      // Return chunks out of order
      mockGetDocumentsByMetadata.mockResolvedValue([
        createExportTableChunk({
          chunkIndex: 1,
          totalChunks: 2,
          content: "| Name | Age |\n| --- | --- |\n| Bob | 25 |",
        }),
        createExportTableChunk({
          chunkIndex: 0,
          totalChunks: 2,
          content: "| Name | Age |\n| --- | --- |\n| Alice | 30 |",
        }),
      ]);

      await tablesExportCommand("test-repo:docs/report.pdf:0", { format: "csv" }, mockDeps);

      const output = getFirstLogOutput(consoleLogSpy);
      // Alice should come first (chunk 0), then Bob (chunk 1)
      const lines = output.split("\r\n");
      expect(lines[0]).toBe("Name,Age");
      expect(lines[1]).toBe("Alice,30");
      expect(lines[2]).toBe("Bob,25");
    });
  });

  describe("Empty table handling", () => {
    it("should handle table with no data rows", async () => {
      mockListRepositories.mockResolvedValue([mockRepo]);
      mockGetDocumentsByMetadata.mockResolvedValue([
        createExportTableChunk({
          content: "| Header |\n| --- |",
        }),
      ]);

      await tablesExportCommand("test-repo:docs/report.pdf:0", { format: "csv" }, mockDeps);

      // A header-only table still has rows, so it should export
      const output = getFirstLogOutput(consoleLogSpy);
      expect(output).toContain("Header");
    });
  });
});
