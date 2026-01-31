/**
 * Image metadata extractor using sharp and exif-parser.
 *
 * Extracts dimensions, format, and EXIF metadata from image files.
 * Supports JPEG, PNG, GIF, WebP, and TIFF formats.
 *
 * @module documents/extractors/ImageMetadataExtractor
 */

import { IMAGE_EXTENSIONS, DEFAULT_EXTRACTOR_CONFIG } from "../constants.js";
import { NotImplementedError } from "../errors.js";
import type { DocumentExtractor, ImageMetadata, ExtractorConfig } from "../types.js";

/**
 * Image-specific extractor configuration.
 *
 * @example
 * ```typescript
 * const config: ImageMetadataExtractorConfig = {
 *   maxFileSizeBytes: 52428800,
 *   timeoutMs: 30000,
 *   extractExif: true
 * };
 * ```
 */
export interface ImageMetadataExtractorConfig extends ExtractorConfig {
  /**
   * Whether to extract EXIF metadata when available.
   *
   * @default true
   */
  extractExif?: boolean;
}

/**
 * Extracts metadata from image files.
 *
 * Uses sharp for image dimensions and format detection, and exif-parser
 * for EXIF metadata extraction. Does not extract text content from images
 * (OCR not included in Phase 6 scope).
 *
 * @implements {DocumentExtractor<ImageMetadata>}
 *
 * @example
 * ```typescript
 * const extractor = new ImageMetadataExtractor();
 *
 * if (extractor.supports(".jpg")) {
 *   const metadata = await extractor.extract("/images/photo.jpg");
 *   console.log(`Dimensions: ${metadata.width}x${metadata.height}`);
 *   console.log(`Format: ${metadata.format}`);
 *   if (metadata.exif?.dateTaken) {
 *     console.log(`Taken: ${metadata.exif.dateTaken}`);
 *   }
 * }
 * ```
 */
export class ImageMetadataExtractor implements DocumentExtractor<ImageMetadata> {
  private readonly config: Required<ImageMetadataExtractorConfig>;

  /**
   * Creates a new ImageMetadataExtractor instance.
   *
   * @param config - Optional configuration overrides
   */
  constructor(config?: ImageMetadataExtractorConfig) {
    this.config = {
      maxFileSizeBytes: config?.maxFileSizeBytes ?? DEFAULT_EXTRACTOR_CONFIG.maxFileSizeBytes,
      timeoutMs: config?.timeoutMs ?? DEFAULT_EXTRACTOR_CONFIG.timeoutMs,
      extractExif: config?.extractExif ?? true,
    };
  }

  /**
   * Extract metadata from an image file.
   *
   * @param filePath - Absolute path to the image file
   * @returns Promise resolving to image metadata
   * @throws {NotImplementedError} This method is not yet implemented
   * @throws {FileTooLargeError} If file exceeds maximum size
   * @throws {UnsupportedFormatError} If image format is not supported
   * @throws {ExtractionError} If image reading fails
   *
   * @example
   * ```typescript
   * const metadata = await extractor.extract("/images/photo.jpg");
   * console.log(metadata.width, metadata.height);
   * console.log(metadata.exif?.camera);
   * ```
   */
  async extract(filePath: string): Promise<ImageMetadata> {
    // Stub implementation - to be implemented in #361
    await Promise.resolve();
    throw new NotImplementedError(
      `ImageMetadataExtractor.extract is not yet implemented. File: ${filePath}`,
      "ImageMetadataExtractor.extract",
      { filePath }
    );
  }

  /**
   * Check if this extractor supports a given file extension.
   *
   * @param extension - File extension including dot (e.g., ".jpg")
   * @returns true if this extractor can handle the extension
   *
   * @example
   * ```typescript
   * extractor.supports(".jpg"); // true
   * extractor.supports(".jpeg"); // true
   * extractor.supports(".png"); // true
   * extractor.supports(".pdf"); // false
   * ```
   */
  supports(extension: string): boolean {
    const normalizedExt = extension.toLowerCase();
    return IMAGE_EXTENSIONS.includes(normalizedExt as (typeof IMAGE_EXTENSIONS)[number]);
  }

  /**
   * Get the current configuration.
   *
   * @returns The extractor configuration
   */
  getConfig(): Readonly<Required<ImageMetadataExtractorConfig>> {
    return this.config;
  }
}
