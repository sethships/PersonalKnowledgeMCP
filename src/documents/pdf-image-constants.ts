/**
 * Constants and defaults for PDF page-to-image conversion.
 *
 * Provides default configuration values and PDF rendering constants
 * for the PdfPageToImageConverter.
 *
 * @module documents/pdf-image-constants
 */

import type { PdfImageConverterConfig } from "./pdf-image-types.js";

/**
 * Standard PDF user space units per inch.
 *
 * PDF coordinates are specified in user space units where 1 unit = 1/72 inch.
 * This constant is used to calculate the scale factor for rendering at a
 * target DPI: `scale = targetDpi / PDF_DPI_BASE`.
 *
 * @example
 * ```typescript
 * // 300 DPI rendering
 * const scale = 300 / PDF_DPI_BASE; // 4.1667
 * ```
 */
export const PDF_DPI_BASE = 72;

/**
 * Default PDF page-to-image converter configuration values.
 *
 * Based on Phase 6 PRD requirements for OCR processing pipeline.
 * All values can be overridden via PdfImageConverterConfig.
 *
 * @example
 * ```typescript
 * import { DEFAULT_PDF_IMAGE_CONFIG } from "./pdf-image-constants.js";
 *
 * const config = { ...DEFAULT_PDF_IMAGE_CONFIG, dpiResolution: 150 };
 * ```
 */
export const DEFAULT_PDF_IMAGE_CONFIG: Readonly<Required<PdfImageConverterConfig>> = {
  /** 300 DPI for high-quality OCR-suitable images. */
  dpiResolution: 300,

  /** Process up to 100 pages per document. */
  maxPagesPerDocument: 100,

  /** 30 second timeout per page render. */
  pageTimeoutMs: 30_000,

  /** 50MB max file size (consistent with other extractors). */
  maxFileSizeBytes: 52_428_800,

  /** 5 minute overall timeout for multi-page documents. */
  timeoutMs: 300_000,
} as const;
