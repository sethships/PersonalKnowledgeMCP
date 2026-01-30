/**
 * @module services/change-detection-errors
 *
 * Error class hierarchy for ChangeDetectionService operations.
 *
 * This module follows the error pattern established in folder-watcher-errors.ts,
 * providing typed error classes with retryability indicators for proper error handling.
 */

// =============================================================================
// Base Error Class
// =============================================================================

/**
 * Base class for all ChangeDetection-related errors.
 *
 * @example
 * ```typescript
 * try {
 *   await changeDetectionService.processEvent(event);
 * } catch (error) {
 *   if (error instanceof ChangeDetectionError) {
 *     if (error.retryable) {
 *       // Retry the operation
 *     }
 *   }
 * }
 * ```
 */
export abstract class ChangeDetectionError extends Error {
  /**
   * Whether this error is transient and the operation can be retried.
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
// State Tracking Errors
// =============================================================================

/**
 * Thrown when file state capture fails.
 *
 * Retryable if the failure was due to a transient filesystem issue.
 * Not retryable if the file no longer exists (ENOENT).
 */
export class StateTrackingError extends ChangeDetectionError {
  /**
   * The file path that failed state capture.
   */
  public readonly filePath: string;

  /**
   * The underlying error that caused state capture to fail.
   */
  public override readonly cause?: Error;

  constructor(filePath: string, message: string, retryable: boolean = false, cause?: Error) {
    super(`Failed to capture state for '${filePath}': ${message}`, retryable);
    this.filePath = filePath;
    this.cause = cause;

    // Append cause stack to this error's stack if available
    if (cause?.stack) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }
  }
}

// =============================================================================
// Rename Correlation Errors
// =============================================================================

/**
 * Thrown when rename correlation encounters an error.
 *
 * These are typically non-fatal errors that indicate an edge case
 * in rename detection. The service will fall back to treating the
 * events as separate delete/add operations.
 */
export class RenameCorrelationError extends ChangeDetectionError {
  /**
   * The file path involved in the rename correlation.
   */
  public readonly filePath: string;

  /**
   * The correlation key that was being matched.
   */
  public readonly correlationKey?: string;

  /**
   * The underlying error that caused correlation to fail.
   */
  public override readonly cause?: Error;

  constructor(
    filePath: string,
    message: string,
    correlationKey?: string,
    retryable: boolean = false,
    cause?: Error
  ) {
    super(`Rename correlation failed for '${filePath}': ${message}`, retryable);
    this.filePath = filePath;
    this.correlationKey = correlationKey;
    this.cause = cause;

    // Append cause stack to this error's stack if available
    if (cause?.stack) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Type guard to check if an error is a ChangeDetectionError.
 *
 * @param error - Error to check
 * @returns true if error is a ChangeDetectionError
 */
export function isChangeDetectionError(error: unknown): error is ChangeDetectionError {
  return error instanceof ChangeDetectionError;
}

/**
 * Determine if a ChangeDetection error is retryable.
 *
 * @param error - Error to check
 * @returns true if the error is retryable
 */
export function isRetryableChangeDetectionError(error: unknown): boolean {
  if (error instanceof ChangeDetectionError) {
    return error.retryable;
  }
  return false;
}
