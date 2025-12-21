/**
 * Unit tests for ingestion error classes and helper functions
 *
 * Tests retryable error detection and error class properties.
 */

import { describe, test, expect } from "bun:test";
import {
  RepositoryError,
  ValidationError,
  CloneError,
  NetworkError,
  AuthenticationError,
  FileScanError,
  ChunkingError,
  isRetryableCloneError,
} from "../../../src/ingestion/errors.js";

describe("RepositoryError base class", () => {
  test("sets code and message", () => {
    const error = new RepositoryError("Test message", "TEST_CODE");

    expect(error.message).toBe("Test message");
    expect(error.code).toBe("TEST_CODE");
    expect(error.name).toBe("RepositoryError");
  });

  test("is not retryable by default", () => {
    const error = new RepositoryError("Test message");

    expect(error.retryable).toBe(false);
  });

  test("allows setting retryable flag", () => {
    const error = new RepositoryError("Test message", "CODE", undefined, true);

    expect(error.retryable).toBe(true);
  });

  test("chains cause error", () => {
    const cause = new Error("Root cause");
    const error = new RepositoryError("Wrapper message", "CODE", cause);

    expect(error.cause).toBe(cause);
    expect(error.stack).toContain("Caused by:");
  });
});

describe("ValidationError", () => {
  test("includes field name", () => {
    const error = new ValidationError("Invalid URL", "url");

    expect(error.field).toBe("url");
    expect(error.message).toBe("Invalid URL");
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.retryable).toBe(false);
  });
});

describe("CloneError", () => {
  test("includes URL and target path", () => {
    const error = new CloneError("Clone failed", "https://github.com/test/repo", "/path/to/repo");

    expect(error.url).toBe("https://github.com/test/repo");
    expect(error.targetPath).toBe("/path/to/repo");
    expect(error.code).toBe("CLONE_ERROR");
    expect(error.retryable).toBe(false);
  });

  test("is not retryable by default", () => {
    const error = new CloneError("Clone failed", "url");

    expect(error.retryable).toBe(false);
  });

  test("allows setting retryable flag", () => {
    const error = new CloneError("Network error", "url", "/path", undefined, true);

    expect(error.retryable).toBe(true);
  });
});

describe("NetworkError", () => {
  test("extends CloneError", () => {
    const error = new NetworkError(
      "Connection refused",
      "https://github.com/test/repo",
      "/path/to/repo"
    );

    expect(error).toBeInstanceOf(CloneError);
    expect(error).toBeInstanceOf(NetworkError);
  });

  test("is retryable by default", () => {
    const error = new NetworkError("Connection refused", "url");

    expect(error.retryable).toBe(true);
    expect(error.name).toBe("NetworkError");
  });

  test("includes URL and target path", () => {
    const error = new NetworkError(
      "DNS resolution failed",
      "https://github.com/test/repo",
      "/path/to/repo"
    );

    expect(error.url).toBe("https://github.com/test/repo");
    expect(error.targetPath).toBe("/path/to/repo");
  });
});

describe("AuthenticationError", () => {
  test("includes URL", () => {
    const error = new AuthenticationError("Authentication failed", "https://github.com/test/repo");

    expect(error.url).toBe("https://github.com/test/repo");
    expect(error.code).toBe("AUTHENTICATION_ERROR");
    expect(error.retryable).toBe(false);
  });
});

describe("FileScanError", () => {
  test("includes repo path", () => {
    const error = new FileScanError("Scan failed", "/path/to/repo");

    expect(error.repoPath).toBe("/path/to/repo");
    expect(error.code).toBe("FILE_SCAN_ERROR");
    expect(error.retryable).toBe(false);
  });
});

describe("ChunkingError", () => {
  test("includes file path", () => {
    const error = new ChunkingError("Chunking failed", "src/index.ts");

    expect(error.filePath).toBe("src/index.ts");
    expect(error.code).toBe("CHUNKING_ERROR");
    expect(error.retryable).toBe(false);
  });
});

describe("isRetryableCloneError", () => {
  describe("with custom error types", () => {
    test("returns true for NetworkError", () => {
      const error = new NetworkError("Connection failed", "url");
      expect(isRetryableCloneError(error)).toBe(true);
    });

    test("returns false for CloneError (non-retryable)", () => {
      const error = new CloneError("Clone failed", "url");
      expect(isRetryableCloneError(error)).toBe(false);
    });

    test("returns true for retryable CloneError", () => {
      const error = new CloneError("Network timeout", "url", "/path", undefined, true);
      expect(isRetryableCloneError(error)).toBe(true);
    });

    test("returns false for AuthenticationError", () => {
      const error = new AuthenticationError("Auth failed", "url");
      expect(isRetryableCloneError(error)).toBe(false);
    });

    test("returns false for ValidationError", () => {
      const error = new ValidationError("Invalid URL", "url");
      expect(isRetryableCloneError(error)).toBe(false);
    });

    test("respects retryable property on RepositoryError", () => {
      const retryableError = new RepositoryError("Error", "CODE", undefined, true);
      const nonRetryableError = new RepositoryError("Error", "CODE", undefined, false);

      expect(isRetryableCloneError(retryableError)).toBe(true);
      expect(isRetryableCloneError(nonRetryableError)).toBe(false);
    });
  });

  describe("with native Error types containing network messages", () => {
    test("returns true for network errors", () => {
      expect(isRetryableCloneError(new Error("ECONNREFUSED"))).toBe(true);
      expect(isRetryableCloneError(new Error("ECONNRESET"))).toBe(true);
      expect(isRetryableCloneError(new Error("ETIMEDOUT"))).toBe(true);
      expect(isRetryableCloneError(new Error("ENOTFOUND"))).toBe(true);
      expect(isRetryableCloneError(new Error("ENETUNREACH"))).toBe(true);
    });

    test("returns true for connection errors", () => {
      expect(isRetryableCloneError(new Error("socket hang up"))).toBe(true);
      expect(isRetryableCloneError(new Error("network error"))).toBe(true);
      expect(isRetryableCloneError(new Error("could not resolve host"))).toBe(true);
      expect(isRetryableCloneError(new Error("failed to connect"))).toBe(true);
      expect(isRetryableCloneError(new Error("connection refused"))).toBe(true);
      expect(isRetryableCloneError(new Error("connection reset"))).toBe(true);
      expect(isRetryableCloneError(new Error("timeout"))).toBe(true);
    });
  });

  describe("with non-retryable native errors", () => {
    test("returns false for authentication errors", () => {
      expect(isRetryableCloneError(new Error("authentication failed"))).toBe(false);
      expect(isRetryableCloneError(new Error("could not read username"))).toBe(false);
      expect(isRetryableCloneError(new Error("invalid credentials"))).toBe(false);
      expect(isRetryableCloneError(new Error("401 Unauthorized"))).toBe(false);
      expect(isRetryableCloneError(new Error("403 Forbidden"))).toBe(false);
    });

    test("returns false for not found errors", () => {
      expect(isRetryableCloneError(new Error("not found"))).toBe(false);
      expect(isRetryableCloneError(new Error("Repository not found"))).toBe(false);
    });

    test("returns false for permission errors", () => {
      expect(isRetryableCloneError(new Error("permission denied"))).toBe(false);
    });

    test("returns false for generic errors", () => {
      expect(isRetryableCloneError(new Error("Something went wrong"))).toBe(false);
      expect(isRetryableCloneError(new Error("Invalid data"))).toBe(false);
    });
  });

  describe("with non-Error types", () => {
    test("returns false for undefined", () => {
      expect(isRetryableCloneError(undefined)).toBe(false);
    });

    test("returns false for null", () => {
      expect(isRetryableCloneError(null)).toBe(false);
    });

    test("returns false for string", () => {
      expect(isRetryableCloneError("error message")).toBe(false);
    });

    test("returns false for object", () => {
      expect(isRetryableCloneError({ message: "error" })).toBe(false);
    });
  });
});
