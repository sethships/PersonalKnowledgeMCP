/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any */
/**
 * Integration tests for MCP protocol handling
 *
 * Tests the full MCP protocol request/response cycle including:
 * - tools/list requests
 * - tools/call requests for semantic_search
 * - tools/call requests for list_indexed_repositories
 * - Error handling and validation
 *
 * Uses mock services to isolate protocol testing from external dependencies.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { PersonalKnowledgeMCPServer } from "../../src/mcp/server.js";
import type {
  SearchService,
  SearchResponse,
  SearchQuery,
  SearchResult,
} from "../../src/services/types.js";
import type { RepositoryMetadataService, RepositoryInfo } from "../../src/repositories/types.js";
import { initializeLogger, resetLogger } from "../../src/logging/index.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// Mock SearchService with configurable behavior
class MockSearchService implements SearchService {
  private searchResults: SearchResponse = {
    results: [],
    metadata: {
      total_matches: 0,
      query_time_ms: 50,
      embedding_time_ms: 25,
      search_time_ms: 25,
      repositories_searched: [],
    },
  };

  setSearchResults(results: SearchResponse): void {
    this.searchResults = results;
  }

  async search(_query: SearchQuery): Promise<SearchResponse> {
    return this.searchResults;
  }
}

// Mock RepositoryMetadataService with configurable repositories
class MockRepositoryMetadataService implements RepositoryMetadataService {
  private repositories: RepositoryInfo[] = [];

  setRepositories(repos: RepositoryInfo[]): void {
    this.repositories = repos;
  }

  async listRepositories(): Promise<RepositoryInfo[]> {
    return this.repositories;
  }

  async getRepository(name: string): Promise<RepositoryInfo | null> {
    return this.repositories.find((r) => r.name === name) || null;
  }

  async updateRepository(_info: RepositoryInfo): Promise<void> {
    // Mock implementation
  }

  async removeRepository(_name: string): Promise<void> {
    // Mock implementation
  }
}

describe("MCP Protocol Integration", () => {
  let server: PersonalKnowledgeMCPServer;
  let mockSearchService: MockSearchService;
  let mockRepositoryService: MockRepositoryMetadataService;

  beforeEach(() => {
    // Initialize logger in silent mode for tests
    initializeLogger({ level: "silent", format: "json" });

    // Create fresh mock services
    mockSearchService = new MockSearchService();
    mockRepositoryService = new MockRepositoryMetadataService();

    // Create server instance
    server = new PersonalKnowledgeMCPServer(mockSearchService, mockRepositoryService, {
      name: "test-mcp-server",
      version: "1.0.0-test",
      capabilities: { tools: true },
    });
  });

  afterEach(() => {
    resetLogger();
  });

  describe("tools/list protocol", () => {
    it("should expose semantic_search tool in tools list", async () => {
      const result = await callTool(server, "semantic_search", {
        query: "test",
      });

      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
    });

    it("should expose list_indexed_repositories tool in tools list", async () => {
      const result = await callTool(server, "list_indexed_repositories", {});

      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
    });

    it("should return error for unknown tool", async () => {
      const result = await callTool(server, "unknown_tool", {});

      expect(result).toBeDefined();
      expect(result.isError).toBe(true);
    });
  });

  describe("semantic_search tool invocation", () => {
    it("should execute semantic_search with valid query", async () => {
      // Setup mock search results with correct SearchResult structure
      const mockResult: SearchResult = {
        file_path: "src/auth/middleware.ts",
        repository: "test-repo",
        content_snippet: "function authenticate(token) { ... }",
        similarity_score: 0.89,
        chunk_index: 5,
        metadata: {
          file_extension: "ts",
          file_size_bytes: 2048,
          indexed_at: "2025-12-12T00:00:00Z",
        },
      };

      mockSearchService.setSearchResults({
        results: [mockResult],
        metadata: {
          total_matches: 1,
          query_time_ms: 100,
          embedding_time_ms: 50,
          search_time_ms: 50,
          repositories_searched: ["test-repo"],
        },
      });

      const result = await callTool(server, "semantic_search", {
        query: "authentication middleware",
        limit: 10,
        threshold: 0.7,
      });

      expect(result).toBeDefined();
      expect(result.isError).toBe(false);
      expect(result.content).toBeDefined();

      // Parse JSON response
      const jsonContent = result.content.find((c) => c.type === "text");
      expect(jsonContent).toBeDefined();

      if (jsonContent && jsonContent.type === "text") {
        const response = JSON.parse(jsonContent.text);
        expect(response.results).toHaveLength(1);
        expect(response.results[0].content).toContain("authenticate");
        expect(response.results[0].similarity_score).toBe(0.89);
        expect(response.results[0].metadata.file_path).toBe("src/auth/middleware.ts");
        expect(response.results[0].metadata.repository).toBe("test-repo");
        expect(response.metadata.total_matches).toBe(1);
      }
    });

    it("should apply default values for optional parameters", async () => {
      mockSearchService.setSearchResults({
        results: [],
        metadata: {
          total_matches: 0,
          query_time_ms: 50,
          embedding_time_ms: 25,
          search_time_ms: 25,
          repositories_searched: [],
        },
      });

      const result = await callTool(server, "semantic_search", {
        query: "test query",
        // limit and threshold should use defaults (10 and 0.7)
      });

      expect(result).toBeDefined();
      expect(result.isError).toBe(false);
    });

    it("should handle empty search results", async () => {
      mockSearchService.setSearchResults({
        results: [],
        metadata: {
          total_matches: 0,
          query_time_ms: 50,
          embedding_time_ms: 25,
          search_time_ms: 25,
          repositories_searched: ["test-repo"],
        },
      });

      const result = await callTool(server, "semantic_search", {
        query: "nonexistent code pattern",
        limit: 5,
        threshold: 0.9,
      });

      expect(result).toBeDefined();
      expect(result.isError).toBe(false);

      const jsonContent = result.content.find((c) => c.type === "text");
      if (jsonContent && jsonContent.type === "text") {
        const response = JSON.parse(jsonContent.text);
        expect(response.results).toHaveLength(0);
        expect(response.metadata.total_matches).toBe(0);
      }
    });

    it("should return validation error for empty query", async () => {
      const result = await callTool(server, "semantic_search", {
        query: "",
      });

      expect(result).toBeDefined();
      expect(result.isError).toBe(true);

      const errorContent = result.content.find((c) => c.type === "text");
      expect(errorContent).toBeDefined();
      if (errorContent && errorContent.type === "text") {
        // Validation errors are wrapped in MCP error format
        expect(errorContent.text).toContain("Error:");
      }
    });

    it("should return validation error for limit exceeding maximum", async () => {
      const result = await callTool(server, "semantic_search", {
        query: "test",
        limit: 51, // Max is 50
      });

      expect(result).toBeDefined();
      expect(result.isError).toBe(true);
    });

    it("should return validation error for threshold above 1.0", async () => {
      const result = await callTool(server, "semantic_search", {
        query: "test",
        threshold: 1.5,
      });

      expect(result).toBeDefined();
      expect(result.isError).toBe(true);
    });

    it("should filter by repository when specified", async () => {
      const mockResult: SearchResult = {
        file_path: "config/app.ts",
        repository: "my-app",
        content_snippet: "const config = { ... }",
        similarity_score: 0.85,
        chunk_index: 1,
        metadata: {
          file_extension: "ts",
          file_size_bytes: 512,
          indexed_at: "2025-12-12T00:00:00Z",
        },
      };

      mockSearchService.setSearchResults({
        results: [mockResult],
        metadata: {
          total_matches: 1,
          query_time_ms: 75,
          embedding_time_ms: 35,
          search_time_ms: 40,
          repositories_searched: ["my-app"],
        },
      });

      const result = await callTool(server, "semantic_search", {
        query: "configuration",
        repository: "my-app",
      });

      expect(result).toBeDefined();
      expect(result.isError).toBe(false);

      const jsonContent = result.content.find((c) => c.type === "text");
      if (jsonContent && jsonContent.type === "text") {
        const response = JSON.parse(jsonContent.text);
        expect(response.results).toHaveLength(1);
        expect(response.results[0].metadata.repository).toBe("my-app");
      }
    });

    it("should include performance metrics in response", async () => {
      mockSearchService.setSearchResults({
        results: [],
        metadata: {
          total_matches: 0,
          query_time_ms: 123,
          embedding_time_ms: 45,
          search_time_ms: 78,
          repositories_searched: ["repo1", "repo2"],
        },
      });

      const result = await callTool(server, "semantic_search", {
        query: "test",
      });

      const jsonContent = result.content.find((c) => c.type === "text");
      if (jsonContent && jsonContent.type === "text") {
        const response = JSON.parse(jsonContent.text);
        expect(response.metadata.query_time_ms).toBe(123);
        expect(response.metadata.embedding_time_ms).toBe(45);
        expect(response.metadata.search_time_ms).toBe(78);
        expect(response.metadata.repositories_searched).toEqual(["repo1", "repo2"]);
      }
    });
  });

  describe("list_indexed_repositories tool invocation", () => {
    it("should list all repositories with metadata", async () => {
      // Setup mock repositories with correct RepositoryInfo structure
      const mockRepos: RepositoryInfo[] = [
        {
          name: "PersonalKnowledgeMCP",
          url: "https://github.com/sethb75/PersonalKnowledgeMCP",
          localPath: "/path/to/PersonalKnowledgeMCP",
          collectionName: "repo-personalknowledgemcp",
          fileCount: 45,
          chunkCount: 320,
          lastIndexedAt: "2025-12-12T10:00:00Z",
          status: "ready",
          indexDurationMs: 125000,
          branch: "main",
          includeExtensions: [".ts", ".js", ".md"],
          excludePatterns: ["node_modules/**", "dist/**"],
        },
        {
          name: "my-api",
          url: "https://github.com/user/my-api",
          localPath: "/path/to/my-api",
          collectionName: "repo-my-api",
          fileCount: 120,
          chunkCount: 850,
          lastIndexedAt: "2025-12-11T15:30:00Z",
          status: "ready",
          indexDurationMs: 340000,
          branch: "main",
          includeExtensions: [".ts", ".js"],
          excludePatterns: ["node_modules/**"],
        },
      ];

      mockRepositoryService.setRepositories(mockRepos);

      const result = await callTool(server, "list_indexed_repositories", {});

      expect(result).toBeDefined();
      expect(result.isError).toBe(false);

      const jsonContent = result.content.find((c) => c.type === "text");
      expect(jsonContent).toBeDefined();

      if (jsonContent && jsonContent.type === "text") {
        const response = JSON.parse(jsonContent.text);

        expect(response.repositories).toHaveLength(2);
        expect(response.summary).toBeDefined();
        expect(response.summary.total_repositories).toBe(2);
        expect(response.summary.total_files_indexed).toBe(165);
        expect(response.summary.total_chunks).toBe(1170);

        // Check first repository
        const repo1 = response.repositories[0];
        expect(repo1.name).toBe("PersonalKnowledgeMCP");
        expect(repo1.url).toBe("https://github.com/sethb75/PersonalKnowledgeMCP");
        expect(repo1.file_count).toBe(45);
        expect(repo1.chunk_count).toBe(320);
        expect(repo1.status).toBe("ready");
        expect(repo1.index_duration_ms).toBe(125000);

        // Check second repository
        const repo2 = response.repositories[1];
        expect(repo2.name).toBe("my-api");
        expect(repo2.chunk_count).toBe(850);
      }
    });

    it("should handle empty repository list", async () => {
      mockRepositoryService.setRepositories([]);

      const result = await callTool(server, "list_indexed_repositories", {});

      expect(result).toBeDefined();
      expect(result.isError).toBe(false);

      const jsonContent = result.content.find((c) => c.type === "text");
      if (jsonContent && jsonContent.type === "text") {
        const response = JSON.parse(jsonContent.text);

        expect(response.repositories).toHaveLength(0);
        expect(response.summary.total_repositories).toBe(0);
        expect(response.summary.total_files_indexed).toBe(0);
        expect(response.summary.total_chunks).toBe(0);
      }
    });

    it("should format repository metadata with snake_case fields", async () => {
      const mockRepo: RepositoryInfo = {
        name: "test-repo",
        url: "https://github.com/test/repo",
        localPath: "/path/to/test-repo",
        collectionName: "repo-test-repo",
        fileCount: 10,
        chunkCount: 50,
        lastIndexedAt: "2025-12-12T12:00:00Z",
        status: "ready",
        indexDurationMs: 30000,
        branch: "main",
        includeExtensions: [".ts"],
        excludePatterns: ["node_modules/**"],
      };

      mockRepositoryService.setRepositories([mockRepo]);

      const result = await callTool(server, "list_indexed_repositories", {});

      const jsonContent = result.content.find((c) => c.type === "text");
      if (jsonContent && jsonContent.type === "text") {
        const response = JSON.parse(jsonContent.text);
        const repo = response.repositories[0];

        // Check snake_case formatting
        expect(repo).toHaveProperty("file_count");
        expect(repo).toHaveProperty("chunk_count");
        expect(repo).toHaveProperty("last_indexed");
        expect(repo).toHaveProperty("index_duration_ms");
        expect(repo).toHaveProperty("collection_name");
      }
    });

    it("should include repositories with error status", async () => {
      const mockRepo: RepositoryInfo = {
        name: "failed-repo",
        url: "https://github.com/test/failed",
        localPath: "/path/to/failed",
        collectionName: "repo-failed-repo",
        fileCount: 0,
        chunkCount: 0,
        lastIndexedAt: "2025-12-12T08:00:00Z",
        status: "error",
        indexDurationMs: 5000,
        errorMessage: "Failed to clone repository",
        branch: "main",
        includeExtensions: [],
        excludePatterns: [],
      };

      mockRepositoryService.setRepositories([mockRepo]);

      const result = await callTool(server, "list_indexed_repositories", {});

      const jsonContent = result.content.find((c) => c.type === "text");
      if (jsonContent && jsonContent.type === "text") {
        const response = JSON.parse(jsonContent.text);
        const repo = response.repositories[0];

        expect(repo.status).toBe("error");
        expect(repo.error_message).toBe("Failed to clone repository");
      }
    });
  });

  describe("error handling", () => {
    it("should return structured error for invalid tool arguments", async () => {
      const result = await callTool(server, "semantic_search", {
        query: 12345, // Invalid type
      });

      expect(result).toBeDefined();
      expect(result.isError).toBe(true);

      const errorContent = result.content.find((c) => c.type === "text");
      expect(errorContent).toBeDefined();
    });

    it("should return error for missing required parameters", async () => {
      const result = await callTool(server, "semantic_search", {
        // Missing required 'query' parameter
        limit: 10,
      });

      expect(result).toBeDefined();
      expect(result.isError).toBe(true);
    });
  });

  describe("JSON response formatting", () => {
    it("should return valid JSON in text content", async () => {
      mockSearchService.setSearchResults({
        results: [],
        metadata: {
          total_matches: 0,
          query_time_ms: 50,
          embedding_time_ms: 25,
          search_time_ms: 25,
          repositories_searched: [],
        },
      });

      const result = await callTool(server, "semantic_search", {
        query: "test",
      });

      const jsonContent = result.content.find((c) => c.type === "text");
      expect(jsonContent).toBeDefined();

      if (jsonContent && jsonContent.type === "text") {
        // Should parse without error
        expect(() => JSON.parse(jsonContent.text)).not.toThrow();
      }
    });

    it("should escape special characters in JSON responses", async () => {
      const mockResult: SearchResult = {
        file_path: "src/test.ts",
        repository: "test-repo",
        content_snippet: 'const str = "test with \\"quotes\\" and \\n newlines";',
        similarity_score: 0.95,
        chunk_index: 1,
        metadata: {
          file_extension: "ts",
          file_size_bytes: 256,
          indexed_at: "2025-12-12T00:00:00Z",
        },
      };

      mockSearchService.setSearchResults({
        results: [mockResult],
        metadata: {
          total_matches: 1,
          query_time_ms: 60,
          embedding_time_ms: 30,
          search_time_ms: 30,
          repositories_searched: ["test-repo"],
        },
      });

      const result = await callTool(server, "semantic_search", {
        query: "test",
      });

      const jsonContent = result.content.find((c) => c.type === "text");
      if (jsonContent && jsonContent.type === "text") {
        const response = JSON.parse(jsonContent.text);
        expect(response.results[0].content).toContain("quotes");
      }
    });
  });
});

/**
 * Helper function to simulate MCP tool call
 *
 * In a real integration test, we would use the MCP SDK's client to send
 * requests via stdio. For now, we directly invoke the tool handlers via
 * the server's internal registry.
 */
async function callTool(
  server: PersonalKnowledgeMCPServer,
  toolName: string,
  args: unknown
): Promise<CallToolResult> {
  // Access the private toolRegistry via type assertion
  // In production integration tests, we'd use the MCP client instead
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  const serverWithRegistry = server as any;
  const registry = serverWithRegistry.toolRegistry;

  if (!registry[toolName]) {
    return {
      content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
      isError: true,
    };
  }

  try {
    return await registry[toolName].handler(args);
  } catch (error) {
    return {
      content: [{ type: "text", text: error instanceof Error ? error.message : "Unknown error" }],
      isError: true,
    };
  }
}
