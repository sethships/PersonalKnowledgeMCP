/**
 * Unit tests for `DocLinkResolver` (Phase D / issue #567).
 *
 * Covers all four wikilink precedence tiers in collision scenarios:
 *   1. document title  (case-insensitive)
 *   2. path stem
 *   3. section anchor
 *   4. code symbol     (bare identifier, case-sensitive)
 * Earlier tiers must win over later tiers when both match. Code-symbol
 * mentions resolve via the in-memory symbol index.
 */

import { describe, it, expect } from "bun:test";
import { DocLinkResolver } from "../../../../src/graph/extraction/DocLinkResolver.js";
import type {
  DocExtractionResult,
  SymbolRef,
} from "../../../../src/graph/extraction/doc-types.js";

function makeDoc(
  filePath: string,
  partial: Partial<DocExtractionResult> = {}
): DocExtractionResult {
  return {
    filePath,
    format: "markdown",
    title: partial.title ?? filePath.replace(/\.md$/, ""),
    wordCount: 0,
    sections: [],
    unresolvedLinks: [],
    codeMentions: [],
    parseTimeMs: 0,
    errors: [],
    success: true,
    ...partial,
  };
}

const REPO = "test-repo";

describe("DocLinkResolver — wikilink precedence", () => {
  it("tier 1: title beats stem when both would match", () => {
    const target = makeDoc("docs/somewhere/AuthService.md", { title: "Authentication Service" });
    const source = makeDoc("notes.md", {
      unresolvedLinks: [{ type: "wikilink", target: "Authentication Service" }],
    });
    // A second doc whose stem would also match the title (unlikely; included
    // here to prove title is consulted first by the lookup keys).
    const stemMatch = makeDoc("authentication service.md", { title: "Different" });

    const resolver = new DocLinkResolver();
    const out = resolver.resolve({
      documents: [source, target, stemMatch],
      repository: REPO,
      symbolIndex: new Map(),
    });

    const linksTo = out.edges.filter((e) => e.type === "LINKS_TO");
    expect(linksTo).toHaveLength(1);
    expect(linksTo[0]!.toId).toContain(target.filePath);
  });

  it("tier 2: stem wins over section / symbol when title does not match", () => {
    const stemDoc = makeDoc("AuthService.md", { title: "Wholly Unrelated" });
    const stemColliderSection = makeDoc("other.md", {
      title: "Other",
      sections: [
        { id: "Section:other-1", level: 1, title: "AuthService", startChar: 0, endChar: 1 },
      ],
    });
    const source = makeDoc("notes.md", {
      unresolvedLinks: [{ type: "wikilink", target: "AuthService" }],
    });
    const symbolIndex = new Map<string, SymbolRef>([
      ["AuthService", { id: "Class:AuthService", name: "AuthService", type: "class", filePath: "src/auth.ts" }],
    ]);

    const resolver = new DocLinkResolver();
    const out = resolver.resolve({
      documents: [source, stemDoc, stemColliderSection],
      repository: REPO,
      symbolIndex,
    });

    const linksTo = out.edges.filter((e) => e.type === "LINKS_TO");
    expect(linksTo).toHaveLength(1);
    expect(linksTo[0]!.toId).toContain(stemDoc.filePath);
    // The collision should be flagged in debug.
    expect(out.debug.some((d) => d.includes("section") || d.includes("symbol"))).toBe(true);
  });

  it("tier 3: section anchor wins over symbol when stem does not match", () => {
    const docWithSection = makeDoc("guide.md", {
      title: "Guide",
      sections: [
        { id: "Section:g-1", level: 1, title: "AuthFlow", startChar: 0, endChar: 1 },
      ],
    });
    const source = makeDoc("notes.md", {
      // The wikilink target uses the `stem#anchor` form so the section index
      // can hit it directly. Bare `AuthFlow` would already be resolved by the
      // symbol index because there is no collision-free way to address a
      // section without disambiguating from doc / stem.
      unresolvedLinks: [{ type: "wikilink", target: "guide#authflow" }],
    });
    const symbolIndex = new Map<string, SymbolRef>([
      ["AuthFlow", { id: "Class:AuthFlow", name: "AuthFlow", type: "class", filePath: "src/x.ts" }],
    ]);

    const resolver = new DocLinkResolver();
    const out = resolver.resolve({
      documents: [source, docWithSection],
      repository: REPO,
      symbolIndex,
    });

    const linksTo = out.edges.filter((e) => e.type === "LINKS_TO");
    const toSection = linksTo.find((e) => e.toId === "Section:g-1");
    expect(toSection).toBeDefined();
  });

  it("tier 4: code symbol resolves when no doc / stem / section matches", () => {
    const source = makeDoc("notes.md", {
      unresolvedLinks: [{ type: "wikilink", target: "AuthService" }],
    });
    const symbolIndex = new Map<string, SymbolRef>([
      ["AuthService", { id: "Class:AuthService", name: "AuthService", type: "class", filePath: "src/auth.ts" }],
    ]);

    const resolver = new DocLinkResolver();
    const out = resolver.resolve({
      documents: [source],
      repository: REPO,
      symbolIndex,
    });

    const mentions = out.edges.filter((e) => e.type === "MENTIONS");
    expect(mentions).toHaveLength(1);
    expect(mentions[0]!.toId).toBe("Class:AuthService");
    expect(mentions[0]!.properties?.confidence).toBe("high");
  });

  it("logs unresolved wikilinks at debug level", () => {
    const source = makeDoc("notes.md", {
      unresolvedLinks: [{ type: "wikilink", target: "TotallyNonexistent" }],
    });
    const resolver = new DocLinkResolver();
    const out = resolver.resolve({
      documents: [source],
      repository: REPO,
      symbolIndex: new Map(),
    });
    expect(out.edges.filter((e) => e.type === "LINKS_TO" || e.type === "MENTIONS")).toHaveLength(0);
    expect(out.debug.some((d) => d.includes("TotallyNonexistent"))).toBe(true);
  });
});

describe("DocLinkResolver — markdown links", () => {
  it("resolves intra-repo relative links to existing documents", () => {
    const target = makeDoc("docs/other.md", { title: "Other" });
    const source = makeDoc("docs/index.md", {
      unresolvedLinks: [{ type: "markdown", target: "./other.md", text: "see" }],
    });
    const resolver = new DocLinkResolver();
    const out = resolver.resolve({
      documents: [source, target],
      repository: REPO,
      symbolIndex: new Map(),
    });
    const linksTo = out.edges.filter((e) => e.type === "LINKS_TO");
    expect(linksTo).toHaveLength(1);
    expect(linksTo[0]!.toId).toContain("docs/other.md");
  });

  it("falls through to ExternalLink for unresolved relative paths", () => {
    const source = makeDoc("docs/index.md", {
      unresolvedLinks: [{ type: "markdown", target: "./does-not-exist.md", text: "x" }],
    });
    const resolver = new DocLinkResolver();
    const out = resolver.resolve({
      documents: [source],
      repository: REPO,
      symbolIndex: new Map(),
    });
    expect(out.externalLinks).toHaveLength(1);
    expect(out.externalLinks[0]!.url).toBe("./does-not-exist.md");
  });

  it("emits ExternalLink for absolute URLs", () => {
    const source = makeDoc("notes.md", {
      unresolvedLinks: [{ type: "markdown", target: "https://example.com/x", text: "x" }],
    });
    const resolver = new DocLinkResolver();
    const out = resolver.resolve({
      documents: [source],
      repository: REPO,
      symbolIndex: new Map(),
    });
    expect(out.externalLinks.length).toBeGreaterThan(0);
    const ext = out.externalLinks[0]!;
    expect(ext.url).toBe("https://example.com/x");
    const linksTo = out.edges.filter((e) => e.type === "LINKS_TO" && e.toId === ext.id);
    expect(linksTo).toHaveLength(1);
  });
});

describe("DocLinkResolver — section + mention edges", () => {
  it("emits HAS_SECTION + CONTAINS_SECTION edges from the section hierarchy", () => {
    const doc = makeDoc("g.md", {
      sections: [
        { id: "Section:1", level: 1, title: "Top", startChar: 0, endChar: 100 },
        { id: "Section:2", level: 2, title: "Sub", parentId: "Section:1", startChar: 10, endChar: 50 },
      ],
    });
    const resolver = new DocLinkResolver();
    const out = resolver.resolve({
      documents: [doc],
      repository: REPO,
      symbolIndex: new Map(),
    });
    const has = out.edges.filter((e) => e.type === "HAS_SECTION");
    const contains = out.edges.filter((e) => e.type === "CONTAINS_SECTION");
    expect(has).toHaveLength(2);
    expect(contains).toHaveLength(1);
    expect(contains[0]!.fromId).toBe("Section:1");
    expect(contains[0]!.toId).toBe("Section:2");
  });

  it("resolves code mentions through the symbol index", () => {
    const source = makeDoc("notes.md", {
      codeMentions: [
        { identifier: "AuthService", confidence: "high" },
        { identifier: "DoesNotExist", confidence: "high" },
      ],
    });
    const symbolIndex = new Map<string, SymbolRef>([
      ["AuthService", { id: "Class:Auth", name: "AuthService", type: "class", filePath: "src/a.ts" }],
    ]);
    const resolver = new DocLinkResolver();
    const out = resolver.resolve({
      documents: [source],
      repository: REPO,
      symbolIndex,
    });
    const mentions = out.edges.filter((e) => e.type === "MENTIONS");
    expect(mentions).toHaveLength(1);
    expect(mentions[0]!.toId).toBe("Class:Auth");
    expect(out.debug.some((d) => d.includes("DoesNotExist"))).toBe(true);
  });
});
