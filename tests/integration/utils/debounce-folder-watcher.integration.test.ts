/**
 * Integration tests for debounce utility with FolderWatcherService types
 *
 * Verifies the debounce utility works correctly with FileEvent types
 * from the folder watcher, demonstrating batch processing of file events.
 */

import { describe, test, expect, mock } from "bun:test";
import {
  createDebouncedBatcher,
  DEFAULT_DEBOUNCE_CONFIG,
  MIN_DEBOUNCE_MS,
} from "../../../src/utils/index.js";
import type { FileEvent, FileEventType } from "../../../src/services/folder-watcher-types.js";

/**
 * Helper to wait for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a mock FileEvent for testing
 */
function createMockFileEvent(
  type: FileEventType,
  relativePath: string,
  folderId: string = "folder-1"
): FileEvent {
  return {
    type,
    absolutePath: `/watched/${folderId}/${relativePath}`,
    relativePath,
    extension: relativePath.split(".").pop() || "",
    folderId,
    folderPath: `/watched/${folderId}`,
    timestamp: new Date(),
  };
}

describe("Debounce utility with FileEvent types", () => {
  test("batches multiple file change events", async () => {
    const processedBatches: FileEvent[][] = [];
    const onExecute = mock(async (events: FileEvent[]) => {
      processedBatches.push([...events]);
    });

    const batcher = createDebouncedBatcher<FileEvent>({ delayMs: MIN_DEBOUNCE_MS }, { onExecute });

    // Simulate rapid file changes during editing
    batcher.push(createMockFileEvent("change", "src/index.ts"));
    batcher.push(createMockFileEvent("change", "src/utils.ts"));
    batcher.push(createMockFileEvent("add", "src/new-file.ts"));

    expect(batcher.pendingCount).toBe(3);

    // Wait for debounce to complete
    await sleep(150);

    expect(onExecute).toHaveBeenCalledTimes(1);
    expect(processedBatches[0]).toHaveLength(3);
    expect(processedBatches[0]![0]!.relativePath).toBe("src/index.ts");
    expect(processedBatches[0]![1]!.relativePath).toBe("src/utils.ts");
    expect(processedBatches[0]![2]!.relativePath).toBe("src/new-file.ts");
  });

  test("handles events from multiple folders", async () => {
    const processedBatches: FileEvent[][] = [];
    const onExecute = mock(async (events: FileEvent[]) => {
      processedBatches.push([...events]);
    });

    const batcher = createDebouncedBatcher<FileEvent>({ delayMs: MIN_DEBOUNCE_MS }, { onExecute });

    // Events from different folders
    batcher.push(createMockFileEvent("change", "file1.ts", "folder-1"));
    batcher.push(createMockFileEvent("change", "file2.ts", "folder-2"));
    batcher.push(createMockFileEvent("add", "file3.ts", "folder-1"));

    await sleep(150);

    expect(processedBatches[0]).toHaveLength(3);

    // Group by folder for processing
    const byFolder = new Map<string, FileEvent[]>();
    for (const event of processedBatches[0]!) {
      const existing = byFolder.get(event.folderId) || [];
      existing.push(event);
      byFolder.set(event.folderId, existing);
    }

    expect(byFolder.get("folder-1")).toHaveLength(2);
    expect(byFolder.get("folder-2")).toHaveLength(1);
  });

  test("flush processes pending events immediately for graceful shutdown", async () => {
    const processedBatches: FileEvent[][] = [];
    const onExecute = mock(async (events: FileEvent[]) => {
      processedBatches.push([...events]);
    });

    const batcher = createDebouncedBatcher<FileEvent>(
      { delayMs: 10000 }, // Long delay
      { onExecute }
    );

    batcher.push(createMockFileEvent("change", "important-file.ts"));
    batcher.push(createMockFileEvent("unlink", "deleted-file.ts"));

    // Simulate shutdown - flush immediately
    await batcher.flush();

    expect(onExecute).toHaveBeenCalledTimes(1);
    expect(processedBatches[0]).toHaveLength(2);
    expect(processedBatches[0]![1]!.type).toBe("unlink");
  });

  test("cancel discards pending events without processing", async () => {
    const onExecute = mock(async (_events: FileEvent[]) => {});

    const batcher = createDebouncedBatcher<FileEvent>({ delayMs: MIN_DEBOUNCE_MS }, { onExecute });

    batcher.push(createMockFileEvent("add", "temp-file.ts"));
    batcher.push(createMockFileEvent("change", "temp-file.ts"));

    // Cancel without processing
    batcher.cancel();

    await sleep(150);

    expect(onExecute).not.toHaveBeenCalled();
  });

  test("resets timer on continuous changes (active editing scenario)", async () => {
    const processedBatches: FileEvent[][] = [];
    const onExecute = mock(async (events: FileEvent[]) => {
      processedBatches.push([...events]);
    });

    const batcher = createDebouncedBatcher<FileEvent>({ delayMs: MIN_DEBOUNCE_MS }, { onExecute });

    // Simulate typing - events arrive faster than debounce period
    batcher.push(createMockFileEvent("change", "editing.ts"));
    await sleep(50);
    batcher.push(createMockFileEvent("change", "editing.ts"));
    await sleep(50);
    batcher.push(createMockFileEvent("change", "editing.ts"));

    // Should not have executed yet
    expect(onExecute).not.toHaveBeenCalled();

    // Wait for final debounce
    await sleep(150);

    expect(onExecute).toHaveBeenCalledTimes(1);
    // All events accumulated
    expect(processedBatches[0]).toHaveLength(3);
  });

  test("maxWaitMs forces processing during sustained activity", async () => {
    const processedBatches: FileEvent[][] = [];
    const onExecute = mock(async (events: FileEvent[]) => {
      processedBatches.push([...events]);
    });

    const batcher = createDebouncedBatcher<FileEvent>(
      { delayMs: 100, maxWaitMs: 200 },
      { onExecute }
    );

    // Continuous events that would keep resetting the debounce
    batcher.push(createMockFileEvent("change", "busy-file.ts"));
    await sleep(50);
    batcher.push(createMockFileEvent("change", "busy-file.ts"));
    await sleep(50);
    batcher.push(createMockFileEvent("change", "busy-file.ts"));
    await sleep(50);
    batcher.push(createMockFileEvent("change", "busy-file.ts"));
    await sleep(50);
    batcher.push(createMockFileEvent("change", "busy-file.ts"));

    // maxWaitMs should have forced execution by now
    await sleep(50);

    expect(onExecute).toHaveBeenCalled();
    expect(processedBatches[0]!.length).toBeGreaterThan(0);

    // Cleanup
    batcher.cancel();
  });

  test("works with DEFAULT_DEBOUNCE_CONFIG matching database defaults", () => {
    // Verify config matches watched_folders table default (2000ms)
    expect(DEFAULT_DEBOUNCE_CONFIG.delayMs).toBe(2000);
    expect(DEFAULT_DEBOUNCE_CONFIG.maxWaitMs).toBeUndefined();

    // Create batcher with defaults
    const batcher = createDebouncedBatcher<FileEvent>(DEFAULT_DEBOUNCE_CONFIG);

    batcher.push(createMockFileEvent("add", "test.ts"));
    expect(batcher.pendingCount).toBe(1);
    expect(batcher.isActive).toBe(true);

    batcher.cancel();
  });

  test("preserves event metadata through batching", async () => {
    const processedBatches: FileEvent[][] = [];
    const onExecute = mock(async (events: FileEvent[]) => {
      processedBatches.push([...events]);
    });

    const batcher = createDebouncedBatcher<FileEvent>({ delayMs: MIN_DEBOUNCE_MS }, { onExecute });

    const event1 = createMockFileEvent("add", "docs/readme.md", "docs-folder");
    const event2 = createMockFileEvent("change", "src/main.ts", "src-folder");

    batcher.push(event1);
    batcher.push(event2);

    await sleep(150);

    const batch = processedBatches[0]!;
    expect(batch[0]!.folderId).toBe("docs-folder");
    expect(batch[0]!.extension).toBe("md");
    expect(batch[0]!.folderPath).toBe("/watched/docs-folder");

    expect(batch[1]!.folderId).toBe("src-folder");
    expect(batch[1]!.extension).toBe("ts");
    expect(batch[1]!.type).toBe("change");
  });
});

describe("Debounce utility integration patterns", () => {
  test("per-folder batching pattern", async () => {
    // Pattern: Create separate batchers for each watched folder
    const folder1Events: FileEvent[][] = [];
    const folder2Events: FileEvent[][] = [];

    const folder1Batcher = createDebouncedBatcher<FileEvent>(
      { delayMs: MIN_DEBOUNCE_MS },
      {
        onExecute: async (events) => {
          folder1Events.push([...events]);
        },
      }
    );

    const folder2Batcher = createDebouncedBatcher<FileEvent>(
      { delayMs: MIN_DEBOUNCE_MS },
      {
        onExecute: async (events) => {
          folder2Events.push([...events]);
        },
      }
    );

    // Simulate events for different folders going to different batchers
    folder1Batcher.push(createMockFileEvent("change", "file1.ts", "folder-1"));
    folder2Batcher.push(createMockFileEvent("add", "file2.ts", "folder-2"));
    folder1Batcher.push(createMockFileEvent("change", "file3.ts", "folder-1"));

    await sleep(150);

    expect(folder1Events).toHaveLength(1);
    expect(folder1Events[0]).toHaveLength(2);

    expect(folder2Events).toHaveLength(1);
    expect(folder2Events[0]).toHaveLength(1);
  });

  test("event deduplication pattern", async () => {
    // Pattern: Use a Map to deduplicate events by path before batching
    const seenPaths = new Map<string, FileEvent>();
    const processedBatches: FileEvent[][] = [];

    const batcher = createDebouncedBatcher<FileEvent>(
      { delayMs: MIN_DEBOUNCE_MS },
      {
        onExecute: async (events) => {
          // Deduplicate by path, keeping latest event
          for (const event of events) {
            seenPaths.set(event.absolutePath, event);
          }
          processedBatches.push(Array.from(seenPaths.values()));
          seenPaths.clear();
        },
      }
    );

    // Multiple changes to same file
    batcher.push(createMockFileEvent("change", "hot-file.ts"));
    batcher.push(createMockFileEvent("change", "hot-file.ts"));
    batcher.push(createMockFileEvent("change", "hot-file.ts"));
    batcher.push(createMockFileEvent("add", "other-file.ts"));

    await sleep(150);

    // After deduplication, should have 2 unique files
    expect(processedBatches[0]).toHaveLength(2);
  });

  test("async handler with document ingestion simulation", async () => {
    const ingestedFiles: string[] = [];
    let processingTime = 0;

    const batcher = createDebouncedBatcher<FileEvent>(
      { delayMs: MIN_DEBOUNCE_MS },
      {
        onExecute: async (events) => {
          const start = Date.now();
          // Simulate async document ingestion
          for (const event of events) {
            await sleep(10); // Simulate processing time
            ingestedFiles.push(event.relativePath);
          }
          processingTime = Date.now() - start;
        },
      }
    );

    batcher.push(createMockFileEvent("add", "doc1.md"));
    batcher.push(createMockFileEvent("add", "doc2.md"));
    batcher.push(createMockFileEvent("add", "doc3.md"));

    await batcher.flush();

    expect(ingestedFiles).toEqual(["doc1.md", "doc2.md", "doc3.md"]);
    expect(processingTime).toBeGreaterThanOrEqual(30); // At least 3 * 10ms
  });
});
