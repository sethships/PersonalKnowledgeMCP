/**
 * Unit tests for `PdfDocxEntityExtractor` (Phase D / issue #567 T6b.1).
 */

import { describe, it, expect } from "bun:test";
import { PdfDocxEntityExtractor } from "../../../../src/graph/extraction/PdfDocxEntityExtractor.js";
import type { ExtractionResult as DocsExtractionResult } from "../../../../src/documents/types.js";

function makeExtraction(
  partial: Partial<DocsExtractionResult> & { content: string }
): DocsExtractionResult {
  return {
    content: partial.content,
    metadata: {
      documentType: "pdf",
      filePath: "doc.pdf",
      fileSizeBytes: 1024,
      contentHash: "h",
      fileModifiedAt: new Date(),
      ...(partial.metadata ?? {}),
    },
    sections: partial.sections,
    pages: partial.pages,
  };
}

describe("PdfDocxEntityExtractor", () => {
  const extractor = new PdfDocxEntityExtractor();

  it("supports .pdf and .docx", () => {
    expect(PdfDocxEntityExtractor.isSupported("a.pdf")).toBe(true);
    expect(PdfDocxEntityExtractor.isSupported("a.PDF")).toBe(true);
    expect(PdfDocxEntityExtractor.isSupported("a.docx")).toBe(true);
    expect(PdfDocxEntityExtractor.isSupported("a.md")).toBe(false);
    expect(PdfDocxEntityExtractor.isSupported("a.doc")).toBe(false);
  });

  it("emits low-confidence MENTIONS for camelCase / PascalCase identifiers", () => {
    const extraction = makeExtraction({
      content:
        "The AuthService validates tokens. parseToken is called by parseHeader. " +
        "lowercase words like the and is should be ignored.",
    });
    const result = extractor.extractFromExtractionResult(extraction, "x.pdf");
    const idents = result.codeMentions.map((m) => m.identifier).sort();
    expect(idents).toEqual(["AuthService", "parseHeader", "parseToken"]);
    for (const m of result.codeMentions) {
      expect(m.confidence).toBe("low");
    }
  });

  it("does not emit MENTIONS for short or all-lowercase tokens", () => {
    const extraction = makeExtraction({
      content: "the and abc usermap config status common shorter words",
    });
    const result = extractor.extractFromExtractionResult(extraction, "x.pdf");
    expect(result.codeMentions).toHaveLength(0);
  });

  it("converts DOCX section info into a parent-linked hierarchy", () => {
    const extraction = makeExtraction({
      content: "TopBody about AuthService and SubBody about parseToken",
      sections: [
        { title: "Top", level: 1, startOffset: 0, endOffset: 20 },
        { title: "Sub", level: 2, startOffset: 20, endOffset: 100 },
      ],
    });
    const result = extractor.extractFromExtractionResult(extraction, "doc.docx");
    expect(result.format).toBe("docx");
    expect(result.sections).toHaveLength(2);
    expect(result.sections[1]!.parentId).toBe(result.sections[0]!.id);
  });

  it("produces no sections for PDF in v1 even when raw extraction includes them", () => {
    const extraction = makeExtraction({
      content: "Body about AuthService",
      sections: [{ title: "Top", level: 1, startOffset: 0, endOffset: 100 }],
    });
    const result = extractor.extractFromExtractionResult(extraction, "doc.pdf");
    expect(result.format).toBe("pdf");
    expect(result.sections).toHaveLength(0);
  });

  it("dedupes identical mentions within a document", () => {
    const extraction = makeExtraction({
      content: "AuthService and AuthService and AuthService",
    });
    const result = extractor.extractFromExtractionResult(extraction, "x.pdf");
    expect(result.codeMentions).toHaveLength(1);
  });

  it("emits no LINKS_TO references in v1", () => {
    const extraction = makeExtraction({
      content: "See https://example.com or relative.docx for details about AuthService.",
    });
    const result = extractor.extractFromExtractionResult(extraction, "doc.docx");
    expect(result.unresolvedLinks).toHaveLength(0);
  });
});
