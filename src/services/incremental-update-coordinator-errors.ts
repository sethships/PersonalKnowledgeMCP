/**
 * Custom error classes for incremental update coordinator.
 *
 * These errors signal specific failure conditions that may require
 * different handling strategies (e.g., triggering full re-index).
 *
 * @module services/incremental-update-coordinator-errors
 */

/**
 * Base error for coordinator operations.
 *
 * All coordinator-specific errors extend this base class for easy
 * type checking and error handling.
 */
export class CoordinatorError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean = false
  ) {
    super(message);
    this.name = "CoordinatorError";
    Object.setPrototypeOf(this, CoordinatorError.prototype);
  }
}

/**
 * Error thrown when repository metadata is not found.
 *
 * Indicates the repository has not been indexed yet or the name is incorrect.
 * Caller should verify repository name or perform initial indexing.
 *
 * @example
 * ```typescript
 * throw new RepositoryNotFoundError("my-api");
 * ```
 */
export class RepositoryNotFoundError extends CoordinatorError {
  constructor(public readonly repositoryName: string) {
    super(`Repository '${repositoryName}' not found in metadata store`, false);
    this.name = "RepositoryNotFoundError";
    Object.setPrototypeOf(this, RepositoryNotFoundError.prototype);
  }
}

/**
 * Error thrown when a force push is detected.
 *
 * This occurs when the last indexed commit SHA no longer exists in the
 * repository history (GitHub Compare API returns 404). Indicates repository
 * history was rewritten and requires full re-indexing.
 *
 * @example
 * ```typescript
 * throw new ForcePushDetectedError(
 *   "my-api",
 *   "abc123...",
 *   "def456..."
 * );
 * ```
 */
export class ForcePushDetectedError extends CoordinatorError {
  constructor(
    public readonly repositoryName: string,
    public readonly lastIndexedCommitSha: string,
    public readonly currentHeadSha: string
  ) {
    super(
      `Force push detected for repository '${repositoryName}'. ` +
        `Last indexed commit ${lastIndexedCommitSha.substring(0, 7)} no longer exists in history. ` +
        `Current HEAD is ${currentHeadSha.substring(0, 7)}. ` +
        `Full re-index required.`,
      false
    );
    this.name = "ForcePushDetectedError";
    Object.setPrototypeOf(this, ForcePushDetectedError.prototype);
  }
}

/**
 * Error thrown when file changes exceed the threshold for incremental updates.
 *
 * When more than 500 files are changed, it's more efficient to perform a
 * full re-index rather than processing each change incrementally.
 *
 * @example
 * ```typescript
 * throw new ChangeThresholdExceededError(
 *   "my-api",
 *   650,
 *   500
 * );
 * ```
 */
export class ChangeThresholdExceededError extends CoordinatorError {
  constructor(
    public readonly repositoryName: string,
    public readonly changeCount: number,
    public readonly threshold: number
  ) {
    super(
      `Change count (${changeCount}) exceeds threshold (${threshold}) for repository '${repositoryName}'. ` +
        `Full re-index required.`,
      false
    );
    this.name = "ChangeThresholdExceededError";
    Object.setPrototypeOf(this, ChangeThresholdExceededError.prototype);
  }
}

/**
 * Error thrown when git pull operation fails.
 *
 * Indicates the local clone could not be updated. Common causes:
 * - Merge conflicts
 * - Network connectivity issues
 * - Invalid git state
 *
 * @example
 * ```typescript
 * throw new GitPullError(
 *   "/repos/my-api",
 *   "Merge conflict in src/index.ts"
 * );
 * ```
 */
export class GitPullError extends CoordinatorError {
  constructor(
    public readonly localPath: string,
    public readonly reason: string
  ) {
    super(`Failed to update local clone at '${localPath}': ${reason}`, true);
    this.name = "GitPullError";
    Object.setPrototypeOf(this, GitPullError.prototype);
  }
}

/**
 * Error thrown when repository has no commit SHA recorded.
 *
 * This occurs when:
 * 1. Repository was indexed before incremental update feature
 * 2. Initial indexing failed to capture commit SHA
 *
 * Requires full re-index to establish baseline commit SHA.
 *
 * @example
 * ```typescript
 * throw new MissingCommitShaError("my-api");
 * ```
 */
export class MissingCommitShaError extends CoordinatorError {
  constructor(public readonly repositoryName: string) {
    super(
      `Repository '${repositoryName}' has no lastIndexedCommitSha recorded. ` +
        `Full re-index required to establish baseline.`,
      false
    );
    this.name = "MissingCommitShaError";
    Object.setPrototypeOf(this, MissingCommitShaError.prototype);
  }
}

/**
 * Error thrown when an update is already in progress for the repository.
 *
 * This prevents concurrent updates which could lead to data corruption
 * or inconsistent index state. The caller should wait for the current
 * update to complete or use --force to override.
 *
 * @example
 * ```typescript
 * throw new ConcurrentUpdateError(
 *   "my-api",
 *   "2024-12-14T10:00:00.000Z"
 * );
 * ```
 */
export class ConcurrentUpdateError extends CoordinatorError {
  constructor(
    public readonly repositoryName: string,
    public readonly updateStartedAt: string
  ) {
    super(
      `Update already in progress for repository '${repositoryName}' ` +
        `(started at ${updateStartedAt}). ` +
        `Wait for current update to complete or use --force to override.`,
      false
    );
    this.name = "ConcurrentUpdateError";
    Object.setPrototypeOf(this, ConcurrentUpdateError.prototype);
  }
}
