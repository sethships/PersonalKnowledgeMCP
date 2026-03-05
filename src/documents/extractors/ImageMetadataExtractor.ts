/**
 * Image metadata extractor using sharp and exif-parser.
 *
 * Extracts dimensions, format, and EXIF metadata from image files.
 * Supports JPEG, PNG, GIF, WebP, and TIFF formats.
 *
 * @module documents/extractors/ImageMetadataExtractor
 */

import sharp from "sharp";
import * as exifParser from "exif-parser";
import { IMAGE_EXTENSIONS, DEFAULT_EXTRACTOR_CONFIG } from "../constants.js";
import { ExtractionError, ExtractionTimeoutError, UnsupportedFormatError } from "../errors.js";
import { BaseExtractor } from "./BaseExtractor.js";
import type { ImageMetadata, ExifData, ImageFormat, ExtractorConfig } from "../types.js";

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
 * Map of sharp format strings to ImageFormat type values.
 */
const SHARP_FORMAT_MAP: Readonly<Record<string, ImageFormat>> = {
  jpeg: "jpeg",
  jpg: "jpeg",
  png: "png",
  gif: "gif",
  webp: "webp",
  tiff: "tiff",
  tif: "tiff",
};

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
export class ImageMetadataExtractor extends BaseExtractor<
  Required<ImageMetadataExtractorConfig>,
  ImageMetadata
> {
  /**
   * Creates a new ImageMetadataExtractor instance.
   *
   * @param config - Optional configuration overrides
   */
  constructor(config?: ImageMetadataExtractorConfig) {
    super("documents:image-extractor", {
      maxFileSizeBytes: config?.maxFileSizeBytes ?? DEFAULT_EXTRACTOR_CONFIG.maxFileSizeBytes,
      timeoutMs: config?.timeoutMs ?? DEFAULT_EXTRACTOR_CONFIG.timeoutMs,
      extractExif: config?.extractExif ?? true,
    });
  }

  /**
   * Extract metadata from an image file.
   *
   * @param filePath - Absolute path to the image file
   * @returns Promise resolving to image metadata
   * @throws {FileAccessError} If file cannot be accessed
   * @throws {FileTooLargeError} If file exceeds maximum size
   * @throws {UnsupportedFormatError} If image format is not supported
   * @throws {ExtractionError} If image reading fails
   * @throws {ExtractionTimeoutError} If extraction times out
   *
   * @example
   * ```typescript
   * const metadata = await extractor.extract("/images/photo.jpg");
   * console.log(metadata.width, metadata.height);
   * console.log(metadata.exif?.camera);
   * ```
   */
  async extract(filePath: string): Promise<ImageMetadata> {
    // 1. Get file stats and validate existence
    const stats = await this.getFileStats(filePath);

    // 2. Check file size against limit
    this.validateFileSize(stats.size, filePath);

    // 3. Read file into buffer
    const buffer = await this.readFileBuffer(filePath);

    // 4. Extract image metadata with sharp (with timeout)
    const sharpMetadata = await this.extractWithTimeout(buffer, filePath);

    // 5. Map sharp format to ImageFormat
    const format = this.mapFormat(sharpMetadata.format, filePath);

    // 6. Validate dimensions
    if (!sharpMetadata.width || !sharpMetadata.height) {
      throw new ExtractionError(`Failed to extract image dimensions from: ${filePath}`, {
        filePath,
      });
    }

    // 7. Extract EXIF data if configured and format supports it
    const exif = this.extractExifData(buffer, format);

    return {
      format,
      width: sharpMetadata.width,
      height: sharpMetadata.height,
      filePath,
      fileSizeBytes: stats.size,
      fileModifiedAt: stats.mtime,
      exif,
    };
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
   * Extract sharp metadata with timeout protection.
   *
   * @param buffer - Image file buffer
   * @param filePath - Path to the file (for error context)
   * @returns Sharp metadata result
   * @throws {ExtractionTimeoutError} If extraction times out
   * @throws {ExtractionError} If sharp parsing fails
   */
  private async extractWithTimeout(buffer: Buffer, filePath: string): Promise<sharp.Metadata> {
    let settled = false;

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        // NOTE: In-flight sharp operations continue in background after timeout.
        // Neither sharp nor the JS runtime provides a cancellation mechanism for
        // native image processing. Consider worker threads for isolation if this
        // becomes a production issue.
        reject(
          new ExtractionTimeoutError(
            `Image extraction timed out after ${this.config.timeoutMs}ms`,
            this.config.timeoutMs,
            { filePath, retryable: true }
          )
        );
      }, this.config.timeoutMs);

      sharp(buffer)
        .metadata()
        .then((metadata) => {
          clearTimeout(timeoutId);
          if (settled) return;
          settled = true;
          resolve(metadata);
        })
        .catch((error: Error) => {
          clearTimeout(timeoutId);
          if (settled) return;
          settled = true;
          reject(
            new ExtractionError(`Failed to extract image metadata: ${error.message}`, {
              filePath,
              cause: error,
            })
          );
        });
    });
  }

  /**
   * Map sharp format string to ImageFormat type.
   *
   * @param sharpFormat - Format string from sharp metadata
   * @param filePath - Path to the file (for error context)
   * @returns Mapped ImageFormat value
   * @throws {UnsupportedFormatError} If format is not recognized
   */
  private mapFormat(sharpFormat: string | undefined, filePath: string): ImageFormat {
    if (!sharpFormat) {
      throw new UnsupportedFormatError(
        `Unable to detect image format for: ${filePath}`,
        "unknown",
        { filePath }
      );
    }

    const mapped = SHARP_FORMAT_MAP[sharpFormat.toLowerCase()];
    if (!mapped) {
      throw new UnsupportedFormatError(
        `Unsupported image format "${sharpFormat}" for: ${filePath}`,
        sharpFormat,
        { filePath }
      );
    }

    return mapped;
  }

  /**
   * Extract EXIF metadata from image buffer.
   *
   * Only attempts extraction for JPEG and TIFF formats, as these are the
   * only formats that typically contain EXIF data.
   *
   * @param buffer - Image file buffer
   * @param format - Detected image format
   * @returns ExifData if available, undefined otherwise
   */
  private extractExifData(buffer: Buffer, format: ImageFormat): ExifData | undefined {
    if (!this.config.extractExif) {
      return undefined;
    }

    // Only JPEG and TIFF formats typically contain EXIF data
    if (format !== "jpeg" && format !== "tiff") {
      return undefined;
    }

    try {
      const parser = exifParser.create(buffer);
      const result = parser.parse();
      const tags = result.tags;

      // Check if there are any meaningful EXIF tags
      const hasData =
        tags.DateTimeOriginal !== undefined ||
        tags.Make !== undefined ||
        tags.Model !== undefined ||
        tags.Orientation !== undefined ||
        tags.GPSLatitude !== undefined ||
        tags.GPSLongitude !== undefined;

      if (!hasData) {
        return undefined;
      }

      // Build camera string from Make and Model
      let camera: string | undefined;
      if (tags.Make || tags.Model) {
        const parts = [tags.Make?.trim(), tags.Model?.trim()].filter(Boolean);
        camera = parts.join(" ") || undefined;
      }

      return {
        dateTaken: tags.DateTimeOriginal ? new Date(tags.DateTimeOriginal * 1000) : undefined,
        camera,
        orientation: tags.Orientation,
        gpsLatitude: tags.GPSLatitude,
        gpsLongitude: tags.GPSLongitude,
      };
    } catch (error) {
      // EXIF parsing failure is non-fatal; log and return undefined
      this.getLogger().debug(
        { error: error instanceof Error ? error.message : "unknown error", format },
        "EXIF extraction failed, returning undefined"
      );
      return undefined;
    }
  }
}
