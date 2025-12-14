/**
 * Type definitions for GitHub API Client
 *
 * This module defines interfaces for the GitHub client service used to detect
 * file changes between commits for incremental repository updates.
 */

/**
 * Represents a file change detected between two commits
 */
export interface FileChange {
  /** Path to the changed file */
  path: string;
  /** Type of change */
  status: "added" | "modified" | "deleted" | "renamed";
  /** Previous path for renamed files */
  previousPath?: string;
}

/**
 * Information about a Git commit
 */
export interface CommitInfo {
  /** Full SHA of the commit */
  sha: string;
  /** Commit message (first line) */
  message: string;
  /** Author name */
  author: string;
  /** ISO 8601 timestamp of the commit */
  date: string;
}

/**
 * Comparison result between two commits
 */
export interface CommitComparison {
  /** Base commit SHA */
  baseSha: string;
  /** Head commit SHA */
  headSha: string;
  /** Number of commits between base and head */
  totalCommits: number;
  /** List of file changes */
  files: FileChange[];
}

/**
 * Configuration for the GitHub client
 */
export interface GitHubClientConfig {
  /** GitHub Personal Access Token for authentication */
  token?: string;
  /** Base URL for GitHub API (default: https://api.github.com) */
  baseUrl?: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeoutMs?: number;
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
}

/**
 * GitHub client service interface for change detection
 */
export interface GitHubClient {
  /**
   * Get the HEAD commit information for a repository branch
   *
   * @param owner - Repository owner (user or organization)
   * @param repo - Repository name
   * @param branch - Branch name (default: repository's default branch)
   * @returns Commit information for the HEAD of the branch
   * @throws GitHubNotFoundError if repository or branch not found
   * @throws GitHubAuthenticationError if authentication fails
   * @throws GitHubRateLimitError if rate limit exceeded
   */
  getHeadCommit(owner: string, repo: string, branch?: string): Promise<CommitInfo>;

  /**
   * Compare two commits and get the list of changed files
   *
   * @param owner - Repository owner (user or organization)
   * @param repo - Repository name
   * @param base - Base commit SHA or branch name
   * @param head - Head commit SHA or branch name
   * @returns Comparison result with list of file changes
   * @throws GitHubNotFoundError if repository or commits not found
   * @throws GitHubAuthenticationError if authentication fails
   * @throws GitHubRateLimitError if rate limit exceeded
   */
  compareCommits(
    owner: string,
    repo: string,
    base: string,
    head: string
  ): Promise<CommitComparison>;

  /**
   * Check if the GitHub API is accessible and authenticated
   *
   * @returns true if API is accessible, false otherwise
   */
  healthCheck(): Promise<boolean>;
}
