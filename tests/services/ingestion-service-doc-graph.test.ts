/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/explicit-function-return-type */

/**
 * Wiring tests for `IngestionService` doc-graph integration (issue #580).
 *
 * These tests verify that when an `IngestionService` is constructed with a
 * `graphIngestionService` and indexes a repository containing doc files,
 * the post-batch graph step fires with:
 *
 * 1. The right `FileInput[]` for `ingestFiles` (code files only, content
 *    captured during chunking — NOT re-read from disk),
 * 2. The right `DocExtractionResult[]` for `ingestDocumentGraph` (one entry
 *    per markdown / pdf / docx / txt file, format & sections derived from
 *    the chunking-pipeline `ExtractionResult`),
 * 3. Code-graph BEFORE doc-graph (the two-pass MENTIONS resolution
 *    precondition spelled out in `GraphIngestionService.ingestDocumentGraph`'s
 *    docstring).
 *
 * The graph service itself is fully unit-tested elsewhere — these tests
 * only assert that the wiring routes the right inputs to the right method
 * in the right order.
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll, afterEach } from "bun:test";
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
import type { GraphIngestionService } from "../../src/graph/ingestion/GraphIngestionService.js";
import type { FileInput } from "../../src/graph/ingestion/types.js";
import type { DocExtractionResult } from "../../src/graph/extraction/doc-types.js";
import { initializeLogger, resetLogger } from "../../src/logging/index.js";

// ── Minimal mocks (only what's needed for the wiring assertions) ───

class MockRepositoryCloner {
  async clone(_url: string, options?: { branch?: string }): Promise<CloneResult> {
    return {
      path: "/tmp/mock-repo",
      name: "mock-repo",
      branch: options?.branch || "main",
      commitSha: "abc1234567890abcdef1234567890abcdef12345",
    };
  }
  async cleanup(): Promise<void> {}
}

class MockFileScanner {
  private mockFiles: FileInfo[] = [];
  async scanFiles(): Promise<FileInfo[]> {
    return this.mockFiles;
  }
  setMockFiles(files: FileInfo[]) {
    this.mockFiles = files;
  }
}

class MockFileChunker {
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
          language: "typescript",
          fileSizeBytes: fileInfo.sizeBytes,
          contentHash: "h",
          fileModifiedAt: fileInfo.modifiedAt,
        },
      },
    ];
  }
}

class MockEmbeddingProvider implements EmbeddingProvider {
  public readonly providerId = "mock";
  public readonly modelId = "mock-model";
  public readonly dimensions = 8;
  async generateEmbedding() {
    return new Array<number>(this.dimensions).fill(0.1);
  }
  async generateEmbeddings(texts: string[]) {
    return texts.map(() => new Array<number>(this.dimensions).fill(0.1));
  }
  async healthCheck() {
    return true;
  }
  getCapabilities() {
    return {
      maxBatchSize: 100,
      maxTokensPerText: 8191,
      supportsGPU: false,
      requiresNetwork: false,
      estimatedLatencyMs: 1,
    };
  }
}

class MockChromaStorageClient implements ChromaStorageClient {
  private collections = new Set<string>();
  async connect() {}
  async healthCheck() {
    return true;
  }
  async getOrCreateCollection(name: string, _m?: CollectionEmbeddingMetadata): Promise<any> {
    this.collections.add(name);
    return { name };
  }
  async deleteCollection(name: string) {
    this.collections.delete(name);
  }
  async listCollections(): Promise<any[]> {
    return Array.from(this.collections).map((name) => ({ name }));
  }
  async addDocuments(_c: string, _d: DocumentInput[]) {}
  async similaritySearch(): Promise<any[]> {
    return [];
  }
  async getCollectionStats(): Promise<any> {
    return { name: "x", documentCount: 0, retrievedAt: new Date().toISOString() };
  }
  async upsertDocuments() {}
  async deleteDocuments() {}
  async getDocumentsByMetadata(): Promise<any[]> {
    return [];
  }
  async getCollectionEmbeddingMetadata(): Promise<ParsedEmbeddingMetadata | null> {
    return null;
  }
  async deleteDocumentsByFilePrefix() {
    return 0;
  }
  async listIndexedFilePaths(): Promise<Set<string>> {
    return new Set();
  }
}

class MockRepositoryService implements RepositoryMetadataService {
  private repos = new Map<string, RepositoryInfo>();
  async getRepository(name: string) {
    return this.repos.get(name) || null;
  }
  async listRepositories() {
    return Array.from(this.repos.values());
  }
  async updateRepository(info: RepositoryInfo) {
    this.repos.set(info.name, info);
  }
  async deleteRepository(name: string) {
    this.repos.delete(name);
  }
  async removeRepository(name: string) {
    this.repos.delete(name);
  }
}

/**
 * Returns an `ExtractionResult` shape that the `DocGraphBatcher` accepts for
 * markdown via the `MarkdownExtractionResult` cast — the structural cast
 * works because the only fields the batcher reads (`normalizedSource`,
 * `tokens`, `frontmatter.title`) are all optional. When they're absent
 * `DocEntityExtractor.extractFromContent` falls back to `content`.
 */
function makeMarkdownExtraction(content: string, filePath: string): ExtractionResult {
  return {
    content,
    metadata: {
      documentType: "markdown",
      filePath,
      fileSizeBytes: content.length,
      contentHash: "h",
      fileModifiedAt: new Date(),
    },
  };
}

function makePdfExtraction(content: string, filePath: string): ExtractionResult {
  return {
    content,
    metadata: {
      documentType: "pdf",
      title: "PDF Title",
      pageCount: 2,
      wordCount: content.split(/\s+/).length,
      filePath,
      fileSizeBytes: content.length,
      contentHash: "h",
      fileModifiedAt: new Date(),
    },
  };
}

class MockDocumentExtractor implements DocumentExtractor<ExtractionResult> {
  constructor(private resultByExt: Record<string, ExtractionResult>) {}
  async extract(filePath: string): Promise<ExtractionResult> {
    const ext = filePath.match(/\.[^.]+$/)?.[0]?.toLowerCase() ?? "";
    const r = this.resultByExt[ext];
    if (!r) throw new Error(`No mock extraction for ${ext}`);
    return r;
  }
  supports() {
    return true;
  }
}

class MockDocumentTypeDetector {
  constructor(private extractor: DocumentExtractor<unknown>) {}
  detect(filePath: string): DetectedType {
    const ext = filePath.match(/\.[^.]+$/)?.[0]?.toLowerCase();
    if (ext === ".pdf") return "pdf";
    if (ext === ".docx") return "docx";
    if (ext === ".md") return "markdown";
    if (ext === ".txt") return "txt";
    return "unknown";
  }
  getExtractor() {
    return this.extractor;
  }
  isSupported(filePath: string) {
    return this.detect(filePath) !== "unknown";
  }
  isDocument(filePath: string) {
    const t = this.detect(filePath);
    return t !== "unknown" && t !== "image";
  }
  isImage() {
    return false;
  }
  getExtension(filePath: string) {
    return filePath.match(/\.[^.]+$/)?.[0]?.toLowerCase() ?? "";
  }
}

class MockDocumentChunker {
  chunkDocument(
    extractionResult: ExtractionResult,
    filePath: string,
    source: string
  ): DocumentChunk[] {
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
          documentTitle: extractionResult.metadata.title,
        },
      },
    ];
  }
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
        endLine: 1,
        metadata: {
          extension: fileInfo.extension,
          language: "unknown",
          fileSizeBytes: fileInfo.sizeBytes,
          contentHash: "h",
          fileModifiedAt: fileInfo.modifiedAt,
        },
      },
    ];
  }
}

/**
 * Records the order and arguments of `ingestFiles` / `ingestDocumentGraph`
 * calls so the test can assert ordering and payload shape.
 */
class RecordingGraphIngestionService {
  public readonly calls: Array<
    | { kind: "ingestFiles"; files: FileInput[]; repository: string }
    | { kind: "ingestDocumentGraph"; repository: string; documents: DocExtractionResult[] }
  > = [];
  public ingestFilesError: Error | null = null;
  public ingestDocumentGraphError: Error | null = null;

  async ingestFiles(files: FileInput[], options: { repository: string }) {
    this.calls.push({
      kind: "ingestFiles",
      files: [...files],
      repository: options.repository,
    });
    if (this.ingestFilesError) throw this.ingestFilesError;
    return {
      status: "success" as const,
      repository: options.repository,
      stats: {
        filesProcessed: files.length,
        filesFailed: 0,
        nodesCreated: 0,
        relationshipsCreated: 0,
        durationMs: 1,
      },
      errors: [],
      completedAt: new Date(),
    };
  }

  async ingestDocumentGraph(repository: string, documents: readonly DocExtractionResult[]) {
    this.calls.push({
      kind: "ingestDocumentGraph",
      repository,
      documents: [...documents],
    });
    if (this.ingestDocumentGraphError) throw this.ingestDocumentGraphError;
    return {
      documentsCreated: documents.length,
      sectionsCreated: 0,
      externalLinksCreated: 0,
      edgesCreated: 0,
      staleMentionsRemoved: 0,
    };
  }
}

function file(relativePath: string, extension: string): FileInfo {
  return {
    relativePath,
    absolutePath: `/tmp/mock-repo/${relativePath}`,
    extension,
    sizeBytes: 100,
    modifiedAt: new Date(),
  };
}

// ── Tests ─────────────────────────────────────────────────────────

describe("IngestionService - doc-graph wiring (#580)", () => {
  let cloner: MockRepositoryCloner;
  let scanner: MockFileScanner;
  let codeChunker: MockFileChunker;
  let embedder: MockEmbeddingProvider;
  let chroma: MockChromaStorageClient;
  let repos: MockRepositoryService;
  let detector: MockDocumentTypeDetector;
  let docChunker: MockDocumentChunker;
  let graph: RecordingGraphIngestionService;

  const originalBunFile = Bun.file;

  beforeAll(() => {
    initializeLogger({ level: "silent", format: "json" });
  });

  afterAll(() => {
    resetLogger();
  });

  beforeEach(() => {
    cloner = new MockRepositoryCloner();
    scanner = new MockFileScanner();
    codeChunker = new MockFileChunker();
    embedder = new MockEmbeddingProvider();
    chroma = new MockChromaStorageClient();
    repos = new MockRepositoryService();
    docChunker = new MockDocumentChunker();
    graph = new RecordingGraphIngestionService();

    const extractor = new MockDocumentExtractor({
      ".md": makeMarkdownExtraction(
        "# Notes\n\nWe rely on the `AuthService` class.\n\nSee [external](https://example.com)\n\nAlso [[Other Page]] for context.",
        "docs/notes.md"
      ),
      ".pdf": makePdfExtraction(
        "PDF prose mentions AuthService and parseToken across pages.",
        "docs/paper.pdf"
      ),
    });
    detector = new MockDocumentTypeDetector(extractor as unknown as DocumentExtractor<unknown>);

    // Code files in scanner read content via Bun.file; stub it.
    (Bun as any).file = (_path: string) => ({
      text: async () => "export function code() { return 1; }",
      json: async () => ({}),
      arrayBuffer: async () => new ArrayBuffer(0),
      stream: () => null,
      size: 36,
      type: "text/plain",
    });
  });

  afterEach(() => {
    (Bun as any).file = originalBunFile;
  });

  function buildService(withGraph: boolean): IngestionService {
    return new IngestionService(
      cloner as any,
      scanner as any,
      codeChunker as any,
      embedder,
      chroma,
      repos,
      {
        documentChunker: docChunker as any,
        documentTypeDetector: detector as any,
        graphIngestionService: withGraph ? (graph as unknown as GraphIngestionService) : undefined,
      }
    );
  }

  it("does not call any graph methods when graph service is not configured", async () => {
    const service = buildService(false);
    scanner.setMockFiles([file("src/code.ts", ".ts"), file("docs/notes.md", ".md")]);

    const result = await service.indexRepository("https://github.com/test/repo.git");

    expect(result.status).toBe("success");
    // Sanity: graph recorder is unaffected because the service never received a
    // reference to it. (Confirms the gate at `runGraphIngestion`.)
    expect(graph.calls).toEqual([]);
  });

  it("calls ingestFiles BEFORE ingestDocumentGraph (two-pass MENTIONS precondition)", async () => {
    const service = buildService(true);
    scanner.setMockFiles([file("src/code.ts", ".ts"), file("docs/notes.md", ".md")]);

    const result = await service.indexRepository("https://github.com/test/repo.git");

    expect(result.status).toBe("success");
    expect(graph.calls).toHaveLength(2);
    expect(graph.calls[0]!.kind).toBe("ingestFiles");
    expect(graph.calls[1]!.kind).toBe("ingestDocumentGraph");
  });

  it("forwards code files to ingestFiles using content captured during chunking", async () => {
    const service = buildService(true);
    scanner.setMockFiles([file("src/a.ts", ".ts"), file("src/b.ts", ".ts")]);

    await service.indexRepository("https://github.com/test/repo.git");

    const ingestFilesCall = graph.calls.find((c) => c.kind === "ingestFiles");
    expect(ingestFilesCall).toBeDefined();
    if (ingestFilesCall && ingestFilesCall.kind === "ingestFiles") {
      expect(ingestFilesCall.files).toHaveLength(2);
      const paths = ingestFilesCall.files.map((f) => f.path).sort();
      expect(paths).toEqual(["src/a.ts", "src/b.ts"]);
      // Content was captured during chunking (not re-read from disk after the
      // batch loop). All entries must have a non-empty content string.
      expect(ingestFilesCall.files.every((f) => f.content.length > 0)).toBe(true);
    }
  });

  it("emits one DocExtractionResult per markdown / pdf doc file", async () => {
    const service = buildService(true);
    scanner.setMockFiles([
      file("src/code.ts", ".ts"),
      file("docs/notes.md", ".md"),
      file("docs/paper.pdf", ".pdf"),
    ]);

    await service.indexRepository("https://github.com/test/repo.git");

    const docCall = graph.calls.find((c) => c.kind === "ingestDocumentGraph");
    expect(docCall).toBeDefined();
    if (docCall && docCall.kind === "ingestDocumentGraph") {
      expect(docCall.documents).toHaveLength(2);

      const md = docCall.documents.find((d) => d.format === "markdown");
      const pdf = docCall.documents.find((d) => d.format === "pdf");
      expect(md).toBeDefined();
      expect(pdf).toBeDefined();
      expect(md!.title).toBe("Notes"); // first H1 fallback
      // PDF metadata.title was forwarded from the extraction
      expect(pdf!.title).toBe("PDF Title");
      // The wikilink in the markdown content should land in unresolved links.
      expect(
        md!.unresolvedLinks.some((l) => l.type === "wikilink" && l.target === "Other Page")
      ).toBe(true);
      // High-confidence MENTIONS for the inline `AuthService` codespan.
      expect(
        md!.codeMentions.some((m) => m.identifier === "AuthService" && m.confidence === "high")
      ).toBe(true);
    }
  });

  it("skips ingestFiles when there are no code files but still runs ingestDocumentGraph", async () => {
    const service = buildService(true);
    scanner.setMockFiles([file("docs/notes.md", ".md")]);

    await service.indexRepository("https://github.com/test/repo.git");

    expect(graph.calls).toHaveLength(1);
    expect(graph.calls[0]!.kind).toBe("ingestDocumentGraph");
  });

  it("skips ingestDocumentGraph when there are no doc files", async () => {
    const service = buildService(true);
    scanner.setMockFiles([file("src/a.ts", ".ts")]);

    await service.indexRepository("https://github.com/test/repo.git");

    expect(graph.calls).toHaveLength(1);
    expect(graph.calls[0]!.kind).toBe("ingestFiles");
  });

  it("records graph failures as non-fatal IndexErrors and still completes ChromaDB indexing", async () => {
    const service = buildService(true);
    scanner.setMockFiles([file("src/code.ts", ".ts"), file("docs/notes.md", ".md")]);
    graph.ingestDocumentGraphError = new Error("FalkorDB unavailable");

    const result = await service.indexRepository("https://github.com/test/repo.git");

    // Status is "partial" (errors > 0) but the run completes — ChromaDB stayed
    // populated even though FalkorDB went sideways.
    expect(result.status).toBe("partial");
    expect(result.errors.some((e) => e.message.includes("Document graph ingestion failed"))).toBe(
      true
    );
    expect(result.stats.filesProcessed).toBeGreaterThan(0);
  });
});
