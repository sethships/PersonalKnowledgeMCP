/**
 * Unit tests for storage error classes and helper functions
 *
 * Tests retryable error detection and error class properties.
 */

import { describe, test, expect } from "bun:test";
import {
  StorageError,
  StorageConnectionError,
  CollectionNotFoundError,
  InvalidParametersError,
  DocumentOperationError,
  SearchOperationError,
  StorageTimeoutError,
  isRetryableStorageError,
} from "../../../src/storage/errors.js";

describe("StorageError base class", () => {
  test("sets code and message", () => {
    const error = new StorageError("Test message", "TEST_CODE");

    expect(error.message).toBe("Test message");
    expect(error.code).toBe("TEST_CODE");
    expect(error.name).toBe("StorageError");
  });

  test("is not retryable by default", () => {
    const error = new StorageError("Test message");

    expect(error.retryable).toBe(false);
  });

  test("allows setting retryable flag", () => {
    const error = new StorageError("Test message", "CODE", undefined, true);

    expect(error.retryable).toBe(true);
  });

  test("chains cause error", () => {
    const cause = new Error("Root cause");
    const error = new StorageError("Wrapper message", "CODE", cause);

    expect(error.cause).toBe(cause);
    expect(error.stack).toContain("Caused by:");
  });
});

describe("StorageConnectionError", () => {
  test("is retryable by default", () => {
    const error = new StorageConnectionError("Connection failed");

    expect(error.retryable).toBe(true);
    expect(error.code).toBe("CONNECTION_ERROR");
    expect(error.name).toBe("StorageConnectionError");
  });

  test("can override retryable flag", () => {
    const error = new StorageConnectionError("Connection failed", undefined, false);

    expect(error.retryable).toBe(false);
  });
});

describe("CollectionNotFoundError", () => {
  test("includes collection name", () => {
    const error = new CollectionNotFoundError("repo_test");

    expect(error.collectionName).toBe("repo_test");
    expect(error.message).toContain("repo_test");
    expect(error.code).toBe("COLLECTION_NOT_FOUND");
    expect(error.retryable).toBe(false);
  });

  test("allows custom message", () => {
    const error = new CollectionNotFoundError("repo_test", "Custom message");

    expect(error.message).toBe("Custom message");
    expect(error.collectionName).toBe("repo_test");
  });
});

describe("InvalidParametersError", () => {
  test("includes parameter name", () => {
    const error = new InvalidParametersError("Invalid embedding", "embedding");

    expect(error.parameterName).toBe("embedding");
    expect(error.message).toBe("Invalid embedding");
    expect(error.code).toBe("INVALID_PARAMETERS");
    expect(error.retryable).toBe(false);
  });
});

describe("DocumentOperationError", () => {
  test("includes operation and document IDs", () => {
    const error = new DocumentOperationError("add", "Failed to add", ["doc1", "doc2"]);

    expect(error.operation).toBe("add");
    expect(error.documentIds).toEqual(["doc1", "doc2"]);
    expect(error.code).toBe("DOCUMENT_OPERATION_ERROR");
    expect(error.retryable).toBe(false);
  });

  test("allows setting retryable flag", () => {
    const error = new DocumentOperationError("add", "Network error", ["doc1"], undefined, true);

    expect(error.retryable).toBe(true);
  });
});

describe("SearchOperationError", () => {
  test("includes collections", () => {
    const error = new SearchOperationError("Search failed", ["repo_a", "repo_b"]);

    expect(error.collections).toEqual(["repo_a", "repo_b"]);
    expect(error.code).toBe("SEARCH_OPERATION_ERROR");
    expect(error.retryable).toBe(false);
  });
});

describe("StorageTimeoutError", () => {
  test("is retryable by default", () => {
    const error = new StorageTimeoutError("Operation timed out");

    expect(error.retryable).toBe(true);
    expect(error.code).toBe("TIMEOUT_ERROR");
  });
});

describe("isRetryableStorageError", () => {
  describe("with custom error types", () => {
    test("returns true for StorageConnectionError", () => {
      const error = new StorageConnectionError("Connection failed");
      expect(isRetryableStorageError(error)).toBe(true);
    });

    test("returns true for StorageTimeoutError", () => {
      const error = new StorageTimeoutError("Timeout");
      expect(isRetryableStorageError(error)).toBe(true);
    });

    test("returns false for CollectionNotFoundError", () => {
      const error = new CollectionNotFoundError("repo_test");
      expect(isRetryableStorageError(error)).toBe(false);
    });

    test("returns false for InvalidParametersError", () => {
      const error = new InvalidParametersError("Bad input");
      expect(isRetryableStorageError(error)).toBe(false);
    });

    test("returns false for non-retryable DocumentOperationError", () => {
      const error = new DocumentOperationError("add", "Failed", []);
      expect(isRetryableStorageError(error)).toBe(false);
    });

    test("returns true for retryable DocumentOperationError", () => {
      const error = new DocumentOperationError("add", "Network error", [], undefined, true);
      expect(isRetryableStorageError(error)).toBe(true);
    });

    test("respects retryable property on StorageError", () => {
      const retryableError = new StorageError("Error", "CODE", undefined, true);
      const nonRetryableError = new StorageError("Error", "CODE", undefined, false);

      expect(isRetryableStorageError(retryableError)).toBe(true);
      expect(isRetryableStorageError(nonRetryableError)).toBe(false);
    });
  });

  describe("with native Error types", () => {
    test("returns true for network errors", () => {
      expect(isRetryableStorageError(new Error("ECONNREFUSED"))).toBe(true);
      expect(isRetryableStorageError(new Error("ECONNRESET"))).toBe(true);
      expect(isRetryableStorageError(new Error("ETIMEDOUT"))).toBe(true);
      expect(isRetryableStorageError(new Error("ENOTFOUND"))).toBe(true);
      expect(isRetryableStorageError(new Error("ENETUNREACH"))).toBe(true);
    });

    test("returns true for connection errors", () => {
      expect(isRetryableStorageError(new Error("socket hang up"))).toBe(true);
      expect(isRetryableStorageError(new Error("Network error"))).toBe(true);
      expect(isRetryableStorageError(new Error("connection refused"))).toBe(true);
      expect(isRetryableStorageError(new Error("connection reset"))).toBe(true);
      expect(isRetryableStorageError(new Error("timeout"))).toBe(true);
    });

    test("returns true for fetch errors", () => {
      expect(isRetryableStorageError(new Error("failed to fetch"))).toBe(true);
      expect(isRetryableStorageError(new Error("fetch failed"))).toBe(true);
    });

    test("returns true for server errors", () => {
      expect(isRetryableStorageError(new Error("500 Internal Server Error"))).toBe(true);
      expect(isRetryableStorageError(new Error("502 Bad Gateway"))).toBe(true);
      expect(isRetryableStorageError(new Error("503 Service Unavailable"))).toBe(true);
      expect(isRetryableStorageError(new Error("504 Gateway Timeout"))).toBe(true);
    });

    test("returns false for generic errors", () => {
      expect(isRetryableStorageError(new Error("Something went wrong"))).toBe(false);
      expect(isRetryableStorageError(new Error("Invalid data"))).toBe(false);
      expect(isRetryableStorageError(new Error("Not found"))).toBe(false);
    });
  });

  describe("with non-Error types", () => {
    test("returns false for undefined", () => {
      expect(isRetryableStorageError(undefined)).toBe(false);
    });

    test("returns false for null", () => {
      expect(isRetryableStorageError(null)).toBe(false);
    });

    test("returns false for string", () => {
      expect(isRetryableStorageError("error message")).toBe(false);
    });

    test("returns false for object", () => {
      expect(isRetryableStorageError({ message: "error" })).toBe(false);
    });
  });
});
