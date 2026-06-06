/**
 * Unit tests for IndexRepairService.
 *
 * Covers the three diagnosis outcomes (complete, metadata drift, missing files),
 * the targeted backfill path, and dry-run behavior, using lightweight mocks for
 * the file scanner, vector store, pipeline, and metadata service.
 */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { IndexRepairService } from "../../../src/services/index-repair-service.js";
import { initializeLogger, resetLogger } from "../../../src/logging/index.js";
import type { FileScanner } from "../../../src/ingestion/file-scanner.js";
import type { FileInfo } from "../../../src/ingestion/types.js";
import type { ChromaStorageClient } from "../../../src/storage/types.js";
import type { IncrementalUpdatePipeline } from "../../../src/services/incremental-update-pipeline.js";
import type { IndexCompletenessChecker } from "../../../src/services/index-completeness-checker.js";
import type { RepositoryMetadataService, RepositoryInfo } from "../../../src/repositories/types.js";
import type { UpdateResult } from "../../../src/services/incremental-update-types.js";
import type { CompletenessCheckResult } from "../../../src/services/index-completeness-types.js";

function makeRepo(overrides: Partial<RepositoryInfo> = {}): RepositoryInfo {
  return {
    name: "test-repo",
    source: "git-remote",
    url: "https://github.com/owner/test-repo.git",
    localPath: "/repos/test-repo",
    collectionName: "repo_test_repo",
    fileCount: 2,
    chunkCount: 10,
    lastIndexedAt: "2024-12-01T00:00:00.000Z",
    indexDurationMs: 1000,
    status: "ready",
    branch: "main",
    includeExtensions: [".ts"],
    excludePatterns: ["node_modules/**"],
    lastIndexedCommitSha: "abc123",
    lastIncrementalUpdateAt: "2024-12-01T00:00:00.000Z",
    incrementalUpdateCount: 0,
    ...overrides,
  };
}

function makeFiles(paths: string[]): FileInfo[] {
  return paths.map((p) => ({ relativePath: p })) as unknown as FileInfo[];
}

function makePipelineResult(filesAdded: number, chunksUpserted: number): UpdateResult {
  return {
    stats: {
      filesAdded,
      filesModified: 0,
      filesDeleted: 0,
      chunksUpserted,
      chunksDeleted: 0,
      durationMs: 100,
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

describe("IndexRepairService", () => {
  let fileScanner: FileScanner;
  let chromaClient: ChromaStorageClient;
  let updatePipeline: IncrementalUpdatePipeline;
  let repositoryService: RepositoryMetadataService;
  let completenessChecker: IndexCompletenessChecker;

  beforeEach(() => {
    initializeLogger({ level: "silent", format: "json" });

    fileScanner = {
      scanFiles: mock(async () => makeFiles(["a.ts", "b.ts"])),
    } as unknown as FileScanner;

    chromaClient = {
      listIndexedFilePaths: mock(async () => new Set(["a.ts", "b.ts"])),
      deleteDocumentsByFilePrefix: mock(async () => 0),
    } as unknown as ChromaStorageClient;

    updatePipeline = {
      processChanges: mock(async (changes: { path: string }[]) =>
        makePipelineResult(changes.length, changes.length * 3)
      ),
    } as unknown as IncrementalUpdatePipeline;

    repositoryService = {
      listRepositories: mock(async () => []),
      getRepository: mock(async () => null),
      updateRepository: mock(async () => {}),
      removeRepository: mock(async () => {}),
    } as unknown as RepositoryMetadataService;

    completenessChecker = {
      checkCompleteness: mock(
        async (repo: RepositoryInfo): Promise<CompletenessCheckResult> => ({
          status: "complete",
          indexedFileCount: repo.fileCount,
          eligibleFileCount: repo.fileCount,
          missingFileCount: 0,
          divergencePercent: 0,
          durationMs: 1,
        })
      ),
    } as unknown as IndexCompletenessChecker;
  });

  afterEach(() => {
    resetLogger();
  });

  function makeService(): IndexRepairService {
    return new IndexRepairService(
      fileScanner,
      chromaClient,
      updatePipeline,
      repositoryService,
      completenessChecker
    );
  }

  describe("diagnose", () => {
    it("reports complete when every eligible file is indexed and fileCount matches", async () => {
      const diagnosis = await makeService().diagnose(makeRepo({ fileCount: 2 }));

      expect(diagnosis.status).toBe("complete");
      expect(diagnosis.eligibleFileCount).toBe(2);
      expect(diagnosis.indexedFileCount).toBe(2);
      expect(diagnosis.missingFiles).toEqual([]);
    });

    it("reports metadata_drift when all files are indexed but fileCount is wrong", async () => {
      const diagnosis = await makeService().diagnose(makeRepo({ fileCount: 5 }));

      expect(diagnosis.status).toBe("metadata_drift");
      expect(diagnosis.eligibleFileCount).toBe(2);
      expect(diagnosis.indexedFileCount).toBe(2);
      expect(diagnosis.storedFileCount).toBe(5);
      expect(diagnosis.missingFiles).toEqual([]);
    });

    it("reports missing_files with the specific missing paths", async () => {
      fileScanner.scanFiles = mock(async () => makeFiles(["a.ts", "b.ts", "c.ts"]));
      chromaClient.listIndexedFilePaths = mock(async () => new Set(["a.ts", "b.ts"]));

      const diagnosis = await makeService().diagnose(makeRepo({ fileCount: 2 }));

      expect(diagnosis.status).toBe("missing_files");
      expect(diagnosis.eligibleFileCount).toBe(3);
      expect(diagnosis.indexedFileCount).toBe(2);
      expect(diagnosis.missingFiles).toEqual(["c.ts"]);
    });

    it("normalizes path separators before diffing", async () => {
      // Disk reports a backslash path; index stores posix — must still match.
      fileScanner.scanFiles = mock(async () => makeFiles(["src\\a.ts"]));
      chromaClient.listIndexedFilePaths = mock(async () => new Set(["src/a.ts"]));

      const diagnosis = await makeService().diagnose(makeRepo({ fileCount: 1 }));

      expect(diagnosis.status).toBe("complete");
      expect(diagnosis.missingFiles).toEqual([]);
    });
  });

  describe("repair", () => {
    it("does nothing when already complete", async () => {
      const result = await makeService().repair(makeRepo({ fileCount: 2 }));

      expect(result.action).toBe("none");
      expect(updatePipeline.processChanges).not.toHaveBeenCalled();
      expect(repositoryService.updateRepository).not.toHaveBeenCalled();
    });

    it("repairs metadata drift without re-embedding", async () => {
      const result = await makeService().repair(makeRepo({ fileCount: 5 }));

      expect(result.action).toBe("metadata_repaired");
      expect(updatePipeline.processChanges).not.toHaveBeenCalled();
      expect(repositoryService.updateRepository).toHaveBeenCalledTimes(1);
      const saved = (repositoryService.updateRepository as ReturnType<typeof mock>).mock
        .calls[0]?.[0] as RepositoryInfo;
      expect(saved.fileCount).toBe(2);
      expect(result.completenessAfter?.status).toBe("complete");
    });

    it("backfills only the missing files and refreshes fileCount", async () => {
      fileScanner.scanFiles = mock(async () => makeFiles(["a.ts", "b.ts", "c.ts"]));
      // First call: before backfill (missing c.ts). Second call: after backfill.
      let call = 0;
      chromaClient.listIndexedFilePaths = mock(async () => {
        call += 1;
        return call === 1 ? new Set(["a.ts", "b.ts"]) : new Set(["a.ts", "b.ts", "c.ts"]);
      });

      const result = await makeService().repair(makeRepo({ fileCount: 2 }));

      expect(result.action).toBe("backfilled");
      expect(result.filesBackfilled).toBe(1);
      expect(result.chunksUpserted).toBe(3);

      // Only the missing file was sent to the pipeline, as an "added" change.
      expect(updatePipeline.processChanges).toHaveBeenCalledTimes(1);
      const changes = (updatePipeline.processChanges as ReturnType<typeof mock>).mock
        .calls[0]?.[0] as { path: string; status: string }[];
      expect(changes).toEqual([{ path: "c.ts", status: "added" }]);

      // fileCount refreshed to the eligible count.
      const saved = (repositoryService.updateRepository as ReturnType<typeof mock>).mock
        .calls[0]?.[0] as RepositoryInfo;
      expect(saved.fileCount).toBe(3);
    });

    it("dry-run diagnoses without writing", async () => {
      fileScanner.scanFiles = mock(async () => makeFiles(["a.ts", "b.ts", "c.ts"]));
      chromaClient.listIndexedFilePaths = mock(async () => new Set(["a.ts", "b.ts"]));

      const result = await makeService().repair(makeRepo({ fileCount: 2 }), { dryRun: true });

      expect(result.status).toBe("missing_files");
      expect(result.action).toBe("none");
      expect(result.dryRun).toBe(true);
      expect(result.missingFiles).toEqual(["c.ts"]);
      expect(updatePipeline.processChanges).not.toHaveBeenCalled();
      expect(repositoryService.updateRepository).not.toHaveBeenCalled();
    });

    it("surfaces per-file errors and does not overstate filesBackfilled", async () => {
      fileScanner.scanFiles = mock(async () => makeFiles(["a.ts", "b.ts", "c.ts"]));
      let call = 0;
      chromaClient.listIndexedFilePaths = mock(async () => {
        call += 1;
        // After backfill, c.ts still failed so it is not indexed.
        return call === 1 ? new Set(["a.ts"]) : new Set(["a.ts", "b.ts"]);
      });
      // Pipeline reports b.ts succeeded but c.ts failed to embed.
      updatePipeline.processChanges = mock(async () => ({
        stats: {
          filesAdded: 1,
          filesModified: 0,
          filesDeleted: 0,
          chunksUpserted: 3,
          chunksDeleted: 0,
          durationMs: 1,
        },
        errors: [{ path: "c.ts", error: "embedding failed" }],
        filterStats: {
          totalChanges: 2,
          eligibleChanges: 2,
          filteredChanges: 2,
          skippedChanges: 0,
        },
      })) as unknown as typeof updatePipeline.processChanges;

      const result = await makeService().repair(makeRepo({ fileCount: 1 }));

      expect(result.action).toBe("backfilled");
      expect(result.filesBackfilled).toBe(1); // not 2 — c.ts failed
      expect(result.backfillErrors).toEqual(["c.ts"]);
    });

    it("deletes orphaned chunks for files removed from disk", async () => {
      // a.ts on disk and indexed; deleted.ts only in the index (orphan).
      fileScanner.scanFiles = mock(async () => makeFiles(["a.ts"]));
      let call = 0;
      chromaClient.listIndexedFilePaths = mock(async () => {
        call += 1;
        return call === 1 ? new Set(["a.ts", "deleted.ts"]) : new Set(["a.ts"]);
      });
      chromaClient.deleteDocumentsByFilePrefix = mock(async () => 4);

      const result = await makeService().repair(makeRepo({ fileCount: 2, chunkCount: 10 }));

      expect(result.status).toBe("missing_files");
      expect(result.extraFiles).toEqual(["deleted.ts"]);
      expect(chromaClient.deleteDocumentsByFilePrefix).toHaveBeenCalledWith(
        "repo_test_repo",
        "test-repo",
        "deleted.ts"
      );
      // No missing files to embed in a purely-orphan repo.
      expect(updatePipeline.processChanges).not.toHaveBeenCalled();
      // chunkCount reduced by the 4 orphan chunks removed.
      const saved = (repositoryService.updateRepository as ReturnType<typeof mock>).mock
        .calls[0]?.[0] as RepositoryInfo;
      expect(saved.chunkCount).toBe(6);
      expect(saved.fileCount).toBe(1);
    });
  });
});
