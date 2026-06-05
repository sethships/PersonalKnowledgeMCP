/**
 * Git authenticated-URL helpers.
 *
 * Builds remote URLs with embedded credentials for cloning/fetching private
 * repositories, and strips credentials for safe logging. Shared between the
 * repository cloner (initial clone / fetch-latest) and the incremental update
 * coordinator (git pull on an existing clone) so both paths inject a freshly
 * resolved PAT rather than relying on whatever token was embedded at clone time.
 *
 * @module utils/git-auth-url
 */

/**
 * Options controlling which credential is injected based on the host.
 */
export interface GitAuthUrlOptions {
  /** GitHub Personal Access Token, applied to github.com hosts. */
  githubPat?: string | undefined;
  /** Generic git token, applied to non-github.com hosts (GitLab, Gitea, etc.). */
  gitPat?: string | undefined;
}

/**
 * Build an authenticated git URL by injecting the appropriate credential.
 *
 * Behavior:
 * - SSH URLs (`git@...`) are returned unchanged (key-based auth).
 * - `github.com` HTTPS URLs get `https://{githubPat}:x-oauth-basic@github.com/...`.
 * - Other HTTPS hosts get `https://{gitPat}:@host/...`.
 * - If no matching token is configured, or the URL cannot be parsed, the
 *   original URL is returned unchanged.
 *
 * The returned URL may contain a secret and MUST NOT be logged. Use
 * {@link sanitizeGitUrl} for logging.
 *
 * @param url - Original repository URL
 * @param options - Available credentials
 * @returns URL with embedded credentials, or the original URL if none apply
 */
export function buildAuthenticatedGitUrl(url: string, options: GitAuthUrlOptions): string {
  // SSH URLs use key-based auth — no PAT injection needed
  if (url.startsWith("git@")) {
    return url;
  }

  try {
    const parsed = new URL(url);

    if (parsed.hostname === "github.com" && options.githubPat) {
      // GitHub: https://{PAT}:x-oauth-basic@github.com/owner/repo.git
      parsed.username = options.githubPat;
      parsed.password = "x-oauth-basic";
    } else if (parsed.hostname !== "github.com" && options.gitPat) {
      // Generic git host (GitLab, Gitea, etc.): https://{token}:@host/owner/repo.git
      parsed.username = options.gitPat;
      parsed.password = "";
    } else {
      return url;
    }

    // Return authenticated URL (never logged)
    return parsed.toString();
  } catch {
    // If the URL cannot be parsed, return it unchanged so callers degrade
    // gracefully rather than throwing mid-operation.
    return url;
  }
}

/**
 * Remove credentials from a URL for safe logging.
 *
 * @param url - URL that may contain credentials
 * @returns URL without username/password, or the original string if unparseable
 */
export function sanitizeGitUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    // If URL parsing fails, return as-is (likely already sanitized)
    return url;
  }
}
