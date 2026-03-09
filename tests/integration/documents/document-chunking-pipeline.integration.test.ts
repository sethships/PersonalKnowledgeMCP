/**
 * Integration tests for the document chunking pipeline (Issue #371).
 *
 * Tests the end-to-end flow: DocumentTypeDetector -> real extractors
 * (PdfExtractor, DocxExtractor, MarkdownParser) -> DocumentChunker
 * -> embeddings -> ChromaDB storage.
 *
 * Real components: DocumentTypeDetector, extractors, DocumentChunker,
 * ChromaStorageClientImpl, RepositoryMetadataStoreImpl, FileChunker.
 * Mocked: EmbeddingProvider (deterministic hash), RepositoryCloner, FileScanner.
 *
 * Requires a running ChromaDB instance. Gate with RUN_INTEGRATION_TESTS=true.
 *
 * @module tests/integration/documents/document-chunking-pipeline.integration.test
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable @typescript-eslint/no-unused-vars */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";
import { IngestionService } from "../../../src/services/ingestion-service.js";
import { ChromaStorageClientImpl } from "../../../src/storage/chroma-client.js";
import { RepositoryMetadataStoreImpl } from "../../../src/repositories/metadata-store.js";
import { DocumentChunker } from "../../../src/documents/DocumentChunker.js";
import { DocumentTypeDetector } from "../../../src/documents/DocumentTypeDetector.js";
import { FileChunker } from "../../../src/ingestion/file-chunker.js";
import { createMinimalPdf } from "../../fixtures/documents/pdf-fixtures.js";
import type { EmbeddingProvider } from "../../../src/providers/types.js";
import type { RepositoryCloner } from "../../../src/ingestion/repository-cloner.js";
import type { FileScanner } from "../../../src/ingestion/file-scanner.js";
import type { CloneResult, FileInfo } from "../../../src/ingestion/types.js";
import { initializeLogger, resetLogger } from "../../../src/logging/index.js";

// Only run these tests if explicitly enabled (requires running ChromaDB)
const shouldRunIntegrationTests = Bun.env["RUN_INTEGRATION_TESTS"] === "true";
const describeIntegration = shouldRunIntegrationTests ? describe : describe.skip;

/**
 * Mock EmbeddingProvider for integration tests.
 *
 * Generates deterministic embeddings based on text content hash.
 * Same pattern as semantic-search-documents.integration.test.ts.
 */
class MockEmbeddingProvider implements EmbeddingProvider {
  public readonly providerId = "mock";
  public readonly modelId = "mock-model";
  public readonly dimensions = 1536;

  async generateEmbedding(text: string): Promise<number[]> {
    const hash = this.hashString(text);
    return Array.from({ length: this.dimensions }, (_, i) => Math.sin(hash + i) * 0.5);
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.generateEmbedding(t)));
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

/**
 * Create a mock RepositoryCloner that returns the given fixture path.
 */
function createMockCloner(fixturePath: string): RepositoryCloner {
  return {
    clone: async (_url: string, _options?: any): Promise<CloneResult> => ({
      path: fixturePath,
      name: "test-docs",
      branch: "main",
      commitSha: "abc123def456",
    }),
    cleanup: async (_repoPath: string): Promise<void> => {
      // No-op: test fixtures are cleaned up by afterAll
    },
  } as unknown as RepositoryCloner;
}

/**
 * Create a mock FileScanner that returns controlled FileInfo arrays.
 */
function createMockFileScanner(files: FileInfo[]): FileScanner {
  return {
    scanFiles: async (_repoPath: string, _options?: any): Promise<FileInfo[]> => files,
  } as unknown as FileScanner;
}

describeIntegration("Document Chunking Pipeline Integration Tests", () => {
  const testRunId = Date.now();
  const testDataPath = path.join(os.tmpdir(), `doc-chunking-intg-${testRunId}`);
  const testChromaHost = process.env["CHROMADB_HOST"] || "localhost";
  const testChromaPort = parseInt(process.env["CHROMADB_PORT"] || "8000", 10);

  let storageClient: ChromaStorageClientImpl;
  let repositoryService: RepositoryMetadataStoreImpl;
  let embeddingProvider: MockEmbeddingProvider;
  let documentChunker: DocumentChunker;
  let documentTypeDetector: DocumentTypeDetector;
  let fileChunker: FileChunker;

  // Track all collections created during tests for cleanup
  const createdCollections: string[] = [];

  // Fixture paths
  let fixtureDir: string;
  let pdfDir: string;
  let docxDir: string;
  let mdDir: string;

  beforeAll(async () => {
    initializeLogger({ level: "error", format: "json" });

    // Setup test data directory
    if (fs.existsSync(testDataPath)) {
      fs.rmSync(testDataPath, { recursive: true, force: true });
    }
    fs.mkdirSync(testDataPath, { recursive: true });

    // Setup fixture directory
    fixtureDir = path.join(testDataPath, "fixtures");
    pdfDir = path.join(fixtureDir, "docs");
    docxDir = pdfDir; // PDF and DOCX share the docs/ directory intentionally
    mdDir = path.join(fixtureDir, "notes");

    fs.mkdirSync(pdfDir, { recursive: true });
    fs.mkdirSync(mdDir, { recursive: true });

    // Create PDF fixtures
    const simplePdf = createMinimalPdf({
      pages: ["This is a simple test PDF document with one page of content."],
    });
    fs.writeFileSync(path.join(pdfDir, "simple.pdf"), simplePdf);

    const withMetadataPdf = createMinimalPdf({
      pages: ["This document has metadata including title and author information."],
      title: "Test PDF",
      author: "PDF Author",
    });
    fs.writeFileSync(path.join(pdfDir, "with-metadata.pdf"), withMetadataPdf);

    const multiPagePdf = createMinimalPdf({
      pages: [
        "Page 1: Introduction to the multi-page document.",
        "Page 2: The main content and details section.",
        "Page 3: Conclusion and summary of findings.",
      ],
      title: "Multi-Page Report",
      author: "Test Author",
    });
    fs.writeFileSync(path.join(pdfDir, "multi-page.pdf"), multiPagePdf);

    // Copy DOCX fixtures from project fixtures
    const docxFixtureDir = path.resolve(__dirname, "../../fixtures/documents/docx");
    for (const file of ["simple.docx", "with-headings.docx", "with-metadata.docx"]) {
      const src = path.join(docxFixtureDir, file);
      const dest = path.join(docxDir, file);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
      }
    }

    // Copy Markdown fixtures from project fixtures
    const mdFixtureDir = path.resolve(__dirname, "../../fixtures/documents/markdown");
    for (const file of ["simple.md", "with-frontmatter.md"]) {
      const src = path.join(mdFixtureDir, file);
      const dest = path.join(mdDir, file);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
      }
    }

    // Initialize shared dependencies
    embeddingProvider = new MockEmbeddingProvider();
    storageClient = new ChromaStorageClientImpl({
      host: testChromaHost,
      port: testChromaPort,
    });
    await storageClient.connect();

    repositoryService = RepositoryMetadataStoreImpl.getInstance(testDataPath);
    documentChunker = new DocumentChunker({ maxChunkTokens: 500 });
    documentTypeDetector = new DocumentTypeDetector();
    fileChunker = new FileChunker();
  });

  afterAll(async () => {
    // Cleanup all test collections from ChromaDB
    for (const collectionName of createdCollections) {
      try {
        await storageClient.deleteCollection(collectionName);
      } catch (_error) {
        // Ignore errors during cleanup
      }
    }

    // Cleanup test data directory
    if (fs.existsSync(testDataPath)) {
      fs.rmSync(testDataPath, { recursive: true, force: true });
    }

    RepositoryMetadataStoreImpl.resetInstance();
    resetLogger();
  });

  beforeEach(async () => {
    // Clean up all tracked collections for isolation
    for (const collectionName of createdCollections) {
      try {
        await storageClient.deleteCollection(collectionName);
      } catch (_error) {
        // Ignore if collection does not exist
      }
    }
    createdCollections.length = 0;

    // Clean up repository metadata from previous tests
    const allRepos = await repositoryService.listRepositories();
    for (const repo of allRepos) {
      if (repo.name.startsWith("doc-pipeline-")) {
        try {
          await repositoryService.removeRepository(repo.name);
        } catch (_error) {
          // Ignore cleanup errors
        }
      }
    }
  });

  // ---------------------------------------------------------------------------
  // Helper: Create IngestionService with mocked cloner/scanner, real everything else
  // ---------------------------------------------------------------------------
  function createIngestionService(files: FileInfo[]): IngestionService {
    const mockCloner = createMockCloner(fixtureDir);
    const mockScanner = createMockFileScanner(files);

    return new IngestionService(
      mockCloner,
      mockScanner,
      fileChunker,
      embeddingProvider,
      storageClient,
      repositoryService,
      {
        documentChunker,
        documentTypeDetector,
      }
    );
  }

  /**
   * Create FileInfo for a fixture file on disk.
   */
  function createFileInfo(relativePath: string, absolutePath: string): FileInfo {
    const stats = fs.statSync(absolutePath);
    return {
      relativePath,
      absolutePath,
      extension: path.extname(absolutePath).toLowerCase(),
      sizeBytes: stats.size,
      modifiedAt: stats.mtime,
    };
  }

  /**
   * Track a collection name from a repository URL for cleanup.
   *
   * Reproduces the exact logic from IngestionService.extractRepositoryName()
   * and IngestionService.sanitizeCollectionName() to ensure test collection
   * names match what the service creates internally.
   */
  function trackCollectionFromUrl(url: string): string {
    // Match IngestionService.extractRepositoryName() exactly
    const match = url.match(/[/:]([^/:]+?)(\.git)?$/);
    const repoName = match?.[1]?.replace(".git", "") ?? "unknown";

    // Match IngestionService.sanitizeCollectionName() exactly
    let collectionName = repoName
      .toLowerCase()
      .replace(/[^a-z0-9_.-]/g, "_")
      .replace(/^[^a-z0-9]+/, "")
      .replace(/[^a-z0-9]+$/, "");
    if (collectionName.length < 3) {
      collectionName = collectionName.padEnd(3, "_");
    }
    if (collectionName.length > 63) {
      collectionName = collectionName.substring(0, 63);
    }

    createdCollections.push(collectionName);
    return collectionName;
  }

  // ---------------------------------------------------------------------------
  // PDF Pipeline
  // ---------------------------------------------------------------------------
  describe("PDF pipeline", () => {
    it("extracts, chunks, embeds, stores single-page PDF with metadata", async () => {
      const pdfPath = path.join(pdfDir, "with-metadata.pdf");
      const files = [createFileInfo("docs/with-metadata.pdf", pdfPath)];
      const service = createIngestionService(files);

      const url = "https://github.com/test/doc-pipeline-pdf-meta.git";
      const collectionName = trackCollectionFromUrl(url);

      const result = await service.indexRepository(url);

      expect(result.status).toBe("success");
      expect(result.stats.filesProcessed).toBe(1);
      expect(result.stats.chunksCreated).toBeGreaterThan(0);
      expect(result.stats.documentsStored).toBeGreaterThan(0);

      // Verify stored documents in ChromaDB
      const stats = await storageClient.getCollectionStats(collectionName);
      expect(stats.documentCount).toBeGreaterThan(0);

      const docs = await storageClient.getDocumentsByMetadata(collectionName, {
        repository: "doc-pipeline-pdf-meta",
      });
      expect(docs.length).toBeGreaterThan(0);

      // Verify document metadata
      const doc = docs[0]!;
      expect(doc.metadata.document_type).toBe("pdf");
      expect(doc.metadata.file_extension).toBe(".pdf");
      expect(doc.metadata.repository).toBe("doc-pipeline-pdf-meta");
      expect(doc.metadata.file_path).toBe("docs/with-metadata.pdf");
      expect(doc.metadata.indexed_at).toBeDefined();
      expect(doc.metadata.chunk_index).toBeDefined();
      expect(typeof doc.metadata.chunk_index).toBe("number");

      // PDF metadata fields
      expect(doc.metadata.document_title).toBe("Test PDF");
      expect(doc.metadata.document_author).toBe("PDF Author");
    });

    it("handles multi-page PDF with page numbers in metadata", async () => {
      const pdfPath = path.join(pdfDir, "multi-page.pdf");
      const files = [createFileInfo("docs/multi-page.pdf", pdfPath)];
      const service = createIngestionService(files);

      const url = "https://github.com/test/doc-pipeline-pdf-pages.git";
      const collectionName = trackCollectionFromUrl(url);

      const result = await service.indexRepository(url);

      expect(result.status).toBe("success");
      expect(result.stats.filesProcessed).toBe(1);

      const docs = await storageClient.getDocumentsByMetadata(collectionName, {
        repository: "doc-pipeline-pdf-pages",
      });
      expect(docs.length).toBeGreaterThanOrEqual(3); // At least one chunk per page

      // Verify page numbers are present
      const pageNumbers = docs.map((d) => d.metadata.page_number).filter((p) => p !== undefined);
      expect(pageNumbers.length).toBeGreaterThan(0);

      // Verify title/author from multi-page PDF
      expect(docs[0]!.metadata.document_title).toBe("Multi-Page Report");
      expect(docs[0]!.metadata.document_author).toBe("Test Author");
    });
  });

  // ---------------------------------------------------------------------------
  // DOCX Pipeline
  // ---------------------------------------------------------------------------
  describe("DOCX pipeline", () => {
    it("extracts, chunks, embeds, stores DOCX with headings/sections", async () => {
      const docxPath = path.join(docxDir, "with-headings.docx");

      // Guard: fixture must exist for meaningful test
      expect(fs.existsSync(docxPath)).toBe(true);

      const files = [createFileInfo("docs/with-headings.docx", docxPath)];
      const service = createIngestionService(files);

      const url = "https://github.com/test/doc-pipeline-docx-headings.git";
      const collectionName = trackCollectionFromUrl(url);

      const result = await service.indexRepository(url);

      expect(result.status).toBe("success");
      expect(result.stats.filesProcessed).toBe(1);
      expect(result.stats.chunksCreated).toBeGreaterThan(0);

      const docs = await storageClient.getDocumentsByMetadata(collectionName, {
        repository: "doc-pipeline-docx-headings",
      });
      expect(docs.length).toBeGreaterThan(0);

      // Verify DOCX document type metadata
      const doc = docs[0]!;
      expect(doc.metadata.document_type).toBe("docx");
      expect(doc.metadata.file_extension).toBe(".docx");
      expect(doc.metadata.repository).toBe("doc-pipeline-docx-headings");
      expect(doc.metadata.file_path).toBe("docs/with-headings.docx");
      expect(doc.content).toBeTruthy();
    });

    it("extracts Dublin Core metadata (title, author) from DOCX", async () => {
      const docxPath = path.join(docxDir, "with-metadata.docx");

      // Guard: fixture must exist for meaningful test
      expect(fs.existsSync(docxPath)).toBe(true);

      const files = [createFileInfo("docs/with-metadata.docx", docxPath)];
      const service = createIngestionService(files);

      const url = "https://github.com/test/doc-pipeline-docx-meta.git";
      const collectionName = trackCollectionFromUrl(url);

      const result = await service.indexRepository(url);

      expect(result.status).toBe("success");
      expect(result.stats.filesProcessed).toBe(1);

      const docs = await storageClient.getDocumentsByMetadata(collectionName, {
        repository: "doc-pipeline-docx-meta",
      });
      expect(docs.length).toBeGreaterThan(0);

      // Verify Dublin Core metadata was extracted and stored
      const doc = docs[0]!;
      expect(doc.metadata.document_type).toBe("docx");

      // The with-metadata.docx fixture has Dublin Core title/author
      expect(doc.metadata.document_title).toBeDefined();
      expect(typeof doc.metadata.document_title).toBe("string");
      expect(doc.metadata.document_author).toBeDefined();
      expect(typeof doc.metadata.document_author).toBe("string");
    });
  });

  // ---------------------------------------------------------------------------
  // Markdown Pipeline
  // ---------------------------------------------------------------------------
  describe("Markdown pipeline", () => {
    it("extracts, chunks, embeds, stores markdown with sections", async () => {
      const mdPath = path.join(mdDir, "simple.md");

      // Guard: fixture must exist for meaningful test
      expect(fs.existsSync(mdPath)).toBe(true);

      const files = [createFileInfo("notes/simple.md", mdPath)];
      const service = createIngestionService(files);

      const url = "https://github.com/test/doc-pipeline-md-simple.git";
      const collectionName = trackCollectionFromUrl(url);

      const result = await service.indexRepository(url);

      expect(result.status).toBe("success");
      expect(result.stats.filesProcessed).toBe(1);
      expect(result.stats.chunksCreated).toBeGreaterThan(0);

      const docs = await storageClient.getDocumentsByMetadata(collectionName, {
        repository: "doc-pipeline-md-simple",
      });
      expect(docs.length).toBeGreaterThan(0);

      // Verify markdown document type
      const doc = docs[0]!;
      expect(doc.metadata.document_type).toBe("markdown");
      expect(doc.metadata.file_extension).toBe(".md");
      expect(doc.metadata.repository).toBe("doc-pipeline-md-simple");
      expect(doc.metadata.file_path).toBe("notes/simple.md");

      // The simple.md has sections "Section One" and "Section Two"
      // Section heading context should be populated
      const sectionHeadings = docs
        .map((d) => d.metadata.section_heading)
        .filter((h) => h !== undefined && h !== null);
      expect(sectionHeadings.length).toBeGreaterThan(0);
    });

    it("extracts frontmatter metadata (title, author) from markdown", async () => {
      const mdPath = path.join(mdDir, "with-frontmatter.md");

      // Guard: fixture must exist for meaningful test
      expect(fs.existsSync(mdPath)).toBe(true);

      const files = [createFileInfo("notes/with-frontmatter.md", mdPath)];
      const service = createIngestionService(files);

      const url = "https://github.com/test/doc-pipeline-md-frontmatter.git";
      const collectionName = trackCollectionFromUrl(url);

      const result = await service.indexRepository(url);

      expect(result.status).toBe("success");
      expect(result.stats.filesProcessed).toBe(1);

      const docs = await storageClient.getDocumentsByMetadata(collectionName, {
        repository: "doc-pipeline-md-frontmatter",
      });
      expect(docs.length).toBeGreaterThan(0);

      // Verify frontmatter metadata was extracted
      const doc = docs[0]!;
      expect(doc.metadata.document_type).toBe("markdown");
      expect(doc.metadata.document_title).toBe("Frontmatter Test Document");
      expect(doc.metadata.document_author).toBe("Test Author");
    });
  });

  // ---------------------------------------------------------------------------
  // Mixed document types
  // ---------------------------------------------------------------------------
  describe("Mixed document types", () => {
    it("processes PDF, DOCX, and Markdown in single indexing batch", async () => {
      const pdfPath = path.join(pdfDir, "simple.pdf");
      const docxPath = path.join(docxDir, "simple.docx");
      const mdPath = path.join(mdDir, "simple.md");

      // Collect only files that exist
      const files: FileInfo[] = [];
      if (fs.existsSync(pdfPath)) {
        files.push(createFileInfo("docs/simple.pdf", pdfPath));
      }
      if (fs.existsSync(docxPath)) {
        files.push(createFileInfo("docs/simple.docx", docxPath));
      }
      if (fs.existsSync(mdPath)) {
        files.push(createFileInfo("notes/simple.md", mdPath));
      }

      // Guard: need at least 2 document types for a meaningful test
      expect(files.length).toBeGreaterThanOrEqual(2);

      const service = createIngestionService(files);
      const url = "https://github.com/test/doc-pipeline-mixed.git";
      const collectionName = trackCollectionFromUrl(url);

      const result = await service.indexRepository(url);

      expect(result.status).toBe("success");
      expect(result.stats.filesProcessed).toBe(files.length);
      expect(result.stats.chunksCreated).toBeGreaterThan(0);
      expect(result.stats.documentsStored).toBeGreaterThan(0);

      // Verify all documents stored
      const docs = await storageClient.getDocumentsByMetadata(collectionName, {
        repository: "doc-pipeline-mixed",
      });
      expect(docs.length).toBeGreaterThan(0);

      // Verify multiple document types present
      const docTypes = new Set(docs.map((d) => d.metadata.document_type));
      expect(docTypes.size).toBeGreaterThanOrEqual(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Metadata verification
  // ---------------------------------------------------------------------------
  describe("Metadata verification", () => {
    it("stores all document-specific metadata in ChromaDB", async () => {
      const pdfPath = path.join(pdfDir, "with-metadata.pdf");
      const files = [createFileInfo("docs/with-metadata.pdf", pdfPath)];
      const service = createIngestionService(files);

      const url = "https://github.com/test/doc-pipeline-meta-full.git";
      const collectionName = trackCollectionFromUrl(url);

      await service.indexRepository(url);

      const docs = await storageClient.getDocumentsByMetadata(collectionName, {
        repository: "doc-pipeline-meta-full",
      });
      expect(docs.length).toBeGreaterThan(0);

      const doc = docs[0]!;

      // Document-specific metadata
      expect(doc.metadata.document_type).toBe("pdf");
      expect(doc.metadata.document_title).toBe("Test PDF");
      expect(doc.metadata.document_author).toBe("PDF Author");

      // Standard metadata should also be present
      expect(doc.metadata.file_path).toBe("docs/with-metadata.pdf");
      expect(doc.metadata.repository).toBe("doc-pipeline-meta-full");
      expect(doc.metadata.file_extension).toBe(".pdf");
      expect(typeof doc.metadata.chunk_index).toBe("number");
      expect(typeof doc.metadata.total_chunks).toBe("number");
      expect(typeof doc.metadata.file_size_bytes).toBe("number");
      expect(doc.metadata.content_hash).toBeDefined();
      expect(doc.metadata.indexed_at).toBeDefined();
      expect(doc.metadata.file_modified_at).toBeDefined();
    });

    it("preserves standard metadata alongside document metadata", async () => {
      const mdPath = path.join(mdDir, "with-frontmatter.md");

      // Guard: fixture must exist for meaningful test
      expect(fs.existsSync(mdPath)).toBe(true);

      const files = [createFileInfo("notes/with-frontmatter.md", mdPath)];
      const service = createIngestionService(files);

      const url = "https://github.com/test/doc-pipeline-meta-std.git";
      const collectionName = trackCollectionFromUrl(url);

      await service.indexRepository(url);

      const docs = await storageClient.getDocumentsByMetadata(collectionName, {
        repository: "doc-pipeline-meta-std",
      });
      expect(docs.length).toBeGreaterThan(0);

      for (const doc of docs) {
        // Standard metadata fields should be present on every chunk
        expect(doc.metadata.file_path).toBeDefined();
        expect(doc.metadata.repository).toBe("doc-pipeline-meta-std");
        expect(doc.metadata.chunk_index).toBeDefined();
        expect(doc.metadata.total_chunks).toBeDefined();
        expect(doc.metadata.chunk_start_line).toBeDefined();
        expect(doc.metadata.chunk_end_line).toBeDefined();
        expect(doc.metadata.file_extension).toBe(".md");
        expect(doc.metadata.content_hash).toBeDefined();
        expect(doc.metadata.indexed_at).toBeDefined();

        // Document metadata
        expect(doc.metadata.document_type).toBe("markdown");
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Re-indexing behavior
  // ---------------------------------------------------------------------------
  describe("Re-indexing behavior", () => {
    it("replaces collection data on force=true (not doubled)", async () => {
      const pdfPath = path.join(pdfDir, "simple.pdf");
      const files = [createFileInfo("docs/simple.pdf", pdfPath)];
      const service = createIngestionService(files);

      const url = "https://github.com/test/doc-pipeline-reindex.git";
      const collectionName = trackCollectionFromUrl(url);

      // First indexing
      const result1 = await service.indexRepository(url);
      expect(result1.status).toBe("success");
      const firstCount = result1.stats.documentsStored;
      expect(firstCount).toBeGreaterThan(0);

      const stats1 = await storageClient.getCollectionStats(collectionName);
      expect(stats1.documentCount).toBe(firstCount);

      // Second indexing with force
      const result2 = await service.indexRepository(url, { force: true });
      expect(result2.status).toBe("success");

      // Document count should be the same (not doubled)
      const stats2 = await storageClient.getCollectionStats(collectionName);
      expect(stats2.documentCount).toBe(firstCount);
    });

    it("preserves correct metadata after re-index", async () => {
      const pdfPath = path.join(pdfDir, "with-metadata.pdf");
      const files = [createFileInfo("docs/with-metadata.pdf", pdfPath)];
      const service = createIngestionService(files);

      const url = "https://github.com/test/doc-pipeline-reindex-meta.git";
      const collectionName = trackCollectionFromUrl(url);

      // First indexing
      await service.indexRepository(url);
      const docs1 = await storageClient.getDocumentsByMetadata(collectionName, {
        repository: "doc-pipeline-reindex-meta",
      });
      const firstIndexedAt = docs1[0]!.metadata.indexed_at;

      // Brief pause so indexed_at differs
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Re-index with force
      await service.indexRepository(url, { force: true });
      const docs2 = await storageClient.getDocumentsByMetadata(collectionName, {
        repository: "doc-pipeline-reindex-meta",
      });

      // Document count should match
      expect(docs2.length).toBe(docs1.length);

      // Metadata should be fresh (indexed_at updated)
      expect(docs2[0]!.metadata.indexed_at).not.toBe(firstIndexedAt);

      // Document metadata should still be correct
      expect(docs2[0]!.metadata.document_type).toBe("pdf");
      expect(docs2[0]!.metadata.document_title).toBe("Test PDF");
      expect(docs2[0]!.metadata.document_author).toBe("PDF Author");
    });
  });

  // ---------------------------------------------------------------------------
  // Error resilience
  // ---------------------------------------------------------------------------
  describe("Error resilience", () => {
    it("continues processing when one file in batch fails", async () => {
      const pdfPath = path.join(pdfDir, "simple.pdf");
      const corruptPath = path.join(pdfDir, "corrupt.pdf");

      // Create a corrupt PDF file
      fs.writeFileSync(corruptPath, Buffer.from("This is not a valid PDF file"));

      const files = [
        createFileInfo("docs/corrupt.pdf", corruptPath),
        createFileInfo("docs/simple.pdf", pdfPath),
      ];
      const service = createIngestionService(files);

      const url = "https://github.com/test/doc-pipeline-error.git";
      const collectionName = trackCollectionFromUrl(url);

      const result = await service.indexRepository(url);

      // Pipeline should still complete (partial success when some files fail)
      expect(["success", "partial"]).toContain(result.status);
      // At least the good file should be processed
      expect(result.stats.filesProcessed).toBeGreaterThanOrEqual(1);
      // The corrupt file should fail
      expect(result.stats.filesFailed).toBeGreaterThanOrEqual(1);
      // Should have some errors recorded
      expect(result.errors.length).toBeGreaterThanOrEqual(1);

      // The valid PDF's chunks should be stored
      const docs = await storageClient.getDocumentsByMetadata(collectionName, {
        repository: "doc-pipeline-error",
      });
      expect(docs.length).toBeGreaterThan(0);
      expect(docs[0]!.metadata.document_type).toBe("pdf");
    });
  });
});
