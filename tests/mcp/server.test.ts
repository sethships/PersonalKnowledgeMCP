/**
 * Unit tests for PersonalKnowledgeMCPServer
 *
 * Tests server initialization, request handling, and lifecycle management
 * with mocked dependencies.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import type {
  SearchService,
  SearchResponse,
  SearchQuery,
  SearchResult,
} from "../../src/services/types.js";
import type { RepositoryMetadataService, RepositoryInfo } from "../../src/repositories/types.js";
import { PersonalKnowledgeMCPServer } from "../../src/mcp/server.js";
import { initializeLogger, resetLogger } from "../../src/logging/index.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * Type definition for list_indexed_repositories response.
 * Used for type-safe JSON parsing in tests.
 */
interface ListRepositoriesResponse {
  repositories: Array<{ name: string; [key: string]: unknown }>;
}

/**
 * Type guard to validate list_indexed_repositories response structure.
 */
function isListRepositoriesResponse(value: unknown): value is ListRepositoriesResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  if (!("repositories" in value)) {
    return false;
  }
  const repos = (value as { repositories: unknown }).repositories;
  if (!Array.isArray(repos)) {
    return false;
  }
  return true;
}

// Mock SearchService with configurable behavior
class MockSearchService implements SearchService {
  private searchResults: SearchResponse = {
    results: [],
    metadata: {
      total_matches: 0,
      query_time_ms: 100,
      embedding_time_ms: 50,
      search_time_ms: 50,
      repositories_searched: [],
    },
  };

  private shouldThrow = false;
  private errorMessage = "Search service error";

  setSearchResults(results: SearchResponse): void {
    this.searchResults = results;
  }

  setShouldThrow(shouldThrow: boolean, message?: string): void {
    this.shouldThrow = shouldThrow;
    if (message) this.errorMessage = message;
  }

  async search(_query: SearchQuery): Promise<SearchResponse> {
    if (this.shouldThrow) {
      throw new Error(this.errorMessage);
    }
    return this.searchResults;
  }
}

// Mock RepositoryMetadataService with configurable behavior
class MockRepositoryMetadataService implements RepositoryMetadataService {
  private repositories: RepositoryInfo[] = [];
  private shouldThrow = false;
  private errorMessage = "Repository service error";

  setRepositories(repos: RepositoryInfo[]): void {
    this.repositories = repos;
  }

  setShouldThrow(shouldThrow: boolean, message?: string): void {
    this.shouldThrow = shouldThrow;
    if (message) this.errorMessage = message;
  }

  async listRepositories(): Promise<RepositoryInfo[]> {
    if (this.shouldThrow) {
      throw new Error(this.errorMessage);
    }
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

/**
 * Type definition for accessing internal tool registry during testing.
 */
interface ToolHandler {
  handler: (args: unknown) => Promise<CallToolResult>;
}

interface ServerWithToolRegistry {
  toolRegistry: Record<string, ToolHandler>;
}

/**
 * Type guard to safely access the server's internal tool registry.
 * Uses type assertion to access private property for testing purposes.
 */
function getToolRegistry(server: PersonalKnowledgeMCPServer): Record<string, ToolHandler> | null {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
  const serverObj = server as unknown as ServerWithToolRegistry;
  if (serverObj.toolRegistry && typeof serverObj.toolRegistry === "object") {
    return serverObj.toolRegistry;
  }
  return null;
}

/**
 * Helper function to call a tool via the server's tool registry
 */
async function callTool(
  server: PersonalKnowledgeMCPServer,
  toolName: string,
  args: unknown
): Promise<CallToolResult> {
  const registry = getToolRegistry(server);

  if (!registry) {
    return {
      content: [{ type: "text", text: "Failed to access tool registry" }],
      isError: true,
    };
  }

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

describe("PersonalKnowledgeMCPServer", () => {
  let mockService: MockSearchService;
  let mockRepositoryService: MockRepositoryMetadataService;

  beforeEach(() => {
    initializeLogger({ level: "silent", format: "json" });
    mockService = new MockSearchService();
    mockRepositoryService = new MockRepositoryMetadataService();
  });

  afterEach(() => {
    resetLogger();
  });

  describe("initialization", () => {
    it("should create server with default config", () => {
      const server = new PersonalKnowledgeMCPServer(mockService, mockRepositoryService);
      expect(server).toBeDefined();
    });

    it("should create server with custom config", () => {
      const server = new PersonalKnowledgeMCPServer(mockService, mockRepositoryService, {
        name: "custom-server",
        version: "2.0.0",
        capabilities: { tools: true },
      });
      expect(server).toBeDefined();
    });

    it("should initialize with SearchService and RepositoryMetadataService dependencies", () => {
      const server = new PersonalKnowledgeMCPServer(mockService, mockRepositoryService);
      expect(server).toBeDefined();
    });

    it("should register tool handlers on initialization", () => {
      const server = new PersonalKnowledgeMCPServer(mockService, mockRepositoryService);
      const registry = getToolRegistry(server);

      expect(registry).toBeDefined();
      expect(registry).not.toBeNull();
      expect(registry?.["semantic_search"]).toBeDefined();
      expect(registry?.["list_indexed_repositories"]).toBeDefined();
    });
  });

  describe("configuration", () => {
    it("should use default name if not provided", () => {
      const server = new PersonalKnowledgeMCPServer(mockService, mockRepositoryService);
      expect(server).toBeDefined();
    });

    it("should accept custom server name", () => {
      const server = new PersonalKnowledgeMCPServer(mockService, mockRepositoryService, {
        name: "test-mcp-server",
        version: "1.0.0",
        capabilities: { tools: true },
      });
      expect(server).toBeDefined();
    });

    it("should accept custom version", () => {
      const server = new PersonalKnowledgeMCPServer(mockService, mockRepositoryService, {
        name: "test-server",
        version: "3.0.0",
        capabilities: { tools: true },
      });
      expect(server).toBeDefined();
    });

    it("should accept config with resources capability", () => {
      const server = new PersonalKnowledgeMCPServer(mockService, mockRepositoryService, {
        name: "resource-server",
        version: "1.0.0",
        capabilities: { tools: true, resources: true },
      });
      expect(server).toBeDefined();
    });

    it("should accept config with prompts capability", () => {
      const server = new PersonalKnowledgeMCPServer(mockService, mockRepositoryService, {
        name: "prompt-server",
        version: "1.0.0",
        capabilities: { tools: true, prompts: true },
      });
      expect(server).toBeDefined();
    });

    it("should throw when tools capability is disabled", () => {
      // MCP SDK requires tools capability to register tool handlers
      expect(() => {
        new PersonalKnowledgeMCPServer(mockService, mockRepositoryService, {
          name: "no-tools-server",
          version: "1.0.0",
          capabilities: { tools: false },
        });
      }).toThrow();
    });
  });

  describe("tool registry", () => {
    it("should have semantic_search tool registered", () => {
      const server = new PersonalKnowledgeMCPServer(mockService, mockRepositoryService);
      const registry = getToolRegistry(server);

      expect(registry).not.toBeNull();
      expect(registry?.["semantic_search"]).toBeDefined();
      expect(typeof registry?.["semantic_search"]?.handler).toBe("function");
    });

    it("should have list_indexed_repositories tool registered", () => {
      const server = new PersonalKnowledgeMCPServer(mockService, mockRepositoryService);
      const registry = getToolRegistry(server);

      expect(registry).not.toBeNull();
      expect(registry?.["list_indexed_repositories"]).toBeDefined();
      expect(typeof registry?.["list_indexed_repositories"]?.handler).toBe("function");
    });
  });

  describe("semantic_search tool handler", () => {
    it("should execute search with valid query", async () => {
      const mockResult: SearchResult = {
        file_path: "src/utils.ts",
        repository: "test-repo",
        content_snippet: "function helper() { ... }",
        similarity_score: 0.85,
        chunk_index: 1,
        metadata: {
          file_extension: "ts",
          file_size_bytes: 1024,
          indexed_at: "2025-12-12T00:00:00Z",
        },
      };

      mockService.setSearchResults({
        results: [mockResult],
        metadata: {
          total_matches: 1,
          query_time_ms: 100,
          embedding_time_ms: 50,
          search_time_ms: 50,
          repositories_searched: ["test-repo"],
        },
      });

      const server = new PersonalKnowledgeMCPServer(mockService, mockRepositoryService);
      const result = await callTool(server, "semantic_search", {
        query: "helper function",
        limit: 10,
        threshold: 0.7,
      });

      expect(result).toBeDefined();
      expect(result.isError).toBe(false);
      expect(result.content).toBeDefined();
    });

    it("should return validation error for empty query", async () => {
      const server = new PersonalKnowledgeMCPServer(mockService, mockRepositoryService);
      const result = await callTool(server, "semantic_search", {
        query: "",
      });

      expect(result.isError).toBe(true);
    });

    it("should return validation error for missing query", async () => {
      const server = new PersonalKnowledgeMCPServer(mockService, mockRepositoryService);
      const result = await callTool(server, "semantic_search", {
        limit: 10,
      });

      expect(result.isError).toBe(true);
    });

    it("should apply default values for optional parameters", async () => {
      const server = new PersonalKnowledgeMCPServer(mockService, mockRepositoryService);
      const result = await callTool(server, "semantic_search", {
        query: "test query",
      });

      expect(result).toBeDefined();
      expect(result.isError).toBe(false);
    });

    it("should handle search service errors gracefully", async () => {
      mockService.setShouldThrow(true, "Connection failed");

      const server = new PersonalKnowledgeMCPServer(mockService, mockRepositoryService);
      const result = await callTool(server, "semantic_search", {
        query: "test",
      });

      expect(result.isError).toBe(true);
    });
  });

  describe("list_indexed_repositories tool handler", () => {
    it("should list repositories with metadata", async () => {
      const mockRepos: RepositoryInfo[] = [
        {
          name: "test-repo",
          url: "https://github.com/test/repo",
          localPath: "/path/to/repo",
          collectionName: "repo-test-repo",
          fileCount: 50,
          chunkCount: 250,
          lastIndexedAt: "2025-12-12T10:00:00Z",
          status: "ready",
          indexDurationMs: 60000,
          branch: "main",
          includeExtensions: [".ts", ".js"],
          excludePatterns: ["node_modules/**"],
        },
      ];

      mockRepositoryService.setRepositories(mockRepos);

      const server = new PersonalKnowledgeMCPServer(mockService, mockRepositoryService);
      const result = await callTool(server, "list_indexed_repositories", {});

      expect(result).toBeDefined();
      expect(result.isError).toBe(false);

      const jsonContent = result.content.find((c) => c.type === "text");
      expect(jsonContent).toBeDefined();
      if (jsonContent && jsonContent.type === "text") {
        const response: unknown = JSON.parse(jsonContent.text);
        expect(isListRepositoriesResponse(response)).toBe(true);
        if (isListRepositoriesResponse(response)) {
          expect(response.repositories).toHaveLength(1);
          const firstRepo = response.repositories[0];
          expect(firstRepo).toBeDefined();
          expect(firstRepo?.name).toBe("test-repo");
        }
      }
    });

    it("should handle empty repository list", async () => {
      mockRepositoryService.setRepositories([]);

      const server = new PersonalKnowledgeMCPServer(mockService, mockRepositoryService);
      const result = await callTool(server, "list_indexed_repositories", {});

      expect(result.isError).toBe(false);

      const jsonContent = result.content.find((c) => c.type === "text");
      if (jsonContent && jsonContent.type === "text") {
        const response: unknown = JSON.parse(jsonContent.text);
        expect(isListRepositoriesResponse(response)).toBe(true);
        if (isListRepositoriesResponse(response)) {
          expect(response.repositories).toHaveLength(0);
        }
      }
    });

    it("should handle repository service errors gracefully", async () => {
      mockRepositoryService.setShouldThrow(true, "Database error");

      const server = new PersonalKnowledgeMCPServer(mockService, mockRepositoryService);
      const result = await callTool(server, "list_indexed_repositories", {});

      expect(result.isError).toBe(true);
    });
  });

  describe("unknown tool handling", () => {
    it("should return error for unknown tool via registry", async () => {
      const server = new PersonalKnowledgeMCPServer(mockService, mockRepositoryService);
      const result = await callTool(server, "nonexistent_tool", {});

      expect(result.isError).toBe(true);
      const firstContent = result.content[0];
      expect(firstContent).toBeDefined();
      expect(firstContent?.type).toBe("text");
      if (firstContent && firstContent.type === "text") {
        expect(firstContent.text).toContain("Unknown tool");
      }
    });

    it("should return error for tool with special characters in name", async () => {
      const server = new PersonalKnowledgeMCPServer(mockService, mockRepositoryService);
      const result = await callTool(server, "tool/../../../etc/passwd", {});

      expect(result.isError).toBe(true);
    });
  });

  describe("multiple server instances", () => {
    it("should support multiple independent server instances", () => {
      const server1 = new PersonalKnowledgeMCPServer(mockService, mockRepositoryService, {
        name: "server-1",
        version: "1.0.0",
        capabilities: { tools: true },
      });

      const server2 = new PersonalKnowledgeMCPServer(mockService, mockRepositoryService, {
        name: "server-2",
        version: "2.0.0",
        capabilities: { tools: true },
      });

      expect(server1).toBeDefined();
      expect(server2).toBeDefined();

      const registry1 = getToolRegistry(server1);
      const registry2 = getToolRegistry(server2);

      expect(registry1).not.toBe(registry2);
    });
  });
});
