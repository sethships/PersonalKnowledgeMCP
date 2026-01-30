/**
 * Microsoft Word DOCX document extractor using mammoth.
 *
 * Extracts text content and metadata from DOCX files. Preserves document
 * structure including headings and paragraphs.
 *
 * @module documents/extractors/DocxExtractor
 */

import { DOCUMENT_EXTENSIONS, DEFAULT_EXTRACTOR_CONFIG } from "../constants.js";
import { NotImplementedError } from "../errors.js";
import type { DocumentExtractor, ExtractionResult, ExtractorConfig } from "../types.js";

/**
 * DOCX-specific extractor configuration.
 *
 * @example
 * ```typescript
 * const config: DocxExtractorConfig = {
 *   maxFileSizeBytes: 52428800,
 *   timeoutMs: 30000,
 *   preserveFormatting: false
 * };
 * ```
 */
export interface DocxExtractorConfig extends ExtractorConfig {
  /**
   * Whether to preserve basic formatting (bold, italic) as markdown.
   *
   * @default false
   */
  preserveFormatting?: boolean;
}

/**
 * Extracts text content and metadata from DOCX documents.
 *
 * Uses mammoth library for text extraction. Converts DOCX structure to
 * plain text while optionally preserving basic formatting.
 *
 * @implements {DocumentExtractor<ExtractionResult>}
 *
 * @example
 * ```typescript
 * const extractor = new DocxExtractor();
 *
 * if (extractor.supports(".docx")) {
 *   const result = await extractor.extract("/path/to/document.docx");
 *   console.log(`Word count: ${result.metadata.wordCount}`);
 *   console.log(`Content: ${result.content.substring(0, 100)}...`);
 * }
 * ```
 */
export class DocxExtractor implements DocumentExtractor<ExtractionResult> {
  private readonly config: Required<DocxExtractorConfig>;

  /**
   * Creates a new DocxExtractor instance.
   *
   * @param config - Optional configuration overrides
   */
  constructor(config?: DocxExtractorConfig) {
    this.config = {
      maxFileSizeBytes: config?.maxFileSizeBytes ?? DEFAULT_EXTRACTOR_CONFIG.maxFileSizeBytes,
      timeoutMs: config?.timeoutMs ?? DEFAULT_EXTRACTOR_CONFIG.timeoutMs,
      preserveFormatting: config?.preserveFormatting ?? false,
    };
  }

  /**
   * Extract text content and metadata from a DOCX file.
   *
   * @param filePath - Absolute path to the DOCX file
   * @returns Promise resolving to extraction result with content and metadata
   * @throws {NotImplementedError} This method is not yet implemented
   * @throws {FileTooLargeError} If file exceeds maximum size
   * @throws {ExtractionError} If DOCX parsing fails
   *
   * @example
   * ```typescript
   * const result = await extractor.extract("/docs/report.docx");
   * console.log(result.content);
   * console.log(result.metadata.wordCount);
   * ```
   */
  async extract(filePath: string): Promise<ExtractionResult> {
    // Stub implementation - to be implemented in #359
    await Promise.resolve();
    throw new NotImplementedError(
      `DocxExtractor.extract is not yet implemented. File: ${filePath}`,
      "DocxExtractor.extract",
      { filePath }
    );
  }

  /**
   * Check if this extractor supports a given file extension.
   *
   * @param extension - File extension including dot (e.g., ".docx")
   * @returns true if this extractor can handle the extension
   *
   * @example
   * ```typescript
   * extractor.supports(".docx"); // true
   * extractor.supports(".doc"); // false (legacy format not supported)
   * ```
   */
  supports(extension: string): boolean {
    const normalizedExt = extension.toLowerCase();
    return DOCUMENT_EXTENSIONS.docx.includes(
      normalizedExt as (typeof DOCUMENT_EXTENSIONS.docx)[number]
    );
  }

  /**
   * Get the current configuration.
   *
   * @returns The extractor configuration
   */
  getConfig(): Readonly<Required<DocxExtractorConfig>> {
    return this.config;
  }
}
