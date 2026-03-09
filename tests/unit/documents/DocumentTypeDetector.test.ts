/**
 * Unit tests for DocumentTypeDetector.
 *
 * Tests document type detection, extractor routing, and MIME type validation.
 */

import { describe, test, expect, afterAll, spyOn } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { DocumentTypeDetector } from "../../../src/documents/DocumentTypeDetector.js";
import { PdfExtractor } from "../../../src/documents/extractors/PdfExtractor.js";
import { DocxExtractor } from "../../../src/documents/extractors/DocxExtractor.js";
import { MarkdownParser } from "../../../src/documents/extractors/MarkdownParser.js";
import { ImageMetadataExtractor } from "../../../src/documents/extractors/ImageMetadataExtractor.js";
import { FileAccessError } from "../../../src/documents/errors.js";

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

  describe("validateMimeType", () => {
    const detector = new DocumentTypeDetector();
    const fixturesDir = path.resolve(__dirname, "../../fixtures/documents");

    // Temp directory for mismatch test files
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mime-validation-"));
    const tmpFiles: string[] = [];

    /**
     * Helper to create a temp file with given extension and content.
     */
    function createTempFile(name: string, content: Buffer | string): string {
      const filePath = path.join(tmpDir, name);
      fs.writeFileSync(filePath, content);
      tmpFiles.push(filePath);
      return filePath;
    }

    afterAll(() => {
      for (const f of tmpFiles) {
        try {
          fs.unlinkSync(f);
        } catch {
          // ignore cleanup errors
        }
      }
      try {
        fs.rmdirSync(tmpDir);
      } catch {
        // ignore cleanup errors
      }
    });

    describe("valid files", () => {
      test("validates valid PDF file", async () => {
        const result = await detector.validateMimeType(path.join(fixturesDir, "pdf/simple.pdf"));
        expect(result.isValid).toBe(true);
        expect(result.skipped).toBe(false);
        expect(result.detectedType).toBe("pdf");
        expect(result.expectedMime).toBe("application/pdf");
        expect(result.actualMime).toBe("application/pdf");
      });

      test("validates valid DOCX file (DOCX or ZIP detection)", async () => {
        const result = await detector.validateMimeType(path.join(fixturesDir, "docx/simple.docx"));
        expect(result.isValid).toBe(true);
        expect(result.skipped).toBe(false);
        expect(result.detectedType).toBe("docx");
        // actualMime may be application/zip or the full OOXML type
        const validDocxMimes = [
          "application/zip",
          "application/x-zip-compressed",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ];
        expect(result.actualMime).toBeDefined();
        expect(validDocxMimes).toContain(result.actualMime as string);
      });

      test("validates valid JPEG image", async () => {
        const result = await detector.validateMimeType(path.join(fixturesDir, "images/photo.jpg"));
        expect(result.isValid).toBe(true);
        expect(result.skipped).toBe(false);
        expect(result.actualMime).toBe("image/jpeg");
      });

      test("validates valid PNG image", async () => {
        const result = await detector.validateMimeType(
          path.join(fixturesDir, "images/screenshot.png")
        );
        expect(result.isValid).toBe(true);
        expect(result.skipped).toBe(false);
        expect(result.actualMime).toBe("image/png");
      });

      test("validates valid GIF image", async () => {
        const result = await detector.validateMimeType(
          path.join(fixturesDir, "images/animated.gif")
        );
        expect(result.isValid).toBe(true);
        expect(result.skipped).toBe(false);
        expect(result.actualMime).toBe("image/gif");
      });

      test("validates valid WebP image", async () => {
        const result = await detector.validateMimeType(
          path.join(fixturesDir, "images/diagram.webp")
        );
        expect(result.isValid).toBe(true);
        expect(result.skipped).toBe(false);
        expect(result.actualMime).toBe("image/webp");
      });

      test("validates valid TIFF image", async () => {
        const result = await detector.validateMimeType(path.join(fixturesDir, "images/test.tiff"));
        expect(result.isValid).toBe(true);
        expect(result.skipped).toBe(false);
        expect(result.actualMime).toBe("image/tiff");
      });
    });

    describe("skipped files (text-based, no magic bytes)", () => {
      test("skips Markdown files", async () => {
        const result = await detector.validateMimeType(
          path.join(fixturesDir, "markdown/simple.md")
        );
        expect(result.isValid).toBe(true);
        expect(result.skipped).toBe(true);
        expect(result.detectedType).toBe("markdown");
        expect(result.reason).toContain("Text-based");
      });

      test("skips text files", async () => {
        const txtPath = createTempFile("notes.txt", "Just plain text content.");
        const result = await detector.validateMimeType(txtPath);
        expect(result.isValid).toBe(true);
        expect(result.skipped).toBe(true);
        expect(result.detectedType).toBe("txt");
      });

      test("skips files with unsupported extension", async () => {
        const unknownPath = createTempFile("data.xyz", "some data");
        const result = await detector.validateMimeType(unknownPath);
        expect(result.isValid).toBe(true);
        expect(result.skipped).toBe(true);
        expect(result.reason).toContain("No expected MIME type");
      });

      test("skips files without extension", async () => {
        const noExtPath = createTempFile("README", "# Readme content");
        const result = await detector.validateMimeType(noExtPath);
        expect(result.isValid).toBe(true);
        expect(result.skipped).toBe(true);
        expect(result.reason).toContain("no extension");
      });
    });

    describe("mismatch detection", () => {
      test("detects text content with .pdf extension", async () => {
        const fakePdf = createTempFile("fake.pdf", "This is just plain text, not a PDF.");
        const result = await detector.validateMimeType(fakePdf);
        expect(result.isValid).toBe(false);
        expect(result.skipped).toBe(false);
        expect(result.expectedMime).toBe("application/pdf");
        expect(result.reason).toContain("No magic bytes detected");
      });

      test("detects PNG content with .pdf extension", async () => {
        // Read real PNG file and save with .pdf extension
        const pngContent = fs.readFileSync(path.join(fixturesDir, "images/screenshot.png"));
        const fakePdf = createTempFile("actually-png.pdf", pngContent);
        const result = await detector.validateMimeType(fakePdf);
        expect(result.isValid).toBe(false);
        expect(result.skipped).toBe(false);
        expect(result.expectedMime).toBe("application/pdf");
        expect(result.actualMime).toBe("image/png");
        expect(result.reason).toContain("does not match");
      });

      test("detects PDF content with .docx extension", async () => {
        const pdfContent = fs.readFileSync(path.join(fixturesDir, "pdf/simple.pdf"));
        const fakeDocx = createTempFile("actually-pdf.docx", pdfContent);
        const result = await detector.validateMimeType(fakeDocx);
        expect(result.isValid).toBe(false);
        expect(result.skipped).toBe(false);
        expect(result.expectedMime).toBe(
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        );
        expect(result.actualMime).toBe("application/pdf");
      });

      test("returns mismatch validation for misidentified files via detectWithValidation", async () => {
        const pngContent = fs.readFileSync(path.join(fixturesDir, "images/screenshot.png"));
        const fakePdf = createTempFile("detect-validation-mismatch.pdf", pngContent);
        const result = await detector.detectWithValidation(fakePdf);
        expect(result.type).toBe("pdf");
        expect(result.validation.isValid).toBe(false);
        expect(result.validation.actualMime).toBe("image/png");
      });
    });

    describe("error handling", () => {
      test("throws FileAccessError for non-existent file", async () => {
        let thrown: unknown;
        try {
          await detector.validateMimeType("/nonexistent/path/file.pdf");
        } catch (error) {
          thrown = error;
        }
        expect(thrown).toBeInstanceOf(FileAccessError);
      });

      test("throws FileAccessError for non-ENOENT file system errors", async () => {
        const mockError = new Error("Permission denied") as NodeJS.ErrnoException;
        mockError.code = "EACCES";
        const spy = spyOn(fs.promises, "open").mockRejectedValueOnce(mockError);
        try {
          await detector.validateMimeType("/some/path/file.pdf");
          expect.unreachable("Should have thrown FileAccessError");
        } catch (error) {
          expect(error).toBeInstanceOf(FileAccessError);
          expect((error as FileAccessError).message).toContain("Cannot read file");
        } finally {
          spy.mockRestore();
        }
      });

      test("returns invalid for empty file", async () => {
        const emptyFile = createTempFile("empty.pdf", "");
        const result = await detector.validateMimeType(emptyFile);
        expect(result.isValid).toBe(false);
        expect(result.skipped).toBe(false);
        expect(result.reason).toBe("Empty file");
      });
    });
  });

  describe("detectWithValidation", () => {
    const detector = new DocumentTypeDetector();
    const fixturesDir = path.resolve(__dirname, "../../fixtures/documents");

    test("returns both type and validation result", async () => {
      const result = await detector.detectWithValidation(path.join(fixturesDir, "pdf/simple.pdf"));
      expect(result.type).toBe("pdf");
      expect(result.validation.isValid).toBe(true);
      expect(result.validation.expectedMime).toBe("application/pdf");
      expect(result.validation.actualMime).toBe("application/pdf");
    });

    test("returns type with skipped validation for text files", async () => {
      const result = await detector.detectWithValidation(
        path.join(fixturesDir, "markdown/simple.md")
      );
      expect(result.type).toBe("markdown");
      expect(result.validation.isValid).toBe(true);
      expect(result.validation.skipped).toBe(true);
    });
  });
});
