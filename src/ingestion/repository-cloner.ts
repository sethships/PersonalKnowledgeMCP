/**
 * Repository cloning functionality for GitHub repositories.
 *
 * @module ingestion/repository-cloner
 */

import simpleGit, { type SimpleGit } from "simple-git";
import { mkdir, rm, access } from "node:fs/promises";
import { resolve, normalize } from "node:path";
import type pino from "pino";
import { getComponentLogger } from "../logging/index.js";
import type { CloneOptions, CloneResult, RepositoryClonerConfig } from "./types.js";
import { ValidationError, CloneError, AuthenticationError } from "./errors.js";

/**
 * Git clone option flags and defaults.
 */
const CLONE_OPTIONS = {
  DEPTH_FLAG: "--depth",
  SHALLOW_DEPTH: "1",
  BRANCH_FLAG: "--branch",
} as const;

/**
 * Clones GitHub repositories for indexing into the knowledge base.
 *
 * Supports both public and private repositories with PAT authentication.
 * Uses shallow clones by default for performance.
 *
 * @example
 * ```typescript
 * const cloner = new RepositoryCloner({
 *   clonePath: './data/repos',
 *   githubPat: process.env.GITHUB_PAT
 * });
 *
 * const result = await cloner.clone('https://github.com/user/repo', {
 *   branch: 'main',
 *   shallow: true
 * });
 *
 * console.log(`Cloned to: ${result.path}`);
 * ```
 */
export class RepositoryCloner {
  private readonly config: RepositoryClonerConfig;
  private readonly git: SimpleGit;
  private _logger: pino.Logger | null = null;

  /**
   * Lazy-loaded logger instance.
   */
  private get logger(): pino.Logger {
    if (!this._logger) {
      this._logger = getComponentLogger("ingestion:repository-cloner");
    }
    return this._logger;
  }

  /**
   * Creates a new RepositoryCloner instance.
   *
   * @param config - Configuration for the cloner
   */
  constructor(config: RepositoryClonerConfig) {
    this.config = config;
    this.git = simpleGit();

    this.logger.debug(
      {
        clonePath: config.clonePath,
        hasGithubPat: !!config.githubPat,
      },
      "RepositoryCloner initialized"
    );
  }

  /**
   * Clone a GitHub repository.
   *
   * @param url - GitHub repository URL (https://github.com/user/repo or https://github.com/user/repo.git)
   * @param options - Clone options
   * @returns Clone result with path, name, and branch
   * @throws {ValidationError} If the URL is invalid
   * @throws {CloneError} If the clone operation fails
   * @throws {AuthenticationError} If authentication fails for a private repository
   */
  async clone(url: string, options: CloneOptions = {}): Promise<CloneResult> {
    const startTime = Date.now();

    // Step 1: Validate URL
    this.validateGitHubUrl(url);

    // Step 2: Extract or use provided repository name
    const repoName = options.name || this.extractRepoName(url);

    // Step 3: Build target path
    const targetPath = normalize(resolve(this.config.clonePath, repoName));

    // Set defaults for options
    const shallow = options.shallow !== false; // Default: true
    const fresh = options.fresh === true; // Default: false
    const branch = options.branch;

    this.logger.info(
      {
        url: this.sanitizeUrl(url),
        repoName,
        targetPath,
        shallow,
        fresh,
        branch,
      },
      "Starting clone operation"
    );

    // Step 4: Check if directory exists
    // NOTE: TOCTOU (Time-of-Check-Time-of-Use) - There is a small race window between
    // checking directory existence and creating/deleting it. This is acceptable for MVP
    // single-user scenarios but should be addressed with file locking in Phase 3 for
    // multi-instance deployments. See code review finding #1.
    const exists = await this.directoryExists(targetPath);

    if (exists && !fresh) {
      // Repository already exists - detect current branch
      const actualBranch = branch || (await this.detectCurrentBranch(targetPath));

      this.logger.info(
        {
          targetPath,
          repoName,
          branch: actualBranch,
        },
        "Repository already cloned, skipping"
      );

      return {
        path: targetPath,
        name: repoName,
        branch: actualBranch,
      };
    }

    try {
      // Step 5: Create parent directories if needed
      await mkdir(this.config.clonePath, { recursive: true });

      // Step 6: If fresh clone, delete existing directory
      if (exists && fresh) {
        this.logger.debug({ targetPath }, "Deleting existing repository for fresh clone");
        await rm(targetPath, { recursive: true, force: true });
      }

      // Step 7: Build authenticated URL if PAT available
      const cloneUrl = this.buildAuthenticatedUrl(url);

      // Step 8: Execute clone with simple-git
      const cloneOptions: string[] = [];

      if (shallow) {
        cloneOptions.push(CLONE_OPTIONS.DEPTH_FLAG, CLONE_OPTIONS.SHALLOW_DEPTH);
      }

      if (branch) {
        cloneOptions.push(CLONE_OPTIONS.BRANCH_FLAG, branch);
      }

      this.logger.debug(
        {
          repoName,
          shallow,
          branch,
          targetPath,
        },
        "Executing git clone"
      );

      await this.git.clone(cloneUrl, targetPath, cloneOptions);

      // Step 9: Detect actual branch name if not specified
      const actualBranch = branch || (await this.detectCurrentBranch(targetPath));

      // Step 10: Log success with metrics
      const durationMs = Date.now() - startTime;

      this.logger.info(
        {
          metric: "repository.clone_duration_ms",
          value: durationMs,
          repoName,
          targetPath,
          shallow,
          branch: actualBranch,
        },
        "Repository cloned successfully"
      );

      return {
        path: targetPath,
        name: repoName,
        branch: actualBranch,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;

      this.logger.error(
        {
          err: error,
          url: this.sanitizeUrl(url),
          repoName,
          targetPath,
          durationMs,
        },
        "Clone operation failed"
      );

      // Handle specific error cases
      if (error instanceof Error) {
        const errorMessage = error.message.toLowerCase();

        // Authentication errors (401, 403, 404)
        if (
          errorMessage.includes("authentication failed") ||
          errorMessage.includes("could not read username") ||
          errorMessage.includes("not found") ||
          errorMessage.includes("403")
        ) {
          throw new AuthenticationError(
            `Authentication failed for repository. For private repositories, ensure GITHUB_PAT is configured with 'repo' scope.`,
            this.sanitizeUrl(url),
            error
          );
        }

        // Network errors
        if (
          errorMessage.includes("could not resolve host") ||
          errorMessage.includes("failed to connect") ||
          errorMessage.includes("network")
        ) {
          // Sanitize error message to prevent URL leakage
          const sanitizedMessage = this.sanitizeErrorMessage(error.message);
          throw new CloneError(
            `Network error while cloning repository: ${sanitizedMessage}`,
            this.sanitizeUrl(url),
            targetPath,
            error
          );
        }
      }

      // Generic clone error - sanitize message to prevent URL leakage
      const sanitizedMessage =
        error instanceof Error ? this.sanitizeErrorMessage(error.message) : String(error);
      throw new CloneError(
        `Failed to clone repository: ${sanitizedMessage}`,
        this.sanitizeUrl(url),
        targetPath,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Validate that a URL is a valid GitHub repository URL.
   *
   * @param url - URL to validate
   * @throws {ValidationError} If the URL is invalid
   */
  private validateGitHubUrl(url: string): void {
    if (!url || typeof url !== "string") {
      throw new ValidationError("Repository URL cannot be empty", "url");
    }

    const trimmedUrl = url.trim();

    if (trimmedUrl === "") {
      throw new ValidationError("Repository URL cannot be empty", "url");
    }

    // Pattern: https://github.com/{owner}/{repo}(.git)?
    // Owner/repo must start and end with alphanumeric, can contain .-_ in middle
    const pattern = /^https:\/\/github\.com\/[\w][\w.-]*[\w]\/[\w][\w.-]*[\w](\.git)?$/;

    if (!pattern.test(trimmedUrl)) {
      throw new ValidationError(
        `Invalid GitHub repository URL format. Expected: https://github.com/owner/repo`,
        "url"
      );
    }
  }

  /**
   * Extract repository name from GitHub URL.
   *
   * @param url - GitHub repository URL
   * @returns Repository name
   * @throws {ValidationError} If the repository name cannot be extracted
   *
   * @example
   * extractRepoName('https://github.com/user/my-repo.git') // returns 'my-repo'
   * extractRepoName('https://github.com/user/my-repo') // returns 'my-repo'
   */
  private extractRepoName(url: string): string {
    // Pattern to extract repository name, with or without .git suffix
    const match = url.match(/\/([^/]+?)(\.git)?$/);

    if (!match || !match[1]) {
      throw new ValidationError("Could not extract repository name from URL", "url");
    }

    return match[1];
  }

  /**
   * Build authenticated URL with GitHub PAT if configured.
   *
   * SECURITY: This method NEVER logs the PAT token. The URL returned contains
   * credentials but is only used internally for cloning.
   *
   * @param url - Original GitHub URL
   * @returns URL with authentication credentials if PAT is configured, otherwise original URL
   */
  private buildAuthenticatedUrl(url: string): string {
    if (!this.config.githubPat) {
      return url;
    }

    try {
      const parsed = new URL(url);

      if (parsed.hostname === "github.com") {
        // Format: https://{PAT}:x-oauth-basic@github.com/owner/repo.git
        parsed.username = this.config.githubPat;
        parsed.password = "x-oauth-basic";
      }

      // Return authenticated URL (never logged)
      return parsed.toString();
    } catch (error) {
      this.logger.warn(
        {
          err: error,
          url: this.sanitizeUrl(url),
        },
        "Failed to build authenticated URL, using original URL"
      );
      return url;
    }
  }

  /**
   * Remove credentials from URL for safe logging.
   *
   * @param url - URL that may contain credentials
   * @returns URL without credentials
   */
  private sanitizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      // Remove username and password
      parsed.username = "";
      parsed.password = "";
      return parsed.toString();
    } catch {
      // If URL parsing fails, return as-is (likely already sanitized)
      return url;
    }
  }

  /**
   * Remove credentials from error messages.
   *
   * Git error messages may contain authenticated URLs. This method removes
   * credentials using regex replacement for additional defense in depth.
   *
   * @param message - Error message that may contain URLs with credentials
   * @returns Error message with credentials removed
   */
  private sanitizeErrorMessage(message: string): string {
    // Replace patterns like https://token:x-oauth-basic@github.com with https://***@github.com
    return message.replace(/https:\/\/[^:]+:[^@]+@/g, "https://***@");
  }

  /**
   * Detect the current branch of a cloned repository.
   *
   * Uses git to detect the actual branch name of the cloned repository.
   * Falls back to "unknown" if detection fails.
   *
   * @param repoPath - Path to the cloned repository
   * @returns Current branch name or "unknown" if detection fails
   */
  private async detectCurrentBranch(repoPath: string): Promise<string> {
    try {
      const git = simpleGit(repoPath);
      const currentBranch = await git.revparse(["--abbrev-ref", "HEAD"]);
      return currentBranch.trim();
    } catch (error) {
      this.logger.debug(
        {
          err: error,
          repoPath,
        },
        "Failed to detect current branch, using 'unknown'"
      );
      return "unknown";
    }
  }

  /**
   * Check if a directory exists.
   *
   * @param path - Directory path to check
   * @returns true if directory exists, false otherwise
   */
  private async directoryExists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }
}
