/**
 * ChangeDetectionService - Categorizes file events with rename correlation.
 *
 * This service wraps FolderWatcherService to provide structured change detection
 * with rename correlation. It transforms raw file events (add, change, unlink)
 * into categorized changes (added, modified, deleted, renamed) with state tracking.
 *
 * @module services/change-detection-service
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Logger } from "pino";
import { getComponentLogger } from "../logging/index.js";
import type { FolderWatcherService } from "./folder-watcher-service.js";
import type { FileEvent, FileEventHandler } from "./folder-watcher-types.js";
import type {
  ChangeDetectionConfig,
  DetectedChange,
  DetectedChangeHandler,
  FileState,
  PendingUnlink,
} from "./change-detection-types.js";
import { DEFAULT_CHANGE_DETECTION_CONFIG } from "./change-detection-types.js";
import { StateTrackingError } from "./change-detection-errors.js";

/**
 * Service for detecting and categorizing file changes with rename correlation.
 *
 * Wraps FolderWatcherService to provide:
 * - Change categorization (added, modified, deleted, renamed)
 * - Rename detection via unlink+add correlation within time window
 * - File state tracking for modifications and deletions
 * - Structured DetectedChange events compatible with ingestion pipeline
 *
 * @example
 * ```typescript
 * const folderWatcher = new FolderWatcherService();
 * const changeDetection = new ChangeDetectionService(folderWatcher);
 *
 * changeDetection.onDetectedChange((change) => {
 *   console.log(`${change.category}: ${change.relativePath}`);
 *   if (change.category === "renamed") {
 *     console.log(`  from: ${change.previousRelativePath}`);
 *   }
 * });
 *
 * await folderWatcher.startWatching(folder);
 * ```
 */
export class ChangeDetectionService {
  /**
   * Lazy-initialized logger.
   */
  private _logger: Logger | null = null;

  /**
   * Reference to the wrapped FolderWatcherService.
   */
  private readonly folderWatcher: FolderWatcherService;

  /**
   * Service configuration with defaults applied.
   */
  private readonly config: Required<ChangeDetectionConfig>;

  /**
   * Registered detected change handlers.
   */
  private changeHandlers: DetectedChangeHandler[] = [];

  /**
   * File state tracking (keyed by absolute path).
   */
  private fileStates: Map<string, FileState> = new Map();

  /**
   * Pending unlink events awaiting rename correlation.
   * Keyed by correlation key (filename for same-directory, filename:parentDir for cross-directory).
   */
  private pendingUnlinks: Map<string, PendingUnlink> = new Map();

  /**
   * Bound event handler for FolderWatcherService events.
   */
  private boundEventHandler: FileEventHandler;

  /**
   * Whether the service has been disposed.
   */
  private disposed: boolean = false;

  /**
   * Create a new ChangeDetectionService.
   *
   * @param folderWatcher - FolderWatcherService to wrap
   * @param config - Optional configuration overrides
   */
  constructor(folderWatcher: FolderWatcherService, config: ChangeDetectionConfig = {}) {
    this.folderWatcher = folderWatcher;
    this.config = {
      ...DEFAULT_CHANGE_DETECTION_CONFIG,
      ...config,
    };

    // Bind and register event handler
    this.boundEventHandler = this.handleFileEvent.bind(this);
    this.folderWatcher.onFileEvent(this.boundEventHandler);
  }

  /**
   * Get the logger, initializing lazily if needed.
   */
  private get logger(): Logger {
    if (!this._logger) {
      this._logger = getComponentLogger("change-detection");
    }
    return this._logger;
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * Register a handler for detected changes.
   *
   * @param handler - Function to call when changes are detected
   */
  onDetectedChange(handler: DetectedChangeHandler): void {
    if (this.disposed) {
      throw new Error("Cannot register handler on disposed ChangeDetectionService");
    }
    this.changeHandlers.push(handler);
  }

  /**
   * Remove a previously registered change handler.
   *
   * @param handler - Handler to remove
   */
  removeChangeHandler(handler: DetectedChangeHandler): void {
    const index = this.changeHandlers.indexOf(handler);
    if (index !== -1) {
      this.changeHandlers.splice(index, 1);
    }
  }

  /**
   * Get the current state for a file (if tracked).
   *
   * @param absolutePath - Absolute path to the file
   * @returns File state or null if not tracked
   */
  getFileState(absolutePath: string): FileState | null {
    return this.fileStates.get(absolutePath) ?? null;
  }

  /**
   * Get the number of tracked file states.
   *
   * @returns Number of files being tracked
   */
  getTrackedFileCount(): number {
    return this.fileStates.size;
  }

  /**
   * Clear all tracked file states.
   *
   * Use when resetting state or before re-indexing.
   */
  clearState(): void {
    this.fileStates.clear();
    this.logger.debug("Cleared all tracked file states");
  }

  /**
   * Dispose of the service and clean up resources.
   *
   * Flushes any pending unlinks as delete events and removes
   * the event handler from the FolderWatcherService.
   */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;

    this.logger.info("Disposing ChangeDetectionService");

    // Flush all pending unlinks as deletes
    for (const [correlationKey, pending] of this.pendingUnlinks) {
      clearTimeout(pending.timer);
      this.logger.debug(
        { correlationKey, path: pending.absolutePath },
        "Flushing pending unlink as delete on dispose"
      );
      // Fire-and-forget: emitChange handles its own errors
      void this.emitDeleteChange(pending);
    }
    this.pendingUnlinks.clear();

    // Remove event handler from folder watcher
    this.folderWatcher.removeEventHandler(this.boundEventHandler);

    // Clear state
    this.fileStates.clear();
    this.changeHandlers = [];

    this.logger.info("ChangeDetectionService disposed");
  }

  // ===========================================================================
  // Event Handling
  // ===========================================================================

  /**
   * Handle a file event from FolderWatcherService.
   */
  private async handleFileEvent(event: FileEvent): Promise<void> {
    if (this.disposed) {
      return;
    }

    this.logger.debug(
      {
        type: event.type,
        path: event.relativePath,
        folderId: event.folderId,
      },
      "Processing file event"
    );

    switch (event.type) {
      case "add":
        await this.handleAddEvent(event);
        break;
      case "change":
        await this.handleChangeEvent(event);
        break;
      case "unlink":
        this.handleUnlinkEvent(event);
        break;
    }
  }

  /**
   * Handle an add event - check for rename correlation or emit as added.
   */
  private async handleAddEvent(event: FileEvent): Promise<void> {
    const pending = this.findPendingUnlink(event);

    if (pending) {
      // Found a matching unlink - this is a rename
      clearTimeout(pending.timer);
      this.pendingUnlinks.delete(this.getCorrelationKeyForPending(pending));

      this.logger.debug(
        {
          from: pending.relativePath,
          to: event.relativePath,
          folderId: event.folderId,
        },
        "Detected rename via unlink+add correlation"
      );

      await this.emitRenameChange(pending, event);
    } else {
      // No matching unlink - this is a new file
      await this.emitAddChange(event);
    }
  }

  /**
   * Handle a change event - emit as modified.
   */
  private async handleChangeEvent(event: FileEvent): Promise<void> {
    await this.emitModifyChange(event);
  }

  /**
   * Handle an unlink event - start rename window or emit delete immediately.
   */
  private handleUnlinkEvent(event: FileEvent): void {
    // Get previous state before we remove it
    const previousState = this.fileStates.get(event.absolutePath);

    // Capture file size for rename correlation (may be available from state)
    const sizeBytes = previousState?.sizeBytes ?? null;

    // Remove from state tracking
    this.fileStates.delete(event.absolutePath);

    // Create pending unlink for rename correlation
    const correlationKey = this.getCorrelationKey(event);

    const pending: PendingUnlink = {
      absolutePath: event.absolutePath,
      relativePath: event.relativePath,
      extension: event.extension,
      folderId: event.folderId,
      folderPath: event.folderPath,
      timestamp: event.timestamp,
      previousState,
      sizeBytes,
      timer: setTimeout(() => {
        // Rename window expired - emit as delete
        this.pendingUnlinks.delete(correlationKey);
        this.logger.debug(
          { path: event.relativePath, correlationKey },
          "Rename window expired, emitting as delete"
        );
        // Fire-and-forget: emitChange handles its own errors
        void this.emitDeleteChange(pending);
      }, this.config.renameWindowMs),
    };

    this.pendingUnlinks.set(correlationKey, pending);
    this.logger.debug(
      { path: event.relativePath, correlationKey, windowMs: this.config.renameWindowMs },
      "Stored pending unlink for rename correlation"
    );
  }

  // ===========================================================================
  // Correlation Key Generation
  // ===========================================================================

  /**
   * Generate a correlation key for rename detection.
   *
   * Uses filename as primary key, allowing cross-directory renames to be detected.
   */
  private getCorrelationKey(event: FileEvent): string {
    const filename = path.basename(event.absolutePath);
    // Include folderId to prevent cross-folder correlation
    return `${event.folderId}:${filename}`;
  }

  /**
   * Get the correlation key for a pending unlink.
   */
  private getCorrelationKeyForPending(pending: PendingUnlink): string {
    const filename = path.basename(pending.absolutePath);
    return `${pending.folderId}:${filename}`;
  }

  /**
   * Find a pending unlink that matches an add event.
   *
   * Matches by filename within the same watched folder.
   */
  private findPendingUnlink(event: FileEvent): PendingUnlink | null {
    const correlationKey = this.getCorrelationKey(event);
    const pending = this.pendingUnlinks.get(correlationKey);

    if (!pending) {
      return null;
    }

    // Verify same folder
    if (pending.folderId !== event.folderId) {
      return null;
    }

    // Verify within time window (should always be true since timer clears it)
    const elapsed = event.timestamp.getTime() - pending.timestamp.getTime();
    if (elapsed > this.config.renameWindowMs) {
      return null;
    }

    return pending;
  }

  // ===========================================================================
  // State Capture
  // ===========================================================================

  /**
   * Capture current file state.
   */
  private async captureFileState(event: FileEvent): Promise<FileState | null> {
    if (!this.config.enableStateTracking) {
      return null;
    }

    try {
      const stats = await fs.promises.stat(event.absolutePath);
      const state: FileState = {
        absolutePath: event.absolutePath,
        relativePath: event.relativePath,
        sizeBytes: stats.size,
        modifiedAt: stats.mtime,
        extension: event.extension,
        capturedAt: new Date(),
      };

      // Store in tracking map
      this.fileStates.set(event.absolutePath, state);

      return state;
    } catch (error) {
      // File may have been deleted between event and state capture
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.logger.debug(
          { path: event.relativePath },
          "File not found during state capture (may have been deleted)"
        );
        return null;
      }

      // Log other errors but don't throw - state is optional
      this.logger.warn(
        {
          path: event.relativePath,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to capture file state"
      );

      // Wrap in StateTrackingError for structured error handling if needed
      const trackingError = new StateTrackingError(
        event.absolutePath,
        error instanceof Error ? error.message : String(error),
        true,
        error instanceof Error ? error : undefined
      );
      this.logger.debug({ error: trackingError }, "State tracking error");

      return null;
    }
  }

  // ===========================================================================
  // Change Emission
  // ===========================================================================

  /**
   * Calculate rename confidence score.
   *
   * @param pending - The pending unlink event
   * @param addEvent - The add event
   * @returns Confidence score 0-1
   */
  private calculateRenameConfidence(pending: PendingUnlink): number {
    // Base confidence for filename match within window
    let confidence = 0.7;

    // Higher confidence if we have state and sizes match
    if (pending.sizeBytes !== null && this.config.enableStateTracking) {
      // We'll check size after capturing state
      confidence = 0.9;
    }

    return confidence;
  }

  /**
   * Emit an add change.
   */
  private async emitAddChange(event: FileEvent): Promise<void> {
    const currentState = await this.captureFileState(event);

    const change: DetectedChange = {
      category: "added",
      absolutePath: event.absolutePath,
      relativePath: event.relativePath,
      extension: event.extension,
      folderId: event.folderId,
      folderPath: event.folderPath,
      timestamp: event.timestamp,
      currentState,
    };

    await this.emitChange(change);
  }

  /**
   * Emit a modify change.
   */
  private async emitModifyChange(event: FileEvent): Promise<void> {
    // Get previous state before updating
    const previousState = this.fileStates.get(event.absolutePath);

    // Capture new state
    const currentState = await this.captureFileState(event);

    const change: DetectedChange = {
      category: "modified",
      absolutePath: event.absolutePath,
      relativePath: event.relativePath,
      extension: event.extension,
      folderId: event.folderId,
      folderPath: event.folderPath,
      timestamp: event.timestamp,
      currentState,
      previousState,
    };

    await this.emitChange(change);
  }

  /**
   * Emit a delete change.
   */
  private async emitDeleteChange(pending: PendingUnlink): Promise<void> {
    const change: DetectedChange = {
      category: "deleted",
      absolutePath: pending.absolutePath,
      relativePath: pending.relativePath,
      extension: pending.extension,
      folderId: pending.folderId,
      folderPath: pending.folderPath,
      timestamp: pending.timestamp,
      currentState: null,
      previousState: pending.previousState,
    };

    await this.emitChange(change);
  }

  /**
   * Emit a rename change.
   */
  private async emitRenameChange(pending: PendingUnlink, addEvent: FileEvent): Promise<void> {
    // Capture current state of the new location
    const currentState = await this.captureFileState(addEvent);

    // Calculate confidence based on available information
    let confidence = this.calculateRenameConfidence(pending);

    // Adjust confidence based on size match if we have both
    if (pending.sizeBytes !== null && currentState !== null && currentState.sizeBytes !== null) {
      if (pending.sizeBytes === currentState.sizeBytes) {
        confidence = 0.9; // Size match increases confidence
      } else {
        // Size differs - might be a different file with same name
        // Keep lower confidence
        confidence = 0.7;
      }
    }

    const change: DetectedChange = {
      category: "renamed",
      absolutePath: addEvent.absolutePath,
      relativePath: addEvent.relativePath,
      previousPath: pending.absolutePath,
      previousRelativePath: pending.relativePath,
      extension: addEvent.extension,
      folderId: addEvent.folderId,
      folderPath: addEvent.folderPath,
      timestamp: addEvent.timestamp,
      currentState,
      previousState: pending.previousState,
      renameConfidence: confidence,
    };

    await this.emitChange(change);
  }

  /**
   * Emit a change to all registered handlers.
   *
   * Handler errors are logged but do not stop other handlers from receiving the event.
   */
  private async emitChange(change: DetectedChange): Promise<void> {
    this.logger.debug(
      {
        category: change.category,
        path: change.relativePath,
        previousPath: change.previousRelativePath,
        folderId: change.folderId,
      },
      "Emitting detected change"
    );

    for (const handler of this.changeHandlers) {
      try {
        await handler(change);
      } catch (error) {
        this.logger.error(
          {
            category: change.category,
            path: change.relativePath,
            folderId: change.folderId,
            error: error instanceof Error ? error.message : String(error),
          },
          "Error in detected change handler"
        );
      }
    }
  }
}
