/**
 * Document type detection and extractor routing.
 *
 * Detects document types based on file extensions and routes to
 * appropriate extractors.
 *
 * @module documents/DocumentTypeDetector
 */

import * as path from "node:path";
import * as fs from "node:fs";
import { fileTypeFromBuffer } from "file-type";
import {
  DOCUMENT_EXTENSIONS,
  IMAGE_EXTENSIONS,
  EXTENSION_TO_TYPE,
  MIME_TYPES,
  MIME_TYPE_EQUIVALENCES,
  TEXT_MIME_TYPES,
  type ExtensionDocumentType,
} from "./constants.js";
import type { DocumentExtractor, DocumentType, MimeValidationResult } from "./types.js";
import { FileAccessError } from "./errors.js";
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

    const mappedType: ExtensionDocumentType | undefined = EXTENSION_TO_TYPE[extension];
    if (mappedType !== undefined) {
      return mappedType;
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

  /**
   * Validate that a file's content matches its extension-implied MIME type.
   *
   * Reads the first 4100 bytes of the file to detect magic bytes, then
   * compares the detected MIME type against the expected MIME type from
   * the extension. Handles edge cases like text files (no magic bytes),
   * DOCX/ZIP equivalence, empty files, and missing files.
   *
   * @param filePath - Absolute path to the file to validate
   * @returns Promise resolving to the validation result
   * @throws {FileAccessError} When the file cannot be read (not found, permissions)
   *
   * @example
   * ```typescript
   * const result = await detector.validateMimeType("/path/to/file.pdf");
   * if (!result.isValid) {
   *   console.error(`MIME mismatch: expected ${result.expectedMime}, got ${result.actualMime}`);
   * }
   * ```
   */
  async validateMimeType(filePath: string): Promise<MimeValidationResult> {
    const detectedType = this.detect(filePath);
    const extension = path.extname(filePath).toLowerCase();
    const expectedMime: string | undefined = extension ? MIME_TYPES[extension] : undefined;

    // No expected MIME type — skip validation (unsupported or no extension)
    if (!expectedMime) {
      return {
        isValid: true,
        detectedType,
        expectedMime: undefined,
        actualMime: undefined,
        filePath,
        skipped: true,
        reason: extension
          ? `No expected MIME type for extension "${extension}"`
          : "File has no extension",
      };
    }

    // Text-based types have no magic bytes — skip validation
    if (TEXT_MIME_TYPES.has(expectedMime)) {
      return {
        isValid: true,
        detectedType,
        expectedMime,
        actualMime: undefined,
        filePath,
        skipped: true,
        reason: "Text-based file type; no magic bytes to validate",
      };
    }

    // Read first 4100 bytes (minimum needed by file-type)
    let fileHandle: fs.promises.FileHandle | undefined;
    let buffer: Buffer;
    try {
      fileHandle = await fs.promises.open(filePath, "r");
      const stat = await fileHandle.stat();

      if (stat.size === 0) {
        return {
          isValid: false,
          detectedType,
          expectedMime,
          actualMime: undefined,
          filePath,
          skipped: false,
          reason: "Empty file",
        };
      }

      const readSize = Math.min(4100, stat.size);
      buffer = Buffer.alloc(readSize);
      await fileHandle.read(buffer, 0, readSize, 0);
    } catch (error: unknown) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === "ENOENT") {
        throw new FileAccessError(`File not found: ${filePath}`, {
          cause: nodeError,
          filePath,
        });
      }
      throw new FileAccessError(`Cannot read file: ${filePath}`, {
        cause: nodeError,
        filePath,
      });
    } finally {
      await fileHandle?.close();
    }

    // Detect actual MIME type from content
    const detected = await fileTypeFromBuffer(buffer);
    const actualMime = detected?.mime;

    // No magic bytes detected — content mismatch for binary types
    if (!actualMime) {
      return {
        isValid: false,
        detectedType,
        expectedMime,
        actualMime: undefined,
        filePath,
        skipped: false,
        reason: `No magic bytes detected; expected ${expectedMime}`,
      };
    }

    // Direct match
    if (actualMime === expectedMime) {
      return {
        isValid: true,
        detectedType,
        expectedMime,
        actualMime,
        filePath,
        skipped: false,
      };
    }

    // Check equivalences (e.g., DOCX detected as ZIP)
    const equivalents = MIME_TYPE_EQUIVALENCES[expectedMime];
    if (equivalents?.includes(actualMime)) {
      return {
        isValid: true,
        detectedType,
        expectedMime,
        actualMime,
        filePath,
        skipped: false,
      };
    }

    // Mismatch
    return {
      isValid: false,
      detectedType,
      expectedMime,
      actualMime,
      filePath,
      skipped: false,
      reason: `Content type "${actualMime}" does not match expected "${expectedMime}"`,
    };
  }

  /**
   * Detect document type and validate MIME type in one call.
   *
   * Convenience method combining {@link detect} and {@link validateMimeType}.
   *
   * @param filePath - Absolute path to the file
   * @returns Promise resolving to both the detected type and validation result
   * @throws {FileAccessError} When the file cannot be read
   *
   * @example
   * ```typescript
   * const { type, validation } = await detector.detectWithValidation("/path/to/file.pdf");
   * console.log(`Type: ${type}, Valid: ${validation.isValid}`);
   * ```
   */
  async detectWithValidation(
    filePath: string
  ): Promise<{ type: DetectedType; validation: MimeValidationResult }> {
    const type = this.detect(filePath);
    const validation = await this.validateMimeType(filePath);
    return { type, validation };
  }
}
