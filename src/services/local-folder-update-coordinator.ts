/**
 * Incremental update coordinator for `local-folder` repositories.
 *
 * Mirrors the surface of {@link IncrementalUpdateCoordinator} —
 * `updateRepository(name)` returns the same `CoordinatorResult` — so the
 * `trigger_incremental_update` MCP tool can dispatch on `repo.source` without
 * the call site caring which backend ran.
 *
 * The git-flavored coordinator drives change detection from `git diff`
 * (against GitHub's API or `simple-git`) and treats the commit SHA as the
 * version anchor. This local-folder variant drives change detection from a
 * persisted `FileManifest` — a per-file `(sha256, size, mtime)` map — and
 * records `local-<isoDate>` markers in `UpdateHistoryEntry` instead of git
 * SHAs (the `RepositoryInfo` schema was relaxed in Phase A specifically to
 * accept these).
 *
 * Failure semantics match the git coordinator's:
 *
 *   - `drift_detected` → the registered `localPath` is missing or unreadable
 *     (user moved or deleted the folder). Recoverable via re-registration.
 *   - `no_changes`     → the change detector returned an empty diff.
 *   - `updated`        → pipeline ran; manifest rewritten; metadata advanced.
 *   - `failed`         → pipeline rejected ALL files; manifest left untouched.
 *
 * @module services/local-folder-update-coordinator
 */

import { stat } from "node:fs/promises";
import type { Logger } from "pino";
import { getComponentLogger } from "../logging/index.js";
import type {
  RepositoryMetadataService,
  RepositoryInfo,
  UpdateHistoryEntry,
} from "../repositories/types.js";
import type { IncrementalUpdatePipeline } from "./incremental-update-pipeline.js";
import { addHistoryEntry } from "../repositories/metadata-store.js";
import type { CoordinatorResult } from "./incremental-update-coordinator-types.js";
import {
  RepositoryNotFoundError,
  ConcurrentUpdateError,
} from "./incremental-update-coordinator-errors.js";
import { FileManifestStoreImpl, FILE_MANIFEST_EMPTY_GENERATED_AT } from "./file-manifest-store.js";
import { LocalFolderChangeDetector } from "./local-folder-change-detector.js";

/** Configuration accepted by the coordinator constructor. */
export interface LocalFolderCoordinatorConfig {
  /** Optional history-rotation cap, mirroring the git coordinator's option. */
  updateHistoryLimit?: number;
}

/**
 * Coordinator for incremental updates of `local-folder` repositories.
 */
export class LocalFolderUpdateCoordinator {
  private readonly logger: Logger;
  private readonly updateHistoryLimit: number;

  constructor(
    private readonly repositoryService: RepositoryMetadataService,
    private readonly updatePipeline: IncrementalUpdatePipeline,
    private readonly changeDetector: LocalFolderChangeDetector = new LocalFolderChangeDetector(),
    private readonly manifestStore: FileManifestStoreImpl = FileManifestStoreImpl.getInstance(),
    config: LocalFolderCoordinatorConfig = {}
  ) {
    this.logger = getComponentLogger("services:local-folder-update-coordinator");
    this.updateHistoryLimit = config.updateHistoryLimit ?? 50;
  }

  /**
   * Run an incremental update for a `local-folder` repository.
   *
   * Defensive against being invoked for a repo whose `source` is not
   * `local-folder` — returns a `failed` result with a descriptive error rather
   * than touching the pipeline. The dispatch in `trigger_incremental_update.ts`
   * already routes by source, but a second layer here makes the coordinator
   * safe to call directly from tests and future call sites.
   *
   * @param repositoryName - Name from `RepositoryInfo.name`.
   * @returns `CoordinatorResult` with the same shape the git coordinator emits.
   */
  async updateRepository(repositoryName: string): Promise<CoordinatorResult> {
    const startTime = Date.now();
    const logger = this.logger.child({ repository: repositoryName });

    let inProgressFlagSet = false;
    let repo: RepositoryInfo | null = null;

    try {
      repo = await this.repositoryService.getRepository(repositoryName);
      if (!repo) {
        throw new RepositoryNotFoundError(repositoryName);
      }

      if (repo.source !== "local-folder") {
        logger.warn(
          { source: repo.source },
          "LocalFolderUpdateCoordinator invoked for non-local-folder repo; refusing"
        );
        return this.failedResult(
          `Repository '${repositoryName}' has source '${repo.source}', not 'local-folder'.`,
          startTime
        );
      }

      // Concurrent-update guard mirrors the git coordinator (line 253).
      //
      // TOCTOU caveat (PR #573 review M-4): the read here and the write below
      // (`updateInProgress: true`) are separate operations. The MCP path is
      // safe because `JobTracker` and the rate limiter dedupe concurrent
      // invocations before they reach the coordinator. Direct callers (CLI
      // `pk-mcp update`, recovery) carry a small race risk: two concurrent
      // CLI invocations could both observe `updateInProgress=false`, both
      // proceed to set it to `true`, and then race the metadata writes at
      // line ~273. Manifest writes are serialized per-repo via the
      // `FileManifestStoreImpl` write queue so the index itself stays
      // consistent; the only observable effect is the LATER of the two
      // metadata writes overwriting the earlier one.
      //
      // TODO(local-folder-toctou): replace with an atomic
      // `RepositoryMetadataService.compareAndSetUpdateInProgress(name, false)`
      // once the metadata store grows that primitive. Tracked as a follow-up
      // issue separate from this PR — the CLI risk is low (single-user
      // workflow) and the MCP path is already safe.
      if (repo.updateInProgress && repo.updateStartedAt) {
        throw new ConcurrentUpdateError(repositoryName, repo.updateStartedAt);
      }

      // Drift: the registered folder is gone (user moved, renamed, or deleted it).
      // No exception — return drift_detected, the existing surface for this state.
      const localPathOk = await this.localPathExistsAsDirectory(repo.localPath);
      if (!localPathOk) {
        logger.warn(
          { localPath: repo.localPath },
          "Drift detected — registered local folder no longer exists or is not readable"
        );
        return {
          status: "drift_detected",
          stats: this.zeroStats(),
          errors: [],
          durationMs: Date.now() - startTime,
        };
      }

      // Mark in-progress so a crash mid-pipeline is recoverable on next call.
      const updateStartedAt = new Date().toISOString();
      await this.repositoryService.updateRepository({
        ...repo,
        updateInProgress: true,
        updateStartedAt,
      });
      inProgressFlagSet = true;

      // Detect changes against the prior manifest.
      const priorManifest = await this.manifestStore.loadManifest(repositoryName);
      const { changes, nextManifestFiles } = await this.changeDetector.detect(repo);

      if (changes.length === 0) {
        // No changes — clear in-progress and bail. We deliberately do NOT rewrite
        // the manifest here because nothing changed; keeping the prior generatedAt
        // makes "last update timestamp" diagnostics more meaningful.
        await this.repositoryService.updateRepository({
          ...repo,
          updateInProgress: false,
          updateStartedAt: undefined,
        });
        inProgressFlagSet = false;
        logger.info("No changes detected — local folder is up to date");
        return {
          status: "no_changes",
          stats: this.zeroStats(),
          errors: [],
          durationMs: Date.now() - startTime,
        };
      }

      // Run the existing pipeline. Its contract is source-agnostic — it consumes
      // FileChange[] without caring whether they came from git diff or a
      // manifest diff (incremental-update-pipeline.ts:161).
      const pipelineResult = await this.updatePipeline.processChanges(changes, {
        repository: repo.name,
        localPath: repo.localPath,
        collectionName: repo.collectionName,
        includeExtensions: repo.includeExtensions,
        excludePatterns: repo.excludePatterns,
      });

      const totalFilesProcessed =
        pipelineResult.stats.filesAdded +
        pipelineResult.stats.filesModified +
        pipelineResult.stats.filesDeleted;

      let historyStatus: "success" | "partial" | "failed" | "incomplete";
      if (pipelineResult.errors.length === 0) {
        historyStatus = "success";
      } else if (totalFilesProcessed === 0) {
        historyStatus = "failed";
      } else if (pipelineResult.errors.length >= totalFilesProcessed) {
        historyStatus = "failed";
      } else {
        historyStatus = "partial";
      }

      // For files the pipeline reported errors on, carry the PRIOR fingerprint
      // forward instead of the freshly-walked one. Without this, a partial
      // failure rewrites the manifest with the new (sha256, size, mtime) of an
      // errored file, so the next update sees a clean diff and never retries it
      // — silent permanent data loss in the index. If the file had no prior
      // fingerprint (it was an `added` change that errored), drop it from the
      // manifest entirely so the next walk reports it as `added` again.
      const errorPaths = new Set(pipelineResult.errors.map((e) => e.path));
      for (const errPath of errorPaths) {
        const prior = priorManifest.files[errPath];
        if (prior) {
          nextManifestFiles[errPath] = prior;
        } else {
          delete nextManifestFiles[errPath];
        }
      }

      // Rewrite the manifest ONLY if the pipeline didn't outright fail. Leaving
      // the prior manifest in place on full failure means the next update sees
      // the same diff and can retry, rather than silently advancing the
      // baseline past unprocessed files.
      const manifestRewritten = historyStatus !== "failed";
      const newManifest = this.changeDetector.buildNextManifest(repositoryName, nextManifestFiles);
      if (manifestRewritten) {
        await this.manifestStore.saveManifest(repositoryName, newManifest);
      }

      // Synthetic SHA markers per Phase A's relaxed schema. The "previous"
      // marker is the manifest we diffed against; "new" is the manifest we
      // just wrote (or would have written, if we wrote one).
      const previousMarker =
        priorManifest.generatedAt === FILE_MANIFEST_EMPTY_GENERATED_AT
          ? `local-${FILE_MANIFEST_EMPTY_GENERATED_AT}`
          : `local-${priorManifest.generatedAt}`;
      const newMarker = manifestRewritten ? `local-${newManifest.generatedAt}` : previousMarker;

      const historyEntry: UpdateHistoryEntry = {
        timestamp: new Date().toISOString(),
        previousCommit: previousMarker,
        newCommit: newMarker,
        filesAdded: pipelineResult.stats.filesAdded,
        filesModified: pipelineResult.stats.filesModified,
        filesDeleted: pipelineResult.stats.filesDeleted,
        chunksUpserted: pipelineResult.stats.chunksUpserted,
        chunksDeleted: pipelineResult.stats.chunksDeleted,
        durationMs: pipelineResult.stats.durationMs,
        errorCount: pipelineResult.errors.length,
        status: historyStatus,
        skippedFileCount: pipelineResult.filterStats.skippedChanges,
        eligibleFileCount: pipelineResult.filterStats.eligibleChanges,
        ...(pipelineResult.stats.graph && {
          graphNodesCreated: pipelineResult.stats.graph.graphNodesCreated,
          graphNodesDeleted: pipelineResult.stats.graph.graphNodesDeleted,
          graphRelationshipsCreated: pipelineResult.stats.graph.graphRelationshipsCreated,
          graphRelationshipsDeleted: pipelineResult.stats.graph.graphRelationshipsDeleted,
          graphFilesProcessed: pipelineResult.stats.graph.graphFilesProcessed,
          graphFilesSkipped: pipelineResult.stats.graph.graphFilesSkipped,
          graphErrorCount: pipelineResult.stats.graph.graphErrors.length,
        }),
      };

      const updatedHistory = addHistoryEntry(
        repo.updateHistory,
        historyEntry,
        this.updateHistoryLimit
      );

      const updatedMetadata: RepositoryInfo = {
        ...repo,
        updateHistory: updatedHistory,
        lastIncrementalUpdateAt: new Date().toISOString(),
        incrementalUpdateCount: (repo.incrementalUpdateCount || 0) + 1,
        fileCount:
          repo.fileCount + pipelineResult.stats.filesAdded - pipelineResult.stats.filesDeleted,
        chunkCount:
          repo.chunkCount +
          pipelineResult.stats.chunksUpserted -
          pipelineResult.stats.chunksDeleted,
        status: historyStatus === "failed" ? "error" : "ready",
        errorMessage:
          historyStatus === "failed"
            ? `Incremental update failed with ${pipelineResult.errors.length} error(s)`
            : undefined,
        updateInProgress: false,
        updateStartedAt: undefined,
      };

      await this.repositoryService.updateRepository(updatedMetadata);
      inProgressFlagSet = false;

      const resultStatus: CoordinatorResult["status"] =
        historyStatus === "failed" ? "failed" : "updated";

      const durationMs = Date.now() - startTime;
      logger.info(
        {
          status: resultStatus,
          filesAdded: pipelineResult.stats.filesAdded,
          filesModified: pipelineResult.stats.filesModified,
          filesDeleted: pipelineResult.stats.filesDeleted,
          durationMs,
        },
        "Local folder incremental update completed"
      );

      return {
        status: resultStatus,
        commitSha: newMarker,
        commitMessage: undefined,
        stats: pipelineResult.stats,
        errors: pipelineResult.errors,
        durationMs,
      };
    } catch (error) {
      logger.error({ err: error }, "Local folder incremental update failed with unhandled error");
      throw error;
    } finally {
      // Mirror the git coordinator's safety net: if we set the in-progress
      // flag and didn't clear it on the happy path, clear it now so the next
      // attempt isn't blocked by a stale lock.
      if (inProgressFlagSet && repo) {
        try {
          const current = await this.repositoryService.getRepository(repositoryName);
          if (current && current.updateInProgress) {
            await this.repositoryService.updateRepository({
              ...current,
              updateInProgress: false,
              updateStartedAt: undefined,
            });
          }
        } catch (cleanupErr) {
          this.logger.warn(
            { err: cleanupErr, repository: repositoryName },
            "Failed to clear in-progress flag during error cleanup"
          );
        }
      }
    }
  }

  private async localPathExistsAsDirectory(absPath: string): Promise<boolean> {
    try {
      const st = await stat(absPath);
      return st.isDirectory();
    } catch {
      return false;
    }
  }

  private zeroStats(): CoordinatorResult["stats"] {
    return {
      filesAdded: 0,
      filesModified: 0,
      filesDeleted: 0,
      chunksUpserted: 0,
      chunksDeleted: 0,
      durationMs: 0,
    };
  }

  private failedResult(message: string, startTime: number): CoordinatorResult {
    return {
      status: "failed",
      stats: this.zeroStats(),
      errors: [{ path: "(coordinator)", error: message }],
      durationMs: Date.now() - startTime,
    };
  }
}
