/**
 * Tests for CLI Error Handler
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-argument */

import { describe, it, expect, beforeEach, vi, type Mock } from "bun:test";
import { handleCommandError } from "../../../src/cli/utils/error-handler.js";
import {
  RepositoryAlreadyExistsError,
  IndexingInProgressError,
  CloneError,
  CollectionCreationError,
  IngestionError,
} from "../../../src/services/ingestion-errors.js";
import {
  SearchValidationError,
  RepositoryNotFoundError,
  RepositoryNotReadyError,
  NoRepositoriesAvailableError,
  SearchOperationError,
} from "../../../src/services/errors.js";
import { RepositoryMetadataError } from "../../../src/repositories/errors.js";

describe("Error Handler", () => {
  let consoleErrorSpy: Mock<() => void>;
  let processExitSpy: Mock<(code: number) => never>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
  });

  describe("Ingestion errors", () => {
    it("should handle RepositoryAlreadyExistsError", () => {
      const error = new RepositoryAlreadyExistsError("test-repo");

      expect(() => handleCommandError(error)).toThrow("process.exit called");
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Already Indexed"));
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it("should handle IndexingInProgressError", () => {
      const error = new IndexingInProgressError("test-repo");

      expect(() => handleCommandError(error)).toThrow("process.exit called");
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Indexing In Progress"));
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it("should handle CloneError", () => {
      const error = new CloneError("https://github.com/user/repo", new Error("Failed to clone"));

      expect(() => handleCommandError(error)).toThrow("process.exit called");
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Clone Failed"));
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it("should handle CollectionCreationError", () => {
      const error = new CollectionCreationError("test-collection", new Error("Failed to create"));

      expect(() => handleCommandError(error)).toThrow("process.exit called");
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("ChromaDB Collection Error")
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it("should handle IngestionError with retryable flag", () => {
      const error = new IngestionError("Indexing failed", true, new Error("embedding error"));

      expect(() => handleCommandError(error)).toThrow("process.exit called");
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Indexing Error"));
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("transient"));
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe("Search errors", () => {
    it("should handle SearchValidationError", () => {
      const error = new SearchValidationError("Invalid limit", []);

      expect(() => handleCommandError(error)).toThrow("process.exit called");
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Invalid Search Parameters")
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it("should handle RepositoryNotFoundError", () => {
      const error = new RepositoryNotFoundError("missing-repo");

      expect(() => handleCommandError(error)).toThrow("process.exit called");
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Repository Not Found"));
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it("should handle RepositoryNotReadyError", () => {
      const error = new RepositoryNotReadyError("indexing-repo", "indexing");

      expect(() => handleCommandError(error)).toThrow("process.exit called");
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Repository Not Ready"));
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it("should handle NoRepositoriesAvailableError", () => {
      const error = new NoRepositoriesAvailableError();

      expect(() => handleCommandError(error)).toThrow("process.exit called");
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("No Repositories Indexed")
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it("should handle SearchOperationError with retryable flag", () => {
      const error = new SearchOperationError("Search failed", true, new Error("underlying error"));

      expect(() => handleCommandError(error)).toThrow("process.exit called");
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Search Operation Failed")
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("transient"));
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe("Repository metadata errors", () => {
    it("should handle RepositoryMetadataError", () => {
      const error = new RepositoryMetadataError("Failed to read metadata");

      expect(() => handleCommandError(error)).toThrow("process.exit called");
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Repository Metadata Error")
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe("Generic errors", () => {
    it("should handle standard Error instances", () => {
      const error = new Error("Something went wrong");

      expect(() => handleCommandError(error)).toThrow("process.exit called");
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Something went wrong"));
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it("should handle unknown error types", () => {
      const error = "string error";

      expect(() => handleCommandError(error)).toThrow("process.exit called");
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Unknown Error"));
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it("should show stack trace in debug mode", () => {
      const originalEnv = Bun.env["LOG_LEVEL"];
      Bun.env["LOG_LEVEL"] = "debug";

      const error = new Error("Test error");

      expect(() => handleCommandError(error)).toThrow("process.exit called");
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Test error"));

      // Restore env
      if (originalEnv) {
        Bun.env["LOG_LEVEL"] = originalEnv;
      } else {
        delete Bun.env["LOG_LEVEL"];
      }
    });
  });

  describe("Spinner integration", () => {
    it("should stop spinner if provided", () => {
      const mockSpinner = {
        isSpinning: true,
        stop: vi.fn(),
      };

      const error = new Error("Test error");

      expect(() => handleCommandError(error, mockSpinner as any)).toThrow("process.exit called");
      expect(mockSpinner.stop).toHaveBeenCalled();
    });

    it("should not stop spinner if not spinning", () => {
      const mockSpinner = {
        isSpinning: false,
        stop: vi.fn(),
      };

      const error = new Error("Test error");

      expect(() => handleCommandError(error, mockSpinner as any)).toThrow("process.exit called");
      expect(mockSpinner.stop).not.toHaveBeenCalled();
    });
  });
});
