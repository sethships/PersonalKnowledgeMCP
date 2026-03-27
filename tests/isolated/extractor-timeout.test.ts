/**
 * Isolated tests for PdfExtractor and DocxExtractor timeout behavior.
 *
 * Uses mock.module() to inject delayed-resolving promises for pdf-parse and jszip,
 * ensuring the ExtractionTimeoutError code path is exercised deterministically.
 * Placed in tests/isolated/ because mock.module replaces modules globally.
 *
 * Follows the timer-based pattern from image-timeout.test.ts: mocked operations
 * always settle (via setTimeout with configurable delay) and pending timers are
 * explicitly cleared in afterEach — no dangling promises on the event loop.
 *
 * Fixes #475 — non-deterministic timeout tests.
 *
 * @module tests/isolated/extractor-timeout
 */

import { describe, test, expect, beforeAll, beforeEach, afterEach, afterAll, mock } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

/** Mutable delay controlling how long the mocked pdf-parse takes. */
let pdfParseDelayMs = 0;

/** Tracks the mock's pending setTimeout so it can be cleared after each test. */
let pdfParsePendingTimer: ReturnType<typeof setTimeout> | null = null;

// Mock pdf-parse to return a delayed-resolving promise.
// PdfExtractor uses lazy `await import("pdf-parse/lib/pdf-parse.js")` with CJS/ESM
// interop that picks `m.default` when it's a function, which matches our mock shape.
// `void` prefix satisfies ESLint's no-floating-promises rule (mock.module returns a Promise).
void mock.module("pdf-parse/lib/pdf-parse.js", () => ({
  default: () =>
    new Promise((resolve) => {
      pdfParsePendingTimer = setTimeout(() => {
        resolve({ numpages: 1, numrender: 1, info: {}, metadata: null, text: "" });
      }, pdfParseDelayMs);
    }),
}));

// Dynamic imports after mock setup
const { PdfExtractor } = await import("../../src/documents/extractors/PdfExtractor.js");
const { ExtractionTimeoutError } = await import("../../src/documents/errors.js");
const { createTestPdfFiles } = await import("../fixtures/documents/pdf-fixtures.js");

let fixtureDir: string;
let pdfDir: string;

beforeAll(async () => {
  fixtureDir = path.join(os.tmpdir(), `extractor-timeout-test-${Date.now()}`);
  await fs.mkdir(fixtureDir, { recursive: true });

  await createTestPdfFiles(fixtureDir);

  pdfDir = path.join(fixtureDir, "pdf");
});

afterAll(async () => {
  try {
    await fs.rm(fixtureDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

beforeEach(() => {
  pdfParseDelayMs = 0;
});

afterEach(() => {
  if (pdfParsePendingTimer) {
    clearTimeout(pdfParsePendingTimer);
    pdfParsePendingTimer = null;
  }
});

describe("PdfExtractor timeout (isolated)", () => {
  test("throws ExtractionTimeoutError deterministically when pdf-parse is slow", async () => {
    expect.assertions(5);

    // Make mock pdf-parse delay 200ms — well over the 50ms timeout but quick to clean up
    pdfParseDelayMs = 200;

    const extractor = new PdfExtractor({ timeoutMs: 50 });
    const filePath = path.join(pdfDir, "simple.pdf");

    try {
      await extractor.extract(filePath);
    } catch (error) {
      expect(error).toBeInstanceOf(ExtractionTimeoutError);
      const timeoutError = error as InstanceType<typeof ExtractionTimeoutError>;
      expect(timeoutError.code).toBe("EXTRACTION_TIMEOUT");
      expect(timeoutError.timeoutMs).toBe(50);
      expect(timeoutError.retryable).toBe(true);
      expect(timeoutError.filePath).toBe(filePath);
    }
  });
});

// NOTE: DocxExtractor timeout test was removed — DocxExtractor no longer uses mammoth
// (replaced with direct JSZip + @xmldom/xmldom parsing). The timeout behavior is tested
// deterministically in tests/unit/documents/extractors.test.ts with a 1ms timeout.
