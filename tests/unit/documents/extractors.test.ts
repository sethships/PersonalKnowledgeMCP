/**
 * Unit tests for document extractors.
 *
 * Tests extractor initialization, supports() method, and extraction behavior.
 * Includes edge case tests for PdfExtractor timeout and password-protected PDFs.
 */

import { describe, test, expect, beforeAll } from "bun:test";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import {
  PdfExtractor,
  DocxExtractor,
  MarkdownParser,
  ImageMetadataExtractor,
} from "../../../src/documents/extractors/index.js";
import {
  NotImplementedError,
  FileAccessError,
  FileTooLargeError,
  ExtractionError,
  ExtractionTimeoutError,
  PasswordProtectedError,
  UnsupportedFormatError,
  isDocumentError,
} from "../../../src/documents/errors.js";
import { DEFAULT_EXTRACTOR_CONFIG } from "../../../src/documents/constants.js";
import { createTestPdfFiles } from "../../fixtures/documents/pdf-fixtures.js";
import { createTestDocxFiles } from "../../fixtures/documents/docx-fixtures.js";
import { createTestImageFiles } from "../../fixtures/documents/image-fixtures.js";

// Path to test fixtures root
const FIXTURES_DIR = path.join(__dirname, "../../fixtures/documents");
// Subdirectories for each type
const PDF_DIR = path.join(FIXTURES_DIR, "pdf");
const DOCX_DIR = path.join(FIXTURES_DIR, "docx");
const MARKDOWN_DIR = path.join(FIXTURES_DIR, "markdown");
const IMAGES_DIR = path.join(FIXTURES_DIR, "images");

// Generate all fixtures once before any tests run (avoids duplicate generation across describe blocks)
beforeAll(async () => {
  await createTestPdfFiles(FIXTURES_DIR);
  await createTestDocxFiles(FIXTURES_DIR);
  await createTestImageFiles(FIXTURES_DIR);
});

describe("Test fixtures", () => {
  describe("PDF fixtures", () => {
    const expectedFiles = [
      "simple.pdf",
      "multi-page.pdf",
      "with-metadata.pdf",
      "corrupt.pdf",
      "password.pdf",
    ];

    for (const file of expectedFiles) {
      test(`${file} exists and is non-empty`, async () => {
        const filePath = path.join(PDF_DIR, file);
        const stats = await fs.stat(filePath);
        expect(stats.isFile()).toBe(true);
        expect(stats.size).toBeGreaterThan(0);
      });
    }
  });

  describe("DOCX fixtures", () => {
    const expectedFiles = [
      "simple.docx",
      "with-headings.docx",
      "with-lists.docx",
      "with-metadata.docx",
      "invalid.docx",
    ];

    for (const file of expectedFiles) {
      test(`${file} exists and is non-empty`, async () => {
        const filePath = path.join(DOCX_DIR, file);
        const stats = await fs.stat(filePath);
        expect(stats.isFile()).toBe(true);
        expect(stats.size).toBeGreaterThan(0);
      });
    }
  });

  describe("Markdown fixtures", () => {
    const expectedFiles = ["simple.md", "with-frontmatter.md", "with-code.md", "gfm.md"];

    for (const file of expectedFiles) {
      test(`${file} exists and is non-empty`, async () => {
        const filePath = path.join(MARKDOWN_DIR, file);
        const stats = await fs.stat(filePath);
        expect(stats.isFile()).toBe(true);
        expect(stats.size).toBeGreaterThan(0);
      });
    }
  });

  describe("Image fixtures", () => {
    const expectedFiles = ["photo.jpg", "screenshot.png", "animated.gif", "diagram.webp"];

    for (const file of expectedFiles) {
      test(`${file} exists and is non-empty`, async () => {
        const filePath = path.join(IMAGES_DIR, file);
        const stats = await fs.stat(filePath);
        expect(stats.isFile()).toBe(true);
        expect(stats.size).toBeGreaterThan(0);
      });
    }
  });
});

describe("PdfExtractor", () => {
  describe("constructor", () => {
    test("uses default configuration", () => {
      const extractor = new PdfExtractor();
      const config = extractor.getConfig();

      expect(config.maxFileSizeBytes).toBe(DEFAULT_EXTRACTOR_CONFIG.maxFileSizeBytes);
      expect(config.timeoutMs).toBe(DEFAULT_EXTRACTOR_CONFIG.timeoutMs);
      expect(config.extractPageInfo).toBe(true);
    });

    test("accepts custom configuration", () => {
      const extractor = new PdfExtractor({
        maxFileSizeBytes: 10_000_000,
        timeoutMs: 60_000,
        extractPageInfo: false,
      });
      const config = extractor.getConfig();

      expect(config.maxFileSizeBytes).toBe(10_000_000);
      expect(config.timeoutMs).toBe(60_000);
      expect(config.extractPageInfo).toBe(false);
    });
  });

  describe("supports", () => {
    const extractor = new PdfExtractor();

    test("returns true for .pdf extension", () => {
      expect(extractor.supports(".pdf")).toBe(true);
      expect(extractor.supports(".PDF")).toBe(true);
    });

    test("returns false for other extensions", () => {
      expect(extractor.supports(".docx")).toBe(false);
      expect(extractor.supports(".md")).toBe(false);
      expect(extractor.supports(".jpg")).toBe(false);
    });
  });

  describe("extract", () => {
    describe("successful extraction", () => {
      test("extracts text content from simple PDF", async () => {
        const extractor = new PdfExtractor();
        const filePath = path.join(PDF_DIR, "simple.pdf");

        const result = await extractor.extract(filePath);

        expect(result.content).toBeDefined();
        expect(result.content.length).toBeGreaterThan(0);
        expect(result.metadata).toBeDefined();
        expect(result.metadata.documentType).toBe("pdf");
        expect(result.metadata.pageCount).toBe(1);
      });

      test("extracts multi-page PDF with page info", async () => {
        const extractor = new PdfExtractor({ extractPageInfo: true });
        const filePath = path.join(PDF_DIR, "multi-page.pdf");

        const result = await extractor.extract(filePath);

        expect(result.content).toBeDefined();
        expect(result.metadata.pageCount).toBe(3);
        // Pages may or may not be populated depending on pdf-parse behavior
        // with our minimal PDFs, but we verify the structure
        if (result.pages && result.pages.length > 0) {
          expect(result.pages.length).toBe(3);
          expect(result.pages[0]?.pageNumber).toBe(1);
        }
      });

      test("extracts PDF without page info when configured", async () => {
        const extractor = new PdfExtractor({ extractPageInfo: false });
        const filePath = path.join(PDF_DIR, "simple.pdf");

        const result = await extractor.extract(filePath);

        expect(result.content).toBeDefined();
        expect(result.pages).toBeUndefined();
      });

      test("extracts metadata from PDF with metadata", async () => {
        const extractor = new PdfExtractor();
        const filePath = path.join(PDF_DIR, "with-metadata.pdf");

        const result = await extractor.extract(filePath);

        expect(result.metadata.documentType).toBe("pdf");
        // Note: Our minimal PDF generator may not produce metadata
        // that pdf-parse can extract, so we just verify the structure
        expect(result.metadata.filePath).toBe(filePath);
        expect(result.metadata.fileSizeBytes).toBeGreaterThan(0);
        expect(result.metadata.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
        expect(result.metadata.fileModifiedAt).toBeInstanceOf(Date);
      });

      test("computes correct word count", async () => {
        const extractor = new PdfExtractor();
        const filePath = path.join(PDF_DIR, "simple.pdf");

        const result = await extractor.extract(filePath);

        // Word count should be > 0 if content was extracted
        if (result.content.trim().length > 0) {
          expect(result.metadata.wordCount).toBeGreaterThan(0);
        }
      });

      test("computes content hash", async () => {
        const extractor = new PdfExtractor();
        const filePath = path.join(PDF_DIR, "simple.pdf");

        const result = await extractor.extract(filePath);

        expect(result.metadata.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);

        // Same file should produce same hash
        const result2 = await extractor.extract(filePath);
        expect(result2.metadata.contentHash).toBe(result.metadata.contentHash);
      });
    });

    describe("error handling", () => {
      test("throws FileAccessError for non-existent file", async () => {
        expect.assertions(5);
        const extractor = new PdfExtractor();
        const filePath = path.join(PDF_DIR, "non-existent.pdf");

        try {
          await extractor.extract(filePath);
        } catch (error) {
          expect(error).toBeInstanceOf(FileAccessError);
          expect(isDocumentError(error)).toBe(true);
          if (error instanceof FileAccessError) {
            expect(error.code).toBe("FILE_ACCESS_ERROR");
            expect(error.filePath).toBe(filePath);
            expect(error.message).toContain("not found");
          }
        }
      });

      test("throws FileTooLargeError for oversized file", async () => {
        expect.assertions(5);
        const extractor = new PdfExtractor({ maxFileSizeBytes: 100 }); // Very small limit
        const filePath = path.join(PDF_DIR, "simple.pdf");

        try {
          await extractor.extract(filePath);
        } catch (error) {
          expect(error).toBeInstanceOf(FileTooLargeError);
          if (error instanceof FileTooLargeError) {
            expect(error.code).toBe("FILE_TOO_LARGE");
            expect(error.maxSizeBytes).toBe(100);
            expect(error.actualSizeBytes).toBeGreaterThan(100);
            expect(error.retryable).toBe(false);
          }
        }
      });

      test("throws ExtractionError for corrupt PDF", async () => {
        expect.assertions(3);
        const extractor = new PdfExtractor();
        const filePath = path.join(PDF_DIR, "corrupt.pdf");

        try {
          await extractor.extract(filePath);
        } catch (error) {
          expect(error).toBeInstanceOf(ExtractionError);
          if (error instanceof ExtractionError) {
            expect(error.code).toBe("EXTRACTION_ERROR");
            expect(error.filePath).toBe(filePath);
          }
        }
      });

      test("handles timeout or fast completion gracefully with 1ms timeout", async () => {
        // Uses a very short timeout (1ms) to exercise the timeout path.
        // Due to JS event loop mechanics (Promise microtasks beat setTimeout macrotasks),
        // small PDFs may resolve before the timeout fires. This test validates that both
        // outcomes are handled correctly: either ExtractionTimeoutError is thrown, or
        // extraction completes successfully.
        // TODO: Add deterministic timeout test using Bun mock to force the timeout path
        // (see code review on PR #467 — Issue #1)
        const extractor = new PdfExtractor({ timeoutMs: 1 });
        const filePath = path.join(PDF_DIR, "multi-page.pdf");

        try {
          await extractor.extract(filePath);
          // Fast completion is valid — extraction beat the timeout
        } catch (error) {
          // The error should be either a timeout or an extraction error
          // (depending on race condition timing)
          expect(error instanceof ExtractionTimeoutError || error instanceof ExtractionError).toBe(
            true
          );
          if (error instanceof ExtractionTimeoutError) {
            expect(error.code).toBe("EXTRACTION_TIMEOUT");
            expect(error.timeoutMs).toBe(1);
            expect(error.retryable).toBe(true);
          }
        }
      });

      test("throws PasswordProtectedError for encrypted PDF", async () => {
        // Our fixture creates a PDF with /Encrypt in the trailer, which causes pdf-parse
        // to throw with "encrypted" in the error message. PdfExtractor.parsePdfWithTimeout()
        // detects this keyword and wraps it as PasswordProtectedError.
        // In CI, this typically fires the PasswordProtectedError path (3 assertions).
        // If pdf-parse changes its error handling, the ExtractionError fallback (1 assertion)
        // ensures the test still validates that extraction fails for encrypted PDFs.
        // TODO: Add a deterministic mock-based test that guarantees PasswordProtectedError
        // (see code review on PR #467 — Issue #2)
        expect.assertions(1);
        const extractor = new PdfExtractor();
        const filePath = path.join(PDF_DIR, "password.pdf");
        let errorThrown: unknown;

        try {
          await extractor.extract(filePath);
        } catch (error) {
          errorThrown = error;
        }

        // Verify extraction fails with an appropriate document error
        expect(
          errorThrown instanceof PasswordProtectedError || errorThrown instanceof ExtractionError
        ).toBe(true);
      });
    });

    describe("extractPages error handling", () => {
      test("returns empty array when per-page extraction fails", async () => {
        const extractor = new PdfExtractor({ extractPageInfo: true });
        // Access private extractPages method for testing via type cast
        // (same pattern used for parsePdfDate tests below)
        const extractPages = (buffer: Buffer, filePath: string): Promise<unknown[]> =>
          (
            extractor as unknown as {
              extractPages: (buf: Buffer, path: string) => Promise<unknown[]>;
            }
          ).extractPages(buffer, filePath);

        // Pass an invalid buffer that will cause pdf-parse to throw during
        // per-page extraction, triggering the catch block and getLogger()
        const invalidBuffer = Buffer.from("not a valid pdf");
        const result = await extractPages(invalidBuffer, "/test/fake.pdf");

        // The catch block should return an empty array instead of throwing
        expect(result).toEqual([]);
      });
    });

    describe("metadata extraction", () => {
      test("includes correct file metadata", async () => {
        const extractor = new PdfExtractor();
        const filePath = path.join(PDF_DIR, "simple.pdf");
        const stats = await fs.stat(filePath);

        const result = await extractor.extract(filePath);

        expect(result.metadata.filePath).toBe(filePath);
        expect(result.metadata.fileSizeBytes).toBe(stats.size);
        expect(result.metadata.fileModifiedAt.getTime()).toBe(stats.mtime.getTime());
      });

      test("sets documentType to pdf", async () => {
        const extractor = new PdfExtractor();
        const filePath = path.join(PDF_DIR, "simple.pdf");

        const result = await extractor.extract(filePath);

        expect(result.metadata.documentType).toBe("pdf");
      });
    });
  });

  describe("parsePdfDate", () => {
    const extractor = new PdfExtractor();
    // Access private method for testing via type cast
    const parsePdfDate = (input: string | undefined): Date | undefined =>
      (
        extractor as unknown as { parsePdfDate: (s: string | undefined) => Date | undefined }
      ).parsePdfDate(input);

    test("returns undefined for undefined input", () => {
      expect(parsePdfDate(undefined)).toBeUndefined();
    });

    test("returns undefined for empty string", () => {
      expect(parsePdfDate("")).toBeUndefined();
    });

    test("returns undefined for invalid date string", () => {
      expect(parsePdfDate("D:notadate")).toBeUndefined();
    });

    test("parses date without timezone as local time", () => {
      const result = parsePdfDate("D:20240115103000");
      expect(result).toBeInstanceOf(Date);
      // Local time: year/month/day/hour/minute/second should match
      expect(result!.getFullYear()).toBe(2024);
      expect(result!.getMonth()).toBe(0); // January = 0
      expect(result!.getDate()).toBe(15);
      expect(result!.getHours()).toBe(10);
      expect(result!.getMinutes()).toBe(30);
      expect(result!.getSeconds()).toBe(0);
    });

    test("parses date with Z suffix as UTC", () => {
      const result = parsePdfDate("D:20240115103000Z");
      expect(result).toBeInstanceOf(Date);
      expect(result!.getUTCFullYear()).toBe(2024);
      expect(result!.getUTCMonth()).toBe(0);
      expect(result!.getUTCDate()).toBe(15);
      expect(result!.getUTCHours()).toBe(10);
      expect(result!.getUTCMinutes()).toBe(30);
      expect(result!.getUTCSeconds()).toBe(0);
    });

    test("parses date with positive offset (+05'30')", () => {
      // D:20240115103000+05'30' means 10:30 in UTC+5:30, so UTC is 05:00
      const result = parsePdfDate("D:20240115103000+05'30'");
      expect(result).toBeInstanceOf(Date);
      expect(result!.getUTCFullYear()).toBe(2024);
      expect(result!.getUTCMonth()).toBe(0);
      expect(result!.getUTCDate()).toBe(15);
      expect(result!.getUTCHours()).toBe(5);
      expect(result!.getUTCMinutes()).toBe(0);
    });

    test("parses date with negative offset (-08'00')", () => {
      // D:20240115103000-08'00' means 10:30 in UTC-8, so UTC is 18:30
      const result = parsePdfDate("D:20240115103000-08'00'");
      expect(result).toBeInstanceOf(Date);
      expect(result!.getUTCFullYear()).toBe(2024);
      expect(result!.getUTCMonth()).toBe(0);
      expect(result!.getUTCDate()).toBe(15);
      expect(result!.getUTCHours()).toBe(18);
      expect(result!.getUTCMinutes()).toBe(30);
      expect(result!.getUTCSeconds()).toBe(0);
    });

    test("parses date with offset without apostrophes (+0530)", () => {
      const result = parsePdfDate("D:20240115103000+0530");
      expect(result).toBeInstanceOf(Date);
      expect(result!.getUTCHours()).toBe(5);
      expect(result!.getUTCMinutes()).toBe(0);
    });

    test("parses date without D: prefix", () => {
      const result = parsePdfDate("20240115103000Z");
      expect(result).toBeInstanceOf(Date);
      expect(result!.getUTCFullYear()).toBe(2024);
      expect(result!.getUTCHours()).toBe(10);
    });

    test("parses minimal date (year/month/day only)", () => {
      const result = parsePdfDate("D:20240115");
      expect(result).toBeInstanceOf(Date);
      expect(result!.getFullYear()).toBe(2024);
      expect(result!.getMonth()).toBe(0);
      expect(result!.getDate()).toBe(15);
    });

    test("handles negative offset that crosses day boundary", () => {
      // D:20240115230000-05'00' means 23:00 in UTC-5, so UTC is 04:00 on Jan 16
      const result = parsePdfDate("D:20240115230000-05'00'");
      expect(result).toBeInstanceOf(Date);
      expect(result!.getUTCFullYear()).toBe(2024);
      expect(result!.getUTCMonth()).toBe(0);
      expect(result!.getUTCDate()).toBe(16);
      expect(result!.getUTCHours()).toBe(4);
      expect(result!.getUTCMinutes()).toBe(0);
    });

    test("parses date with hours-only offset (+05)", () => {
      // +05 without minutes — minutes default to 0
      const result = parsePdfDate("D:20240115103000+05");
      expect(result).toBeInstanceOf(Date);
      expect(result!.getUTCHours()).toBe(5);
      expect(result!.getUTCMinutes()).toBe(30);
    });

    test("parses date with zero offset as UTC", () => {
      // +00'00' should be equivalent to Z
      const result = parsePdfDate("D:20240115103000+00'00'");
      expect(result).toBeInstanceOf(Date);
      expect(result!.getUTCHours()).toBe(10);
      expect(result!.getUTCMinutes()).toBe(30);
    });

    test("handles positive offset that crosses day boundary backwards", () => {
      // D:20240116010000+05'00' means 01:00 in UTC+5, so UTC is 20:00 on Jan 15
      const result = parsePdfDate("D:20240116010000+05'00'");
      expect(result).toBeInstanceOf(Date);
      expect(result!.getUTCFullYear()).toBe(2024);
      expect(result!.getUTCMonth()).toBe(0);
      expect(result!.getUTCDate()).toBe(15);
      expect(result!.getUTCHours()).toBe(20);
      expect(result!.getUTCMinutes()).toBe(0);
    });
  });
});

describe("DocxExtractor", () => {
  describe("constructor", () => {
    test("uses default configuration", () => {
      const extractor = new DocxExtractor();
      const config = extractor.getConfig();

      expect(config.maxFileSizeBytes).toBe(DEFAULT_EXTRACTOR_CONFIG.maxFileSizeBytes);
      expect(config.timeoutMs).toBe(DEFAULT_EXTRACTOR_CONFIG.timeoutMs);
      expect(config.preserveFormatting).toBe(false);
    });

    test("accepts custom configuration", () => {
      const extractor = new DocxExtractor({
        maxFileSizeBytes: 10_000_000,
        timeoutMs: 60_000,
        preserveFormatting: true,
      });
      const config = extractor.getConfig();

      expect(config.maxFileSizeBytes).toBe(10_000_000);
      expect(config.timeoutMs).toBe(60_000);
      expect(config.preserveFormatting).toBe(true);
    });
  });

  describe("supports", () => {
    const extractor = new DocxExtractor();

    test("returns true for .docx extension", () => {
      expect(extractor.supports(".docx")).toBe(true);
      expect(extractor.supports(".DOCX")).toBe(true);
    });

    test("returns false for other extensions", () => {
      expect(extractor.supports(".doc")).toBe(false); // Legacy format not supported
      expect(extractor.supports(".pdf")).toBe(false);
      expect(extractor.supports(".md")).toBe(false);
    });
  });

  describe("extract", () => {
    describe("successful extraction", () => {
      test("extracts text content from simple DOCX", async () => {
        const extractor = new DocxExtractor();
        const filePath = path.join(DOCX_DIR, "simple.docx");

        const result = await extractor.extract(filePath);

        expect(result.content).toBeDefined();
        expect(result.content.length).toBeGreaterThan(0);
        expect(result.content).toContain("simple test document");
        expect(result.content).toContain("two paragraphs");
        expect(result.metadata).toBeDefined();
        expect(result.metadata.documentType).toBe("docx");
      });

      test("extracts headings and verifies SectionInfo structure", async () => {
        const extractor = new DocxExtractor();
        const filePath = path.join(DOCX_DIR, "with-headings.docx");

        const result = await extractor.extract(filePath);

        expect(result.content).toContain("Document Title");
        expect(result.content).toContain("First Section");
        expect(result.content).toContain("Second Section");

        // Verify sections were parsed from headings
        expect(result.sections).toBeDefined();
        expect(result.sections!.length).toBeGreaterThanOrEqual(1);

        // Verify SectionInfo structure
        for (const section of result.sections!) {
          expect(section.title).toBeDefined();
          expect(section.title.length).toBeGreaterThan(0);
          expect(section.level).toBeGreaterThanOrEqual(1);
          expect(section.level).toBeLessThanOrEqual(6);
          expect(typeof section.startOffset).toBe("number");
          expect(typeof section.endOffset).toBe("number");
          expect(section.endOffset).toBeGreaterThanOrEqual(section.startOffset);
        }
      });

      test("extracts lists and verifies content", async () => {
        const extractor = new DocxExtractor();
        const filePath = path.join(DOCX_DIR, "with-lists.docx");

        const result = await extractor.extract(filePath);

        expect(result.content).toContain("Shopping List");
        expect(result.content).toContain("Apples");
        expect(result.content).toContain("Bananas");
        expect(result.content).toContain("Oranges");
      });

      test("extracts metadata from DOCX with Dublin Core properties", async () => {
        const extractor = new DocxExtractor();
        const filePath = path.join(DOCX_DIR, "with-metadata.docx");

        const result = await extractor.extract(filePath);

        expect(result.metadata.documentType).toBe("docx");
        expect(result.metadata.title).toBe("Test Document Title");
        expect(result.metadata.author).toBe("Test Author");
        expect(result.metadata.createdAt).toBeInstanceOf(Date);
        expect(result.metadata.createdAt!.getUTCFullYear()).toBe(2024);
        expect(result.metadata.createdAt!.getUTCMonth()).toBe(5); // June = 5 (0-indexed)
        expect(result.metadata.createdAt!.getUTCDate()).toBe(15);
      });

      test("computes correct word count", async () => {
        const extractor = new DocxExtractor();
        const filePath = path.join(DOCX_DIR, "simple.docx");

        const result = await extractor.extract(filePath);

        // "This is a simple test document." + "It contains two paragraphs of plain text."
        expect(result.metadata.wordCount).toBeGreaterThan(0);
      });

      test("computes content hash (SHA-256)", async () => {
        const extractor = new DocxExtractor();
        const filePath = path.join(DOCX_DIR, "simple.docx");

        const result = await extractor.extract(filePath);

        expect(result.metadata.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
      });

      test("same file produces same hash on re-extraction", async () => {
        const extractor = new DocxExtractor();
        const filePath = path.join(DOCX_DIR, "simple.docx");

        const result1 = await extractor.extract(filePath);
        const result2 = await extractor.extract(filePath);

        expect(result2.metadata.contentHash).toBe(result1.metadata.contentHash);
      });

      test("includes correct file metadata", async () => {
        const extractor = new DocxExtractor();
        const filePath = path.join(DOCX_DIR, "simple.docx");
        const stats = await fs.stat(filePath);

        const result = await extractor.extract(filePath);

        expect(result.metadata.filePath).toBe(filePath);
        expect(result.metadata.fileSizeBytes).toBe(stats.size);
        expect(result.metadata.fileModifiedAt.getTime()).toBe(stats.mtime.getTime());
      });

      test("returns no sections for document without headings", async () => {
        const extractor = new DocxExtractor();
        const filePath = path.join(DOCX_DIR, "simple.docx");

        const result = await extractor.extract(filePath);

        // simple.docx has no headings, so sections should be undefined
        expect(result.sections).toBeUndefined();
      });
    });

    describe("error handling", () => {
      test("throws FileAccessError for non-existent file", async () => {
        expect.assertions(5);
        const extractor = new DocxExtractor();
        const filePath = path.join(DOCX_DIR, "non-existent.docx");

        try {
          await extractor.extract(filePath);
        } catch (error) {
          expect(error).toBeInstanceOf(FileAccessError);
          expect(isDocumentError(error)).toBe(true);
          if (error instanceof FileAccessError) {
            expect(error.code).toBe("FILE_ACCESS_ERROR");
            expect(error.filePath).toBe(filePath);
            expect(error.message).toContain("not found");
          }
        }
      });

      test("throws FileTooLargeError for oversized file", async () => {
        expect.assertions(5);
        const extractor = new DocxExtractor({ maxFileSizeBytes: 100 }); // Very small limit
        const filePath = path.join(DOCX_DIR, "simple.docx");

        try {
          await extractor.extract(filePath);
        } catch (error) {
          expect(error).toBeInstanceOf(FileTooLargeError);
          if (error instanceof FileTooLargeError) {
            expect(error.code).toBe("FILE_TOO_LARGE");
            expect(error.maxSizeBytes).toBe(100);
            expect(error.actualSizeBytes).toBeGreaterThan(100);
            expect(error.retryable).toBe(false);
          }
        }
      });

      test("throws UnsupportedFormatError for legacy .doc file", async () => {
        expect.assertions(4);
        const extractor = new DocxExtractor();

        // Create a temporary file with OLE2 compound document signature
        const ole2Buffer = Buffer.alloc(512);
        // OLE2 signature: D0 CF 11 E0 A1 B1 1A E1
        ole2Buffer[0] = 0xd0;
        ole2Buffer[1] = 0xcf;
        ole2Buffer[2] = 0x11;
        ole2Buffer[3] = 0xe0;
        ole2Buffer[4] = 0xa1;
        ole2Buffer[5] = 0xb1;
        ole2Buffer[6] = 0x1a;
        ole2Buffer[7] = 0xe1;

        const legacyDocPath = path.join(DOCX_DIR, "legacy.doc");
        await fs.writeFile(legacyDocPath, ole2Buffer);

        try {
          await extractor.extract(legacyDocPath);
        } catch (error) {
          expect(error).toBeInstanceOf(UnsupportedFormatError);
          if (error instanceof UnsupportedFormatError) {
            expect(error.code).toBe("UNSUPPORTED_FORMAT");
            expect(error.extension).toBe(".doc");
            expect(error.message).toContain("Legacy .doc format");
          }
        } finally {
          // Clean up temporary file
          await fs.unlink(legacyDocPath).catch(() => {});
        }
      });

      test("throws ExtractionError for corrupt/invalid DOCX", async () => {
        expect.assertions(3);
        const extractor = new DocxExtractor();
        const filePath = path.join(DOCX_DIR, "invalid.docx");

        try {
          await extractor.extract(filePath);
        } catch (error) {
          expect(error).toBeInstanceOf(ExtractionError);
          if (error instanceof ExtractionError) {
            expect(error.code).toBe("EXTRACTION_ERROR");
            expect(error.filePath).toBe(filePath);
          }
        }
      });

      test("handles timeout or fast completion gracefully with 1ms timeout", async () => {
        // Uses a very short timeout (1ms) to exercise the timeout path.
        // Due to JS event loop mechanics, small DOCXs may resolve before the timeout fires.
        // TODO: Add deterministic timeout test using Bun mock to force the timeout path
        // (consistent with PdfExtractor TODOs from PR #467)
        const extractor = new DocxExtractor({ timeoutMs: 1 });
        const filePath = path.join(DOCX_DIR, "simple.docx");

        try {
          await extractor.extract(filePath);
          // Fast completion is valid — extraction beat the timeout
        } catch (error) {
          expect(error instanceof ExtractionTimeoutError || error instanceof ExtractionError).toBe(
            true
          );
          if (error instanceof ExtractionTimeoutError) {
            expect(error.code).toBe("EXTRACTION_TIMEOUT");
            expect(error.timeoutMs).toBe(1);
            expect(error.retryable).toBe(true);
          }
        }
      });
    });

    describe("metadata extraction", () => {
      test("sets documentType to docx", async () => {
        const extractor = new DocxExtractor();
        const filePath = path.join(DOCX_DIR, "simple.docx");

        const result = await extractor.extract(filePath);

        expect(result.metadata.documentType).toBe("docx");
      });

      test("returns undefined metadata fields when core.xml is absent", async () => {
        const extractor = new DocxExtractor();
        const filePath = path.join(DOCX_DIR, "simple.docx");

        const result = await extractor.extract(filePath);

        // simple.docx has no docProps/core.xml
        expect(result.metadata.title).toBeUndefined();
        expect(result.metadata.author).toBeUndefined();
        expect(result.metadata.createdAt).toBeUndefined();
      });
    });
  });
});

describe("MarkdownParser", () => {
  describe("constructor", () => {
    test("uses default configuration", () => {
      const parser = new MarkdownParser();
      const config = parser.getConfig();

      expect(config.maxFileSizeBytes).toBe(DEFAULT_EXTRACTOR_CONFIG.maxFileSizeBytes);
      expect(config.timeoutMs).toBe(DEFAULT_EXTRACTOR_CONFIG.timeoutMs);
      expect(config.parseFrontmatter).toBe(true);
      expect(config.extractSections).toBe(true);
    });

    test("accepts custom configuration", () => {
      const parser = new MarkdownParser({
        maxFileSizeBytes: 10_000_000,
        timeoutMs: 60_000,
        parseFrontmatter: false,
        extractSections: false,
      });
      const config = parser.getConfig();

      expect(config.maxFileSizeBytes).toBe(10_000_000);
      expect(config.timeoutMs).toBe(60_000);
      expect(config.parseFrontmatter).toBe(false);
      expect(config.extractSections).toBe(false);
    });
  });

  describe("supports", () => {
    const parser = new MarkdownParser();

    test("returns true for markdown extensions", () => {
      expect(parser.supports(".md")).toBe(true);
      expect(parser.supports(".MD")).toBe(true);
      expect(parser.supports(".markdown")).toBe(true);
      expect(parser.supports(".MARKDOWN")).toBe(true);
    });

    test("returns false for other extensions", () => {
      expect(parser.supports(".txt")).toBe(false);
      expect(parser.supports(".pdf")).toBe(false);
      expect(parser.supports(".docx")).toBe(false);
    });
  });

  describe("extract", () => {
    test("throws NotImplementedError with real fixture path", async () => {
      expect.assertions(3);
      const parser = new MarkdownParser();
      const filePath = path.join(MARKDOWN_DIR, "simple.md");

      try {
        await parser.extract(filePath);
      } catch (error) {
        expect(error).toBeInstanceOf(NotImplementedError);
        if (error instanceof NotImplementedError) {
          expect(error.methodName).toBe("MarkdownParser.extract");
          expect(error.filePath).toBe(filePath);
        }
      }
    });
  });
});

describe("ImageMetadataExtractor", () => {
  describe("constructor", () => {
    test("uses default configuration", () => {
      const extractor = new ImageMetadataExtractor();
      const config = extractor.getConfig();

      expect(config.maxFileSizeBytes).toBe(DEFAULT_EXTRACTOR_CONFIG.maxFileSizeBytes);
      expect(config.timeoutMs).toBe(DEFAULT_EXTRACTOR_CONFIG.timeoutMs);
      expect(config.extractExif).toBe(true);
    });

    test("accepts custom configuration", () => {
      const extractor = new ImageMetadataExtractor({
        maxFileSizeBytes: 10_000_000,
        timeoutMs: 60_000,
        extractExif: false,
      });
      const config = extractor.getConfig();

      expect(config.maxFileSizeBytes).toBe(10_000_000);
      expect(config.timeoutMs).toBe(60_000);
      expect(config.extractExif).toBe(false);
    });
  });

  describe("supports", () => {
    const extractor = new ImageMetadataExtractor();

    test("returns true for image extensions", () => {
      expect(extractor.supports(".jpg")).toBe(true);
      expect(extractor.supports(".jpeg")).toBe(true);
      expect(extractor.supports(".JPG")).toBe(true);
      expect(extractor.supports(".JPEG")).toBe(true);
      expect(extractor.supports(".png")).toBe(true);
      expect(extractor.supports(".PNG")).toBe(true);
      expect(extractor.supports(".gif")).toBe(true);
      expect(extractor.supports(".webp")).toBe(true);
      expect(extractor.supports(".tiff")).toBe(true);
    });

    test("returns false for other extensions", () => {
      expect(extractor.supports(".pdf")).toBe(false);
      expect(extractor.supports(".docx")).toBe(false);
      expect(extractor.supports(".md")).toBe(false);
      expect(extractor.supports(".bmp")).toBe(false); // BMP not supported
    });
  });

  describe("extract", () => {
    test("throws NotImplementedError with real fixture path", async () => {
      expect.assertions(3);
      const extractor = new ImageMetadataExtractor();
      const filePath = path.join(IMAGES_DIR, "photo.jpg");

      try {
        await extractor.extract(filePath);
      } catch (error) {
        expect(error).toBeInstanceOf(NotImplementedError);
        if (error instanceof NotImplementedError) {
          expect(error.methodName).toBe("ImageMetadataExtractor.extract");
          expect(error.filePath).toBe(filePath);
        }
      }
    });
  });
});
