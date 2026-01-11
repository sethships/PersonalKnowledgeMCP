/**
 * @module services/graph-service-errors
 *
 * Error class hierarchy for GraphService operations.
 *
 * This module follows the error pattern established by SearchError in errors.ts,
 * providing typed error classes with retryability indicators for proper error handling.
 */

// =============================================================================
// Base Error Class
// =============================================================================

/**
 * Base class for all GraphService-related errors
 *
 * @example
 * ```typescript
 * try {
 *   await graphService.getDependencies(query);
 * } catch (error) {
 *   if (error instanceof GraphServiceError) {
 *     if (error.retryable) {
 *       // Retry the operation
 *     }
 *   }
 * }
 * ```
 */
export abstract class GraphServiceError extends Error {
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
// Validation Errors
// =============================================================================

/**
 * Thrown when query parameters fail validation
 *
 * Not retryable - client must fix input parameters.
 */
export class GraphServiceValidationError extends GraphServiceError {
  /**
   * Individual validation error messages
   */
  public readonly validationErrors?: string[];

  constructor(message: string, validationErrors?: string[]) {
    super(message, false);
    this.validationErrors = validationErrors;
  }
}

// =============================================================================
// Operation Errors
// =============================================================================

/**
 * Thrown when a graph operation fails
 *
 * Retryability depends on the underlying cause - transient failures
 * (network issues, timeouts) are retryable, while permanent failures
 * (invalid data, schema errors) are not.
 */
export class GraphServiceOperationError extends GraphServiceError {
  /**
   * The underlying error that caused this operation to fail
   */
  public override readonly cause?: Error;

  constructor(message: string, retryable: boolean = true, cause?: Error) {
    super(message, retryable);
    this.cause = cause;

    // Append cause stack to this error's stack if available
    if (cause?.stack) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }
  }
}

/**
 * Thrown when a target entity is not found in the graph
 *
 * Not retryable - the entity must be indexed first.
 */
export class EntityNotFoundError extends GraphServiceError {
  /**
   * Type of the entity that was not found
   */
  public readonly entityType: string;

  /**
   * Path or identifier of the entity
   */
  public readonly entityPath: string;

  /**
   * Repository where the entity was expected
   */
  public readonly repository?: string;

  constructor(entityType: string, entityPath: string, repository?: string) {
    const repoSuffix = repository ? ` in repository '${repository}'` : "";
    super(`Entity not found: ${entityType} '${entityPath}'${repoSuffix}`, false);
    this.entityType = entityType;
    this.entityPath = entityPath;
    this.repository = repository;
  }
}

// =============================================================================
// Timeout Errors
// =============================================================================

/**
 * Thrown when a query times out
 *
 * Retryable by default - timeouts are often transient.
 */
export class GraphServiceTimeoutError extends GraphServiceError {
  /**
   * Timeout duration in milliseconds
   */
  public readonly timeoutMs: number;

  constructor(message: string, timeoutMs: number) {
    super(message, true);
    this.timeoutMs = timeoutMs;
  }
}

// =============================================================================
// Cache Errors
// =============================================================================

/**
 * Thrown when a cache operation fails
 *
 * Not retryable - cache failures should not block the main operation.
 * The service should continue without caching.
 *
 * @internal Not currently used but reserved for future cache-specific error handling
 */
export class CacheError extends GraphServiceError {
  /**
   * The underlying error that caused the cache failure
   */
  public override readonly cause?: Error;

  constructor(message: string, cause?: Error) {
    super(message, false);
    this.cause = cause;
  }
}

// =============================================================================
// Repository Errors
// =============================================================================

/**
 * Thrown when a repository is not found or not indexed
 *
 * Not retryable - the repository must be indexed first.
 *
 * @internal Not currently used but reserved for repository-specific validation
 */
export class RepositoryNotIndexedError extends GraphServiceError {
  /**
   * Name of the repository that is not indexed
   */
  public readonly repositoryName: string;

  constructor(repositoryName: string) {
    super(`Repository '${repositoryName}' is not indexed in the knowledge graph`, false);
    this.repositoryName = repositoryName;
  }
}

// =============================================================================
// Path Errors
// =============================================================================

/**
 * Thrown when no path exists between two entities
 *
 * Not retryable - this is a valid result, not an error condition.
 * This error is typically not thrown; instead, PathResult.path_exists = false.
 * However, it's provided for edge cases where an error is more appropriate.
 *
 * @internal Not currently used - PathResult.path_exists = false is preferred
 */
export class NoPathFoundError extends GraphServiceError {
  /**
   * Source entity that was searched from
   */
  public readonly fromEntity: string;

  /**
   * Target entity that was searched to
   */
  public readonly toEntity: string;

  constructor(fromEntity: string, toEntity: string) {
    super(`No path found from '${fromEntity}' to '${toEntity}'`, false);
    this.fromEntity = fromEntity;
    this.toEntity = toEntity;
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Type guard to check if an error is a GraphServiceError
 *
 * @param error - Error to check
 * @returns true if error is a GraphServiceError
 */
export function isGraphServiceError(error: unknown): error is GraphServiceError {
  return error instanceof GraphServiceError;
}

/**
 * Determine if a GraphService error is retryable
 *
 * @param error - Error to check
 * @returns true if the error is retryable
 */
export function isRetryableServiceError(error: unknown): boolean {
  if (error instanceof GraphServiceError) {
    return error.retryable;
  }
  return false;
}
