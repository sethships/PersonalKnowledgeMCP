/**
 * Tests for IncrementalUpdatePipeline service
 *
 * @module tests/services/incremental-update-pipeline
 */

/* eslint-disable @typescript-eslint/unbound-method */

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

describe("IncrementalUpdatePipeline", () => {
  let pipeline: IncrementalUpdatePipeline;
  let mockEmbeddingProvider: EmbeddingProvider;
  let mockStorageClient: ChromaStorageClient;
  let fileChunker: FileChunker;
  let logger: pino.Logger;
  let testDir: string;

  beforeEach(async () => {
    // Initialize logger for tests
    initializeLogger({ level: "silent", format: "json" });

    // Create test directory
    testDir = join(import.meta.dir, "..", "..", "test-temp", `test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });

    // Create real FileChunker
    fileChunker = new FileChunker();

    // Create mock embedding provider
    mockEmbeddingProvider = {
      providerId: "test-provider",
      modelId: "test-model",
      dimensions: 1536,
      generateEmbedding: mock(async (_text: string) => new Array(1536).fill(0.1) as number[]),
      generateEmbeddings: mock(async (texts: string[]) =>
        texts.map(() => new Array(1536).fill(0.1) as number[])
      ),
      healthCheck: mock(async () => true),
      getCapabilities: () => ({
        maxBatchSize: 100,
        maxTokensPerText: 8191,
        supportsGPU: false,
        requiresNetwork: false,
        estimatedLatencyMs: 10,
      }),
    };

    // Create mock storage client
    mockStorageClient = {
      deleteDocumentsByFilePrefix: mock(async (_collection, _repo, _path) => 5),
      upsertDocuments: mock(async (_collection, _documents) => {}),
    } as unknown as ChromaStorageClient;

    // Create logger (silent in tests)
    logger = pino({ level: "silent" });

    // Create pipeline
    pipeline = new IncrementalUpdatePipeline(
      fileChunker,
      mockEmbeddingProvider,
      mockStorageClient,
      logger
    );
  });

  afterEach(async () => {
    // Clean up test directory (guard against undefined if beforeEach failed)
    if (testDir) {
      await rm(testDir, { recursive: true, force: true });
    }

    // Reset logger for next test
    resetLogger();
  });

  describe("processChanges", () => {
    const baseOptions: UpdateOptions = {
      repository: "test-repo",
      localPath: "",
      collectionName: "test_collection",
      includeExtensions: [".ts", ".js", ".md"],
      excludePatterns: ["node_modules/**", "dist/**"],
    };

    it("should handle empty change list gracefully", async () => {
      const result = await pipeline.processChanges([], baseOptions);

      expect(result.stats.filesAdded).toBe(0);
      expect(result.stats.filesModified).toBe(0);
      expect(result.stats.filesDeleted).toBe(0);
      expect(result.stats.chunksUpserted).toBe(0);
      expect(result.stats.chunksDeleted).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(result.stats.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("should process added files", async () => {
      // Create test file
      const testFile = "src/test.ts";
      const testFilePath = join(testDir, testFile);
      await mkdir(join(testDir, "src"), { recursive: true });
      await writeFile(
        testFilePath,
        "export function hello() {\n  console.log('Hello, world!');\n}\n"
      );

      const changes: FileChange[] = [{ path: testFile, status: "added" }];
      const options: UpdateOptions = { ...baseOptions, localPath: testDir };

      const result = await pipeline.processChanges(changes, options);

      expect(result.stats.filesAdded).toBe(1);
      expect(result.stats.filesModified).toBe(0);
      expect(result.stats.filesDeleted).toBe(0);
      expect(result.stats.chunksUpserted).toBeGreaterThan(0);
      expect(result.errors).toHaveLength(0);

      // Verify embedding provider was called
      expect(mockEmbeddingProvider.generateEmbeddings).toHaveBeenCalled();

      // Verify storage client was called
      expect(mockStorageClient.upsertDocuments).toHaveBeenCalled();
    });

    it("should process modified files", async () => {
      // Create test file
      const testFile = "src/modified.ts";
      const testFilePath = join(testDir, testFile);
      await mkdir(join(testDir, "src"), { recursive: true });
      await writeFile(
        testFilePath,
        "export function updated() {\n  return 'updated content';\n}\n"
      );

      const changes: FileChange[] = [{ path: testFile, status: "modified" }];
      const options: UpdateOptions = { ...baseOptions, localPath: testDir };

      const result = await pipeline.processChanges(changes, options);

      expect(result.stats.filesModified).toBe(1);
      expect(result.stats.filesAdded).toBe(0);
      expect(result.stats.filesDeleted).toBe(0);
      expect(result.stats.chunksDeleted).toBe(5); // Mock returns 5
      expect(result.stats.chunksUpserted).toBeGreaterThan(0);
      expect(result.errors).toHaveLength(0);

      // Verify old chunks were deleted
      expect(mockStorageClient.deleteDocumentsByFilePrefix).toHaveBeenCalledWith(
        "test_collection",
        "test-repo",
        testFile
      );

      // Verify new chunks were upserted
      expect(mockStorageClient.upsertDocuments).toHaveBeenCalled();
    });

    it("should process deleted files", async () => {
      const changes: FileChange[] = [{ path: "src/deleted.ts", status: "deleted" }];
      const options: UpdateOptions = { ...baseOptions, localPath: testDir };

      const result = await pipeline.processChanges(changes, options);

      expect(result.stats.filesDeleted).toBe(1);
      expect(result.stats.filesAdded).toBe(0);
      expect(result.stats.filesModified).toBe(0);
      expect(result.stats.chunksDeleted).toBe(5); // Mock returns 5
      expect(result.stats.chunksUpserted).toBe(0);
      expect(result.errors).toHaveLength(0);

      // Verify chunks were deleted
      expect(mockStorageClient.deleteDocumentsByFilePrefix).toHaveBeenCalledWith(
        "test_collection",
        "test-repo",
        "src/deleted.ts"
      );

      // Verify no upsert was called for deleted files
      expect(mockStorageClient.upsertDocuments).not.toHaveBeenCalled();
    });

    it("should process renamed files", async () => {
      // Create test file at new location
      const newPath = "src/renamed-new.ts";
      const oldPath = "src/renamed-old.ts";
      const testFilePath = join(testDir, newPath);
      await mkdir(join(testDir, "src"), { recursive: true });
      await writeFile(
        testFilePath,
        "export function renamed() {\n  return 'renamed content';\n}\n"
      );

      const changes: FileChange[] = [
        {
          path: newPath,
          status: "renamed",
          previousPath: oldPath,
        },
      ];
      const options: UpdateOptions = { ...baseOptions, localPath: testDir };

      const result = await pipeline.processChanges(changes, options);

      expect(result.stats.filesModified).toBe(1); // Rename counts as modification
      expect(result.stats.filesAdded).toBe(0);
      expect(result.stats.filesDeleted).toBe(0);
      expect(result.stats.chunksDeleted).toBe(5); // Old path chunks deleted
      expect(result.stats.chunksUpserted).toBeGreaterThan(0);
      expect(result.errors).toHaveLength(0);

      // Verify old path chunks were deleted
      expect(mockStorageClient.deleteDocumentsByFilePrefix).toHaveBeenCalledWith(
        "test_collection",
        "test-repo",
        oldPath
      );

      // Verify new chunks were upserted
      expect(mockStorageClient.upsertDocuments).toHaveBeenCalled();
    });

    it("should filter files by extension", async () => {
      // Create files with different extensions
      await mkdir(join(testDir, "src"), { recursive: true });
      await writeFile(join(testDir, "src/included.ts"), "export const x = 1;");
      await writeFile(join(testDir, "src/excluded.py"), "print('hello')");

      const changes: FileChange[] = [
        { path: "src/included.ts", status: "added" },
        { path: "src/excluded.py", status: "added" },
      ];
      const options: UpdateOptions = { ...baseOptions, localPath: testDir };

      const result = await pipeline.processChanges(changes, options);

      // Only .ts file should be processed
      expect(result.stats.filesAdded).toBe(1);
      expect(result.stats.chunksUpserted).toBeGreaterThan(0);
      expect(result.errors).toHaveLength(0);
    });

    it("should filter files by exclusion patterns", async () => {
      // Create files in different directories
      await mkdir(join(testDir, "src"), { recursive: true });
      await mkdir(join(testDir, "node_modules"), { recursive: true });
      await writeFile(join(testDir, "src/included.ts"), "export const x = 1;");
      await writeFile(join(testDir, "node_modules/excluded.ts"), "export const y = 2;");

      const changes: FileChange[] = [
        { path: "src/included.ts", status: "added" },
        { path: "node_modules/excluded.ts", status: "added" },
      ];
      const options: UpdateOptions = { ...baseOptions, localPath: testDir };

      const result = await pipeline.processChanges(changes, options);

      // Only src file should be processed
      expect(result.stats.filesAdded).toBe(1);
      expect(result.stats.chunksUpserted).toBeGreaterThan(0);
      expect(result.errors).toHaveLength(0);
    });

    it("should handle all files filtered out", async () => {
      const changes: FileChange[] = [
        { path: "node_modules/package.py", status: "added" },
        { path: "dist/bundle.ts", status: "added" },
      ];
      const options: UpdateOptions = { ...baseOptions, localPath: testDir };

      const result = await pipeline.processChanges(changes, options);

      expect(result.stats.filesAdded).toBe(0);
      expect(result.stats.chunksUpserted).toBe(0);
      expect(result.stats.chunksDeleted).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it("should batch embeddings correctly", async () => {
      // Create a file that will generate multiple chunks
      const largeContent = Array(200)
        .fill(0)
        .map((_, i) => `export function func${i}() { return ${i}; }`)
        .join("\n");

      await mkdir(join(testDir, "src"), { recursive: true });
      await writeFile(join(testDir, "src/large.ts"), largeContent);

      const changes: FileChange[] = [{ path: "src/large.ts", status: "added" }];
      const options: UpdateOptions = { ...baseOptions, localPath: testDir };

      const result = await pipeline.processChanges(changes, options);

      expect(result.stats.filesAdded).toBe(1);
      expect(result.stats.chunksUpserted).toBeGreaterThan(1);

      // Verify embeddings were generated in batches
      expect(mockEmbeddingProvider.generateEmbeddings).toHaveBeenCalled();
    });

    it("should continue after file read error", async () => {
      // Create only one of two files
      await mkdir(join(testDir, "src"), { recursive: true });
      await writeFile(join(testDir, "src/exists.ts"), "export const x = 1;");

      const changes: FileChange[] = [
        { path: "src/exists.ts", status: "added" },
        { path: "src/missing.ts", status: "added" }, // This file doesn't exist
      ];
      const options: UpdateOptions = { ...baseOptions, localPath: testDir };

      const result = await pipeline.processChanges(changes, options);

      // One file succeeded, one failed
      expect(result.stats.filesAdded).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.path).toBe("src/missing.ts");
      // Error message varies by platform: "ENOENT" (Windows) or "No such file or directory" (Linux)
      expect(result.errors[0]?.error).toMatch(/ENOENT|No such file or directory/);
    });

    it("should handle renamed file with missing previousPath", async () => {
      const changes: FileChange[] = [
        {
          path: "src/renamed.ts",
          status: "renamed",
          // Missing previousPath - should cause error
        },
      ];
      const options: UpdateOptions = { ...baseOptions, localPath: testDir };

      const result = await pipeline.processChanges(changes, options);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.path).toBe("src/renamed.ts");
      expect(result.errors[0]?.error).toContain("previousPath");
    });

    it("should handle mixed change types in single batch", async () => {
      // Create test files
      await mkdir(join(testDir, "src"), { recursive: true });
      await writeFile(join(testDir, "src/added.ts"), "export const a = 1;");
      await writeFile(join(testDir, "src/modified.ts"), "export const m = 2;");
      await writeFile(join(testDir, "src/renamed.ts"), "export const r = 3;");

      const changes: FileChange[] = [
        { path: "src/added.ts", status: "added" },
        { path: "src/modified.ts", status: "modified" },
        { path: "src/deleted.ts", status: "deleted" },
        { path: "src/renamed.ts", status: "renamed", previousPath: "src/old.ts" },
      ];
      const options: UpdateOptions = { ...baseOptions, localPath: testDir };

      const result = await pipeline.processChanges(changes, options);

      expect(result.stats.filesAdded).toBe(1);
      expect(result.stats.filesModified).toBe(2); // modified + renamed
      expect(result.stats.filesDeleted).toBe(1);
      expect(result.stats.chunksUpserted).toBeGreaterThan(0);
      expect(result.stats.chunksDeleted).toBeGreaterThan(0);

      // Verify correct number of delete calls (modified + deleted + renamed)
      expect(mockStorageClient.deleteDocumentsByFilePrefix).toHaveBeenCalledTimes(3);
    });

    it("should handle empty file (no chunks)", async () => {
      // Create empty file
      await mkdir(join(testDir, "src"), { recursive: true });
      await writeFile(join(testDir, "src/empty.ts"), "");

      const changes: FileChange[] = [{ path: "src/empty.ts", status: "added" }];
      const options: UpdateOptions = { ...baseOptions, localPath: testDir };

      const result = await pipeline.processChanges(changes, options);

      expect(result.stats.filesAdded).toBe(1);
      expect(result.stats.chunksUpserted).toBe(0); // Empty file produces no chunks
      expect(result.errors).toHaveLength(0);
    });

    it("should validate UpdateResult structure", async () => {
      const result = await pipeline.processChanges([], baseOptions);

      // Verify result structure
      expect(result).toHaveProperty("stats");
      expect(result).toHaveProperty("errors");
      expect(result.stats).toHaveProperty("filesAdded");
      expect(result.stats).toHaveProperty("filesModified");
      expect(result.stats).toHaveProperty("filesDeleted");
      expect(result.stats).toHaveProperty("chunksUpserted");
      expect(result.stats).toHaveProperty("chunksDeleted");
      expect(result.stats).toHaveProperty("durationMs");
      expect(Array.isArray(result.errors)).toBe(true);
    });

    it("should fall back to DEFAULT_EXTENSIONS when includeExtensions is empty", async () => {
      // Create test files with default-supported extensions
      await mkdir(join(testDir, "src"), { recursive: true });
      await writeFile(join(testDir, "src/app.ts"), "export const x = 1;");
      await writeFile(join(testDir, "src/util.py"), "x = 1");

      const changes: FileChange[] = [
        { path: "src/app.ts", status: "added" },
        { path: "src/util.py", status: "added" },
      ];

      // Empty includeExtensions simulates the bug: repositories store [] in metadata
      const options: UpdateOptions = {
        ...baseOptions,
        localPath: testDir,
        includeExtensions: [],
      };

      const result = await pipeline.processChanges(changes, options);

      // Both .ts and .py are in DEFAULT_EXTENSIONS, so both should be processed
      expect(result.stats.filesAdded).toBe(2);
      expect(result.errors).toHaveLength(0);
      expect(result.stats.chunksUpserted).toBeGreaterThan(0);
    });

    it("should filter non-default extensions even when falling back to defaults", async () => {
      // Create test files - one with default extension, one without
      await mkdir(join(testDir, "src"), { recursive: true });
      await mkdir(join(testDir, "assets"), { recursive: true });
      await writeFile(join(testDir, "src/app.ts"), "export const x = 1;");
      await writeFile(join(testDir, "assets/image.svg"), "<svg></svg>");

      const changes: FileChange[] = [
        { path: "src/app.ts", status: "added" },
        { path: "assets/image.svg", status: "added" },
      ];

      const options: UpdateOptions = {
        ...baseOptions,
        localPath: testDir,
        includeExtensions: [], // Empty - triggers fallback
      };

      const result = await pipeline.processChanges(changes, options);

      // .ts is in defaults but .svg is not - only .ts should be processed
      expect(result.stats.filesAdded).toBe(1);
      expect(result.errors).toHaveLength(0);
    });

    it("should use explicit includeExtensions when provided (not empty)", async () => {
      // Create test files
      await mkdir(join(testDir, "src"), { recursive: true });
      await writeFile(join(testDir, "src/app.ts"), "export const x = 1;");
      await writeFile(join(testDir, "src/util.py"), "x = 1");

      const changes: FileChange[] = [
        { path: "src/app.ts", status: "added" },
        { path: "src/util.py", status: "added" },
      ];

      // Explicit extensions: only .ts, NOT .py
      const options: UpdateOptions = {
        ...baseOptions,
        localPath: testDir,
        includeExtensions: [".ts"],
      };

      const result = await pipeline.processChanges(changes, options);

      // Only .ts should be processed
      expect(result.stats.filesAdded).toBe(1);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("partial failure handling", () => {
    const baseOptions: UpdateOptions = {
      repository: "test-repo",
      localPath: "",
      collectionName: "test_collection",
      includeExtensions: [".ts", ".js", ".md"],
      excludePatterns: ["node_modules/**", "dist/**"],
    };

    it("should collect all errors from multiple file failures", async () => {
      // No files created - all will fail with ENOENT
      const changes: FileChange[] = [
        { path: "src/missing1.ts", status: "added" },
        { path: "src/missing2.ts", status: "added" },
        { path: "src/missing3.ts", status: "added" },
      ];
      const options: UpdateOptions = { ...baseOptions, localPath: testDir };

      const result = await pipeline.processChanges(changes, options);

      // All three files should have errors
      expect(result.errors).toHaveLength(3);
      expect(result.errors.map((e) => e.path)).toContain("src/missing1.ts");
      expect(result.errors.map((e) => e.path)).toContain("src/missing2.ts");
      expect(result.errors.map((e) => e.path)).toContain("src/missing3.ts");

      // Stats should reflect no successful processing
      expect(result.stats.filesAdded).toBe(0);
      expect(result.stats.chunksUpserted).toBe(0);
    });

    it("should process successful files even when others fail", async () => {
      // Create only some of the files
      await mkdir(join(testDir, "src"), { recursive: true });
      await writeFile(join(testDir, "src/success1.ts"), "export const a = 1;");
      await writeFile(join(testDir, "src/success2.ts"), "export const b = 2;");

      const changes: FileChange[] = [
        { path: "src/success1.ts", status: "added" },
        { path: "src/missing.ts", status: "added" }, // This will fail
        { path: "src/success2.ts", status: "added" },
      ];
      const options: UpdateOptions = { ...baseOptions, localPath: testDir };

      const result = await pipeline.processChanges(changes, options);

      // Two files succeeded, one failed
      expect(result.stats.filesAdded).toBe(2);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.path).toBe("src/missing.ts");
      expect(result.stats.chunksUpserted).toBeGreaterThan(0);
    });

    it("should include descriptive error messages in errors array", async () => {
      const changes: FileChange[] = [{ path: "src/nonexistent.ts", status: "added" }];
      const options: UpdateOptions = { ...baseOptions, localPath: testDir };

      const result = await pipeline.processChanges(changes, options);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toHaveProperty("path", "src/nonexistent.ts");
      expect(result.errors[0]).toHaveProperty("error");
      // Error message should be descriptive (ENOENT or similar)
      expect(result.errors[0]?.error).toMatch(/ENOENT|No such file/);
    });

    it("should handle mixed success and failure across change types", async () => {
      // Create some files, leave others missing
      await mkdir(join(testDir, "src"), { recursive: true });
      await writeFile(join(testDir, "src/added-success.ts"), "export const x = 1;");
      await writeFile(join(testDir, "src/modified-success.ts"), "export const y = 2;");
      // src/added-fail.ts is intentionally not created
      // src/renamed-success.ts will have a valid previousPath
      await writeFile(join(testDir, "src/renamed-success.ts"), "export const z = 3;");

      const changes: FileChange[] = [
        { path: "src/added-success.ts", status: "added" },
        { path: "src/added-fail.ts", status: "added" }, // File doesn't exist
        { path: "src/modified-success.ts", status: "modified" },
        { path: "src/deleted.ts", status: "deleted" }, // Deletes always succeed
        { path: "src/renamed-success.ts", status: "renamed", previousPath: "src/old.ts" },
        { path: "src/renamed-fail.ts", status: "renamed" }, // Missing previousPath
      ];
      const options: UpdateOptions = { ...baseOptions, localPath: testDir };

      const result = await pipeline.processChanges(changes, options);

      // Verify successes
      expect(result.stats.filesAdded).toBe(1); // added-success
      expect(result.stats.filesModified).toBe(2); // modified-success + renamed-success
      expect(result.stats.filesDeleted).toBe(1); // deleted
      expect(result.stats.chunksUpserted).toBeGreaterThan(0);

      // Verify failures are collected with correct paths
      expect(result.errors).toHaveLength(2);
      const errorPaths = result.errors.map((e) => e.path);
      expect(errorPaths).toContain("src/added-fail.ts");
      expect(errorPaths).toContain("src/renamed-fail.ts");
    });

    it("should return stats with durationMs even when all files fail", async () => {
      const changes: FileChange[] = [
        { path: "src/fail1.ts", status: "added" },
        { path: "src/fail2.ts", status: "added" },
      ];
      const options: UpdateOptions = { ...baseOptions, localPath: testDir };

      const result = await pipeline.processChanges(changes, options);

      // All files failed
      expect(result.errors).toHaveLength(2);
      expect(result.stats.filesAdded).toBe(0);

      // But duration should still be tracked
      expect(result.stats.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("should handle embedding provider failure gracefully", async () => {
      // Create a file that will be processed
      await mkdir(join(testDir, "src"), { recursive: true });
      await writeFile(join(testDir, "src/test.ts"), "export const x = 1;");

      // Make embedding provider throw an error
      mockEmbeddingProvider.generateEmbeddings = mock(async () => {
        throw new Error("OpenAI API rate limit exceeded");
      });

      const changes: FileChange[] = [{ path: "src/test.ts", status: "added" }];
      const options: UpdateOptions = { ...baseOptions, localPath: testDir };

      const result = await pipeline.processChanges(changes, options);

      // File was "added" in stats but embedding failed
      expect(result.stats.filesAdded).toBe(1);
      // Error should be captured
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.path).toBe("(batch embedding/storage)");
      expect(result.errors[0]?.error).toContain("rate limit");
    });
  });

  describe("graph integration", () => {
    let mockGraphService: {
      ingestFile: ReturnType<typeof mock>;
      deleteFileData: ReturnType<typeof mock>;
    };
    let pipelineWithGraph: IncrementalUpdatePipeline;

    const baseOptions: UpdateOptions = {
      repository: "test-repo",
      localPath: "",
      collectionName: "test_collection",
      includeExtensions: [".ts", ".js", ".md"],
      excludePatterns: ["node_modules/**", "dist/**"],
    };

    beforeEach(() => {
      // Create mock graph ingestion service
      mockGraphService = {
        ingestFile: mock(async () => ({
          filePath: "test.ts",
          success: true,
          nodesCreated: 5,
          relationshipsCreated: 8,
          errors: [],
        })),
        deleteFileData: mock(async () => ({
          nodesDeleted: 3,
          relationshipsDeleted: 4,
          success: true,
        })),
      };

      // Create pipeline with graph service
      pipelineWithGraph = new IncrementalUpdatePipeline(
        fileChunker,
        mockEmbeddingProvider,
        mockStorageClient,
        logger,
        mockGraphService as unknown as GraphIngestionService
      );
    });

    it("should call ingestFile for added TypeScript files", async () => {
      // Create test file
      const testFile = "src/test.ts";
      const testFilePath = join(testDir, testFile);
      await mkdir(join(testDir, "src"), { recursive: true });
      await writeFile(testFilePath, "export function hello() { return 'hello'; }");

      const changes: FileChange[] = [{ path: testFile, status: "added" }];
      const options: UpdateOptions = { ...baseOptions, localPath: testDir };

      const result = await pipelineWithGraph.processChanges(changes, options);

      expect(result.stats.filesAdded).toBe(1);
      expect(mockGraphService.ingestFile).toHaveBeenCalledTimes(1);
      expect(result.stats.graph).toBeDefined();
      expect(result.stats.graph?.graphNodesCreated).toBe(5);
      expect(result.stats.graph?.graphRelationshipsCreated).toBe(8);
      expect(result.stats.graph?.graphFilesProcessed).toBe(1);
    });

    it("should call deleteFileData then ingestFile for modified files", async () => {
      // Create test file
      const testFile = "src/modified.ts";
      const testFilePath = join(testDir, testFile);
      await mkdir(join(testDir, "src"), { recursive: true });
      await writeFile(testFilePath, "export function updated() { return 'updated'; }");

      const changes: FileChange[] = [{ path: testFile, status: "modified" }];
      const options: UpdateOptions = { ...baseOptions, localPath: testDir };

      const result = await pipelineWithGraph.processChanges(changes, options);

      expect(result.stats.filesModified).toBe(1);
      // Should delete then ingest
      expect(mockGraphService.deleteFileData).toHaveBeenCalledTimes(1);
      expect(mockGraphService.ingestFile).toHaveBeenCalledTimes(1);
      expect(result.stats.graph?.graphNodesDeleted).toBe(3);
      expect(result.stats.graph?.graphNodesCreated).toBe(5);
    });

    it("should call deleteFileData for deleted files", async () => {
      const changes: FileChange[] = [{ path: "src/deleted.ts", status: "deleted" }];
      const options: UpdateOptions = { ...baseOptions, localPath: testDir };

      const result = await pipelineWithGraph.processChanges(changes, options);

      expect(result.stats.filesDeleted).toBe(1);
      expect(mockGraphService.deleteFileData).toHaveBeenCalledTimes(1);
      expect(mockGraphService.ingestFile).not.toHaveBeenCalled();
      expect(result.stats.graph?.graphNodesDeleted).toBe(3);
      expect(result.stats.graph?.graphRelationshipsDeleted).toBe(4);
    });

    it("should call deleteFileData for old path and ingestFile for new path on rename", async () => {
      // Create test file at new location
      const newPath = "src/renamed-new.ts";
      const oldPath = "src/renamed-old.ts";
      const testFilePath = join(testDir, newPath);
      await mkdir(join(testDir, "src"), { recursive: true });
      await writeFile(testFilePath, "export function renamed() { return 'renamed'; }");

      const changes: FileChange[] = [{ path: newPath, status: "renamed", previousPath: oldPath }];
      const options: UpdateOptions = { ...baseOptions, localPath: testDir };

      const result = await pipelineWithGraph.processChanges(changes, options);

      expect(result.stats.filesModified).toBe(1);
      // Should delete old path then ingest new path
      expect(mockGraphService.deleteFileData).toHaveBeenCalledTimes(1);
      expect(mockGraphService.deleteFileData).toHaveBeenCalledWith("test-repo", oldPath);
      expect(mockGraphService.ingestFile).toHaveBeenCalledTimes(1);
    });

    it("should skip non-TypeScript files for graph processing", async () => {
      // Create markdown file (not supported for entity extraction)
      const testFile = "docs/README.md";
      const testFilePath = join(testDir, testFile);
      await mkdir(join(testDir, "docs"), { recursive: true });
      await writeFile(testFilePath, "# README\n\nThis is documentation.");

      const changes: FileChange[] = [{ path: testFile, status: "added" }];
      const options: UpdateOptions = { ...baseOptions, localPath: testDir };

      const result = await pipelineWithGraph.processChanges(changes, options);

      expect(result.stats.filesAdded).toBe(1);
      // Markdown files should be skipped for graph (not supported)
      expect(mockGraphService.ingestFile).not.toHaveBeenCalled();
      expect(result.stats.graph?.graphFilesSkipped).toBe(1);
      expect(result.stats.graph?.graphFilesProcessed).toBe(0);
    });

    it("should continue processing if graph update fails", async () => {
      // Create test file
      const testFile = "src/test.ts";
      const testFilePath = join(testDir, testFile);
      await mkdir(join(testDir, "src"), { recursive: true });
      await writeFile(testFilePath, "export function hello() { return 'hello'; }");

      // Make graph service throw an error
      mockGraphService.ingestFile = mock(async () => {
        throw new Error("Neo4j connection failed");
      });

      const changes: FileChange[] = [{ path: testFile, status: "added" }];
      const options: UpdateOptions = { ...baseOptions, localPath: testDir };

      const result = await pipelineWithGraph.processChanges(changes, options);

      // ChromaDB processing should still succeed
      expect(result.stats.filesAdded).toBe(1);
      expect(result.stats.chunksUpserted).toBeGreaterThan(0);

      // Graph error should be recorded but not block processing
      expect(result.stats.graph?.graphErrors).toHaveLength(1);
      expect(result.stats.graph?.graphErrors[0]?.path).toBe(testFile);
      expect(result.stats.graph?.graphErrors[0]?.error).toContain("Neo4j connection failed");
      expect(result.stats.graph?.graphErrors[0]?.operation).toBe("ingest");
    });

    it("should work normally without graph service (backward compatibility)", async () => {
      // Create test file
      const testFile = "src/test.ts";
      const testFilePath = join(testDir, testFile);
      await mkdir(join(testDir, "src"), { recursive: true });
      await writeFile(testFilePath, "export function hello() { return 'hello'; }");

      // Use original pipeline without graph service
      const changes: FileChange[] = [{ path: testFile, status: "added" }];
      const options: UpdateOptions = { ...baseOptions, localPath: testDir };

      const result = await pipeline.processChanges(changes, options);

      expect(result.stats.filesAdded).toBe(1);
      expect(result.stats.chunksUpserted).toBeGreaterThan(0);
      // No graph stats should be present
      expect(result.stats.graph).toBeUndefined();
    });

    it("should record graph errors without blocking ChromaDB updates", async () => {
      // Create test file
      const testFile = "src/test.ts";
      const testFilePath = join(testDir, testFile);
      await mkdir(join(testDir, "src"), { recursive: true });
      await writeFile(testFilePath, "export function hello() { return 'hello'; }");

      // Make ingestFile return failure (but not throw)
      mockGraphService.ingestFile = mock(async () => ({
        filePath: testFile,
        success: false,
        nodesCreated: 0,
        relationshipsCreated: 0,
        errors: [{ type: "file_error", message: "Parse error in file" }],
      }));

      const changes: FileChange[] = [{ path: testFile, status: "added" }];
      const options: UpdateOptions = { ...baseOptions, localPath: testDir };

      const result = await pipelineWithGraph.processChanges(changes, options);

      // ChromaDB processing should still succeed
      expect(result.stats.filesAdded).toBe(1);
      expect(result.stats.chunksUpserted).toBeGreaterThan(0);

      // Graph error should be recorded
      expect(result.stats.graph?.graphErrors).toHaveLength(1);
      expect(result.stats.graph?.graphErrors[0]?.operation).toBe("ingest");
    });

    it("should continue with ingest even if graph deletion fails for modified files", async () => {
      // Create test file
      const testFile = "src/modified.ts";
      const testFilePath = join(testDir, testFile);
      await mkdir(join(testDir, "src"), { recursive: true });
      await writeFile(testFilePath, "export function updated() { return 'updated'; }");

      // Make deleteFileData return failure (but not throw)
      mockGraphService.deleteFileData = mock(async () => ({
        nodesDeleted: 0,
        relationshipsDeleted: 0,
        success: false,
      }));

      const changes: FileChange[] = [{ path: testFile, status: "modified" }];
      const options: UpdateOptions = { ...baseOptions, localPath: testDir };

      const result = await pipelineWithGraph.processChanges(changes, options);

      // ChromaDB processing should still succeed
      expect(result.stats.filesModified).toBe(1);
      expect(result.stats.chunksUpserted).toBeGreaterThan(0);

      // Graph deletion error should be recorded
      expect(result.stats.graph?.graphErrors).toHaveLength(1);
      expect(result.stats.graph?.graphErrors[0]?.path).toBe(testFile);
      expect(result.stats.graph?.graphErrors[0]?.operation).toBe("delete");
      expect(result.stats.graph?.graphErrors[0]?.error).toContain("Graph deletion failed");

      // Ingest SHOULD still be called - better to have potentially duplicate
      // data than lose new data entirely. The delete and ingest are separate
      // operations in processModifiedFile, so delete failure doesn't prevent ingest.
      expect(mockGraphService.ingestFile).toHaveBeenCalledTimes(1);
    });
  });
});
