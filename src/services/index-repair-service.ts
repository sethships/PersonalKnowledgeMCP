/**
 * Index Repair Service
 *
 * Diagnoses and repairs incomplete repository indexes without a full re-embed.
 *
 * The {@link IndexCompletenessChecker} only reports a *count* delta
 * (eligible-files-on-disk minus stored file count); it cannot tell which files
 * are missing, nor whether the gap is genuinely unindexed content or merely a
 * stale `fileCount` in repository metadata. This service closes that gap:
 *
 * 1. **Diagnose (read-only):** diff the eligible files on disk against the
 *    distinct `file_path` values actually present in the vector store.
 * 2. **Repair:**
 *    - *Metadata drift* (all eligible files indexed, but `fileCount` is wrong):
 *      correct the metadata, no embeddings.
 *    - *Missing files* (genuinely unindexed content): re-embed only those files
 *      via the incremental pipeline, then refresh `fileCount`.
 *
 * This recovers small completeness gaps cheaply instead of re-indexing the
 * entire repository with `update --force`.
 *
 * @module services/index-repair-service
 */

import type { Logger } from "pino";
import { getComponentLogger } from "../logging/index.js";
import type { FileScanner } from "../ingestion/file-scanner.js";
import type { ChromaStorageClient } from "../storage/types.js";
import type { IncrementalUpdatePipeline } from "./incremental-update-pipeline.js";
import type { IndexCompletenessChecker } from "./index-completeness-checker.js";
import type { CompletenessCheckResult } from "./index-completeness-types.js";
import type { RepositoryMetadataService, RepositoryInfo } from "../repositories/types.js";
import type { FileChange } from "./github-client-types.js";

/**
 * Classification of a repository index's completeness.
 *
 * - `complete`: every eligible file on disk is indexed and `fileCount` matches.
 * - `missing_files`: one or more eligible files are not indexed, and/or the
 *   index holds chunks for files no longer on disk (orphans). Both require a
 *   write to reconcile.
 * - `metadata_drift`: the indexed set exactly matches disk, but the stored
 *   `fileCount` is wrong (no re-embed needed to fix).
 */
export type RepairStatus = "complete" | "missing_files" | "metadata_drift";

/**
 * Read-only diagnosis of a repository index.
 */
export interface RepairDiagnosis {
  repository: string;
  status: RepairStatus;
  /** Distinct eligible files found on disk. */
  eligibleFileCount: number;
  /** Distinct files currently present in the vector store. */
  indexedFileCount: number;
  /** `fileCount` recorded in repository metadata. */
  storedFileCount: number;
  /** Eligible files on disk that are not indexed (posix-relative, sorted). */
  missingFiles: string[];
  /**
   * Indexed files no longer present on disk — orphaned chunks left by deletions
   * (posix-relative, sorted). Repair deletes these so search stops returning
   * hits for removed files.
   */
  extraFiles: string[];
}

/**
 * Action taken by a repair run.
 */
export type RepairAction = "none" | "backfilled" | "metadata_repaired";

/**
 * Result of a repair run, extending the diagnosis with what was done.
 */
export interface RepairResult extends RepairDiagnosis {
  action: RepairAction;
  /** Whether this was a diagnose-only (dry-run) invocation. */
  dryRun: boolean;
  /** Number of files that actually re-embedded (excludes per-file failures). */
  filesBackfilled: number;
  /** Chunks upserted during backfill (0 unless `action === "backfilled"`). */
  chunksUpserted: number;
  /**
   * Files that failed to embed during backfill (posix-relative paths reported
   * by the pipeline). Non-empty means the index is still incomplete and the
   * caller must not report unqualified success.
   */
  backfillErrors: string[];
  /** Completeness check re-run after a write repair, when a checker is configured. */
  completenessAfter?: CompletenessCheckResult;
}

/**
 * Options for {@link IndexRepairService.repair}.
 */
export interface RepairOptions {
  /** When true, diagnose only — make no writes. */
  dryRun?: boolean;
}

/** Normalize a path to posix separators for cross-platform comparison. */
function toPosix(p: string): string {
  return p.split("\\").join("/");
}

/**
 * Service that diagnoses and repairs incomplete repository indexes.
 */
export class IndexRepairService {
  private _logger: Logger | null = null;

  /**
   * @param fileScanner - Scans the local clone for eligible files
   * @param chromaClient - Vector store, queried for indexed file paths and backfill
   * @param updatePipeline - Re-embeds missing files (targeted backfill)
   * @param repositoryService - Persists corrected `fileCount` metadata
   * @param completenessChecker - Optional; re-validates completeness after a repair
   */
  constructor(
    private readonly fileScanner: FileScanner,
    private readonly chromaClient: ChromaStorageClient,
    private readonly updatePipeline: IncrementalUpdatePipeline,
    private readonly repositoryService: RepositoryMetadataService,
    private readonly completenessChecker?: IndexCompletenessChecker
  ) {}

  private get logger(): Logger {
    if (!this._logger) {
      this._logger = getComponentLogger("services:index-repair-service");
    }
    return this._logger;
  }

  /**
   * Diagnose a repository index without making any changes.
   *
   * @param repo - Repository metadata
   * @returns Read-only diagnosis (eligible vs indexed, missing files, status)
   */
  async diagnose(repo: RepositoryInfo): Promise<RepairDiagnosis> {
    // Eligible files on disk (relativePath is already posix-normalized).
    const eligible = await this.fileScanner.scanFiles(repo.localPath, {
      includeExtensions: repo.includeExtensions,
      excludePatterns: repo.excludePatterns,
    });
    const diskSet = new Set(eligible.map((f) => toPosix(f.relativePath)));

    // Distinct file paths currently indexed in the vector store.
    const indexedRaw = await this.chromaClient.listIndexedFilePaths(repo.collectionName, repo.name);
    const indexedSet = new Set<string>();
    for (const p of indexedRaw) {
      indexedSet.add(toPosix(p));
    }

    const missingFiles = [...diskSet].filter((p) => !indexedSet.has(p)).sort();
    const extraFiles = [...indexedSet].filter((p) => !diskSet.has(p)).sort();

    let status: RepairStatus;
    if (missingFiles.length > 0 || extraFiles.length > 0) {
      // Content is out of sync with disk (missing files and/or orphaned chunks).
      status = "missing_files";
    } else if (repo.fileCount !== diskSet.size) {
      status = "metadata_drift";
    } else {
      status = "complete";
    }

    const diagnosis: RepairDiagnosis = {
      repository: repo.name,
      status,
      eligibleFileCount: diskSet.size,
      indexedFileCount: indexedSet.size,
      storedFileCount: repo.fileCount,
      missingFiles,
      extraFiles,
    };

    this.logger.info(
      {
        repository: repo.name,
        status,
        eligibleFileCount: diagnosis.eligibleFileCount,
        indexedFileCount: diagnosis.indexedFileCount,
        storedFileCount: diagnosis.storedFileCount,
        missingFileCount: missingFiles.length,
        extraFileCount: extraFiles.length,
      },
      "Index repair diagnosis complete"
    );

    return diagnosis;
  }

  /**
   * Diagnose and (unless `dryRun`) repair a repository index.
   *
   * @param repo - Repository metadata
   * @param options - Repair options (e.g. `dryRun`)
   * @returns Repair result describing the diagnosis and any action taken
   */
  async repair(repo: RepositoryInfo, options: RepairOptions = {}): Promise<RepairResult> {
    const dryRun = options.dryRun ?? false;
    const diagnosis = await this.diagnose(repo);

    const base: RepairResult = {
      ...diagnosis,
      action: "none",
      dryRun,
      filesBackfilled: 0,
      chunksUpserted: 0,
      backfillErrors: [],
    };

    if (dryRun || diagnosis.status === "complete") {
      return base;
    }

    if (diagnosis.status === "metadata_drift") {
      // All eligible files are indexed; only the stored count is wrong.
      await this.repositoryService.updateRepository({
        ...repo,
        fileCount: diagnosis.eligibleFileCount,
      });
      this.logger.info(
        {
          repository: repo.name,
          from: diagnosis.storedFileCount,
          to: diagnosis.eligibleFileCount,
        },
        "Repaired metadata-only file count drift (no re-embed)"
      );
      return {
        ...base,
        action: "metadata_repaired",
        completenessAfter: await this.runCompletenessCheck({
          ...repo,
          fileCount: diagnosis.eligibleFileCount,
        }),
      };
    }

    // status === "missing_files": reconcile content with disk.

    // 1. Drop chunks for files removed from disk so search stops returning
    //    stale hits and the index no longer over-counts.
    let orphanChunksDeleted = 0;
    for (const path of diagnosis.extraFiles) {
      orphanChunksDeleted += await this.chromaClient.deleteDocumentsByFilePrefix(
        repo.collectionName,
        repo.name,
        path
      );
    }

    // 2. Re-embed only the missing files (if any — a purely-orphan repo has none).
    const changes: FileChange[] = diagnosis.missingFiles.map((path) => ({
      path,
      status: "added",
    }));

    let chunksUpserted = 0;
    let backfillErrors: string[] = [];
    if (changes.length > 0) {
      const pipelineResult = await this.updatePipeline.processChanges(changes, {
        repository: repo.name,
        localPath: repo.localPath,
        collectionName: repo.collectionName,
        includeExtensions: repo.includeExtensions,
        excludePatterns: repo.excludePatterns,
      });
      chunksUpserted = pipelineResult.stats.chunksUpserted;
      // FileProcessingError.path is the failed file (relative to repo root).
      backfillErrors = pipelineResult.errors.map((e) => e.path);
    }
    const succeededCount = changes.length - backfillErrors.length;

    // 3. Recompute the indexed-eligible count after reconciliation and refresh
    //    metadata (both fileCount and chunkCount, which the upsert/delete moved).
    const indexedAfter = await this.chromaClient.listIndexedFilePaths(
      repo.collectionName,
      repo.name
    );
    const indexedAfterSet = new Set<string>();
    for (const p of indexedAfter) {
      indexedAfterSet.add(toPosix(p));
    }
    const eligibleStillIndexed = diagnosis.eligibleFileCount; // disk set size is unchanged
    const newFileCount = Math.min(eligibleStillIndexed, indexedAfterSet.size);
    const newChunkCount = Math.max(0, repo.chunkCount + chunksUpserted - orphanChunksDeleted);

    const updatedRepo: RepositoryInfo = {
      ...repo,
      fileCount: newFileCount,
      chunkCount: newChunkCount,
    };
    await this.repositoryService.updateRepository(updatedRepo);

    this.logger.info(
      {
        repository: repo.name,
        filesBackfilled: succeededCount,
        backfillErrorCount: backfillErrors.length,
        chunksUpserted,
        orphanFilesDeleted: diagnosis.extraFiles.length,
        orphanChunksDeleted,
        newFileCount,
        newChunkCount,
      },
      "Reconciled index via targeted re-embed and orphan cleanup"
    );

    return {
      ...base,
      action: "backfilled",
      filesBackfilled: succeededCount,
      chunksUpserted,
      backfillErrors,
      completenessAfter: await this.runCompletenessCheck(updatedRepo),
    };
  }

  /** Run the completeness checker if one is configured, else undefined. */
  private async runCompletenessCheck(
    repo: RepositoryInfo
  ): Promise<CompletenessCheckResult | undefined> {
    if (!this.completenessChecker) {
      return undefined;
    }
    return this.completenessChecker.checkCompleteness(repo);
  }
}
