/**
 * Unit tests for ListWatchedFoldersServiceImpl
 *
 * Tests the business logic for listing watched folders and their status.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { initializeLogger, resetLogger } from "../../../src/logging/index.js";
import { ListWatchedFoldersServiceImpl } from "../../../src/services/list-watched-folders-service.js";
import type { FolderWatcherService } from "../../../src/services/folder-watcher-service.js";
import type {
  WatchedFolderDetail,
  WatchedFolder,
} from "../../../src/services/folder-watcher-types.js";

beforeAll(() => {
  initializeLogger({ level: "silent", format: "json" });
});

afterAll(() => {
  resetLogger();
});

/**
 * Create a mock FolderWatcherService with the given folder details
 */
function createMockFolderWatcherService(details: WatchedFolderDetail[]): FolderWatcherService {
  return {
    getAllWatchedFolderDetails: () => details,
  } as unknown as FolderWatcherService;
}

/**
 * Create a test WatchedFolder object
 */
function createTestFolder(overrides: Partial<WatchedFolder> = {}): WatchedFolder {
  return {
    id: "folder-1",
    path: "/test/documents",
    name: "Test Documents",
    enabled: true,
    includePatterns: null,
    excludePatterns: null,
    debounceMs: 2000,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    lastScanAt: null,
    fileCount: 0,
    updatedAt: null,
    ...overrides,
  };
}

describe("ListWatchedFoldersServiceImpl", () => {
  describe("listWatchedFolders", () => {
    it("should return empty list when no folders are watched", async () => {
      const mockService = createMockFolderWatcherService([]);
      const service = new ListWatchedFoldersServiceImpl(mockService);

      const response = await service.listWatchedFolders();

      expect(response.folders).toEqual([]);
    });

    it("should map active folder details correctly", async () => {
      const folder = createTestFolder({
        id: "folder-active",
        name: "Active Folder",
        path: "/docs/active",
        enabled: true,
        includePatterns: ["*.md", "*.txt"],
        excludePatterns: ["node_modules/**"],
        lastScanAt: new Date("2026-03-01T12:00:00Z"),
      });

      const details: WatchedFolderDetail[] = [
        {
          folder,
          status: "active",
          filesWatched: 42,
          lastEventAt: new Date("2026-03-01T12:30:00Z"),
        },
      ];

      const mockService = createMockFolderWatcherService(details);
      const service = new ListWatchedFoldersServiceImpl(mockService);

      const response = await service.listWatchedFolders();

      expect(response.folders).toHaveLength(1);
      const [entry] = response.folders;
      expect(entry?.id).toBe("folder-active");
      expect(entry?.name).toBe("Active Folder");
      expect(entry?.path).toBe("/docs/active");
      expect(entry?.enabled).toBe(true);
      expect(entry?.watcherStatus).toBe("active");
      expect(entry?.includePatterns).toEqual(["*.md", "*.txt"]);
      expect(entry?.excludePatterns).toEqual(["node_modules/**"]);
      expect(entry?.lastScanAt).toEqual(new Date("2026-03-01T12:00:00Z"));
      expect(entry?.documentCount).toBe(0);
      expect(entry?.imageCount).toBe(0);
    });

    it("should handle paused, error, and stopped statuses", async () => {
      const details: WatchedFolderDetail[] = [
        {
          folder: createTestFolder({ id: "paused-1", name: "Paused" }),
          status: "paused",
          filesWatched: 10,
          lastEventAt: null,
        },
        {
          folder: createTestFolder({ id: "error-1", name: "Error" }),
          status: "error",
          filesWatched: 5,
          lastEventAt: null,
          error: "Permission denied",
        },
        {
          folder: createTestFolder({ id: "stopped-1", name: "Stopped" }),
          status: "stopped",
          filesWatched: 0,
          lastEventAt: null,
        },
      ];

      const mockService = createMockFolderWatcherService(details);
      const service = new ListWatchedFoldersServiceImpl(mockService);

      const response = await service.listWatchedFolders();

      expect(response.folders).toHaveLength(3);
      expect(response.folders.at(0)?.watcherStatus).toBe("paused");
      expect(response.folders.at(1)?.watcherStatus).toBe("error");
      expect(response.folders.at(2)?.watcherStatus).toBe("stopped");
    });

    it("should default null patterns to empty arrays", async () => {
      const folder = createTestFolder({
        includePatterns: null,
        excludePatterns: null,
      });

      const details: WatchedFolderDetail[] = [
        {
          folder,
          status: "active",
          filesWatched: 0,
          lastEventAt: null,
        },
      ];

      const mockService = createMockFolderWatcherService(details);
      const service = new ListWatchedFoldersServiceImpl(mockService);

      const response = await service.listWatchedFolders();
      const [entry] = response.folders;

      expect(entry?.includePatterns).toEqual([]);
      expect(entry?.excludePatterns).toEqual([]);
    });

    it("should set documentCount and imageCount to 0", async () => {
      const details: WatchedFolderDetail[] = [
        {
          folder: createTestFolder(),
          status: "active",
          filesWatched: 100,
          lastEventAt: new Date(),
        },
      ];

      const mockService = createMockFolderWatcherService(details);
      const service = new ListWatchedFoldersServiceImpl(mockService);

      const response = await service.listWatchedFolders();
      const [entry] = response.folders;

      expect(entry?.documentCount).toBe(0);
      expect(entry?.imageCount).toBe(0);
    });

    it("should map lastScanAt as undefined when null", async () => {
      const folder = createTestFolder({ lastScanAt: null });
      const details: WatchedFolderDetail[] = [
        {
          folder,
          status: "active",
          filesWatched: 0,
          lastEventAt: null,
        },
      ];

      const mockService = createMockFolderWatcherService(details);
      const service = new ListWatchedFoldersServiceImpl(mockService);

      const response = await service.listWatchedFolders();
      const [entry] = response.folders;

      expect(entry?.lastScanAt).toBeUndefined();
    });

    it("should map lastScanAt when present", async () => {
      const scanDate = new Date("2026-03-08T10:00:00Z");
      const folder = createTestFolder({ lastScanAt: scanDate });
      const details: WatchedFolderDetail[] = [
        {
          folder,
          status: "active",
          filesWatched: 15,
          lastEventAt: null,
        },
      ];

      const mockService = createMockFolderWatcherService(details);
      const service = new ListWatchedFoldersServiceImpl(mockService);

      const response = await service.listWatchedFolders();
      const [entry] = response.folders;

      expect(entry?.lastScanAt).toEqual(scanDate);
    });

    it("should handle multiple folders with mixed states", async () => {
      const details: WatchedFolderDetail[] = [
        {
          folder: createTestFolder({
            id: "f1",
            name: "Docs",
            path: "/docs",
            enabled: true,
            includePatterns: ["*.md"],
            excludePatterns: null,
          }),
          status: "active",
          filesWatched: 25,
          lastEventAt: new Date("2026-03-08T09:00:00Z"),
        },
        {
          folder: createTestFolder({
            id: "f2",
            name: "Notes",
            path: "/notes",
            enabled: false,
            includePatterns: null,
            excludePatterns: [".git/**"],
          }),
          status: "stopped",
          filesWatched: 0,
          lastEventAt: null,
        },
      ];

      const mockService = createMockFolderWatcherService(details);
      const service = new ListWatchedFoldersServiceImpl(mockService);

      const response = await service.listWatchedFolders();

      expect(response.folders).toHaveLength(2);

      const [first, second] = response.folders;

      // First folder
      expect(first?.id).toBe("f1");
      expect(first?.enabled).toBe(true);
      expect(first?.includePatterns).toEqual(["*.md"]);
      expect(first?.excludePatterns).toEqual([]);

      // Second folder
      expect(second?.id).toBe("f2");
      expect(second?.enabled).toBe(false);
      expect(second?.includePatterns).toEqual([]);
      expect(second?.excludePatterns).toEqual([".git/**"]);
    });
  });
});
