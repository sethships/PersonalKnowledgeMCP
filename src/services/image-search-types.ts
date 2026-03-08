/**
 * Type definitions for ImageSearchService
 *
 * This module defines the interfaces for searching indexed images by metadata
 * (date, dimensions, format, EXIF data). This is the image counterpart to the
 * document-focused DocumentSearchService.
 *
 * @module services/image-search-types
 */

/**
 * Supported image format filter values
 */
export type ImageFormat = "jpeg" | "png" | "gif" | "webp" | "tiff" | "all";

/**
 * Input parameters for image search queries
 */
export interface ImageSearchQuery {
  /** Limit search to a specific watched folder */
  folder?: string;

  /** Filter by image format. If omitted or includes "all", searches all formats */
  format?: ImageFormat[];

  /** Filter images taken/modified on or after this date (YYYY-MM-DD) */
  date_from?: string;

  /** Filter images taken/modified on or before this date (YYYY-MM-DD) */
  date_to?: string;

  /** Minimum image width in pixels */
  min_width?: number;

  /** Minimum image height in pixels */
  min_height?: number;

  /** Glob pattern to match filenames (e.g., 'screenshot*', '*.diagram.*') */
  filename_pattern?: string;

  /** Maximum number of results to return (1-100, default: 20) */
  limit?: number;
}

/**
 * EXIF metadata for an image result
 */
export interface ImageExifData {
  /** Camera model used to take the photo */
  camera?: string;

  /** Image orientation from EXIF */
  orientation?: number;

  /** GPS latitude if present and not stripped */
  gpsLatitude?: number;

  /** GPS longitude if present and not stripped */
  gpsLongitude?: number;
}

/**
 * Individual image search result with metadata
 */
export interface ImageSearchResult {
  /** Relative path to the image within the source folder */
  path: string;

  /** Filename of the image */
  filename: string;

  /** Image format (jpeg, png, etc.) */
  format: string;

  /** Image width in pixels */
  width: number;

  /** Image height in pixels */
  height: number;

  /** File size in bytes */
  sizeBytes: number;

  /** Date the image was taken (from EXIF if available) */
  dateTaken?: Date;

  /** File modification date */
  dateModified: Date;

  /** EXIF metadata if available */
  exif?: ImageExifData;

  /** Source folder name */
  folder: string;
}

/**
 * Image search response with results and diagnostic metadata
 */
export interface ImageSearchResponse {
  /** Image results matching the query criteria */
  results: ImageSearchResult[];

  /** Query execution metadata for performance tracking */
  metadata: {
    /** Total number of results returned */
    totalResults: number;

    /** Total end-to-end query time in milliseconds */
    queryTimeMs: number;
  };
}

/**
 * ImageSearchService interface for image metadata search operations
 */
export interface ImageSearchService {
  /**
   * Execute a metadata search query across indexed images
   *
   * @param query - Search parameters including format, date, and dimension filters
   * @returns Search results with image metadata and performance data
   */
  searchImages(query: ImageSearchQuery): Promise<ImageSearchResponse>;
}
