/**
 * Tests for list_indexed_repositories MCP Tool
 *
 * Comprehensive test coverage for the tool handler and response formatter.
 */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import type { RepositoryMetadataService, RepositoryInfo } from "../../../src/repositories/types.js";
import type { TextContent } from "@modelcontextprotocol/sdk/types.js";
import {
  createListRepositoriesHandler,
  listIndexedRepositoriesTool,
} from "../../../src/mcp/tools/list-indexed-repositories.js";
import { initializeLogger, resetLogger } from "../../../src/logging/index.js";

/**
 * Type guard to check if value is TextContent
 */
function isTextContent(value: unknown): value is TextContent {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "text" &&
    "text" in value
  );
}

/**
 * Helper to safely extract text from MCP response content
 */
function getTextContent(content: unknown): string {
  if (Array.isArray(content) && content.length > 0 && isTextContent(content[0])) {
    return content[0].text;
  }
  throw new Error("Expected text content");
}

/**
 * Type for parsed list_indexed_repositories response
 */
interface ParsedListResponse {
  repositories: Array<{
    name: string;
    url: string;
    collection_name: string;
    file_count: number;
    chunk_count: number;
    last_indexed: string;
    status: string;
    index_duration_ms: number;
    error_message?: string;
  }>;
  summary: {
    total_repositories: number;
    total_files_indexed: number;
    total_chunks: number;
  };
}

/**
 * Helper to parse and validate response JSON
 */
function parseResponse(text: string): ParsedListResponse {
  return JSON.parse(text) as ParsedListResponse;
}

/**
 * Test helper to create mock RepositoryInfo
 */
function createMockRepo(
  name: string,
  fileCount: number,
  chunkCount: number,
  overrides?: Partial<RepositoryInfo>
): RepositoryInfo {
  return {
    name,
    url: `https://github.com/user/${name}.git`,
    localPath: `/data/repos/${name}`,
    collectionName: `repo_${name}`,
    fileCount,
    chunkCount,
    lastIndexedAt: "2025-01-15T10:30:00.000Z",
    indexDurationMs: 5000,
    status: "ready",
    branch: "main",
    includeExtensions: [".ts", ".js"],
    excludePatterns: ["node_modules/**"],
    ...overrides,
  };
}

describe("listIndexedRepositoriesTool definition", () => {
  it("should have correct tool name", () => {
    expect(listIndexedRepositoriesTool.name).toBe("list_indexed_repositories");
  });

  it("should have a description", () => {
    expect(listIndexedRepositoriesTool.description).toBeTruthy();
    expect(listIndexedRepositoriesTool.description).toBeDefined();
    if (listIndexedRepositoriesTool.description) {
      expect(listIndexedRepositoriesTool.description.length).toBeGreaterThan(0);
    }
  });

  it("should have empty input schema (no required parameters)", () => {
    expect(listIndexedRepositoriesTool.inputSchema.type).toBe("object");
    expect(listIndexedRepositoriesTool.inputSchema.properties).toEqual({});
    expect(listIndexedRepositoriesTool.inputSchema.required).toEqual([]);
  });
});

describe("createListRepositoriesHandler", () => {
  let mockRepositoryService: RepositoryMetadataService;
  let handler: ReturnType<typeof createListRepositoriesHandler>;

  beforeEach(() => {
    initializeLogger({ level: "silent", format: "json" });
    mockRepositoryService = {
      listRepositories: mock(() => Promise.resolve([])),
      getRepository: mock(),
      updateRepository: mock(),
      removeRepository: mock(),
    };
    handler = createListRepositoriesHandler(mockRepositoryService);
  });

  afterEach(() => {
    resetLogger();
  });

  describe("successful responses", () => {
    it("should successfully list empty repositories", async () => {
      // Given: Service returns empty array
      mockRepositoryService.listRepositories = mock(() => Promise.resolve([]));

      // When: Handler called
      const result = await handler({});

      // Then: Valid response with zeros
      expect(result.isError).toBe(false);
      expect(result.content).toHaveLength(1);
      if (!isTextContent(result.content[0])) {
        throw new Error("Expected text content");
      }
      expect(result.content[0].type).toBe("text");

      const response = parseResponse(getTextContent(result.content));
      expect(response.repositories).toEqual([]);
      expect(response.summary).toEqual({
        total_repositories: 0,
        total_files_indexed: 0,
        total_chunks: 0,
      });
    });

    it("should successfully list single repository", async () => {
      // Given: Service returns 1 repository
      const mockRepo = createMockRepo("test-repo", 42, 156);
      mockRepositoryService.listRepositories = mock(() => Promise.resolve([mockRepo]));

      // When: Handler called
      const result = await handler({});

      // Then: Response contains formatted repo
      expect(result.isError).toBe(false);
      const response = parseResponse(getTextContent(result.content));

      expect(response.repositories).toHaveLength(1);
      expect(response.repositories[0]).toEqual({
        name: "test-repo",
        url: "https://github.com/user/test-repo.git",
        collection_name: "repo_test-repo",
        file_count: 42,
        chunk_count: 156,
        last_indexed: "2025-01-15T10:30:00.000Z",
        status: "ready",
        index_duration_ms: 5000,
        error_message: undefined,
      });

      expect(response.summary).toEqual({
        total_repositories: 1,
        total_files_indexed: 42,
        total_chunks: 156,
      });
    });

    it("should successfully list multiple repositories with correct summary", async () => {
      // Given: Service returns 3 repositories
      const mockRepos: RepositoryInfo[] = [
        createMockRepo("repo1", 10, 50),
        createMockRepo("repo2", 20, 60),
        createMockRepo("repo3", 30, 70),
      ];
      mockRepositoryService.listRepositories = mock(() => Promise.resolve(mockRepos));

      // When: Handler called
      const result = await handler({});

      // Then: Response contains all repos with correct totals
      expect(result.isError).toBe(false);
      const response = parseResponse(getTextContent(result.content));

      expect(response.repositories).toHaveLength(3);
      expect(response.repositories[0].name).toBe("repo1");
      expect(response.repositories[1].name).toBe("repo2");
      expect(response.repositories[2].name).toBe("repo3");

      expect(response.summary).toEqual({
        total_repositories: 3,
        total_files_indexed: 60, // 10 + 20 + 30
        total_chunks: 180, // 50 + 60 + 70
      });
    });

    it("should handle repository with error status", async () => {
      // Given: Repository with error status
      const mockRepo = createMockRepo("failed-repo", 0, 0, {
        status: "error",
        errorMessage: "Failed to clone repository",
      });
      mockRepositoryService.listRepositories = mock(() => Promise.resolve([mockRepo]));

      // When: Handler called
      const result = await handler({});

      // Then: Error message included in response
      expect(result.isError).toBe(false);
      const response = parseResponse(getTextContent(result.content));

      expect(response.repositories[0].status).toBe("error");
      expect(response.repositories[0].error_message).toBe("Failed to clone repository");
    });

    it("should handle repository with indexing status", async () => {
      // Given: Repository currently indexing
      const mockRepo = createMockRepo("indexing-repo", 25, 80, {
        status: "indexing",
      });
      mockRepositoryService.listRepositories = mock(() => Promise.resolve([mockRepo]));

      // When: Handler called
      const result = await handler({});

      // Then: Status is "indexing"
      expect(result.isError).toBe(false);
      const response = parseResponse(getTextContent(result.content));

      expect(response.repositories[0].status).toBe("indexing");
    });

    it("should preserve ISO 8601 timestamp format", async () => {
      // Given: Repository with specific timestamp
      const timestamp = "2025-12-10T15:30:45.123Z";
      const mockRepo = createMockRepo("repo", 10, 20, {
        lastIndexedAt: timestamp,
      });
      mockRepositoryService.listRepositories = mock(() => Promise.resolve([mockRepo]));

      // When: Handler called
      const result = await handler({});

      // Then: Timestamp preserved exactly
      expect(result.isError).toBe(false);
      const response = parseResponse(getTextContent(result.content));

      expect(response.repositories[0].last_indexed).toBe(timestamp);
    });

    it("should map camelCase to snake_case correctly", async () => {
      // Given: Repository with all fields
      const mockRepo = createMockRepo("test-repo", 100, 300);
      mockRepositoryService.listRepositories = mock(() => Promise.resolve([mockRepo]));

      // When: Handler called
      const result = await handler({});

      // Then: All snake_case fields present
      expect(result.isError).toBe(false);
      const response = parseResponse(getTextContent(result.content));
      const repo = response.repositories[0];

      // Verify snake_case field names
      expect(repo).toHaveProperty("collection_name");
      expect(repo).toHaveProperty("file_count");
      expect(repo).toHaveProperty("chunk_count");
      expect(repo).toHaveProperty("last_indexed");
      expect(repo).toHaveProperty("index_duration_ms");

      // Verify no camelCase fields
      expect(repo).not.toHaveProperty("collectionName");
      expect(repo).not.toHaveProperty("fileCount");
      expect(repo).not.toHaveProperty("chunkCount");
      expect(repo).not.toHaveProperty("lastIndexedAt");
      expect(repo).not.toHaveProperty("indexDurationMs");
    });

    it("should exclude internal fields from response", async () => {
      // Given: Repository with internal fields
      const mockRepo = createMockRepo("test-repo", 10, 20);
      mockRepositoryService.listRepositories = mock(() => Promise.resolve([mockRepo]));

      // When: Handler called
      const result = await handler({});

      // Then: Internal fields not in response
      expect(result.isError).toBe(false);
      const response = parseResponse(getTextContent(result.content));
      const repo = response.repositories[0];

      // Should NOT include these internal fields
      expect(repo).not.toHaveProperty("localPath");
      expect(repo).not.toHaveProperty("branch");
      expect(repo).not.toHaveProperty("includeExtensions");
      expect(repo).not.toHaveProperty("excludePatterns");
    });
  });

  describe("error handling", () => {
    it("should handle service errors gracefully", async () => {
      // Given: Service throws error
      const error = new Error("Database connection failed");
      mockRepositoryService.listRepositories = mock(() => Promise.reject(error));

      // When: Handler called
      const result = await handler({});

      // Then: Error response returned
      expect(result.isError).toBe(true);
      expect(result.content).toHaveLength(1);
      if (!isTextContent(result.content[0])) {
        throw new Error("Expected text content");
      }
      expect(result.content[0].type).toBe("text");
      expect(getTextContent(result.content)).toContain("Error");
    });

    it("should handle unexpected service errors", async () => {
      // Given: Service throws non-Error
      mockRepositoryService.listRepositories = mock(() => Promise.reject("String error"));

      // When: Handler called
      const result = await handler({});

      // Then: Error response returned
      expect(result.isError).toBe(true);
      expect(result.content).toHaveLength(1);
      if (!isTextContent(result.content[0])) {
        throw new Error("Expected text content");
      }
      expect(result.content[0].type).toBe("text");
    });
  });

  describe("response format", () => {
    it("should return properly formatted JSON", async () => {
      // Given: Service returns repositories
      const mockRepos = [createMockRepo("repo1", 10, 20)];
      mockRepositoryService.listRepositories = mock(() => Promise.resolve(mockRepos));

      // When: Handler called
      const result = await handler({});

      // Then: Response is valid JSON
      expect(result.isError).toBe(false);
      const text = getTextContent(result.content);

      const response = parseResponse(text);
      expect(response).toHaveProperty("repositories");
      expect(response).toHaveProperty("summary");
      expect(Array.isArray(response.repositories)).toBe(true);
    });

    it("should format JSON with pretty printing", async () => {
      // Given: Service returns repositories
      mockRepositoryService.listRepositories = mock(() => Promise.resolve([]));

      // When: Handler called
      const result = await handler({});

      // Then: JSON is formatted with indentation
      expect(result.isError).toBe(false);
      const text = getTextContent(result.content);
      expect(text).toContain("\n");
      expect(text).toContain("  "); // Indentation
    });
  });

  describe("summary calculations", () => {
    it("should calculate summary for mixed repositories", async () => {
      // Given: Repositories with varying counts
      const mockRepos: RepositoryInfo[] = [
        createMockRepo("repo1", 5, 20),
        createMockRepo("repo2", 10, 30),
        createMockRepo("repo3", 15, 40),
        createMockRepo("repo4", 20, 50),
      ];
      mockRepositoryService.listRepositories = mock(() => Promise.resolve(mockRepos));

      // When: Handler called
      const result = await handler({});

      // Then: Summary correctly calculated
      expect(result.isError).toBe(false);
      const response = parseResponse(getTextContent(result.content));

      expect(response.summary).toEqual({
        total_repositories: 4,
        total_files_indexed: 50, // 5+10+15+20
        total_chunks: 140, // 20+30+40+50
      });
    });

    it("should handle zero counts in summary", async () => {
      // Given: Repositories with zero counts
      const mockRepos: RepositoryInfo[] = [
        createMockRepo("repo1", 0, 0),
        createMockRepo("repo2", 0, 0),
      ];
      mockRepositoryService.listRepositories = mock(() => Promise.resolve(mockRepos));

      // When: Handler called
      const result = await handler({});

      // Then: Summary shows zeros
      expect(result.isError).toBe(false);
      const response = parseResponse(getTextContent(result.content));

      expect(response.summary).toEqual({
        total_repositories: 2,
        total_files_indexed: 0,
        total_chunks: 0,
      });
    });
  });
});
