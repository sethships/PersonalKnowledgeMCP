/**
 * Custom error classes for ChromaDB storage operations
 *
 * These error classes provide structured error handling for storage operations,
 * making it easier to diagnose issues and handle different failure scenarios.
 */

/**
 * Base error class for all storage-related errors
 *
 * Extends the native Error class with additional context and error codes
 * for integration with the MCP error handling system.
 */
export class StorageError extends Error {
  /**
   * Error code for categorization and handling
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
   * Whether this error is transient and the operation should be retried
   *
   * Default is false (most errors are not retryable).
   * Subclasses can override this based on their error semantics.
   */
  public readonly retryable: boolean;

  /**
   * Create a new StorageError
   *
   * @param message - Human-readable error message
   * @param code - Error code for categorization (default: 'STORAGE_ERROR')
   * @param cause - Original error that caused this error
   * @param retryable - Whether the operation can be retried (default: false)
   */
  constructor(
    message: string,
    code: string = "STORAGE_ERROR",
    cause?: Error,
    retryable: boolean = false
  ) {
    super(message);
    this.name = "StorageError";
    this.code = code;
    this.cause = cause;
    this.retryable = retryable;

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
 * Error thrown when connection to ChromaDB fails
 *
 * This error indicates that the ChromaDB server is unreachable,
 * not responding, or refusing connections.
 *
 * This error is RETRYABLE by default, as connection issues are often transient.
 *
 * Common causes:
 * - ChromaDB Docker container not running
 * - Network connectivity issues
 * - Incorrect host/port configuration
 * - ChromaDB server crashed or restarting
 *
 * @example
 * ```typescript
 * try {
 *   await client.connect();
 * } catch (error) {
 *   if (error instanceof StorageConnectionError) {
 *     console.error("ChromaDB is not available. Ensure Docker container is running.");
 *   }
 * }
 * ```
 */
export class StorageConnectionError extends StorageError {
  constructor(message: string, cause?: Error, retryable: boolean = true) {
    super(message, "CONNECTION_ERROR", cause, retryable);
    this.name = "StorageConnectionError";
  }
}

/**
 * Error thrown when a requested collection doesn't exist
 *
 * This error indicates that an operation was attempted on a collection
 * that hasn't been created yet or has been deleted.
 *
 * @example
 * ```typescript
 * try {
 *   const stats = await client.getCollectionStats("repo_nonexistent");
 * } catch (error) {
 *   if (error instanceof CollectionNotFoundError) {
 *     console.error("Repository not indexed yet");
 *   }
 * }
 * ```
 */
export class CollectionNotFoundError extends StorageError {
  /**
   * The collection name that was not found
   */
  public readonly collectionName: string;

  constructor(collectionName: string, message?: string) {
    super(message || `Collection '${collectionName}' not found`, "COLLECTION_NOT_FOUND");
    this.name = "CollectionNotFoundError";
    this.collectionName = collectionName;
  }
}

/**
 * Error thrown when invalid parameters are provided to storage operations
 *
 * This error indicates that the provided parameters don't meet the requirements
 * for the operation (e.g., empty collection name, invalid embedding dimensions,
 * missing required metadata fields).
 *
 * @example
 * ```typescript
 * try {
 *   await client.addDocuments("repo_test", [
 *     { id: "", content: "test", embedding: [], metadata: {} }
 *   ]);
 * } catch (error) {
 *   if (error instanceof InvalidParametersError) {
 *     console.error("Invalid document format:", error.message);
 *   }
 * }
 * ```
 */
export class InvalidParametersError extends StorageError {
  /**
   * The parameter name that was invalid
   */
  public readonly parameterName?: string;

  constructor(message: string, parameterName?: string) {
    super(message, "INVALID_PARAMETERS");
    this.name = "InvalidParametersError";
    this.parameterName = parameterName;
  }
}

/**
 * Error thrown when a document operation fails
 *
 * This error covers failures during document addition, update, or deletion
 * that aren't covered by more specific error types.
 *
 * Common causes:
 * - Embedding dimension mismatch
 * - Duplicate document IDs
 * - Malformed metadata
 * - ChromaDB internal errors
 */
export class DocumentOperationError extends StorageError {
  /**
   * The operation that failed
   */
  public readonly operation: "add" | "update" | "delete";

  /**
   * Document IDs involved in the failed operation
   */
  public readonly documentIds?: string[];

  constructor(
    operation: "add" | "update" | "delete",
    message: string,
    documentIds?: string[],
    cause?: Error,
    retryable: boolean = false
  ) {
    super(message, "DOCUMENT_OPERATION_ERROR", cause, retryable);
    this.name = "DocumentOperationError";
    this.operation = operation;
    this.documentIds = documentIds;
  }
}

/**
 * Error thrown when a search operation fails
 *
 * This error indicates that a similarity search couldn't be completed.
 *
 * Common causes:
 * - Invalid query embedding
 * - Search timeout
 * - ChromaDB query errors
 * - Result processing failures
 */
export class SearchOperationError extends StorageError {
  /**
   * The collections that were being searched
   */
  public readonly collections?: string[];

  constructor(message: string, collections?: string[], cause?: Error, retryable: boolean = false) {
    super(message, "SEARCH_OPERATION_ERROR", cause, retryable);
    this.name = "SearchOperationError";
    this.collections = collections;
  }
}

/**
 * Error thrown when a storage operation times out
 *
 * This error is RETRYABLE by default, as timeouts are often transient.
 */
export class StorageTimeoutError extends StorageError {
  constructor(message: string, cause?: Error) {
    super(message, "TIMEOUT_ERROR", cause, true);
    this.name = "StorageTimeoutError";
  }
}

/**
 * Determine if an error is retryable based on its type and characteristics
 *
 * Used to decide whether to retry an operation after a failure.
 * This handles both our custom error classes and native errors.
 *
 * @param error - The error to check
 * @returns true if the operation should be retried
 */
export function isRetryableStorageError(error: unknown): boolean {
  // Check our custom error types first
  if (error instanceof StorageError) {
    return error.retryable;
  }

  // For native errors, check for network/connection related messages
  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    // Network errors that are typically transient
    const retryablePatterns = [
      "econnrefused",
      "econnreset",
      "etimedout",
      "enotfound",
      "enetunreach",
      "socket hang up",
      "network error",
      "connection refused",
      "connection reset",
      "timeout",
      "failed to fetch",
      "fetch failed",
      "503",
      "502",
      "504",
      "500",
    ];

    return retryablePatterns.some((pattern) => message.includes(pattern));
  }

  // Unknown error types are not retryable by default
  return false;
}
