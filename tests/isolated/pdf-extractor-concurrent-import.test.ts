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
      metadata: null;
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

// Import AFTER mock.module so the mock is active when PdfExtractor's dynamic import() resolves
import { PdfExtractor } from "../../src/documents/extractors/PdfExtractor.js";
import { createTestPdfFiles } from "../fixtures/documents/pdf-fixtures.js";

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

    // Reset counter before the concurrent calls (mock.module factory may have
    // been evaluated during module-level import resolution above)
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

    // The singleton should have prevented a second import() invocation.
    // importInvocationCount may be 0 (if the promise was already cached from
    // the static import resolution) or 1 (first concurrent call triggered it).
    // It must NEVER be 2, which would mean the singleton failed.
    expect(importInvocationCount).toBeLessThanOrEqual(1);
  });
});
