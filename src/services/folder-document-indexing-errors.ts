/**
 * @module services/folder-document-indexing-errors
 *
 * Error class hierarchy for FolderDocumentIndexingService operations.
 *
 * Follows the error pattern established in change-detection-errors.ts and
 * processing-queue-errors.ts, providing typed error classes with retryability
 * indicators for proper error handling.
 */

// =============================================================================
// Base Error Class
// =============================================================================

/**
 * Base class for all FolderDocumentIndexing-related errors.
 */
export abstract class FolderDocumentIndexingError extends Error {
  /**
   * Whether this error is transient and the operation can be retried.
   */
  public readonly retryable: boolean;

  constructor(message: string, retryable: boolean = false) {
    super(message);
    this.name = this.constructor.name;
    this.retryable = retryable;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

// =============================================================================
// Registration Errors
// =============================================================================

/**
 * Thrown when an operation references a folder that has not been registered.
 *
 * Not retryable because the folder must be explicitly registered first.
 */
export class FolderNotRegisteredError extends FolderDocumentIndexingError {
  /**
   * The folder ID that was not found.
   */
  public readonly folderId: string;

  constructor(folderId: string) {
    super(`Folder '${folderId}' is not registered for indexing`, false);
    this.folderId = folderId;
  }
}

// =============================================================================
// Content Hash Errors
// =============================================================================

/**
 * Thrown when content hash comparison fails.
 *
 * Retryable if the failure was due to a transient filesystem or storage issue.
 */
export class ContentHashCheckError extends FolderDocumentIndexingError {
  /**
   * The file path that failed hash checking.
   */
  public readonly filePath: string;

  /**
   * The underlying error that caused the hash check to fail.
   */
  public override readonly cause?: Error;

  constructor(filePath: string, message: string, retryable: boolean = false, cause?: Error) {
    super(`Content hash check failed for '${filePath}': ${message}`, retryable);
    this.filePath = filePath;
    this.cause = cause;

    if (cause?.stack) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Type guard to check if an error is a FolderDocumentIndexingError.
 */
export function isFolderDocumentIndexingError(
  error: unknown
): error is FolderDocumentIndexingError {
  return error instanceof FolderDocumentIndexingError;
}

/**
 * Determine if a FolderDocumentIndexing error is retryable.
 */
export function isRetryableFolderDocumentIndexingError(error: unknown): boolean {
  if (error instanceof FolderDocumentIndexingError) {
    return error.retryable;
  }
  return false;
}
