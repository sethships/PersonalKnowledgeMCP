/**
 * @module services/processing-queue-errors
 *
 * Error class hierarchy for ProcessingQueue operations.
 *
 * This module follows the error pattern established in change-detection-errors.ts,
 * providing typed error classes with retryability indicators for proper error handling.
 */

// =============================================================================
// Base Error Class
// =============================================================================

/**
 * Base class for all ProcessingQueue-related errors.
 *
 * @example
 * ```typescript
 * try {
 *   await queue.enqueue(change);
 * } catch (error) {
 *   if (error instanceof ProcessingQueueError) {
 *     if (error.retryable) {
 *       // Queue might have capacity soon - retry after delay
 *     }
 *   }
 * }
 * ```
 */
export abstract class ProcessingQueueError extends Error {
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
// Capacity Errors
// =============================================================================

/**
 * Thrown when the queue is at maximum capacity and cannot accept new items.
 *
 * Retryable because queue capacity may free up after current batch completes.
 */
export class QueueFullError extends ProcessingQueueError {
  /**
   * Current number of items in the queue.
   */
  public readonly currentSize: number;

  /**
   * Maximum allowed queue size.
   */
  public readonly maxSize: number;

  constructor(currentSize: number, maxSize: number) {
    super(
      `Queue is full (${currentSize}/${maxSize} items). Wait for processing to complete.`,
      true
    );
    this.currentSize = currentSize;
    this.maxSize = maxSize;
  }
}

// =============================================================================
// State Errors
// =============================================================================

/**
 * Thrown when an operation is attempted on a stopped or draining queue.
 *
 * Not retryable because the queue has been permanently stopped.
 */
export class QueueStoppedError extends ProcessingQueueError {
  /**
   * The state the queue was in when the operation was attempted.
   */
  public readonly queueState: string;

  constructor(queueState: string) {
    super(`Cannot enqueue: queue is ${queueState}`, false);
    this.queueState = queueState;
  }
}

// =============================================================================
// Processing Errors
// =============================================================================

/**
 * Thrown when batch processing fails after all retry attempts.
 *
 * Retryability depends on the nature of the underlying failure:
 * - Transient errors (network, timeout) are retryable
 * - Permanent errors (validation, corruption) are not
 */
export class BatchProcessingError extends ProcessingQueueError {
  /**
   * Number of items in the failed batch.
   */
  public readonly batchSize: number;

  /**
   * Number of retry attempts made before failing.
   */
  public readonly attemptsMade: number;

  /**
   * The underlying error that caused batch processing to fail.
   */
  public override readonly cause?: Error;

  constructor(
    batchSize: number,
    attemptsMade: number,
    message: string,
    retryable: boolean = false,
    cause?: Error
  ) {
    super(
      `Batch processing failed after ${attemptsMade} attempt(s) ` +
        `(${batchSize} items): ${message}`,
      retryable
    );
    this.batchSize = batchSize;
    this.attemptsMade = attemptsMade;
    this.cause = cause;

    if (cause?.stack) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }
  }
}

// =============================================================================
// Shutdown Errors
// =============================================================================

/**
 * Thrown when graceful shutdown exceeds the configured timeout.
 *
 * Not retryable because the queue is being shut down.
 */
export class ShutdownTimeoutError extends ProcessingQueueError {
  /**
   * Number of items that were still in the queue when timeout expired.
   */
  public readonly remainingItems: number;

  /**
   * The shutdown timeout that was exceeded, in milliseconds.
   */
  public readonly timeoutMs: number;

  constructor(remainingItems: number, timeoutMs: number) {
    super(`Shutdown timed out after ${timeoutMs}ms with ${remainingItems} items remaining`, false);
    this.remainingItems = remainingItems;
    this.timeoutMs = timeoutMs;
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Type guard to check if an error is a ProcessingQueueError.
 *
 * @param error - Error to check
 * @returns true if error is a ProcessingQueueError
 */
export function isProcessingQueueError(error: unknown): error is ProcessingQueueError {
  return error instanceof ProcessingQueueError;
}

/**
 * Determine if a ProcessingQueue error is retryable.
 *
 * @param error - Error to check
 * @returns true if the error is retryable
 */
export function isRetryableProcessingQueueError(error: unknown): boolean {
  if (error instanceof ProcessingQueueError) {
    return error.retryable;
  }
  return false;
}
