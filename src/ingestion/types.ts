/**
 * Type definitions for repository ingestion.
 *
 * @module ingestion/types
 */

import type { RetryConfig } from "../utils/retry.js";

/**
 * Options for cloning a repository.
 */
export interface CloneOptions {
  /**
   * Override the auto-detected repository name.
   *
   * By default, the repository name is extracted from the URL.
   * Use this to specify a custom directory name.
   */
  name?: string;

  /**
   * Specific branch to clone.
   *
   * If not specified, the repository's default branch will be cloned.
   */
  branch?: string;

  /**
   * Perform a shallow clone (depth=1).
   *
   * @default true
   */
  shallow?: boolean;

  /**
   * Force re-clone by deleting existing directory.
   *
   * If false and the target directory exists, the clone will be skipped.
   *
   * @default false
   */
  fresh?: boolean;

  /**
   * Fetch latest changes from remote when repository already exists locally.
   *
   * When true and the repository already exists locally (and fresh is false),
   * performs git fetch origin <branch> followed by git reset --hard origin/<branch>
   * to update the local clone to match the remote state.
   *
   * This is used for force reindex operations to ensure the latest remote
   * content is indexed rather than stale local content.
   *
   * @default false
   */
  fetchLatest?: boolean;
}

/**
 * Result of a successful clone operation.
 */
export interface CloneResult {
  /**
   * Local filesystem path to the cloned repository.
   */
  path: string;

  /**
   * Repository name (directory name).
   */
  name: string;

  /**
   * Branch that was cloned.
   */
  branch: string;

  /**
   * Git commit SHA of the HEAD after clone.
   *
   * This is the full 40-character SHA of the commit that was cloned.
   * Used to record `lastIndexedCommitSha` for incremental update support.
   *
   * Optional because SHA capture may fail in edge cases (e.g., empty repo).
   *
   * @example "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"
   */
  commitSha?: string;
}

/**
 * Configuration for the RepositoryCloner.
 */
export interface RepositoryClonerConfig {
  /**
   * Base directory where repositories will be cloned.
   *
   * Each repository will be cloned into a subdirectory: {clonePath}/{repo-name}
   */
  clonePath: string;

  /**
   * GitHub Personal Access Token for private repository access.
   *
   * Optional. Required only for cloning private repositories.
   * Should have 'repo' scope for private repository access.
   */
  githubPat?: string;

  /**
   * Timeout for clone operations in milliseconds.
   *
   * If a clone operation exceeds this timeout, it will be aborted.
   * Prevents hanging on large repositories or slow network connections.
   *
   * @default 300000 (5 minutes)
   */
  cloneTimeoutMs?: number;

  /**
   * Retry configuration for transient network failures.
   *
   * If not provided, defaults will be used.
   * Only network errors are retried - authentication failures fail immediately.
   */
  retry?: RetryConfig;
}

/**
 * Options for configuring file scanning behavior.
 *
 * Allows customization of which files are included in scan results through
 * extension filtering and exclusion patterns. Progress tracking is available
 * via an optional callback.
 *
 * @example
 * ```typescript
 * const options: ScanOptions = {
 *   includeExtensions: ['.ts', '.js', '.md'],
 *   excludePatterns: ['test/**', '*.test.ts'],
 *   onProgress: (scanned, total) => console.log(`${scanned}/${total}`)
 * };
 * ```
 */
export interface ScanOptions {
  /**
   * File extensions to include in scan results.
   *
   * Must start with a dot (e.g., '.ts', '.js', '.md').
   * If not specified, defaults to a comprehensive set of source code,
   * documentation, and configuration files.
   *
   * @default ['.js', '.ts', '.jsx', '.tsx', '.cs', '.py', '.java', '.go', '.rs', '.cpp', '.c', '.h', '.md', '.txt', '.rst', '.json', '.yaml', '.yml', '.toml']
   */
  includeExtensions?: string[];

  /**
   * Additional glob patterns to exclude from scan results.
   *
   * These patterns are added to the default exclusions (node_modules, dist, etc.).
   * Uses glob syntax (e.g., 'dist/**', '*.min.js', 'node_modules/**').
   *
   * @default [] (uses only default exclusions)
   */
  excludePatterns?: string[];

  /**
   * Optional progress callback invoked during scanning.
   *
   * Called periodically (every 100 files) with progress information.
   * The final callback is invoked after all files are processed.
   *
   * **Important**: The final `scanned` value may be less than `total` if files
   * are excluded due to size limits (>1MB by default) or stat errors. The
   * `total` represents files that matched glob patterns, while `scanned`
   * represents files successfully included in results after all filtering.
   *
   * @param scanned - Number of files successfully scanned and included in results.
   *   Excludes files filtered by size limits or with stat errors.
   * @param total - Total number of files that matched extension and exclusion
   *   filters. All these files will be stat'ed, but not all may pass size checks.
   *
   * @example
   * ```typescript
   * onProgress: (scanned, total) => {
   *   console.log(`Progress: ${scanned}/${total} files`);
   *   // Note: final scanned may be < total if large files are excluded
   * }
   * ```
   */
  onProgress?: (scanned: number, total: number) => void;
}

/**
 * Metadata for a scanned file.
 *
 * Provides both relative and absolute paths for flexibility in processing.
 * Relative paths use POSIX separators (/) for consistency across platforms.
 *
 * @example
 * ```typescript
 * const fileInfo: FileInfo = {
 *   relativePath: 'src/components/Button.tsx',
 *   absolutePath: 'C:\\repos\\my-app\\src\\components\\Button.tsx',
 *   extension: '.tsx',
 *   sizeBytes: 2048,
 *   modifiedAt: new Date('2024-01-15T10:30:00Z')
 * };
 * ```
 */
export interface FileInfo {
  /**
   * Path relative to the repository root.
   *
   * Always uses POSIX separators (/) regardless of platform for
   * cross-platform consistency when storing in databases.
   *
   * @example 'src/components/Button.tsx'
   */
  relativePath: string;

  /**
   * Absolute filesystem path.
   *
   * Uses platform-native separators (\ on Windows, / on Unix).
   *
   * @example 'C:\\repos\\my-app\\src\\components\\Button.tsx' (Windows)
   * @example '/home/user/repos/my-app/src/components/Button.tsx' (Unix)
   */
  absolutePath: string;

  /**
   * File extension including the dot.
   *
   * Normalized to lowercase for consistent matching.
   *
   * @example '.tsx', '.md', '.json'
   */
  extension: string;

  /**
   * File size in bytes.
   *
   * Files larger than the configured maximum (default 1MB) are
   * excluded from scanning.
   */
  sizeBytes: number;

  /**
   * Last modification timestamp.
   *
   * Useful for incremental indexing and cache invalidation.
   */
  modifiedAt: Date;
}

/**
 * Configuration for the FileScanner.
 *
 * Internal configuration structure used to customize scanning behavior.
 */
export interface FileScannerConfig {
  /**
   * Maximum file size in bytes to include in scan results.
   *
   * Files exceeding this size are silently excluded from results.
   * This prevents indexing large binaries or generated files.
   *
   * @default 1048576 (1MB)
   */
  maxFileSizeBytes?: number;

  /**
   * Optional list of allowed base directory paths for repository scanning.
   *
   * When specified, repository paths must be located within one of these
   * base directories. This provides path traversal defense for multi-instance
   * deployments where different instances should only access specific directories.
   *
   * All paths must be absolute and normalized. Repository paths are validated
   * to ensure they start with one of the allowed base paths.
   *
   * If not specified (default), any absolute path can be scanned.
   *
   * @default undefined (no restrictions)
   *
   * @example
   * ```typescript
   * // Restrict to project directories
   * const scanner = new FileScanner({
   *   allowedBasePaths: [
   *     '/home/user/work-repos',
   *     '/home/user/personal-repos'
   *   ]
   * });
   *
   * // Valid: /home/user/work-repos/project1
   * // Invalid: /tmp/malicious-repo (throws ValidationError)
   * ```
   */
  allowedBasePaths?: string[];
}

/**
 * Represents a single chunk of a file, ready for embedding.
 *
 * Contains the chunk content, position tracking, and metadata for
 * semantic search and result rendering. Files are split into chunks
 * to fit within embedding model token limits while preserving line
 * boundaries and maintaining overlap for semantic continuity.
 *
 * @example
 * ```typescript
 * const chunk: FileChunk = {
 *   id: "my-api:src/auth/middleware.ts:0",
 *   repository: "my-api",
 *   filePath: "src/auth/middleware.ts",
 *   content: "import express from 'express';\n...",
 *   chunkIndex: 0,
 *   totalChunks: 3,
 *   startLine: 1,
 *   endLine: 45,
 *   metadata: {
 *     extension: ".ts",
 *     fileSizeBytes: 4096,
 *     contentHash: "a1b2c3...",
 *     fileModifiedAt: new Date("2024-12-11T10:00:00Z")
 *   }
 * };
 * ```
 */
export interface FileChunk {
  /**
   * Unique chunk identifier.
   *
   * Format: {repository}:{filePath}:{chunkIndex}
   * Colon-separated to enable easy parsing and filtering.
   *
   * @example "my-api:src/auth/middleware.ts:0"
   */
  id: string;

  /**
   * Repository name (slugified identifier).
   *
   * Should match the repository name in RepositoryInfo.
   *
   * @example "my-api", "frontend-app"
   */
  repository: string;

  /**
   * File path relative to repository root.
   *
   * Uses POSIX separators (/) for cross-platform consistency.
   * Matches FileInfo.relativePath format.
   *
   * @example "src/auth/middleware.ts"
   */
  filePath: string;

  /**
   * Chunk text content.
   *
   * Preserves line boundaries - never splits mid-line.
   * May include overlap from previous chunk for context continuity.
   */
  content: string;

  /**
   * Zero-based chunk index within file.
   *
   * First chunk is 0, second is 1, etc.
   */
  chunkIndex: number;

  /**
   * Total number of chunks for this file.
   *
   * All chunks from same file will have identical totalChunks value.
   * Updated after chunking is complete.
   */
  totalChunks: number;

  /**
   * Starting line number in original file (1-based).
   *
   * Line numbers are 1-based to match editor conventions.
   */
  startLine: number;

  /**
   * Ending line number in original file (1-based, inclusive).
   *
   * The endLine is inclusive - it's the last line included in the chunk.
   */
  endLine: number;

  /**
   * Chunk-specific metadata.
   */
  metadata: {
    /**
     * File extension (lowercase, with leading dot).
     *
     * Copied from FileInfo.extension
     *
     * @example ".ts", ".md", ".py"
     */
    extension: string;

    /**
     * Programming language detected from file extension.
     *
     * Used for language-filtered semantic search queries.
     * Detected using the language-detector module.
     *
     * @example "typescript", "javascript", "tsx", "jsx", "unknown"
     */
    language: string;

    /**
     * Original file size in bytes.
     *
     * Size of the entire file, not just this chunk.
     * Copied from FileInfo.sizeBytes
     */
    fileSizeBytes: number;

    /**
     * SHA-256 hash of chunk content.
     *
     * Used for deduplication and change detection.
     * Computed from chunk.content at creation time.
     */
    contentHash: string;

    /**
     * File modification timestamp.
     *
     * Copied from FileInfo.modifiedAt
     * Useful for cache invalidation and version tracking.
     */
    fileModifiedAt: Date;
  };
}

/**
 * Configuration for FileChunker behavior.
 *
 * Controls chunk size, overlap, and limits to optimize for embedding
 * model token constraints while maintaining semantic context continuity.
 *
 * @example
 * ```typescript
 * const config: ChunkerConfig = {
 *   maxChunkTokens: 500,
 *   overlapTokens: 50
 * };
 * const chunker = new FileChunker(config);
 * ```
 */
export interface ChunkerConfig {
  /**
   * Maximum tokens per chunk.
   *
   * Chunks will not exceed this token limit (with some tolerance for
   * long single lines that cannot be split). Token estimation uses
   * a conservative character-based heuristic (~4 characters per token).
   *
   * @default 500 (from CHUNK_MAX_TOKENS env var or hardcoded default)
   */
  maxChunkTokens?: number;

  /**
   * Overlap tokens between consecutive chunks.
   *
   * Ensures semantic context continuity across chunk boundaries.
   * Should be significantly smaller than maxChunkTokens.
   *
   * @default 50 (from CHUNK_OVERLAP_TOKENS env var or hardcoded default)
   */
  overlapTokens?: number;
}
