/**
 * Tests PdfExtractor per-page error resilience.
 *
 * Verifies that individual page failures in getTextContent() are caught by the
 * .catch() handler in the pagerender callback (inside parsePdfWithTimeout()),
 * recording empty content for failed pages without aborting the entire extraction.
 *
 * Uses mock.module to intercept pdf-parse before PdfExtractor's dynamic import()
 * resolves, simulating per-page failures without needing a specially crafted PDF.
 *
 * Placed in tests/isolated/ pattern (separate from extractors.test.ts) because
 * mock.module replaces pdf-parse globally for the process.
 *
 * @module tests/isolated/pdf-extractor-perpage-error
 */

import { mock, describe, test, expect, beforeAll } from "bun:test";
import * as path from "node:path";

// Mock pdf-parse BEFORE importing PdfExtractor so the dynamic import() is intercepted.
// Simulates a 3-page PDF where page 2's getTextContent() rejects.
// `void` satisfies ESLint no-floating-promises — mock.module returns a Promise we don't need to await.
void mock.module("pdf-parse/lib/pdf-parse.js", () => ({
  default: async (
    _buffer: Buffer,
    options: {
      pagerender?: (pageData: {
        getTextContent: () => Promise<{ items: { str: string }[] }>;
      }) => Promise<string>;
    }
  ): Promise<{
    numpages: number;
    numrender: number;
    info: Record<string, unknown>;
    text: string;
  }> => {
    const pages = [
      {
        // Page 1: succeeds
        getTextContent: () =>
          Promise.resolve({
            items: [{ str: "Page" }, { str: " " }, { str: "one" }],
          }),
      },
      {
        // Page 2: simulates failure
        getTextContent: () => Promise.reject(new Error("Simulated page render failure")),
      },
      {
        // Page 3: succeeds
        getTextContent: () =>
          Promise.resolve({
            items: [{ str: "Page" }, { str: " " }, { str: "three" }],
          }),
      },
    ];

    // Call pagerender for each page sequentially (matches real pdf-parse behavior)
    if (options.pagerender) {
      for (const page of pages) {
        await options.pagerender(page);
      }
    }

    return {
      numpages: 3,
      numrender: 3,
      info: {},
      text: "Page one\n\nPage three",
    };
  },
}));

// Import AFTER mock.module so the mock is active when PdfExtractor's dynamic import() resolves
import { PdfExtractor } from "../../src/documents/extractors/PdfExtractor.js";
import { createTestPdfFiles } from "../fixtures/documents/pdf-fixtures.js";

const FIXTURES_DIR = path.join(__dirname, "../fixtures/documents");
const PDF_DIR = path.join(FIXTURES_DIR, "pdf");

beforeAll(async () => {
  // Ensure fixture files exist (PdfExtractor validates file via fs.stat)
  await createTestPdfFiles(FIXTURES_DIR);
});

describe("PdfExtractor per-page error resilience", () => {
  test("gracefully handles individual page getTextContent() rejection", async () => {
    const extractor = new PdfExtractor({ extractPageInfo: true });

    // Use the multi-page fixture so fs.stat and readFile succeed;
    // the mock intercepts the actual pdf-parse call.
    const result = await extractor.extract(path.join(PDF_DIR, "multi-page.pdf"));

    // Extraction should succeed overall
    expect(result).toBeDefined();
    expect(result.pages).toBeDefined();
    expect(result.pages).toHaveLength(3);

    const pages = result.pages as NonNullable<typeof result.pages>;

    // Page 1: successful extraction
    const page1 = pages[0] as (typeof pages)[number];
    expect(page1.pageNumber).toBe(1);
    expect(page1.content).not.toBe("");
    expect(page1.wordCount).toBeGreaterThan(0);

    // Page 2: failed — should have empty content from .catch() handler
    const page2 = pages[1] as (typeof pages)[number];
    expect(page2.pageNumber).toBe(2);
    expect(page2.content).toBe("");
    expect(page2.wordCount).toBe(0);

    // Page 3: successful extraction
    const page3 = pages[2] as (typeof pages)[number];
    expect(page3.pageNumber).toBe(3);
    expect(page3.content).not.toBe("");
    expect(page3.wordCount).toBeGreaterThan(0);
  });
});
