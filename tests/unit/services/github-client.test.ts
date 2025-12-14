/**
 * Unit tests for GitHubClientImpl
 *
 * Tests the GitHub API client for change detection functionality
 * with mocked API responses.
 */

/* eslint-disable @typescript-eslint/await-thenable */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";

import { GitHubClientImpl } from "../../../src/services/github-client.js";
import {
  GitHubAuthenticationError,
  GitHubRateLimitError,
  GitHubNotFoundError,
  GitHubNetworkError,
  GitHubAPIError,
  GitHubValidationError,
} from "../../../src/services/github-client-errors.js";
import { initializeLogger, resetLogger } from "../../../src/logging/index.js";

import { MockGitHubAPI, MockErrors } from "../../helpers/github-api-mock.js";
import {
  TEST_REPOS,
  TEST_SHAS,
  TEST_CONFIGS,
  INVALID_INPUTS,
  VALID_EDGE_CASES,
  createMockCommitResponse,
  createMockCompareResponse,
} from "../../fixtures/github-fixtures.js";

describe("GitHubClientImpl", () => {
  let mockAPI: MockGitHubAPI;
  let client: GitHubClientImpl;

  beforeEach(() => {
    initializeLogger({ level: "error", format: "json" });
    mockAPI = new MockGitHubAPI();
    mockAPI.install();
    client = new GitHubClientImpl(TEST_CONFIGS.default);
  });

  afterEach(() => {
    mockAPI.uninstall();
    mockAPI.reset();
    resetLogger();
  });

  describe("constructor", () => {
    test("accepts valid configuration", () => {
      const client = new GitHubClientImpl(TEST_CONFIGS.default);
      expect(client).toBeInstanceOf(GitHubClientImpl);
    });

    test("accepts configuration without token", () => {
      const client = new GitHubClientImpl(TEST_CONFIGS.noToken);
      expect(client).toBeInstanceOf(GitHubClientImpl);
    });

    test("accepts empty configuration with defaults", () => {
      const client = new GitHubClientImpl({});
      expect(client).toBeInstanceOf(GitHubClientImpl);
    });

    test("accepts enterprise base URL", () => {
      const client = new GitHubClientImpl(TEST_CONFIGS.enterprise);
      expect(client).toBeInstanceOf(GitHubClientImpl);
    });

    test("throws on invalid timeout (too low)", () => {
      expect(() => new GitHubClientImpl({ timeoutMs: 100 })).toThrow(GitHubValidationError);
    });

    test("throws on invalid timeout (too high)", () => {
      expect(() => new GitHubClientImpl({ timeoutMs: 500000 })).toThrow(GitHubValidationError);
    });

    test("throws on invalid maxRetries (negative)", () => {
      expect(() => new GitHubClientImpl({ maxRetries: -1 })).toThrow(GitHubValidationError);
    });

    test("throws on invalid maxRetries (too high)", () => {
      expect(() => new GitHubClientImpl({ maxRetries: 15 })).toThrow(GitHubValidationError);
    });

    test("throws on invalid baseUrl", () => {
      expect(() => new GitHubClientImpl({ baseUrl: "not-a-url" })).toThrow(GitHubValidationError);
    });
  });

  describe("getHeadCommit", () => {
    test("retrieves HEAD commit successfully", async () => {
      const result = await client.getHeadCommit(TEST_REPOS.valid.owner, TEST_REPOS.valid.repo);

      expect(result.sha).toBe(TEST_SHAS.head);
      expect(result.message).toBe("feat: add new feature");
      expect(result.author).toBe("Test Author");
      expect(result.date).toBe("2024-01-15T10:30:00Z");
    });

    test("retrieves commit for specific branch", async () => {
      const customSha = "custom123456789012345678901234567890abc";
      mockAPI.setCommitResponse(createMockCommitResponse({ sha: customSha }));

      const result = await client.getHeadCommit(
        TEST_REPOS.valid.owner,
        TEST_REPOS.valid.repo,
        TEST_REPOS.valid.branch
      );

      expect(result.sha).toBe(customSha);
      expect(mockAPI.wasCalledWith("/commits/main")).toBe(true);
    });

    test("extracts first line of multi-line commit message", async () => {
      mockAPI.setCommitResponse(
        createMockCommitResponse({
          message: "First line\n\nSecond paragraph\nThird line",
        })
      );

      const result = await client.getHeadCommit(TEST_REPOS.valid.owner, TEST_REPOS.valid.repo);

      expect(result.message).toBe("First line");
    });

    test("includes Authorization header when token provided", async () => {
      await client.getHeadCommit(TEST_REPOS.valid.owner, TEST_REPOS.valid.repo);

      const lastCall = mockAPI.getLastCall();
      expect(lastCall?.headers["Authorization"]).toBe(`Bearer ${TEST_CONFIGS.default.token}`);
    });

    test("does not include Authorization header when no token", async () => {
      const noTokenClient = new GitHubClientImpl(TEST_CONFIGS.noToken);
      await noTokenClient.getHeadCommit(TEST_REPOS.valid.owner, TEST_REPOS.valid.repo);

      const lastCall = mockAPI.getLastCall();
      expect(lastCall?.headers["Authorization"]).toBeUndefined();
    });

    describe("input validation", () => {
      test.each(INVALID_INPUTS.owners)("throws on invalid owner: %s", async (owner) => {
        await expect(client.getHeadCommit(owner, TEST_REPOS.valid.repo)).rejects.toThrow(
          GitHubValidationError
        );
      });

      test.each(INVALID_INPUTS.repos)("throws on invalid repo: %s", async (repo) => {
        await expect(client.getHeadCommit(TEST_REPOS.valid.owner, repo)).rejects.toThrow(
          GitHubValidationError
        );
      });

      test.each(VALID_EDGE_CASES.owners)("accepts valid owner: %s", async (owner) => {
        const result = await client.getHeadCommit(owner, TEST_REPOS.valid.repo);
        expect(result.sha).toBeDefined();
      });

      test.each(VALID_EDGE_CASES.repos)("accepts valid repo: %s", async (repo) => {
        const result = await client.getHeadCommit(TEST_REPOS.valid.owner, repo);
        expect(result.sha).toBeDefined();
      });
    });

    describe("error handling", () => {
      test("throws GitHubAuthenticationError on 401", async () => {
        mockAPI.setFailure(MockErrors.unauthorized());

        await expect(
          client.getHeadCommit(TEST_REPOS.valid.owner, TEST_REPOS.valid.repo)
        ).rejects.toThrow(GitHubAuthenticationError);
      });

      test("throws GitHubAuthenticationError on 403 (permissions)", async () => {
        mockAPI.setFailure(MockErrors.forbidden());

        await expect(
          client.getHeadCommit(TEST_REPOS.valid.owner, TEST_REPOS.valid.repo)
        ).rejects.toThrow(GitHubAuthenticationError);
      });

      test("throws GitHubRateLimitError on rate limit exceeded", async () => {
        const noRetryClient = new GitHubClientImpl(TEST_CONFIGS.noRetries);
        mockAPI.setFailure(MockErrors.rateLimited());

        await expect(
          noRetryClient.getHeadCommit(TEST_REPOS.valid.owner, TEST_REPOS.valid.repo)
        ).rejects.toThrow(GitHubRateLimitError);
      });

      test("throws GitHubNotFoundError on 404", async () => {
        mockAPI.setFailure(MockErrors.notFound());

        await expect(
          client.getHeadCommit(TEST_REPOS.valid.owner, TEST_REPOS.valid.repo)
        ).rejects.toThrow(GitHubNotFoundError);
      });

      test("throws GitHubAPIError on 500", async () => {
        const noRetryClient = new GitHubClientImpl(TEST_CONFIGS.noRetries);
        mockAPI.setFailure(MockErrors.internalError());

        await expect(
          noRetryClient.getHeadCommit(TEST_REPOS.valid.owner, TEST_REPOS.valid.repo)
        ).rejects.toThrow(GitHubAPIError);
      });

      test("throws GitHubNetworkError on ECONNREFUSED", async () => {
        const noRetryClient = new GitHubClientImpl(TEST_CONFIGS.noRetries);
        mockAPI.setNetworkError("connect ECONNREFUSED 127.0.0.1:443");

        await expect(
          noRetryClient.getHeadCommit(TEST_REPOS.valid.owner, TEST_REPOS.valid.repo)
        ).rejects.toThrow(GitHubNetworkError);
      });

      test("throws GitHubNetworkError on ETIMEDOUT", async () => {
        const noRetryClient = new GitHubClientImpl(TEST_CONFIGS.noRetries);
        mockAPI.setNetworkError("connect ETIMEDOUT 140.82.114.4:443");

        await expect(
          noRetryClient.getHeadCommit(TEST_REPOS.valid.owner, TEST_REPOS.valid.repo)
        ).rejects.toThrow(GitHubNetworkError);
      });
    });

    describe("retry behavior", () => {
      test("retries on transient 503 error", async () => {
        mockAPI.setTransientFailure(MockErrors.serviceUnavailable(), 2);

        const result = await client.getHeadCommit(TEST_REPOS.valid.owner, TEST_REPOS.valid.repo);

        expect(result.sha).toBeDefined();
        expect(mockAPI.getCallCount()).toBe(3); // 2 failures + 1 success
      });

      test("retries on rate limit error", async () => {
        mockAPI.setTransientFailure(MockErrors.rateLimited(), 1);

        const result = await client.getHeadCommit(TEST_REPOS.valid.owner, TEST_REPOS.valid.repo);

        expect(result.sha).toBeDefined();
        expect(mockAPI.getCallCount()).toBe(2);
      });

      test("does not retry on 404", async () => {
        mockAPI.setFailure(MockErrors.notFound());

        await expect(
          client.getHeadCommit(TEST_REPOS.valid.owner, TEST_REPOS.valid.repo)
        ).rejects.toThrow(GitHubNotFoundError);

        expect(mockAPI.getCallCount()).toBe(1);
      });

      test("does not retry on 401", async () => {
        mockAPI.setFailure(MockErrors.unauthorized());

        await expect(
          client.getHeadCommit(TEST_REPOS.valid.owner, TEST_REPOS.valid.repo)
        ).rejects.toThrow(GitHubAuthenticationError);

        expect(mockAPI.getCallCount()).toBe(1);
      });

      test("respects maxRetries configuration", async () => {
        const noRetryClient = new GitHubClientImpl(TEST_CONFIGS.noRetries);
        mockAPI.setFailure(MockErrors.serviceUnavailable());

        await expect(
          noRetryClient.getHeadCommit(TEST_REPOS.valid.owner, TEST_REPOS.valid.repo)
        ).rejects.toThrow(GitHubAPIError);

        expect(mockAPI.getCallCount()).toBe(1);
      });
    });
  });

  describe("compareCommits", () => {
    test("compares commits successfully", async () => {
      const result = await client.compareCommits(
        TEST_REPOS.valid.owner,
        TEST_REPOS.valid.repo,
        TEST_SHAS.base,
        TEST_SHAS.head
      );

      expect(result.baseSha).toBe(TEST_SHAS.base);
      expect(result.totalCommits).toBe(5);
      expect(result.files.length).toBe(5);
    });

    test("correctly parses file statuses", async () => {
      const result = await client.compareCommits(
        TEST_REPOS.valid.owner,
        TEST_REPOS.valid.repo,
        TEST_SHAS.base,
        TEST_SHAS.head
      );

      const addedFile = result.files.find((f) => f.path === "src/new-file.ts");
      expect(addedFile?.status).toBe("added");

      const modifiedFile = result.files.find((f) => f.path === "src/index.ts");
      expect(modifiedFile?.status).toBe("modified");

      const deletedFile = result.files.find((f) => f.path === "old-file.ts");
      expect(deletedFile?.status).toBe("deleted");
    });

    test("correctly handles renamed files", async () => {
      const result = await client.compareCommits(
        TEST_REPOS.valid.owner,
        TEST_REPOS.valid.repo,
        TEST_SHAS.base,
        TEST_SHAS.head
      );

      const renamedFile = result.files.find((f) => f.path === "renamed-file.ts");
      expect(renamedFile?.status).toBe("renamed");
      expect(renamedFile?.previousPath).toBe("old-name.ts");
    });

    test("handles comparison with no file changes", async () => {
      mockAPI.setCompareResponse(createMockCompareResponse({ files: [] }));

      const result = await client.compareCommits(
        TEST_REPOS.valid.owner,
        TEST_REPOS.valid.repo,
        TEST_SHAS.base,
        TEST_SHAS.head
      );

      expect(result.files.length).toBe(0);
    });

    test("handles comparison with many files", async () => {
      const manyFiles = Array.from({ length: 100 }, (_, i) => ({
        filename: `file${i}.ts`,
        status: "modified",
      }));
      mockAPI.setCompareResponse(createMockCompareResponse({ files: manyFiles }));

      const result = await client.compareCommits(
        TEST_REPOS.valid.owner,
        TEST_REPOS.valid.repo,
        TEST_SHAS.base,
        TEST_SHAS.head
      );

      expect(result.files.length).toBe(100);
    });

    describe("input validation", () => {
      test.each(INVALID_INPUTS.refs)("throws on invalid base ref: %s", async (ref) => {
        await expect(
          client.compareCommits(TEST_REPOS.valid.owner, TEST_REPOS.valid.repo, ref, TEST_SHAS.head)
        ).rejects.toThrow(GitHubValidationError);
      });

      test.each(INVALID_INPUTS.refs)("throws on invalid head ref: %s", async (ref) => {
        await expect(
          client.compareCommits(TEST_REPOS.valid.owner, TEST_REPOS.valid.repo, TEST_SHAS.base, ref)
        ).rejects.toThrow(GitHubValidationError);
      });
    });

    describe("error handling", () => {
      test("throws GitHubNotFoundError when commits not found", async () => {
        mockAPI.setFailure(MockErrors.notFound());

        await expect(
          client.compareCommits(
            TEST_REPOS.valid.owner,
            TEST_REPOS.valid.repo,
            "nonexistent",
            "alsonotexistent"
          )
        ).rejects.toThrow(GitHubNotFoundError);
      });

      test("throws GitHubValidationError on 422", async () => {
        mockAPI.setFailure(MockErrors.validationFailed());

        await expect(
          client.compareCommits(
            TEST_REPOS.valid.owner,
            TEST_REPOS.valid.repo,
            TEST_SHAS.base,
            TEST_SHAS.head
          )
        ).rejects.toThrow(GitHubValidationError);
      });
    });
  });

  describe("healthCheck", () => {
    test("returns true when API is accessible", async () => {
      const result = await client.healthCheck();
      expect(result).toBe(true);
    });

    test("returns false on authentication error", async () => {
      mockAPI.setFailure(MockErrors.unauthorized());

      const result = await client.healthCheck();
      expect(result).toBe(false);
    });

    test("returns false on network error", async () => {
      const noRetryClient = new GitHubClientImpl(TEST_CONFIGS.noRetries);
      mockAPI.setNetworkError("connect ECONNREFUSED");

      const result = await noRetryClient.healthCheck();
      expect(result).toBe(false);
    });

    test("calls rate_limit endpoint", async () => {
      await client.healthCheck();

      expect(mockAPI.wasCalledWith("/rate_limit")).toBe(true);
    });
  });

  describe("security", () => {
    test("does not expose token in error messages", async () => {
      const noRetryClient = new GitHubClientImpl(TEST_CONFIGS.noRetries);
      mockAPI.setNetworkError("Network error with token ghp_test1234567890abcdefghijklmnopqrstuv");

      try {
        await noRetryClient.getHeadCommit(TEST_REPOS.valid.owner, TEST_REPOS.valid.repo);
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect((error as Error).message).not.toContain("ghp_test1234567890");
        expect((error as Error).message).toContain("[REDACTED]");
      }
    });

    test("does not expose fine-grained PAT in error messages", async () => {
      const noRetryClient = new GitHubClientImpl(TEST_CONFIGS.noRetries);
      const finePat = "github_pat_" + "a".repeat(82);
      mockAPI.setNetworkError(`Network error with token ${finePat}`);

      try {
        await noRetryClient.getHeadCommit(TEST_REPOS.valid.owner, TEST_REPOS.valid.repo);
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect((error as Error).message).not.toContain("github_pat_");
        expect((error as Error).message).toContain("[REDACTED]");
      }
    });

    test("does not expose Bearer token in error messages", async () => {
      const noRetryClient = new GitHubClientImpl(TEST_CONFIGS.noRetries);
      mockAPI.setNetworkError("Error: Bearer ghp_secrettoken123456789");

      try {
        await noRetryClient.getHeadCommit(TEST_REPOS.valid.owner, TEST_REPOS.valid.repo);
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect((error as Error).message).not.toContain("ghp_secrettoken");
        expect((error as Error).message).toContain("[REDACTED]");
      }
    });
  });
});
