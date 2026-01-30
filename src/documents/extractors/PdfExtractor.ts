/**
 * PDF document extractor using pdf-parse.
 *
 * Extracts text content and metadata from PDF files. Supports multi-page
 * documents with per-page content tracking.
 *
 * @module documents/extractors/PdfExtractor
 */

import { DOCUMENT_EXTENSIONS, DEFAULT_EXTRACTOR_CONFIG } from "../constants.js";
import { NotImplementedError } from "../errors.js";
import type { DocumentExtractor, ExtractionResult, ExtractorConfig } from "../types.js";

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
   * @throws {NotImplementedError} This method is not yet implemented
   * @throws {FileTooLargeError} If file exceeds maximum size
   * @throws {PasswordProtectedError} If PDF is password-protected
   * @throws {ExtractionError} If PDF parsing fails
   *
   * @example
   * ```typescript
   * const result = await extractor.extract("/docs/report.pdf");
   * console.log(result.content);
   * console.log(result.metadata.pageCount);
   * ```
   */
  async extract(filePath: string): Promise<ExtractionResult> {
    // Stub implementation - to be implemented in #358
    await Promise.resolve();
    throw new NotImplementedError(
      `PdfExtractor.extract is not yet implemented. File: ${filePath}`,
      "PdfExtractor.extract",
      { filePath }
    );
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
}
