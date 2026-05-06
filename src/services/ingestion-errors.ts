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
 * Error thrown when a `local-folder` registration attempts to claim an
 * absolute path that is already registered under a different repository name.
 *
 * Distinct from `RepositoryAlreadyExistsError` because the user-visible fix is
 * different: the user supplied a non-colliding name but the underlying path
 * is shared. Includes the existing registration's name so the message points
 * to the conflict directly.
 */
export class LocalFolderPathAlreadyRegisteredError extends IngestionError {
  override name = "LocalFolderPathAlreadyRegisteredError";

  constructor(
    public readonly absolutePath: string,
    public readonly existingRepository: string
  ) {
    super(
      `Local folder path '${absolutePath}' is already registered as ` +
        `repository '${existingRepository}'. Use force: true on the existing ` +
        `registration to reindex, or unregister it first.`,
      false
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
 * Error thrown when a caller attempts to register a `local-folder` repository
 * with `tier: "public"`. Local folders frequently contain personal or
 * confidential content, so the public tier is refused outright; the user must
 * pick `"private"` or `"work"` (or register the content via a deliberate
 * git-remote source, which has its own publication semantics).
 */
export class LocalFolderPublicTierRefusedError extends IngestionError {
  override name = "LocalFolderPublicTierRefusedError";

  constructor(repository: string) {
    super(
      `Cannot register local folder '${repository}' with tier="public". ` +
        `Local folders are refused at the public tier to prevent accidental ` +
        `disclosure of personal content. Use tier="private" (default) or ` +
        `tier="work" instead.`,
      false
    );
  }
}

/**
 * Error thrown when a `local-folder` registration would exceed the configured
 * size guardrails (file count or total bytes) and `force` was not set.
 *
 * Distinct from `IngestionError` so callers can distinguish a hard-refusal
 * caused by guardrails from a generic indexing failure.
 */
export class LocalFolderSizeRefusedError extends IngestionError {
  override name = "LocalFolderSizeRefusedError";

  constructor(
    public readonly repository: string,
    public readonly fileCount: number,
    public readonly totalBytes: number,
    public readonly fileLimit: number,
    public readonly byteLimit: number
  ) {
    super(
      `Cannot register local folder '${repository}': ` +
        `${fileCount} files / ${totalBytes} bytes exceeds the hard refusal ` +
        `threshold of ${fileLimit} files / ${byteLimit} bytes. Pass ` +
        `force: true to bypass.`,
      false
    );
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
