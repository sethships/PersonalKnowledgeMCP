/**
 * Unit tests for `DocGraphBatcher` (issue #580).
 *
 * Covers the markdown-vs-PDF/DOCX dispatch and the two entry points used by
 * production callers:
 *
 * - `fromExtraction` — input is an already-parsed `ExtractionResult` from the
 *   chunking pipeline. Verifies the markdown branch reuses `tokens` /
 *   `frontmatter.title` from `MarkdownExtractionResult` so we don't re-lex.
 * - `fromFile` — input is a path. Verifies that pdf-shaped extraction results
 *   coming from a stub `DocumentTypeDetector` flow into
 *   `PdfDocxEntityExtractor`, and that an unsupported extension yields `null`.
 */

import { describe, it, expect } from "bun:test";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  DocGraphBatcher,
  isDocGraphFile,
} from "../../../../src/graph/extraction/doc-graph-batch.js";
import type { DocumentTypeDetector } from "../../../../src/documents/DocumentTypeDetector.js";
import type {
  DocumentExtractor,
  ExtractionResult,
  MarkdownExtractionResult,
} from "../../../../src/documents/types.js";

describe("isDocGraphFile", () => {
  it("accepts markdown / txt / pdf / docx", () => {
    expect(isDocGraphFile("notes.md")).toBe(true);
    expect(isDocGraphFile("notes.markdown")).toBe(true);
    expect(isDocGraphFile("notes.txt")).toBe(true);
    expect(isDocGraphFile("paper.pdf")).toBe(true);
    expect(isDocGraphFile("paper.docx")).toBe(true);
    expect(isDocGraphFile("paper.PDF")).toBe(true);
  });

  it("rejects code, images, and unknown extensions", () => {
    expect(isDocGraphFile("src/foo.ts")).toBe(false);
    expect(isDocGraphFile("photo.jpg")).toBe(false);
    expect(isDocGraphFile("Makefile")).toBe(false);
    expect(isDocGraphFile("data.json")).toBe(false);
  });
});

describe("DocGraphBatcher.fromExtraction", () => {
  const batcher = new DocGraphBatcher();

  it("dispatches markdown to DocEntityExtractor and returns a markdown result", () => {
    const md = "---\ntitle: Hello\n---\n\n# Heading\n\nbody with [link](https://example.com)";
    const extraction: MarkdownExtractionResult = {
      content: md,
      normalizedSource: md,
      frontmatter: { title: "Hello" },
      metadata: {
        documentType: "markdown",
        filePath: "notes.md",
        fileSizeBytes: md.length,
        contentHash: "h",
        fileModifiedAt: new Date(),
      },
    };

    const result = batcher.fromExtraction("notes.md", extraction);

    expect(result).not.toBeNull();
    expect(result!.format).toBe("markdown");
    expect(result!.title).toBe("Hello");
    expect(result!.sections.length).toBeGreaterThan(0);
    expect(result!.unresolvedLinks.some((l) => l.target === "https://example.com")).toBe(true);
  });

  it("falls back to extraction.content when normalizedSource is undefined", () => {
    const md = "# Body Title\n\nplain body";
    const extraction: MarkdownExtractionResult = {
      content: md,
      // normalizedSource intentionally omitted
      metadata: {
        documentType: "markdown",
        filePath: "x.md",
        fileSizeBytes: md.length,
        contentHash: "h",
        fileModifiedAt: new Date(),
      },
    };

    const result = batcher.fromExtraction("x.md", extraction);

    expect(result).not.toBeNull();
    expect(result!.format).toBe("markdown");
    expect(result!.title).toBe("Body Title");
  });

  it("dispatches pdf to PdfDocxEntityExtractor and emits low-confidence mentions", () => {
    const extraction: ExtractionResult = {
      content:
        "Section discusses the AuthService class and validateRequest function. Generic prose like the and for is filtered.",
      metadata: {
        documentType: "pdf",
        title: "Some PDF Title",
        wordCount: 17,
        pageCount: 3,
        filePath: "paper.pdf",
        fileSizeBytes: 1024,
        contentHash: "h",
        fileModifiedAt: new Date(),
      },
    };

    const result = batcher.fromExtraction("paper.pdf", extraction);

    expect(result).not.toBeNull();
    expect(result!.format).toBe("pdf");
    expect(result!.title).toBe("Some PDF Title");
    expect(result!.pageCount).toBe(3);
    // Should pick up at least one camelCase / PascalCase identifier with low confidence.
    expect(result!.codeMentions.some((m) => m.confidence === "low")).toBe(true);
    expect(result!.codeMentions.some((m) => m.identifier === "AuthService")).toBe(true);
    // Wikilinks and external links are not emitted for PDFs in v1.
    expect(result!.unresolvedLinks).toHaveLength(0);
  });

  it("returns null for unsupported extensions", () => {
    const extraction: ExtractionResult = {
      content: "not a doc-graph file",
      metadata: {
        documentType: "txt",
        filePath: "x.json",
        fileSizeBytes: 0,
        contentHash: "h",
        fileModifiedAt: new Date(),
      },
    };

    expect(batcher.fromExtraction("x.json", extraction)).toBeNull();
  });
});

describe("DocGraphBatcher.fromFile", () => {
  const batcher = new DocGraphBatcher();

  it("reads markdown from disk and produces a DocExtractionResult", async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), "doc-graph-batch-"));
    try {
      const filePath = path.join(dir, "notes.md");
      await fs.writeFile(
        filePath,
        "# Hello\n\nbody with [external](https://example.com) and a `KnownSymbol` mention.",
        "utf-8"
      );

      // The markdown branch does not call the detector, so a stub is fine.
      const stubDetector = {
        getExtractor(): null {
          return null;
        },
      } as unknown as DocumentTypeDetector;

      const result = await batcher.fromFile(filePath, "notes.md", stubDetector);

      expect(result).not.toBeNull();
      expect(result!.format).toBe("markdown");
      expect(result!.title).toBe("Hello");
      expect(result!.codeMentions.some((m) => m.identifier === "KnownSymbol")).toBe(true);
      expect(result!.unresolvedLinks.some((l) => l.target === "https://example.com")).toBe(true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("delegates pdf parsing to the detector's extractor and consumes the ExtractionResult", async () => {
    // Stub extractor: pretends to read a pdf and returns a synthetic result.
    const stubExtractor: DocumentExtractor<ExtractionResult> = {
      async extract(): Promise<ExtractionResult> {
        return {
          content: "PDF prose mentioning the AuthService component and parseToken helper.",
          metadata: {
            documentType: "pdf",
            title: "Stub PDF",
            wordCount: 9,
            pageCount: 1,
            filePath: "paper.pdf",
            fileSizeBytes: 0,
            contentHash: "h",
            fileModifiedAt: new Date(),
          },
        };
      },
      supports(): boolean {
        return true;
      },
    };

    const stubDetector = {
      getExtractor(): DocumentExtractor<ExtractionResult> {
        return stubExtractor;
      },
    } as unknown as DocumentTypeDetector;

    const result = await batcher.fromFile("/abs/paper.pdf", "paper.pdf", stubDetector);

    expect(result).not.toBeNull();
    expect(result!.format).toBe("pdf");
    expect(result!.title).toBe("Stub PDF");
    expect(result!.codeMentions.some((m) => m.identifier === "AuthService")).toBe(true);
  });

  it("returns null when the detector has no extractor for a pdf/docx file", async () => {
    const stubDetector = {
      getExtractor(): null {
        return null;
      },
    } as unknown as DocumentTypeDetector;

    const result = await batcher.fromFile("/abs/missing.pdf", "missing.pdf", stubDetector);
    expect(result).toBeNull();
  });

  it("returns null for unsupported extensions without touching the filesystem", async () => {
    const stubDetector = {
      getExtractor(): never {
        throw new Error("should not be called for unsupported extensions");
      },
    } as unknown as DocumentTypeDetector;

    const result = await batcher.fromFile("/abs/foo.json", "foo.json", stubDetector);
    expect(result).toBeNull();
  });
});
