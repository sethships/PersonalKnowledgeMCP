/**
 * User Mapping Error Classes
 *
 * Domain-specific error types for user-to-instance mapping operations.
 * All errors include a retryable flag to guide error handling logic.
 *
 * @module auth/user-mapping/errors
 */

import { AuthError } from "../errors.js";

/**
 * Base class for user mapping errors
 *
 * Extends AuthError to maintain consistent error handling patterns.
 */
export class UserMappingError extends AuthError {
  constructor(message: string, code: string, retryable: boolean = false) {
    super(message, code, retryable);
  }
}

/**
 * User mapping is not configured or disabled
 *
 * Not retryable - requires configuration changes.
 */
export class UserMappingNotConfiguredError extends UserMappingError {
  constructor() {
    super("User mapping is not configured or is disabled", "USER_MAPPING_NOT_CONFIGURED", false);
  }
}

/**
 * Mapping rule not found by ID
 *
 * Not retryable - the rule does not exist.
 */
export class UserMappingRuleNotFoundError extends UserMappingError {
  constructor(public readonly ruleId: string) {
    super(`Mapping rule not found: ${ruleId}`, "USER_MAPPING_RULE_NOT_FOUND", false);
  }
}

/**
 * Mapping storage operation failed
 *
 * May be retryable depending on the underlying cause.
 */
export class UserMappingStorageError extends UserMappingError {
  /** Underlying error that caused the storage failure */
  public override readonly cause?: Error;

  constructor(
    public readonly operation: "read" | "write",
    message: string,
    cause?: Error,
    retryable: boolean = false
  ) {
    super(
      `User mapping storage ${operation} failed: ${message}`,
      "USER_MAPPING_STORAGE_ERROR",
      retryable
    );
    this.cause = cause;
  }
}

/**
 * Mapping rule validation failed
 *
 * Not retryable - the rule data is invalid.
 */
export class UserMappingValidationError extends UserMappingError {
  constructor(message: string) {
    super(`User mapping validation failed: ${message}`, "USER_MAPPING_VALIDATION_ERROR", false);
  }
}

/**
 * Duplicate mapping rule detected
 *
 * Not retryable - the rule already exists.
 */
export class UserMappingDuplicateRuleError extends UserMappingError {
  constructor(
    public readonly pattern: string,
    public readonly type: string
  ) {
    super(
      `Duplicate mapping rule: ${type} pattern "${pattern}" already exists`,
      "USER_MAPPING_DUPLICATE_RULE",
      false
    );
  }
}

/**
 * File watcher error
 *
 * Retryable - typically transient file system issues.
 */
export class UserMappingWatcherError extends UserMappingError {
  /** Underlying error that caused the watcher failure */
  public override readonly cause?: Error;

  constructor(message: string, cause?: Error) {
    super(`User mapping file watcher error: ${message}`, "USER_MAPPING_WATCHER_ERROR", true);
    this.cause = cause;
  }
}
