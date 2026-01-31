/**
 * Unit tests for document constants.
 *
 * Tests extension arrays, MIME type mappings, and configuration defaults.
 */

import { describe, test, expect } from "bun:test";
import {
  DOCUMENT_EXTENSIONS,
  IMAGE_EXTENSIONS,
  SUPPORTED_EXTENSIONS,
  MIME_TYPES,
  DEFAULT_EXTRACTOR_CONFIG,
  DOCUMENT_TYPE_LABELS,
  EXTENSION_TO_TYPE,
} from "../../../src/documents/constants.js";

describe("DOCUMENT_EXTENSIONS", () => {
  test("defines PDF extensions", () => {
    expect(DOCUMENT_EXTENSIONS.pdf).toContain(".pdf");
    expect(DOCUMENT_EXTENSIONS.pdf).toHaveLength(1);
  });

  test("defines DOCX extensions", () => {
    expect(DOCUMENT_EXTENSIONS.docx).toContain(".docx");
    expect(DOCUMENT_EXTENSIONS.docx).toHaveLength(1);
  });

  test("defines Markdown extensions", () => {
    expect(DOCUMENT_EXTENSIONS.markdown).toContain(".md");
    expect(DOCUMENT_EXTENSIONS.markdown).toContain(".markdown");
    expect(DOCUMENT_EXTENSIONS.markdown).toHaveLength(2);
  });

  test("defines text extensions", () => {
    expect(DOCUMENT_EXTENSIONS.txt).toContain(".txt");
    expect(DOCUMENT_EXTENSIONS.txt).toHaveLength(1);
  });

  test("all extensions start with dot", () => {
    const allExtensions = [
      ...DOCUMENT_EXTENSIONS.pdf,
      ...DOCUMENT_EXTENSIONS.docx,
      ...DOCUMENT_EXTENSIONS.markdown,
      ...DOCUMENT_EXTENSIONS.txt,
    ];
    for (const ext of allExtensions) {
      expect(ext.startsWith(".")).toBe(true);
    }
  });
});

describe("IMAGE_EXTENSIONS", () => {
  test("includes common image formats", () => {
    expect(IMAGE_EXTENSIONS).toContain(".jpg");
    expect(IMAGE_EXTENSIONS).toContain(".jpeg");
    expect(IMAGE_EXTENSIONS).toContain(".png");
    expect(IMAGE_EXTENSIONS).toContain(".gif");
    expect(IMAGE_EXTENSIONS).toContain(".webp");
    expect(IMAGE_EXTENSIONS).toContain(".tiff");
  });

  test("has expected number of extensions", () => {
    expect(IMAGE_EXTENSIONS).toHaveLength(6);
  });

  test("all extensions start with dot", () => {
    for (const ext of IMAGE_EXTENSIONS) {
      expect(ext.startsWith(".")).toBe(true);
    }
  });
});

describe("SUPPORTED_EXTENSIONS", () => {
  test("includes all document extensions", () => {
    expect(SUPPORTED_EXTENSIONS).toContain(".pdf");
    expect(SUPPORTED_EXTENSIONS).toContain(".docx");
    expect(SUPPORTED_EXTENSIONS).toContain(".md");
    expect(SUPPORTED_EXTENSIONS).toContain(".markdown");
    expect(SUPPORTED_EXTENSIONS).toContain(".txt");
  });

  test("includes all image extensions", () => {
    expect(SUPPORTED_EXTENSIONS).toContain(".jpg");
    expect(SUPPORTED_EXTENSIONS).toContain(".jpeg");
    expect(SUPPORTED_EXTENSIONS).toContain(".png");
    expect(SUPPORTED_EXTENSIONS).toContain(".gif");
    expect(SUPPORTED_EXTENSIONS).toContain(".webp");
    expect(SUPPORTED_EXTENSIONS).toContain(".tiff");
  });

  test("has expected total count", () => {
    // 4 document types + 2 markdown variants + 6 image types = 11 total
    // Actually: pdf(1) + docx(1) + markdown(2) + txt(1) + images(6) = 11
    expect(SUPPORTED_EXTENSIONS).toHaveLength(11);
  });
});

describe("MIME_TYPES", () => {
  describe("document MIME types", () => {
    test("maps PDF correctly", () => {
      expect(MIME_TYPES[".pdf"]).toBe("application/pdf");
    });

    test("maps DOCX correctly", () => {
      expect(MIME_TYPES[".docx"]).toBe(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );
    });

    test("maps Markdown correctly", () => {
      expect(MIME_TYPES[".md"]).toBe("text/markdown");
      expect(MIME_TYPES[".markdown"]).toBe("text/markdown");
    });

    test("maps text correctly", () => {
      expect(MIME_TYPES[".txt"]).toBe("text/plain");
    });
  });

  describe("image MIME types", () => {
    test("maps JPEG correctly", () => {
      expect(MIME_TYPES[".jpg"]).toBe("image/jpeg");
      expect(MIME_TYPES[".jpeg"]).toBe("image/jpeg");
    });

    test("maps PNG correctly", () => {
      expect(MIME_TYPES[".png"]).toBe("image/png");
    });

    test("maps GIF correctly", () => {
      expect(MIME_TYPES[".gif"]).toBe("image/gif");
    });

    test("maps WebP correctly", () => {
      expect(MIME_TYPES[".webp"]).toBe("image/webp");
    });

    test("maps TIFF correctly", () => {
      expect(MIME_TYPES[".tiff"]).toBe("image/tiff");
    });
  });

  test("returns undefined for unknown extension", () => {
    expect(MIME_TYPES[".xyz"]).toBeUndefined();
  });
});

describe("DEFAULT_EXTRACTOR_CONFIG", () => {
  test("sets maxFileSizeBytes to 50MB", () => {
    expect(DEFAULT_EXTRACTOR_CONFIG.maxFileSizeBytes).toBe(52_428_800);
  });

  test("sets timeoutMs to 30 seconds", () => {
    expect(DEFAULT_EXTRACTOR_CONFIG.timeoutMs).toBe(30_000);
  });
});

describe("DOCUMENT_TYPE_LABELS", () => {
  test("provides human-readable labels", () => {
    expect(DOCUMENT_TYPE_LABELS["pdf"]).toBe("PDF Document");
    expect(DOCUMENT_TYPE_LABELS["docx"]).toBe("Word Document");
    expect(DOCUMENT_TYPE_LABELS["markdown"]).toBe("Markdown File");
    expect(DOCUMENT_TYPE_LABELS["txt"]).toBe("Text File");
    expect(DOCUMENT_TYPE_LABELS["image"]).toBe("Image File");
  });
});

describe("EXTENSION_TO_TYPE", () => {
  test("maps document extensions to types", () => {
    expect(EXTENSION_TO_TYPE[".pdf"]).toBe("pdf");
    expect(EXTENSION_TO_TYPE[".docx"]).toBe("docx");
    expect(EXTENSION_TO_TYPE[".md"]).toBe("markdown");
    expect(EXTENSION_TO_TYPE[".markdown"]).toBe("markdown");
    expect(EXTENSION_TO_TYPE[".txt"]).toBe("txt");
  });

  test("maps image extensions to image type", () => {
    expect(EXTENSION_TO_TYPE[".jpg"]).toBe("image");
    expect(EXTENSION_TO_TYPE[".jpeg"]).toBe("image");
    expect(EXTENSION_TO_TYPE[".png"]).toBe("image");
    expect(EXTENSION_TO_TYPE[".gif"]).toBe("image");
    expect(EXTENSION_TO_TYPE[".webp"]).toBe("image");
    expect(EXTENSION_TO_TYPE[".tiff"]).toBe("image");
  });

  test("returns undefined for unknown extension", () => {
    expect(EXTENSION_TO_TYPE[".xyz"]).toBeUndefined();
  });
});
