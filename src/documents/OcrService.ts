/**
 * OCR service for text extraction from images using tesseract.js v6.
 *
 * Provides a standalone service for optical character recognition, consumed
 * by other components like PdfExtractor (for scanned PDF pages) and
 * standalone image OCR processing.
 *
 * Key design decisions:
 * - Standalone service, not an extractor (cross-cutting concern)
 * - Sequential processing per PRD memory constraints
 * - Lazy worker initialization with cached promise
 * - Per-page timeout returns skipped result instead of failing batch
 *
 * @module documents/OcrService
 */

import * as fs from "node:fs/promises";
import { getComponentLogger } from "../logging/index.js";
import { ExtractionError } from "./errors.js";
import { DEFAULT_OCR_CONFIG } from "./ocr-constants.js";
import type {
  OcrConfig,
  OcrInput,
  OcrPageResult,
  OcrProgressCallback,
  OcrResult,
} from "./ocr-types.js";

// Lazy dynamic import for tesseract.js so the binding is interceptable
// by Bun's mock.module() in tests (same pattern as PdfExtractor).
type TesseractModule = typeof import("tesseract.js");
type TesseractWorker = import("tesseract.js").Worker;

let tesseractPromise: Promise<TesseractModule> | undefined;
async function ensureTesseract(): Promise<TesseractModule> {
  if (!tesseractPromise) {
    tesseractPromise = (async () => {
      try {
        const m = await import("tesseract.js");
        // Handle CJS/ESM interop
        return m.default ?? m;
      } catch (error) {
        // Clear cached promise so subsequent calls can retry
        tesseractPromise = undefined;
        throw error;
      }
    })();
  }
  return tesseractPromise;
}

/** Shared no-op function for the silent logger */
const noop = (): void => {};

/** No-op logger for when the logging system is not initialized */
const noopLogger = {
  warn: noop,
  info: noop,
  error: noop,
  debug: noop,
  trace: noop,
  fatal: noop,
  level: "silent" as const,
  silent: true,
} as unknown as ReturnType<typeof getComponentLogger>;

/**
 * OCR service for extracting text from images.
 *
 * Uses tesseract.js v6 for recognition with configurable language support,
 * confidence thresholds, and timeout handling. Designed as a reusable service
 * consumed by extractors and MCP tools.
 *
 * @example
 * ```typescript
 * const ocr = new OcrService({ languages: ["eng"] });
 *
 * // Single image
 * const page = await ocr.recognizeImage({ filePath: "/scan.png" });
 * console.log(page.text, page.confidence);
 *
 * // Batch with progress
 * const result = await ocr.recognizeBatch(
 *   [{ buffer: buf1, pageNumber: 1 }, { buffer: buf2, pageNumber: 2 }],
 *   (p) => console.log(`${p.percentage}% complete`)
 * );
 *
 * await ocr.dispose();
 * ```
 */
export class OcrService {
  private readonly config: Readonly<Required<OcrConfig>>;
  private workerPromise: Promise<TesseractWorker> | null = null;
  private disposed = false;
  private logger: ReturnType<typeof getComponentLogger> | null = null;

  /**
   * Create a new OcrService.
   *
   * @param config - OCR configuration (missing fields use defaults)
   */
  constructor(config?: OcrConfig) {
    this.config = {
      enabled: config?.enabled ?? DEFAULT_OCR_CONFIG.enabled,
      languages: config?.languages ?? [...DEFAULT_OCR_CONFIG.languages],
      confidenceThreshold: config?.confidenceThreshold ?? DEFAULT_OCR_CONFIG.confidenceThreshold,
      pageTimeoutMs: config?.pageTimeoutMs ?? DEFAULT_OCR_CONFIG.pageTimeoutMs,
      maxPagesPerDocument: config?.maxPagesPerDocument ?? DEFAULT_OCR_CONFIG.maxPagesPerDocument,
      maxFileSizeBytes: config?.maxFileSizeBytes ?? DEFAULT_OCR_CONFIG.maxFileSizeBytes,
      timeoutMs: config?.timeoutMs ?? DEFAULT_OCR_CONFIG.timeoutMs,
    };
  }

  /**
   * Whether OCR processing is enabled.
   *
   * @returns true if OCR is enabled in the configuration
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Get the current OCR configuration.
   *
   * @returns Read-only typed reference to the resolved configuration
   */
  getConfig(): Readonly<Required<OcrConfig>> {
    return this.config;
  }

  /**
   * Recognize text in a single image.
   *
   * @param input - Image input (buffer or file path)
   * @returns OCR result for the single page
   * @throws {ExtractionError} If the service is disabled, disposed, or input is invalid
   */
  async recognizeImage(input: OcrInput): Promise<OcrPageResult> {
    if (this.disposed) {
      throw new ExtractionError("OcrService has been disposed");
    }
    if (!this.config.enabled) {
      throw new ExtractionError("OCR processing is disabled");
    }

    const pageNumber = input.pageNumber ?? 1;
    const buffer = await this.resolveInputBuffer(input);

    return this.processWithTimeout(buffer, pageNumber);
  }

  /**
   * Recognize text in multiple images sequentially.
   *
   * Processes pages one at a time to limit memory usage per PRD constraints.
   * Pages beyond maxPagesPerDocument are silently skipped.
   *
   * @param inputs - Array of image inputs
   * @param onProgress - Optional callback for progress updates
   * @returns Aggregated OCR result across all pages
   * @throws {ExtractionError} If the service is disabled or disposed
   */
  async recognizeBatch(inputs: OcrInput[], onProgress?: OcrProgressCallback): Promise<OcrResult> {
    if (this.disposed) {
      throw new ExtractionError("OcrService has been disposed");
    }
    if (!this.config.enabled) {
      throw new ExtractionError("OCR processing is disabled");
    }

    const totalPages = inputs.length;
    const pages: OcrPageResult[] = [];
    const startTime = Date.now();
    let skippedPages = 0;

    // Report initialization
    onProgress?.({
      currentPage: 0,
      totalPages,
      percentage: 0,
      phase: "initializing",
    });

    for (let i = 0; i < totalPages; i++) {
      // Enforce maxPagesPerDocument limit
      if (i >= this.config.maxPagesPerDocument) {
        skippedPages += totalPages - i;
        break;
      }

      // Enforce overall batch timeout (timeoutMs from ExtractorConfig)
      const elapsed = Date.now() - startTime;
      if (elapsed >= this.config.timeoutMs) {
        const log = this.getLogger();
        log.warn(
          { elapsedMs: elapsed, timeoutMs: this.config.timeoutMs, processedPages: i, totalPages },
          "OCR batch processing timed out, skipping remaining pages"
        );
        skippedPages += totalPages - i;
        break;
      }

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const input = inputs[i]!;
      const pageNumber = input.pageNumber ?? i + 1;

      // Report progress before processing each page
      onProgress?.({
        currentPage: i + 1,
        totalPages,
        percentage: Math.round((i / totalPages) * 100),
        phase: "recognizing",
      });

      try {
        const buffer = await this.resolveInputBuffer(input);
        const pageResult = await this.processWithTimeout(buffer, pageNumber);
        pages.push(pageResult);

        if (pageResult.skippedLowConfidence) {
          skippedPages++;
        }
      } catch (error) {
        // Individual page errors produce a skipped result, not a batch failure
        const log = this.getLogger();
        log.warn(
          { pageNumber, error: error instanceof Error ? error.message : String(error) },
          "OCR page processing failed, skipping page"
        );
        pages.push({
          pageNumber,
          text: "",
          confidence: 0,
          processingTimeMs: 0,
          skippedLowConfidence: true,
        });
        skippedPages++;
      }
    }

    // Report completion
    onProgress?.({
      currentPage: totalPages,
      totalPages,
      percentage: 100,
      phase: "complete",
    });

    return this.aggregateResults(pages, skippedPages, Date.now() - startTime);
  }

  /**
   * Dispose the OCR service and terminate the worker.
   *
   * Safe to call multiple times (idempotent).
   */
  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;

    if (this.workerPromise) {
      try {
        const worker = await this.workerPromise;
        await worker.terminate();
      } catch {
        // Worker may already be terminated or failed to initialize
      }
      this.workerPromise = null;
    }
  }

  // ── Private Methods ────────────────────────────────────────────

  /**
   * Lazily initialize the tesseract worker.
   *
   * Creates a single worker instance that is reused across all calls.
   * If worker creation fails, the cached promise is cleared so
   * subsequent calls can retry.
   */
  private ensureWorker(): Promise<TesseractWorker> {
    if (!this.workerPromise) {
      this.workerPromise = (async () => {
        try {
          const Tesseract = await ensureTesseract();
          const langs = this.config.languages.join("+");
          const worker = await Tesseract.createWorker(langs);
          return worker;
        } catch (error) {
          // Clear cached promise so subsequent calls can retry
          this.workerPromise = null;
          throw new ExtractionError("Failed to initialize tesseract worker", {
            cause: error instanceof Error ? error : undefined,
          });
        }
      })();
    }
    return this.workerPromise;
  }

  /**
   * Process a single image buffer with timeout protection.
   *
   * Uses the settled-flag pattern from ImageMetadataExtractor. On timeout,
   * returns a skipped result instead of throwing, to avoid failing the batch.
   *
   * @param buffer - Image data to process
   * @param pageNumber - Page number for the result
   * @returns OCR page result
   */
  private async processWithTimeout(
    buffer: Buffer | Uint8Array,
    pageNumber: number
  ): Promise<OcrPageResult> {
    const startTime = Date.now();
    let settled = false;

    return new Promise<OcrPageResult>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        const log = this.getLogger();
        log.warn(
          { pageNumber, timeoutMs: this.config.pageTimeoutMs },
          "OCR page processing timed out"
        );
        resolve({
          pageNumber,
          text: "",
          confidence: 0,
          processingTimeMs: Date.now() - startTime,
          skippedLowConfidence: true,
        });
      }, this.config.pageTimeoutMs);

      this.ensureWorker()
        .then((worker) => worker.recognize(Buffer.from(buffer)))
        .then((result) => {
          clearTimeout(timeoutId);
          if (settled) return;
          settled = true;

          const confidence = result.data.confidence ?? 0;
          const text = result.data.text ?? "";

          if (confidence < this.config.confidenceThreshold) {
            const log = this.getLogger();
            log.debug(
              { pageNumber, confidence, threshold: this.config.confidenceThreshold },
              "OCR page below confidence threshold"
            );
            resolve({
              pageNumber,
              text: "",
              confidence,
              processingTimeMs: Date.now() - startTime,
              skippedLowConfidence: true,
            });
          } else {
            resolve({
              pageNumber,
              text: text.trim(),
              confidence,
              processingTimeMs: Date.now() - startTime,
              skippedLowConfidence: false,
            });
          }
        })
        .catch((error: Error) => {
          clearTimeout(timeoutId);
          if (settled) return;
          settled = true;
          reject(
            new ExtractionError(`OCR recognition failed for page ${pageNumber}: ${error.message}`, {
              cause: error,
            })
          );
        });
    });
  }

  /**
   * Resolve an OcrInput to a buffer.
   *
   * Enforces maxFileSizeBytes when reading from file path. For buffer inputs,
   * the size check is applied against the provided buffer length.
   *
   * @param input - Input with buffer or file path
   * @returns Image data as buffer
   * @throws {ExtractionError} If neither buffer nor filePath is provided,
   *   if the file cannot be read, or if the file exceeds maxFileSizeBytes
   */
  private async resolveInputBuffer(input: OcrInput): Promise<Buffer | Uint8Array> {
    if (input.buffer) {
      if (input.buffer.length > this.config.maxFileSizeBytes) {
        throw new ExtractionError(
          `Image buffer size ${input.buffer.length} bytes exceeds maximum ${this.config.maxFileSizeBytes} bytes`
        );
      }
      return input.buffer;
    }

    if (input.filePath) {
      try {
        // Check file size before reading to avoid loading oversized files into memory
        const stat = await fs.stat(input.filePath);
        if (stat.size > this.config.maxFileSizeBytes) {
          throw new ExtractionError(
            `Image file size ${stat.size} bytes exceeds maximum ${this.config.maxFileSizeBytes} bytes`,
            { filePath: input.filePath }
          );
        }
        return await fs.readFile(input.filePath);
      } catch (error) {
        if (error instanceof ExtractionError) {
          throw error;
        }
        throw new ExtractionError(`Cannot read image file: ${input.filePath}`, {
          filePath: input.filePath,
          cause: error instanceof Error ? error : undefined,
        });
      }
    }

    throw new ExtractionError("OcrInput must provide either buffer or filePath");
  }

  /**
   * Aggregate individual page results into a combined OcrResult.
   */
  private aggregateResults(
    pages: OcrPageResult[],
    skippedPages: number,
    totalProcessingTimeMs: number
  ): OcrResult {
    const nonSkippedPages = pages.filter((p) => !p.skippedLowConfidence);
    const averageConfidence =
      nonSkippedPages.length > 0
        ? nonSkippedPages.reduce((sum, p) => sum + p.confidence, 0) / nonSkippedPages.length
        : 0;

    const text = pages
      .filter((p) => p.text.length > 0)
      .map((p) => p.text)
      .join("\n\n");

    return {
      text,
      pages,
      averageConfidence,
      totalPages: pages.length,
      skippedPages,
      totalProcessingTimeMs,
      languages: [...this.config.languages],
    };
  }

  /**
   * Get the component logger, initializing lazily.
   *
   * Returns a silent no-op logger when the logging system is not
   * initialized (e.g. during unit tests).
   */
  private getLogger(): ReturnType<typeof getComponentLogger> {
    if (!this.logger) {
      try {
        this.logger = getComponentLogger("documents:ocr-service");
      } catch {
        return noopLogger;
      }
    }
    return this.logger;
  }
}
