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
