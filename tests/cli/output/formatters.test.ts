/**
 * Tests for CLI output formatters
 */

import { describe, it, expect } from "bun:test";
import type { RepositoryInfo } from "../../../src/repositories/types.js";
import type { SearchResult } from "../../../src/services/types.js";
import {
  createRepositoryTable,
  createSearchResultsTable,
  formatRepositoriesJson,
  formatSearchResultsJson,
} from "../../../src/cli/output/formatters.js";

describe("Formatters", () => {
  describe("createRepositoryTable", () => {
    it("should create a table for repositories", () => {
      const repos: RepositoryInfo[] = [
        {
          name: "test-repo",
          url: "https://github.com/user/test-repo.git",
          localPath: "/data/repos/test-repo",
          collectionName: "test-repo",
          fileCount: 10,
          chunkCount: 50,
          lastIndexedAt: "2024-12-12T00:00:00Z",
          indexDurationMs: 5000,
          status: "ready",
          branch: "main",
          includeExtensions: [".ts", ".js"],
          excludePatterns: ["node_modules/**"],
        },
      ];

      const table = createRepositoryTable(repos);

      expect(table).toContain("test-repo");
      expect(table).toContain("10"); // fileCount
      expect(table).toContain("50"); // chunkCount
      expect(table).toContain("ready");
    });

    it("should show helpful message for empty repository list", () => {
      const table = createRepositoryTable([]);

      expect(table).toContain("No repositories indexed yet");
      expect(table).toContain("Get started");
    });
  });

  describe("createSearchResultsTable", () => {
    it("should create a table for search results", () => {
      const results: SearchResult[] = [
        {
          file_path: "src/test.ts",
          repository: "test-repo",
          content_snippet: "This is a test snippet",
          similarity_score: 0.95,
          chunk_index: 0,
          metadata: {
            file_extension: ".ts",
            file_size_bytes: 1024,
            indexed_at: "2024-12-12T00:00:00Z",
          },
        },
      ];

      const table = createSearchResultsTable(results, 100);

      expect(table).toContain("test-repo");
      expect(table).toContain("src/test.ts");
      expect(table).toContain("test snippet");
      expect(table).toContain("95%"); // Score as percentage
    });

    it("should show helpful message for no results", () => {
      const table = createSearchResultsTable([], 100);

      expect(table).toContain("No results found");
      expect(table).toContain("Tips");
    });
  });

  describe("formatRepositoriesJson", () => {
    it("should format repositories as JSON", () => {
      const repos: RepositoryInfo[] = [
        {
          name: "test-repo",
          url: "https://github.com/user/test-repo.git",
          localPath: "/data/repos/test-repo",
          collectionName: "test-repo",
          fileCount: 10,
          chunkCount: 50,
          lastIndexedAt: "2024-12-12T00:00:00Z",
          indexDurationMs: 5000,
          status: "ready",
          branch: "main",
          includeExtensions: [".ts"],
          excludePatterns: [],
        },
      ];

      const json = formatRepositoriesJson(repos);
      const parsed = JSON.parse(json) as {
        totalRepositories: number;
        repositories: Array<{ name: string; fileCount: number }>;
      };

      expect(parsed.totalRepositories).toBe(1);
      expect(parsed.repositories).toHaveLength(1);
      expect(parsed.repositories[0]?.name).toBe("test-repo");
      expect(parsed.repositories[0]?.fileCount).toBe(10);
    });
  });

  describe("formatSearchResultsJson", () => {
    it("should format search results as JSON", () => {
      const results: SearchResult[] = [
        {
          file_path: "src/test.ts",
          repository: "test-repo",
          content_snippet: "snippet",
          similarity_score: 0.95,
          chunk_index: 0,
          metadata: {
            file_extension: ".ts",
            file_size_bytes: 1024,
            indexed_at: "2024-12-12T00:00:00Z",
          },
        },
      ];

      const json = formatSearchResultsJson("test query", results, 100, 20, 80, ["test-repo"]);
      const parsed = JSON.parse(json) as {
        query: string;
        totalMatches: number;
        queryTimeMs: number;
        embeddingTimeMs: number;
        searchTimeMs: number;
        repositoriesSearched: string[];
        results: Array<{ rank: number }>;
      };

      expect(parsed.query).toBe("test query");
      expect(parsed.totalMatches).toBe(1);
      expect(parsed.queryTimeMs).toBe(100);
      expect(parsed.embeddingTimeMs).toBe(20);
      expect(parsed.searchTimeMs).toBe(80);
      expect(parsed.repositoriesSearched).toEqual(["test-repo"]);
      expect(parsed.results).toHaveLength(1);
      expect(parsed.results[0]?.rank).toBe(1);
    });
  });
});
