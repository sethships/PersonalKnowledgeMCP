/**
 * Type definitions for document-graph extraction (Phase D, issue #567).
 *
 * These types describe the per-file output of `DocEntityExtractor` (markdown)
 * and `PdfDocxEntityExtractor`. Edge resolution happens later, in
 * `DocLinkResolver`, once repo-wide lookup tables are available — this is the
 * "two-phase" extraction pattern that lets MENTIONS edges reach symbols
 * inserted earlier in the same ingestion run.
 *
 * The result types are deliberately decoupled from `RepositoryInfo.source` so
 * the extractors can be reused by a future `WatchedFolder` pipeline.
 *
 * @module graph/extraction/doc-types
 */

/**
 * Document format. Drives downstream behavior in `DocLinkResolver` (markdown
 * resolves wikilinks; PDF/DOCX skip link resolution in v1) and is recorded on
 * the resulting `Document` graph node.
 */
export type DocumentFormat = "markdown" | "pdf" | "docx";

/**
 * Confidence level for `MENTIONS` edges.
 *
 * - `"high"`: markdown inline code (e.g. `` `AuthService` ``) — author opted in.
 * - `"low"`: PDF/DOCX heuristic regex match — collision-prone, filterable.
 */
export type MentionConfidence = "high" | "low";

/**
 * One section heading in a document. `Section` nodes are internal-only in v1
 * (not surfaced via `get_architecture` or other MCP tools); they exist so
 * `MENTIONS` and `LINKS_TO` edges can record which section a reference came
 * from when richer surfacing is added later.
 */
export interface DocSectionData {
  /** Stable id, scoped to the owning document. */
  id: string;
  /** Heading level 1-6. */
  level: number;
  /** Heading text. */
  title: string;
  /** Parent section id for `CONTAINS_SECTION` edges, or undefined for top-level. */
  parentId?: string;
  /** Character offset in the normalized source where the section starts. */
  startChar: number;
  /** Character offset in the normalized source where the section ends. */
  endChar: number;
}

/**
 * An unresolved link discovered during extraction. Resolution to a concrete
 * graph edge is the resolver's job — at this stage we only know the raw target.
 */
export interface DocLinkData {
  /** `markdown` for `[text](url)`; `wikilink` for `[[Target]]`. */
  type: "markdown" | "wikilink";
  /** Raw target string. URL for markdown, page name for wikilink. */
  target: string;
  /** Anchor text for markdown links; undefined for wikilinks. */
  text?: string;
  /** Section the link appeared in, or undefined for document-level. */
  sourceSectionId?: string;
}

/**
 * An inline code-symbol mention. Markdown emits these for backtick-wrapped
 * identifiers; the resolver matches them against the repo-wide symbol index.
 */
export interface DocMentionData {
  /** Identifier as it appeared in the document. */
  identifier: string;
  /** Section the mention appeared in, or undefined for document-level. */
  sourceSectionId?: string;
  /** Confidence tier — markdown inline code is `"high"`. */
  confidence: MentionConfidence;
}

/**
 * Per-file extraction result. Repository name is *not* embedded — it is
 * injected by `GraphIngestionService` when generating node ids and writing
 * to the graph.
 */
export interface DocExtractionResult {
  /** Path of the source file (passed in by the caller). */
  filePath: string;
  /** Document format. */
  format: DocumentFormat;
  /** Resolved title (frontmatter > first H1 > filename stem). */
  title: string;
  /** Word count of the body content. */
  wordCount: number;
  /** Page count for PDF/DOCX; undefined for markdown. */
  pageCount?: number;
  /** Section hierarchy. Empty for documents with no headings. */
  sections: DocSectionData[];
  /** Unresolved links (markdown only in v1). */
  unresolvedLinks: DocLinkData[];
  /** Code-symbol mentions awaiting resolution. */
  codeMentions: DocMentionData[];
  /** Parse time in ms (for telemetry / benchmarks). */
  parseTimeMs: number;
  /** Non-fatal errors. A non-empty list does not by itself imply failure. */
  errors: string[];
  /** False if the file could not be parsed at all. */
  success: boolean;
}

/**
 * Symbol entry in the repo-wide in-memory index used by `DocLinkResolver`.
 */
export interface SymbolRef {
  /** Graph node id. */
  id: string;
  /** Identifier name (e.g. `AuthService`). */
  name: string;
  /** Entity kind. */
  type: "function" | "class" | "module";
  /** Source file path of the definition. */
  filePath: string;
}

/**
 * Resolved edge specification, ready for graph insertion. The resolver returns
 * these in lieu of writing directly so `GraphIngestionService` keeps full
 * control over batching, MERGE strategy, and idempotency.
 */
export interface ResolvedDocEdge {
  /** Edge type. */
  type: "LINKS_TO" | "MENTIONS" | "CONTAINS_SECTION" | "HAS_SECTION";
  /** Source node id (always a `Document` or `Section`). */
  fromId: string;
  /** Target node id (`Document`, `Section`, `ExternalLink`, or code entity). */
  toId: string;
  /** Properties to set on the edge (e.g. `confidence`). */
  properties?: Record<string, unknown>;
}

/**
 * `ExternalLink` node spec. The resolver produces these for markdown links
 * that point outside the repository so the graph can still reflect the
 * outbound connection.
 */
export interface ExternalLinkSpec {
  /** Deterministic id: `ExternalLink:{hash(url)}`. */
  id: string;
  /** Original URL. */
  url: string;
}
