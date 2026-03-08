/**
 * Type definitions for document processing.
 *
 * Provides interfaces and types for document extraction, metadata,
 * and the extractor contract used by PDF, DOCX, Markdown, and image extractors.
 *
 * @module documents/types
 */

/**
 * Supported document types for extraction.
 *
 * @example
 * ```typescript
 * const docType: DocumentType = "pdf";
 * ```
 */
export type DocumentType = "pdf" | "docx" | "markdown" | "txt";

/**
 * Supported image formats for metadata extraction.
 *
 * @example
 * ```typescript
 * const format: ImageFormat = "jpeg";
 * ```
 */
export type ImageFormat = "jpeg" | "png" | "gif" | "webp" | "tiff";

/**
 * Page information for multi-page documents.
 *
 * Tracks individual page content and metadata within PDF documents.
 *
 * @example
 * ```typescript
 * const page: PageInfo = {
 *   pageNumber: 1,
 *   content: "Page content text...",
 *   wordCount: 250
 * };
 * ```
 */
export interface PageInfo {
  /**
   * Page number (1-based).
   */
  pageNumber: number;

  /**
   * Extracted text content from this page.
   */
  content: string;

  /**
   * Word count for this page.
   *
   * @default undefined
   */
  wordCount?: number;
}

/**
 * Section information for document structure.
 *
 * Represents heading-based sections within documents, particularly
 * useful for Markdown and structured documents.
 *
 * @example
 * ```typescript
 * const section: SectionInfo = {
 *   title: "Introduction",
 *   level: 1,
 *   startOffset: 0,
 *   endOffset: 1500
 * };
 * ```
 */
export interface SectionInfo {
  /**
   * Section heading text.
   */
  title: string;

  /**
   * Heading level (1-6 for standard headings).
   */
  level: number;

  /**
   * Character offset where section starts in content.
   */
  startOffset: number;

  /**
   * Character offset where section ends in content.
   */
  endOffset: number;
}

/**
 * Document metadata for tracking and identification.
 *
 * Contains both extracted document metadata (title, author, dates)
 * and file system metadata (path, size, hash).
 *
 * @example
 * ```typescript
 * const metadata: DocumentMetadata = {
 *   documentType: "pdf",
 *   title: "Technical Specification",
 *   author: "Engineering Team",
 *   pageCount: 25,
 *   wordCount: 8500,
 *   filePath: "/docs/spec.pdf",
 *   fileSizeBytes: 1048576,
 *   contentHash: "sha256:abc123...",
 *   fileModifiedAt: new Date("2024-01-15")
 * };
 * ```
 */
export interface DocumentMetadata {
  /**
   * Type of document extracted.
   */
  documentType: DocumentType;

  /**
   * Document title from metadata or first heading.
   *
   * @default undefined
   */
  title?: string;

  /**
   * Document author from metadata.
   *
   * @default undefined
   */
  author?: string;

  /**
   * Document creation date from metadata.
   *
   * @default undefined
   */
  createdAt?: Date;

  /**
   * Total page count for multi-page documents.
   *
   * @default undefined
   */
  pageCount?: number;

  /**
   * Total word count across all content.
   *
   * @default undefined
   */
  wordCount?: number;

  /**
   * Absolute file path to the document.
   */
  filePath: string;

  /**
   * File size in bytes.
   */
  fileSizeBytes: number;

  /**
   * SHA-256 hash of file content for deduplication.
   */
  contentHash: string;

  /**
   * File system modification timestamp.
   */
  fileModifiedAt: Date;
}

/**
 * Result of document extraction.
 *
 * Contains the extracted text content, metadata, and optional
 * structural information (pages, sections).
 *
 * @example
 * ```typescript
 * const result: ExtractionResult = {
 *   content: "Document text content...",
 *   metadata: {
 *     documentType: "pdf",
 *     filePath: "/docs/report.pdf",
 *     fileSizeBytes: 524288,
 *     contentHash: "sha256:...",
 *     fileModifiedAt: new Date()
 *   },
 *   pages: [
 *     { pageNumber: 1, content: "Page 1..." }
 *   ]
 * };
 * ```
 */
export interface ExtractionResult {
  /**
   * Extracted text content from the document.
   *
   * For multi-page documents, this is the concatenated content
   * from all pages.
   */
  content: string;

  /**
   * Document metadata including file info and extracted metadata.
   */
  metadata: DocumentMetadata;

  /**
   * Page-by-page content for multi-page documents (PDF).
   *
   * @default undefined
   */
  pages?: PageInfo[];

  /**
   * Section structure based on headings.
   *
   * @default undefined
   */
  sections?: SectionInfo[];
}

/**
 * EXIF data extracted from images.
 *
 * Contains camera and capture information from image metadata.
 *
 * @example
 * ```typescript
 * const exif: ExifData = {
 *   dateTaken: new Date("2024-06-15T14:30:00"),
 *   camera: "iPhone 15 Pro",
 *   orientation: 1,
 *   gpsLatitude: 37.7749,
 *   gpsLongitude: -122.4194
 * };
 * ```
 */
export interface ExifData {
  /**
   * Date and time when image was captured.
   *
   * @default undefined
   */
  dateTaken?: Date;

  /**
   * Camera make and model.
   *
   * @default undefined
   */
  camera?: string;

  /**
   * EXIF orientation value (1-8).
   *
   * @default undefined
   */
  orientation?: number;

  /**
   * GPS latitude in decimal degrees.
   *
   * @default undefined
   */
  gpsLatitude?: number;

  /**
   * GPS longitude in decimal degrees.
   *
   * @default undefined
   */
  gpsLongitude?: number;
}

/**
 * Metadata extracted from image files.
 *
 * Contains image dimensions, format, and optional EXIF data.
 *
 * @example
 * ```typescript
 * const imageMetadata: ImageMetadata = {
 *   format: "jpeg",
 *   width: 1920,
 *   height: 1080,
 *   filePath: "/images/photo.jpg",
 *   fileSizeBytes: 2097152,
 *   fileModifiedAt: new Date("2024-01-20"),
 *   exif: {
 *     dateTaken: new Date("2024-01-15"),
 *     camera: "Canon EOS R5"
 *   }
 * };
 * ```
 */
export interface ImageMetadata {
  /**
   * Image format detected from file.
   */
  format: ImageFormat;

  /**
   * Image width in pixels.
   */
  width: number;

  /**
   * Image height in pixels.
   */
  height: number;

  /**
   * Absolute file path to the image.
   */
  filePath: string;

  /**
   * File size in bytes.
   */
  fileSizeBytes: number;

  /**
   * File system modification timestamp.
   */
  fileModifiedAt: Date;

  /**
   * EXIF metadata if available.
   *
   * @default undefined
   */
  exif?: ExifData;
}

/**
 * Common interface for document extractors.
 *
 * Defines the contract that all extractors (PDF, DOCX, Markdown, Image)
 * must implement for consistent usage.
 *
 * @typeParam TResult - The type of extraction result returned
 *
 * @example
 * ```typescript
 * class PdfExtractor implements DocumentExtractor<ExtractionResult> {
 *   async extract(filePath: string): Promise<ExtractionResult> {
 *     // Extract PDF content
 *   }
 *
 *   supports(extension: string): boolean {
 *     return extension === ".pdf";
 *   }
 * }
 * ```
 */
export interface DocumentExtractor<TResult> {
  /**
   * Extract content and metadata from a file.
   *
   * @param filePath - Absolute path to the file to extract
   * @returns Promise resolving to extraction result
   * @throws {DocumentError} When extraction fails
   */
  extract(filePath: string): Promise<TResult>;

  /**
   * Check if this extractor supports a given file extension.
   *
   * @param extension - File extension including dot (e.g., ".pdf")
   * @returns true if this extractor can handle the extension
   */
  supports(extension: string): boolean;
}

/**
 * Configuration options for extractors.
 *
 * @example
 * ```typescript
 * const config: ExtractorConfig = {
 *   maxFileSizeBytes: 52428800, // 50MB
 *   timeoutMs: 30000 // 30 seconds
 * };
 * ```
 */
export interface ExtractorConfig {
  /**
   * Maximum file size in bytes to process.
   *
   * Files exceeding this size will be rejected with FileTooLargeError.
   *
   * @default 52428800 (50MB)
   */
  maxFileSizeBytes?: number;

  /**
   * Timeout in milliseconds for extraction operations.
   *
   * @default 30000 (30 seconds)
   */
  timeoutMs?: number;
}

/**
 * Markdown frontmatter parsed from document.
 *
 * Represents YAML frontmatter commonly found in Markdown files.
 *
 * @example
 * ```typescript
 * const frontmatter: MarkdownFrontmatter = {
 *   title: "Getting Started Guide",
 *   author: "Documentation Team",
 *   date: "2024-01-15",
 *   tags: ["guide", "tutorial"]
 * };
 * ```
 */
export interface MarkdownFrontmatter {
  /**
   * Document title from frontmatter.
   *
   * @default undefined
   */
  title?: string;

  /**
   * Document author from frontmatter.
   *
   * @default undefined
   */
  author?: string;

  /**
   * Document date as string from frontmatter.
   *
   * @default undefined
   */
  date?: string;

  /**
   * Tags or categories from frontmatter.
   *
   * @default undefined
   */
  tags?: string[];

  /**
   * Additional frontmatter fields.
   */
  [key: string]: unknown;
}

/**
 * Extended extraction result for Markdown documents.
 *
 * Includes frontmatter parsing in addition to standard extraction.
 *
 * @example
 * ```typescript
 * const result: MarkdownExtractionResult = {
 *   content: "# Introduction\n...",
 *   metadata: { ... },
 *   frontmatter: { title: "My Doc", tags: ["docs"] },
 *   sections: [{ title: "Introduction", level: 1, ... }]
 * };
 * ```
 */
export interface MarkdownExtractionResult extends ExtractionResult {
  /**
   * Parsed frontmatter from Markdown file.
   *
   * @default undefined
   */
  frontmatter?: MarkdownFrontmatter;
}

/**
 * Extended metadata for document chunks.
 *
 * Includes all FileChunk metadata fields plus document-specific
 * properties for page tracking, section context, and document identification.
 *
 * @example
 * ```typescript
 * const metadata: DocumentChunkMetadata = {
 *   extension: ".pdf",
 *   language: "unknown",
 *   fileSizeBytes: 1048576,
 *   contentHash: "sha256:abc123...",
 *   fileModifiedAt: new Date(),
 *   documentType: "pdf",
 *   pageNumber: 3,
 *   sectionHeading: "Chapter 2: Architecture",
 *   documentTitle: "System Design Guide",
 *   documentAuthor: "Engineering Team"
 * };
 * ```
 */
export interface DocumentChunkMetadata {
  /**
   * File extension (lowercase, with leading dot).
   *
   * @example ".pdf", ".docx", ".md"
   */
  extension: string;

  /**
   * Programming language detected from file extension.
   *
   * Typically "unknown" for documents, but preserved for
   * compatibility with the embedding pipeline.
   */
  language: string;

  /**
   * Original file size in bytes.
   */
  fileSizeBytes: number;

  /**
   * SHA-256 hash of chunk content for deduplication.
   */
  contentHash: string;

  /**
   * File modification timestamp.
   */
  fileModifiedAt: Date;

  /**
   * Type of source document.
   */
  documentType: DocumentType;

  /**
   * Page number for multi-page documents (1-based).
   *
   * Present when the chunk originates from a specific page (e.g., PDF).
   *
   * @default undefined
   */
  pageNumber?: number;

  /**
   * Nearest preceding section heading for this chunk.
   *
   * Provides structural context for the chunk's content within the document.
   *
   * @default undefined
   */
  sectionHeading?: string;

  /**
   * Document title from extraction metadata.
   *
   * @default undefined
   */
  documentTitle?: string;

  /**
   * Document author from extraction metadata.
   *
   * @default undefined
   */
  documentAuthor?: string;

  // ── Table-specific metadata ───────────────────────────────────

  /**
   * Whether this chunk contains table content.
   *
   * When true, the chunk was generated from a {@link TableExtractionResult}
   * rather than from prose text.
   *
   * @default undefined
   */
  isTable?: boolean;

  /**
   * Zero-based index of the table within the source document.
   *
   * Matches {@link TableExtractionResult.tableIndex}.
   *
   * @default undefined
   */
  tableIndex?: number;

  /**
   * Table caption text, if present in the source document.
   *
   * @default undefined
   */
  tableCaption?: string;

  /**
   * Number of columns in the source table.
   *
   * @default undefined
   */
  tableColumnCount?: number;

  /**
   * Number of data rows in the source table (excluding header rows).
   *
   * @default undefined
   */
  tableRowCount?: number;

  /**
   * Source document type that contained the table ("pdf" or "docx").
   *
   * @default undefined
   */
  tableSourceType?: string;

  /**
   * Extraction confidence score between 0.0 and 1.0.
   *
   * Propagated from {@link TableExtractionResult.confidence}.
   *
   * @default undefined
   */
  tableConfidence?: number;
}

/**
 * Document chunk with document-specific metadata.
 *
 * Extends the FileChunk concept with document-aware metadata fields
 * for page tracking, section headings, and document identification.
 * Compatible with the existing embedding pipeline.
 *
 * @example
 * ```typescript
 * const chunk: DocumentChunk = {
 *   id: "my-docs:reports/design.pdf:0",
 *   repository: "my-docs",
 *   filePath: "reports/design.pdf",
 *   content: "Chapter 1: Introduction...",
 *   chunkIndex: 0,
 *   totalChunks: 15,
 *   startLine: 1,
 *   endLine: 42,
 *   metadata: {
 *     extension: ".pdf",
 *     language: "unknown",
 *     fileSizeBytes: 524288,
 *     contentHash: "a1b2c3...",
 *     fileModifiedAt: new Date(),
 *     documentType: "pdf",
 *     pageNumber: 1,
 *     sectionHeading: "Introduction",
 *     documentTitle: "Design Guide"
 *   }
 * };
 * ```
 */
export interface DocumentChunk {
  /**
   * Unique chunk identifier.
   *
   * Format: {source}:{filePath}:{chunkIndex}
   */
  id: string;

  /**
   * Repository or source name.
   */
  repository: string;

  /**
   * File path relative to repository root.
   */
  filePath: string;

  /**
   * Chunk text content.
   */
  content: string;

  /**
   * Zero-based chunk index within the document.
   */
  chunkIndex: number;

  /**
   * Total number of chunks for this document.
   */
  totalChunks: number;

  /**
   * Starting line number in content (1-based).
   */
  startLine: number;

  /**
   * Ending line number in content (1-based, inclusive).
   */
  endLine: number;

  /**
   * Document-specific chunk metadata.
   */
  metadata: DocumentChunkMetadata;
}

/**
 * Configuration for DocumentChunker.
 *
 * Extends the base chunker config with document-aware options for
 * paragraph boundaries, section context, and page boundaries.
 *
 * @example
 * ```typescript
 * const config: DocumentChunkerConfig = {
 *   maxChunkTokens: 500,
 *   overlapTokens: 50,
 *   respectParagraphs: true,
 *   includeSectionContext: true,
 *   respectPageBoundaries: true
 * };
 * ```
 */
export interface DocumentChunkerConfig {
  /**
   * Maximum tokens per chunk.
   *
   * @default 500
   */
  maxChunkTokens?: number;

  /**
   * Overlap tokens between consecutive chunks.
   *
   * @default 50
   */
  overlapTokens?: number;

  /**
   * Respect paragraph boundaries when splitting content.
   *
   * When true, avoids splitting within paragraphs (double-newline delimited).
   * Falls back to line-level splitting for paragraphs exceeding token limit.
   *
   * @default true
   */
  respectParagraphs?: boolean;

  /**
   * Include nearest section heading in chunk metadata.
   *
   * When true, finds the nearest preceding section heading from the
   * ExtractionResult's sections array and attaches it to chunk metadata.
   *
   * @default true
   */
  includeSectionContext?: boolean;

  /**
   * Respect page boundaries for multi-page documents.
   *
   * When true (and pages are available), chunks each page independently
   * to prevent cross-page content mixing. Each chunk's metadata includes
   * the page number.
   *
   * @default true
   */
  respectPageBoundaries?: boolean;
}

// ── Table Extraction Types ──────────────────────────────────────

/**
 * Source document type for table extraction.
 *
 * Derived from {@link DocumentType} to maintain a compile-time
 * relationship — if "pdf" or "docx" are removed from DocumentType,
 * the compiler will flag this type.
 */
export type TableSourceType = Extract<DocumentType, "pdf" | "docx">;

/**
 * Individual cell in an extracted table.
 *
 * @example
 * ```typescript
 * const cell: TableCell = {
 *   content: "Revenue",
 *   rowSpan: 1,
 *   colSpan: 2,
 * };
 * ```
 */
export interface TableCell {
  /** Text content of the cell. */
  content: string;

  /**
   * Number of rows this cell spans.
   *
   * @default 1
   */
  rowSpan?: number;

  /**
   * Number of columns this cell spans.
   *
   * @default 1
   */
  colSpan?: number;
}

/**
 * A row in an extracted table.
 *
 * @example
 * ```typescript
 * const headerRow: TableRow = {
 *   cells: [{ content: "Name" }, { content: "Value" }],
 *   isHeader: true,
 * };
 * ```
 */
export interface TableRow {
  /** Ordered cells in the row. */
  cells: TableCell[];

  /**
   * Whether this row is a header row.
   *
   * @default false
   */
  isHeader?: boolean;
}

/**
 * Structured table data extracted from a document.
 *
 * @example
 * ```typescript
 * const table: TableData = {
 *   rows: [
 *     { cells: [{ content: "Name" }, { content: "Age" }], isHeader: true },
 *     { cells: [{ content: "Alice" }, { content: "30" }] },
 *   ],
 *   columnCount: 2,
 *   caption: "User demographics",
 * };
 * ```
 */
export interface TableData {
  /** All rows in the table, in document order. */
  rows: TableRow[];

  /** Number of columns in the table. */
  columnCount: number;

  /**
   * Table caption, if present in the source document.
   *
   * @default undefined
   */
  caption?: string;
}

/**
 * Result of extracting a single table from a document.
 *
 * One document may contain multiple tables, so extractors return
 * an array of these results.
 *
 * @example
 * ```typescript
 * const result: TableExtractionResult = {
 *   table: { rows: [...], columnCount: 3 },
 *   filePath: "/docs/report.pdf",
 *   sourceType: "pdf",
 *   pageNumber: 4,
 *   tableIndex: 0,
 *   confidence: 0.95,
 * };
 * ```
 */
export interface TableExtractionResult {
  /** The extracted table data. */
  table: TableData;

  /** Absolute path to the source file. */
  filePath: string;

  /** Document type that contained the table. */
  sourceType: TableSourceType;

  /**
   * 1-based page number where the table was found (PDF only).
   *
   * @default undefined
   */
  pageNumber?: number;

  /** 0-based index of this table within the document. */
  tableIndex: number;

  /**
   * Extraction confidence score between 0.0 and 1.0.
   *
   * @default undefined
   */
  confidence?: number;
}

/**
 * Configuration for table extractors.
 *
 * Extends {@link ExtractorConfig} so concrete extractors inherit
 * `maxFileSizeBytes` and `timeoutMs` from {@link BaseExtractor}.
 * Concrete implementations (#410, #411) will add their own options.
 */
export interface TableExtractorConfig extends ExtractorConfig {
  // Intentionally empty — concrete extractors add their own options.
}

/**
 * Interface for table extractors (PDF, DOCX).
 *
 * Extends {@link DocumentExtractor} with a result type of
 * `TableExtractionResult[]` because a single document can contain
 * multiple tables.
 *
 * @example
 * ```typescript
 * class PdfTableExtractor implements TableExtractor {
 *   async extract(filePath: string): Promise<TableExtractionResult[]> {
 *     // Extract tables from PDF
 *   }
 *   supports(extension: string): boolean {
 *     return extension === ".pdf";
 *   }
 * }
 * ```
 */
export interface TableExtractor extends DocumentExtractor<TableExtractionResult[]> {
  // Inherits: extract(filePath: string): Promise<TableExtractionResult[]>
  // Inherits: supports(extension: string): boolean
}

// ── MIME Validation Types ───────────────────────────────────────

/**
 * Result of MIME type validation for a file.
 *
 * Compares the expected MIME type (from file extension) against the
 * actual MIME type detected from file content (magic bytes).
 *
 * @example
 * ```typescript
 * const result: MimeValidationResult = {
 *   isValid: true,
 *   detectedType: "pdf",
 *   expectedMime: "application/pdf",
 *   actualMime: "application/pdf",
 *   filePath: "/docs/report.pdf",
 *   skipped: false,
 * };
 * ```
 */
export interface MimeValidationResult {
  /**
   * Whether the file's content matches its extension-implied type.
   *
   * True when: content matches, file is text-based (skipped), or
   * extension has no expected MIME type.
   */
  isValid: boolean;

  /**
   * Document type detected from the file extension.
   */
  detectedType: string;

  /**
   * Expected MIME type based on file extension from MIME_TYPES map.
   *
   * Undefined when the extension is not in the MIME_TYPES map.
   */
  expectedMime: string | undefined;

  /**
   * Actual MIME type detected from file content (magic bytes).
   *
   * Undefined when file-type cannot detect the content type
   * (e.g., text files have no magic bytes).
   */
  actualMime: string | undefined;

  /**
   * Absolute or relative file path that was validated.
   */
  filePath: string;

  /**
   * Whether MIME validation was skipped.
   *
   * True for text-based files (no magic bytes) or files with
   * unsupported/unknown extensions.
   */
  skipped: boolean;

  /**
   * Explanation when validation failed or was skipped.
   */
  reason?: string;
}
