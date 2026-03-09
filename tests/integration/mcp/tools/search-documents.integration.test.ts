/**
 * Integration tests for search_documents MCP tool
 *
 * Tests the full pipeline: MCP handler validation -> DocumentSearchServiceImpl ->
 * ChromaDB vector search -> JSON response formatting. Uses a real ChromaDB instance
 * with a MockEmbeddingProvider to produce deterministic, reproducible embeddings
 * without external API dependencies.
 *
 * Prerequisites:
 *   1. ChromaDB running locally (or set CHROMADB_HOST / CHROMADB_PORT)
 *   2. Environment variable RUN_INTEGRATION_TESTS=true
 *
 * Run:
 *   RUN_INTEGRATION_TESTS=true bun test tests/integration/mcp/tools/search-documents.integration.test.ts
 *
 * @module tests/integration/mcp/tools/search-documents
 */

/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { DocumentSearchServiceImpl } from "../../../../src/services/document-search-service.js";
import { ChromaStorageClientImpl } from "../../../../src/storage/chroma-client.js";
import { RepositoryMetadataStoreImpl } from "../../../../src/repositories/metadata-store.js";
import { createSearchDocumentsHandler } from "../../../../src/mcp/tools/search-documents.js";
import type {
  EmbeddingProvider,
  EmbeddingProviderConfig,
} from "../../../../src/providers/types.js";
import type { DocumentInput } from "../../../../src/storage/types.js";
import { initializeLogger, resetLogger } from "../../../../src/logging/index.js";
import fs from "fs";
import path from "path";
import os from "os";

// ─────────────────────────────────────────────────────────────────────────────
// Gate: only run when explicitly enabled (requires running ChromaDB)
// ─────────────────────────────────────────────────────────────────────────────
const shouldRunIntegrationTests = Bun.env["RUN_INTEGRATION_TESTS"] === "true";
const describeIntegration = shouldRunIntegrationTests ? describe : describe.skip;

// ─────────────────────────────────────────────────────────────────────────────
// Mock Embedding Provider (deterministic, no network)
// ─────────────────────────────────────────────────────────────────────────────

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

class MockEmbeddingProviderFactory {
  private mockProvider: EmbeddingProvider;

  constructor(provider: EmbeddingProvider) {
    this.mockProvider = provider;
  }

  createProvider(_config: EmbeddingProviderConfig): EmbeddingProvider {
    return this.mockProvider;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Suite
// ─────────────────────────────────────────────────────────────────────────────

describeIntegration("search_documents MCP Tool Integration Tests", () => {
  // Unique suffix prevents collisions across parallel test runs
  const uniqueSuffix = Date.now();
  const testDataPath = path.join(os.tmpdir(), `search-documents-integration-${uniqueSuffix}`);
  const testChromaHost = process.env["CHROMADB_HOST"] || "localhost";
  const testChromaPort = parseInt(process.env["CHROMADB_PORT"] || "8000", 10);

  // Collection names scoped to this test run
  const COLLECTION_PDF_FOLDER = `repo_doc_pdf_folder_${uniqueSuffix}`;
  const COLLECTION_DOCX_FOLDER = `repo_doc_docx_folder_${uniqueSuffix}`;
  const COLLECTION_MIXED_FOLDER = `repo_doc_mixed_folder_${uniqueSuffix}`;
  const COLLECTION_TABLE_FOLDER = `repo_doc_table_folder_${uniqueSuffix}`;
  const COLLECTION_LARGE_FOLDER = `repo_doc_large_folder_${uniqueSuffix}`;
  const COLLECTION_PERF_FOLDER = `repo_doc_perf_folder_${uniqueSuffix}`;

  const REPO_PDF = `doc-pdf-folder-${uniqueSuffix}`;
  const REPO_DOCX = `doc-docx-folder-${uniqueSuffix}`;
  const REPO_MIXED = `doc-mixed-folder-${uniqueSuffix}`;
  const REPO_TABLE = `doc-table-folder-${uniqueSuffix}`;
  const REPO_LARGE = `doc-large-folder-${uniqueSuffix}`;
  const REPO_PERF = `doc-perf-folder-${uniqueSuffix}`;

  const allCollections = [
    COLLECTION_PDF_FOLDER,
    COLLECTION_DOCX_FOLDER,
    COLLECTION_MIXED_FOLDER,
    COLLECTION_TABLE_FOLDER,
    COLLECTION_LARGE_FOLDER,
    COLLECTION_PERF_FOLDER,
  ];

  let handler: ReturnType<typeof createSearchDocumentsHandler>;
  let embeddingProvider: MockEmbeddingProvider;
  let embeddingProviderFactory: MockEmbeddingProviderFactory;
  let storageClient: ChromaStorageClientImpl;
  let repositoryService: RepositoryMetadataStoreImpl;

  // ─── Setup / Teardown ───────────────────────────────────────────────────

  beforeAll(async () => {
    initializeLogger({ level: "error", format: "json" });

    // Prepare temporary data directory
    if (fs.existsSync(testDataPath)) {
      fs.rmSync(testDataPath, { recursive: true, force: true });
    }
    fs.mkdirSync(testDataPath, { recursive: true });

    // Create services
    embeddingProvider = new MockEmbeddingProvider();
    embeddingProviderFactory = new MockEmbeddingProviderFactory(embeddingProvider);
    storageClient = new ChromaStorageClientImpl({
      host: testChromaHost,
      port: testChromaPort,
    });
    repositoryService = RepositoryMetadataStoreImpl.getInstance(testDataPath);

    await storageClient.connect();

    const documentSearchService = new DocumentSearchServiceImpl(
      embeddingProvider,
      embeddingProviderFactory,
      storageClient,
      repositoryService
    );

    handler = createSearchDocumentsHandler(documentSearchService);
  });

  afterAll(async () => {
    // Delete all test collections
    for (const col of allCollections) {
      try {
        await storageClient.deleteCollection(col);
      } catch (_error) {
        // Ignore – collection may not exist
      }
    }

    // Remove all test repository metadata entries
    for (const name of [REPO_PDF, REPO_DOCX, REPO_MIXED, REPO_TABLE, REPO_LARGE, REPO_PERF]) {
      try {
        await repositoryService.removeRepository(name);
      } catch (_error) {
        // Ignore
      }
    }

    // Clean up temp directory
    if (fs.existsSync(testDataPath)) {
      fs.rmSync(testDataPath, { recursive: true, force: true });
    }

    RepositoryMetadataStoreImpl.resetInstance();
    resetLogger();
  });

  beforeEach(async () => {
    // Clean collections before each test to avoid cross-contamination
    for (const col of allCollections) {
      try {
        await storageClient.deleteCollection(col);
      } catch (_error) {
        // Ignore – collection may not exist
      }
    }

    // Remove repo metadata entries so tests start clean
    for (const name of [REPO_PDF, REPO_DOCX, REPO_MIXED, REPO_TABLE, REPO_LARGE, REPO_PERF]) {
      try {
        await repositoryService.removeRepository(name);
      } catch (_error) {
        // Ignore
      }
    }
  });

  // ─── Helper: register a repository and index documents ──────────────────

  interface TestDocument {
    content: string;
    filePath: string;
    chunkIndex: number;
    documentType?: string;
    pageNumber?: number;
    sectionHeading?: string;
    documentTitle?: string;
    documentAuthor?: string;
    /** Mark this chunk as a table */
    isTable?: boolean;
    tableCaption?: string;
    tableColumnCount?: number;
    tableRowCount?: number;
  }

  async function indexTestDocumentFolder(
    repoName: string,
    collectionName: string,
    documents: TestDocument[]
  ): Promise<void> {
    // Register repository as "ready"
    await repositoryService.updateRepository({
      name: repoName,
      url: `file:///test/${repoName}`,
      localPath: path.join(os.tmpdir(), repoName),
      collectionName,
      status: "ready",
      fileCount: documents.length,
      chunkCount: documents.length,
      lastIndexedAt: new Date().toISOString(),
      indexDurationMs: 100,
      branch: "main",
      includeExtensions: [".pdf", ".docx", ".md", ".txt"],
      excludePatterns: [],
    });

    // Build document inputs
    const embeddings = await embeddingProvider.generateEmbeddings(documents.map((d) => d.content));

    const documentInputs: DocumentInput[] = documents.map((doc, index) => {
      const ext = path.extname(doc.filePath);

      // Base metadata
      const metadata: any = {
        file_path: doc.filePath,
        repository: repoName,
        chunk_index: doc.chunkIndex,
        total_chunks: 1,
        chunk_start_line: 1,
        chunk_end_line: 10,
        file_extension: ext,
        language: "unknown",
        file_size_bytes: doc.content.length,
        content_hash: `hash_${repoName}_${index}`,
        indexed_at: new Date().toISOString(),
        file_modified_at: new Date().toISOString(),
      };

      // Document-specific metadata
      if (doc.documentType) metadata.document_type = doc.documentType;
      if (doc.pageNumber !== undefined) metadata.page_number = doc.pageNumber;
      if (doc.sectionHeading) metadata.section_heading = doc.sectionHeading;
      if (doc.documentTitle) metadata.document_title = doc.documentTitle;
      if (doc.documentAuthor) metadata.document_author = doc.documentAuthor;

      // Table-specific dynamic metadata
      if (doc.isTable === true) metadata.isTable = true;
      if (doc.tableCaption) metadata.tableCaption = doc.tableCaption;
      if (doc.tableColumnCount !== undefined) metadata.tableColumnCount = doc.tableColumnCount;
      if (doc.tableRowCount !== undefined) metadata.tableRowCount = doc.tableRowCount;

      return {
        id: `${repoName}:${doc.filePath}:${doc.chunkIndex}`,
        content: doc.content,
        embedding: embeddings[index]!,
        metadata,
      };
    });

    await storageClient.addDocuments(collectionName, documentInputs);
  }

  /**
   * Invoke the MCP handler and parse the JSON response body.
   * Returns the parsed object and the raw CallToolResult.
   */
  async function callHandler(args: Record<string, unknown>) {
    const result = await handler(args);
    const text = (result.content as any)[0]?.text as string;
    const parsed = JSON.parse(text);
    return { result, parsed };
  }

  // ─── Tests ──────────────────────────────────────────────────────────────

  describe("Search with document-specific metadata", () => {
    it("should return results with document metadata fields populated", async () => {
      await indexTestDocumentFolder(REPO_PDF, COLLECTION_PDF_FOLDER, [
        {
          content:
            "Neural networks are computational models inspired by the human brain structure.",
          filePath: "chapter1.pdf",
          chunkIndex: 0,
          documentType: "pdf",
          pageNumber: 3,
          sectionHeading: "Introduction to Neural Networks",
          documentTitle: "Deep Learning Fundamentals",
          documentAuthor: "Jane Doe",
        },
        {
          content:
            "Gradient descent is an optimization algorithm used to minimize the loss function.",
          filePath: "chapter2.pdf",
          chunkIndex: 0,
          documentType: "pdf",
          pageNumber: 15,
          sectionHeading: "Optimization Algorithms",
          documentTitle: "Deep Learning Fundamentals",
          documentAuthor: "Jane Doe",
        },
      ]);

      const { parsed, result } = await callHandler({
        query: "neural networks brain",
        threshold: 0.0,
        limit: 10,
      });

      expect(result.isError).toBe(false);
      expect(parsed.results.length).toBeGreaterThan(0);

      // Verify document metadata is present on every result
      for (const r of parsed.results) {
        expect(r).toHaveProperty("content");
        expect(r).toHaveProperty("documentPath");
        expect(r).toHaveProperty("documentType");
        expect(r).toHaveProperty("similarity");
        expect(r).toHaveProperty("folder");
      }

      // At least one result should carry the full metadata we indexed
      const enriched = parsed.results.find(
        (r: any) => r.documentTitle === "Deep Learning Fundamentals"
      );
      expect(enriched).toBeDefined();
      expect(enriched.documentAuthor).toBe("Jane Doe");
      expect(enriched.documentType).toBe("pdf");
      expect(typeof enriched.pageNumber).toBe("number");
      expect(typeof enriched.sectionHeading).toBe("string");
    });
  });

  describe("Filter by document_types", () => {
    it("should return only pdf results when document_types is ['pdf']", async () => {
      // Index PDFs in one folder
      await indexTestDocumentFolder(REPO_MIXED, COLLECTION_MIXED_FOLDER, [
        {
          content: "PDF content about machine learning algorithms and gradient descent.",
          filePath: "ml-guide.pdf",
          chunkIndex: 0,
          documentType: "pdf",
          pageNumber: 1,
          documentTitle: "ML Guide",
        },
        {
          content: "DOCX content about machine learning algorithms and gradient descent.",
          filePath: "ml-guide.docx",
          chunkIndex: 0,
          documentType: "docx",
          documentTitle: "ML Guide DOCX",
        },
        {
          content: "Markdown notes on machine learning algorithms and gradient descent.",
          filePath: "ml-notes.md",
          chunkIndex: 0,
          documentType: "markdown",
          documentTitle: "ML Notes",
        },
      ]);

      const { parsed, result } = await callHandler({
        query: "machine learning algorithms",
        document_types: ["pdf"],
        threshold: 0.0,
        limit: 10,
      });

      expect(result.isError).toBe(false);
      // All returned results must be pdf type
      for (const r of parsed.results) {
        expect(r.documentType).toBe("pdf");
      }
      expect(parsed.results.length).toBeGreaterThan(0);
    });

    it("should return all types when document_types includes 'all'", async () => {
      await indexTestDocumentFolder(REPO_MIXED, COLLECTION_MIXED_FOLDER, [
        {
          content: "PDF about data structures and algorithms.",
          filePath: "ds.pdf",
          chunkIndex: 0,
          documentType: "pdf",
        },
        {
          content: "Markdown about data structures and algorithms.",
          filePath: "ds.md",
          chunkIndex: 0,
          documentType: "markdown",
        },
      ]);

      const { parsed, result } = await callHandler({
        query: "data structures algorithms",
        document_types: ["all"],
        threshold: 0.0,
        limit: 10,
      });

      expect(result.isError).toBe(false);
      expect(parsed.results.length).toBe(2);
    });
  });

  describe("Filter by folder", () => {
    it("should restrict results to the specified folder", async () => {
      // Two folders with similar content
      await indexTestDocumentFolder(REPO_PDF, COLLECTION_PDF_FOLDER, [
        {
          content: "Database indexing strategies for high performance systems.",
          filePath: "db-indexing.pdf",
          chunkIndex: 0,
          documentType: "pdf",
          documentTitle: "DB Indexing PDF",
        },
      ]);

      await indexTestDocumentFolder(REPO_DOCX, COLLECTION_DOCX_FOLDER, [
        {
          content: "Database indexing strategies for high performance systems.",
          filePath: "db-indexing.docx",
          chunkIndex: 0,
          documentType: "docx",
          documentTitle: "DB Indexing DOCX",
        },
      ]);

      // Search only in the PDF folder
      const { parsed, result } = await callHandler({
        query: "database indexing strategies",
        folder: REPO_PDF,
        threshold: 0.0,
        limit: 10,
      });

      expect(result.isError).toBe(false);
      expect(parsed.results.length).toBeGreaterThan(0);

      // Every result must belong to the requested folder
      for (const r of parsed.results) {
        expect(r.folder).toBe(REPO_PDF);
      }

      // Metadata should reflect the searched folder
      expect(parsed.metadata.searchedFolders).toContain(REPO_PDF);
      expect(parsed.metadata.searchedFolders).not.toContain(REPO_DOCX);
    });
  });

  describe("Empty results", () => {
    it("should return empty results with high threshold and non-matching query", async () => {
      await indexTestDocumentFolder(REPO_PDF, COLLECTION_PDF_FOLDER, [
        {
          content: "Photosynthesis is the process by which plants convert sunlight.",
          filePath: "biology.pdf",
          chunkIndex: 0,
          documentType: "pdf",
        },
      ]);

      const { parsed, result } = await callHandler({
        query: "quantum computing superconductor entanglement",
        threshold: 0.99,
        limit: 10,
      });

      expect(result.isError).toBe(false);
      expect(parsed.results).toEqual([]);
      expect(parsed.metadata.totalResults).toBe(0);
    });
  });

  describe("Table content filtering", () => {
    it("should return only table chunks when include_tables is 'only'", async () => {
      await indexTestDocumentFolder(REPO_TABLE, COLLECTION_TABLE_FOLDER, [
        {
          content: "| Column A | Column B |\n|---|---|\n| 1 | 2 |",
          filePath: "report.pdf",
          chunkIndex: 0,
          documentType: "pdf",
          isTable: true,
          tableCaption: "Summary Statistics",
          tableColumnCount: 2,
          tableRowCount: 1,
        },
        {
          content: "This paragraph discusses survey results and key findings.",
          filePath: "report.pdf",
          chunkIndex: 1,
          documentType: "pdf",
        },
      ]);

      const { parsed, result } = await callHandler({
        query: "survey data results",
        include_tables: "only",
        threshold: 0.0,
        limit: 10,
      });

      expect(result.isError).toBe(false);
      // Only table chunks should be returned
      for (const r of parsed.results) {
        expect(r.isTable).toBe(true);
      }
    });

    it("should exclude table chunks when include_tables is 'exclude'", async () => {
      await indexTestDocumentFolder(REPO_TABLE, COLLECTION_TABLE_FOLDER, [
        {
          content: "| Metric | Value |\n|---|---|\n| Accuracy | 0.95 |",
          filePath: "metrics.pdf",
          chunkIndex: 0,
          documentType: "pdf",
          isTable: true,
          tableCaption: "Model Metrics",
          tableColumnCount: 2,
          tableRowCount: 1,
        },
        {
          content: "The model achieved high accuracy on the validation dataset.",
          filePath: "metrics.pdf",
          chunkIndex: 1,
          documentType: "pdf",
        },
      ]);

      const { parsed, result } = await callHandler({
        query: "model accuracy validation",
        include_tables: "exclude",
        threshold: 0.0,
        limit: 10,
      });

      expect(result.isError).toBe(false);
      // No table chunks should appear
      for (const r of parsed.results) {
        expect(r.isTable).toBeUndefined();
      }
    });
  });

  describe("Threshold filtering", () => {
    it("should return more results with low threshold than high threshold", async () => {
      await indexTestDocumentFolder(REPO_PDF, COLLECTION_PDF_FOLDER, [
        {
          content: "Introduction to compiler design and lexical analysis.",
          filePath: "compilers-ch1.pdf",
          chunkIndex: 0,
          documentType: "pdf",
        },
        {
          content: "Advanced parsing techniques including LR and LALR parsers.",
          filePath: "compilers-ch2.pdf",
          chunkIndex: 0,
          documentType: "pdf",
        },
        {
          content: "An essay on renaissance art and cultural movements in Europe.",
          filePath: "art-history.pdf",
          chunkIndex: 0,
          documentType: "pdf",
        },
      ]);

      const lowThreshold = await callHandler({
        query: "compiler design parsing",
        threshold: 0.0,
        limit: 50,
      });

      const highThreshold = await callHandler({
        query: "compiler design parsing",
        threshold: 0.9,
        limit: 50,
      });

      expect(lowThreshold.parsed.results.length).toBeGreaterThanOrEqual(
        highThreshold.parsed.results.length
      );

      // All results in high threshold response must meet the threshold
      for (const r of highThreshold.parsed.results) {
        expect(r.similarity).toBeGreaterThanOrEqual(0.9);
      }
    });
  });

  describe("Limit enforcement", () => {
    it("should not return more results than the specified limit", async () => {
      // Index 6 documents
      const docs: TestDocument[] = Array.from({ length: 6 }, (_, i) => ({
        content: `Document chunk ${i} about software engineering best practices and design patterns.`,
        filePath: `doc-${i}.pdf`,
        chunkIndex: 0,
        documentType: "pdf" as const,
      }));

      await indexTestDocumentFolder(REPO_LARGE, COLLECTION_LARGE_FOLDER, docs);

      const { parsed, result } = await callHandler({
        query: "software engineering design patterns",
        limit: 2,
        threshold: 0.0,
      });

      expect(result.isError).toBe(false);
      expect(parsed.results.length).toBeLessThanOrEqual(2);
    });
  });

  describe("Response format validation", () => {
    it("should return JSON with all expected fields in correct structure", async () => {
      await indexTestDocumentFolder(REPO_PDF, COLLECTION_PDF_FOLDER, [
        {
          content: "Kubernetes pod scheduling and resource management overview.",
          filePath: "k8s-guide.pdf",
          chunkIndex: 0,
          documentType: "pdf",
          pageNumber: 7,
          sectionHeading: "Pod Scheduling",
          documentTitle: "Kubernetes Operations Guide",
          documentAuthor: "DevOps Team",
        },
      ]);

      const { parsed, result } = await callHandler({
        query: "kubernetes pod scheduling",
        threshold: 0.0,
        limit: 10,
      });

      expect(result.isError).toBe(false);

      // Top-level structure
      expect(parsed).toHaveProperty("results");
      expect(parsed).toHaveProperty("metadata");
      expect(Array.isArray(parsed.results)).toBe(true);

      // Metadata structure
      expect(typeof parsed.metadata.totalResults).toBe("number");
      expect(typeof parsed.metadata.queryTimeMs).toBe("number");
      expect(Array.isArray(parsed.metadata.searchedFolders)).toBe(true);
      expect(Array.isArray(parsed.metadata.searchedDocumentTypes)).toBe(true);

      // Result item structure (at least one result expected)
      expect(parsed.results.length).toBeGreaterThan(0);
      const first = parsed.results[0];

      expect(typeof first.content).toBe("string");
      expect(typeof first.documentPath).toBe("string");
      expect(typeof first.documentType).toBe("string");
      expect(typeof first.similarity).toBe("number");
      expect(typeof first.folder).toBe("string");

      // Optional fields should be present for this indexed document
      expect(first.documentTitle).toBe("Kubernetes Operations Guide");
      expect(first.documentAuthor).toBe("DevOps Team");
      expect(first.pageNumber).toBe(7);
      expect(first.sectionHeading).toBe("Pod Scheduling");
    });

    it("should include table fields in response when result is a table chunk", async () => {
      await indexTestDocumentFolder(REPO_TABLE, COLLECTION_TABLE_FOLDER, [
        {
          content: "| Year | Revenue |\n|---|---|\n| 2024 | $1M |\n| 2025 | $2M |",
          filePath: "financials.pdf",
          chunkIndex: 0,
          documentType: "pdf",
          isTable: true,
          tableCaption: "Annual Revenue",
          tableColumnCount: 2,
          tableRowCount: 2,
        },
      ]);

      const { parsed, result } = await callHandler({
        query: "annual revenue financial data",
        threshold: 0.0,
        limit: 10,
      });

      expect(result.isError).toBe(false);
      expect(parsed.results.length).toBeGreaterThan(0);

      const tableResult = parsed.results.find((r: any) => r.isTable === true);
      expect(tableResult).toBeDefined();
      expect(tableResult.tableCaption).toBe("Annual Revenue");
      expect(tableResult.tableColumnCount).toBe(2);
      expect(tableResult.tableRowCount).toBe(2);
    });

    it("should return results sorted by similarity descending", async () => {
      await indexTestDocumentFolder(REPO_PDF, COLLECTION_PDF_FOLDER, [
        {
          content: "Quick sort algorithm implementation in TypeScript.",
          filePath: "sort1.pdf",
          chunkIndex: 0,
          documentType: "pdf",
        },
        {
          content: "Merge sort algorithm with O(n log n) complexity analysis.",
          filePath: "sort2.pdf",
          chunkIndex: 0,
          documentType: "pdf",
        },
        {
          content: "History of ancient Greek philosophy and Socratic method.",
          filePath: "philosophy.pdf",
          chunkIndex: 0,
          documentType: "pdf",
        },
      ]);

      const { parsed } = await callHandler({
        query: "sorting algorithms implementation",
        threshold: 0.0,
        limit: 10,
      });

      for (let i = 1; i < parsed.results.length; i++) {
        expect(parsed.results[i - 1].similarity).toBeGreaterThanOrEqual(
          parsed.results[i].similarity
        );
      }
    });
  });

  describe("Performance", () => {
    it("should complete a search query in under 500ms", async () => {
      await indexTestDocumentFolder(REPO_PERF, COLLECTION_PERF_FOLDER, [
        {
          content: "Performance testing document about response time targets.",
          filePath: "perf.pdf",
          chunkIndex: 0,
          documentType: "pdf",
        },
        {
          content: "Latency benchmarks for vector similarity search operations.",
          filePath: "benchmarks.pdf",
          chunkIndex: 0,
          documentType: "pdf",
        },
      ]);

      const startTime = performance.now();
      const { result } = await callHandler({
        query: "performance response time",
        threshold: 0.0,
        limit: 10,
      });
      const elapsed = performance.now() - startTime;

      expect(result.isError).toBe(false);
      expect(elapsed).toBeLessThan(500);
    });
  });

  describe("Error handling", () => {
    it("should return isError=true when query is missing", async () => {
      const result = await handler({});
      expect(result.isError).toBe(true);
      const text = (result.content as any)[0]?.text as string;
      expect(text).toContain("Error");
    });

    it("should return isError=true when query is empty string", async () => {
      const result = await handler({ query: "" });
      expect(result.isError).toBe(true);
      const text = (result.content as any)[0]?.text as string;
      expect(text).toContain("Error");
    });

    it("should return isError=true for invalid document_types value", async () => {
      const result = await handler({
        query: "some search",
        document_types: ["invalid_type"],
      });
      expect(result.isError).toBe(true);
    });

    it("should return isError=true for invalid include_tables value", async () => {
      const result = await handler({
        query: "some search",
        include_tables: "invalid",
      });
      expect(result.isError).toBe(true);
    });

    it("should return isError=true for limit out of range", async () => {
      const result = await handler({
        query: "some search",
        limit: 0,
      });
      expect(result.isError).toBe(true);
    });

    it("should return isError=true for threshold out of range", async () => {
      const result = await handler({
        query: "some search",
        threshold: 1.5,
      });
      expect(result.isError).toBe(true);
    });
  });

  describe("Default parameter behavior", () => {
    it("should apply default limit of 10 when not specified", async () => {
      // Index 15 documents to ensure there are more than the default limit
      const docs: TestDocument[] = Array.from({ length: 15 }, (_, i) => ({
        content: `Document ${i} discussing TypeScript generics and type inference patterns.`,
        filePath: `generics-${i}.pdf`,
        chunkIndex: 0,
        documentType: "pdf" as const,
      }));

      await indexTestDocumentFolder(REPO_LARGE, COLLECTION_LARGE_FOLDER, docs);

      const { parsed, result } = await callHandler({
        query: "TypeScript generics type inference",
        threshold: 0.0,
        // limit intentionally omitted – default is 10
      });

      expect(result.isError).toBe(false);
      expect(parsed.results.length).toBeLessThanOrEqual(10);
    });

    it("should apply default threshold of 0.7 when not specified", async () => {
      await indexTestDocumentFolder(REPO_PDF, COLLECTION_PDF_FOLDER, [
        {
          content: "Exact match content for default threshold test on networking protocols.",
          filePath: "networking.pdf",
          chunkIndex: 0,
          documentType: "pdf",
        },
      ]);

      const { parsed, result } = await callHandler({
        query: "networking protocols",
        // threshold intentionally omitted – default is 0.7
      });

      expect(result.isError).toBe(false);
      // Any results returned must meet the default 0.7 threshold
      for (const r of parsed.results) {
        expect(r.similarity).toBeGreaterThanOrEqual(0.7);
      }
    });
  });

  describe("Multiple folders search", () => {
    it("should search across all registered folders when no folder filter is specified", async () => {
      await indexTestDocumentFolder(REPO_PDF, COLLECTION_PDF_FOLDER, [
        {
          content: "Cloud computing resource scaling and elasticity fundamentals.",
          filePath: "cloud.pdf",
          chunkIndex: 0,
          documentType: "pdf",
        },
      ]);

      await indexTestDocumentFolder(REPO_DOCX, COLLECTION_DOCX_FOLDER, [
        {
          content: "Cloud computing resource scaling and elasticity fundamentals.",
          filePath: "cloud.docx",
          chunkIndex: 0,
          documentType: "docx",
        },
      ]);

      const { parsed, result } = await callHandler({
        query: "cloud computing scaling",
        threshold: 0.0,
        limit: 20,
      });

      expect(result.isError).toBe(false);
      expect(parsed.metadata.searchedFolders).toContain(REPO_PDF);
      expect(parsed.metadata.searchedFolders).toContain(REPO_DOCX);

      // Results from both folders
      const folders = new Set(parsed.results.map((r: any) => r.folder));
      expect(folders.size).toBeGreaterThanOrEqual(2);
    });
  });
});
