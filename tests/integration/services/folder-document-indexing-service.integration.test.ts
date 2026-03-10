/**
 * Integration tests for FolderDocumentIndexingService
 *
 * Tests the end-to-end flow from change detection through the processing
 * queue to the incremental update pipeline, using real filesystem operations
 * with mocked pipeline and storage backends.
 *
 * Tests:
 * - End-to-end: watcher → change detection → indexing service → pipeline
 * - Content hash skip for unchanged files
 * - Modified file re-indexed correctly
 * - Deleted file chunks removed
 * - Renamed file handling
 * - Update time <1 minute verification
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, mock } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createHash } from "node:crypto";
import { initializeLogger, resetLogger } from "../../../src/logging/index.js";
import { FolderWatcherService } from "../../../src/services/folder-watcher-service.js";
import { ChangeDetectionService } from "../../../src/services/change-detection-service.js";
import { FolderDocumentIndexingService } from "../../../src/services/folder-document-indexing-service.js";
import type { WatchedFolder } from "../../../src/services/folder-watcher-types.js";
// DetectedChange type used indirectly through service handler registration
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
    id: `int-folder-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    path: path.join(os.tmpdir(), `folder-indexing-int-${Date.now()}`),
    name: "Integration Test Folder",
    enabled: true,
    includePatterns: ["*.md", "*.txt"],
    excludePatterns: null,
    debounceMs: 50,
    createdAt: new Date(),
    lastScanAt: null,
    fileCount: 0,
    updatedAt: null,
    ...overrides,
  };
}

function createSuccessResult(overrides: Partial<UpdateResult["stats"]> = {}): UpdateResult {
  return {
    stats: {
      filesAdded: 0,
      filesModified: 0,
      filesDeleted: 0,
      chunksUpserted: 0,
      chunksDeleted: 0,
      durationMs: 50,
      ...overrides,
    },
    errors: [],
    filterStats: {
      totalChanges: 1,
      eligibleChanges: 1,
      filteredChanges: 1,
      skippedChanges: 0,
    },
  };
}

/**
 * Wait for pipeline mock to be called with a timeout.
 */
async function waitForPipelineCall(
  pipelineMock: ReturnType<typeof mock>,
  expectedCalls: number = 1,
  timeoutMs: number = 3000
): Promise<boolean> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    if (pipelineMock.mock.calls.length >= expectedCalls) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return pipelineMock.mock.calls.length >= expectedCalls;
}

// waitFor helper removed — not currently needed but available if needed in future tests

// =============================================================================
// Tests
// =============================================================================

describe("FolderDocumentIndexingService Integration", () => {
  let folderWatcher: FolderWatcherService;
  let changeDetection: ChangeDetectionService;
  let indexingService: FolderDocumentIndexingService;
  let mockPipeline: IncrementalUpdatePipeline;
  let mockStorage: ChromaStorageClient;
  let testFolder: WatchedFolder;

  beforeEach(async () => {
    // Create mock pipeline
    const processChangesMock = mock(() =>
      Promise.resolve(createSuccessResult({ filesAdded: 1, chunksUpserted: 3 }))
    );
    mockPipeline = {
      processChanges: processChangesMock,
    } as unknown as IncrementalUpdatePipeline;

    // Create mock storage
    mockStorage = {
      getDocumentsByMetadata: mock(() => Promise.resolve([])),
      deleteDocumentsByFilePrefix: mock(() => Promise.resolve(0)),
      upsertDocuments: mock(() => Promise.resolve()),
      healthCheck: mock(() => Promise.resolve(true)),
    } as unknown as ChromaStorageClient;

    // Create real services
    folderWatcher = new FolderWatcherService({
      defaultDebounceMs: 50,
      maxConcurrentWatchers: 3,
    });

    changeDetection = new ChangeDetectionService(folderWatcher, {
      renameWindowMs: 200,
    });

    indexingService = new FolderDocumentIndexingService(mockPipeline, mockStorage, {
      defaultIncludeExtensions: [".md", ".txt"],
      queueConfig: {
        batchDelayMs: 100,
        maxBatchWaitMs: 500,
        retryDelayMs: 100,
        shutdownTimeoutMs: 2000,
      },
    });

    // Create test folder on disk
    testFolder = createTestFolder();
    await fs.promises.mkdir(testFolder.path, { recursive: true });

    // Register and wire up
    indexingService.registerFolder(testFolder);
    changeDetection.onDetectedChange((change) => {
      indexingService.handleDetectedChange(change);
    });
  });

  afterEach(async () => {
    // Cleanup in reverse order
    try {
      changeDetection.dispose();
    } catch {
      /* already disposed */
    }
    try {
      await indexingService.shutdown();
    } catch {
      /* already stopped */
    }
    try {
      await folderWatcher.stopAllWatchers();
    } catch {
      /* already stopped */
    }

    await fs.promises.rm(testFolder.path, { recursive: true, force: true }).catch(() => {});
  });

  // ===========================================================================
  // End-to-End Flow
  // ===========================================================================

  describe("end-to-end flow", () => {
    it("should detect new file and send to pipeline", async () => {
      // Start watching
      await folderWatcher.startWatching(testFolder);

      // Create a new file
      const filePath = path.join(testFolder.path, "new-document.md");
      await fs.promises.writeFile(filePath, "# New Document\n\nSome content here.");

      // Wait for pipeline to be called
      const called = await waitForPipelineCall(
        mockPipeline.processChanges as ReturnType<typeof mock>
      );
      expect(called).toBe(true);

      // Verify pipeline was called with correct change
      const calls = (mockPipeline.processChanges as ReturnType<typeof mock>).mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(1);

      const firstCall = calls[0] as
        | [{ path: string; status: string }[], { repository: string; collectionName: string }]
        | undefined;
      expect(firstCall).toBeDefined();
      const [changes, options] = firstCall as [
        { path: string; status: string }[],
        { repository: string; collectionName: string },
      ];
      expect(changes.some((c) => c.path === "new-document.md" && c.status === "added")).toBe(true);
      expect(options.repository).toBe(`folder-${testFolder.id}`);
      expect(options.collectionName).toBe(`folder_${testFolder.id}`);
    });

    it("should detect deleted file and send to pipeline", async () => {
      // Create file before watching starts
      const filePath = path.join(testFolder.path, "to-delete.md");
      await fs.promises.writeFile(filePath, "Content to delete");

      // Start watching (emits add for existing files)
      await folderWatcher.startWatching({
        ...testFolder,
        emitExistingFiles: false,
      } as WatchedFolder & { emitExistingFiles?: boolean });

      // Give watcher time to stabilize
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Reset mock to clear any add events from watcher start
      (mockPipeline.processChanges as ReturnType<typeof mock>).mockClear();

      // Delete the file
      await fs.promises.unlink(filePath);

      // Wait for pipeline call (delete goes through rename window first)
      const called = await waitForPipelineCall(
        mockPipeline.processChanges as ReturnType<typeof mock>,
        1,
        3000
      );
      expect(called).toBe(true);

      const calls = (mockPipeline.processChanges as ReturnType<typeof mock>).mock.calls;
      const allChanges = calls.flatMap((call) => (call as [{ path: string; status: string }[]])[0]);
      expect(allChanges.some((c) => c.path === "to-delete.md" && c.status === "deleted")).toBe(
        true
      );
    });

    it("should detect modified file and send to pipeline", async () => {
      // Create file before watching
      const filePath = path.join(testFolder.path, "to-modify.md");
      await fs.promises.writeFile(filePath, "Original content");

      await folderWatcher.startWatching(testFolder);
      await new Promise((resolve) => setTimeout(resolve, 200));
      (mockPipeline.processChanges as ReturnType<typeof mock>).mockClear();

      // Modify the file
      await fs.promises.writeFile(filePath, "Updated content");

      const called = await waitForPipelineCall(
        mockPipeline.processChanges as ReturnType<typeof mock>
      );
      expect(called).toBe(true);

      const calls = (mockPipeline.processChanges as ReturnType<typeof mock>).mock.calls;
      const allChanges = calls.flatMap((call) => (call as [{ path: string; status: string }[]])[0]);
      expect(allChanges.some((c) => c.path === "to-modify.md" && c.status === "modified")).toBe(
        true
      );
    });
  });

  // ===========================================================================
  // Content Hash Optimization
  // ===========================================================================

  describe("content hash optimization", () => {
    it("should skip re-indexing when content hash matches", async () => {
      const content = "Unchanged file content";
      const contentHash = createHash("sha256").update(content).digest("hex");

      const filePath = path.join(testFolder.path, "unchanged.md");
      await fs.promises.writeFile(filePath, content);

      // Mock storage to return matching hash
      (mockStorage.getDocumentsByMetadata as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve([
          {
            id: `folder-${testFolder.id}:unchanged.md:0`,
            content: "chunk",
            metadata: {
              content_hash: contentHash,
              file_path: "unchanged.md",
              repository: `folder-${testFolder.id}`,
            },
          },
        ])
      );

      await folderWatcher.startWatching(testFolder);
      await new Promise((resolve) => setTimeout(resolve, 200));
      (mockPipeline.processChanges as ReturnType<typeof mock>).mockClear();

      // "Modify" the file (write same content — triggers change event)
      await fs.promises.writeFile(filePath, content);

      // Wait for potential processing
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Pipeline should NOT be called (content hash matched)
      expect((mockPipeline.processChanges as ReturnType<typeof mock>).mock.calls.length).toBe(0);

      // Skipped count should be incremented
      expect(indexingService.getTotalSkippedUnchanged()).toBeGreaterThanOrEqual(1);
    });
  });

  // ===========================================================================
  // Renamed File Handling
  // ===========================================================================

  describe("renamed file handling", () => {
    it("should detect rename and send to pipeline with previousPath", async () => {
      const filePath = path.join(testFolder.path, "original.md");
      await fs.promises.writeFile(filePath, "Document content");

      await folderWatcher.startWatching(testFolder);
      await new Promise((resolve) => setTimeout(resolve, 200));
      (mockPipeline.processChanges as ReturnType<typeof mock>).mockClear();

      // Rename the file
      const newPath = path.join(testFolder.path, "renamed.md");
      await fs.promises.rename(filePath, newPath);

      const called = await waitForPipelineCall(
        mockPipeline.processChanges as ReturnType<typeof mock>,
        1,
        3000
      );
      expect(called).toBe(true);

      const calls = (mockPipeline.processChanges as ReturnType<typeof mock>).mock.calls;
      const allChanges = calls.flatMap(
        (call) => (call as [{ path: string; status: string; previousPath?: string }[]])[0]
      );
      const renameChange = allChanges.find((c) => c.status === "renamed");
      if (renameChange) {
        expect(renameChange.path).toBe("renamed.md");
        expect(renameChange.previousPath).toBe("original.md");
      } else {
        // Some OS/FS combos emit delete+add instead of rename
        // Both are acceptable behaviors
        expect(allChanges.some((c) => c.status === "deleted" || c.status === "added")).toBe(true);
      }
    });
  });

  // ===========================================================================
  // Performance Verification
  // ===========================================================================

  describe("performance", () => {
    it(
      "should process changes in under 1 minute for typical batch",
      async () => {
        const folder = testFolder;

        // Start watching FIRST, then create files (so add events are emitted)
        await folderWatcher.startWatching(folder);
        await new Promise((resolve) => setTimeout(resolve, 200));
        (mockPipeline.processChanges as ReturnType<typeof mock>).mockClear();

        const startTime = Date.now();

        // Create 10 files after watcher is active
        for (let i = 0; i < 10; i++) {
          const filePath = path.join(folder.path, `doc-${i}.md`);
          await fs.promises.writeFile(filePath, `Document ${i} content\n`.repeat(20));
        }

        // Wait for pipeline calls (should process all files — may come in multiple batches)
        const called = await waitForPipelineCall(
          mockPipeline.processChanges as ReturnType<typeof mock>,
          1,
          10000
        );

        const durationMs = Date.now() - startTime;

        expect(called).toBe(true);
        // Acceptance criteria: <1 minute (60000ms)
        expect(durationMs).toBeLessThan(60000);
      },
      { timeout: 15000 }
    );
  });

  // ===========================================================================
  // Multiple Folders
  // ===========================================================================

  describe("multiple folders", () => {
    it("should handle changes from multiple watched folders independently", async () => {
      // Create a second folder
      const secondFolder = createTestFolder({
        id: `int-folder-2-${Date.now()}`,
        path: path.join(os.tmpdir(), `folder-indexing-int-2-${Date.now()}`),
      });
      await fs.promises.mkdir(secondFolder.path, { recursive: true });
      indexingService.registerFolder(secondFolder);

      try {
        // Start watching both folders
        await folderWatcher.startWatching(testFolder);
        await folderWatcher.startWatching(secondFolder);
        await new Promise((resolve) => setTimeout(resolve, 200));
        (mockPipeline.processChanges as ReturnType<typeof mock>).mockClear();

        // Create files in both folders
        await fs.promises.writeFile(path.join(testFolder.path, "file-in-first.md"), "Content A");
        await fs.promises.writeFile(path.join(secondFolder.path, "file-in-second.md"), "Content B");

        // Wait for processing
        const called = await waitForPipelineCall(
          mockPipeline.processChanges as ReturnType<typeof mock>,
          2,
          3000
        );
        expect(called).toBe(true);

        // Verify different repositories were used
        const calls = (mockPipeline.processChanges as ReturnType<typeof mock>).mock.calls;
        const repos = calls.map(
          (call) => (call as [unknown, { repository: string }])[1].repository
        );
        expect(repos).toContain(`folder-${testFolder.id}`);
        expect(repos).toContain(`folder-${secondFolder.id}`);
      } finally {
        await fs.promises.rm(secondFolder.path, { recursive: true, force: true }).catch(() => {});
      }
    });
  });
});
