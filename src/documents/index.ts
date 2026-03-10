/**
 * Document processing module for Phase 6 document ingestion.
 *
 * Provides extractors and utilities for processing PDF, DOCX, Markdown,
 * and image files. Supports text extraction, metadata parsing, and
 * document structure analysis.
 *
 * @module documents
 *
 * @example
 * ```typescript
 * import {
 *   DocumentTypeDetector,
 *   PdfExtractor,
 *   DocxExtractor,
 *   MarkdownParser,
 *   ImageMetadataExtractor,
 *   SUPPORTED_EXTENSIONS,
 *   DocumentError
 * } from "./documents";
 *
 * // Use type detector to route to correct extractor
 * const detector = new DocumentTypeDetector();
 * const type = detector.detect("/path/to/file.pdf");
 * const extractor = detector.getExtractor("/path/to/file.pdf");
 *
 * // Or use extractors directly
 * const pdfExtractor = new PdfExtractor();
 * if (pdfExtractor.supports(".pdf")) {
 *   try {
 *     const result = await pdfExtractor.extract("/path/to/doc.pdf");
 *     console.log(result.content);
 *   } catch (error) {
 *     if (error instanceof DocumentError) {
 *       console.error(`Error [${error.code}]: ${error.message}`);
 *     }
 *   }
 * }
 * ```
 */

// Type exports
export type {
  DocumentType,
  ImageFormat,
  PageInfo,
  SectionInfo,
  DocumentMetadata,
  ExtractionResult,
  ExifData,
  ImageMetadata,
  DocumentExtractor,
  ExtractorConfig,
  MarkdownFrontmatter,
  MarkdownExtractionResult,
  DocumentChunk,
  DocumentChunkMetadata,
  DocumentChunkerConfig,
  TableSourceType,
  TableCell,
  TableRow,
  TableData,
  TableExtractionResult,
  TableExtractorConfig,
  TableExtractor,
  MimeValidationResult,
} from "./types.js";

// Constants
export {
  DOCUMENT_EXTENSIONS,
  IMAGE_EXTENSIONS,
  SUPPORTED_EXTENSIONS,
  MIME_TYPES,
  DEFAULT_EXTRACTOR_CONFIG,
  DOCUMENT_TYPE_LABELS,
  EXTENSION_TO_TYPE,
  MIME_TYPE_EQUIVALENCES,
  TEXT_MIME_TYPES,
} from "./constants.js";

// Error classes
export {
  DocumentError,
  UnsupportedFormatError,
  ExtractionError,
  PasswordProtectedError,
  FileTooLargeError,
  FileAccessError,
  ExtractionTimeoutError,
  NotImplementedError,
  MimeTypeMismatchError,
  isDocumentError,
  isRetryableDocumentError,
} from "./errors.js";
export type { DocumentErrorOptions } from "./errors.js";

// Extractors
export {
  PdfExtractor,
  DocxExtractor,
  MarkdownParser,
  ImageMetadataExtractor,
  PdfTableExtractor,
  DocxTableExtractor,
} from "./extractors/index.js";
export type {
  PdfExtractorConfig,
  DocxExtractorConfig,
  MarkdownParserConfig,
  ImageMetadataExtractorConfig,
  PdfTableExtractorConfig,
  DocxTableExtractorConfig,
} from "./extractors/index.js";

// Table formatter
export { TableFormatter } from "./TableFormatter.js";

// Markdown table parser (inverse of TableFormatter.toMarkdown)
export { MarkdownTableParser } from "./MarkdownTableParser.js";

// Table content indexer
export { TableContentIndexer } from "./TableContentIndexer.js";
export type { TableIndexerConfig, TableIndexerContext } from "./TableContentIndexer.js";

// Document chunker
export { DocumentChunker } from "./DocumentChunker.js";

// Type detector
export { DocumentTypeDetector } from "./DocumentTypeDetector.js";
export type { DetectedType } from "./DocumentTypeDetector.js";

// OCR service
export { OcrService } from "./OcrService.js";
export type {
  OcrConfig,
  OcrResult,
  OcrPageResult,
  OcrProgress,
  OcrProgressCallback,
  OcrInput,
} from "./ocr-types.js";
export { DEFAULT_OCR_CONFIG, OCR_SUPPORTED_EXTENSIONS } from "./ocr-constants.js";

// PDF page-to-image converter
export { PdfPageToImageConverter } from "./PdfPageToImageConverter.js";
export type {
  PdfImageConverterConfig,
  PdfPageImage,
  PdfImageProgress,
  PdfImageProgressCallback,
} from "./pdf-image-types.js";
export { DEFAULT_PDF_IMAGE_CONFIG, PDF_DPI_BASE } from "./pdf-image-constants.js";
