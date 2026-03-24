/**
 * Git URL Parser Tests
 *
 * Tests for parsing Git URLs to extract owner and repository name.
 * Supports any git host (GitHub, GitLab, Gitea, Bitbucket, self-hosted).
 */

import { describe, it, expect } from "bun:test";
import { parseGitUrl } from "../../../src/utils/git-url-parser.js";

describe("parseGitUrl", () => {
  describe("GitHub HTTPS URLs", () => {
    it("should parse HTTPS URL with .git suffix", () => {
      const result = parseGitUrl("https://github.com/user/repo.git");
      expect(result).toEqual({
        owner: "user",
        repo: "repo",
        isGitHub: true,
        host: "github.com",
      });
    });

    it("should parse HTTPS URL without .git suffix", () => {
      const result = parseGitUrl("https://github.com/user/repo");
      expect(result).toEqual({
        owner: "user",
        repo: "repo",
        isGitHub: true,
        host: "github.com",
      });
    });

    it("should parse HTTPS URL with organization owner", () => {
      const result = parseGitUrl("https://github.com/my-org/my-project.git");
      expect(result).toEqual({
        owner: "my-org",
        repo: "my-project",
        isGitHub: true,
        host: "github.com",
      });
    });

    it("should parse HTTPS URL with underscores and hyphens", () => {
      const result = parseGitUrl("https://github.com/my_user-123/my_repo-456.git");
      expect(result).toEqual({
        owner: "my_user-123",
        repo: "my_repo-456",
        isGitHub: true,
        host: "github.com",
      });
    });

    it("should parse HTTPS URL with dots in names", () => {
      const result = parseGitUrl("https://github.com/user.name/repo.name.git");
      expect(result).toEqual({
        owner: "user.name",
        repo: "repo.name",
        isGitHub: true,
        host: "github.com",
      });
    });
  });

  describe("GitHub SSH URLs", () => {
    it("should parse SSH URL with .git suffix", () => {
      const result = parseGitUrl("git@github.com:user/repo.git");
      expect(result).toEqual({
        owner: "user",
        repo: "repo",
        isGitHub: true,
        host: "github.com",
      });
    });

    it("should parse SSH URL without .git suffix", () => {
      const result = parseGitUrl("git@github.com:user/repo");
      expect(result).toEqual({
        owner: "user",
        repo: "repo",
        isGitHub: true,
        host: "github.com",
      });
    });

    it("should parse SSH URL with organization owner", () => {
      const result = parseGitUrl("git@github.com:my-org/my-project.git");
      expect(result).toEqual({
        owner: "my-org",
        repo: "my-project",
        isGitHub: true,
        host: "github.com",
      });
    });

    it("should parse SSH URL with special characters", () => {
      const result = parseGitUrl("git@github.com:my_user-123/my_repo-456.git");
      expect(result).toEqual({
        owner: "my_user-123",
        repo: "my_repo-456",
        isGitHub: true,
        host: "github.com",
      });
    });
  });

  describe("Non-GitHub host URLs (isGitHub: false)", () => {
    it("should parse GitLab HTTPS URL", () => {
      const result = parseGitUrl("https://gitlab.com/user/repo.git");
      expect(result).toEqual({
        owner: "user",
        repo: "repo",
        isGitHub: false,
        host: "gitlab.com",
      });
    });

    it("should parse Bitbucket HTTPS URL", () => {
      const result = parseGitUrl("https://bitbucket.org/user/repo.git");
      expect(result).toEqual({
        owner: "user",
        repo: "repo",
        isGitHub: false,
        host: "bitbucket.org",
      });
    });

    it("should parse self-hosted HTTPS URL", () => {
      const result = parseGitUrl("https://git.company.com/user/repo.git");
      expect(result).toEqual({
        owner: "user",
        repo: "repo",
        isGitHub: false,
        host: "git.company.com",
      });
    });

    it("should parse GitLab SSH URL", () => {
      const result = parseGitUrl("git@gitlab.com:user/repo.git");
      expect(result).toEqual({
        owner: "user",
        repo: "repo",
        isGitHub: false,
        host: "gitlab.com",
      });
    });

    it("should parse Gitea SSH URL", () => {
      const result = parseGitUrl("git@gitea.example.com:org/project.git");
      expect(result).toEqual({
        owner: "org",
        repo: "project",
        isGitHub: false,
        host: "gitea.example.com",
      });
    });
  });

  describe("Malformed URLs", () => {
    it("should return null for empty string", () => {
      const result = parseGitUrl("");
      expect(result).toBeNull();
    });

    it("should return null for whitespace-only string", () => {
      const result = parseGitUrl("   ");
      expect(result).toBeNull();
    });

    it("should return null for null input", () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
      const result = parseGitUrl(null as any);
      expect(result).toBeNull();
    });

    it("should return null for undefined input", () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
      const result = parseGitUrl(undefined as any);
      expect(result).toBeNull();
    });

    it("should return null for non-string input", () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
      const result = parseGitUrl(12345 as any);
      expect(result).toBeNull();
    });

    it("should return null for URL with missing owner", () => {
      const result = parseGitUrl("https://github.com//repo.git");
      expect(result).toBeNull();
    });

    it("should return null for URL with missing repo", () => {
      const result = parseGitUrl("https://github.com/user/");
      expect(result).toBeNull();
    });

    it("should return null for URL with only one path segment", () => {
      const result = parseGitUrl("https://github.com/user");
      expect(result).toBeNull();
    });

    it("should return null for URL with too many path segments", () => {
      const result = parseGitUrl("https://github.com/user/repo/extra");
      expect(result).toBeNull();
    });

    it("should return null for SSH URL with missing colon", () => {
      const result = parseGitUrl("git@github.com/user/repo.git");
      expect(result).toBeNull();
    });

    it("should return null for incomplete HTTPS URL", () => {
      const result = parseGitUrl("https://github.com/");
      expect(result).toBeNull();
    });
  });

  describe("Edge Cases", () => {
    it("should handle URL with trailing whitespace", () => {
      const result = parseGitUrl("https://github.com/user/repo.git   ");
      expect(result).toEqual({
        owner: "user",
        repo: "repo",
        isGitHub: true,
        host: "github.com",
      });
    });

    it("should handle URL with leading whitespace", () => {
      const result = parseGitUrl("   https://github.com/user/repo.git");
      expect(result).toEqual({
        owner: "user",
        repo: "repo",
        isGitHub: true,
        host: "github.com",
      });
    });

    it("should return null for HTTP (non-HTTPS) URL", () => {
      const result = parseGitUrl("http://github.com/user/repo.git");
      expect(result).toBeNull();
    });

    it("should parse www.github.com URL as non-GitHub host", () => {
      const result = parseGitUrl("https://www.github.com/user/repo.git");
      expect(result).toEqual({
        owner: "user",
        repo: "repo",
        isGitHub: false,
        host: "www.github.com",
      });
    });

    it("should return null for owner/repo names starting with special char", () => {
      const result = parseGitUrl("https://github.com/-user/repo.git");
      expect(result).toBeNull();
    });

    it("should parse owner/repo names ending with hyphen", () => {
      const result = parseGitUrl("https://github.com/user-/repo.git");
      expect(result).toEqual({
        owner: "user-",
        repo: "repo",
        isGitHub: true,
        host: "github.com",
      });
    });

    it("should parse single-character owner and repo names", () => {
      const result = parseGitUrl("https://github.com/x/y");
      expect(result).toEqual({
        owner: "x",
        repo: "y",
        isGitHub: true,
        host: "github.com",
      });
    });

    it("should parse single-character owner and repo names via SSH", () => {
      const result = parseGitUrl("git@github.com:x/y.git");
      expect(result).toEqual({
        owner: "x",
        repo: "y",
        isGitHub: true,
        host: "github.com",
      });
    });
  });
});
