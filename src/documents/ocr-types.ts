/**
 * Type definitions for OCR processing.
 *
 * Provides interfaces for OCR configuration, results, progress reporting,
 * and input handling. Used by OcrService and downstream consumers like
 * PdfExtractor (for scanned PDF pages) and standalone image OCR.
 *
 * @module documents/ocr-types
 */

import type { ExtractorConfig } from "./types.js";

/**
 * Configuration for the OCR service.
 *
 * Extends base extractor config with OCR-specific options for language
 * selection, confidence thresholds, and per-page processing limits.
 *
 * @example
 * ```typescript
 * const config: OcrConfig = {
 *   enabled: true,
 *   languages: ["eng", "fra"],
 *   confidenceThreshold: 70,
 *   pageTimeoutMs: 45000,
 *   maxPagesPerDocument: 50,
 * };
 * ```
 */
export interface OcrConfig extends ExtractorConfig {
  /**
   * Whether OCR processing is enabled.
   *
   * When false, OcrService methods return empty results without
   * attempting recognition.
   *
   * @default true
   */
  enabled?: boolean;

  /**
   * Tesseract language codes for recognition.
   *
   * Language models are downloaded on first use (~15MB each).
   * Common codes: "eng" (English), "fra" (French), "deu" (German).
   *
   * @default ["eng"]
   */
  languages?: string[];

  /**
   * Minimum confidence threshold (0-100) for accepting OCR results.
   *
   * Pages with confidence below this threshold are included in results
   * but marked with `skippedLowConfidence: true` and empty text.
   *
   * @default 60
   */
  confidenceThreshold?: number;

  /**
   * Timeout in milliseconds for processing a single page.
   *
   * When exceeded, the page result is returned with empty text and
   * `skippedLowConfidence: true` rather than failing the entire batch.
   *
   * @default 30000
   */
  pageTimeoutMs?: number;

  /**
   * Maximum number of pages to process in a single batch.
   *
   * Pages beyond this limit are silently skipped and counted
   * in `OcrResult.skippedPages`.
   *
   * @default 100
   */
  maxPagesPerDocument?: number;
}

/**
 * Result from OCR processing of a single page or image.
 *
 * Contains the recognized text, confidence score, and processing metadata.
 *
 * @example
 * ```typescript
 * const pageResult: OcrPageResult = {
 *   pageNumber: 1,
 *   text: "Recognized text content...",
 *   confidence: 87.5,
 *   processingTimeMs: 1250,
 *   skippedLowConfidence: false,
 * };
 * ```
 */
export interface OcrPageResult {
  /**
   * Page number (1-based).
   *
   * For standalone images, this is typically 1.
   */
  pageNumber: number;

  /**
   * Recognized text content.
   *
   * Empty string when OCR fails, times out, or confidence
   * is below threshold.
   */
  text: string;

  /**
   * Recognition confidence score (0-100).
   *
   * Higher values indicate more reliable recognition.
   * 0 when OCR fails or times out.
   */
  confidence: number;

  /**
   * Time taken to process this page in milliseconds.
   */
  processingTimeMs: number;

  /**
   * Whether the page was skipped due to low confidence.
   *
   * True when confidence is below `OcrConfig.confidenceThreshold`
   * or when processing timed out.
   */
  skippedLowConfidence: boolean;
}

/**
 * Aggregated result from OCR processing of multiple pages.
 *
 * Combines text from all pages and provides summary statistics.
 *
 * @example
 * ```typescript
 * const result: OcrResult = {
 *   text: "Combined text from all pages...",
 *   pages: [page1Result, page2Result],
 *   averageConfidence: 82.3,
 *   totalPages: 5,
 *   skippedPages: 1,
 *   totalProcessingTimeMs: 6200,
 *   languages: ["eng"],
 * };
 * ```
 */
export interface OcrResult {
  /**
   * Combined text from all processed pages.
   *
   * Pages are joined with double newlines. Skipped pages
   * contribute no text.
   */
  text: string;

  /**
   * Per-page OCR results in processing order.
   */
  pages: OcrPageResult[];

  /**
   * Average confidence score across all non-skipped pages (0-100).
   *
   * 0 when all pages were skipped or no pages were processed.
   */
  averageConfidence: number;

  /**
   * Total number of pages processed (including skipped).
   */
  totalPages: number;

  /**
   * Number of pages skipped due to low confidence, timeout,
   * or exceeding maxPagesPerDocument.
   */
  skippedPages: number;

  /**
   * Total wall-clock processing time in milliseconds.
   */
  totalProcessingTimeMs: number;

  /**
   * Language codes used for recognition.
   */
  languages: string[];
}

/**
 * Progress information during batch OCR processing.
 *
 * Reported via callback during `recognizeBatch()` to enable
 * progress tracking in CLI and MCP tool responses.
 *
 * @example
 * ```typescript
 * const progress: OcrProgress = {
 *   currentPage: 3,
 *   totalPages: 10,
 *   percentage: 30,
 *   phase: "recognizing",
 * };
 * ```
 */
export interface OcrProgress {
  /**
   * Current page being processed (1-based).
   */
  currentPage: number;

  /**
   * Total number of pages in the batch.
   */
  totalPages: number;

  /**
   * Completion percentage (0-100).
   */
  percentage: number;

  /**
   * Current processing phase.
   *
   * - "initializing": Worker is being created
   * - "recognizing": Actively performing OCR on a page
   * - "complete": All pages have been processed
   */
  phase: "initializing" | "recognizing" | "complete";
}

/**
 * Callback for receiving OCR progress updates.
 *
 * @param progress - Current progress information
 */
export type OcrProgressCallback = (progress: OcrProgress) => void;

/**
 * Input for OCR recognition.
 *
 * Accepts either a file path or a raw buffer (e.g., from PDF page
 * rendering). When both are provided, buffer takes precedence.
 *
 * @example
 * ```typescript
 * // From file
 * const fileInput: OcrInput = { filePath: "/images/scan.png", pageNumber: 1 };
 *
 * // From buffer (e.g., PDF page render)
 * const bufferInput: OcrInput = { buffer: pdfPageBuffer, pageNumber: 3 };
 * ```
 */
export interface OcrInput {
  /**
   * Raw image data buffer.
   *
   * Takes precedence over filePath when both are provided.
   */
  buffer?: Buffer | Uint8Array;

  /**
   * Path to an image file.
   *
   * Used when buffer is not provided. The file is read into
   * memory for processing.
   */
  filePath?: string;

  /**
   * Page number for this input (1-based).
   *
   * When omitted, defaults to the input's position in the batch (1-based).
   */
  pageNumber?: number;
}
