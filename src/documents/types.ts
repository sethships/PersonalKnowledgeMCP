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
