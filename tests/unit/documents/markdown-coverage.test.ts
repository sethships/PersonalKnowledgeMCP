/**
 * Markdown coverage invariant tests for the shared-parse refactor (T6.5).
 *
 * Asserts:
 * 1. `MarkdownParser` exposes `tokens` and `normalizedSource` on the result
 *    so downstream consumers (chunker AND `DocEntityExtractor`) can share one parse.
 * 2. `DocumentChunker` chunks of a markdown extraction collectively cover every
 *    paragraph of the normalized source — no body content is dropped on the floor.
 *
 * The second assertion is the load-bearing invariant from issue #567 T6.5:
 * "the entire document MUST remain indexed."
 */

import { describe, it, expect, beforeAll } from "bun:test";
import * as path from "node:path";
import { MarkdownParser } from "../../../src/documents/extractors/MarkdownParser.js";
import { DocumentChunker } from "../../../src/documents/DocumentChunker.js";
import { initializeLogger } from "../../../src/logging/index.js";

const FIXTURE_DIR = path.resolve(__dirname, "../../fixtures/documents/markdown");
const FIXTURES = ["simple.md", "with-frontmatter.md", "gfm.md", "with-code.md"];

describe("MarkdownParser shared-parse output (T6.5)", () => {
  beforeAll(() => {
    initializeLogger({ level: "error", format: "json" });
  });

  for (const fixture of FIXTURES) {
    it(`exposes tokens and normalizedSource for ${fixture}`, async () => {
      const parser = new MarkdownParser();
      const result = await parser.extract(path.join(FIXTURE_DIR, fixture));

      expect(result.tokens).toBeDefined();
      expect(Array.isArray(result.tokens)).toBe(true);
      expect((result.tokens ?? []).length).toBeGreaterThan(0);

      expect(result.normalizedSource).toBeDefined();
      expect(result.normalizedSource).toBe(result.content);
    });
  }
});

describe("Markdown chunk coverage invariant (T6.5)", () => {
  beforeAll(() => {
    initializeLogger({ level: "error", format: "json" });
  });

  for (const fixture of FIXTURES) {
    it(`every body paragraph of ${fixture} appears in at least one chunk`, async () => {
      const parser = new MarkdownParser();
      const result = await parser.extract(path.join(FIXTURE_DIR, fixture));

      const chunker = new DocumentChunker({ maxChunkTokens: 200, overlapTokens: 0 });
      const chunks = chunker.chunkDocument(result, fixture, "test-source");
      expect(chunks.length).toBeGreaterThan(0);

      // Concatenated chunk text must contain every non-trivial paragraph of the
      // normalized source. We check by paragraph rather than character because
      // the chunker may reflow whitespace between adjacent paragraphs.
      const allChunkText = chunks.map((c) => c.content).join("\n\n");
      const normalized = result.normalizedSource ?? result.content;
      const paragraphs = normalized
        .split(/\n\n+/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

      for (const para of paragraphs) {
        // Compare on the first non-trivial line of the paragraph to avoid
        // false negatives from whitespace reflow inside a paragraph.
        const firstLine = para.split("\n")[0]?.trim() ?? "";
        if (firstLine.length === 0) continue;
        expect(allChunkText).toContain(firstLine);
      }
    });
  }
});
