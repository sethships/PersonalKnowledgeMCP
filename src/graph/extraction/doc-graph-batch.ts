/**
 * Doc-graph batch helper (issue #580).
 *
 * Centralizes the markdown-vs-PDF/DOCX dispatch that turns a doc file into a
 * `DocExtractionResult` ready for `GraphIngestionService.ingestDocumentGraph`.
 * Three production code paths use this:
 *
 * 1. `IngestionService.processDocumentFile` (full-repo indexing) — calls
 *    `fromExtraction` because the chunking pipeline already produced an
 *    `ExtractionResult`.
 * 2. `IncrementalUpdatePipeline.processDocumentFile` (incremental updates) —
 *    same reason as (1).
 * 3. `graph-populate` / `graph-populate-all` CLI commands — call `fromFile`
 *    because they scan the filesystem standalone without prior chunking.
 *
 * The two shapes are kept separate so the chunking-aware callers don't
 * re-parse PDFs or DOCX files just to build the doc-graph payload.
 *
 * @module graph/extraction/doc-graph-batch
 */

import * as fs from "node:fs/promises";
import { extname } from "node:path";
import type { Token } from "marked";
import { DocEntityExtractor } from "./DocEntityExtractor.js";
import { PdfDocxEntityExtractor } from "./PdfDocxEntityExtractor.js";
import type { DocExtractionResult } from "./doc-types.js";
import type { DocumentTypeDetector } from "../../documents/DocumentTypeDetector.js";
import type { ExtractionResult, MarkdownExtractionResult } from "../../documents/types.js";

const MARKDOWN_LIKE_EXTS = new Set([".md", ".markdown", ".txt"]);
const PDF_DOCX_EXTS = new Set([".pdf", ".docx"]);

/**
 * Whether `relativePath` is a doc-graph-eligible file. Returns false for
 * code files, images, and unknown extensions. Used by callers that want
 * to filter their file list before invoking the batcher.
 */
export function isDocGraphFile(relativePath: string): boolean {
  const ext = extname(relativePath).toLowerCase();
  return MARKDOWN_LIKE_EXTS.has(ext) || PDF_DOCX_EXTS.has(ext);
}

/**
 * Builds `DocExtractionResult` payloads for `ingestDocumentGraph`.
 *
 * Stateless aside from the two extractor instances cached on construction
 * so callers can build a batch without re-allocating per file.
 */
export class DocGraphBatcher {
  private readonly docEntity = new DocEntityExtractor();
  private readonly pdfDocx = new PdfDocxEntityExtractor();

  /**
   * Build a `DocExtractionResult` from an already-parsed `ExtractionResult`.
   *
   * For markdown / txt files, reuses the lexer tokens and frontmatter title
   * surfaced by `MarkdownParser` so we don't re-lex the file.
   * For pdf / docx files, hands the existing `ExtractionResult` to
   * `PdfDocxEntityExtractor`.
   *
   * Returns `null` for unsupported extensions (images, code, etc.).
   */
  fromExtraction(
    relativePath: string,
    extraction: ExtractionResult
  ): DocExtractionResult | null {
    const ext = extname(relativePath).toLowerCase();
    if (MARKDOWN_LIKE_EXTS.has(ext)) {
      const md = extraction as MarkdownExtractionResult;
      return this.docEntity.extractFromContent(
        md.normalizedSource ?? md.content,
        relativePath,
        {
          tokens: md.tokens as readonly Token[] | undefined,
          frontmatterTitle: md.frontmatter?.title,
        }
      );
    }
    if (PDF_DOCX_EXTS.has(ext)) {
      return this.pdfDocx.extractFromExtractionResult(extraction, relativePath);
    }
    return null;
  }

  /**
   * Build a `DocExtractionResult` by reading the file from disk.
   *
   * Used by the graph populate CLI commands which scan the filesystem
   * standalone (no chunking pipeline). For pdf / docx files this runs the
   * full document extractor; markdown / txt files are read as utf-8 and
   * lexed inside `DocEntityExtractor`.
   *
   * Returns `null` for unsupported extensions or when the detector has no
   * extractor for the file.
   */
  async fromFile(
    absolutePath: string,
    relativePath: string,
    detector: DocumentTypeDetector
  ): Promise<DocExtractionResult | null> {
    const ext = extname(relativePath).toLowerCase();
    if (MARKDOWN_LIKE_EXTS.has(ext)) {
      const content = await fs.readFile(absolutePath, "utf-8");
      return this.docEntity.extractFromContent(content, relativePath);
    }
    if (PDF_DOCX_EXTS.has(ext)) {
      const extractor = detector.getExtractor(absolutePath);
      if (!extractor) return null;
      const extraction = (await extractor.extract(absolutePath)) as ExtractionResult;
      return this.pdfDocx.extractFromExtractionResult(extraction, relativePath);
    }
    return null;
  }
}
