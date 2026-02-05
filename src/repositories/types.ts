/**
 * Repository metadata management types and interfaces
 *
 * Defines core interfaces for repository service operations, repository metadata,
 * and integration with the knowledge base indexing system.
 *
 * @module repositories/types
 */

/**
 * Repository status indicator
 *
 * Represents the current state of a repository in the knowledge base:
 * - `ready`: Repository is fully indexed and available for search
 * - `indexing`: Repository is currently being indexed
 * - `error`: Indexing failed with an error
 */
export type RepositoryStatus = "ready" | "indexing" | "error";

/**
 * Complete metadata for an indexed repository
 *
 * Tracks all information about a repository including its location,
 * indexing status, statistics, and configuration.
 *
 * @example
 * ```typescript
 * const repoInfo: RepositoryInfo = {
 *   name: "my-api",
 *   url: "https://github.com/user/my-api.git",
 *   localPath: "./data/repos/my-api",
 *   collectionName: "repo_my_api",
 *   fileCount: 150,
 *   chunkCount: 450,
 *   lastIndexedAt: "2024-12-11T10:30:00.000Z",
 *   indexDurationMs: 5000,
 *   status: "ready",
 *   branch: "main",
 *   includeExtensions: [".ts", ".js", ".md"],
 *   excludePatterns: ["node_modules/**", "dist/**"],
 *   // Incremental update fields (optional)
 *   lastIndexedCommitSha: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
 *   lastIncrementalUpdateAt: "2024-12-12T14:00:00.000Z",
 *   incrementalUpdateCount: 3
 * };
 * ```
 */
export interface RepositoryInfo {
  /**
   * Unique repository identifier
   *
   * Typically derived from the repository name (slugified).
   * Used as the key in the metadata store.
   *
   * @example "my-api", "frontend-app", "docs-site"
   */
  name: string;

  /**
   * Original git clone URL
   *
   * The URL used to clone the repository.
   * Can be HTTPS or SSH format.
   *
   * @example "https://github.com/user/repo.git"
   * @example "git@github.com:user/repo.git"
   */
  url: string;

  /**
   * Absolute path where repository is cloned locally
   *
   * Points to the directory containing the cloned repository.
   *
   * @example "./data/repos/my-api"
   * @example "/home/user/data/repos/my-api"
   */
  localPath: string;

  /**
   * ChromaDB collection name for this repository
   *
   * Sanitized collection name following ChromaDB naming requirements.
   * Format: `repo_{sanitized_name}` where sanitized_name contains only
   * lowercase alphanumerics and underscores.
   *
   * @example "repo_my_api"
   * @example "repo_frontend_app"
   */
  collectionName: string;

  /**
   * Number of files indexed from this repository
   *
   * Count of all files that were processed and indexed.
   *
   * @example 150
   */
  fileCount: number;

  /**
   * Total number of chunks created from indexed files
   *
   * Files are split into chunks for embedding. This is the total
   * number of chunks across all indexed files.
   *
   * @example 450
   */
  chunkCount: number;

  /**
   * ISO 8601 timestamp of when repository was last indexed
   *
   * Records when the most recent indexing operation completed.
   *
   * @example "2024-12-11T10:30:00.000Z"
   */
  lastIndexedAt: string;

  /**
   * Duration of last indexing operation in milliseconds
   *
   * Tracks how long it took to index the repository,
   * useful for performance monitoring.
   *
   * @example 5000 (5 seconds)
   */
  indexDurationMs: number;

  /**
   * Current status of the repository
   *
   * Indicates whether the repository is ready for search,
   * currently being indexed, or encountered an error.
   */
  status: RepositoryStatus;

  /**
   * Error message if status is "error"
   *
   * Only present when status is "error". Contains details
   * about what went wrong during indexing.
   *
   * @example "Failed to clone repository: authentication required"
   */
  errorMessage?: string;

  /**
   * Git branch that was indexed
   *
   * The branch name that was checked out and indexed.
   *
   * @example "main", "master", "develop"
   */
  branch: string;

  /**
   * File extensions to include in indexing
   *
   * Array of file extensions (with leading dot) that should be
   * indexed. Files not matching these extensions are skipped.
   *
   * @example [".ts", ".js", ".md"]
   */
  includeExtensions: string[];

  /**
   * Glob patterns for paths to exclude from indexing
   *
   * Array of glob patterns. Files matching these patterns
   * are excluded from indexing.
   *
   * @example ["node_modules/**", "dist/**", "*.test.ts"]
   */
  excludePatterns: string[];

  // ─────────────────────────────────────────────────────────────────────────────
  // Embedding Provider Fields (Optional)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Embedding provider used for this repository
   *
   * Records which provider was used to generate embeddings.
   * Important for ensuring consistent search quality when
   * querying or updating the repository.
   *
   * @example "openai", "transformersjs", "ollama"
   */
  embeddingProvider?: string;

  /**
   * Embedding model used for this repository
   *
   * Records the specific model used to generate embeddings.
   * Different models produce embeddings of different quality
   * and dimensions.
   *
   * @example "text-embedding-3-small", "all-MiniLM-L6-v2", "nomic-embed-text"
   */
  embeddingModel?: string;

  /**
   * Embedding dimensions for this repository
   *
   * Records the vector dimensions of the embeddings stored
   * in ChromaDB for this repository. Required for compatibility
   * checks when searching or updating.
   *
   * @example 1536, 384, 768
   */
  embeddingDimensions?: number;

  // ─────────────────────────────────────────────────────────────────────────────
  // Incremental Update Fields (Optional)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Git commit SHA of the last indexed state
   *
   * Stores the full 40-character SHA of the commit that was indexed.
   * Used to determine what has changed since the last indexing operation
   * for incremental updates.
   *
   * @example "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"
   */
  lastIndexedCommitSha?: string;

  /**
   * ISO 8601 timestamp of the last incremental update
   *
   * Records when the most recent incremental (not full) indexing
   * operation completed. Null/undefined for repositories that have
   * only had full indexes.
   *
   * @example "2024-12-14T10:30:00.000Z"
   */
  lastIncrementalUpdateAt?: string;

  /**
   * Count of incremental updates since last full index
   *
   * Tracks how many incremental updates have been applied since
   * the last full re-index. Useful for determining when a full
   * re-index might be beneficial (e.g., after 50+ incremental updates).
   * Resets to 0 on full re-index.
   *
   * @example 5
   */
  incrementalUpdateCount?: number;

  /**
   * History of incremental update operations
   *
   * Records details of past update operations for auditing and troubleshooting.
   * Newest entries first (index 0 = most recent update).
   * Automatically rotated when limit exceeded (configured via UPDATE_HISTORY_LIMIT).
   *
   * @example [{ timestamp: "2024-12-14T15:30:00.000Z", previousCommit: "abc...", newCommit: "def...", ... }]
   */
  updateHistory?: UpdateHistoryEntry[];

  // ─────────────────────────────────────────────────────────────────────────────
  // Update State Tracking (for crash recovery)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Whether an update operation is currently in progress
   *
   * Set to `true` at the start of an update operation (incremental or full re-index),
   * cleared to `false` (or removed) when the operation completes. If the service
   * crashes during an update, this flag will remain `true` and can be detected
   * on next startup to warn about potential data inconsistency.
   *
   * @example true (update in progress), false/undefined (no update in progress)
   */
  updateInProgress?: boolean;

  /**
   * ISO 8601 timestamp when the current update operation started
   *
   * Set when `updateInProgress` is set to `true`. Used to determine how long
   * an update has been in progress and to identify stale/interrupted updates.
   * Cleared when the update operation completes.
   *
   * @example "2024-12-14T15:30:00.000Z"
   */
  updateStartedAt?: string;
}

/**
 * Record of a single incremental update operation
 *
 * Captures comprehensive statistics and metadata about a repository update,
 * enabling audit trails and troubleshooting of update operations.
 *
 * @example
 * ```typescript
 * const entry: UpdateHistoryEntry = {
 *   timestamp: "2024-12-14T15:30:00.000Z",
 *   previousCommit: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
 *   newCommit: "b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3",
 *   filesAdded: 3,
 *   filesModified: 5,
 *   filesDeleted: 1,
 *   chunksUpserted: 47,
 *   chunksDeleted: 12,
 *   durationMs: 2340,
 *   errorCount: 0,
 *   status: 'success'
 * };
 * ```
 */
export interface UpdateHistoryEntry {
  /**
   * ISO 8601 timestamp when the update operation completed
   *
   * @example "2024-12-14T15:30:00.000Z"
   */
  timestamp: string;

  /**
   * Git commit SHA before the update (40 characters)
   *
   * The commit that was indexed prior to this update operation.
   *
   * @example "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"
   */
  previousCommit: string;

  /**
   * Git commit SHA after the update (40 characters)
   *
   * The new HEAD commit that was indexed by this update operation.
   *
   * @example "b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3"
   */
  newCommit: string;

  /**
   * Count of files added in this update
   *
   * @example 3
   */
  filesAdded: number;

  /**
   * Count of files modified in this update
   *
   * @example 5
   */
  filesModified: number;

  /**
   * Count of files deleted in this update
   *
   * @example 1
   */
  filesDeleted: number;

  /**
   * Total number of chunks added or updated in ChromaDB
   *
   * @example 47
   */
  chunksUpserted: number;

  /**
   * Total number of chunks deleted from ChromaDB
   *
   * @example 12
   */
  chunksDeleted: number;

  /**
   * Duration of the pipeline processing in milliseconds
   *
   * Time spent processing file changes, excluding git operations
   * and GitHub API calls.
   *
   * @example 2340
   */
  durationMs: number;

  /**
   * Number of file processing errors encountered
   *
   * Files that failed to process due to errors (parsing, embedding, storage).
   *
   * @example 0
   */
  errorCount: number;

  /**
   * Overall status of the update operation
   *
   * - `success`: No errors, all files processed successfully
   * - `partial`: Some files failed, but some succeeded
   * - `failed`: All files failed or critical failure occurred
   */
  status: "success" | "partial" | "failed";

  // ─────────────────────────────────────────────────────────────────────────────
  // Optional Graph Statistics (present when graph service is configured)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Number of graph nodes created (File, Function, Class, Module, Chunk).
   *
   * @example 15
   */
  graphNodesCreated?: number;

  /**
   * Number of graph nodes deleted.
   *
   * @example 3
   */
  graphNodesDeleted?: number;

  /**
   * Number of graph relationships created (CONTAINS, DEFINES, IMPORTS, HAS_CHUNK).
   *
   * @example 22
   */
  graphRelationshipsCreated?: number;

  /**
   * Number of graph relationships deleted.
   *
   * @example 5
   */
  graphRelationshipsDeleted?: number;

  /**
   * Number of files that had graph data successfully processed.
   *
   * @example 4
   */
  graphFilesProcessed?: number;

  /**
   * Number of files skipped for graph processing (unsupported language).
   *
   * @example 2
   */
  graphFilesSkipped?: number;

  /**
   * Number of errors encountered during graph processing.
   *
   * @example 0
   */
  graphErrorCount?: number;
}

/**
 * Core service interface for repository metadata management
 *
 * Provides abstraction for all repository metadata operations including
 * listing, retrieving, updating, and removing repository records.
 *
 * Implementations should ensure thread-safety for concurrent operations
 * and handle file I/O errors gracefully.
 *
 * @example
 * ```typescript
 * const service: RepositoryMetadataService = RepositoryMetadataStoreImpl.getInstance();
 *
 * // List all repositories
 * const repos = await service.listRepositories();
 *
 * // Get specific repository
 * const repo = await service.getRepository("my-api");
 *
 * // Update repository metadata
 * await service.updateRepository({
 *   ...repo,
 *   status: "ready",
 *   fileCount: 200
 * });
 *
 * // Remove repository
 * await service.removeRepository("my-api");
 * ```
 */
export interface RepositoryMetadataService {
  /**
   * List all repositories in the knowledge base
   *
   * Returns metadata for all repositories that have been indexed.
   * The returned array may be empty if no repositories are indexed.
   *
   * @returns Array of repository metadata objects
   * @throws {FileOperationError} If metadata file cannot be read
   * @throws {InvalidMetadataFormatError} If metadata file is corrupted
   *
   * @example
   * ```typescript
   * const repos = await service.listRepositories();
   * console.log(`Found ${repos.length} repositories`);
   * repos.forEach(repo => {
   *   console.log(`${repo.name}: ${repo.status} (${repo.fileCount} files)`);
   * });
   * ```
   */
  listRepositories(): Promise<RepositoryInfo[]>;

  /**
   * Get metadata for a specific repository
   *
   * Retrieves the metadata for a repository by its name.
   * Returns `null` if the repository is not found.
   *
   * @param name - Unique repository identifier
   * @returns Repository metadata if found, null otherwise
   * @throws {FileOperationError} If metadata file cannot be read
   * @throws {InvalidMetadataFormatError} If metadata file is corrupted
   *
   * @example
   * ```typescript
   * const repo = await service.getRepository("my-api");
   * if (repo) {
   *   console.log(`Status: ${repo.status}`);
   * } else {
   *   console.log("Repository not found");
   * }
   * ```
   */
  getRepository(name: string): Promise<RepositoryInfo | null>;

  /**
   * Add or update repository metadata
   *
   * If a repository with the given name already exists, its metadata
   * is updated. Otherwise, a new repository record is created.
   *
   * The operation is atomic - either all metadata is saved successfully
   * or the entire operation fails.
   *
   * @param info - Complete repository metadata to save
   * @throws {FileOperationError} If metadata file cannot be written
   *
   * @example
   * ```typescript
   * await service.updateRepository({
   *   name: "my-api",
   *   url: "https://github.com/user/my-api.git",
   *   localPath: "./data/repos/my-api",
   *   collectionName: "repo_my_api",
   *   fileCount: 150,
   *   chunkCount: 450,
   *   lastIndexedAt: new Date().toISOString(),
   *   indexDurationMs: 5000,
   *   status: "ready",
   *   branch: "main",
   *   includeExtensions: [".ts", ".js"],
   *   excludePatterns: ["node_modules/**"]
   * });
   * ```
   */
  updateRepository(info: RepositoryInfo): Promise<void>;

  /**
   * Remove a repository from the knowledge base metadata
   *
   * Deletes the metadata record for the specified repository.
   * This does NOT delete the repository's collection from ChromaDB
   * or remove the cloned files - it only removes the metadata entry.
   *
   * If the repository does not exist, the operation succeeds silently
   * (idempotent operation).
   *
   * @param name - Repository identifier to remove
   * @throws {FileOperationError} If metadata file cannot be written
   *
   * @example
   * ```typescript
   * await service.removeRepository("my-api");
   * console.log("Repository metadata removed");
   * ```
   */
  removeRepository(name: string): Promise<void>;
}

/**
 * Internal file format for repository metadata storage
 *
 * This interface defines the structure of the JSON file
 * stored on disk. It includes a version field for future
 * schema migrations and a dictionary of repositories.
 *
 * @internal
 */
export interface RepositoryMetadataFile {
  /**
   * Schema version for future compatibility
   *
   * Used to handle migrations if the metadata format changes
   * in future versions.
   *
   * @example "1.0"
   */
  version: string;

  /**
   * Dictionary of repositories keyed by repository name
   *
   * Maps repository names to their full metadata objects.
   *
   * @example
   * ```json
   * {
   *   "my-api": { name: "my-api", ... },
   *   "frontend": { name: "frontend", ... }
   * }
   * ```
   */
  repositories: Record<string, RepositoryInfo>;
}
