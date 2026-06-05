/**
 * Per-file PDF/DOCX extractor for the document graph (Phase D, issue #567).
 *
 * Consumes an already-extracted `ExtractionResult` from `PdfExtractor` /
 * `DocxExtractor` and emits a `DocExtractionResult` with low-confidence
 * MENTIONS for code-shaped tokens. Per #567 T6b.1:
 *
 * - DOCX inherits the existing heading hierarchy (`DocxExtractor.parseSections()`).
 * - PDF in v1 stands alone — no `Section` hierarchy. Outline / bookmark
 *   extraction is fragile across pdf-parse and pdfjs-dist; deferred to v2.
 * - No `LINKS_TO` edges in v1 (PDF/DOCX hyperlink extraction is not yet wired
 *   up).
 * - Code-symbol mentions are emitted at `confidence: "low"` with the same
 *   shape filter used for markdown high-confidence mentions: length >= 4 and
 *   at least one uppercase letter after the first character.
 *
 * Like `DocEntityExtractor`, this class is decoupled from `RepositoryInfo`.
 *
 * @module graph/extraction/PdfDocxEntityExtractor
 */

import * as path from "node:path";
import type { ExtractionResult as DocsExtractionResult } from "../../documents/types.js";
import type { DocExtractionResult, DocMentionData, DocSectionData } from "./doc-types.js";
import { createHash } from "node:crypto";

const SUPPORTED_EXTENSIONS = new Set([".pdf", ".docx"]);

/**
 * Identifier shape: same rule used by `DocEntityExtractor` for high-confidence
 * mentions. Tokens shorter than 4 chars or all-lowercase are dropped because
 * heuristic matches against PDF/DOCX prose generate too many false positives
 * otherwise (`User`, `Config`, `Status` would all collide with code symbols).
 *
 * Unlike `DocEntityExtractor.looksLikeCodeIdentifier`, the PDF/DOCX regex
 * stops at `.` because PDF prose lacks the backtick boundary that
 * disambiguates `AuthService.validate` from `… AuthService. Validate …`.
 * Markdown can rely on the codespan delimiter to scope the identifier and
 * therefore tolerates dotted accessors and a leading underscore; PDF cannot.
 */

function looksLikeCodeIdentifier(text: string): boolean {
  if (text.length < 4) return false;
  return /[A-Z]/.test(text.slice(1));
}

export class PdfDocxEntityExtractor {
  static isSupported(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return SUPPORTED_EXTENSIONS.has(ext);
  }

  /**
   * Convert an `ExtractionResult` from `PdfExtractor` / `DocxExtractor` into a
   * `DocExtractionResult` suitable for `DocLinkResolver`.
   */
  extractFromExtractionResult(
    extraction: DocsExtractionResult,
    filePath: string
  ): DocExtractionResult {
    const start = Date.now();
    const ext = path.extname(filePath).toLowerCase();
    const format: "pdf" | "docx" = ext === ".pdf" ? "pdf" : "docx";

    const sections =
      format === "docx" && extraction.sections
        ? this.toSectionData(filePath, extraction.sections)
        : [];

    const codeMentions = this.collectMentions(extraction.content, sections);
    const title = this.resolveTitle(extraction.metadata.title, sections, filePath);

    return {
      filePath,
      format,
      title,
      wordCount: extraction.metadata.wordCount ?? this.countWords(extraction.content),
      pageCount: extraction.metadata.pageCount,
      sections,
      // No LINKS_TO emitted in v1 for PDF/DOCX.
      unresolvedLinks: [],
      codeMentions,
      parseTimeMs: Date.now() - start,
      errors: [],
      success: true,
    };
  }

  private toSectionData(
    filePath: string,
    rawSections: ReadonlyArray<{
      title: string;
      level: number;
      startOffset: number;
      endOffset: number;
    }>
  ): DocSectionData[] {
    const out: DocSectionData[] = [];
    const stack: DocSectionData[] = [];
    for (let i = 0; i < rawSections.length; i++) {
      const r = rawSections[i]!;
      while (stack.length > 0 && stack[stack.length - 1]!.level >= r.level) {
        stack.pop();
      }
      const parentId = stack.length > 0 ? stack[stack.length - 1]!.id : undefined;
      const id = sectionId(filePath, i, r.level, r.title);
      const section: DocSectionData = {
        id,
        level: r.level,
        title: r.title,
        parentId,
        startChar: r.startOffset,
        endChar: r.endOffset,
      };
      out.push(section);
      stack.push(section);
    }
    return out;
  }

  private collectMentions(content: string, sections: readonly DocSectionData[]): DocMentionData[] {
    if (!content) return [];
    // Local regex instance avoids cross-call lastIndex hazards if the method
    // ever runs in overlapping contexts (concurrency footgun mitigation).
    const identRe = /\b[A-Za-z][A-Za-z0-9_]{3,}\b/g;
    const seen = new Set<string>();
    const out: DocMentionData[] = [];
    let m: RegExpExecArray | null;
    while ((m = identRe.exec(content)) !== null) {
      const text = m[0];
      if (!looksLikeCodeIdentifier(text)) continue;
      // Dedupe within a single document; the resolver will MERGE edges, but
      // pre-dedup keeps the payload smaller.
      const sectionId = sectionContaining(sections, m.index)?.id;
      const key = `${text}|${sectionId ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ identifier: text, sourceSectionId: sectionId, confidence: "low" });
    }
    return out;
  }

  private resolveTitle(
    metadataTitle: string | undefined,
    sections: readonly DocSectionData[],
    filePath: string
  ): string {
    if (metadataTitle && metadataTitle.trim().length > 0) {
      return metadataTitle.trim();
    }
    if (sections.length > 0) return sections[0]!.title;
    return path.basename(filePath, path.extname(filePath));
  }

  private countWords(content: string): number {
    if (!content) return 0;
    const matches = content.match(/\S+/g);
    return matches ? matches.length : 0;
  }
}

function sectionContaining(
  sections: readonly DocSectionData[],
  charPos: number
): DocSectionData | undefined {
  let match: DocSectionData | undefined;
  for (const s of sections) {
    if (charPos >= s.startChar && charPos < s.endChar) {
      if (!match || s.level > match.level) match = s;
    }
  }
  return match;
}

function sectionId(filePath: string, index: number, level: number, title: string): string {
  const hash = createHash("sha1")
    .update(`${filePath}|${index}|${level}|${title}`)
    .digest("hex")
    .slice(0, 12);
  return `Section:${hash}`;
}
