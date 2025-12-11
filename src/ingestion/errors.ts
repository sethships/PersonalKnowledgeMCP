/**
 * Repository ingestion error classes.
 *
 * Provides domain-specific errors for repository cloning and management operations.
 * All errors include error codes for categorization and support cause chaining.
 *
 * @module ingestion/errors
 */

/**
 * Base error class for repository operations.
 *
 * Includes error code for categorization and supports cause chaining for debugging.
 */
export class RepositoryError extends Error {
  public readonly code: string;
  public override readonly cause?: Error;

  constructor(message: string, code: string = "REPOSITORY_ERROR", cause?: Error) {
    super(message);
    this.name = "RepositoryError";
    this.code = code;
    this.cause = cause;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }

    if (cause && cause.stack) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }
  }
}

/**
 * Error thrown when input validation fails.
 *
 * Used for invalid URLs, malformed repository names, or invalid configuration.
 */
export class ValidationError extends RepositoryError {
  public readonly field: string;

  constructor(message: string, field: string, cause?: Error) {
    super(message, "VALIDATION_ERROR", cause);
    this.name = "ValidationError";
    this.field = field;
  }
}

/**
 * Error thrown when a clone operation fails.
 *
 * Includes the repository URL and target path for debugging.
 */
export class CloneError extends RepositoryError {
  public readonly url: string;
  public readonly targetPath?: string;

  constructor(message: string, url: string, targetPath?: string, cause?: Error) {
    super(message, "CLONE_ERROR", cause);
    this.name = "CloneError";
    this.url = url;
    this.targetPath = targetPath;
  }
}

/**
 * Error thrown when authentication fails for private repositories.
 *
 * Typically indicates missing or invalid GitHub Personal Access Token (PAT).
 */
export class AuthenticationError extends RepositoryError {
  public readonly url: string;

  constructor(message: string, url: string, cause?: Error) {
    super(message, "AUTHENTICATION_ERROR", cause);
    this.name = "AuthenticationError";
    this.url = url;
  }
}
