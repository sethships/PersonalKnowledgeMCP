/**
 * Document extractor exports.
 *
 * Provides access to all document extractors for PDF, DOCX, Markdown,
 * and image files.
 *
 * @module documents/extractors
 *
 * @example
 * ```typescript
 * import {
 *   PdfExtractor,
 *   DocxExtractor,
 *   MarkdownParser,
 *   ImageMetadataExtractor
 * } from "./extractors";
 *
 * const pdfExtractor = new PdfExtractor();
 * const docxExtractor = new DocxExtractor();
 * const markdownParser = new MarkdownParser();
 * const imageExtractor = new ImageMetadataExtractor();
 * ```
 */

// PDF extraction
export { PdfExtractor } from "./PdfExtractor.js";
export type { PdfExtractorConfig } from "./PdfExtractor.js";

// DOCX extraction
export { DocxExtractor } from "./DocxExtractor.js";
export type { DocxExtractorConfig } from "./DocxExtractor.js";

// Markdown parsing
export { MarkdownParser } from "./MarkdownParser.js";
export type { MarkdownParserConfig } from "./MarkdownParser.js";

// Image metadata extraction
export { ImageMetadataExtractor } from "./ImageMetadataExtractor.js";
export type { ImageMetadataExtractorConfig } from "./ImageMetadataExtractor.js";
