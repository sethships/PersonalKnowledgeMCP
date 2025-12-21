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
    // Clean up test directory
    await rm(testDir, { recursive: true, force: true });

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
});
