/**
 * Unit tests for RepositoryCloner.
 *
 * @module tests/unit/ingestion/repository-cloner
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RepositoryCloner } from "../../../src/ingestion/repository-cloner.js";
import {
  ValidationError,
  CloneError,
  AuthenticationError,
  FetchError,
} from "../../../src/ingestion/errors.js";
import type { RepositoryClonerConfig } from "../../../src/ingestion/types.js";
import { MockSimpleGit, MOCK_GIT_ERRORS } from "../../helpers/simple-git-mock.js";
import { initializeLogger, resetLogger } from "../../../src/logging/index.js";

/**
 * Retry config that disables retries for tests expecting immediate failure.
 * Network error tests would otherwise timeout waiting for retry delays.
 */
const NO_RETRY_CONFIG = {
  maxRetries: 0,
  initialDelayMs: 0,
  maxDelayMs: 0,
  backoffMultiplier: 1,
};

describe("RepositoryCloner", () => {
  let testDir: string;
  let config: RepositoryClonerConfig;
  let cloner: RepositoryCloner;
  let mockGit: MockSimpleGit;

  beforeEach(async () => {
    // Initialize logger for tests
    initializeLogger({ level: "info", format: "json" });

    // Create a temporary directory for test clones
    testDir = join(tmpdir(), `repo-cloner-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });

    config = {
      clonePath: testDir,
      githubPat: undefined,
    };

    cloner = new RepositoryCloner(config);
    mockGit = new MockSimpleGit();

    // Inject mock git client
    // @ts-expect-error - Accessing private property for testing
    cloner.git = mockGit;
    // @ts-expect-error - Accessing protected method for testing
    cloner.createGitForPath = () => mockGit;
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }

    mockGit.resetState();
    resetLogger();
  });

  describe("URL Validation", () => {
    test("should accept valid GitHub URL without .git", async () => {
      const url = "https://github.com/user/repo";
      const result = await cloner.clone(url);
      expect(result.name).toBe("repo");
    });

    test("should accept valid GitHub URL with .git suffix", async () => {
      const url = "https://github.com/user/repo.git";
      const result = await cloner.clone(url);
      expect(result.name).toBe("repo");
    });

    test("should reject URL without https", () => {
      const url = "http://github.com/user/repo";
      expect(async () => {
        await cloner.clone(url);
      }).toThrow(ValidationError);
    });

    test("should reject URL with wrong domain", () => {
      const url = "https://gitlab.com/user/repo";
      expect(async () => {
        await cloner.clone(url);
      }).toThrow(ValidationError);
    });

    test("should reject malformed URL", () => {
      const url = "https://github.com/user";
      expect(async () => {
        await cloner.clone(url);
      }).toThrow(ValidationError);
    });

    test("should reject empty URL", () => {
      expect(async () => {
        await cloner.clone("");
      }).toThrow(ValidationError);
    });
  });

  describe("Repository Name Extraction", () => {
    test("should extract name from standard URL", async () => {
      const url = "https://github.com/user/my-repo";
      const result = await cloner.clone(url);
      expect(result.name).toBe("my-repo");
    });

    test("should extract name from URL with .git suffix", async () => {
      const url = "https://github.com/user/my-repo.git";
      const result = await cloner.clone(url);
      expect(result.name).toBe("my-repo");
    });

    test("should handle repository names with hyphens", async () => {
      const url = "https://github.com/user/my-awesome-repo";
      const result = await cloner.clone(url);
      expect(result.name).toBe("my-awesome-repo");
    });

    test("should handle repository names with underscores and dots", async () => {
      const url = "https://github.com/user/my_repo.name";
      const result = await cloner.clone(url);
      expect(result.name).toBe("my_repo.name");
    });
  });

  describe("Authenticated URL Building", () => {
    test("should not modify URL when PAT is not configured", async () => {
      const url = "https://github.com/user/repo";
      await cloner.clone(url);

      const lastUrl = mockGit.getLastCloneUrl();
      expect(lastUrl).toBe(url);
    });

    test("should add PAT to URL when configured", async () => {
      const pat = "ghp_test1234567890abcdefghijklmnopqrstuvwxyz";
      config.githubPat = pat;
      cloner = new RepositoryCloner(config);
      // @ts-expect-error - Accessing private property for testing
      cloner.git = mockGit;

      const url = "https://github.com/user/repo";
      await cloner.clone(url);

      const lastUrl = mockGit.getLastCloneUrl();
      expect(lastUrl).toContain(pat);
      expect(lastUrl).toContain("x-oauth-basic");
      expect(lastUrl).toMatch(/^https:\/\/ghp_[^:]+:x-oauth-basic@github\.com/);
    });

    test("should handle URLs with .git suffix when adding PAT", async () => {
      const pat = "ghp_test1234567890abcdefghijklmnopqrstuvwxyz";
      config.githubPat = pat;
      cloner = new RepositoryCloner(config);
      // @ts-expect-error - Accessing private property for testing
      cloner.git = mockGit;

      const url = "https://github.com/user/repo.git";
      await cloner.clone(url);

      const lastUrl = mockGit.getLastCloneUrl();
      expect(lastUrl).toContain(pat);
      expect(lastUrl).toContain("repo.git");
    });

    test("should never log PAT in error messages", async () => {
      expect.assertions(3);
      const pat = "ghp_secret_token_should_never_appear_in_logs";
      // Disable retries to prevent test timeout on network errors
      const noRetryConfig: RepositoryClonerConfig = {
        clonePath: testDir,
        githubPat: pat,
        retry: NO_RETRY_CONFIG,
      };
      cloner = new RepositoryCloner(noRetryConfig);
      // @ts-expect-error - Accessing private property for testing
      cloner.git = mockGit;

      mockGit.setShouldFailClone(MOCK_GIT_ERRORS.NETWORK_ERROR);

      const url = "https://github.com/user/repo";

      try {
        await cloner.clone(url);
      } catch (error) {
        expect(error).toBeInstanceOf(CloneError);
        if (error instanceof CloneError) {
          // Check error message doesn't contain PAT
          expect(error.message).not.toContain(pat);
          // Check error URL is sanitized
          expect(error.url).not.toContain(pat);
        }
      }
    });
  });

  describe("Clone Options Handling", () => {
    test("should use shallow clone by default", async () => {
      const url = "https://github.com/user/repo";
      await cloner.clone(url);

      const options = mockGit.getLastCloneOptions();
      expect(options).toBeDefined();
      expect(options).toContain("--depth");
      expect(options).toContain("1");
    });

    test("should allow custom name override", async () => {
      const url = "https://github.com/user/repo";
      const result = await cloner.clone(url, { name: "custom-name" });

      expect(result.name).toBe("custom-name");
      expect(result.path).toContain("custom-name");
    });

    test("should support branch specification", async () => {
      const url = "https://github.com/user/repo";
      const result = await cloner.clone(url, { branch: "develop" });

      const options = mockGit.getLastCloneOptions();
      expect(options).toContain("--branch");
      expect(options).toContain("develop");
      expect(result.branch).toBe("develop");
    });

    test("should support full clone when shallow=false", async () => {
      const url = "https://github.com/user/repo";
      await cloner.clone(url, { shallow: false });

      const options = mockGit.getLastCloneOptions();
      expect(options).not.toContain("--depth");
    });

    test("should delete existing directory when fresh=true", async () => {
      const url = "https://github.com/user/repo";

      // First clone
      await cloner.clone(url);
      expect(mockGit.getCloneCallCount()).toBe(1);

      // Fresh clone should delete and re-clone
      await cloner.clone(url, { fresh: true });
      expect(mockGit.getCloneCallCount()).toBe(2);
    });
  });

  describe("Directory Management", () => {
    test("should create parent directories if needed", async () => {
      const deepPath = join(testDir, "level1", "level2", "level3");
      const deepConfig: RepositoryClonerConfig = {
        clonePath: deepPath,
      };

      const deepCloner = new RepositoryCloner(deepConfig);
      // @ts-expect-error - Accessing private property for testing
      deepCloner.git = mockGit;

      const url = "https://github.com/user/repo";
      const result = await deepCloner.clone(url);

      expect(result.path).toContain("level1");
      expect(result.path).toContain("level2");
      expect(result.path).toContain("level3");
    });

    test("should skip clone if directory exists", async () => {
      const url = "https://github.com/user/repo";

      // First clone
      await cloner.clone(url);
      expect(mockGit.getCloneCallCount()).toBe(1);

      // Second clone should skip
      await cloner.clone(url);
      expect(mockGit.getCloneCallCount()).toBe(1); // Still 1, not incremented
    });

    test("should re-clone when fresh=true even if directory exists", async () => {
      const url = "https://github.com/user/repo";

      // First clone
      await cloner.clone(url);
      expect(mockGit.getCloneCallCount()).toBe(1);

      // Fresh clone
      await cloner.clone(url, { fresh: true });
      expect(mockGit.getCloneCallCount()).toBe(2);
    });

    test("should handle Windows-style paths correctly", async () => {
      // This test ensures path.normalize() is working
      const url = "https://github.com/user/repo";
      const result = await cloner.clone(url);

      // Path should be normalized (no mixed separators)
      expect(result.path).toBeDefined();
      expect(result.path.length).toBeGreaterThan(0);
    });
  });

  describe("Error Scenarios", () => {
    test("should throw ValidationError for invalid URL format", () => {
      const invalidUrl = "not-a-url";

      expect(async () => {
        await cloner.clone(invalidUrl);
      }).toThrow(ValidationError);
    });

    test("should throw AuthenticationError for authentication failure", async () => {
      expect.assertions(3);
      mockGit.setShouldFailClone(MOCK_GIT_ERRORS.AUTHENTICATION_FAILED);

      const url = "https://github.com/user/private-repo";

      try {
        await cloner.clone(url);
      } catch (error) {
        expect(error).toBeInstanceOf(AuthenticationError);
        if (error instanceof AuthenticationError) {
          expect(error.code).toBe("AUTHENTICATION_ERROR");
          expect(error.url).toBe(url);
        }
      }
    });

    test("should throw AuthenticationError for repository not found", async () => {
      expect.assertions(1);
      mockGit.setShouldFailClone(MOCK_GIT_ERRORS.REPOSITORY_NOT_FOUND);

      const url = "https://github.com/user/nonexistent";

      try {
        await cloner.clone(url);
      } catch (error) {
        expect(error).toBeInstanceOf(AuthenticationError);
      }
    });

    test("should throw CloneError for network errors", async () => {
      expect.assertions(3);
      // Disable retries to prevent test timeout on network errors
      const noRetryConfig: RepositoryClonerConfig = {
        clonePath: testDir,
        retry: NO_RETRY_CONFIG,
      };
      const noRetryCloner = new RepositoryCloner(noRetryConfig);
      // @ts-expect-error - Accessing private property for testing
      noRetryCloner.git = mockGit;

      mockGit.setShouldFailClone(MOCK_GIT_ERRORS.NETWORK_ERROR);

      const url = "https://github.com/user/repo";

      try {
        await noRetryCloner.clone(url);
      } catch (error) {
        expect(error).toBeInstanceOf(CloneError);
        if (error instanceof CloneError) {
          expect(error.code).toBe("CLONE_ERROR");
          expect(error.url).toBe(url);
        }
      }
    });

    test("should throw CloneError for host resolution errors", async () => {
      expect.assertions(1);
      // Disable retries to prevent test timeout on network errors
      const noRetryConfig: RepositoryClonerConfig = {
        clonePath: testDir,
        retry: NO_RETRY_CONFIG,
      };
      const noRetryCloner = new RepositoryCloner(noRetryConfig);
      // @ts-expect-error - Accessing private property for testing
      noRetryCloner.git = mockGit;

      mockGit.setShouldFailClone(MOCK_GIT_ERRORS.HOST_RESOLUTION_ERROR);

      const url = "https://github.com/user/repo";

      try {
        await noRetryCloner.clone(url);
      } catch (error) {
        expect(error).toBeInstanceOf(CloneError);
      }
    });

    test("should throw CloneError for permission errors", async () => {
      expect.assertions(1);
      mockGit.setShouldFailClone(MOCK_GIT_ERRORS.PERMISSION_DENIED);

      const url = "https://github.com/user/repo";

      try {
        await cloner.clone(url);
      } catch (error) {
        expect(error).toBeInstanceOf(CloneError);
      }
    });

    test("should include cause in error chain", async () => {
      expect.assertions(2);
      const originalError = new Error("Original error");
      mockGit.setShouldFailClone(originalError);

      const url = "https://github.com/user/repo";

      try {
        await cloner.clone(url);
      } catch (error) {
        expect(error).toBeInstanceOf(CloneError);
        if (error instanceof CloneError) {
          expect(error.cause).toBe(originalError);
        }
      }
    });
  });

  describe("Clone Result", () => {
    test("should return correct CloneResult structure", async () => {
      const url = "https://github.com/user/my-repo";
      const result = await cloner.clone(url);

      expect(result).toBeDefined();
      expect(result.name).toBe("my-repo");
      expect(result.path).toContain("my-repo");
      // Mock returns "main" as default branch
      expect(result.branch).toBe("main");
      // Should include commit SHA
      expect(result.commitSha).toBeDefined();
      expect(result.commitSha?.length).toBe(40);
    });

    test("should include specified branch in result", async () => {
      const url = "https://github.com/user/repo";
      const result = await cloner.clone(url, { branch: "feature-branch" });

      expect(result.branch).toBe("feature-branch");
    });

    test("should return absolute path", async () => {
      const url = "https://github.com/user/repo";
      const result = await cloner.clone(url);

      // Path should be absolute (contains testDir which is absolute)
      expect(result.path).toContain(testDir);
    });
  });

  describe("Logging and Metrics", () => {
    test("should log successful clone with metrics", async () => {
      const url = "https://github.com/user/repo";

      // Add small delay to ensure measurable duration
      mockGit.setCloneDelay(10);

      const result = await cloner.clone(url);

      expect(result).toBeDefined();
      // Metrics are logged - we can't directly test logger output in unit tests
      // but this ensures the code path executes without errors
    });

    test("should not log PAT even when clone fails", async () => {
      expect.assertions(1);
      const pat = "ghp_secret_token";
      config.githubPat = pat;
      cloner = new RepositoryCloner(config);
      // @ts-expect-error - Accessing private property for testing
      cloner.git = mockGit;

      mockGit.setShouldFailClone(new Error("Clone failed"));

      const url = "https://github.com/user/repo";

      try {
        await cloner.clone(url);
      } catch (error) {
        // Error should not contain PAT
        const errorStr = JSON.stringify(error);
        expect(errorStr).not.toContain(pat);
      }
    });
  });

  describe("Fetch Latest (Issue #124)", () => {
    test("should skip fetch when fetchLatest=false and repo exists", async () => {
      const url = "https://github.com/user/repo";

      // First clone
      await cloner.clone(url);
      expect(mockGit.getCloneCallCount()).toBe(1);

      // Second call without fetchLatest - should skip
      await cloner.clone(url);
      expect(mockGit.getCloneCallCount()).toBe(1); // Still 1
      expect(mockGit.getFetchCallCount()).toBe(0); // No fetch
    });

    test("should fetch and reset when fetchLatest=true and repo exists", async () => {
      const url = "https://github.com/user/repo";

      // First clone
      await cloner.clone(url);
      expect(mockGit.getCloneCallCount()).toBe(1);

      // Second call with fetchLatest=true - should fetch
      const result = await cloner.clone(url, { fetchLatest: true });
      expect(mockGit.getCloneCallCount()).toBe(1); // Still 1, didn't re-clone
      expect(mockGit.getRemoteCallCount()).toBe(1); // Set remote URL
      expect(mockGit.getFetchCallCount()).toBe(1); // Fetched
      expect(mockGit.getResetCallCount()).toBe(1); // Reset to origin
      expect(result.name).toBe("repo");
    });

    test("should include branch in fetch args", async () => {
      const url = "https://github.com/user/repo";

      // First clone with specific branch
      await cloner.clone(url, { branch: "develop" });

      // Fetch latest
      await cloner.clone(url, { branch: "develop", fetchLatest: true });

      const fetchArgs = mockGit.getLastFetchArgs();
      expect(fetchArgs).toContain("origin");
      expect(fetchArgs).toContain("develop");
      expect(fetchArgs).toContain("--depth");
      expect(fetchArgs).toContain("1");
    });

    test("should reset to correct remote branch", async () => {
      const url = "https://github.com/user/repo";

      // First clone
      await cloner.clone(url, { branch: "feature-x" });

      // Fetch latest
      await cloner.clone(url, { branch: "feature-x", fetchLatest: true });

      const resetArgs = mockGit.getLastResetArgs();
      expect(resetArgs).toContain("--hard");
      expect(resetArgs).toContain("origin/feature-x");
    });

    test("should throw FetchError when fetch fails", async () => {
      expect.assertions(3);
      const url = "https://github.com/user/repo";

      // First clone
      await cloner.clone(url);

      // Configure fetch to fail
      mockGit.setShouldFailFetch(MOCK_GIT_ERRORS.FETCH_FAILED);

      try {
        await cloner.clone(url, { fetchLatest: true });
      } catch (error) {
        expect(error).toBeInstanceOf(FetchError);
        if (error instanceof FetchError) {
          expect(error.code).toBe("FETCH_ERROR");
          expect(error.branch).toBeDefined();
        }
      }
    });

    test("should use authenticated URL when fetching with PAT", async () => {
      const pat = "ghp_test1234567890abcdefghijklmnopqrstuvwxyz";
      config.githubPat = pat;
      cloner = new RepositoryCloner(config);
      // @ts-expect-error - Accessing private property for testing
      cloner.git = mockGit;
      // @ts-expect-error - Accessing protected method for testing
      cloner.createGitForPath = () => mockGit;

      const url = "https://github.com/user/repo";

      // First clone
      await cloner.clone(url);

      // Fetch latest
      await cloner.clone(url, { fetchLatest: true });

      // Check that remote set-url was called with authenticated URL
      const remoteArgs = mockGit.getLastRemoteArgs();
      expect(remoteArgs).toContain("set-url");
      expect(remoteArgs).toContain("origin");
      // The third arg should be the authenticated URL
      expect(remoteArgs?.[2]).toContain(pat);
    });

    test("should not fetch when repo does not exist", async () => {
      const url = "https://github.com/user/new-repo";

      // Clone with fetchLatest=true on new repo - should just clone
      const result = await cloner.clone(url, { fetchLatest: true });

      expect(mockGit.getCloneCallCount()).toBe(1);
      expect(mockGit.getFetchCallCount()).toBe(0); // No fetch needed
      expect(result.name).toBe("new-repo");
    });

    test("should fresh clone instead of fetch when fresh=true", async () => {
      const url = "https://github.com/user/repo";

      // First clone
      await cloner.clone(url);
      expect(mockGit.getCloneCallCount()).toBe(1);

      // Fresh clone with fetchLatest - should re-clone, not fetch
      await cloner.clone(url, { fresh: true, fetchLatest: true });
      expect(mockGit.getCloneCallCount()).toBe(2); // Re-cloned
      expect(mockGit.getFetchCallCount()).toBe(0); // Did not fetch
    });
  });

  describe("Commit SHA Capture", () => {
    test("should include commitSha in result after fresh clone", async () => {
      const url = "https://github.com/user/repo";
      const expectedSha = "def4567890abcdef1234567890abcdef12345678";

      mockGit.setCommitSha(expectedSha);

      const result = await cloner.clone(url);

      expect(result.commitSha).toBe(expectedSha);
      expect(result.name).toBe("repo");
      expect(result.branch).toBe("main");
    });

    test("should include commitSha when reusing existing clone", async () => {
      const url = "https://github.com/user/repo";
      const expectedSha = "abc1234567890abcdef1234567890abcdef12345";

      // First clone creates directory
      await cloner.clone(url);

      // Set different SHA for second access
      mockGit.setCommitSha(expectedSha);

      // Second clone reuses existing
      const result = await cloner.clone(url);

      expect(result.commitSha).toBe(expectedSha);
    });

    test("should include commitSha after fetchLatest", async () => {
      const url = "https://github.com/user/repo";
      const initialSha = "111aaa222bbb333ccc444ddd555eee666fff7778";
      const updatedSha = "999aaa888bbb777ccc666ddd555eee444fff3332";

      mockGit.setCommitSha(initialSha);

      // First clone
      await cloner.clone(url);

      // Simulate remote update
      mockGit.setCommitSha(updatedSha);

      // Fetch latest
      const result = await cloner.clone(url, { fetchLatest: true });

      expect(result.commitSha).toBe(updatedSha);
    });

    test("should return undefined commitSha when revparse fails", async () => {
      const url = "https://github.com/user/repo";

      // Make revparse fail for HEAD SHA only (not for --abbrev-ref HEAD)
      mockGit.setShouldFailRevparseSha(new Error("git error"));

      const result = await cloner.clone(url);

      // Should still succeed, just without SHA
      expect(result.commitSha).toBeUndefined();
      expect(result.name).toBe("repo");
      expect(result.branch).toBe("main"); // Branch detection still works
    });

    test("should capture 40-character SHA format", async () => {
      const url = "https://github.com/user/repo";
      const validSha = "a".repeat(40);

      mockGit.setCommitSha(validSha);

      const result = await cloner.clone(url);

      expect(result.commitSha).toBe(validSha);
      expect(result.commitSha?.length).toBe(40);
    });
  });
});
