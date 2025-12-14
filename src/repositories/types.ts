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
