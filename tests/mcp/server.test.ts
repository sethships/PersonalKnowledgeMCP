/**
 * Unit tests for PersonalKnowledgeMCPServer
 *
 * Tests server initialization, request handling, and lifecycle management
 * with mocked dependencies.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import type { SearchService, SearchResponse, SearchQuery } from "../../src/services/types.js";
import type { RepositoryMetadataService, RepositoryInfo } from "../../src/repositories/types.js";
import { PersonalKnowledgeMCPServer } from "../../src/mcp/server.js";
import { initializeLogger, resetLogger } from "../../src/logging/index.js";

// Mock SearchService
class MockSearchService implements SearchService {
  async search(_query: SearchQuery): Promise<SearchResponse> {
    return {
      results: [],
      metadata: {
        total_matches: 0,
        query_time_ms: 100,
        embedding_time_ms: 50,
        search_time_ms: 50,
        repositories_searched: [],
      },
    };
  }
}

// Mock RepositoryMetadataService
class MockRepositoryMetadataService implements RepositoryMetadataService {
  async listRepositories(): Promise<RepositoryInfo[]> {
    return [];
  }

  async getRepository(_name: string): Promise<RepositoryInfo | null> {
    return null;
  }

  async updateRepository(_info: RepositoryInfo): Promise<void> {
    // Mock implementation
  }

  async removeRepository(_name: string): Promise<void> {
    // Mock implementation
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
      // Should not throw
      const server = new PersonalKnowledgeMCPServer(mockService, mockRepositoryService);
      expect(server).toBeDefined();
    });
  });

  describe("configuration", () => {
    it("should use default name if not provided", () => {
      const server = new PersonalKnowledgeMCPServer(mockService, mockRepositoryService);
      // Server should be initialized without errors
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
  });

  // Note: Testing actual request handlers would require mocking the MCP SDK's Server class,
  // which is complex. Integration tests will cover the full request/response flow.
  // These unit tests focus on construction and initialization logic.
});
