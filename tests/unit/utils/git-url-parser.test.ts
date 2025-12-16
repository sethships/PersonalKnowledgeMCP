/**
 * Git URL Parser Tests
 *
 * Tests for parsing GitHub URLs to extract owner and repository name.
 */

import { describe, it, expect } from "bun:test";
import { parseGitHubUrl } from "../../../src/utils/git-url-parser.js";

describe("parseGitHubUrl", () => {
  describe("HTTPS URLs", () => {
    it("should parse HTTPS URL with .git suffix", () => {
      const result = parseGitHubUrl("https://github.com/user/repo.git");
      expect(result).toEqual({
        owner: "user",
        repo: "repo",
        isGitHub: true,
      });
    });

    it("should parse HTTPS URL without .git suffix", () => {
      const result = parseGitHubUrl("https://github.com/user/repo");
      expect(result).toEqual({
        owner: "user",
        repo: "repo",
        isGitHub: true,
      });
    });

    it("should parse HTTPS URL with organization owner", () => {
      const result = parseGitHubUrl("https://github.com/my-org/my-project.git");
      expect(result).toEqual({
        owner: "my-org",
        repo: "my-project",
        isGitHub: true,
      });
    });

    it("should parse HTTPS URL with underscores and hyphens", () => {
      const result = parseGitHubUrl("https://github.com/my_user-123/my_repo-456.git");
      expect(result).toEqual({
        owner: "my_user-123",
        repo: "my_repo-456",
        isGitHub: true,
      });
    });

    it("should parse HTTPS URL with dots in names", () => {
      const result = parseGitHubUrl("https://github.com/user.name/repo.name.git");
      expect(result).toEqual({
        owner: "user.name",
        repo: "repo.name",
        isGitHub: true,
      });
    });
  });

  describe("SSH URLs", () => {
    it("should parse SSH URL with .git suffix", () => {
      const result = parseGitHubUrl("git@github.com:user/repo.git");
      expect(result).toEqual({
        owner: "user",
        repo: "repo",
        isGitHub: true,
      });
    });

    it("should parse SSH URL without .git suffix", () => {
      const result = parseGitHubUrl("git@github.com:user/repo");
      expect(result).toEqual({
        owner: "user",
        repo: "repo",
        isGitHub: true,
      });
    });

    it("should parse SSH URL with organization owner", () => {
      const result = parseGitHubUrl("git@github.com:my-org/my-project.git");
      expect(result).toEqual({
        owner: "my-org",
        repo: "my-project",
        isGitHub: true,
      });
    });

    it("should parse SSH URL with special characters", () => {
      const result = parseGitHubUrl("git@github.com:my_user-123/my_repo-456.git");
      expect(result).toEqual({
        owner: "my_user-123",
        repo: "my_repo-456",
        isGitHub: true,
      });
    });
  });

  describe("Non-GitHub URLs", () => {
    it("should return null for GitLab URL", () => {
      const result = parseGitHubUrl("https://gitlab.com/user/repo.git");
      expect(result).toBeNull();
    });

    it("should return null for Bitbucket URL", () => {
      const result = parseGitHubUrl("https://bitbucket.org/user/repo.git");
      expect(result).toBeNull();
    });

    it("should return null for self-hosted Git URL", () => {
      const result = parseGitHubUrl("https://git.company.com/user/repo.git");
      expect(result).toBeNull();
    });

    it("should return null for generic SSH URL", () => {
      const result = parseGitHubUrl("git@gitlab.com:user/repo.git");
      expect(result).toBeNull();
    });
  });

  describe("Malformed URLs", () => {
    it("should return null for empty string", () => {
      const result = parseGitHubUrl("");
      expect(result).toBeNull();
    });

    it("should return null for whitespace-only string", () => {
      const result = parseGitHubUrl("   ");
      expect(result).toBeNull();
    });

    it("should return null for null input", () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
      const result = parseGitHubUrl(null as any);
      expect(result).toBeNull();
    });

    it("should return null for undefined input", () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
      const result = parseGitHubUrl(undefined as any);
      expect(result).toBeNull();
    });

    it("should return null for non-string input", () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
      const result = parseGitHubUrl(12345 as any);
      expect(result).toBeNull();
    });

    it("should return null for URL with missing owner", () => {
      const result = parseGitHubUrl("https://github.com//repo.git");
      expect(result).toBeNull();
    });

    it("should return null for URL with missing repo", () => {
      const result = parseGitHubUrl("https://github.com/user/");
      expect(result).toBeNull();
    });

    it("should return null for URL with only one path segment", () => {
      const result = parseGitHubUrl("https://github.com/user");
      expect(result).toBeNull();
    });

    it("should return null for URL with too many path segments", () => {
      const result = parseGitHubUrl("https://github.com/user/repo/extra");
      expect(result).toBeNull();
    });

    it("should return null for SSH URL with missing colon", () => {
      const result = parseGitHubUrl("git@github.com/user/repo.git");
      expect(result).toBeNull();
    });

    it("should return null for incomplete HTTPS URL", () => {
      const result = parseGitHubUrl("https://github.com/");
      expect(result).toBeNull();
    });
  });

  describe("Edge Cases", () => {
    it("should handle URL with trailing whitespace", () => {
      const result = parseGitHubUrl("https://github.com/user/repo.git   ");
      expect(result).toEqual({
        owner: "user",
        repo: "repo",
        isGitHub: true,
      });
    });

    it("should handle URL with leading whitespace", () => {
      const result = parseGitHubUrl("   https://github.com/user/repo.git");
      expect(result).toEqual({
        owner: "user",
        repo: "repo",
        isGitHub: true,
      });
    });

    it("should return null for HTTP (non-HTTPS) GitHub URL", () => {
      const result = parseGitHubUrl("http://github.com/user/repo.git");
      expect(result).toBeNull();
    });

    it("should return null for GitHub URL with www subdomain", () => {
      const result = parseGitHubUrl("https://www.github.com/user/repo.git");
      expect(result).toBeNull();
    });

    it("should return null for owner/repo names starting with special char", () => {
      const result = parseGitHubUrl("https://github.com/-user/repo.git");
      expect(result).toBeNull();
    });

    it("should return null for owner/repo names ending with special char", () => {
      const result = parseGitHubUrl("https://github.com/user-/repo.git");
      expect(result).toBeNull();
    });
  });
});
