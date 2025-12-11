/**
 * Type definitions for repository ingestion.
 *
 * @module ingestion/types
 */

/**
 * Options for cloning a repository.
 */
export interface CloneOptions {
  /**
   * Override the auto-detected repository name.
   *
   * By default, the repository name is extracted from the URL.
   * Use this to specify a custom directory name.
   */
  name?: string;

  /**
   * Specific branch to clone.
   *
   * If not specified, the repository's default branch will be cloned.
   */
  branch?: string;

  /**
   * Perform a shallow clone (depth=1).
   *
   * @default true
   */
  shallow?: boolean;

  /**
   * Force re-clone by deleting existing directory.
   *
   * If false and the target directory exists, the clone will be skipped.
   *
   * @default false
   */
  fresh?: boolean;
}

/**
 * Result of a successful clone operation.
 */
export interface CloneResult {
  /**
   * Local filesystem path to the cloned repository.
   */
  path: string;

  /**
   * Repository name (directory name).
   */
  name: string;

  /**
   * Branch that was cloned.
   */
  branch: string;
}

/**
 * Configuration for the RepositoryCloner.
 */
export interface RepositoryClonerConfig {
  /**
   * Base directory where repositories will be cloned.
   *
   * Each repository will be cloned into a subdirectory: {clonePath}/{repo-name}
   */
  clonePath: string;

  /**
   * GitHub Personal Access Token for private repository access.
   *
   * Optional. Required only for cloning private repositories.
   * Should have 'repo' scope for private repository access.
   */
  githubPat?: string;
}
