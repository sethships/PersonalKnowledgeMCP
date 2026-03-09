/**
 * Unit tests for semantic_search MCP tool
 *
 * Tests tool definition, handler execution, response formatting, error handling,
 * and include_documents functionality with mocked SearchService and
 * DocumentSearchService dependencies.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import type { SearchService, SearchResponse, SearchQuery } from "../../../src/services/types.js";
import type {
  DocumentSearchService,
  DocumentSearchResponse,
  DocumentSearchQuery,
} from "../../../src/services/document-search-types.js";
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

// Helper interface for semantic_search tool response (legacy code-only)
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
    warnings?: Array<{ type: string; repository: string; message: string }>;
  };
}

// Helper interface for merged response (include_documents=true)
interface MergedSearchResult {
  source_type: "code" | "document";
  content: string;
  similarity_score: number;
  metadata: Record<string, unknown>;
}

interface MergedSearchResponse {
  results: MergedSearchResult[];
  metadata: {
    total_matches: number;
    code_matches: number;
    document_matches: number;
    query_time_ms: number;
    embedding_time_ms: number;
    search_time_ms: number;
    repositories_searched: string[];
    document_folders_searched?: string[];
    warnings?: string[];
  };
}

// Mock SearchService
class MockSearchService implements SearchService {
  private mockResponse: SearchResponse | null = null;
  private shouldFail = false;
  private failureError: Error | null = null;
  public lastQuery: SearchQuery | null = null;
  public callCount = 0;

  async search(query: SearchQuery): Promise<SearchResponse> {
    this.lastQuery = query;
    this.callCount++;

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

// Mock DocumentSearchService
class MockDocumentSearchService implements DocumentSearchService {
  private mockResponse: DocumentSearchResponse | null = null;
  private shouldFail = false;
  private failureError: Error | null = null;
  public lastQuery: DocumentSearchQuery | null = null;
  public callCount = 0;

  async searchDocuments(query: DocumentSearchQuery): Promise<DocumentSearchResponse> {
    this.lastQuery = query;
    this.callCount++;

    if (this.shouldFail && this.failureError) {
      throw this.failureError;
    }

    return (
      this.mockResponse || {
        results: [],
        metadata: {
          totalResults: 0,
          queryTimeMs: 100,
          searchedFolders: [],
          searchedDocumentTypes: ["all"],
        },
      }
    );
  }

  setMockResponse(response: DocumentSearchResponse): void {
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

    it("should define optional language property", () => {
      const langProp = semanticSearchToolDefinition.inputSchema.properties![
        "language"
      ] as JsonSchemaProperty;
      expect(langProp).toBeDefined();
      expect(langProp.type).toBe("string");
      expect(semanticSearchToolDefinition.inputSchema.required).not.toContain("language");
    });

    it("should define include_documents property with boolean type and default false", () => {
      const prop = semanticSearchToolDefinition.inputSchema.properties![
        "include_documents"
      ] as JsonSchemaProperty;
      expect(prop).toBeDefined();
      expect(prop.type).toBe("boolean");
      expect(prop.default).toBe(false);
      expect(semanticSearchToolDefinition.inputSchema.required).not.toContain("include_documents");
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
        expect(responseData.results[0]!.content).toContain("authenticate");
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
        expect(responseData.results[0]!.content).toBe("test content");
        expect(responseData.results[0]!.similarity_score).toBe(0.95);
        expect(responseData.results[0]!.metadata.file_path).toBe("test.ts");
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

      it("should include warnings in metadata when present", async () => {
        const mockResponse: SearchResponse = {
          results: [],
          metadata: {
            total_matches: 0,
            query_time_ms: 100,
            embedding_time_ms: 50,
            search_time_ms: 50,
            repositories_searched: ["error-repo"],
            warnings: [
              {
                type: "partial_index",
                repository: "error-repo",
                message: "Repository 'error-repo' has status 'error' and may have incomplete data.",
              },
            ],
          },
        };

        mockService.setMockResponse(mockResponse);
        const handler = createSemanticSearchHandler(mockService);
        const result = await handler({ query: "test" });

        const responseData = JSON.parse(
          (result.content[0] as TextContent).text
        ) as SemanticSearchResponse;

        expect(responseData.metadata.warnings).toBeDefined();
        expect(responseData.metadata.warnings).toHaveLength(1);
        expect(responseData.metadata.warnings![0]!.type).toBe("partial_index");
        expect(responseData.metadata.warnings![0]!.repository).toBe("error-repo");
      });

      it("should omit warnings from metadata when none present", async () => {
        const mockResponse: SearchResponse = {
          results: [],
          metadata: {
            total_matches: 0,
            query_time_ms: 100,
            embedding_time_ms: 50,
            search_time_ms: 50,
            repositories_searched: ["repo1"],
          },
        };

        mockService.setMockResponse(mockResponse);
        const handler = createSemanticSearchHandler(mockService);
        const result = await handler({ query: "test" });

        const responseData = JSON.parse(
          (result.content[0] as TextContent).text
        ) as SemanticSearchResponse;

        expect(responseData.metadata.warnings).toBeUndefined();
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

      it("should pass language filter to SearchService", async () => {
        const handler = createSemanticSearchHandler(mockService);

        await handler({
          query: "typescript code",
          language: "typescript",
        });

        expect(mockService.lastQuery?.language).toBe("typescript");
      });

      it("should handle all parameters including language", async () => {
        const handler = createSemanticSearchHandler(mockService);

        await handler({
          query: "test",
          limit: 20,
          threshold: 0.8,
          repository: "my-repo",
          language: "typescript",
        });

        expect(mockService.lastQuery?.query).toBe("test");
        expect(mockService.lastQuery?.limit).toBe(20);
        expect(mockService.lastQuery?.threshold).toBe(0.8);
        expect(mockService.lastQuery?.repository).toBe("my-repo");
        expect(mockService.lastQuery?.language).toBe("typescript");
      });

      it("should reject invalid language values", async () => {
        const handler = createSemanticSearchHandler(mockService);

        const result = await handler({
          query: "test",
          language: "invalid-language",
        });

        // Invalid language values should return an error
        expect(result.isError).toBe(true);
        expect((result.content[0] as { text: string }).text).toContain("Error");
      });
    });
  });

  describe("include_documents", () => {
    let mockSearchService: MockSearchService;
    let mockDocSearchService: MockDocumentSearchService;

    const codeResult: SearchResponse = {
      results: [
        {
          file_path: "src/auth.ts",
          repository: "backend-api",
          content_snippet: "export function authenticate() { }",
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
        query_time_ms: 200,
        embedding_time_ms: 100,
        search_time_ms: 100,
        repositories_searched: ["backend-api"],
      },
    };

    const docResult: DocumentSearchResponse = {
      results: [
        {
          content: "Authentication best practices for web apps...",
          documentPath: "docs/security.pdf",
          documentTitle: "Security Guide",
          documentAuthor: "Jane Doe",
          documentType: "pdf",
          pageNumber: 5,
          sectionHeading: "Authentication",
          similarity: 0.88,
          folder: "my-docs",
        },
      ],
      metadata: {
        totalResults: 1,
        queryTimeMs: 150,
        searchedFolders: ["my-docs"],
        searchedDocumentTypes: ["pdf"],
      },
    };

    beforeEach(() => {
      mockSearchService = new MockSearchService();
      mockDocSearchService = new MockDocumentSearchService();
    });

    it("should preserve exact legacy output format when include_documents=false", async () => {
      mockSearchService.setMockResponse(codeResult);
      const handler = createSemanticSearchHandler(mockSearchService, mockDocSearchService);

      const result = await handler({
        query: "authentication",
        include_documents: false,
      });

      expect(result.isError).toBe(false);
      const responseData = JSON.parse(
        (result.content[0] as TextContent).text
      ) as SemanticSearchResponse;

      // Legacy format: no source_type field, standard metadata
      expect(responseData.results[0]!.content).toBe("export function authenticate() { }");
      expect(responseData.results[0]!.similarity_score).toBe(0.92);
      expect(responseData.results[0]!.metadata.file_path).toBe("src/auth.ts");
      expect(responseData.metadata.total_matches).toBe(1);
      expect(responseData.metadata.repositories_searched).toEqual(["backend-api"]);
      // Should NOT have source_type or code_matches/document_matches
      const resultAsAny = responseData.results[0] as unknown as Record<string, unknown>;
      expect(resultAsAny["source_type"]).toBeUndefined();
      const metadataAsAny = responseData.metadata as unknown as Record<string, unknown>;
      expect(metadataAsAny["code_matches"]).toBeUndefined();
      expect(metadataAsAny["document_matches"]).toBeUndefined();
    });

    it("should not call DocumentSearchService when include_documents=false", async () => {
      const handler = createSemanticSearchHandler(mockSearchService, mockDocSearchService);

      await handler({ query: "test", include_documents: false });

      expect(mockDocSearchService.callCount).toBe(0);
      expect(mockSearchService.callCount).toBe(1);
    });

    it("should default include_documents to false when omitted", async () => {
      const handler = createSemanticSearchHandler(mockSearchService, mockDocSearchService);

      await handler({ query: "test" });

      expect(mockDocSearchService.callCount).toBe(0);
      expect(mockSearchService.callCount).toBe(1);
    });

    it("should return merged results with source_type when include_documents=true", async () => {
      mockSearchService.setMockResponse(codeResult);
      mockDocSearchService.setMockResponse(docResult);
      const handler = createSemanticSearchHandler(mockSearchService, mockDocSearchService);

      const result = await handler({
        query: "authentication",
        include_documents: true,
      });

      expect(result.isError).toBe(false);
      const responseData = JSON.parse(
        (result.content[0] as TextContent).text
      ) as MergedSearchResponse;

      expect(responseData.results).toHaveLength(2);
      // Verify source_type tagging
      const codeResults = responseData.results.filter((r) => r.source_type === "code");
      const docResults = responseData.results.filter((r) => r.source_type === "document");
      expect(codeResults).toHaveLength(1);
      expect(docResults).toHaveLength(1);
    });

    it("should sort merged results by similarity_score descending", async () => {
      mockSearchService.setMockResponse(codeResult);
      mockDocSearchService.setMockResponse(docResult);
      const handler = createSemanticSearchHandler(mockSearchService, mockDocSearchService);

      const result = await handler({
        query: "authentication",
        include_documents: true,
      });

      const responseData = JSON.parse(
        (result.content[0] as TextContent).text
      ) as MergedSearchResponse;

      // Code result (0.92) should come before document result (0.88)
      expect(responseData.results[0]!.source_type).toBe("code");
      expect(responseData.results[0]!.similarity_score).toBe(0.92);
      expect(responseData.results[1]!.source_type).toBe("document");
      expect(responseData.results[1]!.similarity_score).toBe(0.88);
    });

    it("should truncate merged results to limit", async () => {
      // Create multiple code results
      const multiCodeResult: SearchResponse = {
        results: [
          {
            file_path: "src/a.ts",
            repository: "repo",
            content_snippet: "code A",
            similarity_score: 0.95,
            chunk_index: 0,
            metadata: {
              file_extension: ".ts",
              file_size_bytes: 100,
              indexed_at: "2025-01-01T00:00:00Z",
            },
          },
          {
            file_path: "src/b.ts",
            repository: "repo",
            content_snippet: "code B",
            similarity_score: 0.9,
            chunk_index: 0,
            metadata: {
              file_extension: ".ts",
              file_size_bytes: 100,
              indexed_at: "2025-01-01T00:00:00Z",
            },
          },
        ],
        metadata: {
          total_matches: 2,
          query_time_ms: 100,
          embedding_time_ms: 50,
          search_time_ms: 50,
          repositories_searched: ["repo"],
        },
      };

      const multiDocResult: DocumentSearchResponse = {
        results: [
          {
            content: "doc content A",
            documentPath: "a.pdf",
            documentType: "pdf",
            similarity: 0.93,
            folder: "docs",
          },
          {
            content: "doc content B",
            documentPath: "b.pdf",
            documentType: "pdf",
            similarity: 0.85,
            folder: "docs",
          },
        ],
        metadata: {
          totalResults: 2,
          queryTimeMs: 80,
          searchedFolders: ["docs"],
          searchedDocumentTypes: ["pdf"],
        },
      };

      mockSearchService.setMockResponse(multiCodeResult);
      mockDocSearchService.setMockResponse(multiDocResult);
      const handler = createSemanticSearchHandler(mockSearchService, mockDocSearchService);

      const result = await handler({
        query: "test",
        limit: 3,
        include_documents: true,
      });

      const responseData = JSON.parse(
        (result.content[0] as TextContent).text
      ) as MergedSearchResponse;

      // 4 total results but limit=3
      expect(responseData.results).toHaveLength(3);
      expect(responseData.metadata.total_matches).toBe(3);
    });

    it("should call both services in parallel", async () => {
      mockSearchService.setMockResponse(codeResult);
      mockDocSearchService.setMockResponse(docResult);
      const handler = createSemanticSearchHandler(mockSearchService, mockDocSearchService);

      await handler({
        query: "authentication",
        include_documents: true,
      });

      // Both services should have been called
      expect(mockSearchService.callCount).toBe(1);
      expect(mockDocSearchService.callCount).toBe(1);
    });

    it("should include code_matches and document_matches in metadata", async () => {
      mockSearchService.setMockResponse(codeResult);
      mockDocSearchService.setMockResponse(docResult);
      const handler = createSemanticSearchHandler(mockSearchService, mockDocSearchService);

      const result = await handler({
        query: "authentication",
        include_documents: true,
      });

      const responseData = JSON.parse(
        (result.content[0] as TextContent).text
      ) as MergedSearchResponse;

      expect(responseData.metadata.code_matches).toBe(1);
      expect(responseData.metadata.document_matches).toBe(1);
      expect(responseData.metadata.total_matches).toBe(2);
    });

    it("should include document_folders_searched in metadata", async () => {
      mockSearchService.setMockResponse(codeResult);
      mockDocSearchService.setMockResponse(docResult);
      const handler = createSemanticSearchHandler(mockSearchService, mockDocSearchService);

      const result = await handler({
        query: "authentication",
        include_documents: true,
      });

      const responseData = JSON.parse(
        (result.content[0] as TextContent).text
      ) as MergedSearchResponse;

      expect(responseData.metadata.document_folders_searched).toEqual(["my-docs"]);
      expect(responseData.metadata.repositories_searched).toEqual(["backend-api"]);
    });

    it("should include document metadata fields in results", async () => {
      mockSearchService.setMockResponse({
        results: [],
        metadata: {
          total_matches: 0,
          query_time_ms: 100,
          embedding_time_ms: 50,
          search_time_ms: 50,
          repositories_searched: [],
        },
      });
      mockDocSearchService.setMockResponse(docResult);
      const handler = createSemanticSearchHandler(mockSearchService, mockDocSearchService);

      const result = await handler({
        query: "authentication",
        include_documents: true,
      });

      const responseData = JSON.parse(
        (result.content[0] as TextContent).text
      ) as MergedSearchResponse;

      const docResultItem = responseData.results.find((r) => r.source_type === "document");
      expect(docResultItem).toBeDefined();
      expect(docResultItem!.metadata["document_path"]).toBe("docs/security.pdf");
      expect(docResultItem!.metadata["document_type"]).toBe("pdf");
      expect(docResultItem!.metadata["folder"]).toBe("my-docs");
      expect(docResultItem!.metadata["document_title"]).toBe("Security Guide");
      expect(docResultItem!.metadata["document_author"]).toBe("Jane Doe");
      expect(docResultItem!.metadata["page_number"]).toBe(5);
      expect(docResultItem!.metadata["section_heading"]).toBe("Authentication");
    });

    it("should merge warnings from both code and document searches", async () => {
      const codeWithWarnings: SearchResponse = {
        results: [
          {
            file_path: "src/auth.ts",
            repository: "repo1",
            content_snippet: "auth code",
            similarity_score: 0.9,
            chunk_index: 0,
            metadata: {
              file_extension: ".ts",
              file_size_bytes: 512,
              indexed_at: "2025-01-01T00:00:00Z",
            },
          },
        ],
        metadata: {
          total_matches: 1,
          query_time_ms: 100,
          embedding_time_ms: 50,
          search_time_ms: 50,
          repositories_searched: ["repo1"],
          warnings: [
            {
              type: "partial_index",
              repository: "repo1",
              message: "Code warning message",
            },
          ],
        },
      };

      const docWithWarnings: DocumentSearchResponse = {
        results: [
          {
            content: "document content",
            documentPath: "docs/guide.pdf",
            documentType: "pdf",
            similarity: 0.85,
            folder: "folder1",
          },
        ],
        metadata: {
          totalResults: 1,
          queryTimeMs: 80,
          searchedFolders: ["folder1"],
          searchedDocumentTypes: ["pdf"],
          warnings: [
            {
              type: "partial_index",
              repository: "folder1",
              message: "Doc warning message",
            },
          ],
        },
      };

      mockSearchService.setMockResponse(codeWithWarnings);
      mockDocSearchService.setMockResponse(docWithWarnings);
      const handler = createSemanticSearchHandler(mockSearchService, mockDocSearchService);

      const result = await handler({
        query: "test",
        include_documents: true,
      });

      expect(result.isError).toBe(false);
      const responseData = JSON.parse(
        (result.content[0] as TextContent).text
      ) as MergedSearchResponse;

      expect(responseData.metadata.warnings).toBeDefined();
      expect(responseData.metadata.warnings!.length).toBe(2);
      expect(responseData.metadata.warnings).toContain("Code warning message");
      expect(responseData.metadata.warnings).toContain("Doc warning message");
    });

    describe("graceful degradation", () => {
      it("should return code-only results with warning when DocumentSearchService unavailable", async () => {
        mockSearchService.setMockResponse(codeResult);
        // No document search service passed
        const handler = createSemanticSearchHandler(mockSearchService);

        const result = await handler({
          query: "authentication",
          include_documents: true,
        });

        expect(result.isError).toBe(false);
        const responseData = JSON.parse(
          (result.content[0] as TextContent).text
        ) as MergedSearchResponse;

        // Should still return code results
        expect(responseData.results).toHaveLength(1);
        expect(responseData.results[0]!.source_type).toBe("code");
        // Should have warning about missing document service
        expect(responseData.metadata.warnings).toBeDefined();
        expect(responseData.metadata.warnings!.length).toBeGreaterThan(0);
        expect(responseData.metadata.warnings![0]).toContain("not available");
      });

      it("should return code results when document search throws", async () => {
        mockSearchService.setMockResponse(codeResult);
        mockDocSearchService.setShouldFail(
          true,
          new SearchOperationError("Document search failed")
        );
        const handler = createSemanticSearchHandler(mockSearchService, mockDocSearchService);

        const result = await handler({
          query: "authentication",
          include_documents: true,
        });

        expect(result.isError).toBe(false);
        const responseData = JSON.parse(
          (result.content[0] as TextContent).text
        ) as MergedSearchResponse;

        // Should return code results with warning
        expect(responseData.results.length).toBeGreaterThanOrEqual(1);
        expect(responseData.results[0]!.source_type).toBe("code");
        expect(responseData.metadata.warnings).toBeDefined();
        expect(responseData.metadata.warnings![0]).toContain("not available");
      });

      it("should return error when both searches fail", async () => {
        mockSearchService.setShouldFail(true, new SearchOperationError("Code search failed"));
        mockDocSearchService.setShouldFail(true, new SearchOperationError("Doc search failed"));
        const handler = createSemanticSearchHandler(mockSearchService, mockDocSearchService);

        const result = await handler({
          query: "test",
          include_documents: true,
        });

        expect(result.isError).toBe(true);
        expect((result.content[0] as TextContent).text).toContain("Error");
      });
    });
  });
});
