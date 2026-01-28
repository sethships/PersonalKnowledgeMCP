/**
 * Unit tests for folder-watcher-errors.ts
 *
 * Tests error classes and helper functions for FolderWatcherService.
 */

import { describe, it, expect } from "bun:test";
import {
  FolderWatcherError,
  FolderNotFoundError,
  FolderAlreadyWatchedError,
  FolderNotWatchedError,
  WatcherInitializationError,
  WatcherOperationError,
  InvalidPatternError,
  MaxWatchersExceededError,
  isFolderWatcherError,
  isRetryableFolderWatcherError,
} from "../../../src/services/folder-watcher-errors.js";

describe("folder-watcher-errors", () => {
  describe("FolderNotFoundError", () => {
    it("should create error with correct message", () => {
      const error = new FolderNotFoundError("/path/to/folder");
      expect(error.message).toBe("Folder not found or not accessible: '/path/to/folder'");
      expect(error.folderPath).toBe("/path/to/folder");
      expect(error.name).toBe("FolderNotFoundError");
    });

    it("should not be retryable", () => {
      const error = new FolderNotFoundError("/path/to/folder");
      expect(error.retryable).toBe(false);
    });

    it("should be instanceof FolderWatcherError", () => {
      const error = new FolderNotFoundError("/path/to/folder");
      expect(error instanceof FolderWatcherError).toBe(true);
    });
  });

  describe("FolderAlreadyWatchedError", () => {
    it("should create error with correct message", () => {
      const error = new FolderAlreadyWatchedError("folder-123", "/path/to/folder");
      expect(error.message).toBe(
        "Folder is already being watched: '/path/to/folder' (id: folder-123)"
      );
      expect(error.folderId).toBe("folder-123");
      expect(error.folderPath).toBe("/path/to/folder");
      expect(error.name).toBe("FolderAlreadyWatchedError");
    });

    it("should not be retryable", () => {
      const error = new FolderAlreadyWatchedError("folder-123", "/path/to/folder");
      expect(error.retryable).toBe(false);
    });
  });

  describe("FolderNotWatchedError", () => {
    it("should create error with correct message", () => {
      const error = new FolderNotWatchedError("folder-123");
      expect(error.message).toBe("Folder is not being watched: folder-123");
      expect(error.folderId).toBe("folder-123");
      expect(error.name).toBe("FolderNotWatchedError");
    });

    it("should not be retryable", () => {
      const error = new FolderNotWatchedError("folder-123");
      expect(error.retryable).toBe(false);
    });
  });

  describe("WatcherInitializationError", () => {
    it("should create error with correct message", () => {
      const error = new WatcherInitializationError("/path/to/folder", "Permission denied");
      expect(error.message).toBe(
        "Failed to initialize watcher for '/path/to/folder': Permission denied"
      );
      expect(error.folderPath).toBe("/path/to/folder");
      expect(error.name).toBe("WatcherInitializationError");
    });

    it("should be retryable by default", () => {
      const error = new WatcherInitializationError("/path/to/folder", "Temporary failure");
      expect(error.retryable).toBe(true);
    });

    it("should support non-retryable initialization errors", () => {
      const error = new WatcherInitializationError("/path/to/folder", "Invalid path", false);
      expect(error.retryable).toBe(false);
    });

    it("should store cause error", () => {
      const cause = new Error("Original error");
      const error = new WatcherInitializationError("/path/to/folder", "Wrapped error", true, cause);
      expect(error.cause).toBe(cause);
    });

    it("should append cause stack to error stack", () => {
      const cause = new Error("Original error");
      const error = new WatcherInitializationError("/path/to/folder", "Wrapped error", true, cause);
      expect(error.stack).toContain("Caused by:");
    });
  });

  describe("WatcherOperationError", () => {
    it("should create error with correct message", () => {
      const error = new WatcherOperationError("folder-123", "read", "File system error");
      expect(error.message).toBe(
        "Watcher operation 'read' failed for folder folder-123: File system error"
      );
      expect(error.folderId).toBe("folder-123");
      expect(error.operation).toBe("read");
      expect(error.name).toBe("WatcherOperationError");
    });

    it("should be retryable by default", () => {
      const error = new WatcherOperationError("folder-123", "watch", "Temporary error");
      expect(error.retryable).toBe(true);
    });

    it("should support non-retryable operation errors", () => {
      const error = new WatcherOperationError("folder-123", "init", "Permanent failure", false);
      expect(error.retryable).toBe(false);
    });

    it("should store cause error", () => {
      const cause = new Error("Original error");
      const error = new WatcherOperationError("folder-123", "read", "Wrapped error", true, cause);
      expect(error.cause).toBe(cause);
    });
  });

  describe("InvalidPatternError", () => {
    it("should create error for include pattern", () => {
      const error = new InvalidPatternError("[invalid", "include", "Unmatched bracket");
      expect(error.message).toBe("Invalid include pattern '[invalid': Unmatched bracket");
      expect(error.pattern).toBe("[invalid");
      expect(error.patternType).toBe("include");
      expect(error.name).toBe("InvalidPatternError");
    });

    it("should create error for exclude pattern", () => {
      const error = new InvalidPatternError("{bad", "exclude", "Unmatched brace");
      expect(error.message).toBe("Invalid exclude pattern '{bad': Unmatched brace");
      expect(error.pattern).toBe("{bad");
      expect(error.patternType).toBe("exclude");
    });

    it("should not be retryable", () => {
      const error = new InvalidPatternError("bad", "include", "Invalid");
      expect(error.retryable).toBe(false);
    });
  });

  describe("MaxWatchersExceededError", () => {
    it("should create error with correct message", () => {
      const error = new MaxWatchersExceededError(10, 10);
      expect(error.message).toBe("Maximum concurrent watchers (10) reached. Current: 10");
      expect(error.currentWatchers).toBe(10);
      expect(error.maxWatchers).toBe(10);
      expect(error.name).toBe("MaxWatchersExceededError");
    });

    it("should be retryable", () => {
      const error = new MaxWatchersExceededError(10, 10);
      expect(error.retryable).toBe(true);
    });
  });

  describe("isFolderWatcherError", () => {
    it("should return true for FolderWatcherError subclasses", () => {
      expect(isFolderWatcherError(new FolderNotFoundError("/path"))).toBe(true);
      expect(isFolderWatcherError(new FolderAlreadyWatchedError("id", "/path"))).toBe(true);
      expect(isFolderWatcherError(new FolderNotWatchedError("id"))).toBe(true);
      expect(isFolderWatcherError(new WatcherInitializationError("/path", "msg"))).toBe(true);
      expect(isFolderWatcherError(new WatcherOperationError("id", "op", "msg"))).toBe(true);
      expect(isFolderWatcherError(new InvalidPatternError("p", "include", "msg"))).toBe(true);
      expect(isFolderWatcherError(new MaxWatchersExceededError(1, 1))).toBe(true);
    });

    it("should return false for non-FolderWatcherError", () => {
      expect(isFolderWatcherError(new Error("regular error"))).toBe(false);
      expect(isFolderWatcherError(new TypeError("type error"))).toBe(false);
      expect(isFolderWatcherError(null)).toBe(false);
      expect(isFolderWatcherError(undefined)).toBe(false);
      expect(isFolderWatcherError("string error")).toBe(false);
      expect(isFolderWatcherError({ message: "object error" })).toBe(false);
    });
  });

  describe("isRetryableFolderWatcherError", () => {
    it("should return true for retryable errors", () => {
      expect(
        isRetryableFolderWatcherError(new WatcherInitializationError("/path", "msg", true))
      ).toBe(true);
      expect(
        isRetryableFolderWatcherError(new WatcherOperationError("id", "op", "msg", true))
      ).toBe(true);
      expect(isRetryableFolderWatcherError(new MaxWatchersExceededError(1, 1))).toBe(true);
    });

    it("should return false for non-retryable errors", () => {
      expect(isRetryableFolderWatcherError(new FolderNotFoundError("/path"))).toBe(false);
      expect(isRetryableFolderWatcherError(new FolderAlreadyWatchedError("id", "/path"))).toBe(
        false
      );
      expect(isRetryableFolderWatcherError(new FolderNotWatchedError("id"))).toBe(false);
      expect(isRetryableFolderWatcherError(new InvalidPatternError("p", "include", "msg"))).toBe(
        false
      );
    });

    it("should return false for non-FolderWatcherError", () => {
      expect(isRetryableFolderWatcherError(new Error("regular error"))).toBe(false);
      expect(isRetryableFolderWatcherError(null)).toBe(false);
      expect(isRetryableFolderWatcherError(undefined)).toBe(false);
    });
  });
});
