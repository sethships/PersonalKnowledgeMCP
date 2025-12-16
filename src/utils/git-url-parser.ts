/**
 * Git URL Parser Utility
 *
 * Extracts owner and repository name from GitHub URLs for API calls.
 * Supports both HTTPS and SSH URL formats.
 */

/**
 * Parsed GitHub URL result
 */
export interface ParsedGitHubUrl {
  /**
   * Repository owner (user or organization)
   */
  owner: string;

  /**
   * Repository name
   */
  repo: string;

  /**
   * Whether the URL is a GitHub URL
   */
  isGitHub: boolean;
}

/**
 * Parse a Git URL to extract owner and repository name
 *
 * Supports the following GitHub URL formats:
 * - HTTPS: https://github.com/owner/repo
 * - HTTPS with .git: https://github.com/owner/repo.git
 * - SSH: git@github.com:owner/repo
 * - SSH with .git: git@github.com:owner/repo.git
 *
 * Returns null for non-GitHub URLs or malformed URLs.
 *
 * @param url - Git repository URL
 * @returns Parsed GitHub URL information, or null if not a valid GitHub URL
 *
 * @example
 * ```typescript
 * parseGitHubUrl('https://github.com/user/repo.git')
 * // Returns: { owner: 'user', repo: 'repo', isGitHub: true }
 *
 * parseGitHubUrl('https://gitlab.com/user/repo')
 * // Returns: null (not GitHub)
 *
 * parseGitHubUrl('git@github.com:org/project.git')
 * // Returns: { owner: 'org', repo: 'project', isGitHub: true }
 * ```
 */
export function parseGitHubUrl(url: string): ParsedGitHubUrl | null {
  if (!url || typeof url !== "string") {
    return null;
  }

  const trimmedUrl = url.trim();

  // Try HTTPS format: https://github.com/owner/repo(.git)?
  // Matches: username/repo-name followed by optional .git
  const httpsPattern = /^https:\/\/github\.com\/([\w][\w.-]*[\w])\/([\w][\w.-]*[\w])(?:\.git)?$/;
  const httpsMatch = trimmedUrl.match(httpsPattern);

  if (httpsMatch) {
    const owner = httpsMatch[1];
    let repo = httpsMatch[2];

    // Strip .git suffix if present (regex allows dots, so it might be captured)
    if (repo && repo.endsWith(".git")) {
      repo = repo.substring(0, repo.length - 4);
    }

    if (owner && repo) {
      return {
        owner,
        repo,
        isGitHub: true,
      };
    }
  }

  // Try SSH format: git@github.com:owner/repo(.git)?
  const sshPattern = /^git@github\.com:([\w][\w.-]*[\w])\/([\w][\w.-]*[\w])(?:\.git)?$/;
  const sshMatch = trimmedUrl.match(sshPattern);

  if (sshMatch) {
    const owner = sshMatch[1];
    let repo = sshMatch[2];

    // Strip .git suffix if present (regex allows dots, so it might be captured)
    if (repo && repo.endsWith(".git")) {
      repo = repo.substring(0, repo.length - 4);
    }

    if (owner && repo) {
      return {
        owner,
        repo,
        isGitHub: true,
      };
    }
  }

  // Not a recognized GitHub URL format
  return null;
}
