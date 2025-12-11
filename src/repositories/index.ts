/**
 * Repository metadata management module
 *
 * This module provides a file-based storage system for repository metadata,
 * tracking which repositories have been indexed into the knowledge base.
 *
 * **Key Components:**
 * - `RepositoryMetadataStoreImpl`: Singleton implementation with atomic writes
 * - `RepositoryInfo`: Complete metadata for an indexed repository
 * - Error classes: Structured error handling for all operations
 *
 * @module repositories
 *
 * @example
 * ```typescript
 * import { RepositoryMetadataStoreImpl, type RepositoryInfo } from "./repositories";
 *
 * // Get singleton instance
 * const store = RepositoryMetadataStoreImpl.getInstance();
 *
 * // Add repository
 * const repoInfo: RepositoryInfo = {
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
 * };
 * await store.updateRepository(repoInfo);
 *
 * // List repositories
 * const repos = await store.listRepositories();
 * ```
 */

// Export implementation
export { RepositoryMetadataStoreImpl, sanitizeCollectionName } from "./metadata-store.js";

// Export types
export type {
  RepositoryInfo,
  RepositoryMetadataService,
  RepositoryStatus,
  RepositoryMetadataFile,
} from "./types.js";

// Export errors
export {
  RepositoryMetadataError,
  RepositoryNotFoundError,
  FileOperationError,
  InvalidMetadataFormatError,
} from "./errors.js";
