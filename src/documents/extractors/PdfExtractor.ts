/**
 * PDF document extractor using pdf-parse.
 *
 * Extracts text content and metadata from PDF files. Supports multi-page
 * documents with per-page content tracking.
 *
 * @module documents/extractors/PdfExtractor
 */

import * as fs from "node:fs/promises";
import * as crypto from "node:crypto";
// Import from lib directly to avoid debug mode in index.js
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse = require("pdf-parse/lib/pdf-parse.js") as typeof import("pdf-parse");
import type pdfParseTypes from "pdf-parse";
import { DOCUMENT_EXTENSIONS, DEFAULT_EXTRACTOR_CONFIG } from "../constants.js";
import {
  ExtractionError,
  ExtractionTimeoutError,
  FileAccessError,
  FileTooLargeError,
  PasswordProtectedError,
} from "../errors.js";
import { getComponentLogger } from "../../logging/index.js";
import type {
  DocumentExtractor,
  DocumentMetadata,
  ExtractionResult,
  ExtractorConfig,
  PageInfo,
} from "../types.js";

/**
 * PDF-specific extractor configuration.
 *
 * @example
 * ```typescript
 * const config: PdfExtractorConfig = {
 *   maxFileSizeBytes: 52428800,
 *   timeoutMs: 60000,
 *   extractPageInfo: true
 * };
 * ```
 */
export interface PdfExtractorConfig extends ExtractorConfig {
  /**
   * Whether to extract per-page content info.
   *
   * @default true
   */
  extractPageInfo?: boolean;
}

/**
 * Result from pdf-parse library.
 */
interface PdfParseResult {
  numpages: number;
  numrender: number;
  info: PdfInfo;
  metadata: unknown;
  text: string;
}

/**
 * PDF info dictionary from pdf-parse.
 */
interface PdfInfo {
  Title?: string;
  Author?: string;
  Creator?: string;
  Producer?: string;
  CreationDate?: string;
  ModDate?: string;
  IsEncrypted?: boolean;
  [key: string]: unknown;
}

/**
 * Extracts text content and metadata from PDF documents.
 *
 * Uses pdf-parse library for text extraction. Handles multi-page documents
 * and extracts metadata such as title, author, and creation date when available.
 *
 * @implements {DocumentExtractor<ExtractionResult>}
 *
 * @example
 * ```typescript
 * const extractor = new PdfExtractor();
 *
 * if (extractor.supports(".pdf")) {
 *   const result = await extractor.extract("/path/to/document.pdf");
 *   console.log(`Extracted ${result.metadata.pageCount} pages`);
 *   console.log(`Content: ${result.content.substring(0, 100)}...`);
 * }
 * ```
 */
/** Lazily-initialized logger for PDF extractor operations */
let logger: ReturnType<typeof getComponentLogger> | null = null;

/** No-op logger for when logging system is not initialized */
const noopLogger = {
  warn: () => {},
  info: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  level: "silent" as const,
  silent: true,
} as unknown as ReturnType<typeof getComponentLogger>;

/**
 * Get the component logger, initializing if needed.
 * Lazy initialization avoids errors when module loads before logger is initialized.
 */
function getLogger(): ReturnType<typeof getComponentLogger> {
  if (!logger) {
    try {
      logger = getComponentLogger("documents:pdf-extractor");
    } catch {
      // If logger not initialized, return no-op logger for testing
      // This allows tests to run without initializing the full logging system
      return noopLogger;
    }
  }
  return logger;
}

export class PdfExtractor implements DocumentExtractor<ExtractionResult> {
  private readonly config: Required<PdfExtractorConfig>;

  /**
   * Creates a new PdfExtractor instance.
   *
   * @param config - Optional configuration overrides
   */
  constructor(config?: PdfExtractorConfig) {
    this.config = {
      maxFileSizeBytes: config?.maxFileSizeBytes ?? DEFAULT_EXTRACTOR_CONFIG.maxFileSizeBytes,
      timeoutMs: config?.timeoutMs ?? DEFAULT_EXTRACTOR_CONFIG.timeoutMs,
      extractPageInfo: config?.extractPageInfo ?? true,
    };
  }

  /**
   * Extract text content and metadata from a PDF file.
   *
   * @param filePath - Absolute path to the PDF file
   * @returns Promise resolving to extraction result with content and metadata
   * @throws {FileAccessError} If file cannot be accessed
   * @throws {FileTooLargeError} If file exceeds maximum size
   * @throws {PasswordProtectedError} If PDF is password-protected
   * @throws {ExtractionError} If PDF parsing fails
   * @throws {ExtractionTimeoutError} If extraction times out
   *
   * @example
   * ```typescript
   * const result = await extractor.extract("/docs/report.pdf");
   * console.log(result.content);
   * console.log(result.metadata.pageCount);
   * ```
   */
  async extract(filePath: string): Promise<ExtractionResult> {
    // 1. Get file stats and validate
    const stats = await this.getFileStats(filePath);

    // 2. Check file size
    if (stats.size > this.config.maxFileSizeBytes) {
      throw new FileTooLargeError(
        `File exceeds maximum size of ${this.config.maxFileSizeBytes} bytes (actual: ${stats.size} bytes)`,
        stats.size,
        this.config.maxFileSizeBytes,
        { filePath }
      );
    }

    // 3. Read file buffer
    const buffer = await this.readFileBuffer(filePath);

    // 4. Parse PDF with timeout
    const pdfData = await this.parsePdfWithTimeout(buffer, filePath);

    // 5. Extract pages if configured
    const pages = this.config.extractPageInfo
      ? await this.extractPages(buffer, filePath)
      : undefined;

    // 6. Build metadata
    const metadata = this.buildMetadata(pdfData, filePath, stats, buffer);

    return {
      content: pdfData.text,
      metadata,
      pages,
    };
  }

  /**
   * Check if this extractor supports a given file extension.
   *
   * @param extension - File extension including dot (e.g., ".pdf")
   * @returns true if this extractor can handle the extension
   *
   * @example
   * ```typescript
   * extractor.supports(".pdf"); // true
   * extractor.supports(".docx"); // false
   * ```
   */
  supports(extension: string): boolean {
    const normalizedExt = extension.toLowerCase();
    return DOCUMENT_EXTENSIONS.pdf.includes(
      normalizedExt as (typeof DOCUMENT_EXTENSIONS.pdf)[number]
    );
  }

  /**
   * Get the current configuration.
   *
   * @returns The extractor configuration
   */
  getConfig(): Readonly<Required<PdfExtractorConfig>> {
    return this.config;
  }

  /**
   * Get file stats and handle errors.
   *
   * @param filePath - Path to the file
   * @returns File stats
   * @throws {FileAccessError} If file cannot be accessed
   */
  private async getFileStats(filePath: string): Promise<{ size: number; mtime: Date }> {
    try {
      const stats = await fs.stat(filePath);
      return {
        size: stats.size,
        mtime: stats.mtime,
      };
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === "ENOENT") {
        throw new FileAccessError(`File not found: ${filePath}`, {
          filePath,
          cause: error instanceof Error ? error : undefined,
        });
      }
      if (nodeError.code === "EACCES") {
        throw new FileAccessError(`Permission denied: ${filePath}`, {
          filePath,
          cause: error instanceof Error ? error : undefined,
        });
      }
      throw new FileAccessError(`Cannot access file: ${filePath}`, {
        filePath,
        cause: error instanceof Error ? error : undefined,
      });
    }
  }

  /**
   * Read file contents as buffer.
   *
   * @param filePath - Path to the file
   * @returns File contents as buffer
   * @throws {FileAccessError} If file cannot be read
   */
  private async readFileBuffer(filePath: string): Promise<Buffer> {
    try {
      return await fs.readFile(filePath);
    } catch (error) {
      throw new FileAccessError(`Cannot read file: ${filePath}`, {
        filePath,
        cause: error instanceof Error ? error : undefined,
      });
    }
  }

  /**
   * Parse PDF with timeout protection.
   *
   * @param buffer - PDF file buffer
   * @param filePath - Path to the file (for error context)
   * @returns Parsed PDF data
   * @throws {ExtractionTimeoutError} If parsing times out
   * @throws {PasswordProtectedError} If PDF is encrypted
   * @throws {ExtractionError} If parsing fails
   */
  private async parsePdfWithTimeout(buffer: Buffer, filePath: string): Promise<PdfParseResult> {
    // Use settled flag to prevent race condition between timeout and parse completion
    let settled = false;

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(
          new ExtractionTimeoutError(
            `PDF extraction timed out after ${this.config.timeoutMs}ms`,
            this.config.timeoutMs,
            { filePath, retryable: true }
          )
        );
      }, this.config.timeoutMs);

      pdfParse(buffer)
        .then((result: pdfParseTypes.Result) => {
          clearTimeout(timeoutId);
          if (settled) return;
          settled = true;

          // Check for encrypted PDF
          const info = result.info as PdfInfo;
          if (info?.IsEncrypted) {
            reject(
              new PasswordProtectedError("PDF is password-protected and cannot be extracted", {
                filePath,
              })
            );
            return;
          }

          resolve(result as PdfParseResult);
        })
        .catch((error: Error) => {
          clearTimeout(timeoutId);
          if (settled) return;
          settled = true;

          // Check for encryption error messages
          const errorMessage = error.message?.toLowerCase() ?? "";
          if (
            errorMessage.includes("password") ||
            errorMessage.includes("encrypted") ||
            errorMessage.includes("decrypt")
          ) {
            reject(
              new PasswordProtectedError("PDF is password-protected and cannot be extracted", {
                filePath,
                cause: error,
              })
            );
            return;
          }

          reject(
            new ExtractionError(`Failed to parse PDF: ${error.message}`, {
              filePath,
              cause: error,
            })
          );
        });
    });
  }

  /**
   * Extract per-page content from PDF.
   *
   * Uses pdf-parse pagerender callback to extract text from each page individually.
   *
   * @param buffer - PDF file buffer
   * @param filePath - Path to the file (for error context)
   * @returns Array of page information
   */
  private async extractPages(buffer: Buffer, filePath: string): Promise<PageInfo[]> {
    const pageContents: string[] = [];

    try {
      // Use pagerender to extract content from each page
      const options: pdfParseTypes.Options = {
        pagerender: (pageData: PageData) => {
          return pageData.getTextContent().then((textContent: TextContent) => {
            const pageText = textContent.items.map((item: TextItem) => item.str).join(" ");
            pageContents.push(pageText);
            return pageText;
          });
        },
      };

      await pdfParse(buffer, options);

      // Build PageInfo array
      return pageContents.map((content, index) => ({
        pageNumber: index + 1,
        content,
        wordCount: this.countWords(content),
      }));
    } catch (error) {
      // If per-page extraction fails, return empty array
      // The main text content is still available from the full parse
      getLogger().warn(
        { filePath, error: error instanceof Error ? error.message : "unknown error" },
        "Per-page extraction failed, returning empty pages array"
      );
      return [];
    }
  }

  /**
   * Build document metadata from parsed PDF data.
   *
   * @param pdfData - Parsed PDF data
   * @param filePath - Path to the file
   * @param stats - File stats
   * @param buffer - File buffer for hashing
   * @returns Document metadata
   */
  private buildMetadata(
    pdfData: PdfParseResult,
    filePath: string,
    stats: { size: number; mtime: Date },
    buffer: Buffer
  ): DocumentMetadata {
    const info = pdfData.info;

    return {
      documentType: "pdf",
      title: info?.Title?.trim() || undefined,
      author: info?.Author?.trim() || undefined,
      createdAt: this.parsePdfDate(info?.CreationDate),
      pageCount: pdfData.numpages,
      wordCount: this.countWords(pdfData.text),
      filePath,
      fileSizeBytes: stats.size,
      contentHash: this.computeContentHash(buffer),
      fileModifiedAt: stats.mtime,
    };
  }

  /**
   * Parse PDF date string to Date object.
   *
   * PDF dates are in format: D:YYYYMMDDHHmmSS+HH'mm' or D:YYYYMMDDHHmmSS
   *
   * @param dateStr - PDF date string
   * @returns Parsed date or undefined
   */
  private parsePdfDate(dateStr: string | undefined): Date | undefined {
    if (!dateStr) {
      return undefined;
    }

    try {
      // Remove 'D:' prefix if present
      const cleaned = dateStr.replace(/^D:/, "");

      // Extract date components
      const year = parseInt(cleaned.substring(0, 4), 10);
      const month = parseInt(cleaned.substring(4, 6), 10) - 1; // 0-indexed
      const day = parseInt(cleaned.substring(6, 8), 10);
      const hour = parseInt(cleaned.substring(8, 10), 10) || 0;
      const minute = parseInt(cleaned.substring(10, 12), 10) || 0;
      const second = parseInt(cleaned.substring(12, 14), 10) || 0;

      if (isNaN(year) || isNaN(month) || isNaN(day)) {
        return undefined;
      }

      return new Date(year, month, day, hour, minute, second);
    } catch {
      return undefined;
    }
  }

  /**
   * Count words in text.
   *
   * @param text - Text to count words in
   * @returns Word count
   */
  private countWords(text: string): number {
    if (!text || text.trim().length === 0) {
      return 0;
    }
    // Split on whitespace and filter empty strings
    return text.split(/\s+/).filter((word) => word.length > 0).length;
  }

  /**
   * Compute SHA-256 hash of content.
   *
   * @param buffer - Content buffer
   * @returns Hex-encoded SHA-256 hash with sha256: prefix
   */
  private computeContentHash(buffer: Buffer): string {
    const hash = crypto.createHash("sha256").update(buffer).digest("hex");
    return `sha256:${hash}`;
  }
}

/**
 * PDF.js page data interface.
 */
interface PageData {
  getTextContent(): Promise<TextContent>;
}

/**
 * PDF.js text content interface.
 */
interface TextContent {
  items: TextItem[];
}

/**
 * PDF.js text item interface.
 */
interface TextItem {
  str: string;
}
