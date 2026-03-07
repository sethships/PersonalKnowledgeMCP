/**
 * Isolated tests for PdfExtractor and DocxExtractor timeout behavior.
 *
 * Uses mock.module() to inject never-resolving promises for pdf-parse and mammoth,
 * ensuring the ExtractionTimeoutError code path is exercised deterministically.
 * Placed in tests/isolated/ because mock.module replaces modules globally.
 *
 * Fixes #475 — non-deterministic timeout tests.
 *
 * @module tests/isolated/extractor-timeout
 */

import { describe, test, expect, beforeAll, afterAll, mock } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

// Mock pdf-parse to return a never-resolving promise.
// PdfExtractor uses lazy `await import("pdf-parse/lib/pdf-parse.js")` with CJS/ESM
// interop that picks `m.default` when it's a function, which matches our mock shape.
void mock.module("pdf-parse/lib/pdf-parse.js", () => ({
  default: () => new Promise(() => {}),
}));

// Mock mammoth to return never-resolving promises
void mock.module("mammoth", () => {
  return {
    default: {
      convertToHtml: () => new Promise(() => {}),
      extractRawText: () => new Promise(() => {}),
    },
  };
});

// Dynamic imports after mock setup
const { PdfExtractor } = await import("../../src/documents/extractors/PdfExtractor.js");
const { DocxExtractor } = await import("../../src/documents/extractors/DocxExtractor.js");
const { ExtractionTimeoutError } = await import("../../src/documents/errors.js");
const { createTestPdfFiles } = await import("../fixtures/documents/pdf-fixtures.js");
const { createTestDocxFiles } = await import("../fixtures/documents/docx-fixtures.js");

let fixtureDir: string;
let pdfDir: string;
let docxDir: string;

beforeAll(async () => {
  fixtureDir = path.join(os.tmpdir(), `extractor-timeout-test-${Date.now()}`);
  await fs.mkdir(fixtureDir, { recursive: true });

  await createTestPdfFiles(fixtureDir);
  await createTestDocxFiles(fixtureDir);

  pdfDir = path.join(fixtureDir, "pdf");
  docxDir = path.join(fixtureDir, "docx");
});

afterAll(async () => {
  try {
    await fs.rm(fixtureDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

describe("PdfExtractor timeout (isolated)", () => {
  test("throws ExtractionTimeoutError deterministically when pdf-parse never resolves", async () => {
    expect.assertions(4);

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
    }
  });
});

describe("DocxExtractor timeout (isolated)", () => {
  test("throws ExtractionTimeoutError deterministically when mammoth never resolves", async () => {
    expect.assertions(4);

    const extractor = new DocxExtractor({ timeoutMs: 50 });
    const filePath = path.join(docxDir, "simple.docx");

    try {
      await extractor.extract(filePath);
    } catch (error) {
      expect(error).toBeInstanceOf(ExtractionTimeoutError);
      const timeoutError = error as InstanceType<typeof ExtractionTimeoutError>;
      expect(timeoutError.code).toBe("EXTRACTION_TIMEOUT");
      expect(timeoutError.timeoutMs).toBe(50);
      expect(timeoutError.retryable).toBe(true);
    }
  });
});
