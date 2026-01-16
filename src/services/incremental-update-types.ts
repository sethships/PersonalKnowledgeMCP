/**
 * Type definitions for incremental repository updates.
 *
 * @module services/incremental-update-types
 */

/**
 * Represents a file change detected between commits.
 *
 * Used to categorize how files have changed so the incremental update
 * pipeline can process them appropriately (add, update, or delete chunks).
 *
 * @example
 * ```typescript
 * const change: FileChange = {
 *   path: "src/auth/middleware.ts",
 *   status: "modified"
 * };
 * ```
 */
export interface FileChange {
  /**
   * File path relative to repository root.
   *
   * Uses POSIX separators (/) for consistency.
   *
   * @example "src/components/Button.tsx"
   */
  path: string;

  /**
   * Type of change that occurred.
   *
   * - `added`: New file created
   * - `modified`: Existing file content changed
   * - `deleted`: File removed
   * - `renamed`: File moved to new location (may also be modified)
   */
  status: "added" | "modified" | "deleted" | "renamed";

  /**
   * Previous file path for renamed files.
   *
   * Required when `status` is "renamed". Represents the old path
   * before the file was moved.
   *
   * @example "src/components/OldButton.tsx"
   */
  previousPath?: string;
}

/**
 * Configuration options for processing incremental updates.
 *
 * Provides context about the repository and filtering rules to apply
 * when processing file changes.
 *
 * @example
 * ```typescript
 * const options: UpdateOptions = {
 *   repository: "my-api",
 *   localPath: "/repos/my-api",
 *   collectionName: "repo_my_api",
 *   includeExtensions: [".ts", ".js", ".md"],
 *   excludePatterns: ["node_modules/**", "dist/**"]
 * };
 * ```
 */
export interface UpdateOptions {
  /**
   * Repository name (identifier).
   *
   * Used in chunk IDs: {repository}:{filePath}:{chunkIndex}
   *
   * @example "my-api"
   */
  repository: string;

  /**
   * Local filesystem path to repository root.
   *
   * Absolute path where the repository is cloned locally.
   * Used to construct full file paths for reading.
   *
   * @example "C:\\repos\\my-api" or "/home/user/repos/my-api"
   */
  localPath: string;

  /**
   * ChromaDB collection name.
   *
   * Target collection for storing/updating chunks.
   * Should match the collection used during initial indexing.
   *
   * @example "repo_my_api"
   */
  collectionName: string;

  /**
   * File extensions to include in processing.
   *
   * Only files with these extensions will be processed.
   * Must include the leading dot.
   *
   * **Note**: Files without extensions (e.g., `Dockerfile`, `Makefile`, `LICENSE`)
   * are not processed unless the full filename is added to `includeExtensions`.
   * For example, to process Dockerfiles, add `"Dockerfile"` to this array.
   *
   * @example [".ts", ".js", ".tsx", ".jsx", ".md"]
   * @example [".ts", ".js", ".md", "Dockerfile", "Makefile"] // Include extension-less files
   */
  includeExtensions: string[];

  /**
   * Glob patterns to exclude from processing.
   *
   * Files matching these patterns will be skipped.
   * Uses gitignore-style glob syntax.
   *
   * @example ["node_modules/**", "dist/**", "*.min.js"]
   */
  excludePatterns: string[];

  /**
   * Correlation ID for tracing operations across components.
   *
   * When provided, all log entries from the update operation will include
   * this ID, enabling end-to-end tracing through logs.
   *
   * Format: update-{timestamp}-{shortHash}
   *
   * @example "update-1734367200-a3c9f"
   */
  correlationId?: string;
}

// =============================================================================
// Graph Update Types
// =============================================================================

/**
 * Error that occurred during graph update for a specific file.
 *
 * Graph errors are non-blocking - ChromaDB updates continue even if
 * graph updates fail. Errors are collected for review and logging.
 *
 * @example
 * ```typescript
 * const error: GraphProcessingError = {
 *   path: "src/broken.ts",
 *   error: "Neo4j connection timeout",
 *   operation: "ingest"
 * };
 * ```
 */
export interface GraphProcessingError {
  /**
   * Path to the file that had a graph update error.
   */
  path: string;

  /**
   * Error message describing what went wrong.
   */
  error: string;

  /**
   * Type of graph operation that failed.
   * - `ingest`: Failed to add/update graph data for the file
   * - `delete`: Failed to delete graph data for the file
   */
  operation: "ingest" | "delete";
}

/**
 * Statistics about graph database updates during incremental processing.
 *
 * Graph updates are optional and non-blocking - if a graph service is
 * configured, these stats track graph operations alongside ChromaDB updates.
 *
 * @example
 * ```typescript
 * const graphStats: GraphUpdateStats = {
 *   graphNodesCreated: 15,
 *   graphNodesDeleted: 3,
 *   graphRelationshipsCreated: 22,
 *   graphRelationshipsDeleted: 5,
 *   graphFilesProcessed: 4,
 *   graphFilesSkipped: 2,
 *   graphErrors: []
 * };
 * ```
 */
export interface GraphUpdateStats {
  /**
   * Number of graph nodes created (File, Function, Class, Module, Chunk).
   */
  graphNodesCreated: number;

  /**
   * Number of graph nodes deleted.
   */
  graphNodesDeleted: number;

  /**
   * Number of graph relationships created (CONTAINS, DEFINES, IMPORTS, HAS_CHUNK).
   */
  graphRelationshipsCreated: number;

  /**
   * Number of graph relationships deleted.
   */
  graphRelationshipsDeleted: number;

  /**
   * Number of files that had graph data successfully processed.
   */
  graphFilesProcessed: number;

  /**
   * Number of files skipped for graph processing (non-TypeScript/JavaScript).
   */
  graphFilesSkipped: number;

  /**
   * Errors encountered during graph processing.
   * Non-empty indicates partial success with some graph update failures.
   */
  graphErrors: GraphProcessingError[];
}

// =============================================================================
// Core Update Types
// =============================================================================

/**
 * Statistics about processed incremental update.
 *
 * Tracks counts of operations performed for reporting and monitoring.
 *
 * @example
 * ```typescript
 * const stats: UpdateStats = {
 *   filesAdded: 5,
 *   filesModified: 3,
 *   filesDeleted: 1,
 *   chunksUpserted: 47,
 *   chunksDeleted: 12,
 *   durationMs: 2340
 * };
 * ```
 */
export interface UpdateStats {
  /**
   * Number of new files added.
   *
   * Files with status "added" that were successfully processed.
   */
  filesAdded: number;

  /**
   * Number of existing files modified.
   *
   * Files with status "modified" or "renamed" that were successfully processed.
   */
  filesModified: number;

  /**
   * Number of files deleted.
   *
   * Files with status "deleted" that were successfully processed.
   */
  filesDeleted: number;

  /**
   * Total number of chunks added or updated in ChromaDB.
   *
   * Includes chunks from added, modified, and renamed files.
   */
  chunksUpserted: number;

  /**
   * Total number of chunks deleted from ChromaDB.
   *
   * Includes chunks from deleted, modified, and renamed files
   * (old paths for renames, old content for modifications).
   */
  chunksDeleted: number;

  /**
   * Total processing time in milliseconds.
   *
   * Measured from start to end of processChanges() execution.
   */
  durationMs: number;

  /**
   * Graph database update statistics (optional).
   *
   * Only present when a GraphIngestionService is configured.
   * Graph updates are non-blocking - ChromaDB updates continue
   * even if graph updates fail.
   */
  graph?: GraphUpdateStats;
}

/**
 * Error that occurred while processing a specific file.
 *
 * Allows incremental updates to continue despite individual file failures.
 * All errors are collected and returned for review.
 *
 * @example
 * ```typescript
 * const error: FileProcessingError = {
 *   path: "src/broken.ts",
 *   error: "Failed to read file: ENOENT"
 * };
 * ```
 */
export interface FileProcessingError {
  /**
   * Path to the file that failed processing.
   *
   * Relative to repository root, matches FileChange.path
   *
   * @example "src/components/Button.tsx"
   */
  path: string;

  /**
   * Error message describing what went wrong.
   *
   * Human-readable description of the failure.
   *
   * @example "Failed to read file: ENOENT: no such file or directory"
   */
  error: string;
}

/**
 * Result of processing incremental update.
 *
 * Includes statistics about successful operations and any errors encountered.
 * Processing continues even if individual files fail, with all errors collected.
 *
 * @example
 * ```typescript
 * const result: UpdateResult = {
 *   stats: {
 *     filesAdded: 5,
 *     filesModified: 3,
 *     filesDeleted: 1,
 *     chunksUpserted: 47,
 *     chunksDeleted: 12,
 *     durationMs: 2340
 *   },
 *   errors: [
 *     { path: "src/broken.ts", error: "Failed to read file" }
 *   ]
 * };
 * ```
 */
export interface UpdateResult {
  /**
   * Statistics about the update operation.
   *
   * Counts of files and chunks processed successfully.
   */
  stats: UpdateStats;

  /**
   * Errors encountered during processing.
   *
   * Empty array if all files processed successfully.
   * Non-empty indicates partial success with some file failures.
   */
  errors: FileProcessingError[];
}
