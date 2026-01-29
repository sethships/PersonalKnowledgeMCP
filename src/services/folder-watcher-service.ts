/**
 * FolderWatcherService - Monitors local folders for file changes
 *
 * This service uses chokidar to watch directories for file system events
 * (add, change, unlink) and emits events to registered handlers for
 * document ingestion processing.
 *
 * @module services/folder-watcher-service
 */

import type { FSWatcher } from "chokidar";
import chokidar from "chokidar";
import picomatch from "picomatch";
import * as path from "node:path";
import * as fs from "node:fs";
import type { Logger } from "pino";
import { getComponentLogger } from "../logging/index.js";
import type {
  WatchedFolder,
  FileEvent,
  FileEventType,
  WatcherInfo,
  WatcherStatus,
  FileEventHandler,
  ErrorHandler,
  FolderWatcherConfig,
} from "./folder-watcher-types.js";
import { DEFAULT_FOLDER_WATCHER_CONFIG } from "./folder-watcher-types.js";
import {
  FolderNotFoundError,
  FolderAlreadyWatchedError,
  FolderNotWatchedError,
  WatcherInitializationError,
  WatcherOperationError,
  MaxWatchersExceededError,
} from "./folder-watcher-errors.js";

/**
 * Internal state for a watcher
 */
interface WatcherState {
  watcher: FSWatcher;
  folder: WatchedFolder;
  status: WatcherStatus;
  filesWatched: number;
  lastEventAt: Date | null;
  error?: string;
  includeMatcher: ((path: string) => boolean) | null;
  excludeMatcher: ((path: string) => boolean) | null;
}

/**
 * Service for monitoring local folders for file changes
 *
 * Features:
 * - Watch multiple folders simultaneously
 * - Per-folder include/exclude patterns
 * - Debounced event emission
 * - Status reporting per watcher
 * - Graceful error handling
 *
 * @example
 * ```typescript
 * const watcher = new FolderWatcherService();
 *
 * watcher.onFileEvent((event) => {
 *   console.log(`File ${event.type}: ${event.relativePath}`);
 * });
 *
 * await watcher.startWatching({
 *   id: 'folder-1',
 *   path: '/path/to/watch',
 *   name: 'My Folder',
 *   enabled: true,
 *   includePatterns: ['*.md', '*.txt'],
 *   excludePatterns: ['node_modules/**'],
 *   debounceMs: 2000,
 *   createdAt: new Date(),
 *   lastScanAt: null,
 *   fileCount: 0,
 *   updatedAt: null,
 * });
 * ```
 */
export class FolderWatcherService {
  /**
   * Lazy-initialized logger
   */
  private _logger: Logger | null = null;

  /**
   * Map of folder ID to watcher state
   */
  private watchers: Map<string, WatcherState> = new Map();

  /**
   * Registered file event handlers
   */
  private eventHandlers: FileEventHandler[] = [];

  /**
   * Registered error handlers
   */
  private errorHandlers: ErrorHandler[] = [];

  /**
   * Debounce timers keyed by absolute file path
   */
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  /**
   * Pending events during debounce period (keyed by file path)
   */
  private pendingEvents: Map<string, FileEvent> = new Map();

  /**
   * Maximum pending events before warning (observability threshold)
   */
  private readonly MAX_PENDING_EVENTS = 10000;

  /**
   * Service configuration with defaults applied
   */
  private readonly config: Required<FolderWatcherConfig>;

  /**
   * Create a new FolderWatcherService
   *
   * @param config - Optional configuration overrides
   */
  constructor(config: FolderWatcherConfig = {}) {
    this.config = {
      ...DEFAULT_FOLDER_WATCHER_CONFIG,
      ...config,
    };
  }

  /**
   * Get the logger, initializing lazily if needed
   */
  private get logger(): Logger {
    if (!this._logger) {
      this._logger = getComponentLogger("folder-watcher");
    }
    return this._logger;
  }

  // ===========================================================================
  // Core Watcher Methods
  // ===========================================================================

  /**
   * Start watching a folder for file changes
   *
   * @param folder - Folder configuration
   * @throws {FolderNotFoundError} If folder path doesn't exist
   * @throws {FolderAlreadyWatchedError} If folder is already being watched
   * @throws {MaxWatchersExceededError} If max concurrent watchers reached
   * @throws {WatcherInitializationError} If watcher setup fails
   */
  async startWatching(folder: WatchedFolder): Promise<void> {
    this.logger.info({ folderId: folder.id, path: folder.path }, "Starting folder watcher");

    // Check if already watching
    if (this.watchers.has(folder.id)) {
      throw new FolderAlreadyWatchedError(folder.id, folder.path);
    }

    // Check max watchers limit
    if (this.watchers.size >= this.config.maxConcurrentWatchers) {
      throw new MaxWatchersExceededError(this.watchers.size, this.config.maxConcurrentWatchers);
    }

    // Verify folder exists and is accessible
    await this.verifyFolderAccess(folder.path);

    // Create pattern matchers
    const includeMatcher = this.createIncludeMatcher(folder.includePatterns);
    const excludeMatcher = this.createExcludeMatcher(folder.excludePatterns);

    // Create chokidar watcher
    const watcher = await this.createWatcher(folder, excludeMatcher);

    // Initialize state
    const state: WatcherState = {
      watcher,
      folder,
      status: "active",
      filesWatched: 0,
      lastEventAt: null,
      includeMatcher,
      excludeMatcher,
    };

    // Register event handlers
    this.setupWatcherEvents(watcher, folder, state);

    // Store state
    this.watchers.set(folder.id, state);

    this.logger.info(
      { folderId: folder.id, path: folder.path },
      "Folder watcher started successfully"
    );
  }

  /**
   * Stop watching a folder
   *
   * @param folderId - ID of the folder to stop watching
   * @throws {FolderNotWatchedError} If folder is not being watched
   */
  async stopWatching(folderId: string): Promise<void> {
    this.logger.info({ folderId }, "Stopping folder watcher");

    const state = this.watchers.get(folderId);
    if (!state) {
      throw new FolderNotWatchedError(folderId);
    }

    // Clean up debounce timers for this folder
    this.cleanupFolderTimers(folderId);

    // Close watcher with timeout to prevent hanging
    await Promise.race([
      state.watcher.close(),
      new Promise<void>((resolve) => {
        setTimeout(() => {
          this.logger.warn({ folderId }, "Watcher close timed out, forcing cleanup");
          resolve();
        }, 2000);
      }),
    ]);

    // Remove from map
    this.watchers.delete(folderId);

    this.logger.info({ folderId }, "Folder watcher stopped");
  }

  /**
   * Stop all active watchers
   */
  async stopAllWatchers(): Promise<void> {
    this.logger.info({ count: this.watchers.size }, "Stopping all folder watchers");

    // Clear all debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.pendingEvents.clear();

    // Close all watchers with individual timeouts to prevent hanging
    const closePromises: Promise<void>[] = [];
    for (const [folderId, state] of this.watchers.entries()) {
      const closeWithTimeout = Promise.race([
        state.watcher.close(),
        new Promise<void>((resolve) => {
          setTimeout(() => {
            this.logger.warn({ folderId }, "Watcher close timed out, forcing cleanup");
            resolve();
          }, 2000);
        }),
      ]);
      closePromises.push(closeWithTimeout);
    }

    // Use allSettled to ensure we don't hang on individual failures
    await Promise.allSettled(closePromises);

    // Clear map
    this.watchers.clear();

    this.logger.info("All folder watchers stopped");
  }

  // ===========================================================================
  // Event Handler Registration
  // ===========================================================================

  /**
   * Register a handler for file events
   *
   * @param handler - Function to call when file events occur
   */
  onFileEvent(handler: FileEventHandler): void {
    this.eventHandlers.push(handler);
  }

  /**
   * Register a handler for watcher errors
   *
   * @param handler - Function to call when errors occur
   */
  onError(handler: ErrorHandler): void {
    this.errorHandlers.push(handler);
  }

  /**
   * Remove a previously registered event handler
   *
   * @param handler - Handler to remove
   */
  removeEventHandler(handler: FileEventHandler): void {
    const index = this.eventHandlers.indexOf(handler);
    if (index !== -1) {
      this.eventHandlers.splice(index, 1);
    }
  }

  /**
   * Remove a previously registered error handler
   *
   * @param handler - Handler to remove
   */
  removeErrorHandler(handler: ErrorHandler): void {
    const index = this.errorHandlers.indexOf(handler);
    if (index !== -1) {
      this.errorHandlers.splice(index, 1);
    }
  }

  // ===========================================================================
  // Status Methods
  // ===========================================================================

  /**
   * Get status for a specific watcher
   *
   * @param folderId - ID of the folder
   * @returns Watcher info or null if not watching
   */
  getWatcherStatus(folderId: string): WatcherInfo | null {
    const state = this.watchers.get(folderId);
    if (!state) {
      return null;
    }

    return {
      folderId: state.folder.id,
      folderPath: state.folder.path,
      folderName: state.folder.name,
      status: state.status,
      filesWatched: state.filesWatched,
      lastEventAt: state.lastEventAt,
      error: state.error,
    };
  }

  /**
   * Get status for all active watchers
   *
   * @returns Array of watcher info objects
   */
  getAllWatcherStatuses(): WatcherInfo[] {
    const statuses: WatcherInfo[] = [];
    for (const state of this.watchers.values()) {
      statuses.push({
        folderId: state.folder.id,
        folderPath: state.folder.path,
        folderName: state.folder.name,
        status: state.status,
        filesWatched: state.filesWatched,
        lastEventAt: state.lastEventAt,
        error: state.error,
      });
    }
    return statuses;
  }

  /**
   * Check if a folder is being watched
   *
   * @param folderId - ID of the folder
   * @returns true if folder is being watched
   */
  isWatching(folderId: string): boolean {
    return this.watchers.has(folderId);
  }

  /**
   * Get count of active watchers
   */
  getActiveWatcherCount(): number {
    return this.watchers.size;
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Verify folder exists and is accessible
   */
  private async verifyFolderAccess(folderPath: string): Promise<void> {
    try {
      const stats = await fs.promises.stat(folderPath);
      if (!stats.isDirectory()) {
        throw new FolderNotFoundError(folderPath);
      }
    } catch (error) {
      if (error instanceof FolderNotFoundError) {
        throw error;
      }
      throw new FolderNotFoundError(folderPath);
    }
  }

  /**
   * Create include pattern matcher
   */
  private createIncludeMatcher(patterns: string[] | null): ((path: string) => boolean) | null {
    if (!patterns || patterns.length === 0) {
      return null; // No include patterns means include all
    }

    const matchers = patterns.map((pattern) => picomatch(pattern, { dot: true }));
    return (filePath: string) => {
      const basename = path.basename(filePath);
      return matchers.some((matcher) => matcher(basename) || matcher(filePath));
    };
  }

  /**
   * Create exclude pattern matcher
   */
  private createExcludeMatcher(patterns: string[] | null): ((path: string) => boolean) | null {
    if (!patterns || patterns.length === 0) {
      return null; // No exclude patterns means exclude nothing
    }

    const matchers = patterns.map((pattern) => picomatch(pattern, { dot: true }));
    return (filePath: string) => {
      const basename = path.basename(filePath);
      return matchers.some((matcher) => matcher(basename) || matcher(filePath));
    };
  }

  /**
   * Create chokidar watcher instance
   */
  private createWatcher(
    folder: WatchedFolder,
    excludeMatcher: ((path: string) => boolean) | null
  ): Promise<FSWatcher> {
    return new Promise((resolve, reject) => {
      try {
        const debounceMs = folder.debounceMs || this.config.defaultDebounceMs;

        const ignored = excludeMatcher
          ? (filePath: string) => {
              // Get path relative to the watched folder
              const relativePath = path.relative(folder.path, filePath);
              return excludeMatcher(relativePath) || excludeMatcher(path.basename(filePath));
            }
          : undefined;

        const watcher = chokidar.watch(folder.path, {
          ignored,
          persistent: true,
          ignoreInitial: !this.config.emitExistingFiles,
          awaitWriteFinish: {
            stabilityThreshold: debounceMs,
            pollInterval: 100,
          },
          usePolling: this.config.usePolling,
          interval: this.config.pollInterval,
          depth: undefined, // Watch recursively
        });

        watcher.on("ready", () => {
          resolve(watcher);
        });

        watcher.on("error", (err: unknown) => {
          const error = err instanceof Error ? err : new Error(String(err));
          reject(new WatcherInitializationError(folder.path, error.message, true, error));
        });
      } catch (error) {
        reject(
          new WatcherInitializationError(
            folder.path,
            error instanceof Error ? error.message : String(error),
            false,
            error instanceof Error ? error : undefined
          )
        );
      }
    });
  }

  /**
   * Setup event handlers on the watcher
   */
  private setupWatcherEvents(watcher: FSWatcher, folder: WatchedFolder, state: WatcherState): void {
    const handleEvent = (eventType: FileEventType) => (filePath: string) => {
      this.handleFileEvent(eventType, filePath, folder, state);
    };

    watcher.on("add", handleEvent("add"));
    watcher.on("change", handleEvent("change"));
    watcher.on("unlink", handleEvent("unlink"));

    watcher.on("error", (err: unknown) => {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.error({ folderId: folder.id, error: error.message }, "Watcher error");
      state.status = "error";
      state.error = error.message;
      this.emitError(
        new WatcherOperationError(folder.id, "watch", error.message, true, error),
        folder.id
      );
    });
  }

  /**
   * Handle a file event from chokidar
   */
  private handleFileEvent(
    type: FileEventType,
    absolutePath: string,
    folder: WatchedFolder,
    state: WatcherState
  ): void {
    // Calculate relative path
    const relativePath = path.relative(folder.path, absolutePath);

    // Apply include filter
    if (state.includeMatcher && !state.includeMatcher(relativePath)) {
      this.logger.debug(
        { folderId: folder.id, path: relativePath },
        "File excluded by include pattern"
      );
      return;
    }

    // Get file extension
    const ext = path.extname(absolutePath);
    const extension = ext ? ext.slice(1).toLowerCase() : "";

    // Create event
    const event: FileEvent = {
      type,
      absolutePath,
      relativePath,
      extension,
      folderId: folder.id,
      folderPath: folder.path,
      timestamp: new Date(),
    };

    // Update state
    state.lastEventAt = event.timestamp;
    if (type === "add") {
      state.filesWatched++;
    } else if (type === "unlink") {
      state.filesWatched = Math.max(0, state.filesWatched - 1);
    }

    // Debounce the event emission
    this.debounceEvent(event, folder);
  }

  /**
   * Debounce event emission to batch rapid changes
   */
  private debounceEvent(event: FileEvent, folder: WatchedFolder): void {
    const debounceMs = folder.debounceMs || this.config.defaultDebounceMs;

    // Warn if pending events exceed threshold (possible event storm)
    if (this.pendingEvents.size > this.MAX_PENDING_EVENTS) {
      this.logger.warn(
        { count: this.pendingEvents.size, folderId: folder.id },
        "Pending events threshold exceeded - possible event storm"
      );
    }

    // Clear existing timer for this file
    const existingTimer = this.debounceTimers.get(event.absolutePath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Store the latest event (in case of rapid changes, we use the most recent)
    this.pendingEvents.set(event.absolutePath, event);

    // Set new timer
    const timer = setTimeout(() => {
      this.debounceTimers.delete(event.absolutePath);
      const pendingEvent = this.pendingEvents.get(event.absolutePath);
      if (pendingEvent) {
        this.pendingEvents.delete(event.absolutePath);
        // Fire-and-forget: emitEvent handles its own errors via try/catch and logging.
        // We don't await here because the debounce timer callback cannot be async,
        // and handler failures should not affect the watcher's operation.
        void this.emitEvent(pendingEvent);
      }
    }, debounceMs);

    this.debounceTimers.set(event.absolutePath, timer);
  }

  /**
   * Emit event to all registered handlers
   *
   * Handler errors are logged but do not stop other handlers from receiving the event.
   * Each handler is called sequentially, and exceptions are caught and logged individually.
   */
  private async emitEvent(event: FileEvent): Promise<void> {
    this.logger.debug(
      {
        type: event.type,
        folderId: event.folderId,
        relativePath: event.relativePath,
      },
      "Emitting file event"
    );

    for (const handler of this.eventHandlers) {
      try {
        await handler(event);
      } catch (error) {
        this.logger.error(
          {
            folderId: event.folderId,
            path: event.relativePath,
            error: error instanceof Error ? error.message : String(error),
          },
          "Error in file event handler"
        );
      }
    }
  }

  /**
   * Emit error to all registered error handlers
   */
  private emitError(error: Error, folderId: string): void {
    for (const handler of this.errorHandlers) {
      try {
        handler(error, folderId);
      } catch (handlerError) {
        this.logger.error(
          {
            folderId,
            originalError: error.message,
            handlerError:
              handlerError instanceof Error ? handlerError.message : String(handlerError),
          },
          "Error in error handler"
        );
      }
    }
  }

  /**
   * Clean up debounce timers for a specific folder
   */
  private cleanupFolderTimers(folderId: string): void {
    const state = this.watchers.get(folderId);
    if (!state) return;

    // Normalize folder path for cross-platform comparison (handles mixed separators on Windows)
    const normalizedFolderPath = path.normalize(state.folder.path);

    // Find and clear timers for files in this folder
    for (const [filePath, timer] of this.debounceTimers.entries()) {
      if (path.normalize(filePath).startsWith(normalizedFolderPath)) {
        clearTimeout(timer);
        this.debounceTimers.delete(filePath);
        this.pendingEvents.delete(filePath);
      }
    }
  }

  /**
   * Check if a file should be included based on patterns
   *
   * @param relativePath - Path relative to watched folder
   * @param folder - Watched folder configuration
   * @returns true if file should be included
   */
  shouldIncludeFile(relativePath: string, folder: WatchedFolder): boolean {
    const state = this.watchers.get(folder.id);
    if (!state) {
      // If not watching, check patterns directly
      const includeMatcher = this.createIncludeMatcher(folder.includePatterns);
      const excludeMatcher = this.createExcludeMatcher(folder.excludePatterns);

      // Apply exclude filter first
      if (excludeMatcher && excludeMatcher(relativePath)) {
        return false;
      }

      // Apply include filter
      if (includeMatcher && !includeMatcher(relativePath)) {
        return false;
      }

      return true;
    }

    // Apply exclude filter first
    if (state.excludeMatcher && state.excludeMatcher(relativePath)) {
      return false;
    }

    // Apply include filter
    if (state.includeMatcher && !state.includeMatcher(relativePath)) {
      return false;
    }

    return true;
  }
}
