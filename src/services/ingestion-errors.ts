/**
 * Error classes for the IngestionService
 *
 * Defines custom error types for repository indexing operations
 * with support for retryable flags and error chaining.
 *
 * @module services/ingestion-errors
 */

/**
 * Base error class for ingestion operations
 */
export class IngestionError extends Error {
  /**
   * Whether this error is retryable
   * True if the operation might succeed on retry
   */
  public readonly retryable: boolean;

  /**
   * Original error that caused this error (if any)
   */
  public override readonly cause?: unknown;

  constructor(message: string, retryable: boolean = false, cause?: unknown) {
    super(message);
    this.name = "IngestionError";
    this.retryable = retryable;
    this.cause = cause;

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }

    // Chain stack traces if cause is available
    if (cause && cause instanceof Error && cause.stack) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }
  }
}

/**
 * Error thrown when attempting to index a repository that already exists
 * without the force flag
 */
export class RepositoryAlreadyExistsError extends IngestionError {
  override name = "RepositoryAlreadyExistsError";

  constructor(repository: string) {
    super(
      `Repository '${repository}' is already indexed. Use force: true to reindex.`,
      false // Not retryable - user needs to set force flag
    );
  }
}

/**
 * Error thrown when attempting to start indexing while another
 * indexing operation is in progress
 */
export class IndexingInProgressError extends IngestionError {
  override name = "IndexingInProgressError";

  constructor(currentRepository: string) {
    super(
      `Cannot start indexing: already indexing repository '${currentRepository}'`,
      true // Retryable - can retry after current operation completes
    );
  }
}

/**
 * Error thrown when repository cloning fails
 */
export class CloneError extends IngestionError {
  override name = "CloneError";

  constructor(url: string, cause: unknown) {
    super(`Failed to clone repository from '${url}'`, true, cause);
  }
}

/**
 * Error thrown when ChromaDB collection creation fails
 */
export class CollectionCreationError extends IngestionError {
  override name = "CollectionCreationError";

  constructor(collectionName: string, cause: unknown) {
    super(
      `Failed to create ChromaDB collection '${collectionName}'`,
      true, // Retryable - might be transient ChromaDB issue
      cause
    );
  }
}
