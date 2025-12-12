/**
 * Integration tests for SearchService
 *
 * Tests end-to-end search functionality with real ChromaDB and RepositoryMetadataService.
 * Uses mock EmbeddingProvider to avoid external API dependencies.
 */

/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable @typescript-eslint/no-unused-vars */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { SearchServiceImpl } from "../../src/services/search-service.js";
import { ChromaStorageClientImpl } from "../../src/storage/chroma-client.js";
import { RepositoryMetadataStoreImpl } from "../../src/repositories/metadata-store.js";
import type { EmbeddingProvider } from "../../src/providers/types.js";
import type { DocumentInput } from "../../src/storage/types.js";
import { initializeLogger, resetLogger } from "../../src/logging/index.js";
import fs from "fs";
import path from "path";

// Mock EmbeddingProvider for integration tests
class MockEmbeddingProvider implements EmbeddingProvider {
  public readonly providerId = "mock";
  public readonly modelId = "mock-model";
  public readonly dimensions = 1536;

  async generateEmbedding(text: string): Promise<number[]> {
    // Generate deterministic embeddings based on text content
    // This allows us to test similarity search behavior
    const hash = this.hashString(text);
    return Array.from({ length: this.dimensions }, (_, i) => Math.sin(hash + i) * 0.5);
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.generateEmbedding(t)));
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return hash;
  }
}

describe("SearchService Integration Tests", () => {
  const testDataPath = "/tmp/search-service-integration-test";
  const testChromaHost = process.env["CHROMADB_HOST"] || "localhost";
  const testChromaPort = parseInt(process.env["CHROMADB_PORT"] || "8000", 10);

  let service: SearchServiceImpl;
  let embeddingProvider: MockEmbeddingProvider;
  let storageClient: ChromaStorageClientImpl;
  let repositoryService: RepositoryMetadataStoreImpl;

  beforeAll(async () => {
    // Initialize logger
    initializeLogger({ level: "error", format: "json" });

    // Setup test data directory
    if (fs.existsSync(testDataPath)) {
      fs.rmSync(testDataPath, { recursive: true, force: true });
    }
    fs.mkdirSync(testDataPath, { recursive: true });

    // Initialize services
    embeddingProvider = new MockEmbeddingProvider();
    storageClient = new ChromaStorageClientImpl({
      host: testChromaHost,
      port: testChromaPort,
    });
    repositoryService = RepositoryMetadataStoreImpl.getInstance(testDataPath);

    // Connect to ChromaDB
    await storageClient.connect();

    // Create SearchService
    service = new SearchServiceImpl(embeddingProvider, storageClient, repositoryService);
  });

  afterAll(async () => {
    // Cleanup test collections
    try {
      await storageClient.deleteCollection("repo_test_integration_1");
      await storageClient.deleteCollection("repo_test_integration_2");
    } catch (error) {
      // Ignore errors during cleanup
    }

    // Cleanup test data directory
    if (fs.existsSync(testDataPath)) {
      fs.rmSync(testDataPath, { recursive: true, force: true });
    }

    // Reset singleton
    RepositoryMetadataStoreImpl.resetInstance();
    resetLogger();
  });

  beforeEach(async () => {
    // Clean up collections before each test
    try {
      await storageClient.deleteCollection("repo_test_integration_1");
      await storageClient.deleteCollection("repo_test_integration_2");
    } catch (error) {
      // Ignore if collections don't exist
    }
  });

  describe("End-to-End Search", () => {
    it("should find relevant chunks for code query", async () => {
      // Index test documents
      await indexTestRepository("test-integration-1", [
        {
          content: "async function authenticateUser(username: string, password: string) { ... }",
          filePath: "src/auth.ts",
          chunkIndex: 0,
        },
        {
          content: "function calculateTotal(items: Item[]): number { ... }",
          filePath: "src/utils.ts",
          chunkIndex: 0,
        },
        {
          content:
            "# User Authentication Guide\n\nThis guide explains how to authenticate users...",
          filePath: "docs/auth.md",
          chunkIndex: 0,
        },
      ]);

      // Search for authentication-related content
      const response = await service.search({
        query: "how to authenticate users",
        limit: 10,
        threshold: 0.0, // Low threshold for integration test
      });

      expect(response.results.length).toBeGreaterThan(0);
      expect(response.metadata.total_matches).toBeGreaterThan(0);
      expect(response.metadata.query_time_ms).toBeGreaterThan(0);
      expect(response.metadata.embedding_time_ms).toBeGreaterThan(0);
      expect(response.metadata.search_time_ms).toBeGreaterThan(0);

      // Results should be sorted by similarity
      for (let i = 1; i < response.results.length; i++) {
        expect(response.results[i - 1]!.similarity_score).toBeGreaterThanOrEqual(
          response.results[i]!.similarity_score
        );
      }
    });

    it("should respect similarity threshold filtering", async () => {
      await indexTestRepository("test-integration-1", [
        {
          content: "TypeScript authentication function",
          filePath: "src/auth.ts",
          chunkIndex: 0,
        },
        {
          content: "Completely unrelated content about cats and dogs",
          filePath: "src/random.ts",
          chunkIndex: 0,
        },
      ]);

      // High threshold should filter out unrelated content
      const response = await service.search({
        query: "authentication",
        limit: 10,
        threshold: 0.8,
      });

      // Should get fewer or equal results with high threshold
      expect(response.results.length).toBeLessThanOrEqual(2);

      // All results should meet threshold
      response.results.forEach((result) => {
        expect(result.similarity_score).toBeGreaterThanOrEqual(0.8);
      });
    });

    it("should limit results to specified count", async () => {
      await indexTestRepository("test-integration-1", [
        { content: "Test content 1", filePath: "file1.ts", chunkIndex: 0 },
        { content: "Test content 2", filePath: "file2.ts", chunkIndex: 0 },
        { content: "Test content 3", filePath: "file3.ts", chunkIndex: 0 },
        { content: "Test content 4", filePath: "file4.ts", chunkIndex: 0 },
        { content: "Test content 5", filePath: "file5.ts", chunkIndex: 0 },
      ]);

      const response = await service.search({
        query: "test content",
        limit: 3,
        threshold: 0.0,
      });

      expect(response.results.length).toBeLessThanOrEqual(3);
    });

    it("should search single repository when specified", async () => {
      await indexTestRepository("test-integration-1", [
        { content: "Content in repo 1", filePath: "file1.ts", chunkIndex: 0 },
      ]);

      await indexTestRepository("test-integration-2", [
        { content: "Content in repo 2", filePath: "file2.ts", chunkIndex: 0 },
      ]);

      const response = await service.search({
        query: "content",
        repository: "test-integration-1",
        threshold: 0.0,
      });

      expect(response.metadata.repositories_searched).toEqual(["test-integration-1"]);
      response.results.forEach((result) => {
        expect(result.repository).toBe("test-integration-1");
      });
    });

    it("should search all repositories when none specified", async () => {
      await indexTestRepository("test-integration-1", [
        { content: "Content in repo 1", filePath: "file1.ts", chunkIndex: 0 },
      ]);

      await indexTestRepository("test-integration-2", [
        { content: "Content in repo 2", filePath: "file2.ts", chunkIndex: 0 },
      ]);

      const response = await service.search({
        query: "content",
        threshold: 0.0,
      });

      expect(response.metadata.repositories_searched).toContain("test-integration-1");
      expect(response.metadata.repositories_searched).toContain("test-integration-2");
    });
  });

  describe("Performance", () => {
    it("should complete search within reasonable time", async () => {
      await indexTestRepository("test-integration-1", [
        { content: "Test content 1", filePath: "file1.ts", chunkIndex: 0 },
        { content: "Test content 2", filePath: "file2.ts", chunkIndex: 0 },
      ]);

      const startTime = performance.now();
      const response = await service.search({
        query: "test",
        threshold: 0.0,
      });
      const endTime = performance.now();

      const actualTime = endTime - startTime;

      // Should complete in reasonable time (generous for CI environments)
      expect(actualTime).toBeLessThan(2000); // 2 seconds

      // Metadata should reflect timing
      expect(response.metadata.query_time_ms).toBeGreaterThan(0);
      expect(response.metadata.query_time_ms).toBeLessThan(2000);
    });
  });

  describe("Edge Cases", () => {
    it("should handle repository with no indexed chunks", async () => {
      await repositoryService.updateRepository({
        name: "empty-repo",
        url: "https://github.com/test/empty",
        localPath: "/tmp/empty",
        collectionName: "repo_empty",
        status: "ready",
        fileCount: 0,
        chunkCount: 0,
        lastIndexedAt: new Date().toISOString(),
        indexDurationMs: 0,
        branch: "main",
        includeExtensions: [],
        excludePatterns: [],
      });

      const response = await service.search({
        query: "test",
        repository: "empty-repo",
        threshold: 0.0,
      });

      expect(response.results).toEqual([]);
      expect(response.metadata.total_matches).toBe(0);
    });

    it("should handle query with no matching results", async () => {
      await indexTestRepository("test-integration-1", [
        {
          content: "Python code for data analysis",
          filePath: "script.py",
          chunkIndex: 0,
        },
      ]);

      const response = await service.search({
        query: "completely different topic about cooking",
        threshold: 0.9, // High threshold
      });

      expect(response.results).toEqual([]);
      expect(response.metadata.total_matches).toBe(0);
    });

    it("should handle very long query (1000 chars)", async () => {
      await indexTestRepository("test-integration-1", [
        { content: "Test content", filePath: "file.ts", chunkIndex: 0 },
      ]);

      const longQuery = "test ".repeat(200); // 1000 chars
      const response = await service.search({
        query: longQuery,
        threshold: 0.0,
      });

      expect(response).toBeDefined();
    });
  });

  // Helper function to index a test repository
  async function indexTestRepository(
    repoName: string,
    documents: Array<{ content: string; filePath: string; chunkIndex: number }>
  ) {
    const collectionName = `repo_${repoName.replace(/[^a-z0-9]/gi, "_")}`;

    // Add repository metadata
    await repositoryService.updateRepository({
      name: repoName,
      url: `https://github.com/test/${repoName}`,
      localPath: `/tmp/${repoName}`,
      collectionName,
      status: "ready",
      fileCount: documents.length,
      chunkCount: documents.length,
      lastIndexedAt: new Date().toISOString(),
      indexDurationMs: 1000,
      branch: "main",
      includeExtensions: [".ts", ".js", ".md"],
      excludePatterns: ["node_modules"],
    });

    // Generate embeddings and prepare documents
    const embeddings = await embeddingProvider.generateEmbeddings(documents.map((d) => d.content));

    const documentInputs: DocumentInput[] = documents.map((doc, index) => ({
      id: `${repoName}:${doc.filePath}:${doc.chunkIndex}`,
      content: doc.content,
      embedding: embeddings[index]!,
      metadata: {
        file_path: doc.filePath,
        repository: repoName,
        chunk_index: doc.chunkIndex,
        total_chunks: 1,
        chunk_start_line: 1,
        chunk_end_line: 10,
        file_extension: path.extname(doc.filePath),
        file_size_bytes: doc.content.length,
        content_hash: `hash_${index}`,
        indexed_at: new Date().toISOString(),
        file_modified_at: new Date().toISOString(),
      },
    }));

    // Add documents to ChromaDB
    await storageClient.addDocuments(collectionName, documentInputs);
  }
});
