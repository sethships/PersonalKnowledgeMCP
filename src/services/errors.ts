/**
 * Error classes for SearchService
 *
 * This module defines domain-specific error types for search operations.
 * All errors include a retryable flag to guide error handling logic.
 */

/**
 * Base class for all search-related errors
 */
export abstract class SearchError extends Error {
  public readonly retryable: boolean;

  constructor(message: string, retryable: boolean = false) {
    super(message);
    this.name = this.constructor.name;
    this.retryable = retryable;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Thrown when search query parameters fail validation
 * Not retryable - client must fix input
 */
export class SearchValidationError extends SearchError {
  constructor(
    message: string,
    public readonly validationErrors?: string[]
  ) {
    super(message, false);
  }
}

/**
 * Thrown when specified repository does not exist
 * Not retryable - repository must be indexed first
 */
export class RepositoryNotFoundError extends SearchError {
  constructor(public readonly repositoryName: string) {
    super(`Repository not found: ${repositoryName}`, false);
  }
}

/**
 * Thrown when specified repository is not in 'ready' status
 * Potentially retryable if status is 'indexing'
 */
export class RepositoryNotReadyError extends SearchError {
  constructor(
    public readonly repositoryName: string,
    public readonly currentStatus: string
  ) {
    super(
      `Repository '${repositoryName}' is not ready for search (status: ${currentStatus})`,
      currentStatus === "indexing" // Retryable if still indexing
    );
  }
}

/**
 * Thrown when no repositories are available to search
 * Not retryable - repositories must be indexed first
 */
export class NoRepositoriesAvailableError extends SearchError {
  constructor() {
    super("No repositories available to search. Please index a repository first.", false);
  }
}

/**
 * Thrown when underlying search operation fails
 * Retryability depends on underlying cause
 */
export class SearchOperationError extends SearchError {
  constructor(
    message: string,
    retryable: boolean = true,
    public readonly cause?: Error
  ) {
    super(message, retryable);
  }
}
