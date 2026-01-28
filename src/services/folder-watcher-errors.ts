/**
 * @module services/folder-watcher-errors
 *
 * Error class hierarchy for FolderWatcherService operations.
 *
 * This module follows the error pattern established in graph-service-errors.ts,
 * providing typed error classes with retryability indicators for proper error handling.
 */

// =============================================================================
// Base Error Class
// =============================================================================

/**
 * Base class for all FolderWatcher-related errors
 *
 * @example
 * ```typescript
 * try {
 *   await watcher.startWatching(folder);
 * } catch (error) {
 *   if (error instanceof FolderWatcherError) {
 *     if (error.retryable) {
 *       // Retry the operation
 *     }
 *   }
 * }
 * ```
 */
export abstract class FolderWatcherError extends Error {
  /**
   * Whether this error is transient and the operation can be retried
   */
  public readonly retryable: boolean;

  constructor(message: string, retryable: boolean = false) {
    super(message);
    this.name = this.constructor.name;
    this.retryable = retryable;

    // Maintains proper stack trace for where error was thrown (V8 only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

// =============================================================================
// Folder Errors
// =============================================================================

/**
 * Thrown when a folder path does not exist or is not accessible
 *
 * Not retryable - the folder must exist and be accessible.
 */
export class FolderNotFoundError extends FolderWatcherError {
  /**
   * The folder path that was not found
   */
  public readonly folderPath: string;

  constructor(folderPath: string) {
    super(`Folder not found or not accessible: '${folderPath}'`, false);
    this.folderPath = folderPath;
  }
}

/**
 * Thrown when attempting to watch a folder that is already being watched
 *
 * Not retryable - stop watching first before starting again.
 */
export class FolderAlreadyWatchedError extends FolderWatcherError {
  /**
   * The folder ID that is already being watched
   */
  public readonly folderId: string;

  /**
   * The folder path that is already being watched
   */
  public readonly folderPath: string;

  constructor(folderId: string, folderPath: string) {
    super(`Folder is already being watched: '${folderPath}' (id: ${folderId})`, false);
    this.folderId = folderId;
    this.folderPath = folderPath;
  }
}

/**
 * Thrown when attempting to operate on a folder that is not being watched
 *
 * Not retryable - the folder must be watched first.
 */
export class FolderNotWatchedError extends FolderWatcherError {
  /**
   * The folder ID that is not being watched
   */
  public readonly folderId: string;

  constructor(folderId: string) {
    super(`Folder is not being watched: ${folderId}`, false);
    this.folderId = folderId;
  }
}

// =============================================================================
// Watcher Errors
// =============================================================================

/**
 * Thrown when watcher initialization fails
 *
 * Retryability depends on the underlying cause.
 */
export class WatcherInitializationError extends FolderWatcherError {
  /**
   * The folder path that failed to initialize
   */
  public readonly folderPath: string;

  /**
   * The underlying error that caused initialization to fail
   */
  public override readonly cause?: Error;

  constructor(folderPath: string, message: string, retryable: boolean = true, cause?: Error) {
    super(`Failed to initialize watcher for '${folderPath}': ${message}`, retryable);
    this.folderPath = folderPath;
    this.cause = cause;

    // Append cause stack to this error's stack if available
    if (cause?.stack) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }
  }
}

/**
 * Thrown when a watcher operation fails
 *
 * Retryability depends on the underlying cause.
 */
export class WatcherOperationError extends FolderWatcherError {
  /**
   * The folder ID where the operation failed
   */
  public readonly folderId: string;

  /**
   * The operation that failed
   */
  public readonly operation: string;

  /**
   * The underlying error that caused the operation to fail
   */
  public override readonly cause?: Error;

  constructor(
    folderId: string,
    operation: string,
    message: string,
    retryable: boolean = true,
    cause?: Error
  ) {
    super(`Watcher operation '${operation}' failed for folder ${folderId}: ${message}`, retryable);
    this.folderId = folderId;
    this.operation = operation;
    this.cause = cause;

    // Append cause stack to this error's stack if available
    if (cause?.stack) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }
  }
}

// =============================================================================
// Pattern Errors
// =============================================================================

/**
 * Thrown when a glob pattern is invalid
 *
 * Not retryable - the pattern must be corrected.
 */
export class InvalidPatternError extends FolderWatcherError {
  /**
   * The invalid pattern
   */
  public readonly pattern: string;

  /**
   * The type of pattern (include or exclude)
   */
  public readonly patternType: "include" | "exclude";

  constructor(pattern: string, patternType: "include" | "exclude", message: string) {
    super(`Invalid ${patternType} pattern '${pattern}': ${message}`, false);
    this.pattern = pattern;
    this.patternType = patternType;
  }
}

// =============================================================================
// Capacity Errors
// =============================================================================

/**
 * Thrown when the maximum number of concurrent watchers is reached
 *
 * Retryable - wait for other watchers to stop.
 */
export class MaxWatchersExceededError extends FolderWatcherError {
  /**
   * Current number of active watchers
   */
  public readonly currentWatchers: number;

  /**
   * Maximum allowed watchers
   */
  public readonly maxWatchers: number;

  constructor(currentWatchers: number, maxWatchers: number) {
    super(
      `Maximum concurrent watchers (${maxWatchers}) reached. Current: ${currentWatchers}`,
      true
    );
    this.currentWatchers = currentWatchers;
    this.maxWatchers = maxWatchers;
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Type guard to check if an error is a FolderWatcherError
 *
 * @param error - Error to check
 * @returns true if error is a FolderWatcherError
 */
export function isFolderWatcherError(error: unknown): error is FolderWatcherError {
  return error instanceof FolderWatcherError;
}

/**
 * Determine if a FolderWatcher error is retryable
 *
 * @param error - Error to check
 * @returns true if the error is retryable
 */
export function isRetryableFolderWatcherError(error: unknown): boolean {
  if (error instanceof FolderWatcherError) {
    return error.retryable;
  }
  return false;
}
