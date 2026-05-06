/**
 * Unit tests for `DocEntityExtractor` (Phase D / issue #567).
 *
 * Covers:
 * - Section hierarchy with `CONTAINS_SECTION` parent linkage
 * - Frontmatter title vs first-H1 vs filename fallback
 * - Markdown link extraction (intra-repo + external)
 * - Wikilink discovery (raw target captured; resolution is the resolver's job)
 * - Inline code mention filtering (camelCase / PascalCase, length >= 4)
 */

import { describe, it, expect } from "bun:test";
import { DocEntityExtractor } from "../../../../src/graph/extraction/DocEntityExtractor.js";

describe("DocEntityExtractor", () => {
  const extractor = new DocEntityExtractor();

  it("supports .md and .markdown only", () => {
    expect(DocEntityExtractor.isSupported("notes.md")).toBe(true);
    expect(DocEntityExtractor.isSupported("notes.markdown")).toBe(true);
    expect(DocEntityExtractor.isSupported("notes.MD")).toBe(true);
    expect(DocEntityExtractor.isSupported("notes.txt")).toBe(false);
    expect(DocEntityExtractor.isSupported("notes.pdf")).toBe(false);
  });

  it("builds a hierarchical section tree from headings", () => {
    const md = `# Top
intro

## Sub A
body a

### Sub A.1
deep

## Sub B
body b
`;
    const result = extractor.extractFromContent(md, "doc.md");
    expect(result.success).toBe(true);
    expect(result.sections).toHaveLength(4);

    const top = result.sections[0]!;
    const subA = result.sections[1]!;
    const subA1 = result.sections[2]!;
    const subB = result.sections[3]!;

    expect(top.title).toBe("Top");
    expect(top.level).toBe(1);
    expect(top.parentId).toBeUndefined();

    expect(subA.parentId).toBe(top.id);
    expect(subA1.parentId).toBe(subA.id);
    expect(subB.parentId).toBe(top.id);
  });

  it("falls back to first H1 when no frontmatter title", () => {
    const md = "# The Title\n\nbody";
    const result = extractor.extractFromContent(md, "x.md");
    expect(result.title).toBe("The Title");
  });

  it("uses frontmatter title when provided", () => {
    const md = "# Heading In Body\n\nbody";
    const result = extractor.extractFromContent(md, "x.md", {
      frontmatterTitle: "From Frontmatter",
    });
    expect(result.title).toBe("From Frontmatter");
  });

  it("falls back to filename stem when no headings or frontmatter", () => {
    const md = "just body content with no headings";
    const result = extractor.extractFromContent(md, "path/to/my-notes.md");
    expect(result.title).toBe("my-notes");
  });

  it("counts words in body content", () => {
    const md = "# T\n\none two three four five";
    const result = extractor.extractFromContent(md, "x.md");
    // 7 whitespace-separated tokens: "#", "T", "one", "two", "three", "four", "five".
    // Word count is over the raw normalized buffer (not stripped of markup),
    // which keeps the implementation simple — heading markers only inflate
    // counts by 1 per heading.
    expect(result.wordCount).toBe(7);
  });

  it("captures markdown links with raw target", () => {
    const md = `# T

See [other](./other.md) and [external](https://example.com).
`;
    const result = extractor.extractFromContent(md, "x.md");
    const targets = result.unresolvedLinks
      .filter((l) => l.type === "markdown")
      .map((l) => l.target);
    expect(targets).toContain("./other.md");
    expect(targets).toContain("https://example.com");
  });

  it("captures wikilinks", () => {
    const md = "# T\n\nReference to [[OtherPage]] and [[AuthService]].";
    const result = extractor.extractFromContent(md, "x.md");
    const wikilinks = result.unresolvedLinks.filter((l) => l.type === "wikilink");
    expect(wikilinks.map((l) => l.target).sort()).toEqual(["AuthService", "OtherPage"]);
  });

  it("emits high-confidence mentions for code-shaped backtick spans", () => {
    const md = "# T\n\nUse `AuthService.validate` and `parseToken`.";
    const result = extractor.extractFromContent(md, "x.md");
    const idents = result.codeMentions.map((m) => m.identifier).sort();
    expect(idents).toContain("AuthService.validate");
    expect(idents).toContain("parseToken");
    for (const m of result.codeMentions) {
      expect(m.confidence).toBe("high");
    }
  });

  it("skips short or all-lowercase backtick spans (likely English words)", () => {
    const md = "# T\n\nThe `the` and `bar` and `is` are English words.";
    const result = extractor.extractFromContent(md, "x.md");
    expect(result.codeMentions).toHaveLength(0);
  });

  it("attributes references to the deepest containing section", () => {
    const md = `# Top

## Sub

See \`AuthService\` here.
`;
    const result = extractor.extractFromContent(md, "x.md");
    const mention = result.codeMentions[0]!;
    const sub = result.sections.find((s) => s.title === "Sub")!;
    expect(mention.sourceSectionId).toBe(sub.id);
  });
});
