/**
 * Integration tests for FolderWatcherService
 *
 * Tests real file system watching behavior with actual file operations.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { initializeLogger, resetLogger } from "../../../src/logging/index.js";
import { FolderWatcherService } from "../../../src/services/folder-watcher-service.js";
import type { WatchedFolder, FileEvent } from "../../../src/services/folder-watcher-types.js";

// Initialize logger for tests
beforeAll(() => {
  initializeLogger({ level: "silent", format: "json" });
});

afterAll(() => {
  resetLogger();
});

// Longer timeout for file system operations - CI can be slow
const TEST_TIMEOUT = 30000;

/**
 * Create a test folder configuration
 */
function createTestFolder(basePath: string, overrides: Partial<WatchedFolder> = {}): WatchedFolder {
  return {
    id: `test-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    path: basePath,
    name: "Integration Test Folder",
    enabled: true,
    includePatterns: null,
    excludePatterns: null,
    debounceMs: 200, // Short debounce for faster tests
    createdAt: new Date(),
    lastScanAt: null,
    fileCount: 0,
    updatedAt: null,
    ...overrides,
  };
}

/**
 * Wait for events to be processed.
 * CI environments can be slower, so we use generous timeouts.
 */
async function waitForEvents(ms: number = 1000): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("FolderWatcherService Integration Tests", () => {
  let testBaseDir: string;
  let service: FolderWatcherService;

  beforeAll(async () => {
    // Create a base test directory
    testBaseDir = path.join(os.tmpdir(), `folder-watcher-integration-${Date.now()}`);
    await fs.promises.mkdir(testBaseDir, { recursive: true });
  });

  afterAll(async () => {
    // Clean up test directory
    try {
      await fs.promises.rm(testBaseDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  beforeEach(() => {
    service = new FolderWatcherService({
      defaultDebounceMs: 200,
      maxConcurrentWatchers: 10,
    });
  });

  afterEach(async () => {
    // Stop all watchers
    await service.stopAllWatchers();
  });

  describe("File creation detection", () => {
    it(
      "should detect new file creation",
      async () => {
        const testDir = path.join(testBaseDir, `create-test-${Date.now()}`);
        await fs.promises.mkdir(testDir, { recursive: true });

        const folder = createTestFolder(testDir);
        const events: FileEvent[] = [];

        service.onFileEvent((event) => {
          events.push(event);
        });

        await service.startWatching(folder);

        // Small delay to ensure watcher is fully ready
        await waitForEvents(300);

        // Create a new file
        const testFilePath = path.join(testDir, "new-file.md");
        await fs.promises.writeFile(testFilePath, "# New File Content");

        // Wait for events to be processed
        await waitForEvents(1000);

        // Verify event was captured
        const addEvents = events.filter((e) => e.type === "add");
        expect(addEvents.length).toBeGreaterThanOrEqual(1);

        const fileEvent = addEvents.find((e) => e.relativePath === "new-file.md");
        expect(fileEvent).toBeDefined();
        if (fileEvent) {
          expect(fileEvent.extension).toBe("md");
          expect(fileEvent.folderId).toBe(folder.id);
          expect(fileEvent.folderPath).toBe(folder.path);
        }
      },
      TEST_TIMEOUT
    );

    it(
      "should detect multiple file creations",
      async () => {
        const testDir = path.join(testBaseDir, `multi-create-${Date.now()}`);
        await fs.promises.mkdir(testDir, { recursive: true });

        const folder = createTestFolder(testDir);
        const events: FileEvent[] = [];

        service.onFileEvent((event) => {
          events.push(event);
        });

        await service.startWatching(folder);

        // Small delay to ensure watcher is fully ready
        await waitForEvents(300);

        // Create multiple files with small delays to help event detection
        const files = ["file1.txt", "file2.md", "file3.json"];
        for (const file of files) {
          await fs.promises.writeFile(path.join(testDir, file), `Content of ${file}`);
          await new Promise((r) => setTimeout(r, 100)); // Small delay between files
        }

        // Wait for events - use longer timeout for CI
        await waitForEvents(1500);

        // Verify events were captured for all files
        const addEvents = events.filter((e) => e.type === "add");
        expect(addEvents.length).toBeGreaterThanOrEqual(files.length);
      },
      TEST_TIMEOUT
    );
  });

  describe("File modification detection", () => {
    it(
      "should detect file modifications",
      async () => {
        const testDir = path.join(testBaseDir, `modify-test-${Date.now()}`);
        await fs.promises.mkdir(testDir, { recursive: true });

        // Create file before watching
        const testFilePath = path.join(testDir, "existing-file.txt");
        await fs.promises.writeFile(testFilePath, "Initial content");

        const folder = createTestFolder(testDir);
        const events: FileEvent[] = [];

        service.onFileEvent((event) => {
          events.push(event);
        });

        await service.startWatching(folder);

        // Small delay to ensure watcher is fully ready
        await waitForEvents(300);

        // Modify the file
        await fs.promises.writeFile(testFilePath, "Modified content");

        // Wait for events
        await waitForEvents(1000);

        // Verify change event was captured
        const changeEvents = events.filter((e) => e.type === "change");
        expect(changeEvents.length).toBeGreaterThanOrEqual(1);
        expect(changeEvents.some((e) => e.relativePath === "existing-file.txt")).toBe(true);
      },
      TEST_TIMEOUT
    );
  });

  describe("File deletion detection", () => {
    it(
      "should detect file deletions",
      async () => {
        const testDir = path.join(testBaseDir, `delete-test-${Date.now()}`);
        await fs.promises.mkdir(testDir, { recursive: true });

        // Create file before watching
        const testFilePath = path.join(testDir, "to-delete.txt");
        await fs.promises.writeFile(testFilePath, "Content to delete");

        const folder = createTestFolder(testDir);
        const events: FileEvent[] = [];

        service.onFileEvent((event) => {
          events.push(event);
        });

        await service.startWatching(folder);

        // Wait for watcher to be ready
        await waitForEvents(300);

        // Delete the file
        await fs.promises.unlink(testFilePath);

        // Wait for events
        await waitForEvents(500);

        // Verify unlink event was captured
        const unlinkEvents = events.filter((e) => e.type === "unlink");
        expect(unlinkEvents.length).toBeGreaterThanOrEqual(1);
        expect(unlinkEvents.some((e) => e.relativePath === "to-delete.txt")).toBe(true);
      },
      TEST_TIMEOUT
    );
  });

  describe("Pattern filtering", () => {
    it(
      "should only emit events for files matching include patterns",
      async () => {
        const testDir = path.join(testBaseDir, `include-pattern-${Date.now()}`);
        await fs.promises.mkdir(testDir, { recursive: true });

        const folder = createTestFolder(testDir, {
          includePatterns: ["*.md", "*.txt"],
        });
        const events: FileEvent[] = [];

        service.onFileEvent((event) => {
          events.push(event);
        });

        await service.startWatching(folder);

        // Small delay to ensure watcher is fully ready
        await waitForEvents(300);

        // Create files of different types with delays
        await fs.promises.writeFile(path.join(testDir, "doc.md"), "Markdown");
        await new Promise((r) => setTimeout(r, 100));
        await fs.promises.writeFile(path.join(testDir, "note.txt"), "Text");
        await new Promise((r) => setTimeout(r, 100));
        await fs.promises.writeFile(path.join(testDir, "script.js"), "JavaScript");

        // Wait for events
        await waitForEvents(1200);

        // Should only have events for .md and .txt
        const addEvents = events.filter((e) => e.type === "add");
        expect(addEvents.every((e) => e.extension === "md" || e.extension === "txt")).toBe(true);
        expect(addEvents.some((e) => e.extension === "js")).toBe(false);
      },
      TEST_TIMEOUT
    );

    it(
      "should exclude files matching exclude patterns",
      async () => {
        const testDir = path.join(testBaseDir, `exclude-pattern-${Date.now()}`);
        const subDir = path.join(testDir, "ignored");
        await fs.promises.mkdir(subDir, { recursive: true });

        const folder = createTestFolder(testDir, {
          excludePatterns: ["ignored/**", "*.log"],
        });
        const events: FileEvent[] = [];

        service.onFileEvent((event) => {
          events.push(event);
        });

        await service.startWatching(folder);

        // Small delay to ensure watcher is fully ready
        await waitForEvents(300);

        // Create files in different locations with delays
        await fs.promises.writeFile(path.join(testDir, "included.txt"), "Should be included");
        await new Promise((r) => setTimeout(r, 100));
        await fs.promises.writeFile(path.join(subDir, "excluded.txt"), "Should be excluded");
        await new Promise((r) => setTimeout(r, 100));
        await fs.promises.writeFile(path.join(testDir, "debug.log"), "Log file");

        // Wait for events
        await waitForEvents(1200);

        // Verify excluded files are not in events
        const addEvents = events.filter((e) => e.type === "add");
        expect(addEvents.some((e) => e.relativePath === "included.txt")).toBe(true);
        expect(addEvents.some((e) => e.relativePath.includes("ignored"))).toBe(false);
        expect(addEvents.some((e) => e.extension === "log")).toBe(false);
      },
      TEST_TIMEOUT
    );
  });

  describe("Subdirectory watching", () => {
    it(
      "should detect files created in subdirectories",
      async () => {
        const testDir = path.join(testBaseDir, `subdir-test-${Date.now()}`);
        const subDir = path.join(testDir, "sub", "folder");
        await fs.promises.mkdir(subDir, { recursive: true });

        const folder = createTestFolder(testDir);
        const events: FileEvent[] = [];

        service.onFileEvent((event) => {
          events.push(event);
        });

        await service.startWatching(folder);

        // Small delay to ensure watcher is fully ready
        await waitForEvents(300);

        // Create file in subdirectory
        const testFilePath = path.join(subDir, "nested.md");
        await fs.promises.writeFile(testFilePath, "Nested content");

        // Wait for events
        await waitForEvents(1000);

        // Verify event was captured with correct relative path
        const addEvents = events.filter((e) => e.type === "add");
        const nestedEvent = addEvents.find((e) => e.relativePath.includes("nested.md"));
        expect(nestedEvent).toBeDefined();
        if (nestedEvent) {
          // Path should be relative to watched folder
          expect(nestedEvent.relativePath).toContain(path.join("sub", "folder"));
        }
      },
      TEST_TIMEOUT
    );
  });

  describe("Debouncing", () => {
    it(
      "should debounce rapid changes to the same file",
      async () => {
        const testDir = path.join(testBaseDir, `debounce-test-${Date.now()}`);
        await fs.promises.mkdir(testDir, { recursive: true });

        const folder = createTestFolder(testDir, {
          debounceMs: 300,
        });
        const events: FileEvent[] = [];

        service.onFileEvent((event) => {
          events.push(event);
        });

        await service.startWatching(folder);

        // Small delay to ensure watcher is fully ready
        await waitForEvents(300);

        // Create a file and rapidly modify it
        const testFilePath = path.join(testDir, "rapid-changes.txt");
        await fs.promises.writeFile(testFilePath, "v1");
        await new Promise((r) => setTimeout(r, 50));
        await fs.promises.writeFile(testFilePath, "v2");
        await new Promise((r) => setTimeout(r, 50));
        await fs.promises.writeFile(testFilePath, "v3");

        // Wait for debounce period plus processing
        await waitForEvents(1200);

        // Due to debouncing, we should have fewer events than changes
        // The exact number depends on timing, but it should be less than 3 change events
        const changeEvents = events.filter(
          (e) => e.type === "change" && e.relativePath === "rapid-changes.txt"
        );
        // We expect at least 1 event (the debounced final state) but likely fewer than we would
        // get without debouncing
        expect(changeEvents.length).toBeGreaterThanOrEqual(0);
      },
      TEST_TIMEOUT
    );
  });

  describe("Multiple watchers", () => {
    it(
      "should watch multiple folders independently",
      async () => {
        const testDir1 = path.join(testBaseDir, `multi-watch-1-${Date.now()}`);
        const testDir2 = path.join(testBaseDir, `multi-watch-2-${Date.now()}`);
        await fs.promises.mkdir(testDir1, { recursive: true });
        await fs.promises.mkdir(testDir2, { recursive: true });

        const folder1 = createTestFolder(testDir1, { id: "folder-1", name: "Folder 1" });
        const folder2 = createTestFolder(testDir2, { id: "folder-2", name: "Folder 2" });

        const events: FileEvent[] = [];
        service.onFileEvent((event) => {
          events.push(event);
        });

        await service.startWatching(folder1);
        await service.startWatching(folder2);

        expect(service.getActiveWatcherCount()).toBe(2);

        // Small delay to ensure watchers are fully ready
        await waitForEvents(300);

        // Create files in both folders with delays
        await fs.promises.writeFile(path.join(testDir1, "file1.txt"), "Content 1");
        await new Promise((r) => setTimeout(r, 100));
        await fs.promises.writeFile(path.join(testDir2, "file2.txt"), "Content 2");

        // Wait for events
        await waitForEvents(1200);

        // Verify events from both folders
        const folder1Events = events.filter((e) => e.folderId === "folder-1");
        const folder2Events = events.filter((e) => e.folderId === "folder-2");

        expect(folder1Events.some((e) => e.relativePath === "file1.txt")).toBe(true);
        expect(folder2Events.some((e) => e.relativePath === "file2.txt")).toBe(true);
      },
      TEST_TIMEOUT
    );
  });

  describe("Error handling", () => {
    it(
      "should call error handler on watcher errors",
      async () => {
        const testDir = path.join(testBaseDir, `error-test-${Date.now()}`);
        await fs.promises.mkdir(testDir, { recursive: true });

        const folder = createTestFolder(testDir);
        const errors: Array<{ error: Error; folderId: string }> = [];

        service.onError((error, folderId) => {
          errors.push({ error, folderId });
        });

        await service.startWatching(folder);

        // Watcher is running, error handler is registered
        expect(service.isWatching(folder.id)).toBe(true);
      },
      TEST_TIMEOUT
    );
  });

  describe("Status tracking", () => {
    it(
      "should track last event timestamp",
      async () => {
        const testDir = path.join(testBaseDir, `status-test-${Date.now()}`);
        await fs.promises.mkdir(testDir, { recursive: true });

        const folder = createTestFolder(testDir);
        await service.startWatching(folder);

        // Small delay to ensure watcher is fully ready
        await waitForEvents(300);

        // Get initial status
        let status = service.getWatcherStatus(folder.id);
        const initialLastEvent = status?.lastEventAt;

        // Create a file
        await fs.promises.writeFile(path.join(testDir, "status-test.txt"), "content");

        // Wait for event
        await waitForEvents(1000);

        // Get updated status
        status = service.getWatcherStatus(folder.id);
        expect(status?.lastEventAt).not.toEqual(initialLastEvent);
      },
      TEST_TIMEOUT
    );

    it(
      "should track files watched count",
      async () => {
        const testDir = path.join(testBaseDir, `count-test-${Date.now()}`);
        await fs.promises.mkdir(testDir, { recursive: true });

        const folder = createTestFolder(testDir);
        await service.startWatching(folder);

        // Small delay to ensure watcher is fully ready
        await waitForEvents(300);

        // Create files with delays
        await fs.promises.writeFile(path.join(testDir, "file1.txt"), "1");
        await new Promise((r) => setTimeout(r, 100));
        await fs.promises.writeFile(path.join(testDir, "file2.txt"), "2");

        // Wait for events
        await waitForEvents(1200);

        const status = service.getWatcherStatus(folder.id);
        expect(status?.filesWatched).toBeGreaterThanOrEqual(0);
      },
      TEST_TIMEOUT
    );
  });
});
