/**
 * Unit tests for PdfPageToImageConverter.
 *
 * Tests PDF page-to-image conversion using pdfjs-dist and @napi-rs/canvas
 * with comprehensive mocking. Validates configuration, page counting,
 * single page conversion, batch conversion, progress callbacks, timeout
 * handling, streaming iterator, and error paths.
 *
 * Uses Bun's mock.module() to intercept pdfjs-dist and @napi-rs/canvas
 * imports and supply controlled rendering results.
 */

/* eslint-disable @typescript-eslint/await-thenable -- ESLint cannot resolve async types through dynamic imports */
/* eslint-disable @typescript-eslint/no-non-null-assertion -- Array index access in test assertions */

import { describe, test, expect, beforeEach, mock } from "bun:test";
import {
  DEFAULT_PDF_IMAGE_CONFIG,
  PDF_DPI_BASE,
} from "../../../src/documents/pdf-image-constants.js";
import {
  ExtractionError,
  ExtractionTimeoutError,
  PasswordProtectedError,
} from "../../../src/documents/errors.js";
import type { PdfImageProgress } from "../../../src/documents/pdf-image-types.js";

// ── Mock setup ─────────────────────────────────────────────────────

/** Number of pages the mock document will report. */
let mockDocNumPages = 3;

/** Whether getDocument should fail. */
let mockGetDocumentError: Error | null = null;

/** Whether getPage should fail. */
let mockGetPageError: Error | null = null;

/** Whether render should hang (never resolve) to test timeout. */
let mockRenderHang = false;

/** Error the mock render should throw, if set. */
let mockRenderError: Error | null = null;

/** Tracks whether doc.destroy() was called. */
let mockDocDestroyCalled = false;

/** Tracks whether page.cleanup() was called. */
let mockPageCleanupCallCount = 0;

/** Viewport dimensions returned by getViewport. */
let mockViewportWidth = 612; // 8.5" * 72 DPI
let mockViewportHeight = 792; // 11" * 72 DPI

/** Buffer returned by canvas.toBuffer. */
const MOCK_PNG_BUFFER = Buffer.from("MOCK_PNG_DATA");

/** The mock canvas context */
const mockContext = {
  fillRect: mock(() => {}),
  drawImage: mock(() => {}),
};

/** The mock canvas */
const mockCanvas = {
  width: 0,
  height: 0,
  getContext: mock((_id: string) => mockContext),
  toBuffer: mock((_mime: string) => MOCK_PNG_BUFFER),
};

/** The mock PDF page */
const createMockPage = () => ({
  getViewport: mock(({ scale }: { scale: number }) => ({
    width: mockViewportWidth * scale,
    height: mockViewportHeight * scale,
  })),
  render: mock((_params: unknown) => ({
    promise: mockRenderHang
      ? new Promise(() => {}) // Never resolves
      : mockRenderError
        ? Promise.reject(mockRenderError)
        : Promise.resolve(),
  })),
  cleanup: mock(() => {
    mockPageCleanupCallCount++;
  }),
});

let mockPage = createMockPage();

/** The mock PDF document proxy */
const mockDocProxy = {
  get numPages() {
    return mockDocNumPages;
  },
  getPage: mock(async (_pageNumber: number) => {
    if (mockGetPageError) {
      throw mockGetPageError;
    }
    return mockPage;
  }),
  destroy: mock(async () => {
    mockDocDestroyCalled = true;
  }),
};

// Mock pdfjs-dist before importing PdfPageToImageConverter
void mock.module("pdfjs-dist", () => {
  return {
    default: {
      getDocument: (_params: unknown) => ({
        promise: mockGetDocumentError
          ? Promise.reject(mockGetDocumentError)
          : Promise.resolve(mockDocProxy),
      }),
    },
    getDocument: (_params: unknown) => ({
      promise: mockGetDocumentError
        ? Promise.reject(mockGetDocumentError)
        : Promise.resolve(mockDocProxy),
    }),
  };
});

// Mock @napi-rs/canvas before importing PdfPageToImageConverter
void mock.module("@napi-rs/canvas", () => {
  return {
    default: {
      createCanvas: (width: number, height: number) => {
        mockCanvas.width = width;
        mockCanvas.height = height;
        return mockCanvas;
      },
    },
    createCanvas: (width: number, height: number) => {
      mockCanvas.width = width;
      mockCanvas.height = height;
      return mockCanvas;
    },
  };
});

// Import after mocking
const { PdfPageToImageConverter } =
  await import("../../../src/documents/PdfPageToImageConverter.js");

// ── Test fixtures ──────────────────────────────────────────────────

/** Minimal buffer representing a PDF (real validation happens in pdfjs-dist, which is mocked) */
const TEST_PDF_BUFFER = Buffer.from("%PDF-1.4 mock pdf content");

// ── Helpers ────────────────────────────────────────────────────────

function resetMocks(): void {
  mockDocNumPages = 3;
  mockGetDocumentError = null;
  mockGetPageError = null;
  mockRenderHang = false;
  mockRenderError = null;
  mockDocDestroyCalled = false;
  mockPageCleanupCallCount = 0;
  mockViewportWidth = 612;
  mockViewportHeight = 792;

  // Reset mock page to get fresh mock functions
  mockPage = createMockPage();

  // Reset mock call tracking
  mockDocProxy.getPage.mockClear();
  mockDocProxy.destroy.mockClear();
  mockCanvas.getContext.mockClear();
  mockCanvas.toBuffer.mockClear();
}

// ── Tests ──────────────────────────────────────────────────────────

describe("PdfPageToImageConverter", () => {
  beforeEach(() => {
    resetMocks();
  });

  // ── Constructor & Configuration ──────────────────────────────────

  describe("constructor and getConfig", () => {
    test("uses default config when no config provided", () => {
      const converter = new PdfPageToImageConverter();
      const config = converter.getConfig();

      expect(config.dpiResolution).toBe(DEFAULT_PDF_IMAGE_CONFIG.dpiResolution);
      expect(config.maxPagesPerDocument).toBe(DEFAULT_PDF_IMAGE_CONFIG.maxPagesPerDocument);
      expect(config.pageTimeoutMs).toBe(DEFAULT_PDF_IMAGE_CONFIG.pageTimeoutMs);
      expect(config.maxFileSizeBytes).toBe(DEFAULT_PDF_IMAGE_CONFIG.maxFileSizeBytes);
      expect(config.timeoutMs).toBe(DEFAULT_PDF_IMAGE_CONFIG.timeoutMs);
    });

    test("applies custom config values", () => {
      const converter = new PdfPageToImageConverter({
        dpiResolution: 150,
        maxPagesPerDocument: 50,
        pageTimeoutMs: 15_000,
        maxFileSizeBytes: 10_000_000,
        timeoutMs: 60_000,
      });
      const config = converter.getConfig();

      expect(config.dpiResolution).toBe(150);
      expect(config.maxPagesPerDocument).toBe(50);
      expect(config.pageTimeoutMs).toBe(15_000);
      expect(config.maxFileSizeBytes).toBe(10_000_000);
      expect(config.timeoutMs).toBe(60_000);
    });

    test("applies partial config with defaults for missing fields", () => {
      const converter = new PdfPageToImageConverter({ dpiResolution: 600 });
      const config = converter.getConfig();

      expect(config.dpiResolution).toBe(600);
      expect(config.maxPagesPerDocument).toBe(DEFAULT_PDF_IMAGE_CONFIG.maxPagesPerDocument);
      expect(config.pageTimeoutMs).toBe(DEFAULT_PDF_IMAGE_CONFIG.pageTimeoutMs);
    });

    test("returns frozen config object", () => {
      const converter = new PdfPageToImageConverter();
      const config = converter.getConfig();

      // Config should be frozen at runtime (Object.freeze applied in constructor)
      expect(Object.isFrozen(config)).toBe(true);
    });

    test("throws ExtractionError for zero dpiResolution", () => {
      expect(() => new PdfPageToImageConverter({ dpiResolution: 0 })).toThrow(ExtractionError);
      expect(() => new PdfPageToImageConverter({ dpiResolution: 0 })).toThrow(
        /dpiResolution must be positive/
      );
    });

    test("throws ExtractionError for negative dpiResolution", () => {
      expect(() => new PdfPageToImageConverter({ dpiResolution: -1 })).toThrow(ExtractionError);
    });

    test("throws ExtractionError for zero maxPagesPerDocument", () => {
      expect(() => new PdfPageToImageConverter({ maxPagesPerDocument: 0 })).toThrow(
        ExtractionError
      );
      expect(() => new PdfPageToImageConverter({ maxPagesPerDocument: 0 })).toThrow(
        /maxPagesPerDocument must be positive/
      );
    });

    test("throws ExtractionError for negative maxPagesPerDocument", () => {
      expect(() => new PdfPageToImageConverter({ maxPagesPerDocument: -5 })).toThrow(
        ExtractionError
      );
    });
  });

  // ── Constants ────────────────────────────────────────────────────

  describe("constants", () => {
    test("PDF_DPI_BASE is 72", () => {
      expect(PDF_DPI_BASE).toBe(72);
    });

    test("DEFAULT_PDF_IMAGE_CONFIG has expected defaults", () => {
      expect(DEFAULT_PDF_IMAGE_CONFIG.dpiResolution).toBe(300);
      expect(DEFAULT_PDF_IMAGE_CONFIG.maxPagesPerDocument).toBe(100);
      expect(DEFAULT_PDF_IMAGE_CONFIG.pageTimeoutMs).toBe(30_000);
      expect(DEFAULT_PDF_IMAGE_CONFIG.maxFileSizeBytes).toBe(52_428_800);
      expect(DEFAULT_PDF_IMAGE_CONFIG.timeoutMs).toBe(300_000);
    });
  });

  // ── getPageCount ─────────────────────────────────────────────────

  describe("getPageCount", () => {
    test("returns correct page count", async () => {
      mockDocNumPages = 5;
      const converter = new PdfPageToImageConverter();
      const count = await converter.getPageCount(TEST_PDF_BUFFER);
      expect(count).toBe(5);
    });

    test("destroys document after getting count", async () => {
      const converter = new PdfPageToImageConverter();
      await converter.getPageCount(TEST_PDF_BUFFER);
      expect(mockDocDestroyCalled).toBe(true);
    });

    test("throws ExtractionError on load failure", async () => {
      mockGetDocumentError = new Error("Invalid PDF structure");
      const converter = new PdfPageToImageConverter();

      await expect(converter.getPageCount(TEST_PDF_BUFFER)).rejects.toThrow(ExtractionError);
      await expect(converter.getPageCount(TEST_PDF_BUFFER)).rejects.toThrow(
        /Failed to load PDF document/
      );
    });

    test("throws ExtractionError for empty buffer", async () => {
      const converter = new PdfPageToImageConverter();
      await expect(converter.getPageCount(Buffer.alloc(0))).rejects.toThrow(ExtractionError);
      await expect(converter.getPageCount(Buffer.alloc(0))).rejects.toThrow(/PDF buffer is empty/);
    });

    test("throws ExtractionError for oversized buffer", async () => {
      const converter = new PdfPageToImageConverter({ maxFileSizeBytes: 10 });
      const largeBuffer = Buffer.alloc(20, 0x41);
      await expect(converter.getPageCount(largeBuffer)).rejects.toThrow(ExtractionError);
      await expect(converter.getPageCount(largeBuffer)).rejects.toThrow(/exceeds maximum/);
    });

    test("throws PasswordProtectedError for encrypted PDFs", async () => {
      mockGetDocumentError = new Error("No password given for encrypted PDF");
      const converter = new PdfPageToImageConverter();

      await expect(converter.getPageCount(TEST_PDF_BUFFER)).rejects.toThrow(PasswordProtectedError);
    });
  });

  // ── convertPage ──────────────────────────────────────────────────

  describe("convertPage", () => {
    test("converts a single page to PNG", async () => {
      mockDocNumPages = 1;
      const converter = new PdfPageToImageConverter();
      const result = await converter.convertPage(TEST_PDF_BUFFER, 1);

      expect(result.pageNumber).toBe(1);
      expect(result.imageBuffer).toBe(MOCK_PNG_BUFFER);
      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
    });

    test("calculates correct scale for 300 DPI", async () => {
      mockDocNumPages = 1;
      const converter = new PdfPageToImageConverter({ dpiResolution: 300 });
      const result = await converter.convertPage(TEST_PDF_BUFFER, 1);

      // 300 / 72 ≈ 4.1667, viewport 612 * 4.1667 ≈ 2550
      const expectedScale = 300 / PDF_DPI_BASE;
      const expectedWidth = Math.floor(mockViewportWidth * expectedScale);
      const expectedHeight = Math.floor(mockViewportHeight * expectedScale);

      expect(result.width).toBe(expectedWidth);
      expect(result.height).toBe(expectedHeight);
    });

    test("calculates correct dimensions for custom DPI", async () => {
      mockDocNumPages = 1;
      const converter = new PdfPageToImageConverter({ dpiResolution: 150 });
      const result = await converter.convertPage(TEST_PDF_BUFFER, 1);

      const expectedScale = 150 / PDF_DPI_BASE;
      const expectedWidth = Math.floor(mockViewportWidth * expectedScale);
      const expectedHeight = Math.floor(mockViewportHeight * expectedScale);

      expect(result.width).toBe(expectedWidth);
      expect(result.height).toBe(expectedHeight);
    });

    test("throws ExtractionError for page number below 1", async () => {
      const converter = new PdfPageToImageConverter();
      await expect(converter.convertPage(TEST_PDF_BUFFER, 0)).rejects.toThrow(ExtractionError);
      await expect(converter.convertPage(TEST_PDF_BUFFER, 0)).rejects.toThrow(
        /Invalid page number 0/
      );
    });

    test("throws ExtractionError for page number exceeding document pages", async () => {
      mockDocNumPages = 3;
      const converter = new PdfPageToImageConverter();
      await expect(converter.convertPage(TEST_PDF_BUFFER, 4)).rejects.toThrow(ExtractionError);
      await expect(converter.convertPage(TEST_PDF_BUFFER, 4)).rejects.toThrow(
        /Invalid page number 4.*3 pages/
      );
    });

    test("destroys document on success", async () => {
      mockDocNumPages = 1;
      const converter = new PdfPageToImageConverter();
      await converter.convertPage(TEST_PDF_BUFFER, 1);
      expect(mockDocDestroyCalled).toBe(true);
    });

    test("destroys document on error", async () => {
      const converter = new PdfPageToImageConverter();
      await expect(converter.convertPage(TEST_PDF_BUFFER, 0)).rejects.toThrow();
      expect(mockDocDestroyCalled).toBe(true);
    });

    test("cleans up page after rendering", async () => {
      mockDocNumPages = 1;
      const converter = new PdfPageToImageConverter();
      await converter.convertPage(TEST_PDF_BUFFER, 1);
      expect(mockPageCleanupCallCount).toBeGreaterThanOrEqual(1);
    });

    test("throws ExtractionError when render fails", async () => {
      mockDocNumPages = 1;
      mockRenderError = new Error("WebGL context lost");
      const converter = new PdfPageToImageConverter();

      await expect(converter.convertPage(TEST_PDF_BUFFER, 1)).rejects.toThrow(ExtractionError);
      await expect(converter.convertPage(TEST_PDF_BUFFER, 1)).rejects.toThrow(
        /Failed to render PDF page 1/
      );
    });

    test("throws ExtractionTimeoutError when render times out", async () => {
      mockDocNumPages = 1;
      mockRenderHang = true;
      const converter = new PdfPageToImageConverter({ pageTimeoutMs: 50 });

      await expect(converter.convertPage(TEST_PDF_BUFFER, 1)).rejects.toThrow(
        ExtractionTimeoutError
      );
    });

    test("accepts Uint8Array input", async () => {
      mockDocNumPages = 1;
      const converter = new PdfPageToImageConverter();
      const uint8Array = new Uint8Array(TEST_PDF_BUFFER);
      const result = await converter.convertPage(uint8Array, 1);

      expect(result.pageNumber).toBe(1);
      expect(result.imageBuffer).toBe(MOCK_PNG_BUFFER);
    });

    test("throws ExtractionError for empty buffer", async () => {
      const converter = new PdfPageToImageConverter();
      await expect(converter.convertPage(Buffer.alloc(0), 1)).rejects.toThrow(
        /PDF buffer is empty/
      );
    });

    test("throws ExtractionError for oversized buffer", async () => {
      const converter = new PdfPageToImageConverter({ maxFileSizeBytes: 10 });
      const largeBuffer = Buffer.alloc(20, 0x41);
      await expect(converter.convertPage(largeBuffer, 1)).rejects.toThrow(/exceeds maximum/);
    });
  });

  // ── convertAllPages ──────────────────────────────────────────────

  describe("convertAllPages", () => {
    test("converts all pages in a document", async () => {
      mockDocNumPages = 3;
      const converter = new PdfPageToImageConverter();
      const results = await converter.convertAllPages(TEST_PDF_BUFFER);

      expect(results).toHaveLength(3);
      expect(results[0]!.pageNumber).toBe(1);
      expect(results[1]!.pageNumber).toBe(2);
      expect(results[2]!.pageNumber).toBe(3);
    });

    test("each page has correct image buffer", async () => {
      mockDocNumPages = 2;
      const converter = new PdfPageToImageConverter();
      const results = await converter.convertAllPages(TEST_PDF_BUFFER);

      for (const result of results) {
        expect(result.imageBuffer).toBe(MOCK_PNG_BUFFER);
      }
    });

    test("respects maxPagesPerDocument limit", async () => {
      mockDocNumPages = 10;
      const converter = new PdfPageToImageConverter({ maxPagesPerDocument: 3 });
      const results = await converter.convertAllPages(TEST_PDF_BUFFER);

      expect(results).toHaveLength(3);
    });

    test("reports progress callbacks", async () => {
      mockDocNumPages = 3;
      const converter = new PdfPageToImageConverter();
      const progressUpdates: PdfImageProgress[] = [];

      await converter.convertAllPages(TEST_PDF_BUFFER, (p) => progressUpdates.push({ ...p }));

      // Should have: loading, rendering*3, complete = 5 callbacks
      expect(progressUpdates.length).toBe(5);

      // First callback is loading
      expect(progressUpdates[0]!.phase).toBe("loading");
      expect(progressUpdates[0]!.percentage).toBe(0);

      // Middle callbacks are rendering
      expect(progressUpdates[1]!.phase).toBe("rendering");
      expect(progressUpdates[1]!.currentPage).toBe(1);
      expect(progressUpdates[2]!.phase).toBe("rendering");
      expect(progressUpdates[2]!.currentPage).toBe(2);
      expect(progressUpdates[3]!.phase).toBe("rendering");
      expect(progressUpdates[3]!.currentPage).toBe(3);

      // Last callback is complete
      expect(progressUpdates[4]!.phase).toBe("complete");
      expect(progressUpdates[4]!.percentage).toBe(100);
    });

    test("handles overall timeout gracefully", async () => {
      mockDocNumPages = 100;
      // Use 0ms timeout to trigger immediately
      const converter = new PdfPageToImageConverter({ timeoutMs: 0 });
      const results = await converter.convertAllPages(TEST_PDF_BUFFER);

      // With timeoutMs: 0, the elapsed check triggers at the start of the first iteration
      // so no pages should be rendered (or at most 1 if timing is very tight).
      expect(results.length).toBeLessThanOrEqual(1);
    });

    test("per-page failure does not abort batch", async () => {
      mockDocNumPages = 3;
      let renderCallCounter = 0;

      // Make the second page fail by setting error before render
      const origRender = mockPage.render;
      mockPage.render = mock((_params: unknown) => {
        renderCallCounter++;
        if (renderCallCounter === 2) {
          return { promise: Promise.reject(new Error("Page 2 render failed")) };
        }
        return { promise: Promise.resolve() };
      });

      const converter = new PdfPageToImageConverter();
      const results = await converter.convertAllPages(TEST_PDF_BUFFER);

      // Should have 2 successful pages (page 2 failed and was skipped)
      expect(results).toHaveLength(2);
      expect(results[0]!.pageNumber).toBe(1);
      expect(results[1]!.pageNumber).toBe(3);

      // Restore original mock
      mockPage.render = origRender;
    });

    test("destroys document after batch completes", async () => {
      mockDocNumPages = 2;
      const converter = new PdfPageToImageConverter();
      await converter.convertAllPages(TEST_PDF_BUFFER);
      expect(mockDocDestroyCalled).toBe(true);
    });

    test("destroys document even when all pages fail", async () => {
      mockDocNumPages = 2;
      mockRenderError = new Error("All renders fail");
      const converter = new PdfPageToImageConverter();
      const results = await converter.convertAllPages(TEST_PDF_BUFFER);

      expect(results).toHaveLength(0);
      expect(mockDocDestroyCalled).toBe(true);
    });

    test("works with empty document (0 pages)", async () => {
      mockDocNumPages = 0;
      const converter = new PdfPageToImageConverter();
      const results = await converter.convertAllPages(TEST_PDF_BUFFER);

      expect(results).toHaveLength(0);
    });

    test("works without progress callback", async () => {
      mockDocNumPages = 2;
      const converter = new PdfPageToImageConverter();
      const results = await converter.convertAllPages(TEST_PDF_BUFFER);

      expect(results).toHaveLength(2);
    });
  });

  // ── convertPagesIterator ─────────────────────────────────────────

  describe("convertPagesIterator", () => {
    test("yields pages sequentially", async () => {
      mockDocNumPages = 3;
      const converter = new PdfPageToImageConverter();
      const pages: Awaited<ReturnType<typeof converter.convertPage>>[] = [];

      for await (const page of converter.convertPagesIterator(TEST_PDF_BUFFER)) {
        pages.push(page);
      }

      expect(pages).toHaveLength(3);
      expect(pages[0]!.pageNumber).toBe(1);
      expect(pages[1]!.pageNumber).toBe(2);
      expect(pages[2]!.pageNumber).toBe(3);
    });

    test("respects maxPagesPerDocument limit", async () => {
      mockDocNumPages = 10;
      const converter = new PdfPageToImageConverter({ maxPagesPerDocument: 2 });
      const pages: Awaited<ReturnType<typeof converter.convertPage>>[] = [];

      for await (const page of converter.convertPagesIterator(TEST_PDF_BUFFER)) {
        pages.push(page);
      }

      expect(pages).toHaveLength(2);
    });

    test("cleans up document on early break", async () => {
      mockDocNumPages = 10;
      const converter = new PdfPageToImageConverter();

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _page of converter.convertPagesIterator(TEST_PDF_BUFFER)) {
        break; // Early exit after first page
      }

      expect(mockDocDestroyCalled).toBe(true);
    });

    test("cleans up document on completion", async () => {
      mockDocNumPages = 2;
      const converter = new PdfPageToImageConverter();

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _page of converter.convertPagesIterator(TEST_PDF_BUFFER)) {
        // consume all pages
      }

      expect(mockDocDestroyCalled).toBe(true);
    });

    test("propagates render errors", async () => {
      mockDocNumPages = 1;
      mockRenderError = new Error("Render failure in iterator");
      const converter = new PdfPageToImageConverter();

      const fn = async (): Promise<void> => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _page of converter.convertPagesIterator(TEST_PDF_BUFFER)) {
          // Should throw
        }
      };

      await expect(fn()).rejects.toThrow(ExtractionError);
    });
  });

  // ── Password-protected PDFs ──────────────────────────────────────

  describe("password-protected PDFs", () => {
    test("detects encrypted PDF error message", async () => {
      mockGetDocumentError = new Error("No password given for encrypted PDF");
      const converter = new PdfPageToImageConverter();

      await expect(converter.getPageCount(TEST_PDF_BUFFER)).rejects.toThrow(PasswordProtectedError);
    });

    test("detects password-related error message", async () => {
      mockGetDocumentError = new Error("Incorrect password");
      const converter = new PdfPageToImageConverter();

      await expect(converter.convertPage(TEST_PDF_BUFFER, 1)).rejects.toThrow(
        PasswordProtectedError
      );
    });

    test("detects decrypt error message", async () => {
      mockGetDocumentError = new Error("Failed to decrypt PDF content");
      const converter = new PdfPageToImageConverter();

      await expect(converter.convertAllPages(TEST_PDF_BUFFER)).rejects.toThrow(
        PasswordProtectedError
      );
    });
  });

  // ── Buffer validation ────────────────────────────────────────────

  describe("buffer validation", () => {
    test("rejects empty buffer in getPageCount", async () => {
      const converter = new PdfPageToImageConverter();
      await expect(converter.getPageCount(Buffer.alloc(0))).rejects.toThrow(/PDF buffer is empty/);
    });

    test("rejects empty buffer in convertPage", async () => {
      const converter = new PdfPageToImageConverter();
      await expect(converter.convertPage(Buffer.alloc(0), 1)).rejects.toThrow(
        /PDF buffer is empty/
      );
    });

    test("rejects empty buffer in convertAllPages", async () => {
      const converter = new PdfPageToImageConverter();
      await expect(converter.convertAllPages(Buffer.alloc(0))).rejects.toThrow(
        /PDF buffer is empty/
      );
    });

    test("rejects empty buffer in convertPagesIterator", async () => {
      const converter = new PdfPageToImageConverter();

      const fn = async (): Promise<void> => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _page of converter.convertPagesIterator(Buffer.alloc(0))) {
          // Should throw
        }
      };

      await expect(fn()).rejects.toThrow(/PDF buffer is empty/);
    });

    test("rejects oversized buffer", async () => {
      const converter = new PdfPageToImageConverter({ maxFileSizeBytes: 100 });
      const largeBuffer = Buffer.alloc(200, 0x41);

      await expect(converter.getPageCount(largeBuffer)).rejects.toThrow(/exceeds maximum/);
    });
  });

  // ── Error handling ───────────────────────────────────────────────

  describe("error handling", () => {
    test("wraps non-password PDF load errors as ExtractionError", async () => {
      mockGetDocumentError = new Error("Invalid PDF header");
      const converter = new PdfPageToImageConverter();

      try {
        await converter.getPageCount(TEST_PDF_BUFFER);
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(ExtractionError);
        expect((error as ExtractionError).message).toContain("Failed to load PDF document");
        expect((error as ExtractionError).message).toContain("Invalid PDF header");
      }
    });

    test("includes cause in wrapped errors", async () => {
      const originalError = new Error("Original cause");
      mockGetDocumentError = originalError;
      const converter = new PdfPageToImageConverter();

      try {
        await converter.getPageCount(TEST_PDF_BUFFER);
        expect(true).toBe(false);
      } catch (error) {
        expect((error as ExtractionError).cause).toBe(originalError);
      }
    });

    test("ExtractionTimeoutError is retryable", async () => {
      mockDocNumPages = 1;
      mockRenderHang = true;
      const converter = new PdfPageToImageConverter({ pageTimeoutMs: 50 });

      try {
        await converter.convertPage(TEST_PDF_BUFFER, 1);
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(ExtractionTimeoutError);
        expect((error as ExtractionTimeoutError).retryable).toBe(true);
        expect((error as ExtractionTimeoutError).timeoutMs).toBe(50);
      }
    });
  });
});
