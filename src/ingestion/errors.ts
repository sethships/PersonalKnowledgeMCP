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
  public readonly retryable: boolean;

  constructor(
    message: string,
    code: string = "REPOSITORY_ERROR",
    cause?: Error,
    retryable: boolean = false
  ) {
    super(message);
    this.name = "RepositoryError";
    this.code = code;
    this.cause = cause;
    this.retryable = retryable;

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

  constructor(
    message: string,
    url: string,
    targetPath?: string,
    cause?: Error,
    retryable: boolean = false
  ) {
    super(message, "CLONE_ERROR", cause, retryable);
    this.name = "CloneError";
    this.url = url;
    this.targetPath = targetPath;
  }
}

/**
 * Error thrown when a network failure occurs during clone.
 *
 * This error is RETRYABLE by default, as network issues are often transient.
 * Common causes include:
 * - DNS resolution failures (ENOTFOUND)
 * - Connection refused (ECONNREFUSED)
 * - Connection reset (ECONNRESET)
 * - Timeouts (ETIMEDOUT)
 */
export class NetworkError extends CloneError {
  constructor(message: string, url: string, targetPath?: string, cause?: Error) {
    super(message, url, targetPath, cause, true);
    this.name = "NetworkError";
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

/**
 * Error thrown when file scanning operations fail.
 *
 * Common causes include:
 * - Directory doesn't exist or is inaccessible
 * - Permission denied on directory or files
 * - Invalid glob patterns
 * - File system errors during stat operations
 *
 * @example
 * ```typescript
 * try {
 *   const files = await scanner.scanFiles('/invalid/path');
 * } catch (error) {
 *   if (error instanceof FileScanError) {
 *     console.error(`Scan failed for ${error.repoPath}:`, error.message);
 *   }
 * }
 * ```
 */
export class FileScanError extends RepositoryError {
  public readonly repoPath: string;

  constructor(message: string, repoPath: string, cause?: Error) {
    super(message, "FILE_SCAN_ERROR", cause);
    this.name = "FileScanError";
    this.repoPath = repoPath;
  }
}

/**
 * Error thrown when file chunking operations fail.
 *
 * Common causes include:
 * - Invalid configuration (overlap >= maxTokens)
 * - Chunk limit exceeded (>100 chunks)
 * - Hash computation failures
 * - Unexpected errors during chunking process
 *
 * @example
 * ```typescript
 * try {
 *   const chunks = await chunker.chunkFile(content, fileInfo, repo);
 * } catch (error) {
 *   if (error instanceof ChunkingError) {
 *     console.error(`Chunking failed for ${error.filePath}:`, error.message);
 *   }
 * }
 * ```
 */
export class ChunkingError extends RepositoryError {
  public readonly filePath: string;

  constructor(message: string, filePath: string, cause?: Error) {
    super(message, "CHUNKING_ERROR", cause);
    this.name = "ChunkingError";
    this.filePath = filePath;
  }
}

/**
 * Error thrown when fetching latest changes from remote fails.
 *
 * This error occurs when updating an existing local clone to match
 * the remote state. Common causes include:
 * - Network issues during fetch
 * - Branch no longer exists on remote
 * - Merge conflicts during reset (shouldn't happen with --hard)
 *
 * @example
 * `typescript
 * try {
 *   await cloner.clone(url, { fetchLatest: true });
 * } catch (error) {
 *   if (error instanceof FetchError) {
 *     console.error(Fetch failed for ${error.repoPath}:, error.message);
 *   }
 * }
 * `
 */
export class FetchError extends RepositoryError {
  public readonly repoPath: string;
  public readonly branch: string;

  constructor(message: string, repoPath: string, branch: string, cause?: Error) {
    super(message, "FETCH_ERROR", cause, true); // Retryable by default
    this.name = "FetchError";
    this.repoPath = repoPath;
    this.branch = branch;
  }
}

/**
 * Determine if an error is a retryable clone error based on its type and characteristics.
 *
 * Used to decide whether to retry a git clone operation after a failure.
 * Only network-related errors are retryable - authentication failures are not.
 *
 * @param error - The error to check
 * @returns true if the clone operation should be retried
 */
export function isRetryableCloneError(error: unknown): boolean {
  // Check our custom error types first
  if (error instanceof RepositoryError) {
    return error.retryable;
  }

  // For native errors, check for network-related messages
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
      "network",
      "could not resolve host",
      "failed to connect",
      "connection refused",
      "connection reset",
      "timeout",
    ];

    // Non-retryable patterns (authentication, not found)
    const nonRetryablePatterns = [
      "authentication failed",
      "could not read username",
      "not found",
      "403",
      "401",
      "permission denied",
      "invalid credentials",
    ];

    // If it matches a non-retryable pattern, don't retry
    if (nonRetryablePatterns.some((pattern) => message.includes(pattern))) {
      return false;
    }

    // If it matches a retryable pattern, retry
    return retryablePatterns.some((pattern) => message.includes(pattern));
  }

  // Unknown error types are not retryable by default
  return false;
}
