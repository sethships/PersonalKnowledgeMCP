/**
 * Unit tests for MCP error mapping utilities
 *
 * Tests all error mapping scenarios to ensure SearchService errors are properly
 * converted to MCP protocol errors without leaking sensitive information.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import {
  mapToMCPError,
  createValidationError,
  createMethodNotFoundError,
} from "../../src/mcp/errors.js";
import {
  SearchValidationError,
  RepositoryNotFoundError,
  RepositoryNotReadyError,
  NoRepositoriesAvailableError,
  SearchOperationError,
  SearchError,
} from "../../src/services/errors.js";
import {
  GitHubAuthenticationError,
  GitHubRateLimitError,
  GitHubNotFoundError,
  GitHubNetworkError,
  GitHubAPIError,
  GitHubValidationError,
} from "../../src/services/github-client-errors.js";
import {
  CoordinatorError,
  ForcePushDetectedError,
  ChangeThresholdExceededError,
  MissingCommitShaError,
  ConcurrentUpdateError,
  GitPullError,
} from "../../src/services/incremental-update-coordinator-errors.js";
import { initializeLogger, resetLogger } from "../../src/logging/index.js";

describe("MCP Error Mapping", () => {
  beforeEach(() => {
    initializeLogger({ level: "silent", format: "json" });
  });

  afterEach(() => {
    resetLogger();
  });

  describe("mapToMCPError", () => {
    describe("SearchValidationError mapping", () => {
      it("should map to InvalidParams error code", () => {
        const error = new SearchValidationError("Query cannot be empty");
        const mcpError = mapToMCPError(error);

        expect(mcpError.code).toBe(ErrorCode.InvalidParams);
        expect(mcpError.message).toContain("Query cannot be empty");
      });

      it("should preserve validation error message", () => {
        const error = new SearchValidationError("Invalid query: too long", [
          "query: exceeds maximum length",
        ]);
        const mcpError = mapToMCPError(error);

        expect(mcpError.message).toContain("Invalid query: too long");
      });
    });

    describe("RepositoryNotFoundError mapping", () => {
      it("should map to InvalidParams error code", () => {
        const error = new RepositoryNotFoundError("my-repo");
        const mcpError = mapToMCPError(error);

        expect(mcpError.code).toBe(ErrorCode.InvalidParams);
      });

      it("should include repository name in message", () => {
        const error = new RepositoryNotFoundError("test-api");
        const mcpError = mapToMCPError(error);

        expect(mcpError.message).toContain("test-api");
        expect(mcpError.message).toContain("not found");
      });

      it("should suggest indexing the repository", () => {
        const error = new RepositoryNotFoundError("new-repo");
        const mcpError = mapToMCPError(error);

        expect(mcpError.message).toContain("index");
      });
    });

    describe("RepositoryNotReadyError mapping", () => {
      it("should map to InvalidParams error code", () => {
        const error = new RepositoryNotReadyError("my-repo", "indexing");
        const mcpError = mapToMCPError(error);

        expect(mcpError.code).toBe(ErrorCode.InvalidParams);
      });

      it("should include repository name and status", () => {
        const error = new RepositoryNotReadyError("test-repo", "error");
        const mcpError = mapToMCPError(error);

        expect(mcpError.message).toContain("test-repo");
        expect(mcpError.message).toContain("error");
      });

      it("should suggest waiting when status is indexing", () => {
        const error = new RepositoryNotReadyError("my-repo", "indexing");
        const mcpError = mapToMCPError(error);

        expect(mcpError.message).toContain("wait");
        expect(mcpError.message).toContain("indexing");
      });

      it("should not suggest waiting for error status", () => {
        const error = new RepositoryNotReadyError("my-repo", "error");
        const mcpError = mapToMCPError(error);

        expect(mcpError.message).not.toContain("wait");
      });
    });

    describe("NoRepositoriesAvailableError mapping", () => {
      it("should map to InvalidParams error code", () => {
        const error = new NoRepositoriesAvailableError();
        const mcpError = mapToMCPError(error);

        expect(mcpError.code).toBe(ErrorCode.InvalidParams);
      });

      it("should suggest indexing a repository", () => {
        const error = new NoRepositoriesAvailableError();
        const mcpError = mapToMCPError(error);

        expect(mcpError.message).toContain("index");
        expect(mcpError.message).toContain("repository");
      });
    });

    describe("SearchOperationError mapping", () => {
      it("should map to InternalError error code", () => {
        const error = new SearchOperationError("Embedding service failed");
        const mcpError = mapToMCPError(error);

        expect(mcpError.code).toBe(ErrorCode.InternalError);
      });

      it("should sanitize error message to prevent information leakage", () => {
        const error = new SearchOperationError("Database connection failed at /internal/path");
        const mcpError = mapToMCPError(error);

        // Should return generic message, not internal details
        expect(mcpError.message).toContain("Search operation failed. Please try again.");
        expect(mcpError.message).not.toContain("/internal/path");
      });

      it("should not leak stack traces", () => {
        const cause = new Error("Internal database error with /secret/path");
        const error = new SearchOperationError("Operation failed", true, cause);
        const mcpError = mapToMCPError(error);

        expect(mcpError.message).not.toContain("secret");
        expect(mcpError.message).not.toContain("database");
      });
    });

    describe("Generic SearchError mapping", () => {
      class CustomSearchError extends SearchError {
        constructor() {
          super("Custom search error", false);
        }
      }

      it("should map unknown SearchError subclasses to InternalError", () => {
        const error = new CustomSearchError();
        const mcpError = mapToMCPError(error);

        expect(mcpError.code).toBe(ErrorCode.InternalError);
      });

      it("should sanitize custom error messages", () => {
        const error = new CustomSearchError();
        const mcpError = mapToMCPError(error);

        expect(mcpError.message).toContain("An error occurred during search.");
      });
    });

    describe("GitHubAuthenticationError mapping", () => {
      it("should map to InternalError with PAT remediation message", () => {
        const error = new GitHubAuthenticationError("GitHub authentication failed");
        const mcpError = mapToMCPError(error);

        expect(mcpError.code).toBe(ErrorCode.InternalError);
        expect(mcpError.message).toContain("GitHub authentication failed");
        expect(mcpError.message).toContain("GITHUB_PAT");
        expect(mcpError.message).toContain("valid");
      });

      it("should not leak the actual token value", () => {
        const error = new GitHubAuthenticationError("Token ghp_secret123 is invalid");
        const mcpError = mapToMCPError(error);

        // The mapped message uses a fixed remediation message, not the original
        expect(mcpError.message).not.toContain("ghp_secret123");
      });
    });

    describe("GitHubRateLimitError mapping", () => {
      it("should map to InternalError with rate limit info", () => {
        const error = new GitHubRateLimitError("Rate limit exceeded");
        const mcpError = mapToMCPError(error);

        expect(mcpError.code).toBe(ErrorCode.InternalError);
        expect(mcpError.message).toContain("rate limit");
      });

      it("should include reset time when available", () => {
        const resetAt = new Date("2026-03-08T12:00:00Z");
        const error = new GitHubRateLimitError("Rate limit exceeded", resetAt, 0);
        const mcpError = mapToMCPError(error);

        expect(mcpError.message).toContain("2026-03-08T12:00:00.000Z");
        expect(mcpError.message).toContain("resets at");
      });

      it("should not include reset time when not available", () => {
        const error = new GitHubRateLimitError("Rate limit exceeded");
        const mcpError = mapToMCPError(error);

        expect(mcpError.message).not.toContain("resets at");
        expect(mcpError.message).toContain("wait before retrying");
      });
    });

    describe("GitHubNotFoundError mapping", () => {
      it("should map to InternalError with original message", () => {
        const error = new GitHubNotFoundError("Repository 'user/repo' not found", "user/repo");
        const mcpError = mapToMCPError(error);

        expect(mcpError.code).toBe(ErrorCode.InternalError);
        expect(mcpError.message).toContain("Repository 'user/repo' not found");
      });

      it("should not include retry hint (not retryable)", () => {
        const error = new GitHubNotFoundError("Not found");
        const mcpError = mapToMCPError(error);

        expect(mcpError.message).not.toContain("try again");
      });
    });

    describe("GitHubNetworkError mapping", () => {
      it("should map to InternalError with retry hint (retryable)", () => {
        const error = new GitHubNetworkError("Connection timed out");
        const mcpError = mapToMCPError(error);

        expect(mcpError.code).toBe(ErrorCode.InternalError);
        expect(mcpError.message).toContain("Connection timed out");
        expect(mcpError.message).toContain("transient");
        expect(mcpError.message).toContain("try again");
      });
    });

    describe("GitHubAPIError mapping", () => {
      it("should map non-retryable API error without retry hint", () => {
        const error = new GitHubAPIError("Forbidden", 403, "Forbidden", false);
        const mcpError = mapToMCPError(error);

        expect(mcpError.code).toBe(ErrorCode.InternalError);
        expect(mcpError.message).toContain("Forbidden");
        expect(mcpError.message).not.toContain("try again");
      });

      it("should map retryable API error with retry hint", () => {
        const error = new GitHubAPIError("Server Error", 500, "Internal Server Error", true);
        const mcpError = mapToMCPError(error);

        expect(mcpError.code).toBe(ErrorCode.InternalError);
        expect(mcpError.message).toContain("Server Error");
        expect(mcpError.message).toContain("try again");
      });
    });

    describe("GitHubValidationError mapping", () => {
      it("should map to InvalidParams with original message", () => {
        const error = new GitHubValidationError("Invalid repository format", ["owner: required"]);
        const mcpError = mapToMCPError(error);

        expect(mcpError.code).toBe(ErrorCode.InvalidParams);
        expect(mcpError.message).toContain("Invalid repository format");
      });
    });

    describe("GitHubClientError subclass ordering", () => {
      it("should NOT fall through to generic Error catch-all for GitHubAuthenticationError", () => {
        const error = new GitHubAuthenticationError();
        const mcpError = mapToMCPError(error);

        // Generic Error catch-all returns "An unexpected error occurred."
        expect(mcpError.message).not.toBe("An unexpected error occurred.");
      });

      it("should NOT fall through to generic Error catch-all for GitHubRateLimitError", () => {
        const error = new GitHubRateLimitError("Rate limited");
        const mcpError = mapToMCPError(error);

        expect(mcpError.message).not.toBe("An unexpected error occurred.");
      });

      it("should NOT fall through to generic Error catch-all for GitHubNetworkError", () => {
        const error = new GitHubNetworkError("Network failure");
        const mcpError = mapToMCPError(error);

        expect(mcpError.message).not.toBe("An unexpected error occurred.");
      });
    });

    describe("CoordinatorError mapping", () => {
      it("should map base CoordinatorError with original message", () => {
        const error = new CoordinatorError("Something went wrong with the coordinator");
        const mcpError = mapToMCPError(error);

        expect(mcpError.code).toBe(ErrorCode.InternalError);
        expect(mcpError.message).toContain("Something went wrong with the coordinator");
      });

      it("should map ForcePushDetectedError with full message", () => {
        const error = new ForcePushDetectedError("my-repo", "abc1234567", "def7654321");
        const mcpError = mapToMCPError(error);

        expect(mcpError.code).toBe(ErrorCode.InternalError);
        expect(mcpError.message).toContain("Force push detected");
        expect(mcpError.message).toContain("my-repo");
        expect(mcpError.message).toContain("Full re-index required");
      });

      it("should map ChangeThresholdExceededError with details", () => {
        const error = new ChangeThresholdExceededError("big-repo", 650, 500);
        const mcpError = mapToMCPError(error);

        expect(mcpError.code).toBe(ErrorCode.InternalError);
        expect(mcpError.message).toContain("650");
        expect(mcpError.message).toContain("500");
        expect(mcpError.message).toContain("big-repo");
      });

      it("should map MissingCommitShaError with repository name", () => {
        const error = new MissingCommitShaError("legacy-repo");
        const mcpError = mapToMCPError(error);

        expect(mcpError.code).toBe(ErrorCode.InternalError);
        expect(mcpError.message).toContain("legacy-repo");
        expect(mcpError.message).toContain("lastIndexedCommitSha");
      });

      it("should map ConcurrentUpdateError with details", () => {
        const error = new ConcurrentUpdateError("my-repo", "2026-03-08T10:00:00.000Z");
        const mcpError = mapToMCPError(error);

        expect(mcpError.code).toBe(ErrorCode.InternalError);
        expect(mcpError.message).toContain("already in progress");
        expect(mcpError.message).toContain("my-repo");
      });

      it("should map GitPullError with reason but not local path", () => {
        const error = new GitPullError("/repos/my-repo", "Merge conflict in src/index.ts");
        const mcpError = mapToMCPError(error);

        expect(mcpError.code).toBe(ErrorCode.InternalError);
        expect(mcpError.message).toContain("Merge conflict");
        expect(mcpError.message).not.toContain("/repos/my-repo");
      });

      it("should NOT fall through to generic Error catch-all for coordinator errors", () => {
        const error = new ForcePushDetectedError("repo", "abc1234567", "def7654321");
        const mcpError = mapToMCPError(error);

        expect(mcpError.message).not.toBe("An unexpected error occurred.");
      });
    });

    describe("Standard Error mapping", () => {
      it("should map Error instances to InternalError", () => {
        const error = new Error("Unexpected error");
        const mcpError = mapToMCPError(error);

        expect(mcpError.code).toBe(ErrorCode.InternalError);
      });

      it("should sanitize error messages", () => {
        const error = new Error("Connection to secret-db.internal failed");
        const mcpError = mapToMCPError(error);

        expect(mcpError.message).toContain("An unexpected error occurred.");
        expect(mcpError.message).not.toContain("secret-db");
      });

      it("should not leak stack traces", () => {
        const error = new Error("Test error");
        error.stack = "Error: Test error\n  at /app/src/secret.ts:42";
        const mcpError = mapToMCPError(error);

        expect(mcpError.message).not.toContain("secret.ts");
      });
    });

    describe("Non-Error value mapping", () => {
      it("should handle thrown strings", () => {
        const error = "String error message";
        const mcpError = mapToMCPError(error);

        expect(mcpError.code).toBe(ErrorCode.InternalError);
        expect(mcpError.message).toContain("An unexpected error occurred");
      });

      it("should handle thrown objects", () => {
        const error = { code: "CUSTOM_ERROR", details: "sensitive info" };
        const mcpError = mapToMCPError(error);

        expect(mcpError.code).toBe(ErrorCode.InternalError);
        expect(mcpError.message).not.toContain("sensitive");
      });

      it("should handle null", () => {
        const error = null;
        const mcpError = mapToMCPError(error);

        expect(mcpError.code).toBe(ErrorCode.InternalError);
      });

      it("should handle undefined", () => {
        const error = undefined;
        const mcpError = mapToMCPError(error);

        expect(mcpError.code).toBe(ErrorCode.InternalError);
      });
    });
  });

  describe("createValidationError", () => {
    it("should create InvalidParams error", () => {
      const error = createValidationError("Invalid input");

      expect(error.code).toBe(ErrorCode.InvalidParams);
      expect(error.message).toContain("Invalid input");
    });

    it("should preserve the exact message", () => {
      const message = "query: must be between 1 and 1000 characters";
      const error = createValidationError(message);

      expect(error.message).toContain(message);
    });
  });

  describe("createMethodNotFoundError", () => {
    it("should create MethodNotFound error", () => {
      const error = createMethodNotFoundError("unknown_tool");

      expect(error.code).toBe(ErrorCode.MethodNotFound);
    });

    it("should include tool name in message", () => {
      const error = createMethodNotFoundError("nonexistent_search");

      expect(error.message).toContain("nonexistent_search");
      expect(error.message).toContain("Unknown tool");
    });
  });
});
