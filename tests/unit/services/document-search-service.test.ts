/**
 * Unit tests for DocumentSearchServiceImpl
 *
 * Tests service logic including query validation, document_types filtering,
 * folder filtering, result formatting, and error propagation with mocked
 * ChromaStorageClient and RepositoryMetadataService.
 */

/* eslint-disable @typescript-eslint/no-unsafe-return */
// Note: await-thenable disable needed for `await expect(...).rejects.toThrow()` patterns
// which return Promises but ESLint's type inference doesn't recognize this properly
/* eslint-disable @typescript-eslint/await-thenable */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import type {
  EmbeddingProvider,
  EmbeddingProviderConfig,
  ProviderCapabilities,
} from "../../../src/providers/types.js";
import type {
  ChromaStorageClient,
  SimilarityResult,
  SimilarityQuery,
  DocumentMetadata,
  CollectionInfo,
  CollectionStats,
  DocumentInput,
  DocumentQueryResult,
  MetadataFilter,
  ChromaCollection,
  CollectionEmbeddingMetadata,
  ParsedEmbeddingMetadata,
} from "../../../src/storage/types.js";
import type { RepositoryMetadataService, RepositoryInfo } from "../../../src/repositories/types.js";
import { DocumentSearchServiceImpl } from "../../../src/services/document-search-service.js";
import {
  SearchValidationError,
  NoRepositoriesAvailableError,
  SearchOperationError,
  ProviderUnavailableError,
} from "../../../src/services/errors.js";
import { initializeLogger, resetLogger } from "../../../src/logging/index.js";

/** Mock EmbeddingProvider */
class MockEmbeddingProvider implements EmbeddingProvider {
  readonly providerId = "mock";
  readonly modelId = "mock-model";
  readonly dimensions = 384;

  async generateEmbedding(_text: string): Promise<number[]> {
    return new Array(384).fill(0.1);
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    return texts.map(() => new Array(384).fill(0.1));
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  getCapabilities(): ProviderCapabilities {
    return {
      maxBatchSize: 100,
      maxTokensPerText: 8191,
      supportsGPU: false,
      requiresNetwork: false,
      estimatedLatencyMs: 10,
    };
  }
}

/** Mock EmbeddingProviderFactory */
class MockEmbeddingProviderFactory {
  /** Count of createProvider invocations for caching verification */
  createProviderCallCount = 0;

  /** When set, createProvider will throw this error */
  private errorToThrow: Error | null = null;

  createProvider(_config: EmbeddingProviderConfig): EmbeddingProvider {
    this.createProviderCallCount++;
    if (this.errorToThrow) {
      throw this.errorToThrow;
    }
    return new MockEmbeddingProvider();
  }

  /** Configure factory to throw on next createProvider call */
  setShouldThrow(error: Error): void {
    this.errorToThrow = error;
  }

  /** Reset the factory to default behavior */
  reset(): void {
    this.createProviderCallCount = 0;
    this.errorToThrow = null;
  }
}

/** Helper to create a mock RepositoryInfo */
function createMockRepo(overrides: Partial<RepositoryInfo> = {}): RepositoryInfo {
  return {
    name: "test-folder",
    url: "file:///docs",
    localPath: "/data/repos/test-folder",
    collectionName: "repo_test_folder",
    fileCount: 10,
    chunkCount: 50,
    lastIndexedAt: "2025-01-01T00:00:00Z",
    indexDurationMs: 3000,
    status: "ready",
    branch: "main",
    includeExtensions: [".pdf", ".docx", ".md", ".txt"],
    excludePatterns: [],
    ...overrides,
  };
}

/** Mock ChromaStorageClient */
class MockChromaStorageClient implements ChromaStorageClient {
  private mockResults: SimilarityResult[] = [];
  public lastQuery: SimilarityQuery | null = null;

  setMockResults(results: SimilarityResult[]): void {
    this.mockResults = results;
  }

  async similaritySearch(query: SimilarityQuery): Promise<SimilarityResult[]> {
    this.lastQuery = query;
    return this.mockResults;
  }

  // Stub implementations for interface compliance
  async connect(): Promise<void> {}
  async healthCheck(): Promise<boolean> {
    return true;
  }
  async getOrCreateCollection(
    _name: string,
    _embeddingMetadata?: CollectionEmbeddingMetadata
  ): Promise<ChromaCollection> {
    return {} as ChromaCollection;
  }
  async deleteCollection(_name: string): Promise<void> {}
  async listCollections(): Promise<CollectionInfo[]> {
    return [];
  }
  async addDocuments(_collectionName: string, _documents: DocumentInput[]): Promise<void> {}
  async getCollectionStats(_name: string): Promise<CollectionStats> {
    return { name: _name, documentCount: 0, retrievedAt: new Date().toISOString() };
  }
  async upsertDocuments(_collectionName: string, _documents: DocumentInput[]): Promise<void> {}
  async deleteDocuments(_collectionName: string, _ids: string[]): Promise<void> {}
  async getDocumentsByMetadata(
    _collectionName: string,
    _where: MetadataFilter,
    _includeEmbeddings?: boolean
  ): Promise<DocumentQueryResult[]> {
    return [];
  }
  async deleteDocumentsByFilePrefix(
    _collectionName: string,
    _repository: string,
    _filePath: string
  ): Promise<number> {
    return 0;
  }
  async getCollectionEmbeddingMetadata(_name: string): Promise<ParsedEmbeddingMetadata | null> {
    return null;
  }
}

/** Mock RepositoryMetadataService */
class MockRepositoryMetadataService implements RepositoryMetadataService {
  private repos: RepositoryInfo[] = [];

  setRepositories(repos: RepositoryInfo[]): void {
    this.repos = repos;
  }

  async listRepositories(): Promise<RepositoryInfo[]> {
    return this.repos;
  }

  async getRepository(name: string): Promise<RepositoryInfo | null> {
    return this.repos.find((r) => r.name === name) ?? null;
  }

  // Stub implementations for interface compliance
  async addRepository(_repo: RepositoryInfo): Promise<void> {}
  async updateRepository(_info: RepositoryInfo): Promise<void> {}
  async deleteRepository(_name: string): Promise<void> {}
  async removeRepository(_name: string): Promise<void> {}
}

/** Helper to create a SimilarityResult with document-specific metadata */
function createDocumentResult(
  overrides: Partial<{
    id: string;
    content: string;
    distance: number;
    similarity: number;
    file_path: string;
    repository: string;
    document_type: string;
    document_title: string;
    page_number: number;
    section_heading: string;
  }> = {}
): SimilarityResult {
  const meta: Record<string, unknown> = {
    file_path: overrides.file_path ?? "docs/test.pdf",
    repository: overrides.repository ?? "test-folder",
    chunk_index: 0,
    total_chunks: 1,
    chunk_start_line: 1,
    chunk_end_line: 10,
    file_extension: ".pdf",
    language: "unknown",
    file_size_bytes: 1024,
    content_hash: "abc123",
    indexed_at: "2025-01-01T00:00:00Z",
    file_modified_at: "2025-01-01T00:00:00Z",
    document_type: overrides.document_type ?? "pdf",
    document_title: overrides.document_title ?? "Test Document",
    page_number: overrides.page_number ?? 1,
    section_heading: overrides.section_heading ?? "Introduction",
  };

  return {
    id: overrides.id ?? "test-folder:docs/test.pdf:0",
    content: overrides.content ?? "Test document content for searching.",
    metadata: meta as unknown as DocumentMetadata,
    distance: overrides.distance ?? 0.1,
    similarity: overrides.similarity ?? 0.9,
  };
}

describe("DocumentSearchServiceImpl", () => {
  let mockProvider: MockEmbeddingProvider;
  let mockFactory: MockEmbeddingProviderFactory;
  let mockStorage: MockChromaStorageClient;
  let mockRepoService: MockRepositoryMetadataService;
  let service: DocumentSearchServiceImpl;

  beforeEach(() => {
    initializeLogger({ level: "silent", format: "json" });

    mockProvider = new MockEmbeddingProvider();
    mockFactory = new MockEmbeddingProviderFactory();
    mockStorage = new MockChromaStorageClient();
    mockRepoService = new MockRepositoryMetadataService();

    // Set up default repo
    mockRepoService.setRepositories([createMockRepo()]);

    service = new DocumentSearchServiceImpl(
      mockProvider,
      mockFactory,
      mockStorage,
      mockRepoService
    );
  });

  afterEach(() => {
    resetLogger();
  });

  describe("query validation", () => {
    it("should reject empty query", async () => {
      await expect(service.searchDocuments({ query: "" })).rejects.toThrow(SearchValidationError);
    });

    it("should reject query exceeding 1000 characters", async () => {
      const longQuery = "a".repeat(1001);
      await expect(service.searchDocuments({ query: longQuery })).rejects.toThrow(
        SearchValidationError
      );
    });

    it("should reject invalid limit", async () => {
      await expect(service.searchDocuments({ query: "test", limit: 100 })).rejects.toThrow(
        SearchValidationError
      );
    });

    it("should reject negative limit", async () => {
      await expect(service.searchDocuments({ query: "test", limit: -1 })).rejects.toThrow(
        SearchValidationError
      );
    });

    it("should reject threshold out of range", async () => {
      await expect(service.searchDocuments({ query: "test", threshold: 1.5 })).rejects.toThrow(
        SearchValidationError
      );
    });

    it("should accept valid query with defaults", async () => {
      mockStorage.setMockResults([]);
      const response = await service.searchDocuments({ query: "valid query" });
      expect(response.results).toHaveLength(0);
    });
  });

  describe("repository/folder filtering", () => {
    it("should search all ready repositories when no folder specified", async () => {
      mockRepoService.setRepositories([
        createMockRepo({ name: "folder1", collectionName: "repo_folder1" }),
        createMockRepo({ name: "folder2", collectionName: "repo_folder2" }),
      ]);
      mockStorage.setMockResults([]);

      await service.searchDocuments({ query: "test" });

      expect(mockStorage.lastQuery?.collections).toEqual(["repo_folder1", "repo_folder2"]);
    });

    it("should filter to specific folder when specified", async () => {
      mockRepoService.setRepositories([
        createMockRepo({ name: "folder1", collectionName: "repo_folder1" }),
        createMockRepo({ name: "folder2", collectionName: "repo_folder2" }),
      ]);
      mockStorage.setMockResults([]);

      await service.searchDocuments({ query: "test", folder: "folder1" });

      expect(mockStorage.lastQuery?.collections).toEqual(["repo_folder1"]);
    });

    it("should skip repositories that are not ready", async () => {
      mockRepoService.setRepositories([
        createMockRepo({ name: "ready-folder", status: "ready" }),
        createMockRepo({
          name: "indexing-folder",
          status: "indexing",
          collectionName: "repo_indexing_folder",
        }),
      ]);
      mockStorage.setMockResults([]);

      await service.searchDocuments({ query: "test" });

      expect(mockStorage.lastQuery?.collections).toEqual(["repo_test_folder"]);
    });

    it("should throw NoRepositoriesAvailableError when no repos available", async () => {
      mockRepoService.setRepositories([]);

      await expect(service.searchDocuments({ query: "test" })).rejects.toThrow(
        NoRepositoriesAvailableError
      );
    });

    it("should throw NoRepositoriesAvailableError when no repos are ready", async () => {
      mockRepoService.setRepositories([createMockRepo({ name: "indexing", status: "indexing" })]);

      await expect(service.searchDocuments({ query: "test" })).rejects.toThrow(
        NoRepositoriesAvailableError
      );
    });

    it("should include searched folders in metadata", async () => {
      mockRepoService.setRepositories([
        createMockRepo({ name: "folder1" }),
        createMockRepo({ name: "folder2" }),
      ]);
      mockStorage.setMockResults([]);

      const response = await service.searchDocuments({ query: "test" });

      expect(response.metadata.searchedFolders).toContain("folder1");
      expect(response.metadata.searchedFolders).toContain("folder2");
    });
  });

  describe("document_types filtering", () => {
    it("should not add where filter when document_types is ['all']", async () => {
      mockStorage.setMockResults([]);

      await service.searchDocuments({
        query: "test",
        document_types: ["all"],
      });

      expect(mockStorage.lastQuery?.where).toBeUndefined();
    });

    it("should not add where filter when document_types is omitted", async () => {
      mockStorage.setMockResults([]);

      await service.searchDocuments({ query: "test" });

      expect(mockStorage.lastQuery?.where).toBeUndefined();
    });

    it("should add where filter for single document type", async () => {
      mockStorage.setMockResults([]);

      await service.searchDocuments({
        query: "test",
        document_types: ["pdf"],
      });

      expect(mockStorage.lastQuery?.where).toEqual({
        document_type: "pdf",
      });
    });

    it("should add $or where filter for multiple document types", async () => {
      mockStorage.setMockResults([]);

      await service.searchDocuments({
        query: "test",
        document_types: ["pdf", "docx"],
      });

      expect(mockStorage.lastQuery?.where).toEqual({
        $or: [{ document_type: "pdf" }, { document_type: "docx" }],
      });
    });

    it("should include searched document types in metadata", async () => {
      mockStorage.setMockResults([]);

      const response = await service.searchDocuments({
        query: "test",
        document_types: ["pdf", "markdown"],
      });

      expect(response.metadata.searchedDocumentTypes).toEqual(["pdf", "markdown"]);
    });

    it("should report 'all' when no specific types filtered", async () => {
      mockStorage.setMockResults([]);

      const response = await service.searchDocuments({
        query: "test",
        document_types: ["all"],
      });

      expect(response.metadata.searchedDocumentTypes).toEqual(["all"]);
    });
  });

  describe("result formatting", () => {
    it("should format results with document-specific metadata", async () => {
      mockStorage.setMockResults([
        createDocumentResult({
          content: "Chapter 1: Introduction to ML",
          file_path: "books/ml-intro.pdf",
          repository: "study-folder",
          document_type: "pdf",
          document_title: "ML Textbook",
          page_number: 3,
          section_heading: "Introduction",
          similarity: 0.95,
        }),
      ]);

      const response = await service.searchDocuments({ query: "machine learning" });

      expect(response.results).toHaveLength(1);
      const result = response.results[0]!;
      expect(result.content).toBe("Chapter 1: Introduction to ML");
      expect(result.documentPath).toBe("books/ml-intro.pdf");
      expect(result.documentTitle).toBe("ML Textbook");
      expect(result.documentType).toBe("pdf");
      expect(result.pageNumber).toBe(3);
      expect(result.sectionHeading).toBe("Introduction");
      expect(result.similarity).toBe(0.95);
      expect(result.folder).toBe("study-folder");
    });

    it("should handle results without optional metadata fields", async () => {
      const meta: Record<string, unknown> = {
        file_path: "notes/plain.txt",
        repository: "my-notes",
        chunk_index: 0,
        total_chunks: 1,
        chunk_start_line: 1,
        chunk_end_line: 5,
        file_extension: ".txt",
        language: "unknown",
        file_size_bytes: 256,
        content_hash: "def456",
        indexed_at: "2025-01-01T00:00:00Z",
        file_modified_at: "2025-01-01T00:00:00Z",
        document_type: "txt",
        // No document_title, page_number, or section_heading
      };

      mockStorage.setMockResults([
        {
          id: "my-notes:notes/plain.txt:0",
          content: "Simple text content",
          metadata: meta as unknown as DocumentMetadata,
          distance: 0.2,
          similarity: 0.8,
        },
      ]);

      const response = await service.searchDocuments({ query: "text" });

      const result = response.results[0]!;
      expect(result.documentTitle).toBeUndefined();
      expect(result.pageNumber).toBeUndefined();
      expect(result.sectionHeading).toBeUndefined();
      expect(result.documentType).toBe("txt");
    });

    it("should return multiple results sorted by similarity", async () => {
      mockStorage.setMockResults([
        createDocumentResult({ similarity: 0.95, content: "High relevance" }),
        createDocumentResult({ similarity: 0.75, content: "Low relevance" }),
        createDocumentResult({ similarity: 0.85, content: "Medium relevance" }),
      ]);

      const response = await service.searchDocuments({ query: "test" });

      expect(response.results).toHaveLength(3);
      // Results come from ChromaDB already sorted
      expect(response.results[0]!.similarity).toBe(0.95);
    });
  });

  describe("metadata", () => {
    it("should include query time in metadata", async () => {
      mockStorage.setMockResults([]);

      const response = await service.searchDocuments({ query: "test" });

      expect(response.metadata.queryTimeMs).toBeGreaterThanOrEqual(0);
    });

    it("should include total result count", async () => {
      mockStorage.setMockResults([createDocumentResult(), createDocumentResult({ id: "id2" })]);

      const response = await service.searchDocuments({ query: "test" });

      expect(response.metadata.totalResults).toBe(2);
    });
  });

  describe("error handling", () => {
    it("should propagate SearchValidationError", async () => {
      await expect(service.searchDocuments({ query: "" })).rejects.toThrow(SearchValidationError);
    });

    it("should propagate NoRepositoriesAvailableError", async () => {
      mockRepoService.setRepositories([]);

      await expect(service.searchDocuments({ query: "test" })).rejects.toThrow(
        NoRepositoriesAvailableError
      );
    });

    it("should wrap unexpected errors in SearchOperationError", async () => {
      // Override similaritySearch to throw
      const originalSearch = mockStorage.similaritySearch.bind(mockStorage);
      mockStorage.similaritySearch = async () => {
        throw new Error("Unexpected ChromaDB error");
      };

      await expect(service.searchDocuments({ query: "test" })).rejects.toThrow(
        SearchOperationError
      );

      // Restore
      mockStorage.similaritySearch = originalSearch;
    });
  });

  describe("embedding generation", () => {
    it("should generate embedding for query text", async () => {
      mockStorage.setMockResults([]);

      await service.searchDocuments({ query: "test embedding" });

      // Verify embedding was passed to storage
      expect(mockStorage.lastQuery?.embedding).toBeDefined();
      expect(mockStorage.lastQuery?.embedding.length).toBe(384);
    });

    it("should pass limit and threshold to storage", async () => {
      mockStorage.setMockResults([]);

      await service.searchDocuments({
        query: "test",
        limit: 20,
        threshold: 0.8,
      });

      expect(mockStorage.lastQuery?.limit).toBe(20);
      expect(mockStorage.lastQuery?.threshold).toBe(0.8);
    });
  });

  describe("embedding provider selection", () => {
    it("should use factory to create provider when repo has custom embeddingProvider", async () => {
      mockRepoService.setRepositories([
        createMockRepo({
          name: "custom-provider-folder",
          embeddingProvider: "ollama",
          embeddingModel: "nomic-embed-text",
          embeddingDimensions: 768,
        }),
      ]);
      mockStorage.setMockResults([]);

      await service.searchDocuments({ query: "test custom provider" });

      // Factory should have been called once to create the custom provider
      expect(mockFactory.createProviderCallCount).toBe(1);
    });

    it("should cache provider and not call factory again for same config", async () => {
      mockRepoService.setRepositories([
        createMockRepo({
          name: "cached-provider-folder",
          embeddingProvider: "ollama",
          embeddingModel: "nomic-embed-text",
          embeddingDimensions: 768,
        }),
      ]);
      mockStorage.setMockResults([]);

      // First search creates the provider
      await service.searchDocuments({ query: "first search" });
      expect(mockFactory.createProviderCallCount).toBe(1);

      // Second search should use cached provider (factory not called again)
      await service.searchDocuments({ query: "second search" });
      expect(mockFactory.createProviderCallCount).toBe(1);
    });

    it("should propagate factory errors as ProviderUnavailableError", async () => {
      mockRepoService.setRepositories([
        createMockRepo({
          name: "failing-provider-folder",
          embeddingProvider: "unavailable-provider",
          embeddingModel: "some-model",
          embeddingDimensions: 512,
        }),
      ]);
      mockStorage.setMockResults([]);

      // Configure factory to throw
      mockFactory.setShouldThrow(new Error("Provider not installed"));

      await expect(service.searchDocuments({ query: "test failing provider" })).rejects.toThrow(
        ProviderUnavailableError
      );
    });
  });
});
