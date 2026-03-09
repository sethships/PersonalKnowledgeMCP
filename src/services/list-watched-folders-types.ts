/**
 * Type definitions for ListWatchedFoldersService
 *
 * This module defines the interfaces for the list_watched_folders MCP tool,
 * which combines watcher status with folder metadata to provide a comprehensive
 * view of watched folder configuration and state.
 *
 * @module services/list-watched-folders-types
 */

import type { WatcherStatus } from "./folder-watcher-types.js";

/**
 * Individual watched folder entry in the response
 *
 * Combines data from the WatchedFolder entity and WatcherInfo status
 * to provide a complete picture for MCP clients.
 */
export interface WatchedFolderEntry {
  /** Unique identifier (UUID) */
  id: string;

  /** Display name for the folder */
  name: string;

  /** Absolute path to the folder being watched */
  path: string;

  /** Whether watching is enabled */
  enabled: boolean;

  /** Number of documents indexed from this folder */
  documentCount: number;

  /** Number of images indexed from this folder */
  imageCount: number;

  /** Last time the folder was scanned for changes */
  lastScanAt?: Date;

  /** Current watcher status */
  watcherStatus: WatcherStatus;

  /** Glob patterns for files to include */
  includePatterns: string[];

  /** Glob patterns for files to exclude */
  excludePatterns: string[];
}

/**
 * Response for list_watched_folders MCP tool
 */
export interface ListWatchedFoldersResponse {
  /** Array of watched folder entries */
  folders: WatchedFolderEntry[];
}

/**
 * ListWatchedFoldersService interface for listing watched folders
 */
export interface ListWatchedFoldersService {
  /**
   * List all configured watched folders and their current status
   *
   * @returns Response containing all watched folders with status information
   */
  listWatchedFolders(): Promise<ListWatchedFoldersResponse>;
}
