/**
 * Unit tests for search_documents MCP tool
 *
 * Tests tool definition, handler execution, response formatting, and error handling
 * with mocked DocumentSearchService dependencies.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import type {
  DocumentSearchService,
  DocumentSearchResponse,
  DocumentSearchQuery,
} from "../../../src/services/document-search-types.js";
import {
  searchDocumentsToolDefinition,
  createSearchDocumentsHandler,
} from "../../../src/mcp/tools/search-documents.js";
import { SearchOperationError } from "../../../src/services/errors.js";
import { initializeLogger, resetLogger } from "../../../src/logging/index.js";
import type { TextContent } from "@modelcontextprotocol/sdk/types.js";

/** Helper interface for JSON Schema property testing */
interface JsonSchemaProperty {
  type?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  default?: unknown;
  description?: string;
  items?: { type?: string; enum?: string[] };
  enum?: string[];
}

/** Helper interface for search_documents tool response */
interface DocumentSearchResultJSON {
  content: string;
  documentPath: string;
  documentTitle?: string;
  documentType: string;
  pageNumber?: number;
  sectionHeading?: string;
  similarity: number;
  folder: string;
}

interface DocumentSearchResponseJSON {
  results: DocumentSearchResultJSON[];
  metadata: {
    totalResults: number;
    queryTimeMs: number;
    searchedFolders: string[];
    searchedDocumentTypes: string[];
  };
}

/** Mock DocumentSearchService */
class MockDocumentSearchService implements DocumentSearchService {
  private mockResponse: DocumentSearchResponse | null = null;
  private shouldFail = false;
  private failureError: Error | null = null;
  public lastQuery: DocumentSearchQuery | null = null;

  async searchDocuments(query: DocumentSearchQuery): Promise<DocumentSearchResponse> {
    this.lastQuery = query;

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

describe("search_documents Tool", () => {
  beforeEach(() => {
    initializeLogger({ level: "silent", format: "json" });
  });

  afterEach(() => {
    resetLogger();
  });

  describe("tool definition", () => {
    it("should have correct name", () => {
      expect(searchDocumentsToolDefinition.name).toBe("search_documents");
    });

    it("should have helpful description", () => {
      expect(searchDocumentsToolDefinition.description).toBeDefined();
      expect(searchDocumentsToolDefinition.description!.length).toBeGreaterThan(50);
    });

    it("should define input schema", () => {
      expect(searchDocumentsToolDefinition.inputSchema).toBeDefined();
      expect(searchDocumentsToolDefinition.inputSchema.type).toBe("object");
    });

    it("should require query parameter", () => {
      expect(searchDocumentsToolDefinition.inputSchema.required).toContain("query");
    });

    it("should only require query parameter", () => {
      expect(searchDocumentsToolDefinition.inputSchema.required).toHaveLength(1);
    });

    it("should define query property with constraints", () => {
      const queryProp = searchDocumentsToolDefinition.inputSchema.properties![
        "query"
      ] as JsonSchemaProperty;
      expect(queryProp.type).toBe("string");
      expect(queryProp.minLength).toBe(1);
      expect(queryProp.maxLength).toBe(1000);
    });

    it("should define document_types property as array", () => {
      const docTypesProp = searchDocumentsToolDefinition.inputSchema.properties![
        "document_types"
      ] as JsonSchemaProperty;
      expect(docTypesProp.type).toBe("array");
      expect(docTypesProp.items?.enum).toContain("pdf");
      expect(docTypesProp.items?.enum).toContain("docx");
      expect(docTypesProp.items?.enum).toContain("markdown");
      expect(docTypesProp.items?.enum).toContain("txt");
      expect(docTypesProp.items?.enum).toContain("all");
      expect(docTypesProp.default).toEqual(["all"]);
    });

    it("should define optional folder property", () => {
      const folderProp = searchDocumentsToolDefinition.inputSchema.properties![
        "folder"
      ] as JsonSchemaProperty;
      expect(folderProp.type).toBe("string");
      expect(searchDocumentsToolDefinition.inputSchema.required).not.toContain("folder");
    });

    it("should define limit property with range", () => {
      const limitProp = searchDocumentsToolDefinition.inputSchema.properties![
        "limit"
      ] as JsonSchemaProperty;
      expect(limitProp.type).toBe("integer");
      expect(limitProp.minimum).toBe(1);
      expect(limitProp.maximum).toBe(50);
      expect(limitProp.default).toBe(10);
    });

    it("should define threshold property with range", () => {
      const thresholdProp = searchDocumentsToolDefinition.inputSchema.properties![
        "threshold"
      ] as JsonSchemaProperty;
      expect(thresholdProp.type).toBe("number");
      expect(thresholdProp.minimum).toBe(0.0);
      expect(thresholdProp.maximum).toBe(1.0);
      expect(thresholdProp.default).toBe(0.7);
    });
  });

  describe("createSearchDocumentsHandler", () => {
    let mockService: MockDocumentSearchService;

    beforeEach(() => {
      mockService = new MockDocumentSearchService();
    });

    describe("successful search", () => {
      it("should return results for valid query", async () => {
        const mockResponse: DocumentSearchResponse = {
          results: [
            {
              content: "Neural networks consist of layers of interconnected nodes...",
              documentPath: "docs/ml-guide.pdf",
              documentTitle: "Machine Learning Guide",
              documentType: "pdf",
              pageNumber: 5,
              sectionHeading: "Neural Network Architecture",
              similarity: 0.92,
              folder: "ml-docs",
            },
          ],
          metadata: {
            totalResults: 1,
            queryTimeMs: 234,
            searchedFolders: ["ml-docs"],
            searchedDocumentTypes: ["pdf"],
          },
        };

        mockService.setMockResponse(mockResponse);
        const handler = createSearchDocumentsHandler(mockService);

        const result = await handler({
          query: "neural network architecture",
          limit: 10,
          threshold: 0.7,
        });

        expect(result.isError).toBe(false);
        expect(result.content).toHaveLength(1);
        expect(result.content[0]!.type).toBe("text");

        const responseData = JSON.parse(
          (result.content[0] as TextContent).text
        ) as DocumentSearchResponseJSON;
        expect(responseData.results).toHaveLength(1);
        expect(responseData.results[0]!.content).toContain("Neural networks");
        expect(responseData.results[0]!.documentTitle).toBe("Machine Learning Guide");
        expect(responseData.results[0]!.pageNumber).toBe(5);
        expect(responseData.metadata.totalResults).toBe(1);
      });

      it("should pass query to DocumentSearchService", async () => {
        const handler = createSearchDocumentsHandler(mockService);

        await handler({
          query: "find algorithms",
          limit: 5,
        });

        expect(mockService.lastQuery).not.toBeNull();
        expect(mockService.lastQuery?.query).toBe("find algorithms");
        expect(mockService.lastQuery?.limit).toBe(5);
      });

      it("should apply default values for optional parameters", async () => {
        const handler = createSearchDocumentsHandler(mockService);

        await handler({
          query: "test query",
        });

        expect(mockService.lastQuery?.limit).toBe(10);
        expect(mockService.lastQuery?.threshold).toBe(0.7);
        expect(mockService.lastQuery?.document_types).toEqual(["all"]);
      });

      it("should pass folder filter to service", async () => {
        const handler = createSearchDocumentsHandler(mockService);

        await handler({
          query: "search",
          folder: "my-notes",
        });

        expect(mockService.lastQuery?.folder).toBe("my-notes");
      });

      it("should pass document_types filter to service", async () => {
        const handler = createSearchDocumentsHandler(mockService);

        await handler({
          query: "search",
          document_types: ["pdf", "docx"],
        });

        expect(mockService.lastQuery?.document_types).toEqual(["pdf", "docx"]);
      });

      it("should handle empty results gracefully", async () => {
        mockService.setMockResponse({
          results: [],
          metadata: {
            totalResults: 0,
            queryTimeMs: 100,
            searchedFolders: ["test-folder"],
            searchedDocumentTypes: ["all"],
          },
        });

        const handler = createSearchDocumentsHandler(mockService);
        const result = await handler({ query: "nonexistent" });

        expect(result.isError).toBe(false);
        const responseData = JSON.parse(
          (result.content[0] as TextContent).text
        ) as DocumentSearchResponseJSON;
        expect(responseData.results).toHaveLength(0);
        expect(responseData.metadata.totalResults).toBe(0);
      });

      it("should format response with proper JSON structure", async () => {
        const mockResponse: DocumentSearchResponse = {
          results: [
            {
              content: "Chapter 1 content",
              documentPath: "notes/chapter1.md",
              documentTitle: "Study Notes",
              documentType: "markdown",
              sectionHeading: "Introduction",
              similarity: 0.88,
              folder: "study-materials",
            },
          ],
          metadata: {
            totalResults: 1,
            queryTimeMs: 150,
            searchedFolders: ["study-materials"],
            searchedDocumentTypes: ["markdown"],
          },
        };

        mockService.setMockResponse(mockResponse);
        const handler = createSearchDocumentsHandler(mockService);
        const result = await handler({ query: "chapter 1" });

        const responseData = JSON.parse(
          (result.content[0] as TextContent).text
        ) as DocumentSearchResponseJSON;

        expect(responseData.results).toBeDefined();
        expect(responseData.metadata).toBeDefined();
        expect(responseData.results[0]!.content).toBe("Chapter 1 content");
        expect(responseData.results[0]!.similarity).toBe(0.88);
        expect(responseData.results[0]!.documentType).toBe("markdown");
        expect(responseData.results[0]!.folder).toBe("study-materials");
      });

      it("should include all metadata fields in response", async () => {
        const mockResponse: DocumentSearchResponse = {
          results: [],
          metadata: {
            totalResults: 0,
            queryTimeMs: 150,
            searchedFolders: ["folder1", "folder2"],
            searchedDocumentTypes: ["pdf", "docx"],
          },
        };

        mockService.setMockResponse(mockResponse);
        const handler = createSearchDocumentsHandler(mockService);
        const result = await handler({ query: "test" });

        const responseData = JSON.parse(
          (result.content[0] as TextContent).text
        ) as DocumentSearchResponseJSON;

        expect(responseData.metadata.totalResults).toBe(0);
        expect(responseData.metadata.queryTimeMs).toBe(150);
        expect(responseData.metadata.searchedFolders).toEqual(["folder1", "folder2"]);
        expect(responseData.metadata.searchedDocumentTypes).toEqual(["pdf", "docx"]);
      });

      it("should handle results with optional fields undefined", async () => {
        const mockResponse: DocumentSearchResponse = {
          results: [
            {
              content: "Some plain text content",
              documentPath: "notes/file.txt",
              documentType: "txt",
              similarity: 0.75,
              folder: "notes",
              // No documentTitle, pageNumber, or sectionHeading
            },
          ],
          metadata: {
            totalResults: 1,
            queryTimeMs: 80,
            searchedFolders: ["notes"],
            searchedDocumentTypes: ["txt"],
          },
        };

        mockService.setMockResponse(mockResponse);
        const handler = createSearchDocumentsHandler(mockService);
        const result = await handler({ query: "plain text" });

        expect(result.isError).toBe(false);
        const responseData = JSON.parse(
          (result.content[0] as TextContent).text
        ) as DocumentSearchResponseJSON;

        expect(responseData.results[0]!.documentTitle).toBeUndefined();
        expect(responseData.results[0]!.pageNumber).toBeUndefined();
        expect(responseData.results[0]!.sectionHeading).toBeUndefined();
      });
    });

    describe("error handling", () => {
      it("should handle validation errors for empty query", async () => {
        const handler = createSearchDocumentsHandler(mockService);

        const result = await handler({
          query: "",
        });

        expect(result.isError).toBe(true);
        expect((result.content[0] as TextContent).text).toContain("Error:");
      });

      it("should handle SearchService errors", async () => {
        mockService.setShouldFail(true, new SearchOperationError("Document search failed"));
        const handler = createSearchDocumentsHandler(mockService);

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
        const handler = createSearchDocumentsHandler(mockService);

        const result = await handler({ query: "test" });

        expect(result.isError).toBe(true);
        expect((result.content[0] as TextContent).text).not.toContain("/secret/path");
        expect((result.content[0] as TextContent).text).not.toContain("database");
      });

      it("should handle validation errors for invalid limit", async () => {
        const handler = createSearchDocumentsHandler(mockService);

        const result = await handler({
          query: "test",
          limit: 1000,
        });

        expect(result.isError).toBe(true);
      });

      it("should return error for query exceeding 1000 chars", async () => {
        const handler = createSearchDocumentsHandler(mockService);
        const longQuery = "a".repeat(1001);

        const result = await handler({ query: longQuery });

        expect(result.isError).toBe(true);
        expect((result.content[0] as TextContent).text).toContain("Error");
      });

      it("should handle invalid document_types values", async () => {
        const handler = createSearchDocumentsHandler(mockService);

        const result = await handler({
          query: "test",
          document_types: ["invalid-type"],
        });

        expect(result.isError).toBe(true);
        expect((result.content[0] as TextContent).text).toContain("Error");
      });

      it("should handle threshold out of range", async () => {
        const handler = createSearchDocumentsHandler(mockService);

        const result = await handler({
          query: "test",
          threshold: 1.5,
        });

        expect(result.isError).toBe(true);
      });

      it("should handle negative limit", async () => {
        const handler = createSearchDocumentsHandler(mockService);

        const result = await handler({
          query: "test",
          limit: -1,
        });

        expect(result.isError).toBe(true);
      });
    });

    describe("parameter handling", () => {
      it("should handle all parameter combinations", async () => {
        const handler = createSearchDocumentsHandler(mockService);

        await handler({
          query: "test",
          limit: 20,
          threshold: 0.8,
          folder: "my-folder",
          document_types: ["pdf", "docx"],
        });

        expect(mockService.lastQuery?.query).toBe("test");
        expect(mockService.lastQuery?.limit).toBe(20);
        expect(mockService.lastQuery?.threshold).toBe(0.8);
        expect(mockService.lastQuery?.folder).toBe("my-folder");
        expect(mockService.lastQuery?.document_types).toEqual(["pdf", "docx"]);
      });

      it("should trim whitespace from query", async () => {
        const handler = createSearchDocumentsHandler(mockService);

        await handler({
          query: "  search query  ",
        });

        expect(mockService.lastQuery?.query).toBe("search query");
      });

      it("should trim whitespace from folder", async () => {
        const handler = createSearchDocumentsHandler(mockService);

        await handler({
          query: "test",
          folder: "  my-folder  ",
        });

        expect(mockService.lastQuery?.folder).toBe("my-folder");
      });

      it("should accept all valid document types", async () => {
        const handler = createSearchDocumentsHandler(mockService);

        await handler({
          query: "test",
          document_types: ["pdf", "docx", "markdown", "txt"],
        });

        expect(mockService.lastQuery?.document_types).toEqual(["pdf", "docx", "markdown", "txt"]);
      });

      it("should accept 'all' document type", async () => {
        const handler = createSearchDocumentsHandler(mockService);

        await handler({
          query: "test",
          document_types: ["all"],
        });

        expect(mockService.lastQuery?.document_types).toEqual(["all"]);
      });

      it("should reject extra unknown properties", async () => {
        const handler = createSearchDocumentsHandler(mockService);

        const result = await handler({
          query: "test",
          unknown_param: "value",
        });

        expect(result.isError).toBe(true);
      });
    });
  });
});
