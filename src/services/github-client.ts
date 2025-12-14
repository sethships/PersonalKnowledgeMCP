/**
 * GitHub API Client Implementation
 *
 * Provides methods for detecting file changes between commits to enable
 * incremental repository updates. Uses GitHub's REST API with proper
 * authentication, rate limit handling, and error recovery.
 */

import type { Logger } from "pino";
import { ZodError } from "zod";

import { getComponentLogger } from "../logging/index.js";
import { withRetry } from "../utils/retry.js";

import type {
  GitHubClient,
  GitHubClientConfig,
  CommitInfo,
  CommitComparison,
  FileChange,
} from "./github-client-types.js";
import {
  GitHubAuthenticationError,
  GitHubRateLimitError,
  GitHubNotFoundError,
  GitHubNetworkError,
  GitHubAPIError,
  GitHubValidationError,
  isRetryableStatusCode,
} from "./github-client-errors.js";
import {
  GitHubClientConfigSchema,
  GetHeadCommitSchema,
  CompareCommitsSchema,
  type ValidatedGitHubClientConfig,
} from "./github-client-validation.js";

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: Required<Omit<GitHubClientConfig, "token">> & { token?: string } = {
  token: undefined,
  baseUrl: "https://api.github.com",
  timeoutMs: 30000,
  maxRetries: 3,
};

/**
 * GitHub API response types (internal)
 */
interface GitHubCommitResponse {
  sha: string;
  commit: {
    message: string;
    author: {
      name: string;
      date: string;
    };
  };
}

interface GitHubCompareResponse {
  base_commit: { sha: string };
  merge_base_commit: { sha: string };
  status: string;
  ahead_by: number;
  behind_by: number;
  total_commits: number;
  commits: Array<{ sha: string }>;
  files?: Array<{
    filename: string;
    status: string;
    previous_filename?: string;
  }>;
}

/**
 * Implementation of GitHubClient for change detection
 */
export class GitHubClientImpl implements GitHubClient {
  private readonly config: ValidatedGitHubClientConfig;
  private _logger: Logger | null = null;

  constructor(config: GitHubClientConfig = {}) {
    try {
      this.config = GitHubClientConfigSchema.parse({
        ...DEFAULT_CONFIG,
        ...config,
      });
    } catch (error) {
      if (error instanceof ZodError) {
        const messages = error.issues.map((e) => `${e.path.join(".")}: ${e.message}`);
        throw new GitHubValidationError("Invalid GitHub client configuration", messages);
      }
      throw error;
    }
  }

  /**
   * Lazy-initialized logger
   */
  private get logger(): Logger {
    if (!this._logger) {
      this._logger = getComponentLogger("services:github-client");
    }
    return this._logger;
  }

  /**
   * Get the HEAD commit information for a repository branch
   */
  async getHeadCommit(owner: string, repo: string, branch?: string): Promise<CommitInfo> {
    // Validate input
    const validated = this.validateGetHeadCommit(owner, repo, branch);

    const ref = validated.branch || "HEAD";
    const url = `${this.config.baseUrl}/repos/${validated.owner}/${validated.repo}/commits/${ref}`;

    this.logger.debug(
      { owner: validated.owner, repo: validated.repo, ref },
      "Fetching HEAD commit"
    );

    const startTime = Date.now();

    try {
      const response = await this.fetchWithRetry<GitHubCommitResponse>(url);

      const commitInfo: CommitInfo = {
        sha: response.sha,
        message: response.commit.message.split("\n")[0] ?? response.commit.message, // First line only
        author: response.commit.author.name,
        date: response.commit.author.date,
      };

      this.logger.info(
        {
          owner: validated.owner,
          repo: validated.repo,
          ref,
          sha: commitInfo.sha.substring(0, 7),
          durationMs: Date.now() - startTime,
        },
        "Retrieved HEAD commit"
      );

      return commitInfo;
    } catch (error) {
      this.logger.error(
        {
          owner: validated.owner,
          repo: validated.repo,
          ref,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - startTime,
        },
        "Failed to fetch HEAD commit"
      );
      throw error;
    }
  }

  /**
   * Compare two commits and get the list of changed files
   */
  async compareCommits(
    owner: string,
    repo: string,
    base: string,
    head: string
  ): Promise<CommitComparison> {
    // Validate input
    const validated = this.validateCompareCommits(owner, repo, base, head);

    const url = `${this.config.baseUrl}/repos/${validated.owner}/${validated.repo}/compare/${validated.base}...${validated.head}`;

    this.logger.debug(
      { owner: validated.owner, repo: validated.repo, base: validated.base, head: validated.head },
      "Comparing commits"
    );

    const startTime = Date.now();

    try {
      const response = await this.fetchWithRetry<GitHubCompareResponse>(url);

      const files = this.parseFileChanges(response.files || []);

      // Get head SHA from commits array or fall back to merge base
      const lastCommit = response.commits[response.commits.length - 1];
      const headSha = lastCommit?.sha ?? response.merge_base_commit.sha;

      const comparison: CommitComparison = {
        baseSha: response.base_commit.sha,
        headSha,
        totalCommits: response.total_commits,
        files,
      };

      this.logger.info(
        {
          owner: validated.owner,
          repo: validated.repo,
          base: validated.base,
          head: validated.head,
          totalCommits: comparison.totalCommits,
          filesChanged: files.length,
          durationMs: Date.now() - startTime,
        },
        "Compared commits"
      );

      return comparison;
    } catch (error) {
      this.logger.error(
        {
          owner: validated.owner,
          repo: validated.repo,
          base: validated.base,
          head: validated.head,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - startTime,
        },
        "Failed to compare commits"
      );
      throw error;
    }
  }

  /**
   * Check if the GitHub API is accessible and authenticated
   */
  async healthCheck(): Promise<boolean> {
    const url = `${this.config.baseUrl}/rate_limit`;

    try {
      await this.fetchWithRetry<unknown>(url);
      return true;
    } catch (error) {
      this.logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "GitHub API health check failed"
      );
      return false;
    }
  }

  /**
   * Validate getHeadCommit parameters
   */
  private validateGetHeadCommit(
    owner: string,
    repo: string,
    branch?: string
  ): { owner: string; repo: string; branch?: string } {
    try {
      return GetHeadCommitSchema.parse({ owner, repo, branch });
    } catch (error) {
      if (error instanceof ZodError) {
        const messages = error.issues.map((e) => `${e.path.join(".")}: ${e.message}`);
        throw new GitHubValidationError("Invalid getHeadCommit parameters", messages);
      }
      throw error;
    }
  }

  /**
   * Validate compareCommits parameters
   */
  private validateCompareCommits(
    owner: string,
    repo: string,
    base: string,
    head: string
  ): { owner: string; repo: string; base: string; head: string } {
    try {
      return CompareCommitsSchema.parse({ owner, repo, base, head });
    } catch (error) {
      if (error instanceof ZodError) {
        const messages = error.issues.map((e) => `${e.path.join(".")}: ${e.message}`);
        throw new GitHubValidationError("Invalid compareCommits parameters", messages);
      }
      throw error;
    }
  }

  /**
   * Parse file changes from GitHub API response
   */
  private parseFileChanges(
    files: Array<{ filename: string; status: string; previous_filename?: string }>
  ): FileChange[] {
    return files.map((file) => {
      const change: FileChange = {
        path: file.filename,
        status: this.mapFileStatus(file.status),
      };

      // Handle renamed files
      if (file.status === "renamed" && file.previous_filename) {
        change.previousPath = file.previous_filename;
      }

      return change;
    });
  }

  /**
   * Map GitHub file status to our FileChange status
   */
  private mapFileStatus(status: string): FileChange["status"] {
    switch (status) {
      case "added":
        return "added";
      case "removed":
        return "deleted";
      case "modified":
      case "changed":
        return "modified";
      case "renamed":
        return "renamed";
      default:
        // Treat unknown statuses as modified
        return "modified";
    }
  }

  /**
   * Perform HTTP fetch with retry logic
   */
  private async fetchWithRetry<T>(url: string): Promise<T> {
    return withRetry(() => this.doFetch<T>(url), {
      maxRetries: this.config.maxRetries,
      shouldRetry: (error) => {
        if (error instanceof GitHubRateLimitError) {
          return true;
        }
        if (error instanceof GitHubNetworkError) {
          return true;
        }
        if (error instanceof GitHubAPIError) {
          return error.retryable;
        }
        return false;
      },
      onRetry: (attempt, error, delayMs) => {
        this.logger.warn(
          {
            attempt: attempt + 1,
            maxRetries: this.config.maxRetries,
            delayMs,
            error: error.message,
          },
          "Retrying GitHub API request"
        );
      },
    });
  }

  /**
   * Perform a single HTTP fetch
   */
  private async doFetch<T>(url: string): Promise<T> {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "PersonalKnowledgeMCP/1.0",
    };

    if (this.config.token) {
      headers["Authorization"] = `Bearer ${this.config.token}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        await this.handleErrorResponse(response, url);
      }

      return (await response.json()) as T;
    } catch (error) {
      clearTimeout(timeoutId);

      // Handle network errors
      if (error instanceof Error) {
        if (error.name === "AbortError") {
          throw new GitHubNetworkError(`Request timeout after ${this.config.timeoutMs}ms`, error);
        }
        if (
          error.message.includes("ECONNREFUSED") ||
          error.message.includes("ENOTFOUND") ||
          error.message.includes("ETIMEDOUT") ||
          error.message.includes("ECONNRESET")
        ) {
          throw new GitHubNetworkError(
            `Network error: ${this.sanitizeErrorMessage(error.message)}`,
            error
          );
        }
      }

      // Re-throw known errors
      if (
        error instanceof GitHubAuthenticationError ||
        error instanceof GitHubRateLimitError ||
        error instanceof GitHubNotFoundError ||
        error instanceof GitHubNetworkError ||
        error instanceof GitHubAPIError ||
        error instanceof GitHubValidationError
      ) {
        throw error;
      }

      // Wrap unknown errors
      throw new GitHubNetworkError(
        `Unexpected error: ${error instanceof Error ? this.sanitizeErrorMessage(error.message) : String(error)}`,
        error
      );
    }
  }

  /**
   * Handle HTTP error responses
   */
  private async handleErrorResponse(response: Response, url: string): Promise<never> {
    const status = response.status;
    const statusText = response.statusText;

    // Try to get error message from response body
    let errorMessage: string;
    try {
      const body = (await response.json()) as { message?: string };
      errorMessage = body.message || statusText;
    } catch {
      errorMessage = statusText;
    }

    // Handle specific error types
    switch (status) {
      case 401:
        throw new GitHubAuthenticationError(
          "GitHub authentication failed. Check your GITHUB_PAT token."
        );
      case 403: {
        // Check if it's a rate limit error
        const rateLimitRemaining = response.headers.get("x-ratelimit-remaining");
        const rateLimitReset = response.headers.get("x-ratelimit-reset");

        if (rateLimitRemaining === "0" || errorMessage.toLowerCase().includes("rate limit")) {
          const resetAt = rateLimitReset
            ? new Date(parseInt(rateLimitReset, 10) * 1000)
            : undefined;
          throw new GitHubRateLimitError(
            `GitHub API rate limit exceeded. Reset at ${resetAt?.toISOString() || "unknown"}.`,
            resetAt,
            0
          );
        }

        // Otherwise it's a permissions error
        throw new GitHubAuthenticationError(
          `Access denied to ${this.sanitizeUrl(url)}. Check repository permissions.`
        );
      }
      case 404:
        throw new GitHubNotFoundError(`Resource not found: ${this.sanitizeUrl(url)}`, url);
      case 422:
        throw new GitHubValidationError(`Validation failed: ${errorMessage}`);
      default:
        throw new GitHubAPIError(
          `GitHub API error: ${errorMessage}`,
          status,
          statusText,
          isRetryableStatusCode(status)
        );
    }
  }

  /**
   * Sanitize URL to remove tokens
   */
  private sanitizeUrl(url: string): string {
    // Remove any embedded tokens from URL (shouldn't happen, but defense in depth)
    return url.replace(/access_token=[^&]+/gi, "access_token=[REDACTED]");
  }

  /**
   * Sanitize error message to remove potential secrets
   */
  private sanitizeErrorMessage(message: string): string {
    // Remove any token-like patterns
    return message
      .replace(/ghp_[A-Za-z0-9]{36,}/g, "[REDACTED]")
      .replace(/github_pat_[A-Za-z0-9_]{82}/g, "[REDACTED]")
      .replace(/Bearer [A-Za-z0-9_-]+/gi, "Bearer [REDACTED]");
  }
}
