/**
 * Unit tests for document error classes and helper functions.
 *
 * Tests error class properties, cause chaining, and type guards.
 */

import { describe, test, expect } from "bun:test";
import {
  DocumentError,
  UnsupportedFormatError,
  ExtractionError,
  PasswordProtectedError,
  FileTooLargeError,
  FileAccessError,
  ExtractionTimeoutError,
  NotImplementedError,
  isDocumentError,
  isRetryableDocumentError,
} from "../../../src/documents/errors.js";

describe("DocumentError base class", () => {
  test("sets code and message", () => {
    const error = new DocumentError("Test message", "TEST_CODE");

    expect(error.message).toBe("Test message");
    expect(error.code).toBe("TEST_CODE");
    expect(error.name).toBe("DocumentError");
  });

  test("uses default code when not provided", () => {
    const error = new DocumentError("Test message");

    expect(error.code).toBe("DOCUMENT_ERROR");
  });

  test("is not retryable by default", () => {
    const error = new DocumentError("Test message");

    expect(error.retryable).toBe(false);
  });

  test("allows setting retryable flag", () => {
    const error = new DocumentError("Test message", "CODE", { retryable: true });

    expect(error.retryable).toBe(true);
  });

  test("chains cause error", () => {
    const cause = new Error("Root cause");
    const error = new DocumentError("Wrapper message", "CODE", { cause });

    expect(error.cause).toBe(cause);
    expect(error.stack).toContain("Caused by:");
  });

  test("includes file path when provided", () => {
    const error = new DocumentError("Test message", "CODE", {
      filePath: "/path/to/file.pdf",
    });

    expect(error.filePath).toBe("/path/to/file.pdf");
  });

  test("handles all options together", () => {
    const cause = new Error("Root cause");
    const error = new DocumentError("Test message", "TEST_CODE", {
      cause,
      retryable: true,
      filePath: "/path/to/file.pdf",
    });

    expect(error.message).toBe("Test message");
    expect(error.code).toBe("TEST_CODE");
    expect(error.cause).toBe(cause);
    expect(error.retryable).toBe(true);
    expect(error.filePath).toBe("/path/to/file.pdf");
  });
});

describe("UnsupportedFormatError", () => {
  test("includes extension", () => {
    const error = new UnsupportedFormatError("Unsupported format: .xyz", ".xyz");

    expect(error.extension).toBe(".xyz");
    expect(error.message).toBe("Unsupported format: .xyz");
    expect(error.code).toBe("UNSUPPORTED_FORMAT");
    expect(error.name).toBe("UnsupportedFormatError");
    expect(error.retryable).toBe(false);
  });

  test("is instance of DocumentError", () => {
    const error = new UnsupportedFormatError("Unsupported", ".xyz");

    expect(error).toBeInstanceOf(DocumentError);
    expect(error).toBeInstanceOf(UnsupportedFormatError);
  });

  test("accepts options with file path", () => {
    const error = new UnsupportedFormatError("Unsupported", ".xyz", {
      filePath: "/path/to/file.xyz",
    });

    expect(error.filePath).toBe("/path/to/file.xyz");
  });
});

describe("ExtractionError", () => {
  test("sets correct code", () => {
    const error = new ExtractionError("Extraction failed");

    expect(error.message).toBe("Extraction failed");
    expect(error.code).toBe("EXTRACTION_ERROR");
    expect(error.name).toBe("ExtractionError");
    expect(error.retryable).toBe(false);
  });

  test("chains cause error", () => {
    const cause = new Error("Parse error");
    const error = new ExtractionError("Extraction failed", { cause });

    expect(error.cause).toBe(cause);
  });

  test("is instance of DocumentError", () => {
    const error = new ExtractionError("Extraction failed");

    expect(error).toBeInstanceOf(DocumentError);
    expect(error).toBeInstanceOf(ExtractionError);
  });
});

describe("PasswordProtectedError", () => {
  test("sets correct code and is not retryable", () => {
    const error = new PasswordProtectedError("PDF is password-protected");

    expect(error.message).toBe("PDF is password-protected");
    expect(error.code).toBe("PASSWORD_PROTECTED");
    expect(error.name).toBe("PasswordProtectedError");
    expect(error.retryable).toBe(false);
  });

  test("cannot be made retryable", () => {
    // Password protection is inherently not retryable
    const error = new PasswordProtectedError("PDF is protected", {
      retryable: true, // This should be ignored
    });

    expect(error.retryable).toBe(false);
  });

  test("is instance of DocumentError", () => {
    const error = new PasswordProtectedError("Protected");

    expect(error).toBeInstanceOf(DocumentError);
    expect(error).toBeInstanceOf(PasswordProtectedError);
  });
});

describe("FileTooLargeError", () => {
  test("includes size information", () => {
    const error = new FileTooLargeError("File exceeds 50MB limit", 100_000_000, 52_428_800);

    expect(error.actualSizeBytes).toBe(100_000_000);
    expect(error.maxSizeBytes).toBe(52_428_800);
    expect(error.code).toBe("FILE_TOO_LARGE");
    expect(error.name).toBe("FileTooLargeError");
    expect(error.retryable).toBe(false);
  });

  test("cannot be made retryable", () => {
    const error = new FileTooLargeError("Too large", 100, 50, {
      retryable: true,
    });

    expect(error.retryable).toBe(false);
  });

  test("is instance of DocumentError", () => {
    const error = new FileTooLargeError("Too large", 100, 50);

    expect(error).toBeInstanceOf(DocumentError);
    expect(error).toBeInstanceOf(FileTooLargeError);
  });
});

describe("FileAccessError", () => {
  test("sets correct code", () => {
    const error = new FileAccessError("Cannot read file");

    expect(error.message).toBe("Cannot read file");
    expect(error.code).toBe("FILE_ACCESS_ERROR");
    expect(error.name).toBe("FileAccessError");
    expect(error.retryable).toBe(false);
  });

  test("includes file path", () => {
    const error = new FileAccessError("Cannot read file", {
      filePath: "/path/to/file.pdf",
    });

    expect(error.filePath).toBe("/path/to/file.pdf");
  });

  test("is instance of DocumentError", () => {
    const error = new FileAccessError("Access denied");

    expect(error).toBeInstanceOf(DocumentError);
    expect(error).toBeInstanceOf(FileAccessError);
  });
});

describe("ExtractionTimeoutError", () => {
  test("includes timeout value", () => {
    const error = new ExtractionTimeoutError("Extraction timed out", 30_000);

    expect(error.timeoutMs).toBe(30_000);
    expect(error.code).toBe("EXTRACTION_TIMEOUT");
    expect(error.name).toBe("ExtractionTimeoutError");
  });

  test("is retryable by default", () => {
    const error = new ExtractionTimeoutError("Timed out", 30_000);

    expect(error.retryable).toBe(true);
  });

  test("allows overriding retryable flag", () => {
    const error = new ExtractionTimeoutError("Timed out", 30_000, {
      retryable: false,
    });

    expect(error.retryable).toBe(false);
  });

  test("is instance of DocumentError", () => {
    const error = new ExtractionTimeoutError("Timed out", 30_000);

    expect(error).toBeInstanceOf(DocumentError);
    expect(error).toBeInstanceOf(ExtractionTimeoutError);
  });
});

describe("NotImplementedError", () => {
  test("includes method name", () => {
    const error = new NotImplementedError("Method not implemented", "PdfExtractor.extract");

    expect(error.methodName).toBe("PdfExtractor.extract");
    expect(error.code).toBe("NOT_IMPLEMENTED");
    expect(error.name).toBe("NotImplementedError");
    expect(error.retryable).toBe(false);
  });

  test("cannot be made retryable", () => {
    const error = new NotImplementedError("Not implemented", "method", {
      retryable: true,
    });

    expect(error.retryable).toBe(false);
  });

  test("is instance of DocumentError", () => {
    const error = new NotImplementedError("Not implemented", "method");

    expect(error).toBeInstanceOf(DocumentError);
    expect(error).toBeInstanceOf(NotImplementedError);
  });
});

describe("isDocumentError", () => {
  test("returns true for DocumentError", () => {
    const error = new DocumentError("Test");
    expect(isDocumentError(error)).toBe(true);
  });

  test("returns true for derived error classes", () => {
    expect(isDocumentError(new UnsupportedFormatError("", ".xyz"))).toBe(true);
    expect(isDocumentError(new ExtractionError(""))).toBe(true);
    expect(isDocumentError(new PasswordProtectedError(""))).toBe(true);
    expect(isDocumentError(new FileTooLargeError("", 100, 50))).toBe(true);
    expect(isDocumentError(new FileAccessError(""))).toBe(true);
    expect(isDocumentError(new ExtractionTimeoutError("", 30000))).toBe(true);
    expect(isDocumentError(new NotImplementedError("", "method"))).toBe(true);
  });

  test("returns false for native Error", () => {
    expect(isDocumentError(new Error("Test"))).toBe(false);
  });

  test("returns false for non-errors", () => {
    expect(isDocumentError(undefined)).toBe(false);
    expect(isDocumentError(null)).toBe(false);
    expect(isDocumentError("error message")).toBe(false);
    expect(isDocumentError({ message: "error" })).toBe(false);
  });
});

describe("isRetryableDocumentError", () => {
  test("returns true for retryable DocumentError", () => {
    const error = new DocumentError("Test", "CODE", { retryable: true });
    expect(isRetryableDocumentError(error)).toBe(true);
  });

  test("returns false for non-retryable DocumentError", () => {
    const error = new DocumentError("Test", "CODE", { retryable: false });
    expect(isRetryableDocumentError(error)).toBe(false);
  });

  test("returns true for ExtractionTimeoutError (retryable by default)", () => {
    const error = new ExtractionTimeoutError("Timed out", 30000);
    expect(isRetryableDocumentError(error)).toBe(true);
  });

  test("returns false for PasswordProtectedError (not retryable)", () => {
    const error = new PasswordProtectedError("Protected");
    expect(isRetryableDocumentError(error)).toBe(false);
  });

  test("returns false for FileTooLargeError (not retryable)", () => {
    const error = new FileTooLargeError("Too large", 100, 50);
    expect(isRetryableDocumentError(error)).toBe(false);
  });

  test("returns false for NotImplementedError (not retryable)", () => {
    const error = new NotImplementedError("Not implemented", "method");
    expect(isRetryableDocumentError(error)).toBe(false);
  });

  test("returns false for native Error", () => {
    expect(isRetryableDocumentError(new Error("Test"))).toBe(false);
  });

  test("returns false for non-errors", () => {
    expect(isRetryableDocumentError(undefined)).toBe(false);
    expect(isRetryableDocumentError(null)).toBe(false);
    expect(isRetryableDocumentError("error")).toBe(false);
  });
});
