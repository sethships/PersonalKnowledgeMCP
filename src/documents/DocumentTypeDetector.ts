/**
 * Document type detection and extractor routing.
 *
 * Detects document types based on file extensions and routes to
 * appropriate extractors.
 *
 * @module documents/DocumentTypeDetector
 */

import * as path from "node:path";
import { DOCUMENT_EXTENSIONS, IMAGE_EXTENSIONS, EXTENSION_TO_TYPE } from "./constants.js";
import type { DocumentExtractor, DocumentType } from "./types.js";
import { PdfExtractor } from "./extractors/PdfExtractor.js";
import { DocxExtractor } from "./extractors/DocxExtractor.js";
import { MarkdownParser } from "./extractors/MarkdownParser.js";
import { ImageMetadataExtractor } from "./extractors/ImageMetadataExtractor.js";

/**
 * Detected type result including whether it's a document or image.
 */
export type DetectedType = DocumentType | "image" | "unknown";

/**
 * Detects document types and provides appropriate extractors.
 *
 * Uses file extension-based detection to determine document types
 * and route to the correct extractor. Supports PDF, DOCX, Markdown,
 * plain text, and image files.
 *
 * @example
 * ```typescript
 * const detector = new DocumentTypeDetector();
 *
 * // Detect document type
 * const type = detector.detect("/path/to/file.pdf");
 * console.log(type); // "pdf"
 *
 * // Get appropriate extractor
 * const extractor = detector.getExtractor("/path/to/file.pdf");
 * if (extractor) {
 *   const result = await extractor.extract("/path/to/file.pdf");
 * }
 * ```
 */
export class DocumentTypeDetector {
  private readonly pdfExtractor: PdfExtractor;
  private readonly docxExtractor: DocxExtractor;
  private readonly markdownParser: MarkdownParser;
  private readonly imageExtractor: ImageMetadataExtractor;

  /**
   * Creates a new DocumentTypeDetector instance.
   *
   * Initializes all extractors with default configurations.
   */
  constructor() {
    this.pdfExtractor = new PdfExtractor();
    this.docxExtractor = new DocxExtractor();
    this.markdownParser = new MarkdownParser();
    this.imageExtractor = new ImageMetadataExtractor();
  }

  /**
   * Detect document type from file path.
   *
   * Uses file extension to determine the document type. Extensions
   * are normalized to lowercase for matching.
   *
   * @param filePath - Path to the file (absolute or relative)
   * @returns Detected document type or "unknown"
   *
   * @example
   * ```typescript
   * detector.detect("/path/to/report.pdf"); // "pdf"
   * detector.detect("/path/to/document.docx"); // "docx"
   * detector.detect("/path/to/README.md"); // "markdown"
   * detector.detect("/path/to/notes.txt"); // "txt"
   * detector.detect("/path/to/photo.jpg"); // "image"
   * detector.detect("/path/to/file.xyz"); // "unknown"
   * ```
   */
  detect(filePath: string): DetectedType {
    const extension = path.extname(filePath).toLowerCase();

    if (!extension) {
      return "unknown";
    }

    const mappedType = EXTENSION_TO_TYPE[extension];
    if (mappedType) {
      return mappedType as DetectedType;
    }

    return "unknown";
  }

  /**
   * Get appropriate extractor for a file.
   *
   * Returns the correct extractor instance based on file extension.
   * Returns null if the file type is not supported.
   *
   * @param filePath - Path to the file (absolute or relative)
   * @returns Extractor instance or null if unsupported
   *
   * @example
   * ```typescript
   * const extractor = detector.getExtractor("/path/to/file.pdf");
   * if (extractor) {
   *   const result = await extractor.extract("/path/to/file.pdf");
   * } else {
   *   console.log("Unsupported file type");
   * }
   * ```
   */
  getExtractor(filePath: string): DocumentExtractor<unknown> | null {
    const extension = path.extname(filePath).toLowerCase();

    if (!extension) {
      return null;
    }

    // Check PDF
    if (DOCUMENT_EXTENSIONS.pdf.includes(extension as (typeof DOCUMENT_EXTENSIONS.pdf)[number])) {
      return this.pdfExtractor;
    }

    // Check DOCX
    if (DOCUMENT_EXTENSIONS.docx.includes(extension as (typeof DOCUMENT_EXTENSIONS.docx)[number])) {
      return this.docxExtractor;
    }

    // Check Markdown
    if (
      DOCUMENT_EXTENSIONS.markdown.includes(
        extension as (typeof DOCUMENT_EXTENSIONS.markdown)[number]
      )
    ) {
      return this.markdownParser;
    }

    // Check text files - use markdown parser for plain text
    if (DOCUMENT_EXTENSIONS.txt.includes(extension as (typeof DOCUMENT_EXTENSIONS.txt)[number])) {
      return this.markdownParser;
    }

    // Check images
    if (IMAGE_EXTENSIONS.includes(extension as (typeof IMAGE_EXTENSIONS)[number])) {
      return this.imageExtractor;
    }

    return null;
  }

  /**
   * Check if a file type is supported.
   *
   * @param filePath - Path to the file (absolute or relative)
   * @returns true if the file type is supported
   *
   * @example
   * ```typescript
   * detector.isSupported("/path/to/file.pdf"); // true
   * detector.isSupported("/path/to/file.xyz"); // false
   * ```
   */
  isSupported(filePath: string): boolean {
    return this.detect(filePath) !== "unknown";
  }

  /**
   * Check if a file is a document (not an image).
   *
   * @param filePath - Path to the file (absolute or relative)
   * @returns true if the file is a document type
   *
   * @example
   * ```typescript
   * detector.isDocument("/path/to/file.pdf"); // true
   * detector.isDocument("/path/to/file.jpg"); // false
   * ```
   */
  isDocument(filePath: string): boolean {
    const type = this.detect(filePath);
    return type !== "unknown" && type !== "image";
  }

  /**
   * Check if a file is an image.
   *
   * @param filePath - Path to the file (absolute or relative)
   * @returns true if the file is an image type
   *
   * @example
   * ```typescript
   * detector.isImage("/path/to/photo.jpg"); // true
   * detector.isImage("/path/to/file.pdf"); // false
   * ```
   */
  isImage(filePath: string): boolean {
    return this.detect(filePath) === "image";
  }

  /**
   * Get the file extension from a path.
   *
   * @param filePath - Path to the file
   * @returns Lowercase extension including dot, or empty string
   *
   * @example
   * ```typescript
   * detector.getExtension("/path/to/file.PDF"); // ".pdf"
   * detector.getExtension("/path/to/file"); // ""
   * ```
   */
  getExtension(filePath: string): string {
    return path.extname(filePath).toLowerCase();
  }
}
