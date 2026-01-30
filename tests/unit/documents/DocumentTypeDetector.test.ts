/**
 * Unit tests for DocumentTypeDetector.
 *
 * Tests document type detection and extractor routing.
 */

import { describe, test, expect } from "bun:test";
import { DocumentTypeDetector } from "../../../src/documents/DocumentTypeDetector.js";
import { PdfExtractor } from "../../../src/documents/extractors/PdfExtractor.js";
import { DocxExtractor } from "../../../src/documents/extractors/DocxExtractor.js";
import { MarkdownParser } from "../../../src/documents/extractors/MarkdownParser.js";
import { ImageMetadataExtractor } from "../../../src/documents/extractors/ImageMetadataExtractor.js";

describe("DocumentTypeDetector", () => {
  describe("detect", () => {
    const detector = new DocumentTypeDetector();

    describe("document types", () => {
      test("detects PDF files", () => {
        expect(detector.detect("/path/to/file.pdf")).toBe("pdf");
        expect(detector.detect("/path/to/file.PDF")).toBe("pdf");
        expect(detector.detect("file.pdf")).toBe("pdf");
      });

      test("detects DOCX files", () => {
        expect(detector.detect("/path/to/file.docx")).toBe("docx");
        expect(detector.detect("/path/to/file.DOCX")).toBe("docx");
        expect(detector.detect("file.docx")).toBe("docx");
      });

      test("detects Markdown files", () => {
        expect(detector.detect("/path/to/file.md")).toBe("markdown");
        expect(detector.detect("/path/to/file.markdown")).toBe("markdown");
        expect(detector.detect("/path/to/file.MD")).toBe("markdown");
        expect(detector.detect("README.md")).toBe("markdown");
      });

      test("detects text files", () => {
        expect(detector.detect("/path/to/file.txt")).toBe("txt");
        expect(detector.detect("/path/to/file.TXT")).toBe("txt");
        expect(detector.detect("notes.txt")).toBe("txt");
      });
    });

    describe("image types", () => {
      test("detects JPEG files", () => {
        expect(detector.detect("/path/to/photo.jpg")).toBe("image");
        expect(detector.detect("/path/to/photo.jpeg")).toBe("image");
        expect(detector.detect("/path/to/photo.JPG")).toBe("image");
        expect(detector.detect("/path/to/photo.JPEG")).toBe("image");
      });

      test("detects PNG files", () => {
        expect(detector.detect("/path/to/image.png")).toBe("image");
        expect(detector.detect("/path/to/image.PNG")).toBe("image");
      });

      test("detects GIF files", () => {
        expect(detector.detect("/path/to/animation.gif")).toBe("image");
        expect(detector.detect("/path/to/animation.GIF")).toBe("image");
      });

      test("detects WebP files", () => {
        expect(detector.detect("/path/to/image.webp")).toBe("image");
        expect(detector.detect("/path/to/image.WEBP")).toBe("image");
      });

      test("detects TIFF files", () => {
        expect(detector.detect("/path/to/scan.tiff")).toBe("image");
        expect(detector.detect("/path/to/scan.TIFF")).toBe("image");
      });
    });

    describe("unknown types", () => {
      test("returns unknown for unsupported extensions", () => {
        expect(detector.detect("/path/to/file.xyz")).toBe("unknown");
        expect(detector.detect("/path/to/file.doc")).toBe("unknown");
        expect(detector.detect("/path/to/file.xls")).toBe("unknown");
      });

      test("returns unknown for files without extension", () => {
        expect(detector.detect("/path/to/README")).toBe("unknown");
        expect(detector.detect("Makefile")).toBe("unknown");
      });
    });
  });

  describe("getExtractor", () => {
    const detector = new DocumentTypeDetector();

    test("returns PdfExtractor for PDF files", () => {
      const extractor = detector.getExtractor("/path/to/file.pdf");
      expect(extractor).toBeInstanceOf(PdfExtractor);
    });

    test("returns DocxExtractor for DOCX files", () => {
      const extractor = detector.getExtractor("/path/to/file.docx");
      expect(extractor).toBeInstanceOf(DocxExtractor);
    });

    test("returns MarkdownParser for Markdown files", () => {
      const extractor = detector.getExtractor("/path/to/file.md");
      expect(extractor).toBeInstanceOf(MarkdownParser);
    });

    test("returns MarkdownParser for text files", () => {
      // Text files use the markdown parser
      const extractor = detector.getExtractor("/path/to/file.txt");
      expect(extractor).toBeInstanceOf(MarkdownParser);
    });

    test("returns ImageMetadataExtractor for image files", () => {
      expect(detector.getExtractor("/path/to/photo.jpg")).toBeInstanceOf(ImageMetadataExtractor);
      expect(detector.getExtractor("/path/to/photo.jpeg")).toBeInstanceOf(ImageMetadataExtractor);
      expect(detector.getExtractor("/path/to/image.png")).toBeInstanceOf(ImageMetadataExtractor);
      expect(detector.getExtractor("/path/to/animation.gif")).toBeInstanceOf(
        ImageMetadataExtractor
      );
      expect(detector.getExtractor("/path/to/image.webp")).toBeInstanceOf(ImageMetadataExtractor);
      expect(detector.getExtractor("/path/to/scan.tiff")).toBeInstanceOf(ImageMetadataExtractor);
    });

    test("returns null for unsupported types", () => {
      expect(detector.getExtractor("/path/to/file.xyz")).toBeNull();
      expect(detector.getExtractor("/path/to/file.doc")).toBeNull();
    });

    test("returns null for files without extension", () => {
      expect(detector.getExtractor("/path/to/README")).toBeNull();
    });

    test("handles case-insensitive extensions", () => {
      expect(detector.getExtractor("/path/to/file.PDF")).toBeInstanceOf(PdfExtractor);
      expect(detector.getExtractor("/path/to/file.DOCX")).toBeInstanceOf(DocxExtractor);
      expect(detector.getExtractor("/path/to/file.MD")).toBeInstanceOf(MarkdownParser);
      expect(detector.getExtractor("/path/to/photo.JPG")).toBeInstanceOf(ImageMetadataExtractor);
    });
  });

  describe("isSupported", () => {
    const detector = new DocumentTypeDetector();

    test("returns true for supported document types", () => {
      expect(detector.isSupported("/path/to/file.pdf")).toBe(true);
      expect(detector.isSupported("/path/to/file.docx")).toBe(true);
      expect(detector.isSupported("/path/to/file.md")).toBe(true);
      expect(detector.isSupported("/path/to/file.txt")).toBe(true);
    });

    test("returns true for supported image types", () => {
      expect(detector.isSupported("/path/to/photo.jpg")).toBe(true);
      expect(detector.isSupported("/path/to/photo.jpeg")).toBe(true);
      expect(detector.isSupported("/path/to/image.png")).toBe(true);
      expect(detector.isSupported("/path/to/animation.gif")).toBe(true);
      expect(detector.isSupported("/path/to/image.webp")).toBe(true);
      expect(detector.isSupported("/path/to/scan.tiff")).toBe(true);
    });

    test("returns false for unsupported types", () => {
      expect(detector.isSupported("/path/to/file.xyz")).toBe(false);
      expect(detector.isSupported("/path/to/file.doc")).toBe(false);
      expect(detector.isSupported("/path/to/README")).toBe(false);
    });
  });

  describe("isDocument", () => {
    const detector = new DocumentTypeDetector();

    test("returns true for document types", () => {
      expect(detector.isDocument("/path/to/file.pdf")).toBe(true);
      expect(detector.isDocument("/path/to/file.docx")).toBe(true);
      expect(detector.isDocument("/path/to/file.md")).toBe(true);
      expect(detector.isDocument("/path/to/file.txt")).toBe(true);
    });

    test("returns false for image types", () => {
      expect(detector.isDocument("/path/to/photo.jpg")).toBe(false);
      expect(detector.isDocument("/path/to/image.png")).toBe(false);
    });

    test("returns false for unsupported types", () => {
      expect(detector.isDocument("/path/to/file.xyz")).toBe(false);
    });
  });

  describe("isImage", () => {
    const detector = new DocumentTypeDetector();

    test("returns true for image types", () => {
      expect(detector.isImage("/path/to/photo.jpg")).toBe(true);
      expect(detector.isImage("/path/to/photo.jpeg")).toBe(true);
      expect(detector.isImage("/path/to/image.png")).toBe(true);
      expect(detector.isImage("/path/to/animation.gif")).toBe(true);
      expect(detector.isImage("/path/to/image.webp")).toBe(true);
      expect(detector.isImage("/path/to/scan.tiff")).toBe(true);
    });

    test("returns false for document types", () => {
      expect(detector.isImage("/path/to/file.pdf")).toBe(false);
      expect(detector.isImage("/path/to/file.docx")).toBe(false);
      expect(detector.isImage("/path/to/file.md")).toBe(false);
    });

    test("returns false for unsupported types", () => {
      expect(detector.isImage("/path/to/file.xyz")).toBe(false);
    });
  });

  describe("getExtension", () => {
    const detector = new DocumentTypeDetector();

    test("returns lowercase extension with dot", () => {
      expect(detector.getExtension("/path/to/file.PDF")).toBe(".pdf");
      expect(detector.getExtension("/path/to/file.DOCX")).toBe(".docx");
      expect(detector.getExtension("/path/to/file.Md")).toBe(".md");
    });

    test("returns empty string for files without extension", () => {
      expect(detector.getExtension("/path/to/README")).toBe("");
      expect(detector.getExtension("Makefile")).toBe("");
    });
  });
});
