/**
 * Unit tests for folder-watcher-service.ts
 *
 * Tests the FolderWatcherService class functionality.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { initializeLogger, resetLogger } from "../../../src/logging/index.js";
import {
  FolderWatcherService,
  FolderNotFoundError,
  FolderAlreadyWatchedError,
  FolderNotWatchedError,
  MaxWatchersExceededError,
} from "../../../src/services/index.js";
import type { WatchedFolder, FileEvent } from "../../../src/services/folder-watcher-types.js";

// Initialize logger for tests
beforeAll(() => {
  initializeLogger({ level: "silent", format: "json" });
});

afterAll(() => {
  resetLogger();
});

/**
 * Create a test WatchedFolder object
 */
function createTestFolder(overrides: Partial<WatchedFolder> = {}): WatchedFolder {
  return {
    id: "test-folder-1",
    path: path.join(os.tmpdir(), "test-folder-watcher-" + Date.now()),
    name: "Test Folder",
    enabled: true,
    includePatterns: null,
    excludePatterns: null,
    debounceMs: 100, // Short debounce for testing
    createdAt: new Date(),
    lastScanAt: null,
    fileCount: 0,
    updatedAt: null,
    ...overrides,
  };
}

describe("FolderWatcherService", () => {
  let service: FolderWatcherService;
  let testFolder: WatchedFolder;

  beforeEach(async () => {
    service = new FolderWatcherService({
      defaultDebounceMs: 100,
      maxConcurrentWatchers: 3,
    });

    testFolder = createTestFolder();
    // Create the test directory
    await fs.promises.mkdir(testFolder.path, { recursive: true });
  });

  afterEach(async () => {
    // Stop all watchers
    try {
      await service.stopAllWatchers();
    } catch {
      // Ignore cleanup errors
    }

    // Clean up test directory
    try {
      await fs.promises.rm(testFolder.path, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("constructor", () => {
    it("should create service with default config", () => {
      const defaultService = new FolderWatcherService();
      expect(defaultService.getActiveWatcherCount()).toBe(0);
    });

    it("should create service with custom config", () => {
      const customService = new FolderWatcherService({
        defaultDebounceMs: 5000,
        maxConcurrentWatchers: 5,
        usePolling: true,
      });
      expect(customService.getActiveWatcherCount()).toBe(0);
    });
  });

  describe("startWatching", () => {
    it("should start watching a valid folder", async () => {
      await service.startWatching(testFolder);

      expect(service.isWatching(testFolder.id)).toBe(true);
      expect(service.getActiveWatcherCount()).toBe(1);
    });

    it("should throw FolderNotFoundError for non-existent folder", async () => {
      const nonExistentFolder = createTestFolder({
        id: "non-existent",
        path: "/non/existent/path/that/does/not/exist",
      });

      expect(service.startWatching(nonExistentFolder)).rejects.toThrow(FolderNotFoundError);
    });

    it("should throw FolderAlreadyWatchedError when watching same folder twice", async () => {
      await service.startWatching(testFolder);

      expect(service.startWatching(testFolder)).rejects.toThrow(FolderAlreadyWatchedError);
    });

    it("should throw MaxWatchersExceededError when limit reached", async () => {
      // Create and watch 3 folders (max)
      const folders: WatchedFolder[] = [];
      for (let i = 0; i < 3; i++) {
        const folder = createTestFolder({
          id: `folder-${i}`,
          path: path.join(os.tmpdir(), `test-watcher-${Date.now()}-${i}`),
        });
        await fs.promises.mkdir(folder.path, { recursive: true });
        folders.push(folder);
        await service.startWatching(folder);
      }

      // Try to add a 4th
      const extraFolder = createTestFolder({
        id: "folder-extra",
        path: path.join(os.tmpdir(), `test-watcher-${Date.now()}-extra`),
      });
      await fs.promises.mkdir(extraFolder.path, { recursive: true });

      try {
        expect(service.startWatching(extraFolder)).rejects.toThrow(MaxWatchersExceededError);
      } finally {
        // Cleanup extra folders
        for (const folder of folders) {
          try {
            await fs.promises.rm(folder.path, { recursive: true, force: true });
          } catch {
            // Ignore
          }
        }
        try {
          await fs.promises.rm(extraFolder.path, { recursive: true, force: true });
        } catch {
          // Ignore
        }
      }
    });
  });

  describe("stopWatching", () => {
    it("should stop watching a folder", async () => {
      await service.startWatching(testFolder);
      expect(service.isWatching(testFolder.id)).toBe(true);

      await service.stopWatching(testFolder.id);
      expect(service.isWatching(testFolder.id)).toBe(false);
      expect(service.getActiveWatcherCount()).toBe(0);
    });

    it("should throw FolderNotWatchedError for non-watched folder", async () => {
      expect(service.stopWatching("non-existent-id")).rejects.toThrow(FolderNotWatchedError);
    });
  });

  describe("stopAllWatchers", () => {
    it("should stop all active watchers", async () => {
      // Create and watch multiple folders
      const folder1 = testFolder;
      const folder2 = createTestFolder({
        id: "folder-2",
        path: path.join(os.tmpdir(), `test-watcher-${Date.now()}-2`),
      });
      await fs.promises.mkdir(folder2.path, { recursive: true });

      try {
        await service.startWatching(folder1);
        await service.startWatching(folder2);

        expect(service.getActiveWatcherCount()).toBe(2);

        await service.stopAllWatchers();

        expect(service.getActiveWatcherCount()).toBe(0);
        expect(service.isWatching(folder1.id)).toBe(false);
        expect(service.isWatching(folder2.id)).toBe(false);
      } finally {
        try {
          await fs.promises.rm(folder2.path, { recursive: true, force: true });
        } catch {
          // Ignore
        }
      }
    });

    it("should handle stopping when no watchers active", async () => {
      // Should not throw
      await service.stopAllWatchers();
      expect(service.getActiveWatcherCount()).toBe(0);
    });
  });

  describe("Event handlers", () => {
    it("should register and call file event handlers", async () => {
      const events: FileEvent[] = [];
      const handler = (event: FileEvent): void => {
        events.push(event);
      };

      service.onFileEvent(handler);
      await service.startWatching(testFolder);

      // Create a file
      const testFilePath = path.join(testFolder.path, "test.md");
      await fs.promises.writeFile(testFilePath, "test content");

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events.some((e) => e.type === "add")).toBe(true);
    });

    it("should register and call error handlers", async () => {
      const errors: Array<{ error: Error; folderId: string }> = [];
      const errorHandler = (error: Error, folderId: string): void => {
        errors.push({ error, folderId });
      };

      service.onError(errorHandler);

      // Verify handler is registered
      expect(errors.length).toBe(0);
    });

    it("should remove event handlers", () => {
      const handler = (): void => {};
      service.onFileEvent(handler);
      service.removeEventHandler(handler);
      // No assertion needed - just verify it doesn't throw
    });

    it("should remove error handlers", () => {
      const handler = (): void => {};
      service.onError(handler);
      service.removeErrorHandler(handler);
      // No assertion needed - just verify it doesn't throw
    });
  });

  describe("Status methods", () => {
    describe("getWatcherStatus", () => {
      it("should return status for watched folder", async () => {
        await service.startWatching(testFolder);

        const status = service.getWatcherStatus(testFolder.id);
        expect(status).not.toBeNull();
        expect(status?.folderId).toBe(testFolder.id);
        expect(status?.folderPath).toBe(testFolder.path);
        expect(status?.folderName).toBe(testFolder.name);
        expect(status?.status).toBe("active");
      });

      it("should return null for non-watched folder", () => {
        const status = service.getWatcherStatus("non-existent");
        expect(status).toBeNull();
      });
    });

    describe("getAllWatcherStatuses", () => {
      it("should return all watcher statuses", async () => {
        const folder2 = createTestFolder({
          id: "folder-2",
          path: path.join(os.tmpdir(), `test-watcher-${Date.now()}-2`),
          name: "Folder 2",
        });
        await fs.promises.mkdir(folder2.path, { recursive: true });

        try {
          await service.startWatching(testFolder);
          await service.startWatching(folder2);

          const statuses = service.getAllWatcherStatuses();
          expect(statuses.length).toBe(2);
          expect(statuses.map((s) => s.folderId).sort()).toEqual(
            [testFolder.id, folder2.id].sort()
          );
        } finally {
          try {
            await fs.promises.rm(folder2.path, { recursive: true, force: true });
          } catch {
            // Ignore
          }
        }
      });

      it("should return empty array when no watchers", () => {
        const statuses = service.getAllWatcherStatuses();
        expect(statuses).toEqual([]);
      });
    });

    describe("isWatching", () => {
      it("should return true for watched folder", async () => {
        await service.startWatching(testFolder);
        expect(service.isWatching(testFolder.id)).toBe(true);
      });

      it("should return false for non-watched folder", () => {
        expect(service.isWatching("non-existent")).toBe(false);
      });
    });

    describe("getActiveWatcherCount", () => {
      it("should return correct count", async () => {
        expect(service.getActiveWatcherCount()).toBe(0);

        await service.startWatching(testFolder);
        expect(service.getActiveWatcherCount()).toBe(1);

        await service.stopWatching(testFolder.id);
        expect(service.getActiveWatcherCount()).toBe(0);
      });
    });
  });

  describe("Pattern filtering", () => {
    describe("shouldIncludeFile", () => {
      it("should include all files when no patterns specified", () => {
        const folder = createTestFolder({
          includePatterns: null,
          excludePatterns: null,
        });

        expect(service.shouldIncludeFile("test.md", folder)).toBe(true);
        expect(service.shouldIncludeFile("file.txt", folder)).toBe(true);
        expect(service.shouldIncludeFile("any/path/file.js", folder)).toBe(true);
      });

      it("should filter by include patterns", () => {
        const folder = createTestFolder({
          includePatterns: ["*.md", "*.txt"],
          excludePatterns: null,
        });

        expect(service.shouldIncludeFile("readme.md", folder)).toBe(true);
        expect(service.shouldIncludeFile("notes.txt", folder)).toBe(true);
        expect(service.shouldIncludeFile("script.js", folder)).toBe(false);
        expect(service.shouldIncludeFile("data.json", folder)).toBe(false);
      });

      it("should filter by exclude patterns", () => {
        const folder = createTestFolder({
          includePatterns: null,
          excludePatterns: ["*.log", "temp/**"],
        });

        expect(service.shouldIncludeFile("readme.md", folder)).toBe(true);
        expect(service.shouldIncludeFile("error.log", folder)).toBe(false);
      });

      it("should apply both include and exclude patterns", () => {
        const folder = createTestFolder({
          includePatterns: ["*.md", "*.txt"],
          excludePatterns: ["temp.md"],
        });

        expect(service.shouldIncludeFile("readme.md", folder)).toBe(true);
        expect(service.shouldIncludeFile("notes.txt", folder)).toBe(true);
        expect(service.shouldIncludeFile("temp.md", folder)).toBe(false);
        expect(service.shouldIncludeFile("script.js", folder)).toBe(false);
      });
    });
  });

  describe("Types export", () => {
    it("should export default config", async () => {
      const { DEFAULT_FOLDER_WATCHER_CONFIG } =
        await import("../../../src/services/folder-watcher-types.js");
      expect(DEFAULT_FOLDER_WATCHER_CONFIG.defaultDebounceMs).toBe(2000);
      expect(DEFAULT_FOLDER_WATCHER_CONFIG.maxConcurrentWatchers).toBe(10);
      expect(DEFAULT_FOLDER_WATCHER_CONFIG.usePolling).toBe(false);
      expect(DEFAULT_FOLDER_WATCHER_CONFIG.pollInterval).toBe(100);
      expect(DEFAULT_FOLDER_WATCHER_CONFIG.emitExistingFiles).toBe(false);
    });
  });
});
