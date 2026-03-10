/**
 * Unit tests for OcrService.
 *
 * Tests OCR text extraction using tesseract.js v6 with comprehensive
 * mocking of the tesseract.js module. Validates configuration, single
 * image recognition, batch processing, progress callbacks, timeout
 * handling, confidence thresholds, worker lifecycle, and disposal.
 *
 * Uses Bun's mock.module() to intercept tesseract.js imports and
 * supply controlled recognition results.
 */

/* eslint-disable @typescript-eslint/await-thenable -- ESLint cannot resolve async types through dynamic imports */
/* eslint-disable @typescript-eslint/no-non-null-assertion -- Array index access in test assertions */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import {
  DEFAULT_OCR_CONFIG,
  OCR_SUPPORTED_EXTENSIONS,
} from "../../../src/documents/ocr-constants.js";
import { ExtractionError } from "../../../src/documents/errors.js";
import type { OcrProgress } from "../../../src/documents/ocr-types.js";

// ── Mock setup ─────────────────────────────────────────────────────

/**
 * Recognition result the mock worker will return.
 * Set before each test to control recognition output.
 */
let mockRecognizeResult: {
  data: {
    text: string;
    confidence: number;
  };
} = {
  data: {
    text: "Hello World",
    confidence: 95,
  },
};

/** Whether recognize should hang (never resolve) to test timeout. */
let mockRecognizeHang = false;

/** Error the mock recognize should throw, if set. */
let mockRecognizeError: Error | null = null;

/** Whether createWorker should fail. */
let mockWorkerCreateError: Error | null = null;

/** Tracks whether terminate was called. */
let mockTerminateCalled = false;

/** Tracks how many times recognize was called. */
let mockRecognizeCallCount = 0;

/** Tracks the last language string passed to createWorker. */
let mockCreateWorkerLangs: string | undefined;

/** The mock worker instance */
const mockWorker = {
  recognize: mock(async (_image: unknown) => {
    mockRecognizeCallCount++;
    if (mockRecognizeHang) {
      return new Promise(() => {}); // Never resolves
    }
    if (mockRecognizeError) {
      throw mockRecognizeError;
    }
    return mockRecognizeResult;
  }),
  terminate: mock(async () => {
    mockTerminateCalled = true;
  }),
};

// Mock tesseract.js before importing OcrService
void mock.module("tesseract.js", () => {
  return {
    default: {
      createWorker: async (langs?: string) => {
        mockCreateWorkerLangs = langs;
        if (mockWorkerCreateError) {
          throw mockWorkerCreateError;
        }
        return mockWorker;
      },
    },
    createWorker: async (langs?: string) => {
      mockCreateWorkerLangs = langs;
      if (mockWorkerCreateError) {
        throw mockWorkerCreateError;
      }
      return mockWorker;
    },
  };
});

// Import after mocking
const { OcrService } = await import("../../../src/documents/OcrService.js");

// ── Test fixtures ──────────────────────────────────────────────────

const FIXTURES_DIR = path.join(import.meta.dir, "../../fixtures/documents");

// Create a minimal test image buffer (1x1 white PNG)
const TEST_IMAGE_BUFFER = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
  "base64"
);

// ── Helpers ────────────────────────────────────────────────────────

function resetMocks(): void {
  mockRecognizeResult = {
    data: { text: "Hello World", confidence: 95 },
  };
  mockRecognizeHang = false;
  mockRecognizeError = null;
  mockWorkerCreateError = null;
  mockTerminateCalled = false;
  mockRecognizeCallCount = 0;
  mockCreateWorkerLangs = undefined;
  // Restore original implementation (mockClear only resets call history)
  mockWorker.recognize.mockImplementation(async (_image: unknown) => {
    mockRecognizeCallCount++;
    if (mockRecognizeHang) {
      return new Promise(() => {}); // Never resolves
    }
    if (mockRecognizeError) {
      throw mockRecognizeError;
    }
    return mockRecognizeResult;
  });
  mockWorker.terminate.mockClear();
}

// ── Tests ──────────────────────────────────────────────────────────

describe("OcrService", () => {
  let service: InstanceType<typeof OcrService>;

  beforeEach(() => {
    resetMocks();
  });

  afterEach(async () => {
    if (service) {
      await service.dispose();
    }
  });

  // ── Constructor & Config ──────────────────────────────────────

  describe("constructor and configuration", () => {
    test("applies default config when no config provided", () => {
      service = new OcrService();
      const config = service.getConfig();

      expect(config.enabled).toBe(DEFAULT_OCR_CONFIG.enabled);
      expect(config.languages).toEqual(DEFAULT_OCR_CONFIG.languages);
      expect(config.confidenceThreshold).toBe(DEFAULT_OCR_CONFIG.confidenceThreshold);
      expect(config.pageTimeoutMs).toBe(DEFAULT_OCR_CONFIG.pageTimeoutMs);
      expect(config.maxPagesPerDocument).toBe(DEFAULT_OCR_CONFIG.maxPagesPerDocument);
      expect(config.maxFileSizeBytes).toBe(DEFAULT_OCR_CONFIG.maxFileSizeBytes);
      expect(config.timeoutMs).toBe(DEFAULT_OCR_CONFIG.timeoutMs);
    });

    test("applies custom config values", () => {
      service = new OcrService({
        enabled: false,
        languages: ["eng", "fra"],
        confidenceThreshold: 80,
        pageTimeoutMs: 60000,
        maxPagesPerDocument: 50,
        maxFileSizeBytes: 10_000_000,
        timeoutMs: 45000,
      });
      const config = service.getConfig();

      expect(config.enabled).toBe(false);
      expect(config.languages).toEqual(["eng", "fra"]);
      expect(config.confidenceThreshold).toBe(80);
      expect(config.pageTimeoutMs).toBe(60000);
      expect(config.maxPagesPerDocument).toBe(50);
      expect(config.maxFileSizeBytes).toBe(10_000_000);
      expect(config.timeoutMs).toBe(45000);
    });

    test("partially overrides config, keeping defaults for missing fields", () => {
      service = new OcrService({ languages: ["deu"] });
      const config = service.getConfig();

      expect(config.enabled).toBe(true);
      expect(config.languages).toEqual(["deu"]);
      expect(config.confidenceThreshold).toBe(DEFAULT_OCR_CONFIG.confidenceThreshold);
    });
  });

  // ── isEnabled ─────────────────────────────────────────────────

  describe("isEnabled", () => {
    test("returns true when enabled (default)", () => {
      service = new OcrService();
      expect(service.isEnabled()).toBe(true);
    });

    test("returns false when disabled", () => {
      service = new OcrService({ enabled: false });
      expect(service.isEnabled()).toBe(false);
    });
  });

  // ── recognizeImage ────────────────────────────────────────────

  describe("recognizeImage", () => {
    test("recognizes text from buffer input", async () => {
      service = new OcrService();
      const result = await service.recognizeImage({ buffer: TEST_IMAGE_BUFFER });

      expect(result.text).toBe("Hello World");
      expect(result.confidence).toBe(95);
      expect(result.pageNumber).toBe(1);
      expect(result.skippedLowConfidence).toBe(false);
      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
    });

    test("recognizes text from Uint8Array buffer", async () => {
      service = new OcrService();
      const uint8 = new Uint8Array(TEST_IMAGE_BUFFER);
      const result = await service.recognizeImage({ buffer: uint8 });

      expect(result.text).toBe("Hello World");
      expect(result.confidence).toBe(95);
    });

    test("uses specified pageNumber", async () => {
      service = new OcrService();
      const result = await service.recognizeImage({
        buffer: TEST_IMAGE_BUFFER,
        pageNumber: 5,
      });

      expect(result.pageNumber).toBe(5);
    });

    test("defaults pageNumber to 1 when not specified", async () => {
      service = new OcrService();
      const result = await service.recognizeImage({ buffer: TEST_IMAGE_BUFFER });

      expect(result.pageNumber).toBe(1);
    });

    test("reads file from filePath when no buffer provided", async () => {
      // Create a temp image file
      const tmpDir = path.join(FIXTURES_DIR, "ocr-test-tmp");
      await fs.mkdir(tmpDir, { recursive: true });
      const tmpFile = path.join(tmpDir, "test.png");
      await fs.writeFile(tmpFile, TEST_IMAGE_BUFFER);

      try {
        service = new OcrService();
        const result = await service.recognizeImage({ filePath: tmpFile });

        expect(result.text).toBe("Hello World");
        expect(result.confidence).toBe(95);
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });

    test("throws when neither buffer nor filePath provided", async () => {
      service = new OcrService();

      await expect(service.recognizeImage({})).rejects.toThrow(ExtractionError);
      await expect(service.recognizeImage({})).rejects.toThrow(
        "OcrInput must provide either buffer or filePath"
      );
    });

    test("throws when filePath does not exist", async () => {
      service = new OcrService();

      await expect(service.recognizeImage({ filePath: "/nonexistent/image.png" })).rejects.toThrow(
        ExtractionError
      );
    });

    test("skips page when confidence is below threshold", async () => {
      mockRecognizeResult = {
        data: { text: "Low quality text", confidence: 30 },
      };

      service = new OcrService({ confidenceThreshold: 60 });
      const result = await service.recognizeImage({ buffer: TEST_IMAGE_BUFFER });

      expect(result.text).toBe("");
      expect(result.confidence).toBe(30);
      expect(result.skippedLowConfidence).toBe(true);
    });

    test("accepts page when confidence equals threshold", async () => {
      mockRecognizeResult = {
        data: { text: "Threshold text", confidence: 60 },
      };

      service = new OcrService({ confidenceThreshold: 60 });
      const result = await service.recognizeImage({ buffer: TEST_IMAGE_BUFFER });

      expect(result.text).toBe("Threshold text");
      expect(result.confidence).toBe(60);
      expect(result.skippedLowConfidence).toBe(false);
    });

    test("trims whitespace from recognized text", async () => {
      mockRecognizeResult = {
        data: { text: "  Hello World  \n\n", confidence: 90 },
      };

      service = new OcrService();
      const result = await service.recognizeImage({ buffer: TEST_IMAGE_BUFFER });

      expect(result.text).toBe("Hello World");
    });

    test("returns skipped result on page timeout", async () => {
      mockRecognizeHang = true;

      service = new OcrService({ pageTimeoutMs: 50 });
      const result = await service.recognizeImage({ buffer: TEST_IMAGE_BUFFER });

      expect(result.text).toBe("");
      expect(result.confidence).toBe(0);
      expect(result.skippedLowConfidence).toBe(true);
      expect(result.processingTimeMs).toBeGreaterThanOrEqual(40);
    });

    test("throws ExtractionError on recognition failure", async () => {
      mockRecognizeError = new Error("Tesseract internal error");

      service = new OcrService();

      await expect(service.recognizeImage({ buffer: TEST_IMAGE_BUFFER })).rejects.toThrow(
        ExtractionError
      );
      await expect(service.recognizeImage({ buffer: TEST_IMAGE_BUFFER })).rejects.toThrow(
        "OCR recognition failed"
      );
    });

    test("throws when service is disabled", async () => {
      service = new OcrService({ enabled: false });

      await expect(service.recognizeImage({ buffer: TEST_IMAGE_BUFFER })).rejects.toThrow(
        "OCR processing is disabled"
      );
    });

    test("throws when service is disposed", async () => {
      service = new OcrService();
      await service.dispose();

      await expect(service.recognizeImage({ buffer: TEST_IMAGE_BUFFER })).rejects.toThrow(
        "OcrService has been disposed"
      );
    });
  });

  // ── recognizeBatch ────────────────────────────────────────────

  describe("recognizeBatch", () => {
    test("processes multiple inputs sequentially", async () => {
      let callCount = 0;
      mockWorker.recognize.mockImplementation(async () => {
        callCount++;
        return {
          data: { text: `Page ${callCount}`, confidence: 90 },
        };
      });

      service = new OcrService();
      const result = await service.recognizeBatch([
        { buffer: TEST_IMAGE_BUFFER, pageNumber: 1 },
        { buffer: TEST_IMAGE_BUFFER, pageNumber: 2 },
        { buffer: TEST_IMAGE_BUFFER, pageNumber: 3 },
      ]);

      expect(result.totalPages).toBe(3);
      expect(result.pages).toHaveLength(3);
      expect(result.pages[0]!.text).toBe("Page 1");
      expect(result.pages[1]!.text).toBe("Page 2");
      expect(result.pages[2]!.text).toBe("Page 3");
      expect(result.skippedPages).toBe(0);
    });

    test("combines text from all pages with double newlines", async () => {
      let callCount = 0;
      mockWorker.recognize.mockImplementation(async () => {
        callCount++;
        return {
          data: { text: `Line ${callCount}`, confidence: 85 },
        };
      });

      service = new OcrService();
      const result = await service.recognizeBatch([
        { buffer: TEST_IMAGE_BUFFER },
        { buffer: TEST_IMAGE_BUFFER },
      ]);

      expect(result.text).toBe("Line 1\n\nLine 2");
    });

    test("calculates average confidence from non-skipped pages", async () => {
      let callCount = 0;
      mockWorker.recognize.mockImplementation(async () => {
        callCount++;
        // Page 1: 80%, Page 2: 40% (skipped), Page 3: 90%
        const confidences = [80, 40, 90];
        return {
          data: {
            text: `Text ${callCount}`,
            confidence: confidences[callCount - 1],
          },
        };
      });

      service = new OcrService({ confidenceThreshold: 60 });
      const result = await service.recognizeBatch([
        { buffer: TEST_IMAGE_BUFFER },
        { buffer: TEST_IMAGE_BUFFER },
        { buffer: TEST_IMAGE_BUFFER },
      ]);

      // Average of 80 and 90 (page 2 skipped)
      expect(result.averageConfidence).toBe(85);
      expect(result.skippedPages).toBe(1);
    });

    test("returns zero average confidence when all pages skipped", async () => {
      mockRecognizeResult = {
        data: { text: "Low", confidence: 10 },
      };

      service = new OcrService({ confidenceThreshold: 60 });
      const result = await service.recognizeBatch([
        { buffer: TEST_IMAGE_BUFFER },
        { buffer: TEST_IMAGE_BUFFER },
      ]);

      expect(result.averageConfidence).toBe(0);
      expect(result.skippedPages).toBe(2);
    });

    test("enforces maxPagesPerDocument limit", async () => {
      service = new OcrService({ maxPagesPerDocument: 2 });
      const inputs = [
        { buffer: TEST_IMAGE_BUFFER, pageNumber: 1 },
        { buffer: TEST_IMAGE_BUFFER, pageNumber: 2 },
        { buffer: TEST_IMAGE_BUFFER, pageNumber: 3 },
        { buffer: TEST_IMAGE_BUFFER, pageNumber: 4 },
      ];

      const result = await service.recognizeBatch(inputs);

      // Only first 2 pages processed, remaining 2 skipped
      expect(result.pages).toHaveLength(2);
      expect(result.skippedPages).toBe(2);
    });

    test("assigns sequential page numbers when not specified", async () => {
      let callCount = 0;
      mockWorker.recognize.mockImplementation(async () => {
        callCount++;
        return {
          data: { text: `P${callCount}`, confidence: 90 },
        };
      });

      service = new OcrService();
      const result = await service.recognizeBatch([
        { buffer: TEST_IMAGE_BUFFER },
        { buffer: TEST_IMAGE_BUFFER },
      ]);

      expect(result.pages[0]!.pageNumber).toBe(1);
      expect(result.pages[1]!.pageNumber).toBe(2);
    });

    test("reports progress via callback", async () => {
      const progressUpdates: OcrProgress[] = [];

      service = new OcrService();
      await service.recognizeBatch(
        [{ buffer: TEST_IMAGE_BUFFER }, { buffer: TEST_IMAGE_BUFFER }],
        (progress) => progressUpdates.push({ ...progress })
      );

      // Expect: initializing, recognizing page 1, recognizing page 2, complete
      expect(progressUpdates.length).toBeGreaterThanOrEqual(4);

      const init = progressUpdates.find((p) => p.phase === "initializing");
      expect(init).toBeDefined();
      expect(init!.percentage).toBe(0);

      const complete = progressUpdates.find((p) => p.phase === "complete");
      expect(complete).toBeDefined();
      expect(complete!.percentage).toBe(100);

      const recognizing = progressUpdates.filter((p) => p.phase === "recognizing");
      expect(recognizing.length).toBeGreaterThanOrEqual(2);
    });

    test("handles empty input array", async () => {
      service = new OcrService();
      const result = await service.recognizeBatch([]);

      expect(result.totalPages).toBe(0);
      expect(result.pages).toHaveLength(0);
      expect(result.text).toBe("");
      expect(result.averageConfidence).toBe(0);
      expect(result.skippedPages).toBe(0);
    });

    test("continues processing when individual page fails", async () => {
      let callCount = 0;
      mockWorker.recognize.mockImplementation(async () => {
        callCount++;
        if (callCount === 2) {
          throw new Error("Page 2 failed");
        }
        return {
          data: { text: `Page ${callCount}`, confidence: 90 },
        };
      });

      service = new OcrService();
      const result = await service.recognizeBatch([
        { buffer: TEST_IMAGE_BUFFER, pageNumber: 1 },
        { buffer: TEST_IMAGE_BUFFER, pageNumber: 2 },
        { buffer: TEST_IMAGE_BUFFER, pageNumber: 3 },
      ]);

      expect(result.totalPages).toBe(3);
      expect(result.pages[0]!.text).toBe("Page 1");
      expect(result.pages[1]!.text).toBe(""); // Failed page
      expect(result.pages[1]!.skippedLowConfidence).toBe(true);
      expect(result.pages[2]!.text).toBe("Page 3");
      expect(result.skippedPages).toBe(1);
    });

    test("includes languages in result", async () => {
      service = new OcrService({ languages: ["eng", "fra"] });
      const result = await service.recognizeBatch([{ buffer: TEST_IMAGE_BUFFER }]);

      expect(result.languages).toEqual(["eng", "fra"]);
    });

    test("tracks total processing time", async () => {
      service = new OcrService();
      const result = await service.recognizeBatch([{ buffer: TEST_IMAGE_BUFFER }]);

      expect(result.totalProcessingTimeMs).toBeGreaterThanOrEqual(0);
    });

    test("throws when service is disabled", async () => {
      service = new OcrService({ enabled: false });

      await expect(service.recognizeBatch([{ buffer: TEST_IMAGE_BUFFER }])).rejects.toThrow(
        "OCR processing is disabled"
      );
    });

    test("throws when service is disposed", async () => {
      service = new OcrService();
      await service.dispose();

      await expect(service.recognizeBatch([{ buffer: TEST_IMAGE_BUFFER }])).rejects.toThrow(
        "OcrService has been disposed"
      );
    });
  });

  // ── Worker Lifecycle ──────────────────────────────────────────

  describe("worker lifecycle", () => {
    test("lazily initializes worker on first call", async () => {
      service = new OcrService();
      // Worker not created yet — no calls to recognize
      expect(mockRecognizeCallCount).toBe(0);

      await service.recognizeImage({ buffer: TEST_IMAGE_BUFFER });
      expect(mockWorker.recognize).toHaveBeenCalled();
    });

    test("reuses worker across multiple calls", async () => {
      service = new OcrService();

      await service.recognizeImage({ buffer: TEST_IMAGE_BUFFER });
      const callsAfterFirst = mockRecognizeCallCount;
      await service.recognizeImage({ buffer: TEST_IMAGE_BUFFER });
      const callsAfterSecond = mockRecognizeCallCount;

      // createWorker should have been called once, but recognize called twice
      expect(mockCreateWorkerLangs).toBeDefined();
      expect(callsAfterFirst).toBe(1);
      expect(callsAfterSecond).toBe(2);
    });

    test("passes language config to createWorker", async () => {
      service = new OcrService({ languages: ["eng", "fra", "deu"] });
      await service.recognizeImage({ buffer: TEST_IMAGE_BUFFER });

      expect(mockCreateWorkerLangs).toBe("eng+fra+deu");
    });

    test("throws ExtractionError when worker creation fails", async () => {
      mockWorkerCreateError = new Error("Worker init failed");

      service = new OcrService();

      await expect(service.recognizeImage({ buffer: TEST_IMAGE_BUFFER })).rejects.toThrow(
        ExtractionError
      );
      await expect(service.recognizeImage({ buffer: TEST_IMAGE_BUFFER })).rejects.toThrow(
        "Failed to initialize tesseract worker"
      );
    });

    test("retries worker creation after failure", async () => {
      mockWorkerCreateError = new Error("First attempt fails");

      service = new OcrService();

      // First call fails
      await expect(service.recognizeImage({ buffer: TEST_IMAGE_BUFFER })).rejects.toThrow();

      // Clear error — second call should succeed
      mockWorkerCreateError = null;
      const result = await service.recognizeImage({ buffer: TEST_IMAGE_BUFFER });
      expect(result.text).toBe("Hello World");
    });
  });

  // ── dispose ───────────────────────────────────────────────────

  describe("dispose", () => {
    test("terminates the worker", async () => {
      service = new OcrService();
      await service.recognizeImage({ buffer: TEST_IMAGE_BUFFER }); // init worker
      await service.dispose();

      expect(mockTerminateCalled).toBe(true);
    });

    test("is idempotent (safe to call multiple times)", async () => {
      service = new OcrService();
      await service.recognizeImage({ buffer: TEST_IMAGE_BUFFER });

      await service.dispose();
      await service.dispose(); // Second call should not throw

      expect(mockTerminateCalled).toBe(true);
    });

    test("handles disposal when worker was never initialized", async () => {
      service = new OcrService();
      await service.dispose(); // No worker was created

      expect(mockTerminateCalled).toBe(false);
    });

    test("prevents further recognition after disposal", async () => {
      service = new OcrService();
      await service.dispose();

      await expect(service.recognizeImage({ buffer: TEST_IMAGE_BUFFER })).rejects.toThrow(
        "OcrService has been disposed"
      );
    });
  });

  // ── Constants ─────────────────────────────────────────────────

  describe("constants", () => {
    test("DEFAULT_OCR_CONFIG has expected values", () => {
      expect(DEFAULT_OCR_CONFIG.enabled).toBe(true);
      expect(DEFAULT_OCR_CONFIG.languages).toEqual(["eng"]);
      expect(DEFAULT_OCR_CONFIG.confidenceThreshold).toBe(60);
      expect(DEFAULT_OCR_CONFIG.pageTimeoutMs).toBe(30_000);
      expect(DEFAULT_OCR_CONFIG.maxPagesPerDocument).toBe(100);
      expect(DEFAULT_OCR_CONFIG.maxFileSizeBytes).toBe(52_428_800);
      expect(DEFAULT_OCR_CONFIG.timeoutMs).toBe(30_000);
    });

    test("OCR_SUPPORTED_EXTENSIONS includes expected formats", () => {
      expect(OCR_SUPPORTED_EXTENSIONS).toContain(".jpg");
      expect(OCR_SUPPORTED_EXTENSIONS).toContain(".jpeg");
      expect(OCR_SUPPORTED_EXTENSIONS).toContain(".png");
      expect(OCR_SUPPORTED_EXTENSIONS).toContain(".tiff");
      expect(OCR_SUPPORTED_EXTENSIONS).toContain(".webp");
    });

    test("OCR_SUPPORTED_EXTENSIONS excludes .gif", () => {
      expect(OCR_SUPPORTED_EXTENSIONS).not.toContain(".gif");
    });
  });
});
