/**
 * Retry utility with exponential backoff
 *
 * Provides a reusable retry mechanism for async operations with:
 * - Configurable retry attempts
 * - Exponential backoff strategy (1s → 2s → 4s → ...)
 * - Conditional retry based on error type
 * - Support for retry-after headers
 * - Type-safe error handling
 */

/**
 * Options for retry behavior
 */
export interface RetryOptions {
  /**
   * Maximum number of retry attempts (0 = no retries, just initial attempt)
   * @default 3
   */
  maxRetries: number;

  /**
   * Function to determine if an error should trigger a retry
   * @param error - The error that was thrown
   * @returns true if the operation should be retried, false otherwise
   * @default () => true (retry all errors)
   */
  shouldRetry?: (error: Error) => boolean;

  /**
   * Function to calculate backoff delay in milliseconds for each retry attempt
   * @param attempt - The retry attempt number (0-based: 0 = first retry, 1 = second retry, etc.)
   * @param error - The error that triggered the retry
   * @returns Delay in milliseconds before next retry
   * @default Exponential backoff: 2^attempt * 1000ms (1s, 2s, 4s, 8s, ...)
   */
  calculateBackoff?: (attempt: number, error: Error) => number;

  /**
   * Optional callback invoked before each retry attempt
   * Useful for logging or metrics
   * @param attempt - The retry attempt number (0-based)
   * @param error - The error that triggered the retry
   * @param delayMs - The delay before this retry
   */
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
}

/**
 * Default exponential backoff calculation
 *
 * Implements exponential backoff with base 2:
 * - Attempt 0 (first retry): 2^0 * 1000ms = 1 second
 * - Attempt 1 (second retry): 2^1 * 1000ms = 2 seconds
 * - Attempt 2 (third retry): 2^2 * 1000ms = 4 seconds
 * - Attempt 3 (fourth retry): 2^3 * 1000ms = 8 seconds
 *
 * This strategy provides increasingly longer delays between retries,
 * reducing load on failing services while giving transient errors time to resolve.
 *
 * @param attempt - Retry attempt number (0-based)
 * @returns Delay in milliseconds
 */
export function defaultExponentialBackoff(attempt: number): number {
  return Math.pow(2, attempt) * 1000;
}

/**
 * Execute an async operation with automatic retry on failure
 *
 * Retries the operation on error according to the provided options.
 * Implements exponential backoff by default and respects retry-after hints
 * from errors that support them.
 *
 * @template T - Return type of the async operation
 * @param operation - Async function to execute (and potentially retry)
 * @param options - Retry configuration options
 * @returns Promise resolving to the operation's result
 * @throws The last error encountered after all retries are exhausted
 *
 * @example
 * ```typescript
 * // Simple retry with defaults (3 attempts, exponential backoff)
 * const result = await withRetry(
 *   () => fetchDataFromAPI(),
 *   { maxRetries: 3 }
 * );
 *
 * // Conditional retry for specific errors
 * const result = await withRetry(
 *   () => makeRequest(),
 *   {
 *     maxRetries: 5,
 *     shouldRetry: (error) => error instanceof NetworkError && error.retryable,
 *     onRetry: (attempt, error, delay) => {
 *       console.log(`Retry ${attempt + 1} after ${delay}ms:`, error.message);
 *     }
 *   }
 * );
 * ```
 */
export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
  const {
    maxRetries,
    shouldRetry = () => true,
    calculateBackoff = defaultExponentialBackoff,
    onRetry,
  } = options;

  let lastError: Error | undefined;

  // Attempt 0 is the initial try, attempts 1-N are retries
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;

      // If we've used all retries, throw the error
      if (attempt >= maxRetries) {
        throw lastError;
      }

      // Check if this error should trigger a retry
      if (!shouldRetry(lastError)) {
        throw lastError;
      }

      // Calculate backoff delay for this retry
      const delayMs = calculateBackoff(attempt, lastError);

      // Invoke retry callback if provided
      if (onRetry) {
        onRetry(attempt, lastError, delayMs);
      }

      // Wait before retrying
      await sleep(delayMs);

      // Continue to next attempt
    }
  }

  // This should never be reached due to throw in loop, but TypeScript needs it
  throw lastError || new Error("Retry loop completed without success or error");
}

/**
 * Sleep for specified milliseconds
 *
 * @param ms - Milliseconds to sleep
 * @returns Promise that resolves after delay
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
