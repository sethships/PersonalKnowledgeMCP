/**
 * Tests for Search Command
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/await-thenable */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { describe, it, expect, beforeEach, vi, type Mock } from "bun:test";
import {
  searchCommand,
  type SearchCommandOptions,
} from "../../../src/cli/commands/search-command.js";
import type { CliDependencies } from "../../../src/cli/utils/dependency-init.js";
import type { SearchResponse } from "../../../src/services/types.js";

describe("Search Command", () => {
  let mockDeps: CliDependencies;
  let mockSearch: Mock<() => Promise<SearchResponse>>;
  let consoleLogSpy: Mock<(...args: any[]) => void>;

  beforeEach(() => {
    mockSearch = vi.fn();

    // Create or reset console.log spy
    if (consoleLogSpy) {
      consoleLogSpy.mockClear();
    } else {
      consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    }

    mockDeps = {
      searchService: {
        search: mockSearch,
      },
    } as unknown as CliDependencies;
  });

  describe("Basic search", () => {
    it("should perform search with default options", async () => {
      const mockResponse: SearchResponse = {
        results: [
          {
            file_path: "src/index.ts",
            repository: "test-repo",
            content_snippet: "test content",
            similarity_score: 0.9,
            chunk_index: 0,
            metadata: {
              file_extension: ".ts",
              file_size_bytes: 1000,
              indexed_at: "2024-01-01T00:00:00Z",
            },
          },
        ],
        metadata: {
          total_matches: 1,
          query_time_ms: 100,
          embedding_time_ms: 50,
          search_time_ms: 30,
          repositories_searched: ["test-repo"],
        },
      };

      mockSearch.mockResolvedValue(mockResponse);

      const options: SearchCommandOptions = { limit: 10, threshold: 0.7 };
      await searchCommand("test query", options, mockDeps);

      expect(mockSearch).toHaveBeenCalledWith({
        query: "test query",
        limit: 10,
        threshold: 0.7,
        repository: undefined,
      });
    });

    it("should use custom limit and threshold", async () => {
      const mockResponse: SearchResponse = {
        results: [],
        metadata: {
          total_matches: 0,
          query_time_ms: 100,
          embedding_time_ms: 50,
          search_time_ms: 30,
          repositories_searched: [],
        },
      };

      mockSearch.mockResolvedValue(mockResponse);

      const options: SearchCommandOptions = { limit: 5, threshold: 0.8 };
      await searchCommand("test query", options, mockDeps);

      expect(mockSearch).toHaveBeenCalledWith({
        query: "test query",
        limit: 5,
        threshold: 0.8,
        repository: undefined,
      });
    });

    it("should filter by repository when specified", async () => {
      const mockResponse: SearchResponse = {
        results: [],
        metadata: {
          total_matches: 0,
          query_time_ms: 100,
          embedding_time_ms: 50,
          search_time_ms: 30,
          repositories_searched: [],
        },
      };

      mockSearch.mockResolvedValue(mockResponse);

      const options: SearchCommandOptions = { limit: 10, threshold: 0.7, repo: "my-repo" };
      await searchCommand("test query", options, mockDeps);

      expect(mockSearch).toHaveBeenCalledWith({
        query: "test query",
        limit: 10,
        threshold: 0.7,
        repository: "my-repo",
      });
    });
  });

  describe("Output formatting", () => {
    it("should output table by default", async () => {
      const mockResponse: SearchResponse = {
        results: [
          {
            file_path: "src/index.ts",
            repository: "test-repo",
            content_snippet: "test content",
            similarity_score: 0.9,
            chunk_index: 0,
            metadata: {
              file_extension: ".ts",
              file_size_bytes: 1000,
              indexed_at: "2024-01-01T00:00:00Z",
            },
          },
        ],
        metadata: {
          total_matches: 1,
          query_time_ms: 100,
          embedding_time_ms: 50,
          search_time_ms: 30,
          repositories_searched: ["test-repo"],
        },
      };

      mockSearch.mockResolvedValue(mockResponse);

      const options: SearchCommandOptions = { limit: 10, threshold: 0.7 };
      await searchCommand("test query", options, mockDeps);

      expect(consoleLogSpy).toHaveBeenCalled();
      // Table output should be called
      const output = consoleLogSpy.mock.calls?.[0]?.[0] as string | undefined;
      expect(output).toBeDefined();
      expect(output).toContain("test-repo");
    });

    it("should output JSON when json flag is set", async () => {
      const mockResponse: SearchResponse = {
        results: [
          {
            file_path: "src/index.ts",
            repository: "test-repo",
            content_snippet: "test content",
            similarity_score: 0.9,
            chunk_index: 0,
            metadata: {
              file_extension: ".ts",
              file_size_bytes: 1000,
              indexed_at: "2024-01-01T00:00:00Z",
            },
          },
        ],
        metadata: {
          total_matches: 1,
          query_time_ms: 100,
          embedding_time_ms: 50,
          search_time_ms: 30,
          repositories_searched: ["test-repo"],
        },
      };

      mockSearch.mockResolvedValue(mockResponse);

      const options: SearchCommandOptions = { limit: 10, threshold: 0.7, json: true };
      await searchCommand("test query", options, mockDeps);

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls?.[0]?.[0] as string | undefined;
      expect(output).toBeDefined();

      // Should be valid JSON
      const parsed = JSON.parse(output!);
      expect(parsed).toHaveProperty("results");
      expect(parsed.results).toHaveLength(1);
    });

    it("should handle empty results", async () => {
      const mockResponse: SearchResponse = {
        results: [],
        metadata: {
          total_matches: 0,
          query_time_ms: 100,
          embedding_time_ms: 50,
          search_time_ms: 30,
          repositories_searched: [],
        },
      };

      mockSearch.mockResolvedValue(mockResponse);

      const options: SearchCommandOptions = { limit: 10, threshold: 0.7 };
      await searchCommand("test query", options, mockDeps);

      expect(consoleLogSpy).toHaveBeenCalled();
    });
  });

  describe("Error handling", () => {
    it("should propagate search service errors", async () => {
      mockSearch.mockRejectedValue(new Error("Search failed"));

      const options: SearchCommandOptions = { limit: 10, threshold: 0.7 };
      await expect(searchCommand("test query", options, mockDeps)).rejects.toThrow("Search failed");
    });
  });
});
