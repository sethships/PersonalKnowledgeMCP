/**
 * Integration tests for semantic_search MCP tool with include_documents=true
 *
 * Tests the parallel code + document search behavior when include_documents is enabled.
 * Validates merged results, sorting, limiting, metadata format, graceful degradation
 * when DocumentSearchService is unavailable, and legacy (code-only) behavior.
 *
 * Requires a running ChromaDB instance. Gate with RUN_INTEGRATION_TESTS=true.
 *
 * @module tests/integration/mcp/tools/semantic-search-documents.integration.test
 */

/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { SearchServiceImpl } from "../../../../src/services/search-service.js";
import { DocumentSearchServiceImpl } from "../../../../src/services/document-search-service.js";
import { ChromaStorageClientImpl } from "../../../../src/storage/chroma-client.js";
import { RepositoryMetadataStoreImpl } from "../../../../src/repositories/metadata-store.js";
import { createSemanticSearchHandler } from "../../../../src/mcp/tools/semantic-search.js";
import type {
  EmbeddingProvider,
  EmbeddingProviderConfig,
} from "../../../../src/providers/types.js";
import type { DocumentInput } from "../../../../src/storage/types.js";
import { initializeLogger, resetLogger } from "../../../../src/logging/index.js";
import fs from "fs";
import path from "path";
import os from "os";

// Only run these tests if explicitly enabled (requires running ChromaDB)
const shouldRunIntegrationTests = Bun.env["RUN_INTEGRATION_TESTS"] === "true";
const describeIntegration = shouldRunIntegrationTests ? describe : describe.skip;

/**
 * Mock EmbeddingProvider for integration tests
 *
 * Generates deterministic embeddings based on text content hash. This allows
 * testing similarity search behavior without external API dependencies.
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
 * Mock EmbeddingProviderFactory for integration tests
 *
 * Returns the same mock provider regardless of configuration, enabling
 * consistent behavior across code and document search services.
 */
class MockEmbeddingProviderFactory {
  private mockProvider: EmbeddingProvider;

  constructor(provider: EmbeddingProvider) {
    this.mockProvider = provider;
  }

  createProvider(_config: EmbeddingProviderConfig): EmbeddingProvider {
    return this.mockProvider;
  }
}

describeIntegration("semantic_search MCP Tool with include_documents Integration Tests", () => {
  // Use timestamp-based suffixes to avoid collection name collisions across parallel runs
  const testRunId = Date.now();
  const testDataPath = path.join(os.tmpdir(), `semantic-search-docs-integration-${testRunId}`);
  const testChromaHost = process.env["CHROMADB_HOST"] || "localhost";
  const testChromaPort = parseInt(process.env["CHROMADB_PORT"] || "8000", 10);

  // Collection name prefixes for test isolation
  const codeCollectionPrefix = `code_intg_${testRunId}`;
  const docCollectionPrefix = `doc_intg_${testRunId}`;

  let searchService: SearchServiceImpl;
  let documentSearchService: DocumentSearchServiceImpl;
  let embeddingProvider: MockEmbeddingProvider;
  let embeddingProviderFactory: MockEmbeddingProviderFactory;
  let storageClient: ChromaStorageClientImpl;
  let repositoryService: RepositoryMetadataStoreImpl;

  // Track all collections created during tests for cleanup
  const createdCollections: string[] = [];

  beforeAll(async () => {
    initializeLogger({ level: "error", format: "json" });

    // Setup test data directory for repository metadata
    if (fs.existsSync(testDataPath)) {
      fs.rmSync(testDataPath, { recursive: true, force: true });
    }
    fs.mkdirSync(testDataPath, { recursive: true });

    // Initialize shared dependencies
    embeddingProvider = new MockEmbeddingProvider();
    embeddingProviderFactory = new MockEmbeddingProviderFactory(embeddingProvider);

    storageClient = new ChromaStorageClientImpl({
      host: testChromaHost,
      port: testChromaPort,
    });
    await storageClient.connect();

    repositoryService = RepositoryMetadataStoreImpl.getInstance(testDataPath);

    // Create both search services sharing the same storage and repository service
    searchService = new SearchServiceImpl(
      embeddingProvider,
      embeddingProviderFactory,
      storageClient,
      repositoryService
    );

    documentSearchService = new DocumentSearchServiceImpl(
      embeddingProvider,
      embeddingProviderFactory,
      storageClient,
      repositoryService
    );
  });

  afterAll(async () => {
    // Cleanup all test collections from ChromaDB
    for (const collectionName of createdCollections) {
      try {
        await storageClient.deleteCollection(collectionName);
      } catch (_error) {
        // Ignore errors during cleanup - collection may not exist
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
    // Clean up all tracked collections before each test for isolation
    for (const collectionName of createdCollections) {
      try {
        await storageClient.deleteCollection(collectionName);
      } catch (_error) {
        // Ignore if collection does not exist
      }
    }
    createdCollections.length = 0;
  });

  // ---------------------------------------------------------------------------
  // Helper: Index a code repository with chunks in ChromaDB
  // ---------------------------------------------------------------------------
  async function indexCodeRepository(
    repoName: string,
    documents: Array<{ content: string; filePath: string; chunkIndex: number }>
  ): Promise<string> {
    const collectionName = `${codeCollectionPrefix}_${repoName.replace(/[^a-z0-9]/gi, "_")}`;
    createdCollections.push(collectionName);

    // Register repository metadata
    await repositoryService.updateRepository({
      name: repoName,
      url: `https://github.com/test/${repoName}`,
      localPath: path.join(os.tmpdir(), repoName),
      collectionName,
      status: "ready",
      fileCount: documents.length,
      chunkCount: documents.length,
      lastIndexedAt: new Date().toISOString(),
      indexDurationMs: 500,
      branch: "main",
      includeExtensions: [".ts", ".js", ".md"],
      excludePatterns: ["node_modules"],
    });

    // Generate embeddings and prepare documents
    const embeddings = await embeddingProvider.generateEmbeddings(documents.map((d) => d.content));

    const documentInputs: DocumentInput[] = documents.map((doc, index) => {
      const ext = path.extname(doc.filePath);
      const language =
        ext === ".ts" || ext === ".tsx"
          ? "typescript"
          : ext === ".js" || ext === ".jsx"
            ? "javascript"
            : "unknown";

      return {
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
          file_extension: ext,
          language,
          file_size_bytes: doc.content.length,
          content_hash: `hash_code_${index}`,
          indexed_at: new Date().toISOString(),
          file_modified_at: new Date().toISOString(),
        },
      };
    });

    await storageClient.addDocuments(collectionName, documentInputs);
    return collectionName;
  }

  // ---------------------------------------------------------------------------
  // Helper: Index a document folder with chunks in ChromaDB
  // ---------------------------------------------------------------------------
  async function indexDocumentFolder(
    folderName: string,
    documents: Array<{
      content: string;
      documentPath: string;
      chunkIndex: number;
      documentType: string;
      pageNumber?: number;
      sectionHeading?: string;
      documentTitle?: string;
      documentAuthor?: string;
    }>
  ): Promise<string> {
    const collectionName = `${docCollectionPrefix}_${folderName.replace(/[^a-z0-9]/gi, "_")}`;
    createdCollections.push(collectionName);

    // Document folders are stored as repositories in the metadata service
    await repositoryService.updateRepository({
      name: folderName,
      url: `file://${folderName}`,
      localPath: path.join(os.tmpdir(), folderName),
      collectionName,
      status: "ready",
      fileCount: documents.length,
      chunkCount: documents.length,
      lastIndexedAt: new Date().toISOString(),
      indexDurationMs: 300,
      branch: "main",
      includeExtensions: [".pdf", ".docx", ".md", ".txt"],
      excludePatterns: [],
    });

    // Generate embeddings
    const embeddings = await embeddingProvider.generateEmbeddings(documents.map((d) => d.content));

    const documentInputs: DocumentInput[] = documents.map((doc, index) => {
      const ext = path.extname(doc.documentPath);

      return {
        id: `${folderName}:${doc.documentPath}:${doc.chunkIndex}`,
        content: doc.content,
        embedding: embeddings[index]!,
        metadata: {
          file_path: doc.documentPath,
          repository: folderName,
          chunk_index: doc.chunkIndex,
          total_chunks: 1,
          chunk_start_line: 1,
          chunk_end_line: 10,
          file_extension: ext,
          language: "unknown",
          file_size_bytes: doc.content.length,
          content_hash: `hash_doc_${index}`,
          indexed_at: new Date().toISOString(),
          file_modified_at: new Date().toISOString(),
          // Document-specific metadata
          document_type: doc.documentType,
          ...(doc.pageNumber !== undefined && { page_number: doc.pageNumber }),
          ...(doc.sectionHeading && { section_heading: doc.sectionHeading }),
          ...(doc.documentTitle && { document_title: doc.documentTitle }),
          ...(doc.documentAuthor && { document_author: doc.documentAuthor }),
        },
      };
    });

    await storageClient.addDocuments(collectionName, documentInputs);
    return collectionName;
  }

  // ---------------------------------------------------------------------------
  // Helper: Parse the JSON response from a tool handler result
  // ---------------------------------------------------------------------------
  function parseHandlerResponse(result: any): any {
    expect(result.isError).toBe(false);
    const textContent = result.content[0] as { type: "text"; text: string };
    expect(textContent.type).toBe("text");
    return JSON.parse(textContent.text);
  }

  // ---------------------------------------------------------------------------
  // Test Suite: include_documents=true merged results
  // ---------------------------------------------------------------------------
  describe("include_documents=true merged results", () => {
    it("should return merged results with source_type field for both code and document", async () => {
      // Index code chunks
      await indexCodeRepository("search-docs-code-1", [
        {
          content: "export function authenticateUser(username: string, password: string) { ... }",
          filePath: "src/auth.ts",
          chunkIndex: 0,
        },
        {
          content: "export function hashPassword(password: string): string { ... }",
          filePath: "src/crypto.ts",
          chunkIndex: 0,
        },
      ]);

      // Index document chunks
      await indexDocumentFolder("search-docs-folder-1", [
        {
          content:
            "Chapter 3: Authentication Best Practices. Always hash passwords before storage.",
          documentPath: "security-guide.pdf",
          chunkIndex: 0,
          documentType: "pdf",
          pageNumber: 42,
          sectionHeading: "Authentication Best Practices",
          documentTitle: "Security Guide 2026",
          documentAuthor: "Jane Doe",
        },
        {
          content: "Password policy: minimum 12 characters with uppercase and special characters.",
          documentPath: "policies/password-policy.docx",
          chunkIndex: 0,
          documentType: "docx",
          documentTitle: "Password Policy",
        },
      ]);

      const handler = createSemanticSearchHandler(searchService, documentSearchService);
      const result = await handler({
        query: "authentication password",
        include_documents: true,
        threshold: 0.0,
        limit: 10,
      });

      const parsed = parseHandlerResponse(result);

      // Verify results array has source_type field
      expect(parsed.results.length).toBeGreaterThan(0);

      const sourceTypes = parsed.results.map((r: any) => r.source_type);
      expect(sourceTypes).toContain("code");
      expect(sourceTypes).toContain("document");

      // Every result must have a source_type
      for (const r of parsed.results) {
        expect(["code", "document"]).toContain(r.source_type);
        expect(r.content).toBeDefined();
        expect(typeof r.similarity_score).toBe("number");
        expect(r.metadata).toBeDefined();
      }

      // Verify metadata has both code_matches and document_matches
      expect(parsed.metadata.code_matches).toBeGreaterThan(0);
      expect(parsed.metadata.document_matches).toBeGreaterThan(0);
      expect(parsed.metadata.total_matches).toBe(
        parsed.metadata.code_matches + parsed.metadata.document_matches
      );
    });

    it("should sort merged results by similarity_score descending", async () => {
      await indexCodeRepository("search-docs-sort-code", [
        {
          content: "function sortByScore(items: Item[]): Item[] { return items.sort(...); }",
          filePath: "src/sort.ts",
          chunkIndex: 0,
        },
      ]);

      await indexDocumentFolder("search-docs-sort-folder", [
        {
          content: "Sorting algorithms overview: merge sort, quick sort, heap sort.",
          documentPath: "algorithms.pdf",
          chunkIndex: 0,
          documentType: "pdf",
          pageNumber: 10,
          sectionHeading: "Sorting Algorithms",
        },
      ]);

      const handler = createSemanticSearchHandler(searchService, documentSearchService);
      const result = await handler({
        query: "sorting algorithm",
        include_documents: true,
        threshold: 0.0,
        limit: 20,
      });

      const parsed = parseHandlerResponse(result);

      // Verify descending order of similarity scores
      for (let i = 1; i < parsed.results.length; i++) {
        expect(parsed.results[i - 1].similarity_score).toBeGreaterThanOrEqual(
          parsed.results[i].similarity_score
        );
      }
    });

    it("should apply limit to merged total, not per-source", async () => {
      // Index 5 code chunks
      const codeChunks = Array.from({ length: 5 }, (_, i) => ({
        content: `Code function implementation number ${i + 1} for data processing`,
        filePath: `src/processor-${i + 1}.ts`,
        chunkIndex: 0,
      }));
      await indexCodeRepository("search-docs-limit-code", codeChunks);

      // Index 5 document chunks
      const docChunks = Array.from({ length: 5 }, (_, i) => ({
        content: `Document section about data processing technique number ${i + 1}`,
        documentPath: `chapter-${i + 1}.pdf`,
        chunkIndex: 0,
        documentType: "pdf" as const,
        pageNumber: i + 1,
        sectionHeading: `Section ${i + 1}`,
      }));
      await indexDocumentFolder("search-docs-limit-folder", docChunks);

      const handler = createSemanticSearchHandler(searchService, documentSearchService);
      const result = await handler({
        query: "data processing",
        include_documents: true,
        threshold: 0.0,
        limit: 3,
      });

      const parsed = parseHandlerResponse(result);

      // Total results must not exceed the limit
      expect(parsed.results.length).toBeLessThanOrEqual(3);
      expect(parsed.metadata.total_matches).toBeLessThanOrEqual(3);
    });
  });

  // ---------------------------------------------------------------------------
  // Test Suite: Metadata format and fields
  // ---------------------------------------------------------------------------
  describe("Metadata format", () => {
    it("should include both repositories_searched and document_folders_searched", async () => {
      await indexCodeRepository("search-docs-meta-code", [
        {
          content: "export class MetadataManager { }",
          filePath: "src/metadata.ts",
          chunkIndex: 0,
        },
      ]);

      await indexDocumentFolder("search-docs-meta-folder", [
        {
          content: "Metadata management overview and design patterns.",
          documentPath: "design-patterns.md",
          chunkIndex: 0,
          documentType: "markdown",
          sectionHeading: "Metadata Patterns",
        },
      ]);

      const handler = createSemanticSearchHandler(searchService, documentSearchService);
      const result = await handler({
        query: "metadata management",
        include_documents: true,
        threshold: 0.0,
        limit: 10,
      });

      const parsed = parseHandlerResponse(result);

      // Verify top-level metadata fields
      expect(parsed.metadata.repositories_searched).toBeDefined();
      expect(Array.isArray(parsed.metadata.repositories_searched)).toBe(true);
      expect(parsed.metadata.document_folders_searched).toBeDefined();
      expect(Array.isArray(parsed.metadata.document_folders_searched)).toBe(true);

      // Verify timing metadata
      expect(typeof parsed.metadata.query_time_ms).toBe("number");
      expect(typeof parsed.metadata.embedding_time_ms).toBe("number");
      expect(typeof parsed.metadata.search_time_ms).toBe("number");
    });

    it("should have correct metadata fields for code results", async () => {
      await indexCodeRepository("search-docs-codemeta", [
        {
          content: "export function validateInput(input: string): boolean { return true; }",
          filePath: "src/validation.ts",
          chunkIndex: 0,
        },
      ]);

      // Need at least one document folder registered so document search does not throw
      await indexDocumentFolder("search-docs-codemeta-folder", [
        {
          content: "Validation rules and input sanitization techniques.",
          documentPath: "validation-guide.txt",
          chunkIndex: 0,
          documentType: "txt",
        },
      ]);

      const handler = createSemanticSearchHandler(searchService, documentSearchService);
      const result = await handler({
        query: "input validation",
        include_documents: true,
        threshold: 0.0,
        limit: 20,
      });

      const parsed = parseHandlerResponse(result);

      // Find a code result
      const codeResult = parsed.results.find((r: any) => r.source_type === "code");
      expect(codeResult).toBeDefined();

      // Verify code result metadata shape
      expect(codeResult.metadata.file_path).toBeDefined();
      expect(typeof codeResult.metadata.file_path).toBe("string");
      expect(codeResult.metadata.repository).toBeDefined();
      expect(typeof codeResult.metadata.repository).toBe("string");
      expect(codeResult.metadata.chunk_index).toBeDefined();
      expect(typeof codeResult.metadata.chunk_index).toBe("number");
      expect(codeResult.metadata.file_extension).toBeDefined();
      expect(typeof codeResult.metadata.file_extension).toBe("string");
      expect(codeResult.metadata.file_size_bytes).toBeDefined();
      expect(typeof codeResult.metadata.file_size_bytes).toBe("number");
      expect(codeResult.metadata.indexed_at).toBeDefined();
      expect(typeof codeResult.metadata.indexed_at).toBe("string");
    });

    it("should have correct metadata fields for document results", async () => {
      await indexCodeRepository("search-docs-docmeta-code", [
        {
          content: "export function formatDocument(doc: Document): string { ... }",
          filePath: "src/formatter.ts",
          chunkIndex: 0,
        },
      ]);

      await indexDocumentFolder("search-docs-docmeta-folder", [
        {
          content: "Document formatting standards and best practices for technical writing.",
          documentPath: "style-guide.pdf",
          chunkIndex: 0,
          documentType: "pdf",
          pageNumber: 5,
          sectionHeading: "Formatting Standards",
          documentTitle: "Technical Writing Style Guide",
          documentAuthor: "John Smith",
        },
      ]);

      const handler = createSemanticSearchHandler(searchService, documentSearchService);
      const result = await handler({
        query: "document formatting",
        include_documents: true,
        threshold: 0.0,
        limit: 20,
      });

      const parsed = parseHandlerResponse(result);

      // Find a document result
      const docResult = parsed.results.find((r: any) => r.source_type === "document");
      expect(docResult).toBeDefined();

      // Verify document result metadata shape
      expect(docResult.metadata.document_path).toBeDefined();
      expect(typeof docResult.metadata.document_path).toBe("string");
      expect(docResult.metadata.document_type).toBeDefined();
      expect(typeof docResult.metadata.document_type).toBe("string");
      expect(docResult.metadata.folder).toBeDefined();
      expect(typeof docResult.metadata.folder).toBe("string");
    });
  });

  // ---------------------------------------------------------------------------
  // Test Suite: Graceful degradation
  // ---------------------------------------------------------------------------
  describe("Graceful degradation", () => {
    it("should return code-only results with warning when DocumentSearchService is unavailable", async () => {
      await indexCodeRepository("search-docs-degrade-code", [
        {
          content: "export class UserService { async getUser(id: string) { ... } }",
          filePath: "src/user-service.ts",
          chunkIndex: 0,
        },
        {
          content: "export class RoleService { async getRoles(userId: string) { ... } }",
          filePath: "src/role-service.ts",
          chunkIndex: 0,
        },
      ]);

      // Create handler WITHOUT document search service
      const handler = createSemanticSearchHandler(searchService);

      const result = await handler({
        query: "user service",
        include_documents: true,
        threshold: 0.0,
        limit: 10,
      });

      const parsed = parseHandlerResponse(result);

      // Should still return code results
      expect(parsed.results.length).toBeGreaterThan(0);

      // All results should be code-only
      for (const r of parsed.results) {
        expect(r.source_type).toBe("code");
      }

      // document_matches should be 0
      expect(parsed.metadata.document_matches).toBe(0);
      expect(parsed.metadata.code_matches).toBeGreaterThan(0);

      // Should have a warning about document service being unavailable
      expect(parsed.metadata.warnings).toBeDefined();
      expect(Array.isArray(parsed.metadata.warnings)).toBe(true);
      expect(parsed.metadata.warnings.length).toBeGreaterThan(0);

      const warningText = parsed.metadata.warnings.join(" ");
      expect(warningText.toLowerCase()).toContain("document");
    });
  });

  // ---------------------------------------------------------------------------
  // Test Suite: include_documents=false (legacy format)
  // ---------------------------------------------------------------------------
  describe("include_documents=false (legacy format)", () => {
    it("should return code-only results without source_type field", async () => {
      await indexCodeRepository("search-docs-legacy-code", [
        {
          content: "export function processPayment(amount: number): Promise<Receipt> { ... }",
          filePath: "src/payments.ts",
          chunkIndex: 0,
        },
        {
          content: "export function calculateTax(amount: number, rate: number): number { ... }",
          filePath: "src/tax.ts",
          chunkIndex: 0,
        },
      ]);

      // Also index documents, but they should NOT appear in legacy mode
      await indexDocumentFolder("search-docs-legacy-folder", [
        {
          content: "Payment processing workflow and compliance requirements.",
          documentPath: "compliance.pdf",
          chunkIndex: 0,
          documentType: "pdf",
          pageNumber: 1,
        },
      ]);

      const handler = createSemanticSearchHandler(searchService, documentSearchService);

      // Call without include_documents (defaults to false)
      const result = await handler({
        query: "payment processing",
        threshold: 0.0,
        limit: 10,
      });

      const parsed = parseHandlerResponse(result);

      expect(parsed.results.length).toBeGreaterThan(0);

      // Legacy format: no source_type field
      for (const r of parsed.results) {
        expect(r.source_type).toBeUndefined();
      }

      // Legacy metadata: has total_matches, repositories_searched but NOT
      // code_matches, document_matches, document_folders_searched
      expect(parsed.metadata.total_matches).toBeDefined();
      expect(parsed.metadata.repositories_searched).toBeDefined();
      expect(parsed.metadata.code_matches).toBeUndefined();
      expect(parsed.metadata.document_matches).toBeUndefined();
      expect(parsed.metadata.document_folders_searched).toBeUndefined();
    });

    it("should return legacy format when include_documents is explicitly false", async () => {
      await indexCodeRepository("search-docs-explicit-false", [
        {
          content: "export const logger = createLogger({ level: 'info' });",
          filePath: "src/logger.ts",
          chunkIndex: 0,
        },
      ]);

      const handler = createSemanticSearchHandler(searchService, documentSearchService);

      const result = await handler({
        query: "logger configuration",
        include_documents: false,
        threshold: 0.0,
        limit: 10,
      });

      const parsed = parseHandlerResponse(result);

      // Should use legacy format
      for (const r of parsed.results) {
        expect(r.source_type).toBeUndefined();
      }
      expect(parsed.metadata.code_matches).toBeUndefined();
      expect(parsed.metadata.document_matches).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Test Suite: Performance
  // ---------------------------------------------------------------------------
  describe("Performance", () => {
    it("should complete parallel search within 500ms with small dataset", async () => {
      await indexCodeRepository("search-docs-perf-code", [
        {
          content: "export function computeMetrics(): Metrics { ... }",
          filePath: "src/metrics.ts",
          chunkIndex: 0,
        },
        {
          content: "export function aggregateData(data: DataPoint[]): Summary { ... }",
          filePath: "src/aggregation.ts",
          chunkIndex: 0,
        },
      ]);

      await indexDocumentFolder("search-docs-perf-folder", [
        {
          content: "Performance monitoring and metrics collection best practices.",
          documentPath: "monitoring-guide.pdf",
          chunkIndex: 0,
          documentType: "pdf",
          pageNumber: 1,
        },
        {
          content: "Data aggregation pipelines and dashboard configuration.",
          documentPath: "dashboards.docx",
          chunkIndex: 0,
          documentType: "docx",
        },
      ]);

      const handler = createSemanticSearchHandler(searchService, documentSearchService);

      const startTime = performance.now();
      const result = await handler({
        query: "performance metrics",
        include_documents: true,
        threshold: 0.0,
        limit: 10,
      });
      const duration = performance.now() - startTime;

      const parsed = parseHandlerResponse(result);

      // PRD requirement: <500ms p95 for MCP query response
      expect(duration).toBeLessThan(500);

      // Verify timing metadata is reasonable
      expect(parsed.metadata.query_time_ms).toBeGreaterThan(0);
      expect(parsed.metadata.query_time_ms).toBeLessThan(500);
    });
  });
});
