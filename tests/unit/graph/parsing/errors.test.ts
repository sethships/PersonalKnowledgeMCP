/**
 * Unit tests for parsing error classes and helper functions.
 *
 * Tests all error classes from src/graph/parsing/errors.ts and their properties,
 * as well as helper functions for error handling.
 */

import { describe, test, expect } from "bun:test";
import {
  ParsingError,
  LanguageNotSupportedError,
  LanguageLoadError,
  ParserInitializationError,
  ParseTimeoutError,
  FileTooLargeError,
  ExtractionError,
  isRetryableParsingError,
} from "../../../../src/graph/parsing/errors.js";

describe("ParsingError", () => {
  test("should create error with default values", () => {
    const error = new ParsingError("Parse failed", "src/file.ts");

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ParsingError);
    expect(error.name).toBe("ParsingError");
    expect(error.message).toBe("Parse failed");
    expect(error.filePath).toBe("src/file.ts");
    expect(error.code).toBe("PARSING_ERROR");
    expect(error.cause).toBeUndefined();
    expect(error.retryable).toBe(false);
  });

  test("should create error with custom code", () => {
    const error = new ParsingError("Parse failed", "file.ts", "CUSTOM_CODE");

    expect(error.code).toBe("CUSTOM_CODE");
  });

  test("should create error with cause", () => {
    const cause = new Error("Original error");
    const error = new ParsingError("Wrapped error", "file.ts", "CODE", cause);

    expect(error.cause).toBe(cause);
    expect(error.stack).toContain("Caused by:");
    expect(error.stack).toContain("Original error");
  });

  test("should create retryable error", () => {
    const error = new ParsingError("Transient error", "file.ts", "CODE", undefined, true);

    expect(error.retryable).toBe(true);
  });

  test("should create non-retryable error by default", () => {
    const error = new ParsingError("Permanent error", "file.ts");

    expect(error.retryable).toBe(false);
  });
});

describe("LanguageNotSupportedError", () => {
  test("should create language not supported error", () => {
    const error = new LanguageNotSupportedError("styles.css", ".css");

    expect(error).toBeInstanceOf(ParsingError);
    expect(error.name).toBe("LanguageNotSupportedError");
    expect(error.code).toBe("LANGUAGE_NOT_SUPPORTED");
    expect(error.filePath).toBe("styles.css");
    expect(error.extension).toBe(".css");
    expect(error.message).toBe("Language not supported for extension: .css");
    expect(error.retryable).toBe(false);
  });

  test("should handle various unsupported extensions", () => {
    const extensions = [".py", ".rb", ".go", ".rs", ".java"];

    for (const ext of extensions) {
      const error = new LanguageNotSupportedError(`file${ext}`, ext);
      expect(error.extension).toBe(ext);
    }
  });
});

describe("LanguageLoadError", () => {
  test("should create language load error", () => {
    const error = new LanguageLoadError("typescript");

    expect(error).toBeInstanceOf(ParsingError);
    expect(error.name).toBe("LanguageLoadError");
    expect(error.code).toBe("LANGUAGE_LOAD_ERROR");
    expect(error.language).toBe("typescript");
    expect(error.message).toBe("Failed to load tree-sitter language: typescript");
    expect(error.retryable).toBe(true);
    expect(error.filePath).toBe("<no-file>");
  });

  test("should create language load error with cause", () => {
    const cause = new Error("WASM file not found");
    const error = new LanguageLoadError("tsx", cause);

    expect(error.language).toBe("tsx");
    expect(error.cause).toBe(cause);
    expect(error.retryable).toBe(true);
  });

  test("should handle all supported languages", () => {
    const languages = ["typescript", "javascript", "tsx", "jsx"] as const;

    for (const lang of languages) {
      const error = new LanguageLoadError(lang);
      expect(error.language).toBe(lang);
    }
  });
});

describe("ParserInitializationError", () => {
  test("should create parser initialization error", () => {
    const error = new ParserInitializationError("WASM module failed to load");

    expect(error).toBeInstanceOf(ParsingError);
    expect(error.name).toBe("ParserInitializationError");
    expect(error.code).toBe("PARSER_INITIALIZATION_ERROR");
    expect(error.message).toBe("Tree-sitter initialization failed: WASM module failed to load");
    expect(error.retryable).toBe(true);
    expect(error.filePath).toBe("<no-file>");
  });

  test("should create parser initialization error with cause", () => {
    const cause = new Error("Memory allocation failed");
    const error = new ParserInitializationError("Initialization failed", cause);

    expect(error.cause).toBe(cause);
    expect(error.retryable).toBe(true);
  });
});

describe("ParseTimeoutError", () => {
  test("should create parse timeout error", () => {
    const error = new ParseTimeoutError("src/large-file.ts", 30000);

    expect(error).toBeInstanceOf(ParsingError);
    expect(error.name).toBe("ParseTimeoutError");
    expect(error.code).toBe("PARSE_TIMEOUT_ERROR");
    expect(error.filePath).toBe("src/large-file.ts");
    expect(error.timeoutMs).toBe(30000);
    expect(error.message).toBe("Parsing timed out after 30000ms");
    expect(error.retryable).toBe(false);
  });

  test("should handle different timeout values", () => {
    const timeouts = [1000, 5000, 10000, 60000];

    for (const ms of timeouts) {
      const error = new ParseTimeoutError("file.ts", ms);
      expect(error.timeoutMs).toBe(ms);
      expect(error.message).toContain(`${ms}ms`);
    }
  });
});

describe("FileTooLargeError", () => {
  test("should create file too large error", () => {
    const error = new FileTooLargeError("src/huge.ts", 2000000, 1000000);

    expect(error).toBeInstanceOf(ParsingError);
    expect(error.name).toBe("FileTooLargeError");
    expect(error.code).toBe("FILE_TOO_LARGE_ERROR");
    expect(error.filePath).toBe("src/huge.ts");
    expect(error.sizeBytes).toBe(2000000);
    expect(error.maxSizeBytes).toBe(1000000);
    expect(error.message).toBe("File size 2000000 bytes exceeds maximum 1000000 bytes");
    expect(error.retryable).toBe(false);
  });

  test("should handle various file sizes", () => {
    const sizes = [
      { actual: 100, max: 50 },
      { actual: 1048576, max: 524288 },
      { actual: 10000000, max: 5000000 },
    ];

    for (const { actual, max } of sizes) {
      const error = new FileTooLargeError("file.ts", actual, max);
      expect(error.sizeBytes).toBe(actual);
      expect(error.maxSizeBytes).toBe(max);
    }
  });
});

describe("ExtractionError", () => {
  test("should create extraction error without node type", () => {
    const error = new ExtractionError("Failed to extract entities", "src/complex.ts");

    expect(error).toBeInstanceOf(ParsingError);
    expect(error.name).toBe("ExtractionError");
    expect(error.code).toBe("EXTRACTION_ERROR");
    expect(error.filePath).toBe("src/complex.ts");
    expect(error.nodeType).toBeUndefined();
    expect(error.message).toBe("Failed to extract entities");
    expect(error.retryable).toBe(false);
  });

  test("should create extraction error with node type", () => {
    const error = new ExtractionError(
      "Failed to extract function",
      "file.ts",
      "function_declaration"
    );

    expect(error.nodeType).toBe("function_declaration");
  });

  test("should create extraction error with cause", () => {
    const cause = new Error("Unexpected AST structure");
    const error = new ExtractionError("Extraction failed", "file.ts", "class_declaration", cause);

    expect(error.nodeType).toBe("class_declaration");
    expect(error.cause).toBe(cause);
  });
});

describe("isRetryableParsingError", () => {
  test("should return true for retryable ParsingError", () => {
    const error = new ParsingError("Transient", "file.ts", "CODE", undefined, true);

    expect(isRetryableParsingError(error)).toBe(true);
  });

  test("should return false for non-retryable ParsingError", () => {
    const error = new ParsingError("Permanent", "file.ts");

    expect(isRetryableParsingError(error)).toBe(false);
  });

  test("should return true for LanguageLoadError", () => {
    const error = new LanguageLoadError("typescript");

    expect(isRetryableParsingError(error)).toBe(true);
  });

  test("should return true for ParserInitializationError", () => {
    const error = new ParserInitializationError("Init failed");

    expect(isRetryableParsingError(error)).toBe(true);
  });

  test("should return false for LanguageNotSupportedError", () => {
    const error = new LanguageNotSupportedError("file.py", ".py");

    expect(isRetryableParsingError(error)).toBe(false);
  });

  test("should return false for ParseTimeoutError", () => {
    const error = new ParseTimeoutError("file.ts", 30000);

    expect(isRetryableParsingError(error)).toBe(false);
  });

  test("should return false for FileTooLargeError", () => {
    const error = new FileTooLargeError("file.ts", 2000000, 1000000);

    expect(isRetryableParsingError(error)).toBe(false);
  });

  test("should return false for ExtractionError", () => {
    const error = new ExtractionError("Extraction failed", "file.ts");

    expect(isRetryableParsingError(error)).toBe(false);
  });

  test("should return true for native error with retryable patterns", () => {
    const patterns = ["ENOENT", "EBUSY", "EAGAIN", "allocation failed", "out of memory"];

    for (const pattern of patterns) {
      const error = new Error(`Error: ${pattern} occurred`);
      expect(isRetryableParsingError(error)).toBe(true);
    }
  });

  test("should return false for non-retryable native error", () => {
    const error = new Error("Syntax error in file");

    expect(isRetryableParsingError(error)).toBe(false);
  });

  test("should return false for non-error values", () => {
    expect(isRetryableParsingError(null)).toBe(false);
    expect(isRetryableParsingError(undefined)).toBe(false);
    expect(isRetryableParsingError("error string")).toBe(false);
    expect(isRetryableParsingError(123)).toBe(false);
  });
});
