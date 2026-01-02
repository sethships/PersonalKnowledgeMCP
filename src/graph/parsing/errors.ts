/**
 * AST parsing error classes.
 *
 * Provides domain-specific errors for tree-sitter parsing operations.
 * All errors include error codes for categorization and support cause chaining.
 *
 * @module graph/parsing/errors
 */

import type { SupportedLanguage } from "./types.js";

/**
 * Base error class for parsing operations.
 *
 * Includes error code for categorization and supports cause chaining for debugging.
 */
export class ParsingError extends Error {
  public readonly code: string;
  public override readonly cause?: Error;
  public readonly retryable: boolean;
  public readonly filePath: string;

  constructor(
    message: string,
    filePath: string,
    code: string = "PARSING_ERROR",
    cause?: Error,
    retryable: boolean = false
  ) {
    super(message);
    this.name = "ParsingError";
    this.code = code;
    this.filePath = filePath;
    this.cause = cause;
    this.retryable = retryable;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }

    if (cause && cause.stack) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }
  }
}

/**
 * Error thrown when a file's language is not supported for parsing.
 *
 * This error indicates that the file extension does not map to a
 * supported tree-sitter grammar (TypeScript, JavaScript, TSX, JSX).
 *
 * @example
 * ```typescript
 * try {
 *   await parser.parseFile(content, 'styles.css');
 * } catch (error) {
 *   if (error instanceof LanguageNotSupportedError) {
 *     console.log(`Extension ${error.extension} not supported`);
 *   }
 * }
 * ```
 */
export class LanguageNotSupportedError extends ParsingError {
  public readonly extension: string;

  constructor(filePath: string, extension: string) {
    super(`Language not supported for extension: ${extension}`, filePath, "LANGUAGE_NOT_SUPPORTED");
    this.name = "LanguageNotSupportedError";
    this.extension = extension;
  }
}

/**
 * Error thrown when loading a tree-sitter language grammar fails.
 *
 * This typically occurs when:
 * - The WASM file cannot be found
 * - The WASM file is corrupted
 * - There's an incompatibility with the tree-sitter version
 *
 * This error is retryable as the issue might be transient (file system).
 *
 * @example
 * ```typescript
 * try {
 *   await languageLoader.getLanguage('typescript');
 * } catch (error) {
 *   if (error instanceof LanguageLoadError) {
 *     console.error(`Failed to load ${error.language}:`, error.message);
 *   }
 * }
 * ```
 */
export class LanguageLoadError extends ParsingError {
  public readonly language: SupportedLanguage;

  constructor(language: SupportedLanguage, cause?: Error) {
    super(
      `Failed to load tree-sitter language: ${language}`,
      "<no-file>",
      "LANGUAGE_LOAD_ERROR",
      cause,
      true // Retryable
    );
    this.name = "LanguageLoadError";
    this.language = language;
  }
}

/**
 * Error thrown when tree-sitter initialization fails.
 *
 * This occurs when the web-tree-sitter WASM module cannot be initialized.
 * Common causes:
 * - WASM not supported in the runtime
 * - tree-sitter.wasm file not found
 * - Memory allocation failures
 *
 * This error is retryable as initialization might succeed on retry.
 */
export class ParserInitializationError extends ParsingError {
  constructor(message: string, cause?: Error) {
    super(
      `Tree-sitter initialization failed: ${message}`,
      "<no-file>",
      "PARSER_INITIALIZATION_ERROR",
      cause,
      true // Retryable
    );
    this.name = "ParserInitializationError";
  }
}

/**
 * Error thrown when parsing a file exceeds the configured timeout.
 *
 * Large or complex files may take too long to parse. This error
 * allows graceful handling of such cases without blocking the
 * entire indexing process.
 */
export class ParseTimeoutError extends ParsingError {
  public readonly timeoutMs: number;

  constructor(filePath: string, timeoutMs: number) {
    super(`Parsing timed out after ${timeoutMs}ms`, filePath, "PARSE_TIMEOUT_ERROR");
    this.name = "ParseTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Error thrown when a file is too large to parse.
 *
 * Files exceeding the configured maximum size are skipped
 * to prevent memory issues and slow parsing.
 */
export class FileTooLargeError extends ParsingError {
  public readonly sizeBytes: number;
  public readonly maxSizeBytes: number;

  constructor(filePath: string, sizeBytes: number, maxSizeBytes: number) {
    super(
      `File size ${sizeBytes} bytes exceeds maximum ${maxSizeBytes} bytes`,
      filePath,
      "FILE_TOO_LARGE_ERROR"
    );
    this.name = "FileTooLargeError";
    this.sizeBytes = sizeBytes;
    this.maxSizeBytes = maxSizeBytes;
  }
}

/**
 * Error thrown when AST extraction fails after successful parsing.
 *
 * This occurs when the parsed tree cannot be processed to extract
 * entities, imports, or exports. Indicates a bug in extraction logic
 * or an unexpected AST structure.
 */
export class ExtractionError extends ParsingError {
  public readonly nodeType?: string;

  constructor(message: string, filePath: string, nodeType?: string, cause?: Error) {
    super(message, filePath, "EXTRACTION_ERROR", cause);
    this.name = "ExtractionError";
    this.nodeType = nodeType;
  }
}

/**
 * Determine if a parsing error is likely transient and worth retrying.
 *
 * @param error - The error to check
 * @returns true if the operation should be retried
 */
export function isRetryableParsingError(error: unknown): boolean {
  if (error instanceof ParsingError) {
    return error.retryable;
  }

  // Native errors that might be transient
  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    const retryablePatterns = [
      "enoent", // File not found (might be transient)
      "ebusy", // File busy
      "eagain", // Resource temporarily unavailable
      "allocation failed",
      "out of memory",
    ];

    return retryablePatterns.some((pattern) => message.includes(pattern));
  }

  return false;
}
