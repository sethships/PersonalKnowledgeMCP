/**
 * Unit tests for DocumentChunker.
 *
 * Tests document-aware chunking including paragraph boundaries, page boundaries,
 * section heading context, document metadata, and edge cases.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { DocumentChunker } from "../../../src/documents/DocumentChunker.js";
import type { DocumentChunkerConfig } from "../../../src/documents/types.js";
import { initializeLogger, resetLogger } from "../../../src/logging/index.js";
import {
  SMALL_DOCUMENT_CONTENT,
  PARAGRAPH_DOCUMENT_CONTENT,
  createMockExtractionResult,
  createMultiPageExtractionResult,
  createSectionedExtractionResult,
  createTypedExtractionResult,
  generateLargeDocumentContent,
} from "../../fixtures/documents/document-chunk-fixtures.js";

// Common test parameters
const TEST_SOURCE = "test-docs";
const TEST_FILE_PATH = "docs/test.pdf";

/**
 * Helper to create a DocumentChunker with test-friendly defaults.
 */
function createChunker(config?: DocumentChunkerConfig): DocumentChunker {
  return new DocumentChunker(config);
}

describe("DocumentChunker", () => {
  beforeEach(() => {
    initializeLogger({ level: "error", format: "json" });
  });

  afterEach(() => {
    resetLogger();
  });

  describe("Configuration", () => {
    test("creates instance with default configuration", () => {
      const chunker = createChunker();
      expect(chunker).toBeInstanceOf(DocumentChunker);
    });

    test("creates instance with custom configuration", () => {
      const chunker = createChunker({
        maxChunkTokens: 1000,
        overlapTokens: 100,
        respectParagraphs: false,
        includeSectionContext: false,
        respectPageBoundaries: false,
      });
      expect(chunker).toBeInstanceOf(DocumentChunker);
    });

    test("throws when overlap >= maxChunkTokens (inherited from FileChunker)", () => {
      expect(() =>
        createChunker({
          maxChunkTokens: 100,
          overlapTokens: 100,
        })
      ).toThrow();
    });

    test("throws when overlap > maxChunkTokens", () => {
      expect(() =>
        createChunker({
          maxChunkTokens: 50,
          overlapTokens: 100,
        })
      ).toThrow();
    });
  });

  describe("Basic chunking", () => {
    test("returns empty array for empty content", () => {
      const chunker = createChunker();
      const result = createMockExtractionResult({ content: "" });
      const chunks = chunker.chunkDocument(result, TEST_FILE_PATH, TEST_SOURCE);
      expect(chunks).toEqual([]);
    });

    test("returns empty array for whitespace-only content", () => {
      const chunker = createChunker();
      const result = createMockExtractionResult({ content: "   \n\n  \n  " });
      const chunks = chunker.chunkDocument(result, TEST_FILE_PATH, TEST_SOURCE);
      expect(chunks).toEqual([]);
    });

    test("creates single chunk for small content", () => {
      const chunker = createChunker();
      const result = createMockExtractionResult({ content: SMALL_DOCUMENT_CONTENT });
      const chunks = chunker.chunkDocument(result, TEST_FILE_PATH, TEST_SOURCE);

      expect(chunks.length).toBe(1);
      expect(chunks[0]!.content).toBe(SMALL_DOCUMENT_CONTENT);
      expect(chunks[0]!.chunkIndex).toBe(0);
      expect(chunks[0]!.totalChunks).toBe(1);
    });

    test("preserves source and filePath in chunks", () => {
      const chunker = createChunker();
      const result = createMockExtractionResult();
      const chunks = chunker.chunkDocument(result, TEST_FILE_PATH, TEST_SOURCE);

      expect(chunks[0]!.repository).toBe(TEST_SOURCE);
      expect(chunks[0]!.filePath).toBe(TEST_FILE_PATH);
    });

    test("generates unique chunk IDs in format source:filePath:index", () => {
      const chunker = createChunker({ maxChunkTokens: 100 });
      const result = createMockExtractionResult({
        content: PARAGRAPH_DOCUMENT_CONTENT,
      });
      const chunks = chunker.chunkDocument(result, TEST_FILE_PATH, TEST_SOURCE);

      expect(chunks.length).toBeGreaterThan(1);
      const ids = chunks.map((c) => c.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);

      // Verify ID format
      for (let i = 0; i < chunks.length; i++) {
        expect(chunks[i]!.id).toBe(`${TEST_SOURCE}:${TEST_FILE_PATH}:${i}`);
      }
    });

    test("sets correct chunkIndex and totalChunks", () => {
      const chunker = createChunker({ maxChunkTokens: 100 });
      const result = createMockExtractionResult({
        content: PARAGRAPH_DOCUMENT_CONTENT,
      });
      const chunks = chunker.chunkDocument(result, TEST_FILE_PATH, TEST_SOURCE);

      const totalChunks = chunks.length;
      for (let i = 0; i < chunks.length; i++) {
        expect(chunks[i]!.chunkIndex).toBe(i);
        expect(chunks[i]!.totalChunks).toBe(totalChunks);
      }
    });
  });

  describe("Paragraph-aware chunking", () => {
    test("splits at paragraph boundaries when respectParagraphs=true", () => {
      const chunker = createChunker({
        maxChunkTokens: 200,
        overlapTokens: 0,
        respectParagraphs: true,
        respectPageBoundaries: false,
      });
      const result = createMockExtractionResult({
        content: PARAGRAPH_DOCUMENT_CONTENT,
      });
      const chunks = chunker.chunkDocument(result, TEST_FILE_PATH, TEST_SOURCE);

      // Each paragraph is ~50 tokens, so with 200 token limit we should get
      // groups of ~3-4 paragraphs per chunk
      expect(chunks.length).toBeGreaterThanOrEqual(1);

      // Content should not split mid-paragraph (no partial paragraphs)
      for (const chunk of chunks) {
        // Each chunk's content should be complete paragraphs
        expect(chunk.content.length).toBeGreaterThan(0);
      }
    });

    test("does not split at paragraphs when respectParagraphs=false", () => {
      const chunker = createChunker({
        maxChunkTokens: 200,
        overlapTokens: 0,
        respectParagraphs: false,
        respectPageBoundaries: false,
      });
      const result = createMockExtractionResult({
        content: PARAGRAPH_DOCUMENT_CONTENT,
      });
      const chunks = chunker.chunkDocument(result, TEST_FILE_PATH, TEST_SOURCE);

      // Should still produce chunks, but using line-level splitting
      expect(chunks.length).toBeGreaterThanOrEqual(1);
    });

    test("handles single-paragraph document", () => {
      const chunker = createChunker({
        respectParagraphs: true,
      });
      const content = "This is a single paragraph with no paragraph breaks at all.";
      const result = createMockExtractionResult({ content });
      const chunks = chunker.chunkDocument(result, TEST_FILE_PATH, TEST_SOURCE);

      expect(chunks.length).toBe(1);
      expect(chunks[0]!.content).toBe(content);
    });

    test("falls back to line-level for oversized paragraphs", () => {
      const chunker = createChunker({
        maxChunkTokens: 50,
        overlapTokens: 5,
        respectParagraphs: true,
        respectPageBoundaries: false,
      });

      // Single long paragraph that exceeds 50 tokens
      const longParagraph = Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ");
      const result = createMockExtractionResult({ content: longParagraph });
      const chunks = chunker.chunkDocument(result, TEST_FILE_PATH, TEST_SOURCE);

      // Should split the oversized paragraph at line boundaries
      expect(chunks.length).toBeGreaterThanOrEqual(1);
    });

    test("groups multiple small paragraphs into one chunk", () => {
      const chunker = createChunker({
        maxChunkTokens: 500,
        overlapTokens: 0,
        respectParagraphs: true,
        respectPageBoundaries: false,
      });

      const content = "Short paragraph one.\n\nShort paragraph two.\n\nShort paragraph three.";
      const result = createMockExtractionResult({ content });
      const chunks = chunker.chunkDocument(result, TEST_FILE_PATH, TEST_SOURCE);

      // All 3 short paragraphs should fit in one chunk
      expect(chunks.length).toBe(1);
      expect(chunks[0]!.content).toContain("Short paragraph one.");
      expect(chunks[0]!.content).toContain("Short paragraph two.");
      expect(chunks[0]!.content).toContain("Short paragraph three.");
    });
  });

  describe("Page-aware chunking", () => {
    test("chunks each page independently when respectPageBoundaries=true", () => {
      const chunker = createChunker({
        maxChunkTokens: 500,
        respectPageBoundaries: true,
      });
      const result = createMultiPageExtractionResult(3, 30);
      const chunks = chunker.chunkDocument(result, TEST_FILE_PATH, TEST_SOURCE);

      // Should have at least 3 chunks (one per page, possibly more if pages are large)
      expect(chunks.length).toBeGreaterThanOrEqual(3);
    });

    test("sets page number in metadata for page-based chunks", () => {
      const chunker = createChunker({
        maxChunkTokens: 500,
        respectPageBoundaries: true,
      });
      const result = createMultiPageExtractionResult(3, 20);
      const chunks = chunker.chunkDocument(result, TEST_FILE_PATH, TEST_SOURCE);

      // Each chunk should have a page number
      for (const chunk of chunks) {
        expect(chunk.metadata.pageNumber).toBeDefined();
        expect(chunk.metadata.pageNumber).toBeGreaterThanOrEqual(1);
        expect(chunk.metadata.pageNumber).toBeLessThanOrEqual(3);
      }
    });

    test("does not use page boundaries when respectPageBoundaries=false", () => {
      const chunker = createChunker({
        maxChunkTokens: 500,
        respectPageBoundaries: false,
        respectParagraphs: false,
      });
      const result = createMultiPageExtractionResult(3, 20);
      const chunks = chunker.chunkDocument(result, TEST_FILE_PATH, TEST_SOURCE);

      // Should not have page numbers since page boundaries are ignored
      for (const chunk of chunks) {
        expect(chunk.metadata.pageNumber).toBeUndefined();
      }
    });

    test("skips empty pages", () => {
      const chunker = createChunker({
        maxChunkTokens: 500,
        respectPageBoundaries: true,
      });
      const result = createMockExtractionResult({
        content: "Page 1 content.\n\nPage 3 content.",
        pages: [
          { pageNumber: 1, content: "Page 1 content." },
          { pageNumber: 2, content: "" },
          { pageNumber: 3, content: "Page 3 content." },
        ],
      });
      const chunks = chunker.chunkDocument(result, TEST_FILE_PATH, TEST_SOURCE);

      // Should only have chunks from pages 1 and 3
      const pageNumbers = chunks.map((c) => c.metadata.pageNumber).filter(Boolean);
      expect(pageNumbers).not.toContain(2);
    });

    test("maintains continuous chunk indices across pages", () => {
      const chunker = createChunker({
        maxChunkTokens: 500,
        respectPageBoundaries: true,
      });
      const result = createMultiPageExtractionResult(3, 20);
      const chunks = chunker.chunkDocument(result, TEST_FILE_PATH, TEST_SOURCE);

      // Chunk indices should be sequential
      for (let i = 0; i < chunks.length; i++) {
        expect(chunks[i]!.chunkIndex).toBe(i);
        expect(chunks[i]!.totalChunks).toBe(chunks.length);
      }
    });
  });

  describe("Section heading context", () => {
    test("attaches section heading when includeSectionContext=true", () => {
      const chunker = createChunker({
        maxChunkTokens: 200,
        overlapTokens: 0,
        includeSectionContext: true,
        respectParagraphs: true,
        respectPageBoundaries: false,
      });
      const result = createSectionedExtractionResult();
      const chunks = chunker.chunkDocument(result, "docs/design.md", TEST_SOURCE);

      // At least some chunks should have section headings
      const chunksWithHeadings = chunks.filter((c) => c.metadata.sectionHeading);
      expect(chunksWithHeadings.length).toBeGreaterThan(0);
    });

    test("does not attach section heading when includeSectionContext=false", () => {
      const chunker = createChunker({
        maxChunkTokens: 200,
        overlapTokens: 0,
        includeSectionContext: false,
        respectParagraphs: true,
        respectPageBoundaries: false,
      });
      const result = createSectionedExtractionResult();
      const chunks = chunker.chunkDocument(result, "docs/design.md", TEST_SOURCE);

      for (const chunk of chunks) {
        expect(chunk.metadata.sectionHeading).toBeUndefined();
      }
    });

    test("handles document with no sections", () => {
      const chunker = createChunker({
        includeSectionContext: true,
      });
      const result = createMockExtractionResult({
        content: SMALL_DOCUMENT_CONTENT,
        sections: undefined,
      });
      const chunks = chunker.chunkDocument(result, TEST_FILE_PATH, TEST_SOURCE);

      expect(chunks.length).toBe(1);
      expect(chunks[0]!.metadata.sectionHeading).toBeUndefined();
    });

    test("handles document with empty sections array", () => {
      const chunker = createChunker({
        includeSectionContext: true,
      });
      const result = createMockExtractionResult({
        content: SMALL_DOCUMENT_CONTENT,
        sections: [],
      });
      const chunks = chunker.chunkDocument(result, TEST_FILE_PATH, TEST_SOURCE);

      expect(chunks.length).toBe(1);
      expect(chunks[0]!.metadata.sectionHeading).toBeUndefined();
    });
  });

  describe("Document metadata", () => {
    test("preserves document type in chunk metadata", () => {
      const chunker = createChunker();
      const result = createMockExtractionResult({
        metadataOverrides: { documentType: "pdf" },
      });
      const chunks = chunker.chunkDocument(result, TEST_FILE_PATH, TEST_SOURCE);

      expect(chunks[0]!.metadata.documentType).toBe("pdf");
    });

    test("preserves document title in chunk metadata", () => {
      const chunker = createChunker();
      const result = createMockExtractionResult({
        metadataOverrides: { title: "My Report" },
      });
      const chunks = chunker.chunkDocument(result, TEST_FILE_PATH, TEST_SOURCE);

      expect(chunks[0]!.metadata.documentTitle).toBe("My Report");
    });

    test("preserves document author in chunk metadata", () => {
      const chunker = createChunker();
      const result = createMockExtractionResult({
        metadataOverrides: { author: "Jane Doe" },
      });
      const chunks = chunker.chunkDocument(result, TEST_FILE_PATH, TEST_SOURCE);

      expect(chunks[0]!.metadata.documentAuthor).toBe("Jane Doe");
    });

    test("handles missing title and author", () => {
      const chunker = createChunker();
      const result = createMockExtractionResult({
        metadataOverrides: { title: undefined, author: undefined },
      });
      const chunks = chunker.chunkDocument(result, TEST_FILE_PATH, TEST_SOURCE);

      expect(chunks[0]!.metadata.documentTitle).toBeUndefined();
      expect(chunks[0]!.metadata.documentAuthor).toBeUndefined();
    });

    test("sets file extension from filePath", () => {
      const chunker = createChunker();
      const result = createMockExtractionResult();
      const chunks = chunker.chunkDocument(result, "docs/report.pdf", TEST_SOURCE);

      expect(chunks[0]!.metadata.extension).toBe(".pdf");
    });

    test("computes content hash for each chunk", () => {
      const chunker = createChunker({ maxChunkTokens: 100 });
      const result = createMockExtractionResult({
        content: PARAGRAPH_DOCUMENT_CONTENT,
      });
      const chunks = chunker.chunkDocument(result, TEST_FILE_PATH, TEST_SOURCE);

      for (const chunk of chunks) {
        expect(chunk.metadata.contentHash).toBeDefined();
        expect(chunk.metadata.contentHash.length).toBe(64); // SHA-256 hex
      }
    });

    test("preserves fileModifiedAt in metadata", () => {
      const modDate = new Date("2025-01-15T12:00:00Z");
      const chunker = createChunker();
      const result = createMockExtractionResult({
        metadataOverrides: { fileModifiedAt: modDate },
      });
      const chunks = chunker.chunkDocument(result, TEST_FILE_PATH, TEST_SOURCE);

      expect(chunks[0]!.metadata.fileModifiedAt).toEqual(modDate);
    });
  });

  describe("All document types", () => {
    const documentTypes = ["pdf", "docx", "markdown", "txt"] as const;

    for (const docType of documentTypes) {
      test(`handles ${docType} document type`, () => {
        const chunker = createChunker();
        const result = createTypedExtractionResult(docType);
        const filePathMap: Record<string, string> = {
          pdf: "docs/file.pdf",
          docx: "docs/file.docx",
          markdown: "docs/file.md",
          txt: "docs/file.txt",
        };
        const chunks = chunker.chunkDocument(result, filePathMap[docType]!, TEST_SOURCE);

        expect(chunks.length).toBeGreaterThanOrEqual(1);
        expect(chunks[0]!.metadata.documentType).toBe(docType);
      });
    }
  });

  describe("Edge cases", () => {
    test("handles content with Windows line endings", () => {
      const chunker = createChunker({ respectParagraphs: true });
      const content = "Para one.\r\n\r\nPara two.\r\n\r\nPara three.";
      const result = createMockExtractionResult({ content });
      const chunks = chunker.chunkDocument(result, TEST_FILE_PATH, TEST_SOURCE);

      expect(chunks.length).toBeGreaterThanOrEqual(1);
      // Content should be normalized to LF
      for (const chunk of chunks) {
        expect(chunk.content).not.toContain("\r");
      }
    });

    test("handles content with mixed line endings", () => {
      const chunker = createChunker({ respectParagraphs: true });
      const content = "Para one.\r\n\r\nPara two.\n\nPara three.\r\rPara four.";
      const result = createMockExtractionResult({ content });
      const chunks = chunker.chunkDocument(result, TEST_FILE_PATH, TEST_SOURCE);

      expect(chunks.length).toBeGreaterThanOrEqual(1);
    });

    test("handles very large document", () => {
      const chunker = createChunker({
        maxChunkTokens: 200,
        overlapTokens: 20,
        respectParagraphs: true,
        respectPageBoundaries: false,
      });
      const content = generateLargeDocumentContent(50);
      const result = createMockExtractionResult({ content });
      const chunks = chunker.chunkDocument(result, TEST_FILE_PATH, TEST_SOURCE);

      expect(chunks.length).toBeGreaterThan(1);

      // All content should be represented
      const totalContent = chunks.map((c) => c.content).join("");
      expect(totalContent.length).toBeGreaterThan(0);
    });

    test("handles document with no pages and no sections", () => {
      const chunker = createChunker();
      const result = createMockExtractionResult({
        content: SMALL_DOCUMENT_CONTENT,
        pages: undefined,
        sections: undefined,
      });
      const chunks = chunker.chunkDocument(result, TEST_FILE_PATH, TEST_SOURCE);

      expect(chunks.length).toBe(1);
      expect(chunks[0]!.metadata.pageNumber).toBeUndefined();
      expect(chunks[0]!.metadata.sectionHeading).toBeUndefined();
    });

    test("handles document with empty pages array", () => {
      const chunker = createChunker({
        respectPageBoundaries: true,
        respectParagraphs: true,
      });
      const result = createMockExtractionResult({
        content: SMALL_DOCUMENT_CONTENT,
        pages: [],
      });
      const chunks = chunker.chunkDocument(result, TEST_FILE_PATH, TEST_SOURCE);

      // Empty pages array should fall through to paragraph chunking
      expect(chunks.length).toBe(1);
    });

    test("throws ChunkingError on invalid source name", () => {
      const chunker = createChunker();
      const result = createMockExtractionResult();

      // Source with colon is invalid (separator character)
      expect(() => chunker.chunkDocument(result, TEST_FILE_PATH, "invalid:source")).toThrow();
    });

    test("returns DocumentChunk shape with all required fields", () => {
      const chunker = createChunker();
      const result = createMockExtractionResult({
        metadataOverrides: {
          title: "Test Title",
          author: "Test Author",
          documentType: "pdf",
        },
      });
      const chunks = chunker.chunkDocument(result, TEST_FILE_PATH, TEST_SOURCE);

      const chunk = chunks[0]!;

      // Verify all DocumentChunk fields
      expect(typeof chunk.id).toBe("string");
      expect(typeof chunk.repository).toBe("string");
      expect(typeof chunk.filePath).toBe("string");
      expect(typeof chunk.content).toBe("string");
      expect(typeof chunk.chunkIndex).toBe("number");
      expect(typeof chunk.totalChunks).toBe("number");
      expect(typeof chunk.startLine).toBe("number");
      expect(typeof chunk.endLine).toBe("number");

      // Verify DocumentChunkMetadata fields
      expect(typeof chunk.metadata.extension).toBe("string");
      expect(typeof chunk.metadata.language).toBe("string");
      expect(typeof chunk.metadata.fileSizeBytes).toBe("number");
      expect(typeof chunk.metadata.contentHash).toBe("string");
      expect(chunk.metadata.fileModifiedAt).toBeInstanceOf(Date);
      expect(chunk.metadata.documentType).toBe("pdf");
      expect(chunk.metadata.documentTitle).toBe("Test Title");
      expect(chunk.metadata.documentAuthor).toBe("Test Author");
    });

    test("handles Unicode content correctly", () => {
      const chunker = createChunker();
      const content = "中文文档内容。这是一个测试文档。\n\n日本語のテスト。";
      const result = createMockExtractionResult({ content });
      const chunks = chunker.chunkDocument(result, TEST_FILE_PATH, TEST_SOURCE);

      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks[0]!.content).toContain("中文");
    });

    test("handles content with only newlines between paragraphs", () => {
      const chunker = createChunker({
        respectParagraphs: true,
        respectPageBoundaries: false,
      });
      const content = "First paragraph.\n\n\n\nSecond paragraph.";
      const result = createMockExtractionResult({ content });
      const chunks = chunker.chunkDocument(result, TEST_FILE_PATH, TEST_SOURCE);

      expect(chunks.length).toBeGreaterThanOrEqual(1);
    });

    test("tracks line numbers correctly with multi-newline delimiters", () => {
      // Use token limit of 8 so each ~5-token paragraph gets its own chunk
      const chunker = createChunker({
        maxChunkTokens: 8,
        overlapTokens: 0,
        respectParagraphs: true,
        respectPageBoundaries: false,
      });

      // 4 newlines between paragraphs: lines 1, 2(blank), 3(blank), 4(blank), 5
      const content = "First paragraph.\n\n\n\nSecond paragraph.";
      const result = createMockExtractionResult({ content });
      const chunks = chunker.chunkDocument(result, TEST_FILE_PATH, TEST_SOURCE);

      expect(chunks.length).toBe(2);
      // First paragraph at line 1
      expect(chunks[0]!.startLine).toBe(1);
      expect(chunks[0]!.endLine).toBe(1);
      // Second paragraph at line 5 (after 4 newlines)
      expect(chunks[1]!.startLine).toBe(5);
      expect(chunks[1]!.endLine).toBe(5);
    });

    test("tracks line numbers correctly with standard double-newline delimiters", () => {
      // Use token limit of 8 so each ~5-token paragraph gets its own chunk
      const chunker = createChunker({
        maxChunkTokens: 8,
        overlapTokens: 0,
        respectParagraphs: true,
        respectPageBoundaries: false,
      });

      // Standard \n\n between paragraphs: lines 1, 2(blank), 3
      const content = "First paragraph.\n\nSecond paragraph.";
      const result = createMockExtractionResult({ content });
      const chunks = chunker.chunkDocument(result, TEST_FILE_PATH, TEST_SOURCE);

      expect(chunks.length).toBe(2);
      expect(chunks[0]!.startLine).toBe(1);
      expect(chunks[0]!.endLine).toBe(1);
      // Second paragraph at line 3 (after 2 newlines)
      expect(chunks[1]!.startLine).toBe(3);
      expect(chunks[1]!.endLine).toBe(3);
    });

    test("throws on empty filePath", () => {
      const chunker = createChunker();
      const result = createMockExtractionResult();

      expect(() => chunker.chunkDocument(result, "", TEST_SOURCE)).toThrow();
      expect(() => chunker.chunkDocument(result, "   ", TEST_SOURCE)).toThrow();
    });
  });

  describe("FileChunker inheritance", () => {
    test("inherits from FileChunker", () => {
      const chunker = createChunker();
      // chunkFile should be available from FileChunker
      expect(typeof chunker.chunkFile).toBe("function");
    });

    test("chunkFile still works for code files", () => {
      const chunker = createChunker();
      const fileInfo = {
        relativePath: "src/app.ts",
        absolutePath: "/repo/src/app.ts",
        extension: ".ts",
        sizeBytes: 100,
        modifiedAt: new Date(),
      };
      const chunks = chunker.chunkFile("const x = 1;\nconst y = 2;\n", fileInfo, "test-repo");

      expect(chunks.length).toBe(1);
      expect(chunks[0]!.content).toContain("const x = 1");
    });
  });

  describe("Interaction between options", () => {
    test("page boundaries take priority over paragraph boundaries", () => {
      const chunker = createChunker({
        maxChunkTokens: 500,
        respectPageBoundaries: true,
        respectParagraphs: true,
      });
      const result = createMultiPageExtractionResult(2, 20);
      const chunks = chunker.chunkDocument(result, TEST_FILE_PATH, TEST_SOURCE);

      // Page-based chunking should be used since pages are available
      for (const chunk of chunks) {
        expect(chunk.metadata.pageNumber).toBeDefined();
      }
    });

    test("paragraph chunking used when no pages available but respectPageBoundaries=true", () => {
      const chunker = createChunker({
        maxChunkTokens: 200,
        overlapTokens: 0,
        respectPageBoundaries: true,
        respectParagraphs: true,
      });
      const result = createMockExtractionResult({
        content: PARAGRAPH_DOCUMENT_CONTENT,
        pages: undefined,
      });
      const chunks = chunker.chunkDocument(result, TEST_FILE_PATH, TEST_SOURCE);

      // Should fall through to paragraph chunking since no pages
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      for (const chunk of chunks) {
        expect(chunk.metadata.pageNumber).toBeUndefined();
      }
    });

    test("all options disabled falls back to line-level chunking", () => {
      const chunker = createChunker({
        maxChunkTokens: 200,
        overlapTokens: 20,
        respectPageBoundaries: false,
        respectParagraphs: false,
        includeSectionContext: false,
      });
      const result = createMockExtractionResult({
        content: PARAGRAPH_DOCUMENT_CONTENT,
      });
      const chunks = chunker.chunkDocument(result, TEST_FILE_PATH, TEST_SOURCE);

      expect(chunks.length).toBeGreaterThanOrEqual(1);
      for (const chunk of chunks) {
        expect(chunk.metadata.pageNumber).toBeUndefined();
        expect(chunk.metadata.sectionHeading).toBeUndefined();
      }
    });
  });
});
