/**
 * Constants for document processing.
 *
 * Defines supported file extensions, MIME types, and default configuration
 * values for document extractors.
 *
 * @module documents/constants
 */

/**
 * Supported document extensions grouped by type.
 *
 * @example
 * ```typescript
 * if (DOCUMENT_EXTENSIONS.pdf.includes(extension)) {
 *   // Handle PDF
 * }
 * ```
 */
export const DOCUMENT_EXTENSIONS = {
  pdf: [".pdf"],
  docx: [".docx"],
  markdown: [".md", ".markdown"],
  txt: [".txt"],
} as const;

/**
 * Supported image extensions for metadata extraction.
 *
 * @example
 * ```typescript
 * if (IMAGE_EXTENSIONS.includes(extension as typeof IMAGE_EXTENSIONS[number])) {
 *   // Handle image
 * }
 * ```
 */
export const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".tiff"] as const;

/**
 * All supported extensions combined (documents + images).
 *
 * Used for filtering files during folder scanning.
 *
 * @example
 * ```typescript
 * const isSupported = SUPPORTED_EXTENSIONS.includes(extension as typeof SUPPORTED_EXTENSIONS[number]);
 * ```
 */
export const SUPPORTED_EXTENSIONS = [
  ...DOCUMENT_EXTENSIONS.pdf,
  ...DOCUMENT_EXTENSIONS.docx,
  ...DOCUMENT_EXTENSIONS.markdown,
  ...DOCUMENT_EXTENSIONS.txt,
  ...IMAGE_EXTENSIONS,
] as const;

/**
 * MIME type mappings for supported file extensions.
 *
 * @example
 * ```typescript
 * const mimeType = MIME_TYPES[".pdf"]; // "application/pdf"
 * ```
 */
export const MIME_TYPES: Readonly<Record<string, string>> = {
  // Documents
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".txt": "text/plain",
  // Images
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".tiff": "image/tiff",
};

/**
 * Default configuration values for document extractors.
 *
 * Based on Phase 6 PRD requirements:
 * - 50MB max file size
 * - 30 second timeout
 *
 * @example
 * ```typescript
 * const config: ExtractorConfig = {
 *   maxFileSizeBytes: DEFAULT_EXTRACTOR_CONFIG.maxFileSizeBytes,
 *   timeoutMs: DEFAULT_EXTRACTOR_CONFIG.timeoutMs
 * };
 * ```
 */
export const DEFAULT_EXTRACTOR_CONFIG = {
  /**
   * Maximum file size: 50MB (per PRD FR-1)
   */
  maxFileSizeBytes: 52_428_800,

  /**
   * Extraction timeout: 30 seconds
   */
  timeoutMs: 30_000,
} as const;

/**
 * Document type labels for display purposes.
 *
 * @example
 * ```typescript
 * const label = DOCUMENT_TYPE_LABELS.pdf; // "PDF Document"
 * ```
 */
export const DOCUMENT_TYPE_LABELS: Readonly<Record<string, string>> = {
  pdf: "PDF Document",
  docx: "Word Document",
  markdown: "Markdown File",
  txt: "Text File",
  image: "Image File",
};

/**
 * Document type string literal union for extension mapping.
 * Includes all document types and "image" for image files.
 */
export type ExtensionDocumentType = "pdf" | "docx" | "markdown" | "txt" | "image";

/**
 * MIME type equivalences for content validation.
 *
 * Maps expected MIME types to alternative MIME types that should be
 * considered valid matches. For example, DOCX files are ZIP archives
 * internally, so file-type may detect them as "application/zip".
 *
 * @example
 * ```typescript
 * const expected = MIME_TYPES[".docx"];
 * const actual = "application/zip";
 * const equivalents = MIME_TYPE_EQUIVALENCES[expected];
 * const isEquivalent = equivalents?.includes(actual); // true
 * ```
 */
export const MIME_TYPE_EQUIVALENCES: Readonly<Record<string, readonly string[]>> = {
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
    "application/zip",
    "application/x-zip-compressed",
  ],
};

/**
 * Set of text-based MIME types that cannot be validated via magic bytes.
 *
 * Files with these MIME types are skipped during MIME validation because
 * they contain no magic bytes (binary signatures) for content detection.
 */
export const TEXT_MIME_TYPES: ReadonlySet<string> = new Set(["text/markdown", "text/plain"]);

/**
 * Extension to document type mapping.
 *
 * Maps file extensions to their corresponding document type.
 * Returns a strongly-typed union of document types.
 *
 * @example
 * ```typescript
 * const docType = EXTENSION_TO_TYPE[".pdf"]; // "pdf"
 * const docType2 = EXTENSION_TO_TYPE[".md"]; // "markdown"
 * ```
 */
export const EXTENSION_TO_TYPE: Readonly<Record<string, ExtensionDocumentType>> = {
  // PDF
  ".pdf": "pdf",
  // DOCX
  ".docx": "docx",
  // Markdown
  ".md": "markdown",
  ".markdown": "markdown",
  // Text
  ".txt": "txt",
  // Images
  ".jpg": "image",
  ".jpeg": "image",
  ".png": "image",
  ".gif": "image",
  ".webp": "image",
  ".tiff": "image",
};
