/**
 * Custom error classes for repository metadata operations
 *
 * These error classes provide structured error handling for repository
 * management operations, making it easier to diagnose issues and handle
 * different failure scenarios appropriately.
 *
 * @module repositories/errors
 */

/**
 * Base error class for all repository metadata errors
 *
 * Extends the native Error class with additional context and error codes
 * for integration with the MCP error handling system.
 *
 * All repository-specific errors inherit from this base class to provide
 * consistent error handling and reporting.
 *
 * @example
 * ```typescript
 * try {
 *   await service.getRepository("unknown");
 * } catch (error) {
 *   if (error instanceof RepositoryMetadataError) {
 *     console.error(`Repository error [${error.code}]: ${error.message}`);
 *   }
 * }
 * ```
 */
export class RepositoryMetadataError extends Error {
  /**
   * Error code for categorization and handling
   *
   * Used to distinguish between different types of repository errors
   * without relying on string matching or instanceof checks.
   *
   * @example "REPOSITORY_NOT_FOUND", "FILE_OPERATION_ERROR"
   */
  public readonly code: string;

  /**
   * Original error that caused this error (if any)
   *
   * NOTE: Uses 'override' to explicitly shadow ES2022 Error.cause property.
   * This provides type safety by restricting cause to Error instances only,
   * whereas the built-in property allows any unknown value.
   */
  public override readonly cause?: Error;

  /**
   * Create a new RepositoryMetadataError
   *
   * @param message - Human-readable error message
   * @param code - Error code for categorization (default: 'REPOSITORY_METADATA_ERROR')
   * @param cause - Original error that caused this error
   */
  constructor(message: string, code: string = "REPOSITORY_METADATA_ERROR", cause?: Error) {
    super(message);
    this.name = "RepositoryMetadataError";
    this.code = code;
    this.cause = cause;

    // Maintain proper stack trace for where our error was thrown (V8 only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }

    // Include cause stack trace if available
    if (cause && cause.stack) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }
  }
}

/**
 * Error thrown when a requested repository is not found in the metadata store
 *
 * This error indicates that an operation was attempted on a repository
 * that hasn't been indexed yet or has been removed from the knowledge base.
 *
 * This is typically not a critical error - the caller should handle it
 * gracefully by either indexing the repository or informing the user.
 *
 * @example
 * ```typescript
 * try {
 *   const repo = await service.getRepository("nonexistent");
 *   if (!repo) {
 *     console.log("Repository not found - needs indexing");
 *   }
 * } catch (error) {
 *   if (error instanceof RepositoryNotFoundError) {
 *     console.error(`Repository '${error.repositoryName}' not in knowledge base`);
 *   }
 * }
 * ```
 */
export class RepositoryNotFoundError extends RepositoryMetadataError {
  /**
   * The repository name that was not found
   *
   * Stores the identifier of the repository that couldn't be located
   * in the metadata store.
   */
  public readonly repositoryName: string;

  /**
   * Create a new RepositoryNotFoundError
   *
   * @param repositoryName - Name of the repository that was not found
   * @param message - Optional custom error message (defaults to standard message)
   */
  constructor(repositoryName: string, message?: string) {
    super(
      message || `Repository '${repositoryName}' not found in metadata store`,
      "REPOSITORY_NOT_FOUND"
    );
    this.name = "RepositoryNotFoundError";
    this.repositoryName = repositoryName;
  }
}

/**
 * Error thrown when a file operation fails
 *
 * This error covers failures during file I/O operations on the metadata
 * storage file, including read, write, and delete operations.
 *
 * Common causes:
 * - Permission denied (insufficient file system permissions)
 * - Disk full (no space available for writes)
 * - File locked by another process
 * - Network file system unavailable
 * - Invalid file path
 *
 * @example
 * ```typescript
 * try {
 *   await service.updateRepository(repoInfo);
 * } catch (error) {
 *   if (error instanceof FileOperationError) {
 *     console.error(`Failed to ${error.operation} metadata file`);
 *     console.error(error.cause?.message);
 *   }
 * }
 * ```
 */
export class FileOperationError extends RepositoryMetadataError {
  /**
   * The file operation that failed
   *
   * Identifies which type of operation encountered the error.
   */
  public readonly operation: "read" | "write" | "delete";

  /**
   * Create a new FileOperationError
   *
   * @param operation - The file operation that failed
   * @param message - Human-readable error description
   * @param cause - Original error from the file system operation
   */
  constructor(operation: "read" | "write" | "delete", message: string, cause?: Error) {
    super(message, "FILE_OPERATION_ERROR", cause);
    this.name = "FileOperationError";
    this.operation = operation;
  }
}

/**
 * Error thrown when the metadata file contains invalid JSON or unexpected format
 *
 * This error indicates that the metadata file exists but couldn't be parsed
 * correctly. This could mean:
 * - Corrupted JSON syntax
 * - Missing required fields
 * - Invalid data types
 * - Incompatible schema version
 *
 * Recovery strategy:
 * - Log the corrupted file for investigation
 * - Create a new empty metadata store
 * - Notify user that repository metadata was lost
 *
 * @example
 * ```typescript
 * try {
 *   const repos = await service.listRepositories();
 * } catch (error) {
 *   if (error instanceof InvalidMetadataFormatError) {
 *     console.error("Metadata file is corrupted - creating new store");
 *     // Backup corrupted file
 *     // Initialize fresh metadata store
 *   }
 * }
 * ```
 */
export class InvalidMetadataFormatError extends RepositoryMetadataError {
  /**
   * Create a new InvalidMetadataFormatError
   *
   * @param message - Description of the format issue
   * @param cause - Original parsing error (if available)
   */
  constructor(message: string, cause?: Error) {
    super(message, "INVALID_METADATA_FORMAT", cause);
    this.name = "InvalidMetadataFormatError";
  }
}
