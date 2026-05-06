/**
 * FolderEventRouter — single shared subscriber for `FolderWatcherService` events
 * that dispatches to either Phase 6's document-indexing pipeline (for
 * `WatchedFolder` events) or Phase C's local-folder coordinator (for
 * `local-folder:<repo>` events). Phase C (issue #566 / T5.1).
 *
 * The router is installed alongside Phase 6's `ChangeDetectionService` rather
 * than replacing it: each subscriber inspects `event.folderId` and acts only
 * on the namespace it owns. Routing precedence:
 *
 *   1. `event.folderId` matches `LOCAL_FOLDER_ID_PREFIX` → look up the repo
 *      by the suffix, debounce per-repo, then call the local-folder dispatch.
 *   2. Otherwise → no-op (Phase 6's `ChangeDetectionService` handles it).
 *
 * Per-repo debounce coalesces noisy editor saves into a single coordinator
 * call. The debounce window is `repo.watchDebounceMs ?? DEFAULT_DEBOUNCE_MS`.
 *
 * @module services/folder-event-router
 */

import type { Logger } from "pino";
import { getComponentLogger } from "../logging/index.js";
import type { FileEvent } from "./folder-watcher-types.js";
import type { RepositoryMetadataService, RepositoryInfo } from "../repositories/types.js";

/** Synthetic `WatchedFolder.id` prefix used by Phase C local-folder repos. */
export const LOCAL_FOLDER_ID_PREFIX = "local-folder:";

/** Default per-repo debounce window in milliseconds. */
export const DEFAULT_LOCAL_FOLDER_DEBOUNCE_MS = 2000;

/**
 * Build the synthetic folder-id for a local-folder repository. The id is
 * deterministic from the repo name so restoration on server restart and
 * cross-process lookup are stable.
 */
export function localFolderIdFor(repositoryName: string): string {
  return `${LOCAL_FOLDER_ID_PREFIX}${repositoryName}`;
}

/**
 * Inverse of {@link localFolderIdFor} — returns the repo name when the id is
 * in the local-folder namespace, otherwise `null`.
 */
export function repositoryNameFromLocalFolderId(folderId: string): string | null {
  if (!folderId.startsWith(LOCAL_FOLDER_ID_PREFIX)) return null;
  return folderId.slice(LOCAL_FOLDER_ID_PREFIX.length);
}

/**
 * Function called by the router when a debounced batch of events for a
 * local-folder repo is ready to be processed. Production wires this to
 * `LocalFolderUpdateCoordinator.updateRepository(repositoryName)`.
 */
export type LocalFolderDispatch = (repository: RepositoryInfo) => void | Promise<void>;

/**
 * Optional config for the router. Tests pass overrides to shorten timers and
 * inject fakes; production accepts the defaults.
 */
export interface FolderEventRouterConfig {
  /** Default debounce window when the repo has no per-repo override. */
  defaultDebounceMs?: number;
  /**
   * Override hook for testing — returns a `setTimeout` substitute. When
   * omitted the global `setTimeout` is used.
   */
  scheduleTimeout?: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  /** Companion to `scheduleTimeout` for cancellation. Defaults to global `clearTimeout`. */
  cancelTimeout?: (handle: ReturnType<typeof setTimeout>) => void;
}

export class FolderEventRouter {
  private readonly debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly defaultDebounceMs: number;
  private readonly schedule: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  private readonly cancel: (handle: ReturnType<typeof setTimeout>) => void;
  private _logger: Logger | null = null;

  constructor(
    private readonly repositoryService: RepositoryMetadataService,
    private readonly localFolderDispatch: LocalFolderDispatch,
    config: FolderEventRouterConfig = {}
  ) {
    this.defaultDebounceMs = config.defaultDebounceMs ?? DEFAULT_LOCAL_FOLDER_DEBOUNCE_MS;
    this.schedule = config.scheduleTimeout ?? setTimeout;
    this.cancel = config.cancelTimeout ?? clearTimeout;
  }

  private get logger(): Logger {
    if (!this._logger) this._logger = getComponentLogger("services:folder-event-router");
    return this._logger;
  }

  /**
   * Bind this router as a `FolderWatcherService` subscriber.
   *
   * Returns a function reference suitable for `folderWatcherService.onFileEvent(...)`.
   * The function is bound so it is safe to subscribe and forget.
   */
  asEventHandler(): (event: FileEvent) => void {
    return (event) => {
      // Don't await — handler signature allows void. Errors from the
      // dispatch are caught and logged so a stuck dispatcher cannot kill
      // the watcher's broadcast loop.
      void this.route(event);
    };
  }

  /**
   * Route a single FileEvent. Public so tests can drive routing directly
   * without instantiating the full FolderWatcherService.
   */
  async route(event: FileEvent): Promise<void> {
    const repositoryName = repositoryNameFromLocalFolderId(event.folderId);
    if (repositoryName === null) {
      // Not a local-folder event — Phase 6's ChangeDetectionService owns it.
      return;
    }

    let repo: RepositoryInfo | null;
    try {
      repo = await this.repositoryService.getRepository(repositoryName);
    } catch (error) {
      this.logger.warn(
        {
          repository: repositoryName,
          error: error instanceof Error ? error.message : String(error),
        },
        "FolderEventRouter: metadata lookup failed; dropping event"
      );
      return;
    }

    if (!repo || repo.source !== "local-folder") {
      this.logger.warn(
        { repository: repositoryName, source: repo?.source ?? "missing" },
        "FolderEventRouter: routed local-folder id resolved to non-local-folder repo; dropping event"
      );
      return;
    }

    this.scheduleDebouncedDispatch(repo);
  }

  /**
   * Coalesce successive events for the same repo into a single dispatch.
   * The previous timer (if any) is cancelled and replaced; the dispatch
   * fires `debounceMs` after the LAST observed event.
   */
  private scheduleDebouncedDispatch(repo: RepositoryInfo): void {
    const existing = this.debounceTimers.get(repo.name);
    if (existing !== undefined) {
      this.cancel(existing);
    }

    const debounceMs = repo.watchDebounceMs ?? this.defaultDebounceMs;
    const timer = this.schedule(() => {
      this.debounceTimers.delete(repo.name);
      void Promise.resolve(this.localFolderDispatch(repo)).catch((error) => {
        this.logger.error(
          {
            repository: repo.name,
            error: error instanceof Error ? error.message : String(error),
          },
          "FolderEventRouter: localFolderDispatch threw"
        );
      });
    }, debounceMs);

    this.debounceTimers.set(repo.name, timer);
  }

  /**
   * Cancel all pending debounce timers. Used on server shutdown so we don't
   * leave timers holding refs after the watcher fleet has stopped.
   */
  shutdown(): void {
    for (const timer of this.debounceTimers.values()) {
      this.cancel(timer);
    }
    this.debounceTimers.clear();
  }
}
