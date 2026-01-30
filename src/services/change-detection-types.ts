/**
 * @module services/change-detection-types
 *
 * Type definitions for the ChangeDetectionService.
 *
 * This module defines interfaces for detecting and categorizing file changes
 * including rename correlation from unlink+add event pairs.
 */

// =============================================================================
// Change Category Types
// =============================================================================

/**
 * Category of detected file change.
 *
 * Maps to FileChange.status from incremental-update-types:
 * - `added`: New file created
 * - `modified`: Existing file content changed
 * - `deleted`: File removed
 * - `renamed`: File moved to new location (detected via unlink+add correlation)
 */
export type ChangeCategory = "added" | "modified" | "deleted" | "renamed";

// =============================================================================
// File State Types
// =============================================================================

/**
 * Snapshot of a file's state at a point in time.
 *
 * Captured when processing file events to enable state comparisons
 * and provide context for modifications and deletions.
 *
 * @example
 * ```typescript
 * const state: FileState = {
 *   absolutePath: "C:/projects/docs/readme.md",
 *   relativePath: "docs/readme.md",
 *   sizeBytes: 1024,
 *   modifiedAt: new Date("2024-01-15T10:30:00Z"),
 *   extension: "md",
 *   capturedAt: new Date()
 * };
 * ```
 */
export interface FileState {
  /**
   * Absolute path to the file.
   */
  absolutePath: string;

  /**
   * Path relative to the watched folder.
   */
  relativePath: string;

  /**
   * File size in bytes.
   * Null if file was deleted or size could not be determined.
   */
  sizeBytes: number | null;

  /**
   * Last modification timestamp.
   * Null if file was deleted or timestamp could not be determined.
   */
  modifiedAt: Date | null;

  /**
   * File extension (lowercase, without dot).
   * @example "md", "pdf", "txt"
   */
  extension: string;

  /**
   * When this state snapshot was captured.
   */
  capturedAt: Date;
}

// =============================================================================
// Detected Change Types
// =============================================================================

/**
 * A detected file change with categorization and state information.
 *
 * Represents a processed file event with additional context including:
 * - Change categorization (add/modify/delete/rename)
 * - Current and previous file states
 * - For renames: previous path and confidence score
 *
 * Compatible with FileChange from incremental-update-types for pipeline integration.
 *
 * @example
 * ```typescript
 * // Simple addition
 * const addChange: DetectedChange = {
 *   category: "added",
 *   absolutePath: "/docs/new-file.md",
 *   relativePath: "new-file.md",
 *   extension: "md",
 *   folderId: "folder-1",
 *   folderPath: "/docs",
 *   timestamp: new Date(),
 *   currentState: { ... }
 * };
 *
 * // Detected rename
 * const renameChange: DetectedChange = {
 *   category: "renamed",
 *   absolutePath: "/docs/new-name.md",
 *   relativePath: "new-name.md",
 *   previousPath: "/docs/old-name.md",
 *   previousRelativePath: "old-name.md",
 *   extension: "md",
 *   folderId: "folder-1",
 *   folderPath: "/docs",
 *   timestamp: new Date(),
 *   currentState: { ... },
 *   previousState: { ... },
 *   renameConfidence: 0.9
 * };
 * ```
 */
export interface DetectedChange {
  /**
   * Category of the detected change.
   */
  category: ChangeCategory;

  /**
   * Absolute path to the file (current location for renames).
   */
  absolutePath: string;

  /**
   * Path relative to the watched folder (current location for renames).
   */
  relativePath: string;

  /**
   * Previous absolute path (for renames only).
   * The old path before the file was moved.
   */
  previousPath?: string;

  /**
   * Previous relative path (for renames only).
   * The old path relative to the watched folder.
   */
  previousRelativePath?: string;

  /**
   * File extension (lowercase, without dot).
   * @example "md", "pdf", "txt"
   */
  extension: string;

  /**
   * ID of the watched folder that detected this change.
   */
  folderId: string;

  /**
   * Absolute path of the watched folder.
   */
  folderPath: string;

  /**
   * When the change was detected.
   */
  timestamp: Date;

  /**
   * Current file state after the change.
   * Null for deletions (file no longer exists).
   */
  currentState: FileState | null;

  /**
   * Previous file state before the change.
   * Available for modifications, deletions, and renames (if state tracking enabled).
   */
  previousState?: FileState;

  /**
   * Confidence score for rename detection (0-1).
   * Only present for rename category:
   * - 0.9: Size match + filename match within time window
   * - 0.7: Filename match only within time window
   */
  renameConfidence?: number;
}

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Configuration options for ChangeDetectionService.
 *
 * @example
 * ```typescript
 * const config: ChangeDetectionConfig = {
 *   renameWindowMs: 500,
 *   enableStateTracking: true
 * };
 * ```
 */
export interface ChangeDetectionConfig {
  /**
   * Time window in milliseconds to correlate unlink+add as a rename.
   * If an add event for the same filename occurs within this window
   * after an unlink, it's treated as a rename.
   *
   * @default 500
   * @minimum 50
   * @maximum 5000
   */
  renameWindowMs?: number;

  /**
   * Whether to capture and track file states.
   * When enabled, provides previousState for modifications/deletions.
   * Increases memory usage proportional to number of tracked files.
   *
   * @default true
   */
  enableStateTracking?: boolean;
}

/**
 * Default configuration values for ChangeDetectionService.
 */
export const DEFAULT_CHANGE_DETECTION_CONFIG: Required<ChangeDetectionConfig> = {
  renameWindowMs: 500,
  enableStateTracking: true,
};

// =============================================================================
// Event Handler Types
// =============================================================================

/**
 * Handler function for detected changes.
 *
 * Called when the ChangeDetectionService processes a file event
 * and determines its category and state.
 *
 * @param change - The detected change with category and state information
 */
export type DetectedChangeHandler = (change: DetectedChange) => void | Promise<void>;

// =============================================================================
// Internal Types
// =============================================================================

/**
 * Pending unlink event awaiting potential rename correlation.
 *
 * @internal
 */
export interface PendingUnlink {
  /**
   * The original file event from FolderWatcherService.
   */
  absolutePath: string;

  /**
   * Path relative to the watched folder.
   */
  relativePath: string;

  /**
   * File extension.
   */
  extension: string;

  /**
   * Folder ID where the event occurred.
   */
  folderId: string;

  /**
   * Folder path where the event occurred.
   */
  folderPath: string;

  /**
   * When the unlink event was received.
   */
  timestamp: Date;

  /**
   * Timer handle for expiration.
   */
  timer: ReturnType<typeof setTimeout>;

  /**
   * Previous file state (if state tracking enabled).
   */
  previousState?: FileState;

  /**
   * File size at unlink time (for rename matching).
   */
  sizeBytes: number | null;
}
