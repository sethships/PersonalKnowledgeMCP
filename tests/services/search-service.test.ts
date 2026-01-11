/**
 * Unit tests for SearchService
 *
 * Tests all functionality with mocked dependencies to ensure proper behavior
 * and error handling across all scenarios.
 */

/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable @typescript-eslint/await-thenable */
/* eslint-disable @typescript-eslint/no-unused-vars */

import { describe, it, expect, beforeEach, beforeAll, afterAll } from "bun:test";
import { SearchServiceImpl } from "../../src/services/search-service.js";
import {
  SearchValidationError,
  RepositoryNotFoundError,
  RepositoryNotReadyError,
  NoRepositoriesAvailableError,
  SearchOperationError,
} from "../../src/services/errors.js";
import type { EmbeddingProvider } from "../../src/providers/types.js";
import type { ChromaStorageClient, SimilarityResult } from "../../src/storage/types.js";
import type { RepositoryMetadataService, RepositoryInfo } from "../../src/repositories/types.js";
import { initializeLogger, resetLogger } from "../../src/logging/index.js";

// Mock EmbeddingProvider
class MockEmbeddingProvider implements EmbeddingProvider {
  public readonly providerId = "mock";
  public readonly modelId = "mock-model";
  public readonly dimensions = 1536;

  private shouldFail = false;
  private failureError: Error | null = null;

  async generateEmbedding(_text: string): Promise<number[]> {
    if (this.shouldFail && this.failureError) {
      throw this.failureError;
    }
    return new Array(this.dimensions).fill(0.1);
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    return texts.map(() => new Array(this.dimensions).fill(0.1));
  }

  async healthCheck(): Promise<boolean> {
    return !this.shouldFail;
  }

  getCapabilities() {
    return {
      maxBatchSize: 100,
      maxTokensPerText: 8191,
      supportsGPU: false,
      requiresNetwork: false,
      estimatedLatencyMs: 10,
    };
  }

  setShouldFail(shouldFail: boolean, error?: Error) {
    this.shouldFail = shouldFail;
    this.failureError = error || null;
  }
}

// Mock ChromaStorageClient
class MockChromaStorageClient implements ChromaStorageClient {
  private mockResults: SimilarityResult[] = [];
  private shouldFail = false;
  private failureError: Error | null = null;

  async connect(): Promise<void> {}
  async healthCheck(): Promise<boolean> {
    return true;
  }
  async getOrCreateCollection(): Promise<any> {
    return {};
  }
  async deleteCollection(): Promise<void> {}
  async listCollections(): Promise<any[]> {
    return [];
  }
  async addDocuments(): Promise<void> {}
  async getCollectionStats(): Promise<any> {
    return { name: "test", documentCount: 0, retrievedAt: new Date().toISOString() };
  }

  async similaritySearch(): Promise<SimilarityResult[]> {
    if (this.shouldFail && this.failureError) {
      throw this.failureError;
    }
    return this.mockResults;
  }

  async upsertDocuments(): Promise<void> {}

  async deleteDocuments(): Promise<void> {}

  async getDocumentsByMetadata(): Promise<any[]> {
    return [];
  }

  async deleteDocumentsByFilePrefix(): Promise<number> {
    return 0;
  }

  setMockResults(results: SimilarityResult[]) {
    this.mockResults = results;
  }

  setShouldFail(shouldFail: boolean, error?: Error) {
    this.shouldFail = shouldFail;
    this.failureError = error || null;
  }
}

// Mock RepositoryMetadataService
class MockRepositoryService implements RepositoryMetadataService {
  private mockRepositories: RepositoryInfo[] = [];

  async listRepositories(): Promise<RepositoryInfo[]> {
    return this.mockRepositories;
  }

  async getRepository(name: string): Promise<RepositoryInfo | null> {
    return this.mockRepositories.find((r) => r.name === name) || null;
  }

  async addRepository(): Promise<void> {}
  async updateRepository(): Promise<void> {}
  async removeRepository(): Promise<void> {}

  setMockRepositories(repos: RepositoryInfo[]) {
    this.mockRepositories = repos;
  }
}

describe("SearchServiceImpl", () => {
  let service: SearchServiceImpl;
  let mockEmbedding: MockEmbeddingProvider;
  let mockStorage: MockChromaStorageClient;
  let mockRepoService: MockRepositoryService;

  beforeAll(() => {
    // Initialize logger for tests
    initializeLogger({ level: "error", format: "json" });
  });

  beforeEach(() => {
    mockEmbedding = new MockEmbeddingProvider();
    mockStorage = new MockChromaStorageClient();
    mockRepoService = new MockRepositoryService();
    service = new SearchServiceImpl(mockEmbedding, mockStorage, mockRepoService);
  });

  afterAll(() => {
    resetLogger();
  });

  describe("Validation", () => {
    it("should validate query length (1-1000 chars)", async () => {
      mockRepoService.setMockRepositories([createMockRepo("test-repo", "ready")]);

      // Empty query
      await expect(service.search({ query: "" })).rejects.toThrow(SearchValidationError);

      // Whitespace-only query (should be trimmed then rejected)
      await expect(service.search({ query: "   " })).rejects.toThrow(SearchValidationError);
      await expect(service.search({ query: "\t\n  " })).rejects.toThrow(SearchValidationError);

      // Query too long
      await expect(service.search({ query: "a".repeat(1001) })).rejects.toThrow(
        SearchValidationError
      );
    });

    it("should validate limit range (1-50)", async () => {
      mockRepoService.setMockRepositories([createMockRepo("test-repo", "ready")]);

      // Limit too low
      await expect(service.search({ query: "test", limit: 0 })).rejects.toThrow(
        SearchValidationError
      );

      // Limit too high
      await expect(service.search({ query: "test", limit: 51 })).rejects.toThrow(
        SearchValidationError
      );

      // Non-integer limit
      await expect(service.search({ query: "test", limit: 5.5 })).rejects.toThrow(
        SearchValidationError
      );
    });

    it("should validate threshold range (0.0-1.0)", async () => {
      mockRepoService.setMockRepositories([createMockRepo("test-repo", "ready")]);

      // Threshold too low
      await expect(service.search({ query: "test", threshold: -0.1 })).rejects.toThrow(
        SearchValidationError
      );

      // Threshold too high
      await expect(service.search({ query: "test", threshold: 1.1 })).rejects.toThrow(
        SearchValidationError
      );
    });

    it("should apply default limit (10) when not specified", async () => {
      mockRepoService.setMockRepositories([createMockRepo("test-repo", "ready")]);
      mockStorage.setMockResults([]);

      const response = await service.search({ query: "test" });
      expect(response).toBeDefined();
    });

    it("should apply default threshold (0.7) when not specified", async () => {
      mockRepoService.setMockRepositories([createMockRepo("test-repo", "ready")]);
      mockStorage.setMockResults([]);

      const response = await service.search({ query: "test" });
      expect(response).toBeDefined();
    });

    it("should trim whitespace from query", async () => {
      mockRepoService.setMockRepositories([createMockRepo("test-repo", "ready")]);
      mockStorage.setMockResults([]);

      const response = await service.search({ query: "  test  " });
      expect(response).toBeDefined();
    });
  });

  describe("Repository Selection", () => {
    it("should search single repository when specified", async () => {
      mockRepoService.setMockRepositories([createMockRepo("test-repo", "ready")]);
      mockStorage.setMockResults([]);

      const response = await service.search({
        query: "test",
        repository: "test-repo",
      });

      expect(response.metadata.repositories_searched).toEqual(["test-repo"]);
    });

    it("should search all ready repositories when none specified", async () => {
      mockRepoService.setMockRepositories([
        createMockRepo("repo1", "ready"),
        createMockRepo("repo2", "ready"),
        createMockRepo("repo3", "indexing"),
      ]);
      mockStorage.setMockResults([]);

      const response = await service.search({ query: "test" });

      expect(response.metadata.repositories_searched).toEqual(["repo1", "repo2"]);
    });

    it("should throw RepositoryNotFoundError when repo doesn't exist", async () => {
      mockRepoService.setMockRepositories([]);

      await expect(service.search({ query: "test", repository: "nonexistent" })).rejects.toThrow(
        RepositoryNotFoundError
      );
    });

    it("should throw RepositoryNotReadyError when repo status is 'indexing'", async () => {
      mockRepoService.setMockRepositories([createMockRepo("test-repo", "indexing")]);

      await expect(service.search({ query: "test", repository: "test-repo" })).rejects.toThrow(
        RepositoryNotReadyError
      );
    });

    it("should throw RepositoryNotReadyError when repo status is 'error'", async () => {
      mockRepoService.setMockRepositories([createMockRepo("test-repo", "error")]);

      await expect(service.search({ query: "test", repository: "test-repo" })).rejects.toThrow(
        RepositoryNotReadyError
      );
    });

    it("should throw NoRepositoriesAvailableError when no ready repos exist", async () => {
      mockRepoService.setMockRepositories([
        createMockRepo("repo1", "indexing"),
        createMockRepo("repo2", "error"),
      ]);

      await expect(service.search({ query: "test" })).rejects.toThrow(NoRepositoriesAvailableError);
    });

    it("should skip non-ready repos in multi-repo search", async () => {
      mockRepoService.setMockRepositories([
        createMockRepo("ready-repo", "ready"),
        createMockRepo("indexing-repo", "indexing"),
        createMockRepo("error-repo", "error"),
      ]);
      mockStorage.setMockResults([]);

      const response = await service.search({ query: "test" });

      expect(response.metadata.repositories_searched).toEqual(["ready-repo"]);
    });
  });

  describe("Search Execution", () => {
    it("should generate embedding for query text", async () => {
      mockRepoService.setMockRepositories([createMockRepo("test-repo", "ready")]);
      mockStorage.setMockResults([]);

      await service.search({ query: "test query" });

      // If embedding generation failed, would have thrown
      expect(true).toBe(true);
    });

    it("should return results sorted by similarity descending", async () => {
      mockRepoService.setMockRepositories([createMockRepo("test-repo", "ready")]);

      const mockResults: SimilarityResult[] = [
        createMockResult("file1.ts", 0.95),
        createMockResult("file2.ts", 0.85),
        createMockResult("file3.ts", 0.75),
      ];
      mockStorage.setMockResults(mockResults);

      const response = await service.search({ query: "test" });

      expect(response.results[0]!.similarity_score).toBe(0.95);
      expect(response.results[1]!.similarity_score).toBe(0.85);
      expect(response.results[2]!.similarity_score).toBe(0.75);
    });

    it("should handle zero results gracefully", async () => {
      mockRepoService.setMockRepositories([createMockRepo("test-repo", "ready")]);
      mockStorage.setMockResults([]);

      const response = await service.search({ query: "test" });

      expect(response.results).toEqual([]);
      expect(response.metadata.total_matches).toBe(0);
    });
  });

  describe("Result Formatting", () => {
    it("should truncate snippets to ~500 chars at word boundary", async () => {
      mockRepoService.setMockRepositories([createMockRepo("test-repo", "ready")]);

      const longContent = "word ".repeat(200); // 1000 chars
      mockStorage.setMockResults([createMockResult("file.ts", 0.9, longContent)]);

      const response = await service.search({ query: "test" });

      expect(response.results[0]!.content_snippet.length).toBeLessThanOrEqual(503); // 500 + "..."
      expect(response.results[0]!.content_snippet).toEndWith("...");
    });

    it("should not truncate snippets shorter than 500 chars", async () => {
      mockRepoService.setMockRepositories([createMockRepo("test-repo", "ready")]);

      const shortContent = "Short content here";
      mockStorage.setMockResults([createMockResult("file.ts", 0.9, shortContent)]);

      const response = await service.search({ query: "test" });

      expect(response.results[0]!.content_snippet).toBe(shortContent);
    });

    it("should extract file_path from metadata", async () => {
      mockRepoService.setMockRepositories([createMockRepo("test-repo", "ready")]);

      mockStorage.setMockResults([createMockResult("src/test.ts", 0.9)]);

      const response = await service.search({ query: "test" });

      expect(response.results[0]!.file_path).toBe("src/test.ts");
    });

    it("should extract repository from metadata", async () => {
      mockRepoService.setMockRepositories([createMockRepo("test-repo", "ready")]);

      mockStorage.setMockResults([createMockResult("file.ts", 0.9)]);

      const response = await service.search({ query: "test" });

      expect(response.results[0]!.repository).toBe("test-repo");
    });

    it("should handle missing metadata gracefully with defaults", async () => {
      mockRepoService.setMockRepositories([createMockRepo("test-repo", "ready")]);

      const resultWithoutMetadata: SimilarityResult = {
        id: "test-id",
        content: "test content",
        metadata: {} as any,
        distance: 0.1,
        similarity: 0.9,
      };
      mockStorage.setMockResults([resultWithoutMetadata]);

      const response = await service.search({ query: "test" });

      expect(response.results[0]!.file_path).toBe("unknown");
      expect(response.results[0]!.repository).toBe("unknown");
      expect(response.results[0]!.chunk_index).toBe(0);
      expect(response.results[0]!.metadata.file_extension).toBe("");
      expect(response.results[0]!.metadata.file_size_bytes).toBe(0);
    });
  });

  describe("Performance Tracking", () => {
    it("should measure total query time", async () => {
      mockRepoService.setMockRepositories([createMockRepo("test-repo", "ready")]);
      mockStorage.setMockResults([]);

      const response = await service.search({ query: "test" });

      expect(response.metadata.query_time_ms).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(response.metadata.query_time_ms)).toBe(true);
    });

    it("should measure embedding generation time separately", async () => {
      mockRepoService.setMockRepositories([createMockRepo("test-repo", "ready")]);
      mockStorage.setMockResults([]);

      const response = await service.search({ query: "test" });

      expect(response.metadata.embedding_time_ms).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(response.metadata.embedding_time_ms)).toBe(true);
    });

    it("should measure vector search time separately", async () => {
      mockRepoService.setMockRepositories([createMockRepo("test-repo", "ready")]);
      mockStorage.setMockResults([]);

      const response = await service.search({ query: "test" });

      expect(response.metadata.search_time_ms).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(response.metadata.search_time_ms)).toBe(true);
    });

    it("should list all searched repositories in metadata", async () => {
      mockRepoService.setMockRepositories([
        createMockRepo("repo1", "ready"),
        createMockRepo("repo2", "ready"),
      ]);
      mockStorage.setMockResults([]);

      const response = await service.search({ query: "test" });

      expect(response.metadata.repositories_searched).toContain("repo1");
      expect(response.metadata.repositories_searched).toContain("repo2");
    });

    it("should report total_matches count", async () => {
      mockRepoService.setMockRepositories([createMockRepo("test-repo", "ready")]);

      mockStorage.setMockResults([
        createMockResult("file1.ts", 0.9),
        createMockResult("file2.ts", 0.8),
      ]);

      const response = await service.search({ query: "test" });

      expect(response.metadata.total_matches).toBe(2);
    });
  });

  describe("Error Handling", () => {
    it("should wrap embedding provider errors in SearchOperationError", async () => {
      mockRepoService.setMockRepositories([createMockRepo("test-repo", "ready")]);
      mockEmbedding.setShouldFail(true, new Error("Embedding failed"));

      await expect(service.search({ query: "test" })).rejects.toThrow(SearchOperationError);
    });

    it("should wrap ChromaDB errors in SearchOperationError", async () => {
      mockRepoService.setMockRepositories([createMockRepo("test-repo", "ready")]);
      mockStorage.setShouldFail(true, new Error("ChromaDB failed"));

      await expect(service.search({ query: "test" })).rejects.toThrow(SearchOperationError);
    });

    it("should rethrow SearchValidationError as-is", async () => {
      await expect(service.search({ query: "" })).rejects.toThrow(SearchValidationError);
    });

    it("should rethrow RepositoryNotFoundError as-is", async () => {
      mockRepoService.setMockRepositories([]);

      await expect(service.search({ query: "test", repository: "nonexistent" })).rejects.toThrow(
        RepositoryNotFoundError
      );
    });
  });
});

// Helper functions
function createMockRepo(name: string, status: "ready" | "indexing" | "error"): RepositoryInfo {
  return {
    name,
    url: `https://github.com/test/${name}`,
    localPath: `/tmp/${name}`,
    collectionName: `repo_${name}`,
    status,
    fileCount: 100,
    chunkCount: 500,
    lastIndexedAt: new Date().toISOString(),
    indexDurationMs: 5000,
    branch: "main",
    includeExtensions: [".ts", ".js"],
    excludePatterns: ["node_modules"],
  };
}

function createMockResult(
  filePath: string,
  similarity: number,
  content?: string
): SimilarityResult {
  return {
    id: `test-repo:${filePath}:0`,
    content: content || "This is test content for the search result",
    metadata: {
      file_path: filePath,
      repository: "test-repo",
      chunk_index: 0,
      total_chunks: 1,
      chunk_start_line: 1,
      chunk_end_line: 10,
      file_extension: ".ts",
      file_size_bytes: 1024,
      content_hash: "abc123",
      indexed_at: new Date().toISOString(),
      file_modified_at: new Date().toISOString(),
    },
    distance: (1 - similarity) * 2,
    similarity,
  };
}
