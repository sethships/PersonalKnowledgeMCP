/**
 * @module services/folder-watcher-types
 *
 * Type definitions for the FolderWatcherService.
 *
 * This module defines interfaces for watching local folders and detecting
 * file changes (add, change, unlink events) for document ingestion.
 */

// =============================================================================
// Database Types (matches PostgreSQL schema from 002-phase6-watched-folders.sql)
// =============================================================================

/**
 * Watched folder entity matching PostgreSQL schema
 *
 * Represents a folder being monitored for file changes.
 */
export interface WatchedFolder {
  /**
   * Unique identifier (UUID)
   */
  id: string;

  /**
   * Absolute path to the folder being watched
   */
  path: string;

  /**
   * Display name for the folder
   */
  name: string;

  /**
   * Whether watching is enabled
   */
  enabled: boolean;

  /**
   * Glob patterns for files to include (null = all files)
   * @example ["*.md", "*.txt", "*.pdf"]
   */
  includePatterns: string[] | null;

  /**
   * Glob patterns for files to exclude
   * @example ["node_modules/**", ".git/**"]
   */
  excludePatterns: string[] | null;

  /**
   * Milliseconds to wait before processing changes
   * Allows rapid successive changes to be batched
   */
  debounceMs: number;

  /**
   * When the folder was registered for watching
   */
  createdAt: Date;

  /**
   * Last time the folder was scanned for changes
   */
  lastScanAt: Date | null;

  /**
   * Number of files currently tracked in this folder
   */
  fileCount: number;

  /**
   * Last time the folder configuration was updated
   */
  updatedAt: Date | null;
}

// =============================================================================
// File Event Types
// =============================================================================

/**
 * Type of file system event
 */
export type FileEventType = "add" | "change" | "unlink";

/**
 * File event emitted when a watched file changes
 */
export interface FileEvent {
  /**
   * Type of event
   */
  type: FileEventType;

  /**
   * Absolute path to the file
   */
  absolutePath: string;

  /**
   * Path relative to the watched folder
   */
  relativePath: string;

  /**
   * File extension (lowercase, without dot)
   * @example "md", "pdf", "txt"
   */
  extension: string;

  /**
   * ID of the watched folder that detected this event
   */
  folderId: string;

  /**
   * Absolute path of the watched folder
   */
  folderPath: string;

  /**
   * When the event was detected
   */
  timestamp: Date;
}

// =============================================================================
// Watcher Status Types
// =============================================================================

/**
 * Status of a folder watcher
 */
export type WatcherStatus = "active" | "paused" | "error" | "stopped";

/**
 * Information about a running watcher
 */
export interface WatcherInfo {
  /**
   * ID of the watched folder
   */
  folderId: string;

  /**
   * Absolute path of the watched folder
   */
  folderPath: string;

  /**
   * Display name of the folder
   */
  folderName: string;

  /**
   * Current watcher status
   */
  status: WatcherStatus;

  /**
   * Number of files being watched
   */
  filesWatched: number;

  /**
   * When the last file event was detected
   */
  lastEventAt: Date | null;

  /**
   * Error message if status is "error"
   */
  error?: string;
}

// =============================================================================
// Event Handler Types
// =============================================================================

/**
 * Handler function for file events
 *
 * @param event - The file event that occurred
 */
export type FileEventHandler = (event: FileEvent) => void | Promise<void>;

/**
 * Handler function for watcher errors
 *
 * @param error - The error that occurred
 * @param folderId - ID of the folder where the error occurred
 */
export type ErrorHandler = (error: Error, folderId: string) => void;

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Configuration options for FolderWatcherService
 */
export interface FolderWatcherConfig {
  /**
   * Default debounce time in milliseconds for folders without explicit debounce
   * @default 2000
   */
  defaultDebounceMs?: number;

  /**
   * Maximum number of concurrent watchers
   * @default 10
   */
  maxConcurrentWatchers?: number;

  /**
   * Use polling mode for file watching
   * Required for network drives and some file systems
   * @default false
   */
  usePolling?: boolean;

  /**
   * Polling interval in milliseconds (only used when usePolling is true)
   * @default 100
   */
  pollInterval?: number;

  /**
   * Whether to emit events for existing files when starting to watch
   * @default false
   */
  emitExistingFiles?: boolean;
}

/**
 * Default configuration values
 */
export const DEFAULT_FOLDER_WATCHER_CONFIG: Required<FolderWatcherConfig> = {
  defaultDebounceMs: 2000,
  maxConcurrentWatchers: 10,
  usePolling: false,
  pollInterval: 100,
  emitExistingFiles: false,
};
