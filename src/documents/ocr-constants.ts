/**
 * Constants and defaults for OCR processing.
 *
 * Provides default configuration values and supported file extensions
 * for the OcrService.
 *
 * @module documents/ocr-constants
 */

import type { OcrConfig } from "./ocr-types.js";

/**
 * Default OCR configuration values.
 *
 * Based on Phase 6 PRD requirements for OCR processing.
 * All values can be overridden via OcrConfig.
 *
 * @example
 * ```typescript
 * import { DEFAULT_OCR_CONFIG } from "./ocr-constants.js";
 *
 * const config = { ...DEFAULT_OCR_CONFIG, languages: ["eng", "fra"] };
 * ```
 */
export const DEFAULT_OCR_CONFIG: Readonly<Required<OcrConfig>> = {
  /** OCR processing is enabled by default. */
  enabled: true,

  /** Default to English recognition. */
  languages: ["eng"],

  /** Minimum 60% confidence to accept OCR text. */
  confidenceThreshold: 60,

  /** 30 second timeout per page. */
  pageTimeoutMs: 30_000,

  /** Process up to 100 pages per document. */
  maxPagesPerDocument: 100,

  /** 50MB max file size (consistent with other extractors). */
  maxFileSizeBytes: 52_428_800,

  /** 30 second overall timeout. */
  timeoutMs: 30_000,
} as const;

/**
 * Image file extensions supported by the OCR service.
 *
 * Excludes .gif as tesseract.js does not reliably handle animated images.
 * Aligned with tesseract.js v6 supported input formats.
 *
 * @example
 * ```typescript
 * import { OCR_SUPPORTED_EXTENSIONS } from "./ocr-constants.js";
 *
 * const isOcrSupported = OCR_SUPPORTED_EXTENSIONS.includes(
 *   ext as (typeof OCR_SUPPORTED_EXTENSIONS)[number]
 * );
 * ```
 */
export const OCR_SUPPORTED_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".tif",
  ".tiff",
  ".bmp",
  ".webp",
] as const;
