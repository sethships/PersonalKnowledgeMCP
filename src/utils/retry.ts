/**
 * Retry utility with exponential backoff
 *
 * Provides a reusable retry mechanism for async operations with:
 * - Configurable retry attempts
 * - Exponential backoff strategy (configurable multiplier)
 * - Conditional retry based on error type
 * - Support for retry-after headers
 * - Type-safe error handling
 * - Environment-based configuration
 */

import type pino from "pino";

/**
 * Configuration for retry behavior with exponential backoff
 *
 * @example
 * ```typescript
 * const config: RetryConfig = {
 *   maxRetries: 3,
 *   initialDelayMs: 1000,
 *   maxDelayMs: 60000,
 *   backoffMultiplier: 2,
 * };
 * // Delays: 1s → 2s → 4s (capped at 60s)
 * ```
 */
export interface RetryConfig {
  /**
   * Maximum number of retry attempts (0 = no retries, just initial attempt)
   * @default 3
   */
  maxRetries: number;

  /**
   * Initial delay in milliseconds before the first retry
   * @default 1000
   */
  initialDelayMs: number;

  /**
   * Maximum delay in milliseconds (caps exponential growth)
   * @default 60000
   */
  maxDelayMs: number;

  /**
   * Multiplier applied to delay after each retry attempt
   * @default 2
   */
  backoffMultiplier: number;
}

/**
 * Default retry configuration values
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 60000,
  backoffMultiplier: 2,
};

/**
 * Parse an environment variable as a non-negative integer
 *
 * Returns the default value if:
 * - The environment variable is not set
 * - The parsed value is NaN
 * - The parsed value is negative
 *
 * @param value - Environment variable value (may be undefined)
 * @param defaultVal - Default value to use if parsing fails
 * @returns Parsed non-negative integer or default
 */
function parseNonNegativeInt(value: string | undefined, defaultVal: number): number {
  if (value === undefined || value === "") {
    return defaultVal;
  }
  const parsed = parseInt(value, 10);
  return isNaN(parsed) || parsed < 0 ? defaultVal : parsed;
}

/**
 * Parse an environment variable as a positive float
 *
 * Returns the default value if:
 * - The environment variable is not set
 * - The parsed value is NaN
 * - The parsed value is zero or negative
 *
 * @param value - Environment variable value (may be undefined)
 * @param defaultVal - Default value to use if parsing fails
 * @returns Parsed positive float or default
 */
function parsePositiveFloat(value: string | undefined, defaultVal: number): number {
  if (value === undefined || value === "") {
    return defaultVal;
  }
  const parsed = parseFloat(value);
  return isNaN(parsed) || parsed <= 0 ? defaultVal : parsed;
}

/**
 * Load retry configuration from environment variables
 *
 * Reads the following environment variables:
 * - MAX_RETRIES: Maximum retry attempts (default: 3)
 * - RETRY_INITIAL_DELAY_MS: Initial delay in ms (default: 1000)
 * - RETRY_MAX_DELAY_MS: Maximum delay cap in ms (default: 60000)
 * - RETRY_BACKOFF_MULTIPLIER: Backoff multiplier (default: 2)
 *
 * Invalid values (NaN, negative, zero for multiplier) fall back to defaults.
 *
 * @returns RetryConfig with values from environment or defaults
 */
export function createRetryConfigFromEnv(): RetryConfig {
  return {
    maxRetries: parseNonNegativeInt(Bun.env["MAX_RETRIES"], DEFAULT_RETRY_CONFIG.maxRetries),
    initialDelayMs: parseNonNegativeInt(
      Bun.env["RETRY_INITIAL_DELAY_MS"],
      DEFAULT_RETRY_CONFIG.initialDelayMs
    ),
    maxDelayMs: parseNonNegativeInt(Bun.env["RETRY_MAX_DELAY_MS"], DEFAULT_RETRY_CONFIG.maxDelayMs),
    backoffMultiplier: parsePositiveFloat(
      Bun.env["RETRY_BACKOFF_MULTIPLIER"],
      DEFAULT_RETRY_CONFIG.backoffMultiplier
    ),
  };
}

/**
 * Create an exponential backoff calculator from retry configuration
 *
 * Calculates delay using the formula:
 * delay = min(initialDelayMs * (backoffMultiplier ^ attempt), maxDelayMs)
 *
 * @param config - Retry configuration with backoff parameters
 * @returns A function that calculates backoff delay for each attempt
 *
 * @example
 * ```typescript
 * const config = { initialDelayMs: 1000, maxDelayMs: 60000, backoffMultiplier: 2 };
 * const calculateBackoff = createExponentialBackoff(config);
 * // attempt 0: 1000ms
 * // attempt 1: 2000ms
 * // attempt 2: 4000ms
 * ```
 */
export function createExponentialBackoff(
  config: Pick<RetryConfig, "initialDelayMs" | "maxDelayMs" | "backoffMultiplier">
): (attempt: number, error: Error) => number {
  const { initialDelayMs, maxDelayMs, backoffMultiplier } = config;

  return (attempt: number, _error: Error): number => {
    const delay = initialDelayMs * Math.pow(backoffMultiplier, attempt);
    return Math.min(delay, maxDelayMs);
  };
}

/**
 * Create a standardized retry logger callback
 *
 * Produces consistent, structured log output for retry attempts.
 *
 * @param logger - Logger instance to use for output
 * @param operation - Human-readable name of the operation being retried
 * @param maxRetries - Maximum number of retries (for context in log message)
 * @returns An onRetry callback function for use with withRetry
 *
 * @example
 * ```typescript
 * const onRetry = createRetryLogger(logger, "ChromaDB query", 3);
 * await withRetry(operation, { maxRetries: 3, onRetry });
 * // Logs: { attempt: 1, maxRetries: 3, delayMs: 1000, ... } "Retrying ChromaDB query"
 * ```
 */
export function createRetryLogger(
  logger: pino.Logger,
  operation: string,
  maxRetries: number
): (attempt: number, error: Error, delayMs: number) => void {
  return (attempt: number, error: Error, delayMs: number): void => {
    logger.warn(
      {
        attempt: attempt + 1, // 1-based for human readability
        maxRetries,
        delayMs,
        error: error.message,
        errorType: error.constructor.name,
      },
      `Retrying ${operation}`
    );
  };
}

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

/**
 * Create RetryOptions from RetryConfig with optional overrides
 *
 * Convenience function to build complete RetryOptions from configuration.
 *
 * @param config - Retry configuration
 * @param overrides - Optional overrides for shouldRetry, onRetry, etc.
 * @returns Complete RetryOptions ready for use with withRetry
 *
 * @example
 * ```typescript
 * const config = createRetryConfigFromEnv();
 * const options = createRetryOptions(config, {
 *   shouldRetry: (error) => error instanceof NetworkError,
 *   onRetry: createRetryLogger(logger, "API call", config.maxRetries),
 * });
 * await withRetry(operation, options);
 * ```
 */
export function createRetryOptions(
  config: RetryConfig,
  overrides?: Partial<Omit<RetryOptions, "maxRetries">>
): RetryOptions {
  return {
    maxRetries: config.maxRetries,
    calculateBackoff: createExponentialBackoff(config),
    ...overrides,
  };
}
