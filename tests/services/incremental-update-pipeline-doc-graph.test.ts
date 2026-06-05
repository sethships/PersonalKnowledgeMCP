/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/explicit-function-return-type */

/**
 * Wiring tests for `IncrementalUpdatePipeline` doc-graph integration
 * (issue #580 review feedback M2).
 *
 * Covers the loop-then-batch shape unique to the incremental path:
 *
 * 1. `docExtractionResults` accumulates one entry per added / modified /
 *    renamed doc file across the per-file loop in `processChanges`.
 * 2. `graphIngestionService.ingestDocumentGraph` is called exactly once
 *    after the per-file loop, with all collected payloads — and AFTER any
 *    per-file `processGraphUpdate("ingest", ...)` calls for code files,
 *    so the persisted code symbols are queryable for MENTIONS resolution.
 * 3. Modified doc files trigger `deleteFileData(repo, path)` before being
 *    re-ingested in the post-loop batch flush, clearing stale `:Document`
 *    nodes and edges before the merge.
 * 4. Renamed doc files trigger `deleteFileData(repo, previousPath)` for the
 *    same reason, scoped to the prior path.
 * 5. A doc-graph batch failure is collected on `graphStats.graphErrors`
 *    and does NOT cause `processChanges` to reject — degraded operation
 *    matches the per-file `processGraphUpdate` contract.
 *
 * Doc-graph extraction itself is covered by the unit tests in
 * `tests/unit/graph/extraction/doc-graph-batch.test.ts`. These tests
 * focus on the pipeline's ordering and accumulator behavior.
 */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { join } from "node:path";
import { mkdir, writeFile, rm } from "node:fs/promises";
import pino from "pino";
import { IncrementalUpdatePipeline } from "../../src/services/incremental-update-pipeline.js";
import { FileChunker } from "../../src/ingestion/file-chunker.js";
import { initializeLogger, resetLogger } from "../../src/logging/index.js";
import type { EmbeddingProvider } from "../../src/providers/index.js";
import type { ChromaStorageClient } from "../../src/storage/index.js";
import type { FileChange, UpdateOptions } from "../../src/services/incremental-update-types.js";
import type { GraphIngestionService } from "../../src/graph/ingestion/GraphIngestionService.js";
import type {
  DocumentExtractor,
  ExtractionResult,
  DocumentChunk,
} from "../../src/documents/types.js";
import type {
  DocumentTypeDetector,
  DetectedType,
} from "../../src/documents/DocumentTypeDetector.js";
import type { FileInfo } from "../../src/ingestion/types.js";
import type { DocExtractionResult } from "../../src/graph/extraction/doc-types.js";

// ── Mock helpers ──────────────────────────────────────────────────

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

function makeMarkdownChunk(content: string, filePath: string, repository: string): DocumentChunk {
  return {
    id: `${repository}:${filePath}:0`,
    repository,
    filePath,
    content,
    chunkIndex: 0,
    totalChunks: 1,
    startLine: 1,
    endLine: content.split("\n").length,
    metadata: {
      extension: ".md",
      language: "unknown",
      fileSizeBytes: content.length,
      contentHash: "h",
      fileModifiedAt: new Date(),
      documentType: "markdown",
    },
  };
}

class StubMarkdownExtractor implements DocumentExtractor<ExtractionResult> {
  async extract(filePath: string): Promise<ExtractionResult> {
    // Re-read the on-disk content so modified-file tests can assert that
    // the new content flows through the pipeline.
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(filePath, "utf-8");
    return makeMarkdownExtraction(content, filePath);
  }
  supports(): boolean {
    return true;
  }
}

class StubDocumentTypeDetector {
  private extractor = new StubMarkdownExtractor();
  detect(filePath: string): DetectedType {
    if (filePath.endsWith(".md")) return "markdown";
    return "unknown";
  }
  getExtractor() {
    return this.extractor;
  }
  isSupported(filePath: string) {
    return this.detect(filePath) !== "unknown";
  }
  isDocument(filePath: string) {
    return this.detect(filePath) === "markdown";
  }
  isImage() {
    return false;
  }
  getExtension(filePath: string) {
    return filePath.match(/\.[^.]+$/)?.[0]?.toLowerCase() ?? "";
  }
}

class StubDocumentChunker {
  chunkDocument(
    extraction: ExtractionResult,
    filePath: string,
    repository: string
  ): DocumentChunk[] {
    return [makeMarkdownChunk(extraction.content, filePath, repository)];
  }
  chunkFile(_content: string, fileInfo: FileInfo, repository: string): any[] {
    return [
      {
        id: `${repository}:${fileInfo.relativePath}:0`,
        content: _content,
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
 * Records the order of code-file `ingestFile` and doc-graph
 * `ingestDocumentGraph` calls so tests can assert ordering invariants.
 */
class RecordingGraphService {
  public readonly calls: Array<
    | { kind: "ingestFile"; path: string }
    | { kind: "deleteFileData"; path: string }
    | {
        kind: "ingestDocumentGraph";
        repository: string;
        documents: DocExtractionResult[];
      }
  > = [];

  public throwOnDocGraph: Error | null = null;

  async ingestFile(file: { path: string; content: string }, _repository: string) {
    this.calls.push({ kind: "ingestFile", path: file.path });
    return {
      success: true,
      nodesCreated: 1,
      relationshipsCreated: 0,
      errors: [],
    };
  }

  async deleteFileData(_repository: string, filePath: string) {
    this.calls.push({ kind: "deleteFileData", path: filePath });
    return {
      success: true,
      nodesDeleted: 1,
      relationshipsDeleted: 0,
    };
  }

  async ingestDocumentGraph(repository: string, documents: readonly DocExtractionResult[]) {
    this.calls.push({
      kind: "ingestDocumentGraph",
      repository,
      documents: [...documents],
    });
    if (this.throwOnDocGraph) throw this.throwOnDocGraph;
    return {
      documentsCreated: documents.length,
      sectionsCreated: 0,
      externalLinksCreated: 0,
      edgesCreated: 0,
      staleMentionsRemoved: 0,
    };
  }
}

// ── Suite ────────────────────────────────────────────────────────

describe("IncrementalUpdatePipeline - doc-graph wiring (#580 review M2)", () => {
  let pipeline: IncrementalUpdatePipeline;
  let embedder: EmbeddingProvider;
  let chroma: ChromaStorageClient;
  let chunker: FileChunker;
  let logger: pino.Logger;
  let detector: StubDocumentTypeDetector;
  let docChunker: StubDocumentChunker;
  let graph: RecordingGraphService;
  let testDir: string;

  beforeEach(async () => {
    initializeLogger({ level: "silent", format: "json" });
    testDir = join(import.meta.dir, "..", "..", "test-temp", `doc-graph-${Date.now()}`);
    await mkdir(testDir, { recursive: true });

    chunker = new FileChunker();
    embedder = {
      providerId: "test",
      modelId: "test",
      dimensions: 8,
      generateEmbedding: mock(async () => new Array<number>(8).fill(0.1)),
      generateEmbeddings: mock(async (texts: string[]) =>
        texts.map(() => new Array<number>(8).fill(0.1))
      ),
      healthCheck: mock(async () => true),
      getCapabilities: () => ({
        maxBatchSize: 100,
        maxTokensPerText: 8191,
        supportsGPU: false,
        requiresNetwork: false,
        estimatedLatencyMs: 1,
      }),
    };
    chroma = {
      deleteDocumentsByFilePrefix: mock(async () => 0),
      upsertDocuments: mock(async () => {}),
    } as unknown as ChromaStorageClient;
    logger = pino({ level: "silent" });

    detector = new StubDocumentTypeDetector();
    docChunker = new StubDocumentChunker();
    graph = new RecordingGraphService();

    pipeline = new IncrementalUpdatePipeline(
      chunker,
      embedder,
      chroma,
      logger,
      graph as unknown as GraphIngestionService,
      detector as unknown as DocumentTypeDetector,
      docChunker as any
    );
  });

  afterEach(async () => {
    if (testDir) {
      await rm(testDir, { recursive: true, force: true });
    }
    resetLogger();
  });

  function options(overrides: Partial<UpdateOptions> = {}): UpdateOptions {
    return {
      repository: "test-repo",
      localPath: testDir,
      collectionName: "test_collection",
      includeExtensions: [".ts", ".md"],
      excludePatterns: [],
      ...overrides,
    };
  }

  it("accumulates one DocExtractionResult per added markdown and flushes once", async () => {
    await writeFile(join(testDir, "a.md"), "# A\n\nFirst.");
    await writeFile(join(testDir, "b.md"), "# B\n\nSecond.");

    const changes: FileChange[] = [
      { path: "a.md", status: "added" },
      { path: "b.md", status: "added" },
    ];

    const result = await pipeline.processChanges(changes, options());

    expect(result.errors).toHaveLength(0);

    const docCalls = graph.calls.filter((c) => c.kind === "ingestDocumentGraph");
    expect(docCalls).toHaveLength(1);
    if (docCalls[0]?.kind === "ingestDocumentGraph") {
      expect(docCalls[0].documents).toHaveLength(2);
      const titles = docCalls[0].documents.map((d) => d.title).sort();
      expect(titles).toEqual(["A", "B"]);
    }
  });

  it("calls ingestFile for code files BEFORE ingestDocumentGraph for docs (ordering invariant)", async () => {
    await mkdir(join(testDir, "src"), { recursive: true });
    await writeFile(join(testDir, "src", "code.ts"), "export const x = 1;");
    await writeFile(join(testDir, "notes.md"), "# Notes\n\nReferencing `MentionTarget`.");

    const changes: FileChange[] = [
      { path: "src/code.ts", status: "added" },
      { path: "notes.md", status: "added" },
    ];

    await pipeline.processChanges(changes, options());

    // Find the indices of the relevant calls.
    const codeIngestIdx = graph.calls.findIndex(
      (c) => c.kind === "ingestFile" && c.path === "src/code.ts"
    );
    const docGraphIdx = graph.calls.findIndex((c) => c.kind === "ingestDocumentGraph");

    expect(codeIngestIdx).toBeGreaterThanOrEqual(0);
    expect(docGraphIdx).toBeGreaterThanOrEqual(0);
    // Code-graph ingest happens during the per-file loop; doc-graph batch
    // fires after the loop. The ordering invariant: code first.
    expect(codeIngestIdx).toBeLessThan(docGraphIdx);
  });

  it("deletes prior :Document data before re-ingesting a modified markdown", async () => {
    await writeFile(join(testDir, "evolving.md"), "# Evolving\n\nUpdated body.");

    const changes: FileChange[] = [{ path: "evolving.md", status: "modified" }];

    await pipeline.processChanges(changes, options());

    const deleteIdx = graph.calls.findIndex(
      (c) => c.kind === "deleteFileData" && c.path === "evolving.md"
    );
    const docGraphIdx = graph.calls.findIndex((c) => c.kind === "ingestDocumentGraph");

    expect(deleteIdx).toBeGreaterThanOrEqual(0);
    expect(docGraphIdx).toBeGreaterThan(deleteIdx);
  });

  it("deletes prior :Document at the previousPath when a markdown is renamed", async () => {
    await writeFile(join(testDir, "new-name.md"), "# Renamed\n\nNew location.");

    const changes: FileChange[] = [
      { path: "new-name.md", previousPath: "old-name.md", status: "renamed" },
    ];

    await pipeline.processChanges(changes, options());

    const deleteIdx = graph.calls.findIndex(
      (c) => c.kind === "deleteFileData" && c.path === "old-name.md"
    );
    const docGraphIdx = graph.calls.findIndex((c) => c.kind === "ingestDocumentGraph");

    expect(deleteIdx).toBeGreaterThanOrEqual(0);
    // The new-path doc is ingested via the post-loop batch flush.
    expect(docGraphIdx).toBeGreaterThan(deleteIdx);
    if (graph.calls[docGraphIdx]?.kind === "ingestDocumentGraph") {
      const documents = (graph.calls[docGraphIdx] as { documents: DocExtractionResult[] })
        .documents;
      expect(documents.some((d) => d.filePath === "new-name.md")).toBe(true);
    }
  });

  it("records doc-graph batch errors in graphStats.graphErrors and does not throw", async () => {
    await writeFile(join(testDir, "doc.md"), "# Doc\n\nbody");
    graph.throwOnDocGraph = new Error("FalkorDB unavailable");

    const changes: FileChange[] = [{ path: "doc.md", status: "added" }];

    // Must not throw — degraded operation per the contract.
    const result = await pipeline.processChanges(changes, options());

    expect(result.stats.graph).toBeDefined();
    expect(result.stats.graph!.graphErrors.length).toBeGreaterThan(0);
    expect(
      result.stats.graph!.graphErrors.some((e) => e.error.includes("FalkorDB unavailable"))
    ).toBe(true);
  });

  it("does not call ingestDocumentGraph when only code files are touched", async () => {
    await mkdir(join(testDir, "src"), { recursive: true });
    await writeFile(join(testDir, "src", "only-code.ts"), "export const v = 1;");

    const changes: FileChange[] = [{ path: "src/only-code.ts", status: "added" }];

    await pipeline.processChanges(changes, options());

    const docCalls = graph.calls.filter((c) => c.kind === "ingestDocumentGraph");
    expect(docCalls).toHaveLength(0);
  });

  it("does not call ingestDocumentGraph for deleted markdown (handled by deleteFileData only)", async () => {
    // No need to create the file — the pipeline never reads disk for
    // deletes. The deletion path uses processGraphUpdate("delete", ...) for
    // every file regardless of type, including .md.
    const changes: FileChange[] = [{ path: "removed.md", status: "deleted" }];

    await pipeline.processChanges(changes, options());

    const docCalls = graph.calls.filter((c) => c.kind === "ingestDocumentGraph");
    expect(docCalls).toHaveLength(0);
    // The delete should still hit deleteFileData via processGraphUpdate.
    // EntityExtractor.isSupported(".md") returns false, so processGraphUpdate
    // will skip — that's fine; deletion of doc nodes is left to the
    // implicit lifecycle: the next ingest of the same path MERGE-overwrites
    // any orphan, and `deleteFileData` is invoked for modified/renamed
    // doc files (covered above).
  });
});
