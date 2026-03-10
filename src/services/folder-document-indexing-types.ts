/**
 * @module services/folder-document-indexing-types
 *
 * Type definitions for the FolderDocumentIndexingService.
 *
 * This module defines interfaces for the integration service that connects
 * ChangeDetectionService → ProcessingQueue → IncrementalUpdatePipeline
 * for watched folder document indexing.
 */

import type { ProcessingQueueConfig } from "./processing-queue-types.js";

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Configuration for the FolderDocumentIndexingService.
 *
 * @example
 * ```typescript
 * const config: FolderIndexingConfig = {
 *   defaultIncludeExtensions: [".md", ".txt", ".pdf", ".docx"],
 *   defaultExcludePatterns: ["node_modules/**", ".git/**"],
 *   queueConfig: { maxBatchSize: 50, batchDelayMs: 2000 }
 * };
 * ```
 */
export interface FolderIndexingConfig {
  /**
   * Default file extensions to include when indexing folders.
   * Can be overridden per-folder via WatchedFolder.includePatterns.
   *
   * @default [".md", ".txt", ".pdf", ".docx"]
   */
  defaultIncludeExtensions?: string[];

  /**
   * Default glob patterns to exclude from indexing.
   * Can be overridden per-folder via WatchedFolder.excludePatterns.
   *
   * @default ["node_modules/**", ".git/**", "dist/**", "build/**"]
   */
  defaultExcludePatterns?: string[];

  /**
   * Configuration for the internal processing queue.
   * Controls batch size, debounce delay, retries, etc.
   */
  queueConfig?: ProcessingQueueConfig;
}

/**
 * Default configuration values for FolderDocumentIndexingService.
 */
export const DEFAULT_FOLDER_INDEXING_CONFIG: Required<
  Pick<FolderIndexingConfig, "defaultIncludeExtensions" | "defaultExcludePatterns">
> = {
  defaultIncludeExtensions: [".md", ".txt", ".pdf", ".docx"],
  defaultExcludePatterns: ["node_modules/**", ".git/**", "dist/**", "build/**"],
};

// =============================================================================
// Folder Context Types
// =============================================================================

/**
 * Maps a watched folder to its repository/collection context for ChromaDB operations.
 *
 * Each watched folder is treated as a "repository" in the incremental update pipeline,
 * with a unique collection name and stable repository identifier.
 *
 * @example
 * ```typescript
 * const context: FolderContext = {
 *   folderId: "abc-123",
 *   folderPath: "/home/user/documents",
 *   repositoryName: "folder-abc-123",
 *   collectionName: "folder_abc-123",
 *   includeExtensions: [".md", ".txt", ".pdf"],
 *   excludePatterns: ["node_modules/**"]
 * };
 * ```
 */
export interface FolderContext {
  /**
   * Unique folder identifier (from WatchedFolder.id).
   */
  folderId: string;

  /**
   * Absolute path to the watched folder on disk.
   */
  folderPath: string;

  /**
   * Repository name used in ChromaDB metadata and chunk IDs.
   * Format: `folder-{folderId}`
   */
  repositoryName: string;

  /**
   * ChromaDB collection name for this folder's indexed content.
   * Format: `folder_{folderId}`
   */
  collectionName: string;

  /**
   * File extensions to include when indexing this folder.
   * Must include the leading dot (e.g., ".md", ".pdf").
   */
  includeExtensions: string[];

  /**
   * Glob patterns to exclude from indexing.
   */
  excludePatterns: string[];
}

// =============================================================================
// Content Hash Types
// =============================================================================

/**
 * Result of comparing a file's content hash against stored chunks.
 *
 * @example
 * ```typescript
 * const result: ContentHashCheckResult = {
 *   unchanged: true,
 *   computedHash: "abc123...",
 *   storedHash: "abc123..."
 * };
 * ```
 */
export interface ContentHashCheckResult {
  /**
   * Whether the file content is unchanged (hashes match).
   */
  unchanged: boolean;

  /**
   * SHA-256 hash computed from current file content.
   */
  computedHash: string;

  /**
   * Hash stored in ChromaDB metadata for the existing chunk.
   * Null if no existing chunks were found for this file.
   */
  storedHash: string | null;
}

// =============================================================================
// Result Types
// =============================================================================

/**
 * Result of processing a batch of folder indexing changes.
 *
 * Extends the standard pipeline result with content hash optimization stats.
 *
 * @example
 * ```typescript
 * const result: FolderIndexingResult = {
 *   processedCount: 10,
 *   errorCount: 1,
 *   skippedUnchanged: 3,
 *   errors: [{ change: failedChange, error: "File not found" }]
 * };
 * ```
 */
export interface FolderIndexingResult {
  /**
   * Number of changes successfully processed (sent to pipeline).
   */
  processedCount: number;

  /**
   * Number of changes that failed processing.
   */
  errorCount: number;

  /**
   * Number of "modified" changes skipped because content hash was unchanged.
   */
  skippedUnchanged: number;

  /**
   * Details of individual change processing failures.
   */
  errors: Array<{ path: string; error: string }>;
}
