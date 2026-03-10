/**
 * PDF page-to-image converter for the OCR processing pipeline.
 *
 * Renders individual PDF pages as PNG images suitable for OCR processing.
 * Bridges the gap between PDF files and OcrService, which can only process
 * image inputs.
 *
 * Pipeline: PDF file -> PdfPageToImageConverter (PNG buffers) -> OcrService.recognizeBatch() (text)
 *
 * Key design decisions:
 * - Standalone service class (like OcrService, not a BaseExtractor)
 * - Lazy dynamic imports for pdfjs-dist and @napi-rs/canvas
 * - Sequential page rendering to limit memory (one canvas at a time)
 * - Per-page timeout returns error instead of failing batch
 * - Async generator for streaming large documents
 *
 * @module documents/PdfPageToImageConverter
 */

import { getComponentLogger } from "../logging/index.js";
import { ExtractionError, ExtractionTimeoutError, PasswordProtectedError } from "./errors.js";
import { DEFAULT_PDF_IMAGE_CONFIG, PDF_DPI_BASE } from "./pdf-image-constants.js";
import type {
  PdfImageConverterConfig,
  PdfImageProgressCallback,
  PdfPageImage,
} from "./pdf-image-types.js";

// ── Lazy dynamic imports ──────────────────────────────────────────

// pdfjs-dist types
type PdfjsModule = typeof import("pdfjs-dist");
type PDFDocumentProxy = import("pdfjs-dist").PDFDocumentProxy;

let pdfjsPromise: Promise<PdfjsModule> | undefined;
async function ensurePdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      try {
        const m = await import("pdfjs-dist");
        return m.default ?? m;
      } catch (error) {
        pdfjsPromise = undefined;
        throw error;
      }
    })();
  }
  return pdfjsPromise;
}

// @napi-rs/canvas types
interface CanvasModule {
  createCanvas: (width: number, height: number) => NapiCanvas;
}

interface NapiCanvas {
  width: number;
  height: number;
  getContext: (contextId: "2d") => NapiCanvasContext;
  toBuffer: (mimeType: "image/png") => Buffer;
}

interface NapiCanvasContext {
  [key: string]: unknown;
}

let canvasPromise: Promise<CanvasModule> | undefined;
async function ensureCanvas(): Promise<CanvasModule> {
  if (!canvasPromise) {
    canvasPromise = (async () => {
      try {
        const m = await import("@napi-rs/canvas");
        return (m.default ?? m) as unknown as CanvasModule;
      } catch (error) {
        canvasPromise = undefined;
        throw error;
      }
    })();
  }
  return canvasPromise;
}

// ── No-op logger ──────────────────────────────────────────────────

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
 * PDF page-to-image converter for OCR pipeline processing.
 *
 * Renders PDF pages as PNG images using pdfjs-dist for PDF parsing and
 * @napi-rs/canvas for rasterization. Output images can be fed directly
 * to OcrService.recognizeBatch() for text extraction.
 *
 * @example
 * ```typescript
 * const converter = new PdfPageToImageConverter({ dpiResolution: 300 });
 *
 * // Get page count
 * const numPages = await converter.getPageCount(pdfBuffer);
 *
 * // Convert all pages with progress
 * const images = await converter.convertAllPages(pdfBuffer, (p) =>
 *   console.log(`${p.percentage}% - ${p.phase}`)
 * );
 *
 * // Stream pages one at a time
 * for await (const image of converter.convertPagesIterator(pdfBuffer)) {
 *   console.log(`Page ${image.pageNumber}: ${image.width}x${image.height}`);
 * }
 * ```
 */
export class PdfPageToImageConverter {
  private readonly config: Readonly<Required<PdfImageConverterConfig>>;
  private logger: ReturnType<typeof getComponentLogger> | null = null;

  /**
   * Create a new PdfPageToImageConverter.
   *
   * @param config - Converter configuration (missing fields use defaults)
   */
  constructor(config?: PdfImageConverterConfig) {
    this.config = {
      dpiResolution: config?.dpiResolution ?? DEFAULT_PDF_IMAGE_CONFIG.dpiResolution,
      maxPagesPerDocument:
        config?.maxPagesPerDocument ?? DEFAULT_PDF_IMAGE_CONFIG.maxPagesPerDocument,
      pageTimeoutMs: config?.pageTimeoutMs ?? DEFAULT_PDF_IMAGE_CONFIG.pageTimeoutMs,
      maxFileSizeBytes: config?.maxFileSizeBytes ?? DEFAULT_PDF_IMAGE_CONFIG.maxFileSizeBytes,
      timeoutMs: config?.timeoutMs ?? DEFAULT_PDF_IMAGE_CONFIG.timeoutMs,
    };
  }

  /**
   * Get the current converter configuration.
   *
   * @returns Read-only typed reference to the resolved configuration
   */
  getConfig(): Readonly<Required<PdfImageConverterConfig>> {
    return this.config;
  }

  /**
   * Get the number of pages in a PDF document.
   *
   * @param pdfBuffer - PDF file data
   * @returns Number of pages in the document
   * @throws {ExtractionError} If the PDF cannot be loaded
   * @throws {PasswordProtectedError} If the PDF is password-protected
   */
  async getPageCount(pdfBuffer: Buffer | Uint8Array): Promise<number> {
    this.validateBuffer(pdfBuffer);
    const doc = await this.loadDocument(pdfBuffer);
    try {
      return doc.numPages;
    } finally {
      await doc.destroy();
    }
  }

  /**
   * Convert a single PDF page to a PNG image.
   *
   * @param pdfBuffer - PDF file data
   * @param pageNumber - 1-based page number to convert
   * @returns Rendered page image
   * @throws {ExtractionError} If the page number is invalid or rendering fails
   * @throws {ExtractionTimeoutError} If rendering exceeds pageTimeoutMs
   * @throws {PasswordProtectedError} If the PDF is password-protected
   */
  async convertPage(pdfBuffer: Buffer | Uint8Array, pageNumber: number): Promise<PdfPageImage> {
    this.validateBuffer(pdfBuffer);
    const doc = await this.loadDocument(pdfBuffer);
    try {
      if (pageNumber < 1 || pageNumber > doc.numPages) {
        throw new ExtractionError(
          `Invalid page number ${pageNumber}: document has ${doc.numPages} pages`
        );
      }
      return await this.renderPage(doc, pageNumber);
    } finally {
      await doc.destroy();
    }
  }

  /**
   * Convert all pages of a PDF to PNG images.
   *
   * Opens the document once and renders pages sequentially, keeping only
   * one canvas in memory at a time. Pages beyond maxPagesPerDocument are
   * silently skipped.
   *
   * @param pdfBuffer - PDF file data
   * @param onProgress - Optional callback for progress updates
   * @returns Array of rendered page images
   * @throws {ExtractionError} If the PDF cannot be loaded
   * @throws {PasswordProtectedError} If the PDF is password-protected
   */
  async convertAllPages(
    pdfBuffer: Buffer | Uint8Array,
    onProgress?: PdfImageProgressCallback
  ): Promise<PdfPageImage[]> {
    this.validateBuffer(pdfBuffer);

    onProgress?.({
      currentPage: 0,
      totalPages: 0,
      percentage: 0,
      phase: "loading",
    });

    const doc = await this.loadDocument(pdfBuffer);
    try {
      const totalPages = doc.numPages;
      const pagesToConvert = Math.min(totalPages, this.config.maxPagesPerDocument);
      const results: PdfPageImage[] = [];
      const startTime = Date.now();

      for (let i = 1; i <= pagesToConvert; i++) {
        // Enforce overall timeout
        const elapsed = Date.now() - startTime;
        if (elapsed >= this.config.timeoutMs) {
          const log = this.getLogger();
          log.warn(
            {
              elapsedMs: elapsed,
              timeoutMs: this.config.timeoutMs,
              processedPages: i - 1,
              totalPages,
            },
            "PDF page-to-image conversion timed out, skipping remaining pages"
          );
          break;
        }

        onProgress?.({
          currentPage: i,
          totalPages,
          percentage: Math.round(((i - 1) / pagesToConvert) * 100),
          phase: "rendering",
        });

        try {
          const pageImage = await this.renderPage(doc, i);
          results.push(pageImage);
        } catch (error) {
          // Per-page failures don't abort the batch
          const log = this.getLogger();
          log.warn(
            { pageNumber: i, error: error instanceof Error ? error.message : String(error) },
            "PDF page rendering failed, skipping page"
          );
        }
      }

      onProgress?.({
        currentPage: totalPages,
        totalPages,
        percentage: 100,
        phase: "complete",
      });

      return results;
    } finally {
      await doc.destroy();
    }
  }

  /**
   * Convert PDF pages as an async generator for streaming processing.
   *
   * Yields one PdfPageImage at a time, allowing the caller to process
   * or discard each page before the next is rendered. Useful for large
   * documents where holding all images in memory is not desirable.
   *
   * @param pdfBuffer - PDF file data
   * @yields Rendered page images one at a time
   * @throws {ExtractionError} If the PDF cannot be loaded
   * @throws {PasswordProtectedError} If the PDF is password-protected
   */
  async *convertPagesIterator(pdfBuffer: Buffer | Uint8Array): AsyncGenerator<PdfPageImage> {
    this.validateBuffer(pdfBuffer);
    const doc = await this.loadDocument(pdfBuffer);
    try {
      const totalPages = Math.min(doc.numPages, this.config.maxPagesPerDocument);
      for (let i = 1; i <= totalPages; i++) {
        const pageImage = await this.renderPage(doc, i);
        yield pageImage;
      }
    } finally {
      await doc.destroy();
    }
  }

  // ── Private Methods ────────────────────────────────────────────

  /**
   * Validate the input buffer size.
   *
   * @param buffer - PDF data to validate
   * @throws {ExtractionError} If buffer is empty or exceeds maxFileSizeBytes
   */
  private validateBuffer(buffer: Buffer | Uint8Array): void {
    if (buffer.length === 0) {
      throw new ExtractionError("PDF buffer is empty");
    }
    if (buffer.length > this.config.maxFileSizeBytes) {
      throw new ExtractionError(
        `PDF buffer size ${buffer.length} bytes exceeds maximum ${this.config.maxFileSizeBytes} bytes`
      );
    }
  }

  /**
   * Load a PDF document from a buffer using pdfjs-dist.
   *
   * Detects password-protected and corrupt PDFs.
   *
   * @param buffer - PDF file data
   * @returns Loaded PDF document proxy
   * @throws {ExtractionError} If the PDF cannot be parsed
   * @throws {PasswordProtectedError} If the PDF is encrypted
   */
  private async loadDocument(buffer: Buffer | Uint8Array): Promise<PDFDocumentProxy> {
    const pdfjs = await ensurePdfjs();
    try {
      const data = new Uint8Array(buffer);
      const doc = await pdfjs.getDocument({ data }).promise;
      return doc;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const lowerMessage = message.toLowerCase();

      if (
        lowerMessage.includes("password") ||
        lowerMessage.includes("encrypted") ||
        lowerMessage.includes("decrypt")
      ) {
        throw new PasswordProtectedError("PDF is password-protected and cannot be converted", {
          cause: error instanceof Error ? error : undefined,
        });
      }

      throw new ExtractionError(`Failed to load PDF document: ${message}`, {
        cause: error instanceof Error ? error : undefined,
      });
    }
  }

  /**
   * Render a single page to a PNG image with timeout protection.
   *
   * Uses the settled-flag timeout pattern (same as OcrService.processWithTimeout).
   *
   * @param doc - Loaded PDF document
   * @param pageNumber - 1-based page number
   * @returns Rendered page image
   * @throws {ExtractionTimeoutError} If rendering exceeds pageTimeoutMs
   * @throws {ExtractionError} If rendering fails
   */
  private async renderPage(doc: PDFDocumentProxy, pageNumber: number): Promise<PdfPageImage> {
    const startTime = Date.now();
    let settled = false;

    return new Promise<PdfPageImage>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(
          new ExtractionTimeoutError(
            `PDF page ${pageNumber} rendering timed out after ${this.config.pageTimeoutMs}ms`,
            this.config.pageTimeoutMs,
            { retryable: true }
          )
        );
      }, this.config.pageTimeoutMs);

      this.renderPageInternal(doc, pageNumber)
        .then((result) => {
          clearTimeout(timeoutId);
          if (settled) return;
          settled = true;
          resolve({
            ...result,
            processingTimeMs: Date.now() - startTime,
          });
        })
        .catch((error: Error) => {
          clearTimeout(timeoutId);
          if (settled) return;
          settled = true;
          reject(
            new ExtractionError(`Failed to render PDF page ${pageNumber}: ${error.message}`, {
              cause: error,
            })
          );
        });
    });
  }

  /**
   * Internal page rendering logic.
   *
   * Gets the page, creates a canvas at the configured DPI, renders,
   * and encodes to PNG.
   *
   * @param doc - Loaded PDF document
   * @param pageNumber - 1-based page number
   * @returns Partial page image (without processingTimeMs)
   */
  private async renderPageInternal(
    doc: PDFDocumentProxy,
    pageNumber: number
  ): Promise<Omit<PdfPageImage, "processingTimeMs">> {
    const canvasModule = await ensureCanvas();
    const page = await doc.getPage(pageNumber);

    try {
      const scale = this.config.dpiResolution / PDF_DPI_BASE;
      const viewport = page.getViewport({ scale });

      const width = Math.floor(viewport.width);
      const height = Math.floor(viewport.height);
      const canvas = canvasModule.createCanvas(width, height);
      const context = canvas.getContext("2d");

      // pdfjs-dist render() expects a CanvasRenderingContext2D-like object and
      // an HTMLCanvasElement. @napi-rs/canvas objects are compatible at runtime.
      await page.render({
        canvas: canvas as unknown as HTMLCanvasElement,
        canvasContext: context as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise;

      const imageBuffer = canvas.toBuffer("image/png");

      return {
        pageNumber,
        imageBuffer,
        width,
        height,
      };
    } finally {
      page.cleanup();
    }
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
        this.logger = getComponentLogger("documents:pdf-image-converter");
      } catch {
        return noopLogger;
      }
    }
    return this.logger;
  }
}
