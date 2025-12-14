/**
 * Error classes for GitHub Client
 *
 * This module defines domain-specific error types for GitHub API operations.
 * All errors include a retryable flag to guide error handling logic.
 */

/**
 * Base class for all GitHub client-related errors
 */
export abstract class GitHubClientError extends Error {
  public abstract readonly code: string;
  public readonly retryable: boolean;
  public override readonly cause?: unknown;

  constructor(message: string, retryable: boolean = false, cause?: unknown) {
    super(message);
    this.name = this.constructor.name;
    this.retryable = retryable;
    this.cause = cause;
    // V8-specific - only available in Node.js/Bun, not all runtimes
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Thrown when GitHub API authentication fails
 * Not retryable - token must be fixed
 */
export class GitHubAuthenticationError extends GitHubClientError {
  public readonly code = "GITHUB_AUTH_ERROR" as const;

  constructor(message: string = "GitHub authentication failed", cause?: unknown) {
    super(message, false, cause);
  }
}

/**
 * Thrown when GitHub API rate limit is exceeded
 * Retryable - should wait and retry
 */
export class GitHubRateLimitError extends GitHubClientError {
  public readonly code = "GITHUB_RATE_LIMIT" as const;
  public readonly resetAt?: Date;
  public readonly remaining?: number;

  constructor(message: string, resetAt?: Date, remaining?: number, cause?: unknown) {
    super(message, true, cause);
    this.resetAt = resetAt;
    this.remaining = remaining;
  }
}

/**
 * Thrown when requested resource (repo, branch, commit) is not found
 * Not retryable - resource does not exist
 */
export class GitHubNotFoundError extends GitHubClientError {
  public readonly code = "GITHUB_NOT_FOUND" as const;
  public readonly resource?: string;

  constructor(message: string, resource?: string, cause?: unknown) {
    super(message, false, cause);
    this.resource = resource;
  }
}

/**
 * Thrown when network-level errors occur
 * Retryable - transient network issues
 */
export class GitHubNetworkError extends GitHubClientError {
  public readonly code = "GITHUB_NETWORK_ERROR" as const;

  constructor(message: string, cause?: unknown) {
    super(message, true, cause);
  }
}

/**
 * Thrown when GitHub API returns an unexpected error
 * Retryability depends on HTTP status code
 */
export class GitHubAPIError extends GitHubClientError {
  public readonly code = "GITHUB_API_ERROR" as const;
  public readonly statusCode: number;
  public readonly statusText?: string;

  constructor(
    message: string,
    statusCode: number,
    statusText?: string,
    retryable: boolean = false,
    cause?: unknown
  ) {
    super(message, retryable, cause);
    this.statusCode = statusCode;
    this.statusText = statusText;
  }
}

/**
 * Thrown when input validation fails
 * Not retryable - client must fix input
 */
export class GitHubValidationError extends GitHubClientError {
  public readonly code = "GITHUB_VALIDATION_ERROR" as const;
  public readonly validationErrors: string[];

  constructor(message: string, validationErrors: string[] = []) {
    super(message, false);
    this.validationErrors = validationErrors;
  }
}

/**
 * Determine if an error is retryable based on its type and properties
 *
 * @param error - The error to check
 * @returns true if the error is retryable, false otherwise
 */
export function isRetryableGitHubError(error: unknown): boolean {
  if (error instanceof GitHubClientError) {
    return error.retryable;
  }
  return false;
}

/**
 * Determine if an HTTP status code indicates a retryable error
 *
 * Retryable status codes:
 * - 408: Request Timeout
 * - 429: Too Many Requests (rate limit)
 * - 500: Internal Server Error
 * - 502: Bad Gateway
 * - 503: Service Unavailable
 * - 504: Gateway Timeout
 *
 * @param statusCode - HTTP status code
 * @returns true if the status code indicates a retryable error
 */
export function isRetryableStatusCode(statusCode: number): boolean {
  return [408, 429, 500, 502, 503, 504].includes(statusCode);
}
