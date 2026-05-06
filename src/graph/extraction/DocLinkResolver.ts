/**
 * Two-phase link resolution for the document graph (Phase D, issue #567).
 *
 * Each `DocEntityExtractor` / `PdfDocxEntityExtractor` invocation emits links
 * and mentions that cannot be resolved per-file because the lookup tables
 * (doc titles, path stems, code symbols) are repo-wide. `DocLinkResolver`
 * runs after all extractors complete *and* after Phase 6 of
 * `GraphIngestionService` has inserted code entities — at which point both
 * doc-side and code-side tables are fully populated.
 *
 * The resolver is pure: it consumes inputs and returns edge specs.
 * `GraphIngestionService` owns the actual `MERGE` writes.
 *
 * Wikilink precedence (from issue #567 T6.2):
 *   1. document title    (case-insensitive exact match)
 *   2. path stem         (basename without extension)
 *   3. section anchor    (`Page#Section`)
 *   4. code symbol       (bare identifier — qualified names not supported in v1)
 *
 * First match wins. Subsequent matches are logged at debug level (the caller's
 * logger; the resolver returns a list of debug messages to keep the module
 * IO-free and unit-testable).
 *
 * @module graph/extraction/DocLinkResolver
 */

import { createHash } from "node:crypto";
import * as path from "node:path";
import type {
  DocExtractionResult,
  DocLinkData,
  DocMentionData,
  DocSectionData,
  ExternalLinkSpec,
  ResolvedDocEdge,
  SymbolRef,
} from "./doc-types.js";

export interface ResolverInput {
  /** All extracted documents in this ingestion run, keyed by file path. */
  documents: readonly DocExtractionResult[];
  /** Repository name — used to scope deterministic Document node ids. */
  repository: string;
  /** Repo-wide code-symbol index (built after Phase 6 completes). */
  symbolIndex: ReadonlyMap<string, SymbolRef>;
}

export interface ResolverOutput {
  /** Resolved edges ready for batched `MERGE`. */
  edges: ResolvedDocEdge[];
  /** External-link node specs that the writer needs to MERGE before edges. */
  externalLinks: ExternalLinkSpec[];
  /**
   * Debug-level messages for ambiguous resolutions (extra matches beyond the
   * winning tier). Caller decides whether to surface them.
   */
  debug: string[];
}

export class DocLinkResolver {
  resolve(input: ResolverInput): ResolverOutput {
    const edges: ResolvedDocEdge[] = [];
    const externalLinks: ExternalLinkSpec[] = [];
    const debug: string[] = [];

    const titleIndex = this.buildTitleIndex(input.documents);
    const stemIndex = this.buildPathStemIndex(input.documents);
    const sectionIndex = this.buildSectionIndex(input.documents);

    for (const doc of input.documents) {
      const docId = documentId(input.repository, doc.filePath);

      // Section hierarchy edges.
      for (const section of doc.sections) {
        edges.push({ type: "HAS_SECTION", fromId: docId, toId: section.id });
        if (section.parentId) {
          edges.push({
            type: "CONTAINS_SECTION",
            fromId: section.parentId,
            toId: section.id,
          });
        }
      }

      // Markdown-style links resolve by URL shape.
      for (const link of doc.unresolvedLinks) {
        if (link.type === "markdown") {
          this.resolveMarkdownLink(
            doc,
            docId,
            link,
            input,
            titleIndex,
            stemIndex,
            edges,
            externalLinks
          );
        } else {
          this.resolveWikilink(
            doc,
            docId,
            link,
            input,
            titleIndex,
            stemIndex,
            sectionIndex,
            edges,
            debug
          );
        }
      }

      // Code-symbol mentions.
      for (const mention of doc.codeMentions) {
        this.resolveMention(doc, docId, mention, input.symbolIndex, edges, debug);
      }
    }

    return { edges, externalLinks, debug };
  }

  private buildTitleIndex(
    docs: readonly DocExtractionResult[]
  ): Map<string, DocExtractionResult> {
    const map = new Map<string, DocExtractionResult>();
    for (const doc of docs) {
      const key = doc.title.toLowerCase();
      if (!map.has(key)) map.set(key, doc); // first wins
    }
    return map;
  }

  private buildPathStemIndex(
    docs: readonly DocExtractionResult[]
  ): Map<string, DocExtractionResult> {
    const map = new Map<string, DocExtractionResult>();
    for (const doc of docs) {
      const stem = path
        .basename(doc.filePath, path.extname(doc.filePath))
        .toLowerCase();
      if (!map.has(stem)) map.set(stem, doc);
    }
    return map;
  }

  private buildSectionIndex(
    docs: readonly DocExtractionResult[]
  ): Map<string, { doc: DocExtractionResult; section: DocSectionData }> {
    const map = new Map<string, { doc: DocExtractionResult; section: DocSectionData }>();
    for (const doc of docs) {
      const stem = path.basename(doc.filePath, path.extname(doc.filePath)).toLowerCase();
      for (const section of doc.sections) {
        const anchor = section.title.toLowerCase().replace(/\s+/g, "-");
        // Index both `stem#anchor` and `title#anchor` so wikilinks can use either.
        map.set(`${stem}#${anchor}`, { doc, section });
        map.set(`${doc.title.toLowerCase()}#${anchor}`, { doc, section });
      }
    }
    return map;
  }

  private resolveMarkdownLink(
    sourceDoc: DocExtractionResult,
    sourceDocId: string,
    link: DocLinkData,
    input: ResolverInput,
    _titleIndex: Map<string, DocExtractionResult>,
    stemIndex: Map<string, DocExtractionResult>,
    edges: ResolvedDocEdge[],
    externalLinks: ExternalLinkSpec[]
  ): void {
    const target = link.target;
    if (this.isExternal(target)) {
      const spec: ExternalLinkSpec = {
        id: externalLinkId(target),
        url: target,
      };
      externalLinks.push(spec);
      edges.push({
        type: "LINKS_TO",
        fromId: sourceDocId,
        toId: spec.id,
      });
      return;
    }

    // Treat as a relative path. Resolve against the source document's directory.
    const cleanTarget = target.split("#")[0]!.split("?")[0]!;
    if (cleanTarget.length === 0) return; // pure-anchor link; ignore in v1
    const resolved = path
      .posix.normalize(path.posix.join(path.posix.dirname(sourceDoc.filePath), cleanTarget))
      .replace(/\\/g, "/");

    const targetDoc = input.documents.find(
      (d) => d.filePath === resolved || normalize(d.filePath) === normalize(resolved)
    );
    if (targetDoc) {
      edges.push({
        type: "LINKS_TO",
        fromId: sourceDocId,
        toId: documentId(input.repository, targetDoc.filePath),
      });
      return;
    }

    // Stem fallback for shorthand links like `[x](AuthService)`.
    const stem = path
      .basename(cleanTarget, path.extname(cleanTarget))
      .toLowerCase();
    const stemDoc = stemIndex.get(stem);
    if (stemDoc) {
      edges.push({
        type: "LINKS_TO",
        fromId: sourceDocId,
        toId: documentId(input.repository, stemDoc.filePath),
      });
      return;
    }

    // No intra-repo resolution. Fall through to ExternalLink (the link is
    // technically internal-shaped but unmatched — record as external with the
    // raw target so the graph still reflects the outbound reference).
    const spec: ExternalLinkSpec = {
      id: externalLinkId(target),
      url: target,
    };
    externalLinks.push(spec);
    edges.push({ type: "LINKS_TO", fromId: sourceDocId, toId: spec.id });
  }

  private resolveWikilink(
    _sourceDoc: DocExtractionResult,
    sourceDocId: string,
    link: DocLinkData,
    input: ResolverInput,
    titleIndex: Map<string, DocExtractionResult>,
    stemIndex: Map<string, DocExtractionResult>,
    sectionIndex: Map<string, { doc: DocExtractionResult; section: DocSectionData }>,
    edges: ResolvedDocEdge[],
    debug: string[]
  ): void {
    const raw = link.target;

    // Tier 1: doc title.
    const byTitle = titleIndex.get(raw.toLowerCase());
    if (byTitle) {
      edges.push({
        type: "LINKS_TO",
        fromId: sourceDocId,
        toId: documentId(input.repository, byTitle.filePath),
      });
      this.logExtraTiers(raw, "title", stemIndex, sectionIndex, input.symbolIndex, debug);
      return;
    }

    // Tier 2: path stem.
    const byStem = stemIndex.get(raw.toLowerCase());
    if (byStem) {
      edges.push({
        type: "LINKS_TO",
        fromId: sourceDocId,
        toId: documentId(input.repository, byStem.filePath),
      });
      this.logExtraTiers(raw, "stem", stemIndex, sectionIndex, input.symbolIndex, debug);
      return;
    }

    // Tier 3: section anchor.
    const bySection = sectionIndex.get(raw.toLowerCase());
    if (bySection) {
      edges.push({
        type: "LINKS_TO",
        fromId: sourceDocId,
        toId: bySection.section.id,
      });
      return;
    }

    // Tier 4: code symbol (bare identifier, case-sensitive).
    const symbol = input.symbolIndex.get(raw);
    if (symbol) {
      edges.push({
        type: "MENTIONS",
        fromId: sourceDocId,
        toId: symbol.id,
        properties: { confidence: "high" },
      });
      return;
    }

    debug.push(`wikilink unresolved: [[${raw}]] in ${sourceDocId}`);
  }

  private resolveMention(
    _sourceDoc: DocExtractionResult,
    sourceDocId: string,
    mention: DocMentionData,
    symbolIndex: ReadonlyMap<string, SymbolRef>,
    edges: ResolvedDocEdge[],
    debug: string[]
  ): void {
    const ref = symbolIndex.get(mention.identifier);
    if (!ref) {
      debug.push(`mention unresolved: \`${mention.identifier}\` in ${sourceDocId}`);
      return;
    }
    edges.push({
      type: "MENTIONS",
      fromId: sourceDocId,
      toId: ref.id,
      properties: { confidence: mention.confidence },
    });
  }

  private isExternal(target: string): boolean {
    return /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//");
  }

  private logExtraTiers(
    raw: string,
    winningTier: string,
    stemIndex: Map<string, DocExtractionResult>,
    sectionIndex: Map<string, { doc: DocExtractionResult; section: DocSectionData }>,
    symbolIndex: ReadonlyMap<string, SymbolRef>,
    debug: string[]
  ): void {
    const lower = raw.toLowerCase();
    const otherMatches: string[] = [];
    if (winningTier !== "stem" && stemIndex.has(lower)) otherMatches.push("stem");
    if (winningTier !== "section" && sectionIndex.has(lower)) otherMatches.push("section");
    if (winningTier !== "symbol" && symbolIndex.has(raw)) otherMatches.push("symbol");
    if (otherMatches.length > 0) {
      debug.push(
        `wikilink [[${raw}]] resolved to ${winningTier}; other tier matches ignored: ${otherMatches.join(", ")}`
      );
    }
  }
}

export function documentId(repository: string, filePath: string): string {
  return `Document:${repository}:${filePath}`;
}

function externalLinkId(url: string): string {
  const hash = createHash("sha1").update(url).digest("hex").slice(0, 16);
  return `ExternalLink:${hash}`;
}

function normalize(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+/g, "/");
}
