/**
 * Per-file markdown extractor for the document graph (Phase D, issue #567).
 *
 * Walks the marked token stream produced by `MarkdownParser` (shared parse —
 * see T6.5) and emits a `DocExtractionResult` containing:
 *
 * - the `Document` payload (title + word count),
 * - the `Section` hierarchy,
 * - unresolved markdown / wikilink references,
 * - high-confidence inline code-symbol mentions (backtick-wrapped identifiers).
 *
 * Resolution to concrete graph edges happens in `DocLinkResolver` — this class
 * deliberately does no IO and depends on no repo-wide state, so it can be
 * reused later by `WatchedFolder` (Phase 6) without changes.
 *
 * @module graph/extraction/DocEntityExtractor
 */

import type { Token, Tokens } from "marked";
import { marked } from "marked";
import { createHash } from "node:crypto";
import * as path from "node:path";
import type {
  DocExtractionResult,
  DocLinkData,
  DocMentionData,
  DocSectionData,
} from "./doc-types.js";

const SUPPORTED_EXTENSIONS = new Set([".md", ".markdown"]);

/**
 * Regex for inline code mentions that look like code identifiers. The
 * matching rule mirrors the one used for PDF/DOCX MENTIONS (per the user's
 * decision on the issue): length >= 4 and at least one uppercase letter
 * after the first character. This filters out single-letter and lowercase
 * words like "and"/"the" while keeping `AuthService`, `parseToken`, etc.
 */
function looksLikeCodeIdentifier(text: string): boolean {
  if (text.length < 4) return false;
  if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(text)) return false;
  // Require at least one uppercase letter somewhere after position 0,
  // i.e. `parseToken` (camelCase) or `AuthService` (PascalCase) qualify;
  // `usermap` does not.
  return /[A-Z]/.test(text.slice(1));
}

export class DocEntityExtractor {
  /**
   * Whether this extractor handles the given file by extension.
   */
  static isSupported(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return SUPPORTED_EXTENSIONS.has(ext);
  }

  /**
   * Extract document-graph data from already-parsed markdown.
   *
   * Accepts an optional pre-parsed `tokens` array so callers that already ran
   * `MarkdownParser` (e.g. the chunker) can avoid a second `marked.lexer()`
   * pass. When `tokens` is omitted, the extractor lexes `content` itself.
   */
  extractFromContent(
    content: string,
    filePath: string,
    options?: { tokens?: readonly Token[]; frontmatterTitle?: string }
  ): DocExtractionResult {
    const start = Date.now();
    const errors: string[] = [];
    let success = true;

    let tokens: Token[];
    if (options?.tokens) {
      tokens = options.tokens as Token[];
    } else {
      try {
        tokens = marked.lexer(content, { gfm: true });
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
        success = false;
        tokens = [];
      }
    }

    const sections = this.buildSectionHierarchy(tokens, content, filePath);
    const title = this.resolveTitle(options?.frontmatterTitle, tokens, filePath);
    const wordCount = this.countWords(content);

    const unresolvedLinks: DocLinkData[] = [];
    const codeMentions: DocMentionData[] = [];
    this.walkTokens(tokens, content, sections, unresolvedLinks, codeMentions);
    this.collectWikilinks(content, sections, unresolvedLinks);

    return {
      filePath,
      format: "markdown",
      title,
      wordCount,
      sections,
      unresolvedLinks,
      codeMentions,
      parseTimeMs: Date.now() - start,
      errors,
      success,
    };
  }

  private buildSectionHierarchy(
    tokens: readonly Token[],
    content: string,
    filePath: string
  ): DocSectionData[] {
    const headings: { level: number; title: string; startChar: number }[] = [];
    let searchFrom = 0;
    for (const token of tokens) {
      if (token.type !== "heading") continue;
      const heading = token as Tokens.Heading;
      const idx = content.indexOf(heading.text, searchFrom);
      if (idx === -1) continue;
      // Walk back to the start of the heading line so the section range
      // includes the `#` prefix.
      const lineStart = content.lastIndexOf("\n", idx);
      const startChar = lineStart === -1 ? 0 : lineStart + 1;
      headings.push({ level: heading.depth, title: heading.text, startChar });
      searchFrom = idx + heading.text.length;
    }

    if (headings.length === 0) return [];

    const sections: DocSectionData[] = [];
    const stack: DocSectionData[] = [];
    for (let i = 0; i < headings.length; i++) {
      const h = headings[i]!;
      const next = headings[i + 1];
      const endChar = next ? next.startChar : content.length;
      const id = sectionId(filePath, i, h.level, h.title);

      // Pop the stack until we find a parent with a smaller level.
      while (stack.length > 0 && stack[stack.length - 1]!.level >= h.level) {
        stack.pop();
      }
      const parentId = stack.length > 0 ? stack[stack.length - 1]!.id : undefined;

      const section: DocSectionData = {
        id,
        level: h.level,
        title: h.title,
        parentId,
        startChar: h.startChar,
        endChar,
      };
      sections.push(section);
      stack.push(section);
    }
    return sections;
  }

  private resolveTitle(
    frontmatterTitle: string | undefined,
    tokens: readonly Token[],
    filePath: string
  ): string {
    if (frontmatterTitle && frontmatterTitle.trim().length > 0) {
      return frontmatterTitle.trim();
    }
    for (const token of tokens) {
      if (token.type === "heading" && (token as Tokens.Heading).depth === 1) {
        return (token as Tokens.Heading).text;
      }
    }
    return path.basename(filePath, path.extname(filePath));
  }

  private countWords(content: string): number {
    if (!content) return 0;
    const matches = content.match(/\S+/g);
    return matches ? matches.length : 0;
  }

  /**
   * Walk the token stream, collecting links from `link` tokens and code
   * mentions from `codespan` tokens. Sections are looked up by char-range
   * containment using the `raw` field's position in the source.
   */
  private walkTokens(
    tokens: readonly Token[],
    content: string,
    sections: DocSectionData[],
    links: DocLinkData[],
    mentions: DocMentionData[]
  ): void {
    let cursor = 0;
    const visit = (toks: readonly Token[]): void => {
      for (const token of toks) {
        // Update cursor by locating raw text. This is approximate but good
        // enough to attribute references to a section.
        // TODO(#567 follow-up): repeated identical raw strings can attribute the second occurrence to the wrong section. Use marked offset metadata or pre-compute heading char ranges and bisect on token order.
        if (typeof token.raw === "string") {
          const idx = content.indexOf(token.raw, cursor);
          if (idx !== -1) cursor = idx;
        }

        if (token.type === "link") {
          const link = token as Tokens.Link;
          links.push({
            type: "markdown",
            target: link.href,
            text: link.text,
            sourceSectionId: sectionContaining(sections, cursor)?.id,
          });
        } else if (token.type === "codespan") {
          const code = token as Tokens.Codespan;
          if (looksLikeCodeIdentifier(code.text)) {
            mentions.push({
              identifier: code.text,
              confidence: "high",
              sourceSectionId: sectionContaining(sections, cursor)?.id,
            });
          }
        }

        // Recurse into child tokens (lists, tables, etc.).
        const maybeChildren = (token as { tokens?: Token[] }).tokens;
        if (Array.isArray(maybeChildren) && maybeChildren.length > 0) {
          visit(maybeChildren);
        }
      }
    };
    visit(tokens);
  }

  /**
   * Wikilinks (`[[Target]]`) are not standard markdown, so marked treats them
   * as plain text. We sweep the source separately. The resolver applies
   * precedence (doc title → path stem → section anchor → code symbol).
   */
  private collectWikilinks(
    content: string,
    sections: DocSectionData[],
    links: DocLinkData[]
  ): void {
    // Local regex instance avoids cross-call lastIndex hazards if the method
    // ever runs in overlapping contexts (concurrency footgun mitigation).
    const wikilinkRe = /\[\[([^\]]+)\]\]/g;
    let m: RegExpExecArray | null;
    while ((m = wikilinkRe.exec(content)) !== null) {
      // Obsidian alias: [[Target|display]] — strip everything from `|` on.
      const raw = m[1]!.trim();
      const target = raw.split("|")[0]!.trim();
      if (target.length === 0) continue;
      links.push({
        type: "wikilink",
        target,
        sourceSectionId: sectionContaining(sections, m.index)?.id,
      });
    }
  }
}

function sectionContaining(
  sections: readonly DocSectionData[],
  charPos: number
): DocSectionData | undefined {
  // Iterate in reverse so the deepest matching section wins (we appended
  // sections in document order, parents before children).
  let match: DocSectionData | undefined;
  for (const s of sections) {
    if (charPos >= s.startChar && charPos < s.endChar) {
      // Prefer deeper sections — keep iterating to find the deepest match.
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
