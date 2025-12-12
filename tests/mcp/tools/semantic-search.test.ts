/**
 * Unit tests for semantic_search MCP tool
 *
 * Tests tool definition, handler execution, response formatting, and error handling
 * with mocked SearchService dependencies.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import type { SearchService, SearchResponse, SearchQuery } from "../../../src/services/types.js";
import {
  semanticSearchToolDefinition,
  createSemanticSearchHandler,
} from "../../../src/mcp/tools/semantic-search.js";
import { SearchOperationError } from "../../../src/services/errors.js";
import { initializeLogger, resetLogger } from "../../../src/logging/index.js";
import type { TextContent } from "@modelcontextprotocol/sdk/types.js";

// Helper interface for JSON Schema property testing
interface JsonSchemaProperty {
  type?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  default?: unknown;
  description?: string;
}

// Helper interface for semantic_search tool response
interface SemanticSearchResult {
  content: string;
  similarity_score: number;
  metadata: {
    file_path: string;
    repository: string;
    chunk_index: number;
    file_extension: string;
    file_size_bytes: number;
    indexed_at: string;
  };
}

interface SemanticSearchResponse {
  results: SemanticSearchResult[];
  metadata: {
    total_matches: number;
    query_time_ms: number;
    embedding_time_ms: number;
    search_time_ms: number;
    repositories_searched: string[];
  };
}

// Mock SearchService
class MockSearchService implements SearchService {
  private mockResponse: SearchResponse | null = null;
  private shouldFail = false;
  private failureError: Error | null = null;
  public lastQuery: SearchQuery | null = null;

  async search(query: SearchQuery): Promise<SearchResponse> {
    this.lastQuery = query;

    if (this.shouldFail && this.failureError) {
      throw this.failureError;
    }

    return (
      this.mockResponse || {
        results: [],
        metadata: {
          total_matches: 0,
          query_time_ms: 100,
          embedding_time_ms: 50,
          search_time_ms: 50,
          repositories_searched: [],
        },
      }
    );
  }

  setMockResponse(response: SearchResponse): void {
    this.mockResponse = response;
  }

  setShouldFail(shouldFail: boolean, error?: Error): void {
    this.shouldFail = shouldFail;
    this.failureError = error || null;
  }
}

describe("semantic_search Tool", () => {
  beforeEach(() => {
    initializeLogger({ level: "silent", format: "json" });
  });

  afterEach(() => {
    resetLogger();
  });

  describe("tool definition", () => {
    it("should have correct name", () => {
      expect(semanticSearchToolDefinition.name).toBe("semantic_search");
    });

    it("should have helpful description", () => {
      expect(semanticSearchToolDefinition.description).toBeDefined();
      expect(semanticSearchToolDefinition.description!.length).toBeGreaterThan(50);
    });

    it("should define input schema", () => {
      expect(semanticSearchToolDefinition.inputSchema).toBeDefined();
      expect(semanticSearchToolDefinition.inputSchema.type).toBe("object");
    });

    it("should require query parameter", () => {
      expect(semanticSearchToolDefinition.inputSchema.required).toContain("query");
    });

    it("should define query property with constraints", () => {
      const queryProp = semanticSearchToolDefinition.inputSchema.properties![
        "query"
      ] as JsonSchemaProperty;
      expect(queryProp.type).toBe("string");
      expect(queryProp.minLength).toBe(1);
      expect(queryProp.maxLength).toBe(1000);
    });

    it("should define limit property with range", () => {
      const limitProp = semanticSearchToolDefinition.inputSchema.properties![
        "limit"
      ] as JsonSchemaProperty;
      expect(limitProp.type).toBe("number");
      expect(limitProp.minimum).toBe(1);
      expect(limitProp.maximum).toBe(50);
      expect(limitProp.default).toBe(10);
    });

    it("should define threshold property with range", () => {
      const thresholdProp = semanticSearchToolDefinition.inputSchema.properties![
        "threshold"
      ] as JsonSchemaProperty;
      expect(thresholdProp.type).toBe("number");
      expect(thresholdProp.minimum).toBe(0.0);
      expect(thresholdProp.maximum).toBe(1.0);
      expect(thresholdProp.default).toBe(0.7);
    });

    it("should define optional repository property", () => {
      const repoProp = semanticSearchToolDefinition.inputSchema.properties![
        "repository"
      ] as JsonSchemaProperty;
      expect(repoProp.type).toBe("string");
      expect(semanticSearchToolDefinition.inputSchema.required).not.toContain("repository");
    });
  });

  describe("createSemanticSearchHandler", () => {
    let mockService: MockSearchService;

    beforeEach(() => {
      mockService = new MockSearchService();
    });

    describe("successful search", () => {
      it("should return results for valid query", async () => {
        const mockResponse: SearchResponse = {
          results: [
            {
              file_path: "src/auth.ts",
              repository: "backend-api",
              content_snippet: "export function authenticate(token: string) { ... }",
              similarity_score: 0.92,
              chunk_index: 0,
              metadata: {
                file_extension: ".ts",
                file_size_bytes: 1024,
                indexed_at: "2025-01-01T00:00:00Z",
              },
            },
          ],
          metadata: {
            total_matches: 1,
            query_time_ms: 234,
            embedding_time_ms: 123,
            search_time_ms: 111,
            repositories_searched: ["backend-api"],
          },
        };

        mockService.setMockResponse(mockResponse);
        const handler = createSemanticSearchHandler(mockService);

        const result = await handler({
          query: "authentication function",
          limit: 10,
          threshold: 0.7,
        });

        expect(result.isError).toBe(false);
        expect(result.content).toHaveLength(1);
        expect(result.content[0]!.type).toBe("text");

        const responseData = JSON.parse(
          (result.content[0] as TextContent).text
        ) as SemanticSearchResponse;
        expect(responseData.results).toHaveLength(1);
        expect(responseData.results[0].content).toContain("authenticate");
        expect(responseData.metadata.total_matches).toBe(1);
      });

      it("should pass query to SearchService", async () => {
        const handler = createSemanticSearchHandler(mockService);

        await handler({
          query: "find auth code",
          limit: 5,
        });

        expect(mockService.lastQuery).not.toBeNull();
        expect(mockService.lastQuery?.query).toBe("find auth code");
        expect(mockService.lastQuery?.limit).toBe(5);
      });

      it("should apply default values for optional parameters", async () => {
        const handler = createSemanticSearchHandler(mockService);

        await handler({
          query: "test query",
        });

        expect(mockService.lastQuery?.limit).toBe(10);
        expect(mockService.lastQuery?.threshold).toBe(0.7);
      });

      it("should pass repository filter to SearchService", async () => {
        const handler = createSemanticSearchHandler(mockService);

        await handler({
          query: "search",
          repository: "my-repo",
        });

        expect(mockService.lastQuery?.repository).toBe("my-repo");
      });

      it("should handle empty results gracefully", async () => {
        mockService.setMockResponse({
          results: [],
          metadata: {
            total_matches: 0,
            query_time_ms: 100,
            embedding_time_ms: 50,
            search_time_ms: 50,
            repositories_searched: ["test-repo"],
          },
        });

        const handler = createSemanticSearchHandler(mockService);
        const result = await handler({ query: "nonexistent" });

        expect(result.isError).toBe(false);
        const responseData = JSON.parse(
          (result.content[0] as TextContent).text
        ) as SemanticSearchResponse;
        expect(responseData.results).toHaveLength(0);
        expect(responseData.metadata.total_matches).toBe(0);
      });

      it("should format response with proper JSON structure", async () => {
        const mockResponse: SearchResponse = {
          results: [
            {
              file_path: "test.ts",
              repository: "repo1",
              content_snippet: "test content",
              similarity_score: 0.95,
              chunk_index: 2,
              metadata: {
                file_extension: ".ts",
                file_size_bytes: 500,
                indexed_at: "2025-01-01T00:00:00Z",
              },
            },
          ],
          metadata: {
            total_matches: 1,
            query_time_ms: 200,
            embedding_time_ms: 100,
            search_time_ms: 100,
            repositories_searched: ["repo1"],
          },
        };

        mockService.setMockResponse(mockResponse);
        const handler = createSemanticSearchHandler(mockService);
        const result = await handler({ query: "test" });

        const responseData = JSON.parse(
          (result.content[0] as TextContent).text
        ) as SemanticSearchResponse;

        expect(responseData.results).toBeDefined();
        expect(responseData.metadata).toBeDefined();
        expect(responseData.results[0].content).toBe("test content");
        expect(responseData.results[0].similarity_score).toBe(0.95);
        expect(responseData.results[0].metadata.file_path).toBe("test.ts");
      });

      it("should include all metadata fields in response", async () => {
        const mockResponse: SearchResponse = {
          results: [],
          metadata: {
            total_matches: 0,
            query_time_ms: 150,
            embedding_time_ms: 75,
            search_time_ms: 75,
            repositories_searched: ["repo1", "repo2"],
          },
        };

        mockService.setMockResponse(mockResponse);
        const handler = createSemanticSearchHandler(mockService);
        const result = await handler({ query: "test" });

        const responseData = JSON.parse(
          (result.content[0] as TextContent).text
        ) as SemanticSearchResponse;

        expect(responseData.metadata.total_matches).toBe(0);
        expect(responseData.metadata.query_time_ms).toBe(150);
        expect(responseData.metadata.embedding_time_ms).toBe(75);
        expect(responseData.metadata.search_time_ms).toBe(75);
        expect(responseData.metadata.repositories_searched).toEqual(["repo1", "repo2"]);
      });
    });

    describe("error handling", () => {
      it("should handle validation errors", async () => {
        const handler = createSemanticSearchHandler(mockService);

        const result = await handler({
          query: "",
        });

        expect(result.isError).toBe(true);
        expect((result.content[0] as TextContent).text).toContain("Error:");
      });

      it("should handle SearchService errors", async () => {
        mockService.setShouldFail(true, new SearchOperationError("Search failed"));
        const handler = createSemanticSearchHandler(mockService);

        const result = await handler({
          query: "test",
        });

        expect(result.isError).toBe(true);
        expect((result.content[0] as TextContent).text).toContain("Error:");
      });

      it("should not leak internal error details", async () => {
        mockService.setShouldFail(
          true,
          new SearchOperationError("Internal database error at /secret/path")
        );
        const handler = createSemanticSearchHandler(mockService);

        const result = await handler({ query: "test" });

        expect(result.isError).toBe(true);
        expect((result.content[0] as TextContent).text).not.toContain("/secret/path");
        expect((result.content[0] as TextContent).text).not.toContain("database");
      });

      it("should handle validation errors with proper error codes", async () => {
        const handler = createSemanticSearchHandler(mockService);

        const result = await handler({
          query: "test",
          limit: 1000,
        });

        expect(result.isError).toBe(true);
      });

      it("should return error for query exceeding 1000 chars", async () => {
        const handler = createSemanticSearchHandler(mockService);
        const longQuery = "a".repeat(1001);

        const result = await handler({ query: longQuery });

        expect(result.isError).toBe(true);
        expect((result.content[0] as TextContent).text).toContain("Error");
      });
    });

    describe("parameter handling", () => {
      it("should handle all parameter combinations", async () => {
        const handler = createSemanticSearchHandler(mockService);

        await handler({
          query: "test",
          limit: 20,
          threshold: 0.8,
          repository: "my-repo",
        });

        expect(mockService.lastQuery?.query).toBe("test");
        expect(mockService.lastQuery?.limit).toBe(20);
        expect(mockService.lastQuery?.threshold).toBe(0.8);
        expect(mockService.lastQuery?.repository).toBe("my-repo");
      });

      it("should trim whitespace from query", async () => {
        const handler = createSemanticSearchHandler(mockService);

        await handler({
          query: "  search query  ",
        });

        expect(mockService.lastQuery?.query).toBe("search query");
      });

      it("should trim whitespace from repository", async () => {
        const handler = createSemanticSearchHandler(mockService);

        await handler({
          query: "test",
          repository: "  my-repo  ",
        });

        expect(mockService.lastQuery?.repository).toBe("my-repo");
      });
    });
  });
});
