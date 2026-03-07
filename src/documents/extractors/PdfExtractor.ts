/**
 * PDF document extractor using pdf-parse.
 *
 * Extracts text content and metadata from PDF files. Supports multi-page
 * documents with per-page content tracking.
 *
 * @module documents/extractors/PdfExtractor
 */

// Import from lib directly to avoid debug mode in index.js
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse = require("pdf-parse/lib/pdf-parse.js") as typeof import("pdf-parse");
import type pdfParseTypes from "pdf-parse";
import { DOCUMENT_EXTENSIONS, DEFAULT_EXTRACTOR_CONFIG } from "../constants.js";
import { ExtractionError, ExtractionTimeoutError, PasswordProtectedError } from "../errors.js";
import { BaseExtractor } from "./BaseExtractor.js";
import type { DocumentMetadata, ExtractionResult, ExtractorConfig, PageInfo } from "../types.js";

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
 * @extends {BaseExtractor<Required<PdfExtractorConfig>, ExtractionResult>}
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
export class PdfExtractor extends BaseExtractor<Required<PdfExtractorConfig>, ExtractionResult> {
  /**
   * Creates a new PdfExtractor instance.
   *
   * @param config - Optional configuration overrides
   */
  constructor(config?: PdfExtractorConfig) {
    super("documents:pdf-extractor", {
      maxFileSizeBytes: config?.maxFileSizeBytes ?? DEFAULT_EXTRACTOR_CONFIG.maxFileSizeBytes,
      timeoutMs: config?.timeoutMs ?? DEFAULT_EXTRACTOR_CONFIG.timeoutMs,
      extractPageInfo: config?.extractPageInfo ?? true,
    });
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
    this.validateFileSize(stats.size, filePath);

    // 3. Read file buffer
    const buffer = await this.readFileBuffer(filePath);

    // 4. Parse PDF with timeout (single pass — extracts pages inline when configured)
    const { pdfData, pages } = await this.parsePdfWithTimeout(
      buffer,
      filePath,
      this.config.extractPageInfo
    );

    // 5. Build metadata
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
   * Parse PDF with timeout protection, optionally extracting per-page content in a single pass.
   *
   * When `extractPageInfo` is true, a `pagerender` callback captures per-page text
   * during the same parse call, avoiding a second full parse of the buffer.
   *
   * @param buffer - PDF file buffer
   * @param filePath - Path to the file (for error context)
   * @param extractPageInfo - Whether to capture per-page content
   * @returns Parsed PDF data and optional page info
   * @throws {ExtractionTimeoutError} If parsing times out
   * @throws {PasswordProtectedError} If PDF is encrypted
   * @throws {ExtractionError} If parsing fails
   */
  private async parsePdfWithTimeout(
    buffer: Buffer,
    filePath: string,
    extractPageInfo: boolean
  ): Promise<{ pdfData: PdfParseResult; pages?: PageInfo[] }> {
    // Use settled flag to prevent race condition between timeout and parse completion
    let settled = false;
    const pageContents: string[] = [];

    // Note: graceful degradation for per-page failures relies on two layers:
    // 1. Our per-page .catch() below (handles individual getTextContent rejections)
    // 2. pdf-parse's internal catch around each pagerender call
    // Unlike the previous two-pass design, a catastrophic pdfParse failure will
    // now propagate to the caller rather than silently returning pages: [].
    const options: pdfParseTypes.Options = {};
    if (extractPageInfo) {
      options.pagerender = (pageData: PageData) => {
        return pageData
          .getTextContent()
          .then((textContent: TextContent) => {
            const pageText = textContent.items.map((item: TextItem) => item.str).join(" ");
            pageContents.push(pageText);
            return pageText;
          })
          .catch(() => {
            // Individual page failure — record empty content but don't fail the whole parse
            pageContents.push("");
            return "";
          });
      };
    }

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

      pdfParse(buffer, options)
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

          const pages = extractPageInfo
            ? pageContents.map((content, index) => ({
                pageNumber: index + 1,
                content,
                wordCount: this.countWords(content),
              }))
            : undefined;

          resolve({ pdfData: result as PdfParseResult, pages });
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
   * PDF dates follow the format: D:YYYYMMDDHHmmSS[Z|+HH'mm'|-HH'mm']
   *
   * When a timezone offset (Z, +HH'mm', -HH'mm') is present, the returned Date
   * is constructed in UTC. When no timezone info is present, the date is treated
   * as local time to preserve backwards compatibility.
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

      // Parse timezone offset from position 14 onward (after seconds)
      // PDF spec format: Z | +HH'mm' | -HH'mm' (apostrophes optional)
      const tzPortion = cleaned.substring(14);
      const tzMatch = tzPortion.match(/^([+-])(\d{2})'?(\d{2})?'?$|^Z$/);

      if (tzMatch) {
        // Has explicit timezone — construct UTC date with offset applied
        const utcMs = Date.UTC(year, month, day, hour, minute, second);

        if (tzPortion.startsWith("Z")) {
          return new Date(utcMs);
        }

        const sign = tzMatch[1] === "+" ? 1 : -1;
        const offsetHours = parseInt(tzMatch[2] ?? "0", 10);
        const offsetMinutes = parseInt(tzMatch[3] ?? "0", 10);
        const offsetMs = sign * (offsetHours * 60 + offsetMinutes) * 60_000;

        // Subtract offset to convert local-with-offset to UTC
        return new Date(utcMs - offsetMs);
      }

      // No timezone info — treat as local time (preserve existing behavior)
      return new Date(year, month, day, hour, minute, second);
    } catch {
      return undefined;
    }
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
