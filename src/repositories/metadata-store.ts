/**
 * Repository Metadata Store Implementation
 *
 * Provides a singleton file-based storage implementation for repository metadata.
 * Uses atomic writes to prevent data corruption and supports concurrent access
 * through the singleton pattern.
 *
 * @module repositories/metadata-store
 */

import { join } from "path";
import type { RepositoryInfo, RepositoryMetadataService, RepositoryMetadataFile } from "./types.js";
import {
  RepositoryMetadataError,
  FileOperationError,
  InvalidMetadataFormatError,
} from "./errors.js";
import { getComponentLogger } from "../logging/index.js";

/**
 * Singleton implementation of repository metadata storage
 *
 * Manages repository metadata in a JSON file with atomic writes for data safety.
 * Implements the RepositoryMetadataService interface with a singleton pattern
 * to ensure consistent access across the application.
 *
 * **File Location:** `{DATA_PATH}/repositories.json`
 * **Default DATA_PATH:** `./data`
 *
 * **Features:**
 * - Singleton pattern for global access
 * - Atomic writes using temp file + rename pattern
 * - Automatic file creation if missing
 * - Graceful error handling with detailed error messages
 * - Performance metrics logging
 * - Thread-safe operations through atomic file operations
 *
 * @example
 * ```typescript
 * // Get singleton instance
 * const store = RepositoryMetadataStoreImpl.getInstance();
 *
 * // Add/update repository
 * await store.updateRepository({
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
 *
 * // List all repositories
 * const repos = await store.listRepositories();
 *
 * // Get specific repository
 * const repo = await store.getRepository("my-api");
 * ```
 */
export class RepositoryMetadataStoreImpl implements RepositoryMetadataService {
  /**
   * Singleton instance
   *
   * Ensures only one metadata store instance exists in the application.
   * Access via `getInstance()` instead of constructing directly.
   */
  private static instance: RepositoryMetadataStoreImpl | null = null;

  /**
   * Absolute path to the metadata JSON file
   */
  private readonly filePath: string;

  /**
   * Component logger for metadata operations
   *
   * Logs all file operations with duration metrics and error details.
   */
  private readonly logger = getComponentLogger("repositories:metadata");

  /**
   * Private constructor enforces singleton pattern
   *
   * Use `getInstance()` to obtain the singleton instance.
   *
   * @param dataPath - Base directory for data storage
   */
  private constructor(dataPath: string) {
    this.filePath = join(dataPath, "repositories.json");
    this.logger.info({ filePath: this.filePath }, "Repository metadata store initialized");
  }

  /**
   * Get the singleton instance of the metadata store
   *
   * Creates the instance on first call using the specified data path.
   * Subsequent calls return the existing instance regardless of the dataPath parameter.
   *
   * @param dataPath - Optional data directory path (default: process.env.DATA_PATH || "./data")
   * @returns The singleton metadata store instance
   *
   * @example
   * ```typescript
   * // Get instance with default path
   * const store = RepositoryMetadataStoreImpl.getInstance();
   *
   * // Get instance with custom path (only on first call)
   * const store = RepositoryMetadataStoreImpl.getInstance("/custom/data/path");
   * ```
   */
  public static getInstance(dataPath?: string): RepositoryMetadataStoreImpl {
    if (!RepositoryMetadataStoreImpl.instance) {
      const path = dataPath || process.env["DATA_PATH"] || "./data";
      RepositoryMetadataStoreImpl.instance = new RepositoryMetadataStoreImpl(path);
    } else if (dataPath !== undefined) {
      // Log warning if a different path is requested after initialization
      const logger = getComponentLogger("repositories:metadata");
      logger.warn(
        { requestedPath: dataPath },
        "getInstance called with dataPath after singleton already initialized - ignoring new path"
      );
    }
    return RepositoryMetadataStoreImpl.instance;
  }

  /**
   * Reset the singleton instance
   *
   * **FOR TESTING ONLY** - Allows tests to create fresh instances with different configurations.
   * Should never be called in production code.
   *
   * @internal
   */
  public static resetInstance(): void {
    RepositoryMetadataStoreImpl.instance = null;
  }

  /**
   * Validate repository info fields at runtime
   *
   * Performs runtime validation to ensure required fields are present and valid.
   * TypeScript provides compile-time type safety, but this ensures data integrity
   * at runtime when persisting to disk.
   *
   * @param info - Repository metadata to validate
   * @throws {RepositoryMetadataError} If validation fails
   * @private
   */
  private validateRepositoryInfo(info: RepositoryInfo): void {
    if (!info.name || typeof info.name !== "string" || info.name.trim() === "") {
      throw new RepositoryMetadataError(
        "Repository name is required and must be non-empty",
        "VALIDATION_ERROR"
      );
    }
    if (!info.url || typeof info.url !== "string") {
      throw new RepositoryMetadataError("Repository URL is required", "VALIDATION_ERROR");
    }
    if (!info.collectionName || typeof info.collectionName !== "string") {
      throw new RepositoryMetadataError("Collection name is required", "VALIDATION_ERROR");
    }
    if (!["ready", "indexing", "error"].includes(info.status)) {
      throw new RepositoryMetadataError(`Invalid status: ${info.status}`, "VALIDATION_ERROR");
    }
    if (typeof info.fileCount !== "number" || info.fileCount < 0) {
      throw new RepositoryMetadataError(
        "File count must be a non-negative number",
        "VALIDATION_ERROR"
      );
    }
    if (typeof info.chunkCount !== "number" || info.chunkCount < 0) {
      throw new RepositoryMetadataError(
        "Chunk count must be a non-negative number",
        "VALIDATION_ERROR"
      );
    }
  }

  /**
   * List all repositories in the knowledge base
   *
   * Loads the metadata file and returns an array of all repository metadata objects.
   * Returns an empty array if no repositories have been indexed yet.
   *
   * @returns Array of repository metadata (may be empty)
   * @throws {FileOperationError} If metadata file cannot be read
   * @throws {InvalidMetadataFormatError} If metadata file is corrupted
   */
  async listRepositories(): Promise<RepositoryInfo[]> {
    const startTime = Date.now();

    try {
      const metadata = await this.loadMetadata();
      const repos = Object.values(metadata.repositories);

      const durationMs = Date.now() - startTime;
      this.logger.info(
        {
          metric: "metadata.list_ms",
          value: durationMs,
          repositoryCount: repos.length,
        },
        "Listed repositories"
      );

      return repos;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      this.logger.error(
        {
          metric: "metadata.list_ms",
          value: durationMs,
          err: error,
        },
        "Failed to list repositories"
      );
      throw error;
    }
  }

  /**
   * Get metadata for a specific repository
   *
   * Retrieves repository metadata by name. Returns `null` if the repository
   * is not found in the metadata store.
   *
   * @param name - Repository identifier
   * @returns Repository metadata if found, null otherwise
   * @throws {FileOperationError} If metadata file cannot be read
   * @throws {InvalidMetadataFormatError} If metadata file is corrupted
   */
  async getRepository(name: string): Promise<RepositoryInfo | null> {
    const startTime = Date.now();

    try {
      const metadata = await this.loadMetadata();
      const repo = metadata.repositories[name] || null;

      const durationMs = Date.now() - startTime;
      this.logger.info(
        {
          metric: "metadata.get_ms",
          value: durationMs,
          repositoryName: name,
          found: repo !== null,
        },
        `Repository ${repo ? "found" : "not found"}`
      );

      return repo;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      this.logger.error(
        {
          metric: "metadata.get_ms",
          value: durationMs,
          repositoryName: name,
          err: error,
        },
        "Failed to get repository"
      );
      throw error;
    }
  }

  /**
   * Add or update repository metadata
   *
   * If a repository with the given name exists, updates its metadata.
   * Otherwise, creates a new repository entry.
   *
   * Uses atomic writes to ensure data consistency even if the operation
   * is interrupted.
   *
   * **Concurrency Note:** This implementation uses atomic file writes to prevent
   * data corruption, but does not protect against race conditions in multi-process
   * environments. If two processes call this method simultaneously, the last write
   * wins and one update may be lost. For MVP, this is acceptable as single-process
   * usage is expected. Future enhancement: implement file locking for multi-process safety.
   *
   * @param info - Complete repository metadata
   * @throws {FileOperationError} If metadata file cannot be written
   * @throws {RepositoryMetadataError} If validation fails
   */
  async updateRepository(info: RepositoryInfo): Promise<void> {
    const startTime = Date.now();

    try {
      // Validate input before persisting
      this.validateRepositoryInfo(info);

      const metadata = await this.loadMetadata();
      const isUpdate = info.name in metadata.repositories;

      // Update or add repository
      metadata.repositories[info.name] = info;

      // Save with atomic write
      await this.saveMetadata(metadata);

      const durationMs = Date.now() - startTime;
      this.logger.info(
        {
          metric: "metadata.update_ms",
          value: durationMs,
          repositoryName: info.name,
          operation: isUpdate ? "update" : "create",
        },
        `Repository ${isUpdate ? "updated" : "created"}`
      );
    } catch (error) {
      const durationMs = Date.now() - startTime;
      this.logger.error(
        {
          metric: "metadata.update_ms",
          value: durationMs,
          repositoryName: info.name,
          err: error,
        },
        "Failed to update repository"
      );
      throw error;
    }
  }

  /**
   * Remove a repository from the metadata store
   *
   * Deletes the metadata entry for the specified repository.
   * This is an idempotent operation - succeeds even if the repository
   * doesn't exist.
   *
   * **Note:** This only removes the metadata entry. It does NOT:
   * - Delete the ChromaDB collection
   * - Remove cloned repository files
   * - Clean up any other resources
   *
   * @param name - Repository identifier to remove
   * @throws {FileOperationError} If metadata file cannot be written
   */
  async removeRepository(name: string): Promise<void> {
    const startTime = Date.now();

    try {
      const metadata = await this.loadMetadata();
      const existed = name in metadata.repositories;

      // Remove repository (idempotent)
      delete metadata.repositories[name];

      // Save with atomic write
      await this.saveMetadata(metadata);

      const durationMs = Date.now() - startTime;
      this.logger.info(
        {
          metric: "metadata.remove_ms",
          value: durationMs,
          repositoryName: name,
          existed,
        },
        existed ? "Repository removed" : "Repository not found (no-op)"
      );
    } catch (error) {
      const durationMs = Date.now() - startTime;
      this.logger.error(
        {
          metric: "metadata.remove_ms",
          value: durationMs,
          repositoryName: name,
          err: error,
        },
        "Failed to remove repository"
      );
      throw error;
    }
  }

  /**
   * Load metadata from disk
   *
   * Reads the metadata file using Bun's native file API.
   * If the file doesn't exist, creates a new empty metadata store.
   *
   * @returns Parsed metadata file content
   * @throws {FileOperationError} If file cannot be read
   * @throws {InvalidMetadataFormatError} If file contains invalid JSON
   * @private
   */
  private async loadMetadata(): Promise<RepositoryMetadataFile> {
    try {
      // Use Bun's native file API
      const file = Bun.file(this.filePath);
      const exists = await file.exists();

      if (!exists) {
        this.logger.info(
          { filePath: this.filePath },
          "Metadata file not found - creating new store"
        );

        // Create empty metadata store
        const emptyStore: RepositoryMetadataFile = {
          version: "1.0",
          repositories: {},
        };

        // Save it to disk
        await this.saveMetadata(emptyStore);
        return emptyStore;
      }

      // Read and parse file
      const content = await file.text();
      const metadata = JSON.parse(content) as RepositoryMetadataFile;

      // Validate basic structure
      if (!metadata.version || !metadata.repositories) {
        throw new Error("Missing required fields: version or repositories");
      }

      return metadata;
    } catch (error) {
      if (error instanceof SyntaxError) {
        // JSON parsing error
        this.logger.error(
          {
            filePath: this.filePath,
            err: error,
          },
          "Metadata file contains invalid JSON"
        );
        throw new InvalidMetadataFormatError(
          `Failed to parse metadata file: ${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error : undefined
        );
      }

      if (error instanceof RepositoryMetadataError) {
        // Re-throw our custom errors
        throw error;
      }

      // File system error
      this.logger.error(
        {
          filePath: this.filePath,
          err: error,
        },
        "Failed to read metadata file"
      );
      throw new FileOperationError(
        "read",
        `Failed to read metadata file: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Save metadata to disk with atomic write
   *
   * Uses a temporary file + rename pattern to ensure atomic writes.
   * This prevents data corruption if the write operation is interrupted.
   *
   * **Atomic Write Process:**
   * 1. Write to temporary file (.tmp extension)
   * 2. Rename temporary file to target file (atomic operation on most filesystems)
   * 3. Clean up temporary file on error
   *
   * @param metadata - Metadata to save
   * @throws {FileOperationError} If write operation fails
   * @private
   */
  private async saveMetadata(metadata: RepositoryMetadataFile): Promise<void> {
    const tempPath = `${this.filePath}.tmp`;

    try {
      // Serialize to JSON with pretty formatting
      const content = JSON.stringify(metadata, null, 2);

      // Write to temporary file using Bun's native API
      await Bun.write(tempPath, content);

      // Atomic rename (Node.js fs for rename as Bun doesn't expose rename)
      const fs = await import("fs/promises");
      await fs.rename(tempPath, this.filePath);

      this.logger.debug(
        {
          filePath: this.filePath,
          repositoryCount: Object.keys(metadata.repositories).length,
        },
        "Metadata saved successfully"
      );
    } catch (error) {
      // Attempt to clean up temp file
      try {
        const fs = await import("fs/promises");
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }

      this.logger.error(
        {
          filePath: this.filePath,
          tempPath,
          err: error,
        },
        "Failed to save metadata file"
      );

      throw new FileOperationError(
        "write",
        `Failed to save metadata file: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }
}

/**
 * Sanitize a repository name for use as a ChromaDB collection name
 *
 * Converts repository names to valid ChromaDB collection names by:
 * - Converting to lowercase
 * - Replacing non-alphanumeric characters with underscores
 * - Collapsing multiple consecutive underscores
 * - Removing leading/trailing underscores
 * - Prefixing with "repo_"
 * - Truncating to 63 characters (ChromaDB limit) with hash suffix for uniqueness
 *
 * For names that exceed 63 characters after prefixing, an 8-character hash of the
 * original name is appended to ensure uniqueness. This prevents collisions when
 * two different repository names would otherwise produce identical collection names
 * after truncation.
 *
 * @param name - Repository name to sanitize
 * @returns Sanitized collection name suitable for ChromaDB
 *
 * @example
 * ```typescript
 * sanitizeCollectionName("My-API")       // "repo_my_api"
 * sanitizeCollectionName("frontend.app") // "repo_frontend_app"
 * sanitizeCollectionName("Test___Name")  // "repo_test_name"
 * // Long names get hash suffix:
 * sanitizeCollectionName("very-long-name...")  // "repo_very_long_name..._a1b2c3d4"
 * ```
 */
export function sanitizeCollectionName(name: string): string {
  // Replace non-alphanumeric characters with underscore
  const sanitized = name
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_") // Collapse multiple underscores
    .replace(/^_|_$/g, ""); // Remove leading/trailing underscores

  // Add prefix
  const prefixed = `repo_${sanitized}`;

  // Truncate to ChromaDB's 63 character limit
  if (prefixed.length > 63) {
    // Use hash suffix to ensure uniqueness for truncated names
    const hash = Bun.hash(name).toString(16).substring(0, 8);
    return `${prefixed.substring(0, 54)}_${hash}`;
  }
  return prefixed;
}
