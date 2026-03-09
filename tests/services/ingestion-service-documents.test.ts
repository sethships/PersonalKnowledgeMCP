/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable @typescript-eslint/no-unused-vars */

/**
 * Unit tests for IngestionService document integration.
 *
 * Tests the document routing path where PDF, DOCX, MD, and TXT files
 * are processed through the DocumentChunker pipeline instead of the
 * generic FileChunker, and verifies that document-specific metadata
 * (document_type, page_number, section_heading, etc.) is populated
 * in ChromaDB.
 *
 * @module tests/services/ingestion-service-documents
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "bun:test";
import { IngestionService } from "../../src/services/ingestion-service.js";
import type { EmbeddingProvider } from "../../src/providers/types.js";
import type {
  ChromaStorageClient,
  DocumentInput,
  ParsedEmbeddingMetadata,
  CollectionEmbeddingMetadata,
} from "../../src/storage/types.js";
import type { RepositoryMetadataService, RepositoryInfo } from "../../src/repositories/types.js";
import type { CloneResult, FileInfo, FileChunk } from "../../src/ingestion/types.js";
import type { ExtractionResult, DocumentChunk } from "../../src/documents/types.js";
import type { DetectedType } from "../../src/documents/DocumentTypeDetector.js";
import type { DocumentExtractor } from "../../src/documents/types.js";
import { initializeLogger, resetLogger } from "../../src/logging/index.js";

// ── Mock classes ──────────────────────────────────────────────────

class MockRepositoryCloner {
  async clone(_url: string, options?: { branch?: string }): Promise<CloneResult> {
    return {
      path: "/tmp/mock-repo",
      name: "mock-repo",
      branch: options?.branch || "main",
      commitSha: "abc1234567890abcdef1234567890abcdef12345",
    };
  }
  async cleanup(_repoPath: string): Promise<void> {}
}

class MockFileScanner {
  private mockFiles: FileInfo[] = [];

  async scanFiles(
    _repoPath: string,
    _options?: { includeExtensions?: string[]; excludePatterns?: string[] }
  ): Promise<FileInfo[]> {
    return this.mockFiles;
  }

  setMockFiles(files: FileInfo[]) {
    this.mockFiles = files;
  }
}

class MockFileChunker {
  chunkFile(content: string, fileInfo: FileInfo, repository: string): FileChunk[] {
    const language =
      fileInfo.extension === ".ts"
        ? "typescript"
        : fileInfo.extension === ".js"
          ? "javascript"
          : "unknown";
    return [
      {
        id: `${repository}:${fileInfo.relativePath}:0`,
        content,
        repository,
        filePath: fileInfo.relativePath,
        chunkIndex: 0,
        totalChunks: 1,
        startLine: 1,
        endLine: content.split("\n").length,
        metadata: {
          extension: fileInfo.extension,
          language,
          fileSizeBytes: fileInfo.sizeBytes,
          contentHash: "mock-hash",
          fileModifiedAt: fileInfo.modifiedAt,
        },
      },
    ];
  }
}

class MockEmbeddingProvider implements EmbeddingProvider {
  public readonly providerId = "mock";
  public readonly modelId = "mock-model";
  public readonly dimensions = 1536;

  async generateEmbedding(_text: string): Promise<number[]> {
    return new Array(this.dimensions).fill(0.1);
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    return texts.map(() => new Array(this.dimensions).fill(0.1));
  }

  async healthCheck(): Promise<boolean> {
    return true;
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
}

class MockChromaStorageClient implements ChromaStorageClient {
  private collections = new Set<string>();
  /** Captured documents from the last addDocuments call */
  public capturedDocuments: DocumentInput[] = [];

  async connect(): Promise<void> {}
  async healthCheck(): Promise<boolean> {
    return true;
  }
  async getOrCreateCollection(
    name: string,
    _embeddingMetadata?: CollectionEmbeddingMetadata
  ): Promise<any> {
    this.collections.add(name);
    return { name };
  }
  async deleteCollection(name: string): Promise<void> {
    this.collections.delete(name);
  }
  async listCollections(): Promise<any[]> {
    return Array.from(this.collections).map((name) => ({ name }));
  }
  async addDocuments(_collectionName: string, documents: DocumentInput[]): Promise<void> {
    this.capturedDocuments.push(...documents);
  }
  async similaritySearch(): Promise<any[]> {
    return [];
  }
  async getCollectionStats(): Promise<any> {
    return { name: "test", documentCount: 0, retrievedAt: new Date().toISOString() };
  }
  async upsertDocuments(_collectionName: string, _documents: DocumentInput[]): Promise<void> {}
  async deleteDocuments(_collectionName: string, _ids: string[]): Promise<void> {}
  async getDocumentsByMetadata(): Promise<any[]> {
    return [];
  }
  async getCollectionEmbeddingMetadata(): Promise<ParsedEmbeddingMetadata | null> {
    return null;
  }
  async deleteDocumentsByFilePrefix(): Promise<number> {
    return 0;
  }

  clear() {
    this.collections.clear();
    this.capturedDocuments = [];
  }
}

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
    this.repositories.delete(name);
  }

  clear() {
    this.repositories.clear();
  }
}

// ── Mock Document Dependencies ────────────────────────────────────

/**
 * Mock extractor that returns a configurable ExtractionResult.
 */
class MockDocumentExtractor implements DocumentExtractor<ExtractionResult> {
  private result: ExtractionResult;
  private shouldFail = false;
  private failureError: Error | null = null;

  constructor(result?: Partial<ExtractionResult>) {
    const now = new Date();
    this.result = {
      content: result?.content ?? "Document content for testing.",
      metadata: result?.metadata ?? {
        documentType: "pdf",
        title: "Test Document",
        author: "Test Author",
        filePath: "/tmp/mock-repo/docs/test.pdf",
        fileSizeBytes: 2048,
        contentHash: "doc-hash-123",
        fileModifiedAt: now,
      },
      pages: result?.pages,
      sections: result?.sections,
    };
  }

  async extract(_filePath: string): Promise<ExtractionResult> {
    if (this.shouldFail && this.failureError) {
      throw this.failureError;
    }
    return this.result;
  }

  supports(extension: string): boolean {
    return extension === ".pdf";
  }

  setResult(result: ExtractionResult) {
    this.result = result;
  }

  setShouldFail(shouldFail: boolean, error?: Error) {
    this.shouldFail = shouldFail;
    this.failureError = error || null;
  }
}

/**
 * Mock DocumentTypeDetector that determines document status from a configurable set.
 */
class MockDocumentTypeDetector {
  private documentExtensions = new Set([".pdf", ".docx", ".md", ".txt"]);
  private extractor: DocumentExtractor<unknown> | null;

  constructor(extractor?: DocumentExtractor<unknown>) {
    this.extractor = extractor ?? null;
  }

  detect(filePath: string): DetectedType {
    const ext = this.getExtension(filePath);
    if (this.documentExtensions.has(ext)) {
      if (ext === ".pdf") return "pdf";
      if (ext === ".docx") return "docx";
      if (ext === ".md") return "markdown";
      if (ext === ".txt") return "txt";
    }
    return "unknown";
  }

  getExtractor(_filePath: string): DocumentExtractor<unknown> | null {
    return this.extractor;
  }

  isSupported(filePath: string): boolean {
    return this.detect(filePath) !== "unknown";
  }

  isDocument(filePath: string): boolean {
    const type = this.detect(filePath);
    return type !== "unknown" && type !== "image";
  }

  isImage(_filePath: string): boolean {
    return false;
  }

  getExtension(filePath: string): string {
    const match = filePath.match(/\.[^.]+$/);
    return match ? match[0].toLowerCase() : "";
  }

  setExtractor(extractor: DocumentExtractor<unknown> | null) {
    this.extractor = extractor;
  }
}

/**
 * Mock DocumentChunker that returns configurable DocumentChunk[].
 */
class MockDocumentChunker {
  private chunks: DocumentChunk[] = [];
  private shouldFail = false;
  private failureError: Error | null = null;

  chunkDocument(
    extractionResult: ExtractionResult,
    filePath: string,
    source: string
  ): DocumentChunk[] {
    if (this.shouldFail && this.failureError) {
      throw this.failureError;
    }

    if (this.chunks.length > 0) {
      return this.chunks;
    }

    // Default: create one chunk from the extraction result
    return [
      {
        id: `${source}:${filePath}:0`,
        repository: source,
        filePath,
        content: extractionResult.content,
        chunkIndex: 0,
        totalChunks: 1,
        startLine: 1,
        endLine: extractionResult.content.split("\n").length,
        metadata: {
          extension: filePath.match(/\.[^.]+$/)?.[0]?.toLowerCase() ?? "",
          language: "unknown",
          fileSizeBytes: extractionResult.metadata.fileSizeBytes,
          contentHash: extractionResult.metadata.contentHash,
          fileModifiedAt: extractionResult.metadata.fileModifiedAt,
          documentType: extractionResult.metadata.documentType,
          pageNumber: extractionResult.pages?.[0]?.pageNumber,
          sectionHeading: extractionResult.sections?.[0]?.title,
          documentTitle: extractionResult.metadata.title,
          documentAuthor: extractionResult.metadata.author,
        },
      },
    ];
  }

  // FileChunker interface method (DocumentChunker extends FileChunker)
  chunkFile(content: string, fileInfo: FileInfo, repository: string): FileChunk[] {
    return [
      {
        id: `${repository}:${fileInfo.relativePath}:0`,
        content,
        repository,
        filePath: fileInfo.relativePath,
        chunkIndex: 0,
        totalChunks: 1,
        startLine: 1,
        endLine: content.split("\n").length,
        metadata: {
          extension: fileInfo.extension,
          language: "unknown",
          fileSizeBytes: fileInfo.sizeBytes,
          contentHash: "mock-hash",
          fileModifiedAt: fileInfo.modifiedAt,
        },
      },
    ];
  }

  setMockChunks(chunks: DocumentChunk[]) {
    this.chunks = chunks;
  }

  setShouldFail(shouldFail: boolean, error?: Error) {
    this.shouldFail = shouldFail;
    this.failureError = error || null;
  }
}

// ── Helpers ───────────────────────────────────────────────────────

function createMockFile(relativePath: string, extension: string): FileInfo {
  return {
    relativePath,
    absolutePath: `/tmp/mock-repo/${relativePath}`,
    extension,
    sizeBytes: 2048,
    modifiedAt: new Date(),
  };
}

// ── Tests ─────────────────────────────────────────────────────────

describe("IngestionService - Document Integration", () => {
  let mockCloner: MockRepositoryCloner;
  let mockScanner: MockFileScanner;
  let mockFileChunker: MockFileChunker;
  let mockEmbeddingProvider: MockEmbeddingProvider;
  let mockChromaClient: MockChromaStorageClient;
  let mockRepoService: MockRepositoryService;
  let mockDocumentChunker: MockDocumentChunker;
  let mockDocumentTypeDetector: MockDocumentTypeDetector;
  let mockExtractor: MockDocumentExtractor;

  // Store original Bun.file for cleanup
  const originalBunFile = Bun.file;

  beforeAll(() => {
    initializeLogger({ level: "silent", format: "json" });
  });

  afterAll(() => {
    resetLogger();
  });

  beforeEach(() => {
    mockCloner = new MockRepositoryCloner();
    mockScanner = new MockFileScanner();
    mockFileChunker = new MockFileChunker();
    mockEmbeddingProvider = new MockEmbeddingProvider();
    mockChromaClient = new MockChromaStorageClient();
    mockRepoService = new MockRepositoryService();
    mockExtractor = new MockDocumentExtractor();
    mockDocumentTypeDetector = new MockDocumentTypeDetector(mockExtractor);
    mockDocumentChunker = new MockDocumentChunker();

    // Mock Bun.file for non-document files (code files read via Bun.file().text())
    const mockFileContent = "mock file content";
    (Bun as any).file = (_path: string) => ({
      text: async () => mockFileContent,
      json: async () => ({}),
      arrayBuffer: async () => new ArrayBuffer(0),
      stream: () => null,
      size: mockFileContent.length,
      type: "text/plain",
    });
  });

  afterEach(() => {
    // Restore original Bun.file to prevent test pollution
    (Bun as any).file = originalBunFile;
  });

  /**
   * Helper to create an IngestionService with document dependencies.
   */
  function createServiceWithDocuments(): IngestionService {
    return new IngestionService(
      mockCloner as any,
      mockScanner as any,
      mockFileChunker as any,
      mockEmbeddingProvider,
      mockChromaClient,
      mockRepoService,
      {
        documentChunker: mockDocumentChunker as any,
        documentTypeDetector: mockDocumentTypeDetector as any,
      }
    );
  }

  /**
   * Helper to create an IngestionService WITHOUT document dependencies.
   */
  function createServiceWithoutDocuments(): IngestionService {
    return new IngestionService(
      mockCloner as any,
      mockScanner as any,
      mockFileChunker as any,
      mockEmbeddingProvider,
      mockChromaClient,
      mockRepoService
    );
  }

  // ── Document Detection Tests ──────────────────────────────────

  describe("document detection routing", () => {
    it("should route .pdf files through DocumentChunker when detector is present", async () => {
      const service = createServiceWithDocuments();
      const pdfFile = createMockFile("docs/report.pdf", ".pdf");
      mockScanner.setMockFiles([pdfFile]);

      const result = await service.indexRepository("https://github.com/test/repo.git");

      expect(result.status).toBe("success");
      expect(result.stats.filesProcessed).toBe(1);
      expect(result.stats.chunksCreated).toBeGreaterThan(0);

      // Verify document metadata is present in stored documents
      expect(mockChromaClient.capturedDocuments.length).toBeGreaterThan(0);
      const doc = mockChromaClient.capturedDocuments[0]!;
      expect(doc.metadata.document_type).toBe("pdf");
      expect(doc.metadata.document_title).toBe("Test Document");
      expect(doc.metadata.document_author).toBe("Test Author");
    });

    it("should route .docx files through DocumentChunker when detector is present", async () => {
      const service = createServiceWithDocuments();
      const docxFile = createMockFile("docs/spec.docx", ".docx");
      mockScanner.setMockFiles([docxFile]);

      // Set up extractor for docx
      const docxExtractor = new MockDocumentExtractor({
        content: "DOCX content here.",
        metadata: {
          documentType: "docx",
          title: "Specification Doc",
          author: "Author B",
          filePath: "/tmp/mock-repo/docs/spec.docx",
          fileSizeBytes: 3072,
          contentHash: "docx-hash",
          fileModifiedAt: new Date(),
        },
      });
      mockDocumentTypeDetector.setExtractor(docxExtractor);

      const result = await service.indexRepository("https://github.com/test/repo.git");

      expect(result.status).toBe("success");
      expect(result.stats.filesProcessed).toBe(1);
      const doc = mockChromaClient.capturedDocuments[0]!;
      expect(doc.metadata.document_type).toBe("docx");
      expect(doc.metadata.document_title).toBe("Specification Doc");
    });

    it("should route .ts files through FileChunker (not DocumentChunker)", async () => {
      const service = createServiceWithDocuments();
      const tsFile = createMockFile("src/index.ts", ".ts");
      mockScanner.setMockFiles([tsFile]);

      const result = await service.indexRepository("https://github.com/test/repo.git");

      expect(result.status).toBe("success");
      expect(result.stats.filesProcessed).toBe(1);

      // Verify NO document metadata in stored documents
      const doc = mockChromaClient.capturedDocuments[0]!;
      expect(doc.metadata.document_type).toBeUndefined();
      expect(doc.metadata.document_title).toBeUndefined();
      expect(doc.metadata.document_author).toBeUndefined();
      expect(doc.metadata.page_number).toBeUndefined();
      expect(doc.metadata.section_heading).toBeUndefined();
    });

    it("should route .js files through FileChunker", async () => {
      const service = createServiceWithDocuments();
      const jsFile = createMockFile("src/app.js", ".js");
      mockScanner.setMockFiles([jsFile]);

      const result = await service.indexRepository("https://github.com/test/repo.git");

      expect(result.status).toBe("success");
      const doc = mockChromaClient.capturedDocuments[0]!;
      expect(doc.metadata.document_type).toBeUndefined();
      expect(doc.metadata.language).toBe("javascript");
    });
  });

  // ── No Detector Provided Tests ────────────────────────────────

  describe("no document detector provided", () => {
    it("should process all files through FileChunker when no document dependencies", async () => {
      const service = createServiceWithoutDocuments();
      const pdfFile = createMockFile("docs/report.pdf", ".pdf");
      const tsFile = createMockFile("src/index.ts", ".ts");
      mockScanner.setMockFiles([pdfFile, tsFile]);

      const result = await service.indexRepository("https://github.com/test/repo.git");

      expect(result.status).toBe("success");
      expect(result.stats.filesProcessed).toBe(2);

      // Both files should lack document metadata
      for (const doc of mockChromaClient.capturedDocuments) {
        expect(doc.metadata.document_type).toBeUndefined();
        expect(doc.metadata.document_title).toBeUndefined();
      }
    });

    it("should process .md files through FileChunker when no document dependencies", async () => {
      const service = createServiceWithoutDocuments();
      const mdFile = createMockFile("README.md", ".md");
      mockScanner.setMockFiles([mdFile]);

      const result = await service.indexRepository("https://github.com/test/repo.git");

      expect(result.status).toBe("success");
      expect(result.stats.filesProcessed).toBe(1);
      const doc = mockChromaClient.capturedDocuments[0]!;
      expect(doc.metadata.document_type).toBeUndefined();
    });
  });

  // ── Metadata Mapping Tests ────────────────────────────────────

  describe("document metadata mapping", () => {
    it("should populate document_type in ChromaDB metadata", async () => {
      const service = createServiceWithDocuments();
      mockScanner.setMockFiles([createMockFile("docs/report.pdf", ".pdf")]);

      await service.indexRepository("https://github.com/test/repo.git");

      const doc = mockChromaClient.capturedDocuments[0]!;
      expect(doc.metadata.document_type).toBe("pdf");
    });

    it("should populate page_number when present", async () => {
      const service = createServiceWithDocuments();
      mockScanner.setMockFiles([createMockFile("docs/report.pdf", ".pdf")]);

      // Set extraction result with pages
      const now = new Date();
      mockExtractor.setResult({
        content: "Page 1 content. Page 2 content.",
        metadata: {
          documentType: "pdf",
          title: "Multi-page Doc",
          filePath: "/tmp/mock-repo/docs/report.pdf",
          fileSizeBytes: 4096,
          contentHash: "page-hash",
          fileModifiedAt: now,
          pageCount: 2,
        },
        pages: [
          { pageNumber: 1, content: "Page 1 content." },
          { pageNumber: 2, content: "Page 2 content." },
        ],
      });

      // Set DocumentChunker to return chunks with page numbers
      mockDocumentChunker.setMockChunks([
        {
          id: "repo:docs/report.pdf:0",
          repository: "repo",
          filePath: "docs/report.pdf",
          content: "Page 1 content.",
          chunkIndex: 0,
          totalChunks: 2,
          startLine: 1,
          endLine: 1,
          metadata: {
            extension: ".pdf",
            language: "unknown",
            fileSizeBytes: 4096,
            contentHash: "chunk-hash-1",
            fileModifiedAt: now,
            documentType: "pdf",
            pageNumber: 1,
            documentTitle: "Multi-page Doc",
          },
        },
        {
          id: "repo:docs/report.pdf:1",
          repository: "repo",
          filePath: "docs/report.pdf",
          content: "Page 2 content.",
          chunkIndex: 1,
          totalChunks: 2,
          startLine: 2,
          endLine: 2,
          metadata: {
            extension: ".pdf",
            language: "unknown",
            fileSizeBytes: 4096,
            contentHash: "chunk-hash-2",
            fileModifiedAt: now,
            documentType: "pdf",
            pageNumber: 2,
            documentTitle: "Multi-page Doc",
          },
        },
      ]);

      await service.indexRepository("https://github.com/test/repo.git");

      expect(mockChromaClient.capturedDocuments.length).toBe(2);
      expect(mockChromaClient.capturedDocuments[0]!.metadata.page_number).toBe(1);
      expect(mockChromaClient.capturedDocuments[1]!.metadata.page_number).toBe(2);
    });

    it("should populate section_heading when present", async () => {
      const service = createServiceWithDocuments();
      mockScanner.setMockFiles([createMockFile("docs/guide.pdf", ".pdf")]);

      const now = new Date();
      mockDocumentChunker.setMockChunks([
        {
          id: "repo:docs/guide.pdf:0",
          repository: "repo",
          filePath: "docs/guide.pdf",
          content: "Introduction content.",
          chunkIndex: 0,
          totalChunks: 1,
          startLine: 1,
          endLine: 5,
          metadata: {
            extension: ".pdf",
            language: "unknown",
            fileSizeBytes: 2048,
            contentHash: "section-hash",
            fileModifiedAt: now,
            documentType: "pdf",
            sectionHeading: "Chapter 1 > Introduction",
            documentTitle: "User Guide",
            documentAuthor: "Doc Team",
          },
        },
      ]);

      await service.indexRepository("https://github.com/test/repo.git");

      const doc = mockChromaClient.capturedDocuments[0]!;
      expect(doc.metadata.section_heading).toBe("Chapter 1 > Introduction");
      expect(doc.metadata.document_title).toBe("User Guide");
      expect(doc.metadata.document_author).toBe("Doc Team");
    });

    it("should not set undefined optional fields in metadata", async () => {
      const service = createServiceWithDocuments();
      mockScanner.setMockFiles([createMockFile("docs/simple.pdf", ".pdf")]);

      const now = new Date();
      // Chunk with no page_number, no section_heading, no author
      mockDocumentChunker.setMockChunks([
        {
          id: "repo:docs/simple.pdf:0",
          repository: "repo",
          filePath: "docs/simple.pdf",
          content: "Simple content.",
          chunkIndex: 0,
          totalChunks: 1,
          startLine: 1,
          endLine: 1,
          metadata: {
            extension: ".pdf",
            language: "unknown",
            fileSizeBytes: 1024,
            contentHash: "simple-hash",
            fileModifiedAt: now,
            documentType: "pdf",
            // pageNumber: undefined (not set)
            // sectionHeading: undefined (not set)
            // documentTitle: undefined (not set)
            // documentAuthor: undefined (not set)
          },
        },
      ]);

      await service.indexRepository("https://github.com/test/repo.git");

      const doc = mockChromaClient.capturedDocuments[0]!;
      expect(doc.metadata.document_type).toBe("pdf");
      expect(doc.metadata.page_number).toBeUndefined();
      expect(doc.metadata.section_heading).toBeUndefined();
      expect(doc.metadata.document_title).toBeUndefined();
      expect(doc.metadata.document_author).toBeUndefined();
    });

    it("should preserve standard metadata fields alongside document metadata", async () => {
      const service = createServiceWithDocuments();
      mockScanner.setMockFiles([createMockFile("docs/report.pdf", ".pdf")]);

      await service.indexRepository("https://github.com/test/repo.git");

      const doc = mockChromaClient.capturedDocuments[0]!;
      // Standard fields should be present
      expect(doc.metadata.file_path).toBeDefined();
      expect(doc.metadata.repository).toBe("repo");
      expect(doc.metadata.chunk_index).toBeDefined();
      expect(doc.metadata.total_chunks).toBeDefined();
      expect(doc.metadata.file_extension).toBeDefined();
      expect(doc.metadata.language).toBeDefined();
      expect(doc.metadata.content_hash).toBeDefined();
      expect(doc.metadata.indexed_at).toBeDefined();
      expect(doc.metadata.file_modified_at).toBeDefined();
      // Document field should also be present
      expect(doc.metadata.document_type).toBe("pdf");
    });
  });

  // ── Extraction Failure Tests ──────────────────────────────────

  describe("extraction failure handling", () => {
    it("should handle extraction failure gracefully and continue batch", async () => {
      const service = createServiceWithDocuments();
      const pdfFile = createMockFile("docs/bad.pdf", ".pdf");
      const tsFile = createMockFile("src/good.ts", ".ts");
      mockScanner.setMockFiles([pdfFile, tsFile]);

      // Make extractor fail for the PDF
      mockExtractor.setShouldFail(true, new Error("PDF extraction failed"));

      const result = await service.indexRepository("https://github.com/test/repo.git");

      // Should be partial success - PDF failed but TS succeeded
      expect(result.status).toBe("partial");
      expect(result.stats.filesProcessed).toBe(1);
      expect(result.stats.filesFailed).toBe(1);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]!.type).toBe("file_error");
      expect(result.errors[0]!.filePath).toBe("docs/bad.pdf");
      expect(result.errors[0]!.message).toContain("PDF extraction failed");

      // The TS file should still be stored
      expect(mockChromaClient.capturedDocuments.length).toBe(1);
      expect(mockChromaClient.capturedDocuments[0]!.metadata.file_path).toBe("src/good.ts");
    });

    it("should handle DocumentChunker failure gracefully", async () => {
      const service = createServiceWithDocuments();
      mockScanner.setMockFiles([createMockFile("docs/report.pdf", ".pdf")]);

      // Make chunker fail
      mockDocumentChunker.setShouldFail(true, new Error("Chunking error in document"));

      const result = await service.indexRepository("https://github.com/test/repo.git");

      expect(result.stats.filesFailed).toBe(1);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]!.message).toContain("Chunking error in document");
    });

    it("should handle missing extractor gracefully", async () => {
      const service = createServiceWithDocuments();
      mockScanner.setMockFiles([createMockFile("docs/report.pdf", ".pdf")]);

      // Set extractor to null
      mockDocumentTypeDetector.setExtractor(null);

      const result = await service.indexRepository("https://github.com/test/repo.git");

      expect(result.stats.filesFailed).toBe(1);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]!.message).toContain("No extractor found");
    });
  });

  // ── Mixed Batch Tests ─────────────────────────────────────────

  describe("mixed batch processing", () => {
    it("should process both code and document files in the same batch", async () => {
      const service = createServiceWithDocuments();
      const files = [
        createMockFile("src/index.ts", ".ts"),
        createMockFile("docs/report.pdf", ".pdf"),
        createMockFile("src/utils.js", ".js"),
      ];
      mockScanner.setMockFiles(files);

      const result = await service.indexRepository("https://github.com/test/repo.git");

      expect(result.status).toBe("success");
      expect(result.stats.filesProcessed).toBe(3);
      expect(result.stats.chunksCreated).toBe(3); // 1 chunk per file in mocks

      // Check that document file has document metadata and code files don't
      const docs = mockChromaClient.capturedDocuments;
      const pdfDoc = docs.find((d) => d.metadata.file_path.endsWith(".pdf"));
      const tsDoc = docs.find((d) => d.metadata.file_path.endsWith(".ts"));
      const jsDoc = docs.find((d) => d.metadata.file_path.endsWith(".js"));

      expect(pdfDoc).toBeDefined();
      expect(pdfDoc!.metadata.document_type).toBe("pdf");
      expect(pdfDoc!.metadata.document_title).toBe("Test Document");

      expect(tsDoc).toBeDefined();
      expect(tsDoc!.metadata.document_type).toBeUndefined();
      expect(tsDoc!.metadata.language).toBe("typescript");

      expect(jsDoc).toBeDefined();
      expect(jsDoc!.metadata.document_type).toBeUndefined();
      expect(jsDoc!.metadata.language).toBe("javascript");
    });

    it("should handle multiple document types in same batch", async () => {
      const service = createServiceWithDocuments();
      const files = [
        createMockFile("docs/report.pdf", ".pdf"),
        createMockFile("docs/spec.docx", ".docx"),
        createMockFile("notes/readme.md", ".md"),
      ];
      mockScanner.setMockFiles(files);

      const result = await service.indexRepository("https://github.com/test/repo.git");

      expect(result.status).toBe("success");
      expect(result.stats.filesProcessed).toBe(3);

      // All should have document_type set
      for (const doc of mockChromaClient.capturedDocuments) {
        expect(doc.metadata.document_type).toBeDefined();
      }
    });
  });

  // ── Stats Tracking Tests ──────────────────────────────────────

  describe("stats tracking", () => {
    it("should count document chunks in chunksCreated stats", async () => {
      const service = createServiceWithDocuments();
      mockScanner.setMockFiles([createMockFile("docs/report.pdf", ".pdf")]);

      const now = new Date();
      // Return 3 chunks from the document
      mockDocumentChunker.setMockChunks([
        {
          id: "repo:docs/report.pdf:0",
          repository: "repo",
          filePath: "docs/report.pdf",
          content: "Chunk 1.",
          chunkIndex: 0,
          totalChunks: 3,
          startLine: 1,
          endLine: 3,
          metadata: {
            extension: ".pdf",
            language: "unknown",
            fileSizeBytes: 4096,
            contentHash: "h1",
            fileModifiedAt: now,
            documentType: "pdf",
          },
        },
        {
          id: "repo:docs/report.pdf:1",
          repository: "repo",
          filePath: "docs/report.pdf",
          content: "Chunk 2.",
          chunkIndex: 1,
          totalChunks: 3,
          startLine: 4,
          endLine: 6,
          metadata: {
            extension: ".pdf",
            language: "unknown",
            fileSizeBytes: 4096,
            contentHash: "h2",
            fileModifiedAt: now,
            documentType: "pdf",
          },
        },
        {
          id: "repo:docs/report.pdf:2",
          repository: "repo",
          filePath: "docs/report.pdf",
          content: "Chunk 3.",
          chunkIndex: 2,
          totalChunks: 3,
          startLine: 7,
          endLine: 9,
          metadata: {
            extension: ".pdf",
            language: "unknown",
            fileSizeBytes: 4096,
            contentHash: "h3",
            fileModifiedAt: now,
            documentType: "pdf",
          },
        },
      ]);

      const result = await service.indexRepository("https://github.com/test/repo.git");

      expect(result.stats.filesProcessed).toBe(1);
      expect(result.stats.chunksCreated).toBe(3);
      expect(result.stats.embeddingsGenerated).toBe(3);
      expect(result.stats.documentsStored).toBe(3);
    });

    it("should track combined stats for mixed code and document files", async () => {
      const service = createServiceWithDocuments();
      const files = [
        createMockFile("src/index.ts", ".ts"),
        createMockFile("docs/report.pdf", ".pdf"),
      ];
      mockScanner.setMockFiles(files);

      const result = await service.indexRepository("https://github.com/test/repo.git");

      // 1 chunk from TS (MockFileChunker default) + 1 chunk from PDF (MockDocumentChunker default)
      expect(result.stats.filesProcessed).toBe(2);
      expect(result.stats.chunksCreated).toBe(2);
      expect(result.stats.embeddingsGenerated).toBe(2);
      expect(result.stats.documentsStored).toBe(2);
    });
  });

  // ── Backwards Compatibility Tests ─────────────────────────────

  describe("backwards compatibility", () => {
    it("should work identically to before when no document options passed", async () => {
      const service = createServiceWithoutDocuments();
      const tsFile = createMockFile("src/index.ts", ".ts");
      mockScanner.setMockFiles([tsFile]);

      const result = await service.indexRepository("https://github.com/test/repo.git");

      expect(result.status).toBe("success");
      expect(result.stats.filesProcessed).toBe(1);
      expect(result.stats.chunksCreated).toBe(1);
    });

    it("should work when empty options object is passed", async () => {
      const service = new IngestionService(
        mockCloner as any,
        mockScanner as any,
        mockFileChunker as any,
        mockEmbeddingProvider,
        mockChromaClient,
        mockRepoService,
        {} // Empty options - no document dependencies
      );

      const tsFile = createMockFile("src/index.ts", ".ts");
      mockScanner.setMockFiles([tsFile]);

      const result = await service.indexRepository("https://github.com/test/repo.git");

      expect(result.status).toBe("success");
      expect(result.stats.filesProcessed).toBe(1);
    });
  });
});
