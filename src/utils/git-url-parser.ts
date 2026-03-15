/**
 * Git URL Parser Utility
 *
 * Extracts owner and repository name from Git URLs for API calls.
 * Supports both HTTPS and SSH URL formats for any git host.
 */

/**
 * Parsed Git URL result
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
   * Whether the URL is a GitHub.com URL
   */
  isGitHub: boolean;

  /**
   * The git host hostname (e.g. "github.com", "gitlab.com")
   */
  host: string;
}

/**
 * Parse a Git URL to extract owner and repository name.
 *
 * Supports the following URL formats for any git host:
 * - HTTPS: https://github.com/owner/repo
 * - HTTPS with .git: https://gitlab.com/owner/repo.git
 * - SSH: git@github.com:owner/repo
 * - SSH with .git: git@gitlab.com:owner/repo.git
 *
 * Returns null for malformed URLs that do not match expected patterns.
 *
 * @param url - Git repository URL
 * @returns Parsed git URL information, or null if not a valid git URL
 *
 * @example
 * ```typescript
 * parseGitHubUrl('https://github.com/user/repo.git')
 * // Returns: { owner: 'user', repo: 'repo', isGitHub: true, host: 'github.com' }
 *
 * parseGitHubUrl('https://gitlab.com/user/repo')
 * // Returns: { owner: 'user', repo: 'repo', isGitHub: false, host: 'gitlab.com' }
 *
 * parseGitHubUrl('git@github.com:org/project.git')
 * // Returns: { owner: 'org', repo: 'project', isGitHub: true, host: 'github.com' }
 * ```
 */
export function parseGitHubUrl(url: string): ParsedGitHubUrl | null {
  if (!url || typeof url !== "string") {
    return null;
  }

  const trimmedUrl = url.trim();

  // Try HTTPS format: https://<host>/owner/repo(.git)?
  const httpsPattern = /^https:\/\/([\w.-]+)\/([\w][\w.-]*[\w])\/([\w][\w.-]*[\w])(?:\.git)?$/i;
  const httpsMatch = trimmedUrl.match(httpsPattern);

  if (httpsMatch) {
    const host = httpsMatch[1];
    const owner = httpsMatch[2];
    let repo = httpsMatch[3];

    if (repo && repo.endsWith(".git")) {
      repo = repo.substring(0, repo.length - 4);
    }

    if (host && owner && repo) {
      return {
        owner,
        repo,
        isGitHub: host === "github.com",
        host,
      };
    }
  }

  // Try SSH format: git@<host>:owner/repo(.git)?
  const sshPattern = /^git@([\w.-]+):([\w][\w.-]*[\w])\/([\w][\w.-]*[\w])(?:\.git)?$/i;
  const sshMatch = trimmedUrl.match(sshPattern);

  if (sshMatch) {
    const host = sshMatch[1];
    const owner = sshMatch[2];
    let repo = sshMatch[3];

    if (repo && repo.endsWith(".git")) {
      repo = repo.substring(0, repo.length - 4);
    }

    if (host && owner && repo) {
      return {
        owner,
        repo,
        isGitHub: host === "github.com",
        host,
      };
    }
  }

  // Not a recognized git URL format
  return null;
}
