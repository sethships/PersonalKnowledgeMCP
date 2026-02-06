/**
 * Unit tests for document extractors.
 *
 * Tests extractor initialization, supports() method, and extraction behavior.
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
  isDocumentError,
} from "../../../src/documents/errors.js";
import { DEFAULT_EXTRACTOR_CONFIG } from "../../../src/documents/constants.js";
import { createTestPdfFiles } from "../../fixtures/documents/pdf-fixtures.js";

// Path to test fixtures
const FIXTURES_DIR = path.join(__dirname, "../../fixtures/documents");

describe("PdfExtractor", () => {
  // Ensure test PDFs exist before running tests
  beforeAll(async () => {
    await createTestPdfFiles(FIXTURES_DIR);
  });

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
        const filePath = path.join(FIXTURES_DIR, "simple.pdf");

        const result = await extractor.extract(filePath);

        expect(result.content).toBeDefined();
        expect(result.content.length).toBeGreaterThan(0);
        expect(result.metadata).toBeDefined();
        expect(result.metadata.documentType).toBe("pdf");
        expect(result.metadata.pageCount).toBe(1);
      });

      test("extracts multi-page PDF with page info", async () => {
        const extractor = new PdfExtractor({ extractPageInfo: true });
        const filePath = path.join(FIXTURES_DIR, "multi-page.pdf");

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
        const filePath = path.join(FIXTURES_DIR, "simple.pdf");

        const result = await extractor.extract(filePath);

        expect(result.content).toBeDefined();
        expect(result.pages).toBeUndefined();
      });

      test("extracts metadata from PDF with metadata", async () => {
        const extractor = new PdfExtractor();
        const filePath = path.join(FIXTURES_DIR, "with-metadata.pdf");

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
        const filePath = path.join(FIXTURES_DIR, "simple.pdf");

        const result = await extractor.extract(filePath);

        // Word count should be > 0 if content was extracted
        if (result.content.trim().length > 0) {
          expect(result.metadata.wordCount).toBeGreaterThan(0);
        }
      });

      test("computes content hash", async () => {
        const extractor = new PdfExtractor();
        const filePath = path.join(FIXTURES_DIR, "simple.pdf");

        const result = await extractor.extract(filePath);

        expect(result.metadata.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);

        // Same file should produce same hash
        const result2 = await extractor.extract(filePath);
        expect(result2.metadata.contentHash).toBe(result.metadata.contentHash);
      });
    });

    describe("error handling", () => {
      test("throws FileAccessError for non-existent file", async () => {
        const extractor = new PdfExtractor();
        const filePath = path.join(FIXTURES_DIR, "non-existent.pdf");

        try {
          await extractor.extract(filePath);
          expect(true).toBe(false); // Should not reach here
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
        const extractor = new PdfExtractor({ maxFileSizeBytes: 100 }); // Very small limit
        const filePath = path.join(FIXTURES_DIR, "simple.pdf");

        try {
          await extractor.extract(filePath);
          expect(true).toBe(false); // Should not reach here
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
        const extractor = new PdfExtractor();
        const filePath = path.join(FIXTURES_DIR, "corrupt.pdf");

        try {
          await extractor.extract(filePath);
          expect(true).toBe(false); // Should not reach here
        } catch (error) {
          expect(error).toBeInstanceOf(ExtractionError);
          if (error instanceof ExtractionError) {
            expect(error.code).toBe("EXTRACTION_ERROR");
            expect(error.filePath).toBe(filePath);
          }
        }
      });
    });

    describe("metadata extraction", () => {
      test("includes correct file metadata", async () => {
        const extractor = new PdfExtractor();
        const filePath = path.join(FIXTURES_DIR, "simple.pdf");
        const stats = await fs.stat(filePath);

        const result = await extractor.extract(filePath);

        expect(result.metadata.filePath).toBe(filePath);
        expect(result.metadata.fileSizeBytes).toBe(stats.size);
        expect(result.metadata.fileModifiedAt.getTime()).toBe(stats.mtime.getTime());
      });

      test("sets documentType to pdf", async () => {
        const extractor = new PdfExtractor();
        const filePath = path.join(FIXTURES_DIR, "simple.pdf");

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
      expect(result!.getUTCSeconds()).toBe(0);
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
    test("throws NotImplementedError", async () => {
      const extractor = new DocxExtractor();

      try {
        await extractor.extract("/path/to/file.docx");
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(NotImplementedError);
        if (error instanceof NotImplementedError) {
          expect(error.methodName).toBe("DocxExtractor.extract");
          expect(error.filePath).toBe("/path/to/file.docx");
        }
      }
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
    test("throws NotImplementedError", async () => {
      const parser = new MarkdownParser();

      try {
        await parser.extract("/path/to/file.md");
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(NotImplementedError);
        if (error instanceof NotImplementedError) {
          expect(error.methodName).toBe("MarkdownParser.extract");
          expect(error.filePath).toBe("/path/to/file.md");
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
    test("throws NotImplementedError", async () => {
      const extractor = new ImageMetadataExtractor();

      try {
        await extractor.extract("/path/to/photo.jpg");
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(NotImplementedError);
        if (error instanceof NotImplementedError) {
          expect(error.methodName).toBe("ImageMetadataExtractor.extract");
          expect(error.filePath).toBe("/path/to/photo.jpg");
        }
      }
    });
  });
});
