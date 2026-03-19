/**
 * Tests for Watch Commands
 *
 * @see Issue #389: Implement pk-mcp watch commands
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/await-thenable */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { describe, it, expect, vi, beforeEach, type Mock } from "bun:test";
import {
  watchAddCommand,
  watchListCommand,
  watchRemoveCommand,
  watchPauseCommand,
  watchResumeCommand,
  watchRescanCommand,
  type WatchCommandDeps,
} from "../../../src/cli/commands/watch-command.js";
import type { WatchedFolder } from "../../../src/services/folder-watcher-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build mock dependencies for watch command tests
 */
function buildMockDeps(
  overrides?: Partial<{
    listFolders: () => Promise<WatchedFolder[]>;
    addFolder: (f: WatchedFolder) => Promise<void>;
    updateFolder: (f: WatchedFolder) => Promise<void>;
    removeFolder: (id: string) => Promise<void>;
    getFolder: (id: string) => Promise<WatchedFolder | null>;
    scanFiles: (path: string, opts?: any) => Promise<any[]>;
    processChanges: (changes: any, opts: any) => Promise<any>;
    deleteCollection: (name: string) => Promise<void>;
  }>
): WatchCommandDeps {
  return {
    folderStore: {
      listFolders: overrides?.listFolders ?? vi.fn().mockResolvedValue([]),
      addFolder: overrides?.addFolder ?? vi.fn().mockResolvedValue(undefined),
      updateFolder: overrides?.updateFolder ?? vi.fn().mockResolvedValue(undefined),
      removeFolder: overrides?.removeFolder ?? vi.fn().mockResolvedValue(undefined),
      getFolder: overrides?.getFolder ?? vi.fn().mockResolvedValue(null),
    },
    fileScanner: {
      scanFiles: overrides?.scanFiles ?? vi.fn().mockResolvedValue([]),
    } as any,
    updatePipeline: {
      processChanges:
        overrides?.processChanges ??
        vi.fn().mockResolvedValue({
          stats: {
            filesAdded: 0,
            filesModified: 0,
            filesDeleted: 0,
            chunksUpserted: 0,
            chunksDeleted: 0,
            durationMs: 100,
          },
          errors: [],
          filterStats: {
            totalChanges: 0,
            eligibleChanges: 0,
            filteredChanges: 0,
            skippedChanges: 0,
          },
        }),
    } as any,
    chromaClient: {
      deleteCollection: overrides?.deleteCollection ?? vi.fn().mockResolvedValue(undefined),
    } as any,
  };
}

/**
 * Create a test WatchedFolder with sensible defaults
 */
function createTestFolder(overrides: Partial<WatchedFolder> = {}): WatchedFolder {
  return {
    id: "test-id-123",
    name: "test-folder",
    path: "/test/path",
    enabled: true,
    includePatterns: null,
    excludePatterns: null,
    debounceMs: 2000,
    fileCount: 5,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    lastScanAt: new Date("2025-01-01"),
    ...overrides,
  };
}

/**
 * Use the project tests directory as a valid folder (it must exist)
 */
const VALID_FOLDER = import.meta.dir.replace(/\/commands$/, "");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Watch Commands", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // watchAddCommand
  // =========================================================================

  describe("watchAddCommand", () => {
    it("should register a new folder successfully", async () => {
      const addFolder = vi.fn().mockResolvedValue(undefined);
      const deps = buildMockDeps({ addFolder });

      await watchAddCommand(VALID_FOLDER, {}, deps);

      expect(addFolder).toHaveBeenCalledTimes(1);
      const saved = (addFolder as Mock<any>).mock.calls[0]?.[0] as WatchedFolder;
      expect(saved).toBeDefined();
      expect(saved.path).toContain("tests");
      expect(saved.enabled).toBe(true);
      expect(saved.id).toBeTruthy();
    });

    it("should use custom name when --name is provided", async () => {
      const addFolder = vi.fn().mockResolvedValue(undefined);
      const deps = buildMockDeps({ addFolder });

      await watchAddCommand(VALID_FOLDER, { name: "My Docs" }, deps);

      const saved = (addFolder as Mock<any>).mock.calls[0]?.[0] as WatchedFolder;
      expect(saved.name).toBe("My Docs");
    });

    it("should default name to folder basename", async () => {
      const addFolder = vi.fn().mockResolvedValue(undefined);
      const deps = buildMockDeps({ addFolder });

      await watchAddCommand(VALID_FOLDER, {}, deps);

      const saved = (addFolder as Mock<any>).mock.calls[0]?.[0] as WatchedFolder;
      expect(saved.name).toBeTruthy();
      expect(typeof saved.name).toBe("string");
    });

    it("should throw when folder already registered", async () => {
      const existingFolder = createTestFolder({ path: VALID_FOLDER });
      const deps = buildMockDeps({
        listFolders: vi.fn().mockResolvedValue([existingFolder]),
      });

      await expect(watchAddCommand(VALID_FOLDER, {}, deps)).rejects.toThrow(
        "Folder already registered"
      );
    });

    it("should throw when folder does not exist", async () => {
      const deps = buildMockDeps();

      await expect(
        watchAddCommand("/nonexistent/path/that/does/not/exist", {}, deps)
      ).rejects.toThrow("Folder does not exist");
    });

    it("should throw when path is a file, not a directory", async () => {
      const deps = buildMockDeps();
      const thisFile = import.meta.path;

      await expect(watchAddCommand(thisFile, {}, deps)).rejects.toThrow("Path is not a directory");
    });

    it("should output JSON when --json is set", async () => {
      const addFolder = vi.fn().mockResolvedValue(undefined);
      const deps = buildMockDeps({ addFolder });
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await watchAddCommand(VALID_FOLDER, { json: true }, deps);

      expect(consoleSpy).toHaveBeenCalled();
      const output = (consoleSpy as Mock<any>).mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.success).toBe(true);
      expect(parsed.id).toBeTruthy();
    });
  });

  // =========================================================================
  // watchListCommand
  // =========================================================================

  describe("watchListCommand", () => {
    it("should print message when no folders registered", async () => {
      const deps = buildMockDeps();
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await watchListCommand({}, deps);

      expect(consoleSpy).toHaveBeenCalledWith("No watched folders registered.");
    });

    it("should display table when folders exist", async () => {
      const folders = [createTestFolder()];
      const deps = buildMockDeps({
        listFolders: vi.fn().mockResolvedValue(folders),
      });
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await watchListCommand({}, deps);

      // formatWatchListTable calls console.log internally
      expect(consoleSpy).toHaveBeenCalled();
    });

    it("should output JSON when --json is set", async () => {
      const folders = [createTestFolder()];
      const deps = buildMockDeps({
        listFolders: vi.fn().mockResolvedValue(folders),
      });
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await watchListCommand({ json: true }, deps);

      expect(consoleSpy).toHaveBeenCalled();
      const output = (consoleSpy as Mock<any>).mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.totalFolders).toBe(1);
      expect(parsed.folders).toHaveLength(1);
    });

    it("should output empty JSON when no folders and --json is set", async () => {
      const deps = buildMockDeps();
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await watchListCommand({ json: true }, deps);

      const output = (consoleSpy as Mock<any>).mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.totalFolders).toBe(0);
      expect(parsed.folders).toHaveLength(0);
    });
  });

  // =========================================================================
  // watchRemoveCommand
  // =========================================================================

  describe("watchRemoveCommand", () => {
    it("should remove folder with --force", async () => {
      const folder = createTestFolder();
      const removeFolder = vi.fn().mockResolvedValue(undefined);
      const deps = buildMockDeps({
        listFolders: vi.fn().mockResolvedValue([folder]),
        removeFolder,
      });

      await watchRemoveCommand("test-folder", { force: true }, deps);

      expect(removeFolder).toHaveBeenCalledWith("test-id-123");
    });

    it("should throw when folder not found", async () => {
      const deps = buildMockDeps();

      await expect(watchRemoveCommand("nonexistent", { force: true }, deps)).rejects.toThrow(
        "No watched folder found"
      );
    });

    it("should output JSON on success with --json and --force", async () => {
      const folder = createTestFolder();
      const removeFolder = vi.fn().mockResolvedValue(undefined);
      const deps = buildMockDeps({
        listFolders: vi.fn().mockResolvedValue([folder]),
        removeFolder,
      });
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await watchRemoveCommand("test-folder", { force: true, json: true }, deps);

      const output = (consoleSpy as Mock<any>).mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.success).toBe(true);
      expect(parsed.id).toBe("test-id-123");
    });
  });

  // =========================================================================
  // watchPauseCommand
  // =========================================================================

  describe("watchPauseCommand", () => {
    it("should pause an active folder", async () => {
      const folder = createTestFolder({ enabled: true });
      const updateFolder = vi.fn().mockResolvedValue(undefined);
      const deps = buildMockDeps({
        listFolders: vi.fn().mockResolvedValue([folder]),
        updateFolder,
      });

      await watchPauseCommand("test-folder", {}, deps);

      expect(updateFolder).toHaveBeenCalledTimes(1);
      const updated = (updateFolder as Mock<any>).mock.calls[0]?.[0] as WatchedFolder;
      expect(updated.enabled).toBe(false);
    });

    it("should warn and skip update when folder is already paused", async () => {
      const folder = createTestFolder({ enabled: false });
      const updateFolder = vi.fn();
      const deps = buildMockDeps({
        listFolders: vi.fn().mockResolvedValue([folder]),
        updateFolder,
      });
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      await watchPauseCommand("test-folder", {}, deps);

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("already paused"));
      expect(updateFolder).not.toHaveBeenCalled();
    });

    it("should throw when folder not found", async () => {
      const deps = buildMockDeps();

      await expect(watchPauseCommand("nonexistent", {}, deps)).rejects.toThrow(
        "No watched folder found"
      );
    });

    it("should output JSON when --json is set", async () => {
      const folder = createTestFolder({ enabled: true });
      const updateFolder = vi.fn().mockResolvedValue(undefined);
      const deps = buildMockDeps({
        listFolders: vi.fn().mockResolvedValue([folder]),
        updateFolder,
      });
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await watchPauseCommand("test-folder", { json: true }, deps);

      const output = (consoleSpy as Mock<any>).mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.success).toBe(true);
      expect(parsed.enabled).toBe(false);
    });
  });

  // =========================================================================
  // watchResumeCommand
  // =========================================================================

  describe("watchResumeCommand", () => {
    it("should resume a paused folder", async () => {
      const folder = createTestFolder({ enabled: false });
      const updateFolder = vi.fn().mockResolvedValue(undefined);
      const deps = buildMockDeps({
        listFolders: vi.fn().mockResolvedValue([folder]),
        updateFolder,
      });

      await watchResumeCommand("test-folder", {}, deps);

      expect(updateFolder).toHaveBeenCalledTimes(1);
      const updated = (updateFolder as Mock<any>).mock.calls[0]?.[0] as WatchedFolder;
      expect(updated.enabled).toBe(true);
    });

    it("should warn and skip update when folder is already active", async () => {
      const folder = createTestFolder({ enabled: true });
      const updateFolder = vi.fn();
      const deps = buildMockDeps({
        listFolders: vi.fn().mockResolvedValue([folder]),
        updateFolder,
      });
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      await watchResumeCommand("test-folder", {}, deps);

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("already active"));
      expect(updateFolder).not.toHaveBeenCalled();
    });

    it("should throw when folder not found", async () => {
      const deps = buildMockDeps();

      await expect(watchResumeCommand("nonexistent", {}, deps)).rejects.toThrow(
        "No watched folder found"
      );
    });

    it("should output JSON when --json is set", async () => {
      const folder = createTestFolder({ enabled: false });
      const updateFolder = vi.fn().mockResolvedValue(undefined);
      const deps = buildMockDeps({
        listFolders: vi.fn().mockResolvedValue([folder]),
        updateFolder,
      });
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await watchResumeCommand("test-folder", { json: true }, deps);

      const output = (consoleSpy as Mock<any>).mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.success).toBe(true);
      expect(parsed.enabled).toBe(true);
    });
  });

  // =========================================================================
  // watchRescanCommand
  // =========================================================================

  describe("watchRescanCommand", () => {
    it("should rescan folder and update store", async () => {
      const folder = createTestFolder();
      const updateFolder = vi.fn().mockResolvedValue(undefined);
      const scanFiles = vi.fn().mockResolvedValue([
        {
          relativePath: "doc.md",
          absolutePath: "/test/path/doc.md",
          extension: ".md",
          sizeBytes: 100,
          modifiedAt: new Date(),
        },
      ]);
      const processChanges = vi.fn().mockResolvedValue({
        stats: {
          filesAdded: 1,
          filesModified: 0,
          filesDeleted: 0,
          chunksUpserted: 5,
          chunksDeleted: 0,
          durationMs: 200,
        },
        errors: [],
        filterStats: { totalChanges: 1, eligibleChanges: 1, filteredChanges: 1, skippedChanges: 0 },
      });
      const deps = buildMockDeps({
        listFolders: vi.fn().mockResolvedValue([folder]),
        updateFolder,
        scanFiles,
        processChanges,
      });

      await watchRescanCommand("test-folder", {}, deps);

      expect(scanFiles).toHaveBeenCalledTimes(1);
      expect(processChanges).toHaveBeenCalledTimes(1);
      expect(updateFolder).toHaveBeenCalledTimes(1);

      const updated = (updateFolder as Mock<any>).mock.calls[0]?.[0] as WatchedFolder;
      expect(updated.fileCount).toBe(1);
      expect(updated.lastScanAt).toBeInstanceOf(Date);
    });

    it("should delete collection before re-indexing when --full", async () => {
      const folder = createTestFolder();
      const deleteCollection = vi.fn().mockResolvedValue(undefined);
      const scanFiles = vi.fn().mockResolvedValue([
        {
          relativePath: "doc.md",
          absolutePath: "/test/path/doc.md",
          extension: ".md",
          sizeBytes: 100,
          modifiedAt: new Date(),
        },
      ]);
      const processChanges = vi.fn().mockResolvedValue({
        stats: {
          filesAdded: 1,
          filesModified: 0,
          filesDeleted: 0,
          chunksUpserted: 5,
          chunksDeleted: 0,
          durationMs: 200,
        },
        errors: [],
        filterStats: { totalChanges: 1, eligibleChanges: 1, filteredChanges: 1, skippedChanges: 0 },
      });
      const deps = buildMockDeps({
        listFolders: vi.fn().mockResolvedValue([folder]),
        scanFiles,
        processChanges,
        deleteCollection,
      });

      await watchRescanCommand("test-folder", { full: true }, deps);

      expect(deleteCollection).toHaveBeenCalledWith("folder_test-id-123");
    });

    it("should throw when folder not found", async () => {
      const deps = buildMockDeps();

      await expect(watchRescanCommand("nonexistent", {}, deps)).rejects.toThrow(
        "No watched folder found"
      );
    });

    it("should use SUPPORTED_EXTENSIONS when includePatterns is null", async () => {
      const folder = createTestFolder({ includePatterns: null });
      const scanFiles = vi.fn().mockResolvedValue([]);
      const deps = buildMockDeps({
        listFolders: vi.fn().mockResolvedValue([folder]),
        scanFiles,
      });

      await watchRescanCommand("test-folder", {}, deps);

      const scanCall = (scanFiles as Mock<any>).mock.calls[0];
      expect(scanCall).toBeDefined();
      const opts = (scanCall as any[])[1] as { includeExtensions: string[] };
      expect(opts.includeExtensions).toContain(".pdf");
      expect(opts.includeExtensions).toContain(".md");
    });

    it("should extract extensions from includePatterns", async () => {
      const folder = createTestFolder({ includePatterns: ["*.md", "*.txt"] });
      const scanFiles = vi.fn().mockResolvedValue([]);
      const deps = buildMockDeps({
        listFolders: vi.fn().mockResolvedValue([folder]),
        scanFiles,
      });

      await watchRescanCommand("test-folder", {}, deps);

      const scanCall = (scanFiles as Mock<any>).mock.calls[0];
      const opts = (scanCall as any[])[1] as { includeExtensions: string[] };
      expect(opts.includeExtensions).toEqual([".md", ".txt"]);
    });

    it("should use folder-{id} as repositoryName and folder_{id} as collectionName", async () => {
      const folder = createTestFolder({ id: "abc-123" });
      const scanFiles = vi.fn().mockResolvedValue([
        {
          relativePath: "doc.md",
          absolutePath: "/test/path/doc.md",
          extension: ".md",
          sizeBytes: 100,
          modifiedAt: new Date(),
        },
      ]);
      const processChanges = vi.fn().mockResolvedValue({
        stats: {
          filesAdded: 1,
          filesModified: 0,
          filesDeleted: 0,
          chunksUpserted: 5,
          chunksDeleted: 0,
          durationMs: 200,
        },
        errors: [],
        filterStats: { totalChanges: 1, eligibleChanges: 1, filteredChanges: 1, skippedChanges: 0 },
      });
      const deps = buildMockDeps({
        listFolders: vi.fn().mockResolvedValue([folder]),
        scanFiles,
        processChanges,
      });

      await watchRescanCommand("test-folder", {}, deps);

      const callOpts = (processChanges as Mock<any>).mock.calls[0]?.[1] as {
        repository: string;
        collectionName: string;
      };
      expect(callOpts.repository).toBe("folder-abc-123");
      expect(callOpts.collectionName).toBe("folder_abc-123");
    });

    it("should output JSON when --json is set", async () => {
      const folder = createTestFolder();
      const scanFiles = vi.fn().mockResolvedValue([
        {
          relativePath: "doc.md",
          absolutePath: "/test/path/doc.md",
          extension: ".md",
          sizeBytes: 100,
          modifiedAt: new Date(),
        },
      ]);
      const processChanges = vi.fn().mockResolvedValue({
        stats: {
          filesAdded: 1,
          filesModified: 0,
          filesDeleted: 0,
          chunksUpserted: 5,
          chunksDeleted: 0,
          durationMs: 200,
        },
        errors: [],
        filterStats: { totalChanges: 1, eligibleChanges: 1, filteredChanges: 1, skippedChanges: 0 },
      });
      const deps = buildMockDeps({
        listFolders: vi.fn().mockResolvedValue([folder]),
        scanFiles,
        processChanges,
      });
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await watchRescanCommand("test-folder", { json: true }, deps);

      // Find the JSON output (skip spinner output)
      const jsonCalls = (consoleSpy as Mock<any>).mock.calls.filter((call: any[]) => {
        try {
          JSON.parse(call[0] as string);
          return true;
        } catch {
          return false;
        }
      });
      expect(jsonCalls.length).toBeGreaterThan(0);
      const parsed = JSON.parse(jsonCalls[0]![0] as string);
      expect(parsed.success).toBe(true);
      expect(parsed.filesScanned).toBe(1);
    });

    it("should propagate error when scan fails", async () => {
      const folder = createTestFolder();
      const scanFiles = vi.fn().mockRejectedValue(new Error("Scan error"));
      const deps = buildMockDeps({
        listFolders: vi.fn().mockResolvedValue([folder]),
        scanFiles,
      });

      await expect(watchRescanCommand("test-folder", {}, deps)).rejects.toThrow("Scan error");
    });

    it("should propagate error when pipeline fails", async () => {
      const folder = createTestFolder();
      const scanFiles = vi.fn().mockResolvedValue([
        {
          relativePath: "doc.md",
          absolutePath: "/test/path/doc.md",
          extension: ".md",
          sizeBytes: 100,
          modifiedAt: new Date(),
        },
      ]);
      const processChanges = vi.fn().mockRejectedValue(new Error("Pipeline failure"));
      const deps = buildMockDeps({
        listFolders: vi.fn().mockResolvedValue([folder]),
        scanFiles,
        processChanges,
      });

      await expect(watchRescanCommand("test-folder", {}, deps)).rejects.toThrow("Pipeline failure");
    });

    it("should display warnings when rescan has errors", async () => {
      const folder = createTestFolder();
      const scanFiles = vi.fn().mockResolvedValue([
        {
          relativePath: "doc.md",
          absolutePath: "/test/path/doc.md",
          extension: ".md",
          sizeBytes: 100,
          modifiedAt: new Date(),
        },
      ]);
      const processChanges = vi.fn().mockResolvedValue({
        stats: {
          filesAdded: 0,
          filesModified: 0,
          filesDeleted: 0,
          chunksUpserted: 0,
          chunksDeleted: 0,
          durationMs: 200,
        },
        errors: [{ path: "doc.md", error: "Parse error" }],
        filterStats: { totalChanges: 1, eligibleChanges: 1, filteredChanges: 1, skippedChanges: 0 },
      });
      const deps = buildMockDeps({
        listFolders: vi.fn().mockResolvedValue([folder]),
        scanFiles,
        processChanges,
      });
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await watchRescanCommand("test-folder", {}, deps);

      // Check that error details were displayed
      const allOutput = (consoleSpy as Mock<any>).mock.calls.map((c: any[]) => c[0]).join("\n");
      expect(allOutput).toContain("failed to process");
    });

    it("should handle --full when deleteCollection throws", async () => {
      const folder = createTestFolder();
      const deleteCollection = vi.fn().mockRejectedValue(new Error("Not found"));
      const scanFiles = vi.fn().mockResolvedValue([
        {
          relativePath: "doc.md",
          absolutePath: "/test/path/doc.md",
          extension: ".md",
          sizeBytes: 100,
          modifiedAt: new Date(),
        },
      ]);
      const processChanges = vi.fn().mockResolvedValue({
        stats: {
          filesAdded: 1,
          filesModified: 0,
          filesDeleted: 0,
          chunksUpserted: 5,
          chunksDeleted: 0,
          durationMs: 200,
        },
        errors: [],
        filterStats: { totalChanges: 1, eligibleChanges: 1, filteredChanges: 1, skippedChanges: 0 },
      });
      const deps = buildMockDeps({
        listFolders: vi.fn().mockResolvedValue([folder]),
        deleteCollection,
        scanFiles,
        processChanges,
      });

      // Should not throw - the catch block handles the error gracefully
      await expect(
        watchRescanCommand("test-folder", { full: true }, deps)
      ).resolves.toBeUndefined();

      expect(processChanges).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // resolveFolderByNameOrPath (tested indirectly)
  // =========================================================================

  describe("Folder resolution", () => {
    it("should resolve by exact path", async () => {
      const folder = createTestFolder({ path: VALID_FOLDER });
      const updateFolder = vi.fn().mockResolvedValue(undefined);
      const deps = buildMockDeps({
        listFolders: vi.fn().mockResolvedValue([folder]),
        updateFolder,
      });

      // Use the path instead of the name
      await watchPauseCommand(VALID_FOLDER, {}, deps);

      expect(updateFolder).toHaveBeenCalledTimes(1);
    });

    it("should resolve by partial name match", async () => {
      const folder = createTestFolder({ name: "my-documents-folder" });
      const updateFolder = vi.fn().mockResolvedValue(undefined);
      const deps = buildMockDeps({
        listFolders: vi.fn().mockResolvedValue([folder]),
        updateFolder,
      });

      await watchPauseCommand("my-doc", {}, deps);

      expect(updateFolder).toHaveBeenCalledTimes(1);
    });

    it("should throw on ambiguous partial match", async () => {
      const folder1 = createTestFolder({ id: "1", name: "my-docs" });
      const folder2 = createTestFolder({ id: "2", name: "my-data" });
      const deps = buildMockDeps({
        listFolders: vi.fn().mockResolvedValue([folder1, folder2]),
      });

      await expect(watchPauseCommand("my-", {}, deps)).rejects.toThrow(
        "Ambiguous folder reference"
      );
    });
  });
});
