/**
 * Document processing error classes.
 *
 * Provides domain-specific errors for document extraction and processing.
 * All errors include error codes for categorization, support cause chaining,
 * and indicate whether the operation is retryable.
 *
 * @module documents/errors
 */

/**
 * Options for constructing a DocumentError.
 */
export interface DocumentErrorOptions {
  /**
   * The underlying error that caused this error.
   */
  cause?: Error;

  /**
   * Whether the operation can be retried.
   *
   * @default false
   */
  retryable?: boolean;

  /**
   * File path associated with the error.
   */
  filePath?: string;
}

/**
 * Base error class for document processing operations.
 *
 * Includes error code for categorization, supports cause chaining for
 * debugging, and indicates whether the operation is retryable.
 *
 * @example
 * ```typescript
 * try {
 *   await extractor.extract("/path/to/file.pdf");
 * } catch (error) {
 *   if (error instanceof DocumentError) {
 *     console.error(`Error [${error.code}]: ${error.message}`);
 *     if (error.retryable) {
 *       // Attempt retry
 *     }
 *   }
 * }
 * ```
 */
export class DocumentError extends Error {
  public readonly code: string;
  public override readonly cause?: Error;
  public readonly retryable: boolean;
  public readonly filePath?: string;

  constructor(message: string, code: string = "DOCUMENT_ERROR", options?: DocumentErrorOptions) {
    super(message);
    this.name = "DocumentError";
    this.code = code;
    this.cause = options?.cause;
    this.retryable = options?.retryable ?? false;
    this.filePath = options?.filePath;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }

    if (options?.cause?.stack) {
      this.stack = `${this.stack ?? ""}\nCaused by: ${options.cause.stack}`;
    }
  }
}

/**
 * Error thrown when a file format is not supported.
 *
 * Indicates that the file extension or content type is not recognized
 * by any available extractor.
 *
 * @example
 * ```typescript
 * if (!extractor.supports(extension)) {
 *   throw new UnsupportedFormatError(
 *     `Unsupported file format: ${extension}`,
 *     extension,
 *     { filePath }
 *   );
 * }
 * ```
 */
export class UnsupportedFormatError extends DocumentError {
  public readonly extension: string;

  constructor(message: string, extension: string, options?: DocumentErrorOptions) {
    super(message, "UNSUPPORTED_FORMAT", options);
    this.name = "UnsupportedFormatError";
    this.extension = extension;
  }
}

/**
 * Error thrown when content extraction fails.
 *
 * Indicates that the file could not be parsed or its content extracted.
 * Common causes include corrupt files, encoding issues, or parsing failures.
 *
 * @example
 * ```typescript
 * try {
 *   const text = await pdfParser.parse(buffer);
 * } catch (error) {
 *   throw new ExtractionError(
 *     "Failed to extract PDF content",
 *     { cause: error, filePath }
 *   );
 * }
 * ```
 */
export class ExtractionError extends DocumentError {
  constructor(message: string, options?: DocumentErrorOptions) {
    super(message, "EXTRACTION_ERROR", options);
    this.name = "ExtractionError";
  }
}

/**
 * Error thrown when a file is password-protected.
 *
 * Indicates that the document requires a password to open and cannot
 * be processed without it. Not retryable.
 *
 * @example
 * ```typescript
 * if (pdf.isEncrypted) {
 *   throw new PasswordProtectedError(
 *     "PDF is password-protected",
 *     { filePath }
 *   );
 * }
 * ```
 */
export class PasswordProtectedError extends DocumentError {
  constructor(message: string, options?: DocumentErrorOptions) {
    super(message, "PASSWORD_PROTECTED", {
      ...options,
      retryable: false,
    });
    this.name = "PasswordProtectedError";
  }
}

/**
 * Error thrown when a file exceeds the maximum size limit.
 *
 * Indicates that the file is too large to process. The actual and
 * maximum sizes are included for error reporting.
 *
 * @example
 * ```typescript
 * if (stats.size > config.maxFileSizeBytes) {
 *   throw new FileTooLargeError(
 *     `File exceeds maximum size of ${config.maxFileSizeBytes} bytes`,
 *     stats.size,
 *     config.maxFileSizeBytes,
 *     { filePath }
 *   );
 * }
 * ```
 */
export class FileTooLargeError extends DocumentError {
  public readonly actualSizeBytes: number;
  public readonly maxSizeBytes: number;

  constructor(
    message: string,
    actualSizeBytes: number,
    maxSizeBytes: number,
    options?: DocumentErrorOptions
  ) {
    super(message, "FILE_TOO_LARGE", {
      ...options,
      retryable: false,
    });
    this.name = "FileTooLargeError";
    this.actualSizeBytes = actualSizeBytes;
    this.maxSizeBytes = maxSizeBytes;
  }
}

/**
 * Error thrown when file access fails.
 *
 * Indicates that the file could not be read due to permissions,
 * non-existence, or other file system errors.
 *
 * @example
 * ```typescript
 * try {
 *   await fs.readFile(filePath);
 * } catch (error) {
 *   throw new FileAccessError(
 *     `Cannot read file: ${filePath}`,
 *     { cause: error, filePath }
 *   );
 * }
 * ```
 */
export class FileAccessError extends DocumentError {
  constructor(message: string, options?: DocumentErrorOptions) {
    super(message, "FILE_ACCESS_ERROR", options);
    this.name = "FileAccessError";
  }
}

/**
 * Error thrown when extraction times out.
 *
 * Indicates that the extraction operation exceeded the configured
 * timeout. May be retryable depending on the cause.
 *
 * @example
 * ```typescript
 * const timeout = setTimeout(() => {
 *   throw new ExtractionTimeoutError(
 *     `Extraction timed out after ${config.timeoutMs}ms`,
 *     config.timeoutMs,
 *     { filePath, retryable: true }
 *   );
 * }, config.timeoutMs);
 * ```
 */
export class ExtractionTimeoutError extends DocumentError {
  public readonly timeoutMs: number;

  constructor(message: string, timeoutMs: number, options?: DocumentErrorOptions) {
    super(message, "EXTRACTION_TIMEOUT", {
      ...options,
      retryable: options?.retryable ?? true,
    });
    this.name = "ExtractionTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Error thrown when an extractor is not implemented.
 *
 * Used for stub implementations that will be completed in future issues.
 * Not retryable.
 *
 * @example
 * ```typescript
 * async extract(filePath: string): Promise<ExtractionResult> {
 *   throw new NotImplementedError(
 *     "PdfExtractor.extract is not yet implemented",
 *     "PdfExtractor.extract"
 *   );
 * }
 * ```
 */
export class NotImplementedError extends DocumentError {
  public readonly methodName: string;

  constructor(message: string, methodName: string, options?: DocumentErrorOptions) {
    super(message, "NOT_IMPLEMENTED", {
      ...options,
      retryable: false,
    });
    this.name = "NotImplementedError";
    this.methodName = methodName;
  }
}

/**
 * Type guard to check if an error is a DocumentError.
 *
 * @param error - The error to check
 * @returns true if the error is a DocumentError
 *
 * @example
 * ```typescript
 * try {
 *   await extract(file);
 * } catch (error) {
 *   if (isDocumentError(error)) {
 *     console.error(`Document error [${error.code}]: ${error.message}`);
 *   }
 * }
 * ```
 */
export function isDocumentError(error: unknown): error is DocumentError {
  return error instanceof DocumentError;
}

/**
 * Type guard to check if an error is retryable.
 *
 * @param error - The error to check
 * @returns true if the error is a retryable DocumentError
 *
 * @example
 * ```typescript
 * try {
 *   await extract(file);
 * } catch (error) {
 *   if (isRetryableDocumentError(error)) {
 *     // Attempt retry
 *   }
 * }
 * ```
 */
export function isRetryableDocumentError(error: unknown): error is DocumentError {
  return isDocumentError(error) && error.retryable;
}
