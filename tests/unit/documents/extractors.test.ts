/**
 * Unit tests for document extractor stubs.
 *
 * Tests extractor initialization, supports() method, and stub behavior.
 */

import { describe, test, expect } from "bun:test";
import {
  PdfExtractor,
  DocxExtractor,
  MarkdownParser,
  ImageMetadataExtractor,
} from "../../../src/documents/extractors/index.js";
import { NotImplementedError, isDocumentError } from "../../../src/documents/errors.js";
import { DEFAULT_EXTRACTOR_CONFIG } from "../../../src/documents/constants.js";

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
    test("throws NotImplementedError", async () => {
      const extractor = new PdfExtractor();

      try {
        await extractor.extract("/path/to/file.pdf");
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(NotImplementedError);
        expect(isDocumentError(error)).toBe(true);
        if (error instanceof NotImplementedError) {
          expect(error.methodName).toBe("PdfExtractor.extract");
          expect(error.filePath).toBe("/path/to/file.pdf");
        }
      }
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
