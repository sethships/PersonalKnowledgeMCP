/**
 * Unit tests for git authenticated-URL helpers.
 *
 * Verifies credential injection per host type and credential stripping for
 * safe logging, including graceful handling of unparseable input.
 */

import { describe, it, expect } from "bun:test";
import { buildAuthenticatedGitUrl, sanitizeGitUrl } from "../../../src/utils/git-auth-url.js";

describe("buildAuthenticatedGitUrl", () => {
  it("injects a GitHub PAT as x-oauth-basic for github.com URLs", () => {
    const result = buildAuthenticatedGitUrl("https://github.com/owner/repo.git", {
      githubPat: "ghp_token123",
    });
    expect(result).toMatch(/^https:\/\/ghp_token123:x-oauth-basic@github\.com\/owner\/repo\.git$/);
  });

  it("injects a generic git token for non-github hosts", () => {
    const result = buildAuthenticatedGitUrl("https://gitlab.com/owner/repo.git", {
      gitPat: "glpat_token",
    });
    // Username embedded, empty password (https://{token}:@host/...)
    expect(result).toContain("glpat_token");
    expect(result).toMatch(/^https:\/\/glpat_token:?@gitlab\.com\/owner\/repo\.git$/);
  });

  it("does not use the GitHub PAT for non-github hosts", () => {
    const result = buildAuthenticatedGitUrl("https://gitlab.com/owner/repo.git", {
      githubPat: "ghp_token123",
    });
    expect(result).toBe("https://gitlab.com/owner/repo.git");
  });

  it("does not use the generic token for github.com", () => {
    const result = buildAuthenticatedGitUrl("https://github.com/owner/repo.git", {
      gitPat: "glpat_token",
    });
    expect(result).toBe("https://github.com/owner/repo.git");
  });

  it("returns SSH URLs unchanged", () => {
    const url = "git@github.com:owner/repo.git";
    expect(buildAuthenticatedGitUrl(url, { githubPat: "ghp_token123" })).toBe(url);
  });

  it("returns the original URL when no matching token is configured", () => {
    const url = "https://github.com/owner/repo.git";
    expect(buildAuthenticatedGitUrl(url, {})).toBe(url);
  });

  it("returns the original string when the URL cannot be parsed", () => {
    const bad = "not a url";
    expect(buildAuthenticatedGitUrl(bad, { githubPat: "ghp_token123" })).toBe(bad);
  });

  it("overrides an already-embedded (stale) credential with the new PAT", () => {
    const stale = "https://ghp_oldexpired:x-oauth-basic@github.com/owner/repo.git";
    const result = buildAuthenticatedGitUrl(stale, { githubPat: "ghp_new" });
    expect(result).toContain("ghp_new");
    expect(result).not.toContain("ghp_oldexpired");
  });
});

describe("sanitizeGitUrl", () => {
  it("strips embedded credentials", () => {
    const result = sanitizeGitUrl("https://ghp_secret:x-oauth-basic@github.com/owner/repo.git");
    expect(result).toBe("https://github.com/owner/repo.git");
    expect(result).not.toContain("ghp_secret");
  });

  it("leaves credential-free URLs intact", () => {
    const url = "https://github.com/owner/repo.git";
    expect(sanitizeGitUrl(url)).toBe(url);
  });

  it("returns the original string when the URL cannot be parsed", () => {
    expect(sanitizeGitUrl("not a url")).toBe("not a url");
  });
});
