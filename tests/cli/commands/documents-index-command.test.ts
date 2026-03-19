/**
 * Tests for Documents Index Command
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/await-thenable */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { describe, it, expect, vi, type Mock } from "bun:test";
import { documentsIndexCommand } from "../../../src/cli/commands/documents-index-command.js";
import type { CliDependencies } from "../../../src/cli/utils/dependency-init.js";
import type { WatchedFolder } from "../../../src/services/folder-watcher-types.js";
import type { UpdateResult } from "../../../src/services/incremental-update-types.js";
import type { FileInfo } from "../../../src/ingestion/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal FileInfo for a given relative path */
function makeFileInfo(relativePath: string, ext = ".md"): FileInfo {
  return {
    relativePath,
    absolutePath: `/some/folder/${relativePath}`,
    extension: ext,
    sizeBytes: 1024,
    modifiedAt: new Date(),
  };
}

/** Create a successful UpdateResult */
function makeUpdateResult(filesAdded = 3): UpdateResult {
  return {
    stats: {
      filesAdded,
      filesModified: 0,
      filesDeleted: 0,
      chunksUpserted: filesAdded * 5,
      chunksDeleted: 0,
      durationMs: 500,
    },
    errors: [],
    filterStats: {
      totalChanges: filesAdded,
      eligibleChanges: filesAdded,
      filteredChanges: filesAdded,
      skippedChanges: 0,
    },
  };
}

/** Build a minimal CliDependencies mock for documents index tests */
function buildMockDeps(overrides?: {
  listFolders?: () => Promise<WatchedFolder[]>;
  addFolder?: (f: WatchedFolder) => Promise<void>;
  updateFolder?: (f: WatchedFolder) => Promise<void>;
  scanFiles?: (path: string, opts?: any) => Promise<FileInfo[]>;
  processChanges?: (changes: any, opts: any) => Promise<UpdateResult>;
}): CliDependencies {
  return {
    folderStore: {
      listFolders: overrides?.listFolders ?? vi.fn().mockResolvedValue([]),
      addFolder: overrides?.addFolder ?? vi.fn().mockResolvedValue(undefined),
      updateFolder: overrides?.updateFolder ?? vi.fn().mockResolvedValue(undefined),
      removeFolder: vi.fn().mockResolvedValue(undefined),
      getFolder: vi.fn().mockResolvedValue(null),
    },
    fileScanner: {
      scanFiles: overrides?.scanFiles ?? vi.fn().mockResolvedValue([]),
    },
    updatePipeline: {
      processChanges: overrides?.processChanges ?? vi.fn().mockResolvedValue(makeUpdateResult(0)),
    },
    // Remaining deps not used by this command
    repositoryService: {} as any,
    searchService: {} as any,
    ingestionService: {} as any,
    githubClient: {} as any,
    updateCoordinator: {} as any,
    tokenService: {} as any,
    chromaClient: {
      deleteCollection: vi.fn().mockResolvedValue(undefined),
    } as any,
    embeddingProvider: {} as any,
    logger: {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as any,
  } as unknown as CliDependencies;
}

// ---------------------------------------------------------------------------
// Use the project tests directory as the valid test folder (it must exist)
// ---------------------------------------------------------------------------
const VALID_FOLDER = import.meta.dir.replace(/\/commands$/, "");

describe("Documents Index Command", () => {
  // -------------------------------------------------------------------------
  // Invalid folder path
  // -------------------------------------------------------------------------

  describe("Invalid folder path", () => {
    it("should throw when folder does not exist", async () => {
      const deps = buildMockDeps();
      await expect(
        documentsIndexCommand("/nonexistent/path/that/does/not/exist", {}, deps)
      ).rejects.toThrow("Folder does not exist");
    });

    it("should throw when path is a file, not a directory", async () => {
      const deps = buildMockDeps();
      const thisFile = import.meta.path;
      await expect(documentsIndexCommand(thisFile, {}, deps)).rejects.toThrow(
        "Path is not a directory"
      );
    });
  });

  // -------------------------------------------------------------------------
  // Already-registered folder without --force
  // -------------------------------------------------------------------------

  describe("Already-registered folder", () => {
    it("should throw when folder is already registered and --force not set", async () => {
      const existingFolder: WatchedFolder = {
        id: "existing-id",
        path: VALID_FOLDER,
        name: "tests",
        enabled: true,
        includePatterns: null,
        excludePatterns: null,
        debounceMs: 2000,
        createdAt: new Date(),
        lastScanAt: null,
        fileCount: 0,
        updatedAt: null,
      };

      const deps = buildMockDeps({
        listFolders: vi.fn().mockResolvedValue([existingFolder]),
      });

      await expect(documentsIndexCommand(VALID_FOLDER, {}, deps)).rejects.toThrow(
        "already indexed"
      );
    });

    it("should proceed with --force even if folder is already registered", async () => {
      const existingFolder: WatchedFolder = {
        id: "existing-id",
        path: VALID_FOLDER,
        name: "tests",
        enabled: true,
        includePatterns: null,
        excludePatterns: null,
        debounceMs: 2000,
        createdAt: new Date(),
        lastScanAt: null,
        fileCount: 0,
        updatedAt: null,
      };

      const processChanges = vi.fn().mockResolvedValue(makeUpdateResult(1));
      const scanFiles = vi.fn().mockResolvedValue([makeFileInfo("README.md")]);
      const deps = buildMockDeps({
        listFolders: vi.fn().mockResolvedValue([existingFolder]),
        processChanges,
        scanFiles,
      });

      await expect(
        documentsIndexCommand(VALID_FOLDER, { force: true }, deps)
      ).resolves.toBeUndefined();

      expect(processChanges).toHaveBeenCalledTimes(1);
    });

    it("should call deleteCollection before re-indexing when --force on existing folder", async () => {
      const existingFolder: WatchedFolder = {
        id: "existing-id",
        path: VALID_FOLDER,
        name: "tests",
        enabled: true,
        includePatterns: null,
        excludePatterns: null,
        debounceMs: 2000,
        createdAt: new Date(),
        lastScanAt: null,
        fileCount: 0,
        updatedAt: null,
      };

      const deleteCollection = vi.fn().mockResolvedValue(undefined);
      const processChanges = vi.fn().mockResolvedValue(makeUpdateResult(1));
      const scanFiles = vi.fn().mockResolvedValue([makeFileInfo("README.md")]);
      const deps = buildMockDeps({
        listFolders: vi.fn().mockResolvedValue([existingFolder]),
        processChanges,
        scanFiles,
      });
      (deps.chromaClient as any).deleteCollection = deleteCollection;

      await documentsIndexCommand(VALID_FOLDER, { force: true }, deps);

      expect(deleteCollection).toHaveBeenCalledTimes(1);
      expect(deleteCollection).toHaveBeenCalledWith(`folder_existing-id`);
    });
  });

  // -------------------------------------------------------------------------
  // Dry run
  // -------------------------------------------------------------------------

  describe("Dry run", () => {
    it("should display files and exit without indexing when --dry-run", async () => {
      const scanFiles = vi
        .fn()
        .mockResolvedValue([makeFileInfo("notes.md"), makeFileInfo("report.pdf", ".pdf")]);
      const processChanges = vi.fn();
      const addFolder = vi.fn().mockResolvedValue(undefined);
      const deps = buildMockDeps({ scanFiles, processChanges, addFolder });

      await expect(
        documentsIndexCommand(VALID_FOLDER, { dryRun: true }, deps)
      ).resolves.toBeUndefined();

      // Should NOT have called processChanges or persisted the folder
      expect(processChanges).not.toHaveBeenCalled();
      expect(addFolder).not.toHaveBeenCalled();
    });

    it("should show no files message in dry-run when folder is empty", async () => {
      const scanFiles = vi.fn().mockResolvedValue([]);
      const processChanges = vi.fn();
      const deps = buildMockDeps({ scanFiles, processChanges });

      await expect(
        documentsIndexCommand(VALID_FOLDER, { dryRun: true }, deps)
      ).resolves.toBeUndefined();

      expect(processChanges).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Type filtering
  // -------------------------------------------------------------------------

  describe("Type filtering", () => {
    it("should pass only pdf extensions when --types pdf", async () => {
      const scanFiles = vi.fn().mockResolvedValue([]);
      const deps = buildMockDeps({ scanFiles });

      await documentsIndexCommand(VALID_FOLDER, { types: "pdf", dryRun: true }, deps);

      expect(scanFiles).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ includeExtensions: [".pdf"] })
      );
    });

    it("should pass md extensions for --types md", async () => {
      const scanFiles = vi.fn().mockResolvedValue([]);
      const deps = buildMockDeps({ scanFiles });

      await documentsIndexCommand(VALID_FOLDER, { types: "md", dryRun: true }, deps);

      expect(scanFiles).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ includeExtensions: expect.arrayContaining([".md"]) })
      );
    });

    it("should pass combined extensions for --types pdf,docx", async () => {
      const scanFiles = vi.fn().mockResolvedValue([]);
      const deps = buildMockDeps({ scanFiles });

      await documentsIndexCommand(VALID_FOLDER, { types: "pdf,docx", dryRun: true }, deps);

      const call = (scanFiles as Mock<any>).mock.calls[0];
      expect(call).toBeDefined();
      const opts = (call as any[])[1] as { includeExtensions: string[] };
      expect(opts.includeExtensions).toContain(".pdf");
      expect(opts.includeExtensions).toContain(".docx");
    });

    it("should throw on unknown type value", async () => {
      const deps = buildMockDeps();

      await expect(
        documentsIndexCommand(VALID_FOLDER, { types: "pdf,unknowntype" }, deps)
      ).rejects.toThrow("Unknown document type");
    });

    it("should use all SUPPORTED_EXTENSIONS when --types is not provided", async () => {
      const scanFiles = vi.fn().mockResolvedValue([]);
      const deps = buildMockDeps({ scanFiles });

      await documentsIndexCommand(VALID_FOLDER, { dryRun: true }, deps);

      const call = (scanFiles as Mock<any>).mock.calls[0];
      expect(call).toBeDefined();
      const opts = (call as any[])[1] as { includeExtensions: string[] };
      expect(opts.includeExtensions).toContain(".pdf");
      expect(opts.includeExtensions).toContain(".md");
      expect(opts.includeExtensions).toContain(".docx");
      expect(opts.includeExtensions).toContain(".txt");
    });
  });

  // -------------------------------------------------------------------------
  // Recursive vs. non-recursive
  // -------------------------------------------------------------------------

  describe("Recursive filtering", () => {
    it("should include only top-level files when --recursive is not set", async () => {
      const files = [
        makeFileInfo("top-level.md"),
        makeFileInfo("subdir/nested.md"),
        makeFileInfo("deep/nested/file.md"),
      ];
      const processChanges = vi.fn().mockResolvedValue(makeUpdateResult(1));
      const scanFiles = vi.fn().mockResolvedValue(files);
      const deps = buildMockDeps({ scanFiles, processChanges });

      await documentsIndexCommand(VALID_FOLDER, {}, deps);

      const changes = (processChanges as Mock<any>).mock.calls[0]?.[0] as Array<{
        path: string;
        status: string;
      }>;
      expect(changes).toBeDefined();
      // Only top-level file should be in changes
      expect(changes).toHaveLength(1);
      expect(changes[0]!.path).toBe("top-level.md");
    });

    it("should include all files when --recursive is set", async () => {
      const files = [
        makeFileInfo("top-level.md"),
        makeFileInfo("subdir/nested.md"),
        makeFileInfo("deep/nested/file.md"),
      ];
      const processChanges = vi.fn().mockResolvedValue(makeUpdateResult(3));
      const scanFiles = vi.fn().mockResolvedValue(files);
      const deps = buildMockDeps({ scanFiles, processChanges });

      await documentsIndexCommand(VALID_FOLDER, { recursive: true }, deps);

      const changes = (processChanges as Mock<any>).mock.calls[0]?.[0] as unknown[];
      expect(changes).toHaveLength(3);
    });
  });

  // -------------------------------------------------------------------------
  // Successful index with stats
  // -------------------------------------------------------------------------

  describe("Successful indexing", () => {
    it("should call processChanges with all files as 'added'", async () => {
      const files = [makeFileInfo("a.md"), makeFileInfo("b.md")];
      const processChanges = vi.fn().mockResolvedValue(makeUpdateResult(2));
      const scanFiles = vi.fn().mockResolvedValue(files);
      const deps = buildMockDeps({ scanFiles, processChanges });

      await documentsIndexCommand(VALID_FOLDER, {}, deps);

      const changes = (processChanges as Mock<any>).mock.calls[0]?.[0] as Array<{
        path: string;
        status: string;
      }>;
      expect(changes).toBeDefined();
      expect(changes).toHaveLength(2);
      for (const c of changes) {
        expect(c.status).toBe("added");
      }
    });

    it("should update folder store after successful indexing", async () => {
      const files = [makeFileInfo("notes.md")];
      const processChanges = vi.fn().mockResolvedValue(makeUpdateResult(1));
      const scanFiles = vi.fn().mockResolvedValue(files);
      const updateFolder = vi.fn().mockResolvedValue(undefined);
      const deps = buildMockDeps({ scanFiles, processChanges, updateFolder });

      await documentsIndexCommand(VALID_FOLDER, {}, deps);

      expect(updateFolder).toHaveBeenCalledTimes(1);
      const savedFolder = (updateFolder as Mock<any>).mock.calls[0]?.[0] as WatchedFolder;
      expect(savedFolder).toBeDefined();
      expect(savedFolder.fileCount).toBe(1);
      expect(savedFolder.lastScanAt).toBeInstanceOf(Date);
    });

    it("should resolve successfully with empty folder (no files)", async () => {
      const scanFiles = vi.fn().mockResolvedValue([]);
      const processChanges = vi.fn();
      const deps = buildMockDeps({ scanFiles, processChanges });

      await expect(documentsIndexCommand(VALID_FOLDER, {}, deps)).resolves.toBeUndefined();

      // No processChanges call when 0 files
      expect(processChanges).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Name defaulting
  // -------------------------------------------------------------------------

  describe("Folder name", () => {
    it("should default name to folder basename", async () => {
      const addFolder = vi.fn().mockResolvedValue(undefined);
      // scanFiles returns [] so processChanges is never needed, but addFolder is still called
      const deps = buildMockDeps({ addFolder });

      await documentsIndexCommand(VALID_FOLDER, {}, deps);

      expect(addFolder).toHaveBeenCalledTimes(1);
      const savedFolder = (addFolder as Mock<any>).mock.calls[0]?.[0] as WatchedFolder;
      expect(savedFolder).toBeDefined();
      expect(savedFolder.name).toBeTruthy();
      expect(typeof savedFolder.name).toBe("string");
    });

    it("should use --name option when provided", async () => {
      const addFolder = vi.fn().mockResolvedValue(undefined);
      // scanFiles returns [] so processChanges is never needed, but addFolder is still called
      const deps = buildMockDeps({ addFolder });

      await documentsIndexCommand(VALID_FOLDER, { name: "My Docs" }, deps);

      expect(addFolder).toHaveBeenCalledTimes(1);
      const savedFolder = (addFolder as Mock<any>).mock.calls[0]?.[0] as WatchedFolder;
      expect(savedFolder).toBeDefined();
      expect(savedFolder.name).toBe("My Docs");
    });
  });

  // -------------------------------------------------------------------------
  // Repository/collection name conventions
  // -------------------------------------------------------------------------

  describe("Naming conventions", () => {
    it("should use folder-{id} as repositoryName and folder_{id} as collectionName", async () => {
      const files = [makeFileInfo("doc.md")];
      const processChanges = vi.fn().mockResolvedValue(makeUpdateResult(1));
      const scanFiles = vi.fn().mockResolvedValue(files);
      let capturedFolderId = "";
      const addFolder = vi.fn().mockImplementation((_f: WatchedFolder) => {
        capturedFolderId = _f.id;
        return Promise.resolve();
      });
      const deps = buildMockDeps({ scanFiles, processChanges, addFolder });

      await documentsIndexCommand(VALID_FOLDER, {}, deps);

      expect(capturedFolderId).toBeTruthy();
      const callOpts = (processChanges as Mock<any>).mock.calls[0]?.[1] as {
        repository: string;
        collectionName: string;
      };
      expect(callOpts).toBeDefined();
      expect(callOpts.repository).toBe(`folder-${capturedFolderId}`);
      expect(callOpts.collectionName).toBe(`folder_${capturedFolderId}`);
    });
  });

  // -------------------------------------------------------------------------
  // Error propagation
  // -------------------------------------------------------------------------

  describe("Error handling", () => {
    it("should propagate error from processChanges", async () => {
      const files = [makeFileInfo("doc.md")];
      const processChanges = vi.fn().mockRejectedValue(new Error("Pipeline failure"));
      const scanFiles = vi.fn().mockResolvedValue(files);
      const deps = buildMockDeps({ scanFiles, processChanges });

      await expect(documentsIndexCommand(VALID_FOLDER, {}, deps)).rejects.toThrow(
        "Pipeline failure"
      );
    });

    it("should propagate error from fileScanner", async () => {
      const scanFiles = vi.fn().mockRejectedValue(new Error("Scan error"));
      const deps = buildMockDeps({ scanFiles });

      await expect(documentsIndexCommand(VALID_FOLDER, {}, deps)).rejects.toThrow("Scan error");
    });
  });
});
