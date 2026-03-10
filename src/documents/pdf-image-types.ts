/**
 * Type definitions for PDF page-to-image conversion.
 *
 * Provides interfaces for converter configuration, per-page image results,
 * and progress reporting. Used by PdfPageToImageConverter and downstream
 * consumers like OcrService (for scanned PDF OCR processing).
 *
 * @module documents/pdf-image-types
 */

import type { ExtractorConfig } from "./types.js";

/**
 * Configuration for PdfPageToImageConverter.
 *
 * Extends base extractor config with PDF rendering-specific options
 * for DPI resolution, page limits, and per-page timeout.
 *
 * @example
 * ```typescript
 * const config: PdfImageConverterConfig = {
 *   dpiResolution: 300,
 *   maxPagesPerDocument: 50,
 *   pageTimeoutMs: 30000,
 *   maxFileSizeBytes: 52428800,
 *   timeoutMs: 300000,
 * };
 * ```
 */
export interface PdfImageConverterConfig extends ExtractorConfig {
  /**
   * DPI resolution for rendering PDF pages to images.
   *
   * Higher values produce larger, more detailed images suitable for OCR.
   * Standard PDF user space is 72 DPI, so 300 DPI produces a 4.17x scale.
   *
   * @default 300
   */
  dpiResolution?: number;

  /**
   * Maximum number of pages to convert per document.
   *
   * Pages beyond this limit are silently skipped. Prevents runaway
   * processing on very large PDFs.
   *
   * @default 100
   */
  maxPagesPerDocument?: number;

  /**
   * Timeout in milliseconds for rendering a single page.
   *
   * When exceeded, the page is skipped and an error result is
   * returned for that page rather than failing the entire batch.
   *
   * @default 30000
   */
  pageTimeoutMs?: number;
}

/**
 * Result from rendering a single PDF page to an image.
 *
 * Contains the PNG image buffer, dimensions, and processing metadata.
 * The imageBuffer can be passed directly to OcrService.recognizeImage()
 * or OcrService.recognizeBatch() as an OcrInput.buffer.
 *
 * @example
 * ```typescript
 * const pageImage: PdfPageImage = {
 *   pageNumber: 1,
 *   imageBuffer: pngBuffer,
 *   width: 2550,   // 8.5" * 300 DPI
 *   height: 3300,  // 11" * 300 DPI
 *   processingTimeMs: 450,
 * };
 * ```
 */
export interface PdfPageImage {
  /**
   * Page number (1-based).
   */
  pageNumber: number;

  /**
   * PNG image data of the rendered page.
   *
   * Can be passed to OcrService as OcrInput.buffer.
   */
  imageBuffer: Buffer;

  /**
   * Image width in pixels.
   *
   * Determined by page dimensions and DPI resolution.
   */
  width: number;

  /**
   * Image height in pixels.
   *
   * Determined by page dimensions and DPI resolution.
   */
  height: number;

  /**
   * Time taken to render this page in milliseconds.
   */
  processingTimeMs: number;
}

/**
 * Progress information during PDF page-to-image conversion.
 *
 * Reported via callback during convertAllPages() to enable
 * progress tracking in CLI and MCP tool responses.
 *
 * @example
 * ```typescript
 * const progress: PdfImageProgress = {
 *   currentPage: 3,
 *   totalPages: 10,
 *   percentage: 30,
 *   phase: "rendering",
 * };
 * ```
 */
export interface PdfImageProgress {
  /**
   * Current page being processed (1-based).
   *
   * 0 during the "loading" phase before page rendering starts.
   */
  currentPage: number;

  /**
   * Total number of pages in the document.
   */
  totalPages: number;

  /**
   * Completion percentage (0-100).
   */
  percentage: number;

  /**
   * Current processing phase.
   *
   * - "loading": PDF document is being loaded
   * - "rendering": Actively rendering a page to image
   * - "complete": All pages have been processed
   */
  phase: "loading" | "rendering" | "complete";
}

/**
 * Callback for receiving PDF page-to-image progress updates.
 *
 * @param progress - Current progress information
 */
export type PdfImageProgressCallback = (progress: PdfImageProgress) => void;
