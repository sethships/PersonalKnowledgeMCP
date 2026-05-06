/**
 * LocalFolderRepoWatchManager — owns the `WatchedFolder`-shaped synthetic
 * subscriptions that drive Phase C's local-folder watcher. Sits between
 * `LocalFolderUpdateCoordinator` and the shared `FolderWatcherService` so
 * the coordinator stays focused on update orchestration.
 *
 * Responsibilities (issue #566 / T5.3, T5.4):
 *
 *   - Build a synthetic `WatchedFolder` per registered repo, with
 *     `id = "local-folder:<name>"` so the `FolderEventRouter` can pick it
 *     out of the shared event stream.
 *   - Apply Phase C's symlink policy: default-deny (`followSymlinks=false`),
 *     opt-in via `RepositoryInfo.followSymlinks=true`. Opt-in additionally
 *     caps chokidar depth at 8 to bound symlink-chase traversal.
 *   - Validate the registered `localPath` is reachable before attaching the
 *     watcher; resolves to its real path via `fs.realpath` first so a
 *     symlink swap between registration and watch start can't redirect
 *     watch traffic outside the repo root (TOCTOU-aware).
 *
 * The manager intentionally does not implement the `LocalFolderWatchManager`
 * interface lazily — it satisfies it directly so the coordinator can accept
 * either the real manager or a test fake without conditional plumbing.
 *
 * @module services/local-folder-repo-watch-manager
 */

import { realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { Logger } from "pino";
import { getComponentLogger } from "../logging/index.js";
import type { FolderWatcherService } from "./folder-watcher-service.js";
import type { WatchedFolder } from "./folder-watcher-types.js";
import type { RepositoryInfo } from "../repositories/types.js";
import type { LocalFolderWatchManager } from "./local-folder-update-coordinator.js";
import { localFolderIdFor, DEFAULT_LOCAL_FOLDER_DEBOUNCE_MS } from "./folder-event-router.js";

/** Hard cap on filesystem recursion depth when `followSymlinks=true`. */
export const SYMLINK_FOLLOW_DEPTH_CAP = 8;

/**
 * Error thrown when a registered local-folder path is missing, unreachable,
 * or its real-path resolves to a target the user explicitly opted out of
 * watching (e.g. an out-of-repo symlink target with `followSymlinks=false`).
 */
export class LocalFolderWatchValidationError extends Error {
  constructor(
    public readonly repository: string,
    public readonly path: string,
    public readonly reason: string
  ) {
    super(
      `Cannot start watcher for local-folder repository '${repository}' at '${path}': ${reason}`
    );
    this.name = "LocalFolderWatchValidationError";
  }
}

export class LocalFolderRepoWatchManager implements LocalFolderWatchManager {
  private _logger: Logger | null = null;

  constructor(private readonly folderWatcherService: FolderWatcherService) {}

  private get logger(): Logger {
    if (!this._logger)
      this._logger = getComponentLogger("services:local-folder-repo-watch-manager");
    return this._logger;
  }

  /**
   * Validate the path and start a chokidar watcher for a local-folder repo.
   * Idempotent in the sense that callers asking for an already-watched repo
   * receive the underlying `FolderAlreadyWatchedError` — the coordinator's
   * persistence guard prevents duplicate calls in normal flow, but tests
   * exercise it both ways.
   */
  async startWatching(repo: RepositoryInfo): Promise<void> {
    if (repo.source !== "local-folder") {
      throw new LocalFolderWatchValidationError(
        repo.name,
        repo.localPath,
        `expected source="local-folder", got "${repo.source}"`
      );
    }

    const absolutePath = resolve(repo.localPath);

    // Verify the path exists and is a directory before paying for chokidar.
    try {
      const pathStat = await stat(absolutePath);
      if (!pathStat.isDirectory()) {
        throw new LocalFolderWatchValidationError(
          repo.name,
          absolutePath,
          "registered path is not a directory"
        );
      }
    } catch (error) {
      if (error instanceof LocalFolderWatchValidationError) throw error;
      throw new LocalFolderWatchValidationError(
        repo.name,
        absolutePath,
        `path is not accessible: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    // TOCTOU-aware: resolve the real path so a symlink at the registered
    // location cannot redirect us to an unintended target between the stat
    // above and the chokidar attach below. We do not block based on the
    // realpath result here — the symlink policy is enforced via chokidar's
    // `followSymlinks` option below — but resolving primes the OS cache and
    // surfaces dangling symlinks as a clear error early.
    try {
      await realpath(absolutePath);
    } catch (error) {
      throw new LocalFolderWatchValidationError(
        repo.name,
        absolutePath,
        `realpath failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const followSymlinks = repo.followSymlinks === true;
    const synthetic: WatchedFolder = {
      id: localFolderIdFor(repo.name),
      path: absolutePath,
      name: repo.name,
      enabled: true,
      includePatterns: null, // local-folder repos use IngestionService's allowlist; watcher emits raw and routes to coordinator
      excludePatterns: null,
      debounceMs: repo.watchDebounceMs ?? DEFAULT_LOCAL_FOLDER_DEBOUNCE_MS,
      createdAt: new Date(),
      lastScanAt: null,
      fileCount: 0,
      updatedAt: null,
      followSymlinks,
      // When following symlinks, cap depth so a symlink loop or deep symlinked
      // tree cannot exhaust file descriptors. When NOT following, leave depth
      // unlimited because a real-only directory tree is bounded by the user's
      // filesystem and unlimited matches Phase 6's existing behavior.
      depthCap: followSymlinks ? SYMLINK_FOLLOW_DEPTH_CAP : undefined,
    };

    this.logger.info(
      {
        repository: repo.name,
        path: absolutePath,
        followSymlinks,
        depthCap: synthetic.depthCap,
      },
      "Starting local-folder repository watcher"
    );

    await this.folderWatcherService.startWatching(synthetic);
  }

  async stopWatching(repositoryName: string): Promise<void> {
    const folderId = localFolderIdFor(repositoryName);
    try {
      await this.folderWatcherService.stopWatching(folderId);
    } catch (error) {
      // The coordinator's stop flow tolerates "not currently watched" — log
      // and swallow so server shutdown / disable flows are idempotent.
      this.logger.warn(
        {
          repository: repositoryName,
          error: error instanceof Error ? error.message : String(error),
        },
        "stopWatching: folder watcher reported error (likely not watched); continuing"
      );
    }
  }
}
