/**
 * Custom error classes for embedding provider operations
 *
 * These error classes provide structured error handling for embedding generation,
 * making it easier to diagnose issues and implement intelligent retry logic.
 */

/**
 * Sanitize error messages to remove API keys and other sensitive data
 *
 * @param message - The error message to sanitize
 * @returns Sanitized message with API keys redacted
 */
function sanitizeMessage(message: string): string {
  // Remove OpenAI API keys (sk-... or sk-proj-... format)
  // Matches: sk- followed by any alphanumeric characters, hyphens, or underscores (20+ chars total after sk-)
  let sanitized = message.replace(/sk-[a-zA-Z0-9_-]{20,}/g, "sk-***REDACTED***");
  // Remove any long alphanumeric strings that might be tokens/keys (40+ consecutive alphanumeric)
  sanitized = sanitized.replace(/\b[a-zA-Z0-9]{40,}\b/g, "***REDACTED***");
  return sanitized;
}

/**
 * Base error class for all embedding-related errors
 *
 * Extends the native Error class with additional context including error codes,
 * retryability flags, and cause chaining for integration with error handling systems.
 */
export class EmbeddingError extends Error {
  /**
   * Error code for categorization and handling
   */
  public readonly code: string;

  /**
   * Indicates whether this error represents a transient failure that may succeed on retry
   */
  public readonly retryable: boolean;

  /**
   * Original error that caused this error (if any)
   *
   * NOTE: Uses 'override' to explicitly shadow ES2022 Error.cause property.
   * This provides type safety by restricting cause to Error instances only,
   * whereas the built-in property allows any unknown value.
   */
  public override readonly cause?: Error;

  /**
   * Create a new EmbeddingError
   *
   * @param message - Human-readable error message
   * @param code - Error code for categorization (default: 'EMBEDDING_ERROR')
   * @param retryable - Whether this error is retryable (default: false)
   * @param cause - Original error that caused this error
   */
  constructor(
    message: string,
    code: string = "EMBEDDING_ERROR",
    retryable: boolean = false,
    cause?: Error
  ) {
    // Sanitize message to prevent API key leakage
    super(sanitizeMessage(message));
    this.name = "EmbeddingError";
    this.code = code;
    this.retryable = retryable;
    this.cause = cause;

    // Maintain proper stack trace for where our error was thrown (V8 only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }

    // Include cause stack trace if available
    if (cause && cause.stack) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }
  }
}

/**
 * Error thrown when authentication with the embedding provider fails
 *
 * This error indicates invalid API credentials or insufficient permissions.
 * This is NOT retryable as the credentials need to be corrected.
 *
 * Common causes:
 * - Invalid API key
 * - Expired API key
 * - API key without required permissions
 * - Missing API key
 *
 * @example
 * ```typescript
 * try {
 *   await provider.generateEmbedding("test");
 * } catch (error) {
 *   if (error instanceof EmbeddingAuthenticationError) {
 *     console.error("Check your OPENAI_API_KEY environment variable");
 *   }
 * }
 * ```
 */
export class EmbeddingAuthenticationError extends EmbeddingError {
  constructor(message: string, cause?: Error) {
    super(sanitizeMessage(message), "AUTHENTICATION_ERROR", false, cause);
    this.name = "EmbeddingAuthenticationError";
  }
}

/**
 * Error thrown when the embedding provider rate limit is exceeded
 *
 * This error indicates too many requests in a short time period.
 * This IS retryable with exponential backoff.
 *
 * @example
 * ```typescript
 * try {
 *   await provider.generateEmbeddings(largeArray);
 * } catch (error) {
 *   if (error instanceof EmbeddingRateLimitError) {
 *     const retryAfter = error.retryAfterMs || 1000;
 *     console.log(`Rate limited. Retry after ${retryAfter}ms`);
 *   }
 * }
 * ```
 */
export class EmbeddingRateLimitError extends EmbeddingError {
  /**
   * Suggested delay in milliseconds before retrying (from Retry-After header if available)
   */
  public readonly retryAfterMs?: number;

  constructor(message: string, retryAfterMs?: number, cause?: Error) {
    super(message, "RATE_LIMIT_ERROR", true, cause);
    this.name = "EmbeddingRateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Error thrown when network connectivity issues prevent embedding generation
 *
 * This error indicates transient network failures.
 * This IS retryable as the network issue may be temporary.
 *
 * Common causes:
 * - DNS resolution failures
 * - Connection refused
 * - Network timeout
 * - Proxy errors
 *
 * @example
 * ```typescript
 * try {
 *   await provider.generateEmbedding("test");
 * } catch (error) {
 *   if (error instanceof EmbeddingNetworkError) {
 *     console.error("Network issue, will retry...");
 *   }
 * }
 * ```
 */
export class EmbeddingNetworkError extends EmbeddingError {
  constructor(message: string, cause?: Error) {
    super(message, "NETWORK_ERROR", true, cause);
    this.name = "EmbeddingNetworkError";
  }
}

/**
 * Error thrown when an embedding request times out
 *
 * This error indicates the request took longer than the configured timeout.
 * This IS retryable as the next attempt may succeed faster.
 *
 * @example
 * ```typescript
 * try {
 *   await provider.generateEmbedding("test");
 * } catch (error) {
 *   if (error instanceof EmbeddingTimeoutError) {
 *     console.error("Request timed out, will retry...");
 *   }
 * }
 * ```
 */
export class EmbeddingTimeoutError extends EmbeddingError {
  constructor(message: string, cause?: Error) {
    super(message, "TIMEOUT_ERROR", true, cause);
    this.name = "EmbeddingTimeoutError";
  }
}

/**
 * Error thrown when input validation fails
 *
 * This error indicates invalid input parameters (e.g., empty text, invalid dimensions).
 * This is NOT retryable as the input needs to be corrected.
 *
 * Common causes:
 * - Empty or whitespace-only text
 * - Non-string input
 * - Empty array
 * - Invalid configuration
 *
 * @example
 * ```typescript
 * try {
 *   await provider.generateEmbedding("");
 * } catch (error) {
 *   if (error instanceof EmbeddingValidationError) {
 *     console.error("Invalid input:", error.message);
 *   }
 * }
 * ```
 */
export class EmbeddingValidationError extends EmbeddingError {
  /**
   * The parameter name that failed validation (if applicable)
   */
  public readonly parameterName?: string;

  constructor(message: string, parameterName?: string, cause?: Error) {
    super(message, "VALIDATION_ERROR", false, cause);
    this.name = "EmbeddingValidationError";
    this.parameterName = parameterName;
  }
}
