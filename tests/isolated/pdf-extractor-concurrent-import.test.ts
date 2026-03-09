/**
 * Tests PdfExtractor concurrent-import singleton behavior.
 *
 * Verifies that the async lazy singleton pattern in ensurePdfParse() prevents
 * duplicate dynamic import() calls when multiple extractions run concurrently.
 * The key invariant: pdfParsePromise is set synchronously on the first call,
 * so concurrent callers reuse the same cached promise.
 *
 * Placed in tests/isolated/ because mock.module replaces pdf-parse globally
 * for the process, and each isolated file runs in its own Bun worker to
 * guarantee a fresh pdfParsePromise = undefined starting state.
 *
 * Note: This is a positive singleton test — it confirms concurrent calls share
 * a single import. It does not prove the singleton is *necessary* (i.e., that
 * removing it would cause duplicate imports), because that would require
 * modifying module-private state. The test's secondary value is as a smoke test
 * confirming concurrent extractions succeed without error.
 *
 * Fixes #501 — missing singleton test for ensurePdfParse().
 *
 * @module tests/isolated/pdf-extractor-concurrent-import
 */

import { mock, describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

/** Tracks how many times the mock module factory is evaluated (i.e., import() called). */
let importInvocationCount = 0;

// Mock pdf-parse BEFORE importing PdfExtractor so the dynamic import() is intercepted.
// The factory increments importInvocationCount each time it's evaluated, allowing us
// to assert that only one import() occurred despite concurrent access.
// `void` prefix satisfies ESLint's no-floating-promises rule (mock.module returns a Promise).
void mock.module("pdf-parse/lib/pdf-parse.js", () => {
  importInvocationCount++;
  return {
    default: async (
      _buffer: Buffer,
      options?: {
        pagerender?: (pageData: {
          getTextContent: () => Promise<{ items: { str: string }[] }>;
        }) => Promise<string>;
      }
    ): Promise<{
      numpages: number;
      numrender: number;
      info: Record<string, unknown>;
      metadata: unknown;
      text: string;
    }> => {
      // Simulate a single-page PDF
      if (options?.pagerender) {
        await options.pagerender({
          getTextContent: () =>
            Promise.resolve({
              items: [
                { str: "Mock" },
                { str: " " },
                { str: "PDF" },
                { str: " " },
                { str: "content" },
              ],
            }),
        });
      }
      return {
        numpages: 1,
        numrender: 1,
        info: {},
        metadata: null,
        text: "Mock PDF content",
      };
    },
  };
});

// Dynamic imports after mock setup — using await import() (matching extractor-timeout.test.ts
// pattern) instead of static import to ensure the mock factory is evaluated during this
// dynamic import, not eagerly cached by the module system. This makes importInvocationCount
// deterministic: exactly 1 after module resolution.
const { PdfExtractor } = await import("../../src/documents/extractors/PdfExtractor.js");
const { createTestPdfFiles } = await import("../fixtures/documents/pdf-fixtures.js");

let fixtureDir: string;
let pdfFilePath: string;

beforeAll(async () => {
  fixtureDir = path.join(os.tmpdir(), `pdf-concurrent-import-test-${Date.now()}`);
  await fs.mkdir(fixtureDir, { recursive: true });
  await createTestPdfFiles(fixtureDir);
  pdfFilePath = path.join(fixtureDir, "pdf", "simple.pdf");
});

afterAll(async () => {
  try {
    await fs.rm(fixtureDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

describe("PdfExtractor concurrent-import singleton", () => {
  test("concurrent extractions trigger only a single import() of pdf-parse", async () => {
    const extractor = new PdfExtractor({ extractPageInfo: true });

    // The dynamic import above loaded PdfExtractor but did NOT call ensurePdfParse()
    // (it's lazy — only invoked during extract()). Reset counter to isolate the
    // concurrent extract() calls below.
    importInvocationCount = 0;

    // Fire two concurrent extractions — both will call ensurePdfParse()
    const [result1, result2] = await Promise.all([
      extractor.extract(pdfFilePath),
      extractor.extract(pdfFilePath),
    ]);

    // Both extractions should succeed with valid results
    expect(result1).toBeDefined();
    expect(result1.content).toBeTruthy();
    expect(result1.metadata).toBeDefined();

    expect(result2).toBeDefined();
    expect(result2.content).toBeTruthy();
    expect(result2.metadata).toBeDefined();

    // With dynamic imports, ensurePdfParse() is not called until extract() runs.
    // The first concurrent call enters the `if (!pdfParsePromise)` block and sets
    // pdfParsePromise synchronously to the IIFE promise, triggering exactly one
    // factory evaluation. The second concurrent call sees pdfParsePromise already
    // set and returns the cached promise — no second factory evaluation.
    // Count must be exactly 1: one import, not two (singleton deduplication works).
    expect(importInvocationCount).toBe(1);
  });
});
