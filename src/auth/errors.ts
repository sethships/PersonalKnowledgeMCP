/**
 * Authentication Module Error Classes
 *
 * Domain-specific error types for token authentication operations.
 * All errors include a retryable flag to guide error handling logic.
 *
 * @module auth/errors
 */

/**
 * Base class for all authentication-related errors
 *
 * Provides consistent structure with error code and retryable flag
 * for downstream error handling.
 */
export abstract class AuthError extends Error {
  /** Whether the operation can be retried */
  public readonly retryable: boolean;

  /** Error code for programmatic handling */
  public readonly code: string;

  constructor(message: string, code: string, retryable: boolean = false) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.retryable = retryable;

    // V8-specific stack trace capture (available in Node.js/Bun)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Token validation failed (format, checksum, etc.)
 *
 * Not retryable - client must provide a valid token format.
 */
export class TokenValidationError extends AuthError {
  constructor(message: string) {
    super(message, "TOKEN_VALIDATION_ERROR", false);
  }
}

/**
 * Token not found in store
 *
 * Not retryable - the token does not exist.
 */
export class TokenNotFoundError extends AuthError {
  constructor(public readonly tokenHash: string) {
    super(`Token not found: ${tokenHash.substring(0, 8)}...`, "TOKEN_NOT_FOUND", false);
  }
}

/**
 * Token has been revoked
 *
 * Not retryable - the token is permanently invalid.
 */
export class TokenRevokedError extends AuthError {
  constructor(public readonly tokenHash: string) {
    super(`Token has been revoked: ${tokenHash.substring(0, 8)}...`, "TOKEN_REVOKED", false);
  }
}

/**
 * Token has expired
 *
 * Not retryable - the token is permanently invalid.
 */
export class TokenExpiredError extends AuthError {
  constructor(
    public readonly tokenHash: string,
    public readonly expiredAt: string
  ) {
    super(`Token expired at ${expiredAt}`, "TOKEN_EXPIRED", false);
  }
}

/**
 * Insufficient permissions (missing required scopes)
 *
 * Not retryable - the token lacks required permissions.
 * Client must use a token with appropriate scopes.
 */
export class InsufficientScopesError extends AuthError {
  constructor(
    public readonly requiredScopes: string[],
    public readonly presentScopes: string[]
  ) {
    super(
      `Insufficient scopes. Required: [${requiredScopes.join(", ")}], Present: [${presentScopes.join(", ")}]`,
      "INSUFFICIENT_SCOPES",
      false
    );
  }
}

/**
 * Instance access denied
 *
 * Not retryable - the token lacks required instance access.
 * Client must use a token with appropriate instance access.
 */
export class InstanceAccessDeniedError extends AuthError {
  constructor(
    public readonly requiredAccess: string[],
    public readonly presentAccess: string[]
  ) {
    super(
      `Instance access denied. Required: [${requiredAccess.join(", ")}], Present: [${presentAccess.join(", ")}]`,
      "INSTANCE_ACCESS_DENIED",
      false
    );
  }
}

/**
 * Token storage operation failed
 *
 * May be retryable depending on the underlying cause
 * (e.g., transient file system issues).
 */
export class TokenStorageError extends AuthError {
  /** Underlying error that caused the storage failure */
  public override readonly cause?: Error;

  constructor(
    public readonly operation: "read" | "write",
    message: string,
    cause?: Error,
    retryable: boolean = false
  ) {
    super(`Token storage ${operation} failed: ${message}`, "TOKEN_STORAGE_ERROR", retryable);
    this.cause = cause;
  }
}

/**
 * Token generation failed
 *
 * Not retryable - likely a configuration or system issue.
 */
export class TokenGenerationError extends AuthError {
  /** Underlying error that caused the generation failure */
  public override readonly cause?: Error;

  constructor(message: string, cause?: Error) {
    super(`Token generation failed: ${message}`, "TOKEN_GENERATION_ERROR", false);
    this.cause = cause;
  }
}
