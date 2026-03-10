/**
 * Unit tests for FolderDocumentIndexingService
 *
 * Tests:
 * - DetectedChange → FileChange conversion
 * - Content hash check (match → skip, mismatch → process)
 * - Folder registration/unregistration
 * - Batch processor callback behavior
 * - Error handling (unregistered folder, file read errors)
 * - Queue integration (enqueue, shutdown)
 * - Metrics/status reporting
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, mock } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createHash } from "node:crypto";
import { initializeLogger, resetLogger } from "../../../src/logging/index.js";
import { FolderDocumentIndexingService } from "../../../src/services/folder-document-indexing-service.js";
import {
  FolderNotRegisteredError,
  ContentHashCheckError,
} from "../../../src/services/folder-document-indexing-errors.js";
import { DEFAULT_FOLDER_INDEXING_CONFIG } from "../../../src/services/folder-document-indexing-types.js";
import type { DetectedChange } from "../../../src/services/change-detection-types.js";
import type { WatchedFolder } from "../../../src/services/folder-watcher-types.js";
import type { UpdateResult } from "../../../src/services/incremental-update-types.js";
import type { ChromaStorageClient } from "../../../src/storage/types.js";
import type { IncrementalUpdatePipeline } from "../../../src/services/incremental-update-pipeline.js";

// =============================================================================
// Test Setup
// =============================================================================

beforeAll(() => {
  initializeLogger({ level: "silent", format: "json" });
});

afterAll(() => {
  resetLogger();
});

// =============================================================================
// Test Helpers
// =============================================================================

function createTestFolder(overrides: Partial<WatchedFolder> = {}): WatchedFolder {
  return {
    id: "test-folder-1",
    path: path.join(os.tmpdir(), "test-folder-indexing-" + Date.now()),
    name: "Test Folder",
    enabled: true,
    includePatterns: null,
    excludePatterns: null,
    debounceMs: 100,
    createdAt: new Date(),
    lastScanAt: null,
    fileCount: 0,
    updatedAt: null,
    ...overrides,
  };
}

function createTestChange(overrides: Partial<DetectedChange> = {}): DetectedChange {
  return {
    category: "modified",
    absolutePath: `/test/path/${overrides.relativePath ?? "file.md"}`,
    relativePath: overrides.relativePath ?? "file.md",
    extension: "md",
    folderId: "test-folder-1",
    folderPath: "/test/path",
    timestamp: new Date(),
    currentState: {
      absolutePath: `/test/path/${overrides.relativePath ?? "file.md"}`,
      relativePath: overrides.relativePath ?? "file.md",
      sizeBytes: 1024,
      modifiedAt: new Date(),
      extension: "md",
      capturedAt: new Date(),
    },
    ...overrides,
  };
}

function createMockPipeline(): IncrementalUpdatePipeline {
  const successResult: UpdateResult = {
    stats: {
      filesAdded: 1,
      filesModified: 0,
      filesDeleted: 0,
      chunksUpserted: 3,
      chunksDeleted: 0,
      durationMs: 100,
    },
    errors: [],
    filterStats: {
      totalChanges: 1,
      eligibleChanges: 1,
      filteredChanges: 1,
      skippedChanges: 0,
    },
  };

  return {
    processChanges: mock(() => Promise.resolve(successResult)),
  } as unknown as IncrementalUpdatePipeline;
}

function createMockStorageClient(): ChromaStorageClient {
  return {
    getDocumentsByMetadata: mock(() => Promise.resolve([])),
    deleteDocumentsByFilePrefix: mock(() => Promise.resolve(0)),
    upsertDocuments: mock(() => Promise.resolve()),
    healthCheck: mock(() => Promise.resolve(true)),
  } as unknown as ChromaStorageClient;
}

// =============================================================================
// Tests
// =============================================================================

describe("FolderDocumentIndexingService", () => {
  let service: FolderDocumentIndexingService;
  let mockPipeline: IncrementalUpdatePipeline;
  let mockStorage: ChromaStorageClient;
  let testDir: string;

  beforeEach(async () => {
    mockPipeline = createMockPipeline();
    mockStorage = createMockStorageClient();
    testDir = path.join(os.tmpdir(), `folder-indexing-test-${Date.now()}`);
    await fs.promises.mkdir(testDir, { recursive: true });

    service = new FolderDocumentIndexingService(mockPipeline, mockStorage, {
      queueConfig: {
        batchDelayMs: 100,
        maxBatchWaitMs: 500,
        retryDelayMs: 100,
        shutdownTimeoutMs: 2000,
      },
    });
  });

  afterEach(async () => {
    try {
      await service.shutdown();
    } catch {
      // Queue may already be stopped
    }
    await fs.promises.rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  // ===========================================================================
  // Folder Registration
  // ===========================================================================

  describe("registerFolder", () => {
    it("should register a folder with correct context mapping", () => {
      const folder = createTestFolder({ id: "abc-123", path: testDir });
      service.registerFolder(folder);

      const context = service.getFolderContext("abc-123");
      expect(context).toBeDefined();
      expect(context?.folderId).toBe("abc-123");
      expect(context?.folderPath).toBe(testDir);
      expect(context?.repositoryName).toBe("folder-abc-123");
      expect(context?.collectionName).toBe("folder_abc-123");
    });

    it("should use default include extensions when folder has no patterns", () => {
      const folder = createTestFolder({ includePatterns: null });
      service.registerFolder(folder);

      const context = service.getFolderContext(folder.id);
      expect(context?.includeExtensions).toEqual(
        DEFAULT_FOLDER_INDEXING_CONFIG.defaultIncludeExtensions
      );
    });

    it("should convert glob patterns to extensions", () => {
      const folder = createTestFolder({
        includePatterns: ["*.md", "*.txt", "*.pdf"],
      });
      service.registerFolder(folder);

      const context = service.getFolderContext(folder.id);
      expect(context?.includeExtensions).toEqual([".md", ".txt", ".pdf"]);
    });

    it("should convert recursive glob patterns like **/*.md to extensions", () => {
      const folder = createTestFolder({
        includePatterns: ["**/*.md", "**/*.txt", "*.pdf"],
      });
      service.registerFolder(folder);

      const context = service.getFolderContext(folder.id);
      expect(context?.includeExtensions).toEqual([".md", ".txt", ".pdf"]);
    });

    it("should fall back to defaults when patterns cannot be parsed", () => {
      const folder = createTestFolder({
        includePatterns: ["docs/readme", "no-extension"],
      });
      service.registerFolder(folder);

      const context = service.getFolderContext(folder.id);
      expect(context?.includeExtensions).toEqual(
        DEFAULT_FOLDER_INDEXING_CONFIG.defaultIncludeExtensions
      );
    });

    it("should use default exclude patterns when folder has none", () => {
      const folder = createTestFolder({ excludePatterns: null });
      service.registerFolder(folder);

      const context = service.getFolderContext(folder.id);
      expect(context?.excludePatterns).toEqual(
        DEFAULT_FOLDER_INDEXING_CONFIG.defaultExcludePatterns
      );
    });

    it("should use folder-specific exclude patterns when provided", () => {
      const folder = createTestFolder({
        excludePatterns: ["custom/**", "temp/**"],
      });
      service.registerFolder(folder);

      const context = service.getFolderContext(folder.id);
      expect(context?.excludePatterns).toEqual(["custom/**", "temp/**"]);
    });
  });

  describe("unregisterFolder", () => {
    it("should remove a registered folder", () => {
      const folder = createTestFolder();
      service.registerFolder(folder);
      expect(service.getFolderContext(folder.id)).toBeDefined();

      service.unregisterFolder(folder.id);
      expect(service.getFolderContext(folder.id)).toBeUndefined();
    });

    it("should not throw when unregistering unknown folder", () => {
      expect(() => service.unregisterFolder("nonexistent")).not.toThrow();
    });
  });

  describe("getRegisteredFolders", () => {
    it("should return all registered folders", () => {
      const folder1 = createTestFolder({ id: "f1" });
      const folder2 = createTestFolder({ id: "f2" });
      service.registerFolder(folder1);
      service.registerFolder(folder2);

      const registered = service.getRegisteredFolders();
      expect(registered.size).toBe(2);
      expect(registered.has("f1")).toBe(true);
      expect(registered.has("f2")).toBe(true);
    });
  });

  // ===========================================================================
  // Change Conversion
  // ===========================================================================

  describe("convertChange", () => {
    it("should convert added change correctly", () => {
      const change = createTestChange({
        category: "added",
        relativePath: "docs/new-file.md",
      });

      const fileChange = service.convertChange(change);
      expect(fileChange.path).toBe("docs/new-file.md");
      expect(fileChange.status).toBe("added");
      expect(fileChange.previousPath).toBeUndefined();
    });

    it("should convert modified change correctly", () => {
      const change = createTestChange({
        category: "modified",
        relativePath: "docs/changed.md",
      });

      const fileChange = service.convertChange(change);
      expect(fileChange.path).toBe("docs/changed.md");
      expect(fileChange.status).toBe("modified");
    });

    it("should convert deleted change correctly", () => {
      const change = createTestChange({
        category: "deleted",
        relativePath: "docs/removed.md",
        currentState: null,
      });

      const fileChange = service.convertChange(change);
      expect(fileChange.path).toBe("docs/removed.md");
      expect(fileChange.status).toBe("deleted");
    });

    it("should convert renamed change with previousPath", () => {
      const change = createTestChange({
        category: "renamed",
        relativePath: "docs/new-name.md",
        previousRelativePath: "docs/old-name.md",
      });

      const fileChange = service.convertChange(change);
      expect(fileChange.path).toBe("docs/new-name.md");
      expect(fileChange.status).toBe("renamed");
      expect(fileChange.previousPath).toBe("docs/old-name.md");
    });
  });

  describe("convertChanges", () => {
    it("should convert multiple changes", () => {
      const changes = [
        createTestChange({ category: "added", relativePath: "a.md" }),
        createTestChange({ category: "deleted", relativePath: "b.md", currentState: null }),
      ];

      const fileChanges = service.convertChanges(changes);
      expect(fileChanges).toHaveLength(2);
      expect(fileChanges[0]?.status).toBe("added");
      expect(fileChanges[1]?.status).toBe("deleted");
    });
  });

  // ===========================================================================
  // Content Hash Check
  // ===========================================================================

  describe("checkContentHash", () => {
    it("should return unchanged=true when hashes match", async () => {
      const content = "Hello, world!";
      const expectedHash = createHash("sha256").update(content).digest("hex");

      // Write test file
      const filePath = path.join(testDir, "test.md");
      await fs.promises.writeFile(filePath, content);

      // Mock storage to return matching hash
      (mockStorage.getDocumentsByMetadata as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve([
          {
            id: "test:test.md:0",
            content: "chunk content",
            metadata: { content_hash: expectedHash, file_path: "test.md", repository: "test-repo" },
          },
        ])
      );

      const result = await service.checkContentHash(
        filePath,
        "test-repo",
        "test_collection",
        "test.md"
      );

      expect(result.unchanged).toBe(true);
      expect(result.computedHash).toBe(expectedHash);
      expect(result.storedHash).toBe(expectedHash);
    });

    it("should return unchanged=false when hashes differ", async () => {
      const content = "Updated content";
      const oldHash = createHash("sha256").update("Old content").digest("hex");

      const filePath = path.join(testDir, "test.md");
      await fs.promises.writeFile(filePath, content);

      (mockStorage.getDocumentsByMetadata as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve([
          {
            id: "test:test.md:0",
            content: "chunk content",
            metadata: { content_hash: oldHash, file_path: "test.md", repository: "test-repo" },
          },
        ])
      );

      const result = await service.checkContentHash(
        filePath,
        "test-repo",
        "test_collection",
        "test.md"
      );

      expect(result.unchanged).toBe(false);
      expect(result.storedHash).toBe(oldHash);
      expect(result.computedHash).not.toBe(oldHash);
    });

    it("should return unchanged=false when no stored chunks exist", async () => {
      const filePath = path.join(testDir, "new-file.md");
      await fs.promises.writeFile(filePath, "New content");

      (mockStorage.getDocumentsByMetadata as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve([])
      );

      const result = await service.checkContentHash(
        filePath,
        "test-repo",
        "test_collection",
        "new-file.md"
      );

      expect(result.unchanged).toBe(false);
      expect(result.storedHash).toBeNull();
    });

    it("should handle storage query failure gracefully (unchanged=false)", async () => {
      const filePath = path.join(testDir, "test.md");
      await fs.promises.writeFile(filePath, "Some content");

      (mockStorage.getDocumentsByMetadata as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.reject(new Error("Collection not found"))
      );

      const result = await service.checkContentHash(
        filePath,
        "test-repo",
        "test_collection",
        "test.md"
      );

      // When storage fails, storedHash is null → unchanged is false
      expect(result.unchanged).toBe(false);
      expect(result.storedHash).toBeNull();
    });

    it("should throw ContentHashCheckError when file read fails", async () => {
      const filePath = path.join(testDir, "nonexistent.md");

      try {
        await service.checkContentHash(filePath, "test-repo", "test_collection", "nonexistent.md");
        // Should not reach here
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(ContentHashCheckError);
      }
    });

    it("should compute hash using binary-safe approach for non-text files", async () => {
      // Write binary-like content to verify raw byte hashing
      const binaryContent = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const expectedHash = createHash("sha256").update(binaryContent).digest("hex");

      const filePath = path.join(testDir, "binary-file.png");
      await fs.promises.writeFile(filePath, binaryContent);

      (mockStorage.getDocumentsByMetadata as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve([])
      );

      const result = await service.checkContentHash(
        filePath,
        "test-repo",
        "test_collection",
        "binary-file.png"
      );

      expect(result.computedHash).toBe(expectedHash);
      expect(result.unchanged).toBe(false);
    });
  });

  // ===========================================================================
  // Change Handling
  // ===========================================================================

  describe("handleDetectedChange", () => {
    it("should throw FolderNotRegisteredError for unregistered folder", () => {
      const change = createTestChange({ folderId: "unknown-folder" });
      expect(() => service.handleDetectedChange(change)).toThrow(FolderNotRegisteredError);
    });

    it("should enqueue change for registered folder", () => {
      const folder = createTestFolder();
      service.registerFolder(folder);

      const change = createTestChange({ folderId: folder.id });
      expect(() => service.handleDetectedChange(change)).not.toThrow();

      const status = service.getQueue().getStatus();
      expect(status.queueDepth).toBe(1);
    });

    it("should enqueue multiple changes", () => {
      const folder = createTestFolder();
      service.registerFolder(folder);

      for (let i = 0; i < 5; i++) {
        service.handleDetectedChange(
          createTestChange({
            folderId: folder.id,
            relativePath: `file-${i}.md`,
          })
        );
      }

      const status = service.getQueue().getStatus();
      expect(status.queueDepth).toBe(5);
    });
  });

  // ===========================================================================
  // Batch Processing
  // ===========================================================================

  describe("batch processing", () => {
    it("should process enqueued changes through the pipeline", async () => {
      const folder = createTestFolder({ path: testDir });
      service.registerFolder(folder);

      // Create a real file for the added change
      const filePath = path.join(testDir, "new-file.md");
      await fs.promises.writeFile(filePath, "New file content");

      const change = createTestChange({
        category: "added",
        folderId: folder.id,
        absolutePath: filePath,
        relativePath: "new-file.md",
      });

      service.handleDetectedChange(change);

      // Wait for batch processing
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(
        (mockPipeline.processChanges as ReturnType<typeof mock>).mock.calls.length
      ).toBeGreaterThanOrEqual(1);
    });

    it("should skip unchanged modified files via content hash", async () => {
      const folder = createTestFolder({ path: testDir });
      service.registerFolder(folder);

      // Create test file
      const content = "Unchanged content";
      const contentHash = createHash("sha256").update(content).digest("hex");
      const filePath = path.join(testDir, "unchanged.md");
      await fs.promises.writeFile(filePath, content);

      // Mock storage to return matching hash
      (mockStorage.getDocumentsByMetadata as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve([
          {
            id: "folder-test-folder-1:unchanged.md:0",
            content: "chunk",
            metadata: {
              content_hash: contentHash,
              file_path: "unchanged.md",
              repository: `folder-${folder.id}`,
            },
          },
        ])
      );

      const change = createTestChange({
        category: "modified",
        folderId: folder.id,
        absolutePath: filePath,
        relativePath: "unchanged.md",
      });

      service.handleDetectedChange(change);

      // Wait for batch processing
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Pipeline should not be called (change was skipped)
      expect((mockPipeline.processChanges as ReturnType<typeof mock>).mock.calls.length).toBe(0);

      // Skipped count should be incremented
      expect(service.getTotalSkippedUnchanged()).toBe(1);
    });

    it("should process modified files when content hash differs", async () => {
      const folder = createTestFolder({ path: testDir });
      service.registerFolder(folder);

      const filePath = path.join(testDir, "changed.md");
      await fs.promises.writeFile(filePath, "New content");

      (mockStorage.getDocumentsByMetadata as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve([
          {
            id: "test:changed.md:0",
            content: "chunk",
            metadata: {
              content_hash: "old-hash-different",
              file_path: "changed.md",
              repository: `folder-${folder.id}`,
            },
          },
        ])
      );

      const change = createTestChange({
        category: "modified",
        folderId: folder.id,
        absolutePath: filePath,
        relativePath: "changed.md",
      });

      service.handleDetectedChange(change);
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(
        (mockPipeline.processChanges as ReturnType<typeof mock>).mock.calls.length
      ).toBeGreaterThanOrEqual(1);
    });

    it("should group changes by folderId", async () => {
      const folder1 = createTestFolder({ id: "f1", path: testDir });
      const folder2 = createTestFolder({ id: "f2", path: testDir });
      service.registerFolder(folder1);
      service.registerFolder(folder2);

      // Create files
      await fs.promises.writeFile(path.join(testDir, "file1.md"), "Content 1");
      await fs.promises.writeFile(path.join(testDir, "file2.md"), "Content 2");

      service.handleDetectedChange(
        createTestChange({
          category: "added",
          folderId: "f1",
          absolutePath: path.join(testDir, "file1.md"),
          relativePath: "file1.md",
        })
      );
      service.handleDetectedChange(
        createTestChange({
          category: "added",
          folderId: "f2",
          absolutePath: path.join(testDir, "file2.md"),
          relativePath: "file2.md",
        })
      );

      await new Promise((resolve) => setTimeout(resolve, 300));

      // Pipeline should be called twice (once per folder)
      expect((mockPipeline.processChanges as ReturnType<typeof mock>).mock.calls.length).toBe(2);
    });

    it("should handle pipeline errors gracefully", async () => {
      const folder = createTestFolder({ path: testDir });
      service.registerFolder(folder);

      (mockPipeline.processChanges as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve({
          stats: {
            filesAdded: 0,
            filesModified: 0,
            filesDeleted: 0,
            chunksUpserted: 0,
            chunksDeleted: 0,
            durationMs: 50,
          },
          errors: [{ path: "failing.md", error: "Extraction failed" }],
          filterStats: {
            totalChanges: 1,
            eligibleChanges: 1,
            filteredChanges: 1,
            skippedChanges: 0,
          },
        })
      );

      await fs.promises.writeFile(path.join(testDir, "failing.md"), "Content");

      service.handleDetectedChange(
        createTestChange({
          category: "added",
          folderId: folder.id,
          absolutePath: path.join(testDir, "failing.md"),
          relativePath: "failing.md",
        })
      );

      await new Promise((resolve) => setTimeout(resolve, 300));

      // Should have been called but produced errors (non-fatal)
      expect(
        (mockPipeline.processChanges as ReturnType<typeof mock>).mock.calls.length
      ).toBeGreaterThanOrEqual(1);
    });

    it("should handle unregistered folder during batch processing", async () => {
      const folder = createTestFolder();
      service.registerFolder(folder);

      service.handleDetectedChange(
        createTestChange({ folderId: folder.id, relativePath: "file.md" })
      );

      // Unregister before batch processes
      service.unregisterFolder(folder.id);

      await new Promise((resolve) => setTimeout(resolve, 300));

      // Pipeline should NOT be called (folder was unregistered)
      expect((mockPipeline.processChanges as ReturnType<typeof mock>).mock.calls.length).toBe(0);
    });
  });

  // ===========================================================================
  // Queue Integration
  // ===========================================================================

  describe("queue integration", () => {
    it("should expose queue status", () => {
      const status = service.getQueue().getStatus();
      expect(status.state).toBe("idle");
      expect(status.queueDepth).toBe(0);
      expect(status.isProcessing).toBe(false);
    });

    it("should expose queue metrics", () => {
      const metrics = service.getQueue().getMetrics();
      expect(metrics.totalEnqueued).toBe(0);
      expect(metrics.totalProcessed).toBe(0);
      expect(metrics.totalErrors).toBe(0);
    });

    it("should shut down gracefully", async () => {
      const folder = createTestFolder();
      service.registerFolder(folder);

      // Enqueue some changes
      for (let i = 0; i < 3; i++) {
        service.handleDetectedChange(
          createTestChange({ folderId: folder.id, relativePath: `file${i}.md` })
        );
      }

      await service.shutdown();
      const status = service.getQueue().getStatus();
      expect(status.state).toBe("stopped");
    });
  });

  // ===========================================================================
  // Error Classes
  // ===========================================================================

  describe("error classes", () => {
    it("FolderNotRegisteredError should have correct properties", () => {
      const error = new FolderNotRegisteredError("test-id");
      expect(error.name).toBe("FolderNotRegisteredError");
      expect(error.folderId).toBe("test-id");
      expect(error.retryable).toBe(false);
      expect(error.message).toContain("test-id");
    });

    it("ContentHashCheckError should have correct properties", () => {
      const cause = new Error("ENOENT");
      const error = new ContentHashCheckError("test.md", "File not found", true, cause);
      expect(error.name).toBe("ContentHashCheckError");
      expect(error.filePath).toBe("test.md");
      expect(error.retryable).toBe(true);
      expect(error.cause).toBe(cause);
      expect(error.message).toContain("test.md");
    });
  });

  // ===========================================================================
  // Default Configuration
  // ===========================================================================

  describe("default configuration", () => {
    it("should use sensible default include extensions", () => {
      expect(DEFAULT_FOLDER_INDEXING_CONFIG.defaultIncludeExtensions).toContain(".md");
      expect(DEFAULT_FOLDER_INDEXING_CONFIG.defaultIncludeExtensions).toContain(".txt");
      expect(DEFAULT_FOLDER_INDEXING_CONFIG.defaultIncludeExtensions).toContain(".pdf");
      expect(DEFAULT_FOLDER_INDEXING_CONFIG.defaultIncludeExtensions).toContain(".docx");
    });

    it("should have default exclude patterns", () => {
      expect(DEFAULT_FOLDER_INDEXING_CONFIG.defaultExcludePatterns).toContain("node_modules/**");
      expect(DEFAULT_FOLDER_INDEXING_CONFIG.defaultExcludePatterns).toContain(".git/**");
    });
  });
});
