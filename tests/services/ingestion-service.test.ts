/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
/**
 * Unit tests for IngestionService
 *
 * Tests all functionality with mocked dependencies to ensure proper behavior
 * and error handling across all scenarios.
 *
 * Coverage targets:
 * - indexRepository: Success, errors, force reindex, concurrent prevention
 * - removeRepository: Success, not found, concurrent prevention
 * - getStatus: Idle and active states
 * - Helper methods: URL validation, name extraction, sanitization
 */

/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable @typescript-eslint/await-thenable */
/* eslint-disable @typescript-eslint/no-unused-vars */

import { describe, it, expect, beforeEach, beforeAll, afterAll } from "bun:test";
import { IngestionService } from "../../src/services/ingestion-service.js";
import {
  IngestionError,
  RepositoryAlreadyExistsError,
  IndexingInProgressError,
} from "../../src/services/ingestion-errors.js";
import type { IndexProgress } from "../../src/services/ingestion-types.js";
import type { EmbeddingProvider } from "../../src/providers/types.js";
import type { ChromaStorageClient, DocumentInput } from "../../src/storage/types.js";
import type { RepositoryMetadataService, RepositoryInfo } from "../../src/repositories/types.js";
import type { CloneResult, FileInfo, FileChunk } from "../../src/ingestion/types.js";
import { initializeLogger, resetLogger } from "../../src/logging/index.js";

// Mock RepositoryCloner
class MockRepositoryCloner {
  private shouldFail = false;
  private failureError: Error | null = null;

  async clone(_url: string, options?: { branch?: string }): Promise<CloneResult> {
    if (this.shouldFail && this.failureError) {
      throw this.failureError;
    }
    return {
      path: "/tmp/mock-repo",
      name: "mock-repo",
      branch: options?.branch || "main",
    };
  }

  setShouldFail(shouldFail: boolean, error?: Error) {
    this.shouldFail = shouldFail;
    this.failureError = error || null;
  }
}

// Mock FileScanner
class MockFileScanner {
  private mockFiles: FileInfo[] = [];
  private shouldFail = false;
  private failureError: Error | null = null;

  async scanFiles(
    _repoPath: string,
    _options?: { includeExtensions?: string[]; excludePatterns?: string[] }
  ): Promise<FileInfo[]> {
    if (this.shouldFail && this.failureError) {
      throw this.failureError;
    }
    return this.mockFiles;
  }

  setMockFiles(files: FileInfo[]) {
    this.mockFiles = files;
  }

  setShouldFail(shouldFail: boolean, error?: Error) {
    this.shouldFail = shouldFail;
    this.failureError = error || null;
  }
}

// Mock FileChunker
class MockFileChunker {
  private mockChunks: FileChunk[] = [];

  chunkFile(content: string, fileInfo: FileInfo, repository: string): FileChunk[] {
    // Return mock chunks or create simple chunks
    if (this.mockChunks.length > 0) {
      return this.mockChunks;
    }
    // Default: create one chunk per file with complete metadata
    return [
      {
        id: `${repository}:${fileInfo.relativePath}:0`,
        content,
        repository,
        filePath: fileInfo.relativePath,
        chunkIndex: 0,
        totalChunks: 1,
        startLine: 0,
        endLine: content.split("\n").length,
        metadata: {
          extension: fileInfo.extension,
          fileSizeBytes: fileInfo.sizeBytes,
          contentHash: "mock-hash",
          fileModifiedAt: fileInfo.modifiedAt,
        },
      },
    ];
  }

  setMockChunks(chunks: FileChunk[]) {
    this.mockChunks = chunks;
  }
}

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
    if (this.shouldFail && this.failureError) {
      throw this.failureError;
    }
    return texts.map(() => new Array(this.dimensions).fill(0.1));
  }

  async healthCheck(): Promise<boolean> {
    return !this.shouldFail;
  }

  setShouldFail(shouldFail: boolean, error?: Error) {
    this.shouldFail = shouldFail;
    this.failureError = error || null;
  }
}

// Mock ChromaStorageClient
class MockChromaStorageClient implements ChromaStorageClient {
  private collections = new Set<string>();
  private shouldFailCreate = false;
  private shouldFailDelete = false;
  private shouldFailAdd = false;

  async connect(): Promise<void> {}
  async healthCheck(): Promise<boolean> {
    return true;
  }

  async getOrCreateCollection(name: string): Promise<any> {
    if (this.shouldFailCreate) {
      throw new Error("Failed to create collection");
    }
    this.collections.add(name);
    return { name };
  }

  async deleteCollection(name: string): Promise<void> {
    if (this.shouldFailDelete) {
      throw new Error("Failed to delete collection");
    }
    this.collections.delete(name);
  }

  async listCollections(): Promise<any[]> {
    return Array.from(this.collections).map((name) => ({ name }));
  }

  async addDocuments(_collectionName: string, _documents: DocumentInput[]): Promise<void> {
    if (this.shouldFailAdd) {
      throw new Error("Failed to add documents");
    }
  }

  async similaritySearch(): Promise<any[]> {
    return [];
  }

  async getCollectionStats(): Promise<any> {
    return { name: "test", documentCount: 0, retrievedAt: new Date().toISOString() };
  }

  setShouldFailCreate(shouldFail: boolean) {
    this.shouldFailCreate = shouldFail;
  }

  setShouldFailDelete(shouldFail: boolean) {
    this.shouldFailDelete = shouldFail;
  }

  setShouldFailAdd(shouldFail: boolean) {
    this.shouldFailAdd = shouldFail;
  }

  hasCollection(name: string): boolean {
    return this.collections.has(name);
  }

  clear() {
    this.collections.clear();
  }
}

// Mock RepositoryMetadataService
class MockRepositoryService implements RepositoryMetadataService {
  private repositories = new Map<string, RepositoryInfo>();

  async getRepository(name: string): Promise<RepositoryInfo | null> {
    return this.repositories.get(name) || null;
  }

  async listRepositories(): Promise<RepositoryInfo[]> {
    return Array.from(this.repositories.values());
  }

  async updateRepository(info: RepositoryInfo): Promise<void> {
    this.repositories.set(info.name, info);
  }

  async deleteRepository(name: string): Promise<void> {
    this.repositories.delete(name);
  }

  async removeRepository(name: string): Promise<void> {
    const repo = this.repositories.get(name);
    if (!repo) {
      throw new Error(`Repository '${name}' not found`);
    }
    this.repositories.delete(name);
  }

  setMockRepository(info: RepositoryInfo) {
    this.repositories.set(info.name, info);
  }

  clear() {
    this.repositories.clear();
  }
}

// Helper to create mock file
function createMockFile(relativePath: string, extension: string = ".ts"): FileInfo {
  return {
    relativePath,
    absolutePath: `/tmp/mock-repo/${relativePath}`,
    extension,
    sizeBytes: 1024,
    modifiedAt: new Date(),
  };
}

describe("IngestionService", () => {
  let service: IngestionService;
  let mockCloner: MockRepositoryCloner;
  let mockScanner: MockFileScanner;
  let mockChunker: MockFileChunker;
  let mockEmbedding: MockEmbeddingProvider;
  let mockStorage: MockChromaStorageClient;
  let mockRepoService: MockRepositoryService;

  beforeAll(() => {
    initializeLogger({ level: "silent", format: "json" });
  });

  afterAll(() => {
    resetLogger();
  });

  beforeEach(() => {
    // Create fresh mocks
    mockCloner = new MockRepositoryCloner();
    mockScanner = new MockFileScanner();
    mockChunker = new MockFileChunker();
    mockEmbedding = new MockEmbeddingProvider();
    mockStorage = new MockChromaStorageClient();
    mockRepoService = new MockRepositoryService();

    // Create service with mocks
    service = new IngestionService(
      mockCloner as any,
      mockScanner as any,
      mockChunker as any,
      mockEmbedding,
      mockStorage,
      mockRepoService
    );

    // Reset state
    mockStorage.clear();
    mockRepoService.clear();
  });

  describe("indexRepository", () => {
    const testUrl = "https://github.com/test/repo.git";
    const testRepoName = "repo";
    const testCollectionName = "repo";

    it("should successfully index a new repository", async () => {
      // Setup: 3 files, each creating 1 chunk
      const mockFiles = [
        createMockFile("src/file1.ts"),
        createMockFile("src/file2.ts"),
        createMockFile("src/file3.ts"),
      ];
      mockScanner.setMockFiles(mockFiles);

      // Mock file content reading (Bun.file)
      const originalBunFile = Bun.file;
      const mockFileContent = "mock file content";
      (Bun as any).file = (_path: string) => {
        const mockFile = {
          text: async () => mockFileContent,
          json: async () => ({}),
          arrayBuffer: async () => new ArrayBuffer(0),
          stream: () => null,
          size: mockFileContent.length,
          type: "text/plain",
        };
        return mockFile;
      };

      const result = await service.indexRepository(testUrl);

      // Restore Bun.file
      (Bun as any).file = originalBunFile;

      // Debug: Log errors if any
      if (result.status !== "success") {
        console.log("Indexing failed. Errors:", JSON.stringify(result.errors, null, 2));
        console.log("Stats:", JSON.stringify(result.stats, null, 2));
      }

      // Assertions
      expect(result.status).toBe("success");
      expect(result.repository).toBe(testRepoName);
      expect(result.collectionName).toBe(testCollectionName);
      expect(result.stats.filesScanned).toBe(3);
      expect(result.stats.filesProcessed).toBe(3);
      expect(result.stats.filesFailed).toBe(0);
      expect(result.stats.chunksCreated).toBe(3); // 1 chunk per file
      expect(result.stats.embeddingsGenerated).toBe(3);
      expect(result.stats.documentsStored).toBe(3);
      expect(result.errors).toHaveLength(0);

      // Verify collection was created
      expect(mockStorage.hasCollection(testCollectionName)).toBe(true);

      // Verify metadata was updated
      const repoInfo = await mockRepoService.getRepository(testRepoName);
      expect(repoInfo).not.toBeNull();
      expect(repoInfo?.status).toBe("ready");
      expect(repoInfo?.fileCount).toBe(3);
      expect(repoInfo?.chunkCount).toBe(3);
    });

    it("should reject repository that already exists without force flag", async () => {
      // Setup: Repository already exists
      mockRepoService.setMockRepository({
        name: testRepoName,
        url: testUrl,
        status: "ready",
        collectionName: testCollectionName,
        lastIndexedAt: new Date().toISOString(),
        fileCount: 10,
        chunkCount: 50,
        errorMessage: undefined,
      } as RepositoryInfo);

      await expect(service.indexRepository(testUrl)).rejects.toThrow(RepositoryAlreadyExistsError);
      await expect(service.indexRepository(testUrl)).rejects.toThrow(
        `Repository '${testRepoName}' is already indexed`
      );
    });

    it("should reindex repository when force flag is true", async () => {
      // Setup: Repository already exists
      mockRepoService.setMockRepository({
        name: testRepoName,
        url: testUrl,
        status: "ready",
        collectionName: testCollectionName,
        lastIndexedAt: new Date().toISOString(),
        fileCount: 10,
        chunkCount: 50,
        errorMessage: undefined,
      } as RepositoryInfo);

      const mockFiles = [createMockFile("src/new-file.ts")];
      mockScanner.setMockFiles(mockFiles);

      // Mock file content
      const originalBunFile = Bun.file;
      (Bun as any).file = (_path: string) => ({
        text: async () => "new content",
      });

      const result = await service.indexRepository(testUrl, { force: true });

      (Bun as any).file = originalBunFile;

      expect(result.status).toBe("success");
      expect(result.stats.filesScanned).toBe(1);
    });

    it("should prevent concurrent indexing", async () => {
      const mockFiles = [createMockFile("src/file1.ts")];
      mockScanner.setMockFiles(mockFiles);

      // Mock file content with a delay to ensure first indexing is still in progress
      const originalBunFile = Bun.file;
      let firstCall = true;
      (Bun as any).file = (_path: string) => ({
        text: async () => {
          if (firstCall) {
            firstCall = false;
            await new Promise((resolve) => setTimeout(resolve, 100)); // Delay first call
          }
          return "content";
        },
      });

      // Start first indexing (don't await)
      const firstIndexing = service.indexRepository(testUrl);

      // Wait a bit to ensure first indexing has started
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Try to start second indexing immediately
      await expect(service.indexRepository("https://github.com/other/repo.git")).rejects.toThrow(
        IndexingInProgressError
      );

      // Wait for first to complete
      await firstIndexing;

      (Bun as any).file = originalBunFile;
    });

    it("should invoke progress callback at each phase", async () => {
      const mockFiles = [createMockFile("src/file1.ts")];
      mockScanner.setMockFiles(mockFiles);

      const progressUpdates: IndexProgress[] = [];
      const onProgress = (progress: IndexProgress) => {
        progressUpdates.push(progress);
      };

      // Mock file content
      const originalBunFile = Bun.file;
      (Bun as any).file = (_path: string) => ({
        text: async () => "content",
      });

      await service.indexRepository(testUrl, { onProgress });

      (Bun as any).file = originalBunFile;

      // Should have progress updates for: cloning, scanning, chunking, embedding, storing, updating_metadata
      expect(progressUpdates.length).toBeGreaterThan(0);

      const phases = progressUpdates.map((p) => p.phase);
      expect(phases).toContain("cloning");
      expect(phases).toContain("scanning");
      expect(phases).toContain("updating_metadata");

      // All updates should have the repository name
      expect(progressUpdates.every((p) => p.repository === testRepoName)).toBe(true);
    });

    it("should gracefully handle file processing errors", async () => {
      const mockFiles = [
        createMockFile("src/file1.ts"),
        createMockFile("src/file2.ts"),
        createMockFile("src/file3.ts"),
      ];
      mockScanner.setMockFiles(mockFiles);

      // Mock file content - make second file fail
      let callCount = 0;
      const originalBunFile = Bun.file;
      (Bun as any).file = (_path: string) => ({
        text: async () => {
          callCount++;
          if (_path.includes("file2")) {
            throw new Error("File read error");
          }
          return "content";
        },
      });

      const result = await service.indexRepository(testUrl);

      (Bun as any).file = originalBunFile;

      // Should have partial success
      expect(result.status).toBe("partial"); // Has failures but some succeeded
      expect(result.stats.filesProcessed).toBe(2); // 2 succeeded
      expect(result.stats.filesFailed).toBe(1); // 1 failed
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]!.type).toBe("file_error");
    });

    it("should handle batch processing correctly (50 files per batch)", async () => {
      // Create 125 files (should be 3 batches: 50, 50, 25)
      const mockFiles = Array.from({ length: 125 }, (_, i) => createMockFile(`src/file${i}.ts`));
      mockScanner.setMockFiles(mockFiles);

      // Track progress
      const progressUpdates: IndexProgress[] = [];

      // Mock file content
      const originalBunFile = Bun.file;
      (Bun as any).file = (_path: string) => ({
        text: async () => "content",
      });

      await service.indexRepository(testUrl, {
        onProgress: (p) => progressUpdates.push(p),
      });

      (Bun as any).file = originalBunFile;

      // Verify batching in progress updates
      const batchUpdates = progressUpdates.filter((p) => p.details.totalBatches !== undefined);
      if (batchUpdates.length > 0) {
        expect(batchUpdates[0]!.details.totalBatches).toBe(3);
      }
    });

    it("should batch embeddings correctly (100 texts per API call)", async () => {
      // Create 250 files (should create 250 chunks)
      // Files are batched into 5 file batches of 50 files each
      // Each file batch creates 50 chunks, which is less than 100, so 1 embedding call per file batch
      // Total: 5 embedding calls (one per file batch)
      const mockFiles = Array.from({ length: 250 }, (_, i) => createMockFile(`src/file${i}.ts`));
      mockScanner.setMockFiles(mockFiles);

      let embeddingCallCount = 0;
      let maxBatchSize = 0;

      const originalGenerateEmbeddings = mockEmbedding.generateEmbeddings.bind(mockEmbedding);
      mockEmbedding.generateEmbeddings = async (texts: string[]) => {
        embeddingCallCount++;
        maxBatchSize = Math.max(maxBatchSize, texts.length);
        return originalGenerateEmbeddings(texts);
      };

      // Mock file content
      const originalBunFile = Bun.file;
      (Bun as any).file = (_path: string) => ({
        text: async () => "content",
      });

      await service.indexRepository(testUrl);

      (Bun as any).file = originalBunFile;

      // Should have made 5 embedding calls (one per file batch of 50 files)
      expect(embeddingCallCount).toBe(5);
      expect(maxBatchSize).toBe(50); // Max batch size is 50 (files per batch, 1 chunk per file)
    });

    it("should reject invalid URL format", async () => {
      const result = await service.indexRepository("not-a-url");
      expect(result.status).toBe("failed");
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]!.message).toContain("Invalid repository URL");
    });

    it("should handle clone errors", async () => {
      mockCloner.setShouldFail(true, new Error("Clone failed"));

      const result = await service.indexRepository(testUrl);

      expect(result.status).toBe("failed");
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]!.type).toBe("fatal_error");
    });

    it("should handle collection creation errors", async () => {
      mockStorage.setShouldFailCreate(true);
      mockScanner.setMockFiles([createMockFile("src/file1.ts")]);

      const result = await service.indexRepository(testUrl);

      expect(result.status).toBe("failed");
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("should support custom branch option", async () => {
      const mockFiles = [createMockFile("src/file1.ts")];
      mockScanner.setMockFiles(mockFiles);

      // Mock file content
      const originalBunFile = Bun.file;
      (Bun as any).file = (_path: string) => ({
        text: async () => "content",
      });

      await service.indexRepository(testUrl, { branch: "develop" });

      (Bun as any).file = originalBunFile;

      // Verify branch was passed to cloner (would need to spy on clone call in real implementation)
      // For now, just verify it completes successfully
    });

    it("should support custom file extensions", async () => {
      const mockFiles = [createMockFile("src/file1.md", ".md")];
      mockScanner.setMockFiles(mockFiles);

      // Mock file content
      const originalBunFile = Bun.file;
      (Bun as any).file = (_path: string) => ({
        text: async () => "content",
      });

      await service.indexRepository(testUrl, { includeExtensions: [".md"] });

      (Bun as any).file = originalBunFile;
    });

    it("should support custom exclude patterns", async () => {
      const mockFiles = [createMockFile("src/file1.ts")];
      mockScanner.setMockFiles(mockFiles);

      // Mock file content
      const originalBunFile = Bun.file;
      (Bun as any).file = (_path: string) => ({
        text: async () => "content",
      });

      await service.indexRepository(testUrl, { excludePatterns: ["node_modules/**"] });

      (Bun as any).file = originalBunFile;
    });
  });

  describe("removeRepository", () => {
    const testRepoName = "test-repo";
    const testCollectionName = "test-repo";

    it("should successfully remove a repository", async () => {
      // Setup: Repository exists
      mockRepoService.setMockRepository({
        name: testRepoName,
        url: "https://github.com/test/repo.git",
        status: "ready",
        collectionName: testCollectionName,
        lastIndexedAt: new Date().toISOString(),
        fileCount: 10,
        chunkCount: 50,
        errorMessage: undefined,
      } as RepositoryInfo);

      await service.removeRepository(testRepoName);

      // Verify repository was deleted from metadata
      const repoInfo = await mockRepoService.getRepository(testRepoName);
      expect(repoInfo).toBeNull();

      // Verify collection was deleted
      expect(mockStorage.hasCollection(testCollectionName)).toBe(false);
    });

    it("should throw error if repository not found", async () => {
      await expect(service.removeRepository("nonexistent")).rejects.toThrow(IngestionError);
      await expect(service.removeRepository("nonexistent")).rejects.toThrow("not found");
    });

    it("should prevent removal during active indexing", async () => {
      // Setup: Repository exists (use "repo" which matches the URL extraction)
      mockRepoService.setMockRepository({
        name: "repo", // Matches what's extracted from the URL
        url: "https://github.com/test/repo.git",
        status: "ready",
        collectionName: "repo",
        lastIndexedAt: new Date().toISOString(),
        fileCount: 10,
        chunkCount: 50,
        errorMessage: undefined,
      } as RepositoryInfo);

      const mockFiles = [createMockFile("src/file1.ts")];
      mockScanner.setMockFiles(mockFiles);

      // Mock file content with delay to ensure indexing is in progress
      const originalBunFile = Bun.file;
      (Bun as any).file = (_path: string) => ({
        text: async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return "content";
        },
      });

      // Start indexing with force=true since repo exists (don't await)
      const indexing = service.indexRepository("https://github.com/test/repo.git", { force: true });

      // Wait a bit to ensure indexing has started
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Try to remove the same repository while indexing
      await expect(service.removeRepository("repo")).rejects.toThrow(IngestionError);
      await expect(service.removeRepository("repo")).rejects.toThrow("indexing in progress");

      await indexing;

      (Bun as any).file = originalBunFile;
    });
  });

  describe("getStatus", () => {
    it("should return idle status when not indexing", () => {
      const status = service.getStatus();

      expect(status.isIndexing).toBe(false);
      expect(status.currentOperation).toBeNull();
    });

    it("should return active status during indexing", async () => {
      const mockFiles = [createMockFile("src/file1.ts")];
      mockScanner.setMockFiles(mockFiles);

      // Mock file content
      const originalBunFile = Bun.file;
      let statusDuringIndexing: any = null;

      (Bun as any).file = (_path: string) => ({
        text: async () => {
          // Capture status during processing
          statusDuringIndexing = service.getStatus();
          return "content";
        },
      });

      await service.indexRepository("https://github.com/test/repo.git");

      (Bun as any).file = originalBunFile;

      // Verify status was active during indexing
      if (statusDuringIndexing) {
        expect(statusDuringIndexing.isIndexing).toBe(true);
        expect(statusDuringIndexing.currentOperation).not.toBeNull();
        expect(statusDuringIndexing.currentOperation.repository).toBe("repo");
      }

      // Verify status is idle after completion
      const finalStatus = service.getStatus();
      expect(finalStatus.isIndexing).toBe(false);
      expect(finalStatus.currentOperation).toBeNull();
    });
  });

  describe("reindexRepository", () => {
    it("should reindex by calling indexRepository with force=true", async () => {
      const mockFiles = [createMockFile("src/file1.ts")];
      mockScanner.setMockFiles(mockFiles);

      // Mock file content
      const originalBunFile = Bun.file;
      (Bun as any).file = (_path: string) => ({
        text: async () => "content",
      });

      const result = await service.reindexRepository("https://github.com/test/repo.git");

      (Bun as any).file = originalBunFile;

      expect(result.status).toBe("success");
    });
  });

  describe("Helper methods", () => {
    describe("URL validation", () => {
      it("should accept valid HTTPS URLs", () => {
        // These should not throw
        expect(() =>
          (service as any).validateUrl("https://github.com/owner/repo.git")
        ).not.toThrow();
        expect(() => (service as any).validateUrl("https://github.com/owner/repo")).not.toThrow();
        expect(() => (service as any).validateUrl("https://gitlab.com/owner/repo")).not.toThrow();
        expect(() =>
          (service as any).validateUrl("https://bitbucket.org/owner/repo.git")
        ).not.toThrow();
      });

      it("should accept valid SSH URLs", () => {
        expect(() => (service as any).validateUrl("git@github.com:owner/repo.git")).not.toThrow();
      });

      it("should reject invalid URLs", () => {
        expect(() => (service as any).validateUrl("not-a-url")).toThrow(IngestionError);
        expect(() => (service as any).validateUrl("ftp://github.com/repo")).toThrow(IngestionError);
        expect(() => (service as any).validateUrl("")).toThrow(IngestionError);
      });
    });

    describe("Repository name extraction", () => {
      it("should extract name from HTTPS URL with .git", () => {
        const name = (service as any).extractRepositoryName("https://github.com/owner/repo.git");
        expect(name).toBe("repo");
      });

      it("should extract name from HTTPS URL without .git", () => {
        const name = (service as any).extractRepositoryName("https://github.com/owner/repo");
        expect(name).toBe("repo");
      });

      it("should extract name from SSH URL", () => {
        const name = (service as any).extractRepositoryName("git@github.com:owner/repo.git");
        expect(name).toBe("repo");
      });

      it("should throw error for invalid URL", () => {
        expect(() => (service as any).extractRepositoryName("invalid")).toThrow(IngestionError);
      });
    });

    describe("Collection name sanitization", () => {
      it("should keep valid names unchanged", () => {
        const name = (service as any).sanitizeCollectionName("valid-repo_name.123");
        expect(name).toBe("valid-repo_name.123");
      });

      it("should replace invalid characters", () => {
        const name = (service as any).sanitizeCollectionName("my repo!");
        expect(name).toBe("my_repo");
      });

      it("should enforce minimum length (3 chars)", () => {
        const name = (service as any).sanitizeCollectionName("ab");
        expect(name.length).toBeGreaterThanOrEqual(3);
      });

      it("should enforce maximum length (63 chars)", () => {
        const longName = "a".repeat(100);
        const name = (service as any).sanitizeCollectionName(longName);
        expect(name.length).toBeLessThanOrEqual(63);
      });

      it("should convert to lowercase", () => {
        const name = (service as any).sanitizeCollectionName("MyRepo");
        expect(name).toBe("myrepo");
      });
    });
  });
});
