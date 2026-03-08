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
import { tablesListCommand } from "../../../src/cli/commands/tables-command.js";
import type { CliDependencies } from "../../../src/cli/utils/dependency-init.js";
import type { RepositoryInfo } from "../../../src/repositories/types.js";
import type { DocumentQueryResult, DocumentMetadata } from "../../../src/storage/types.js";

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
    it("should skip repositories where ChromaDB query fails", async () => {
      mockListRepositories.mockResolvedValue([mockRepo, mockRepo2]);
      mockGetDocumentsByMetadata
        .mockRejectedValueOnce(new Error("Collection not found"))
        .mockResolvedValueOnce([createTableChunk({ filePath: "docs/b.pdf", tableIndex: 0 })]);

      await tablesListCommand({ json: true }, mockDeps);

      const output = getFirstLogOutput(consoleLogSpy);
      const parsed = JSON.parse(output);

      // Should still show the table from the second repo
      expect(parsed.totalTables).toBe(1);
    });

    it("should handle all repositories failing gracefully", async () => {
      mockListRepositories.mockResolvedValue([mockRepo]);
      mockGetDocumentsByMetadata.mockRejectedValue(new Error("Connection failed"));

      await tablesListCommand({ json: true }, mockDeps);

      const output = getFirstLogOutput(consoleLogSpy);
      const parsed = JSON.parse(output);

      expect(parsed.totalTables).toBe(0);
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
