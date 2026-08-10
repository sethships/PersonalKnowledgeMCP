/**
 * Memory regression test for TreeSitterParser (issue #596).
 *
 * web-tree-sitter allocates syntax trees on the WASM heap, which the JS
 * garbage collector cannot reclaim: version 0.26.x registers no finalizer, so
 * a tree that is never `delete()`d is leaked outright. A full re-index parses
 * tens of thousands of files, which is how a missing `tree.delete()` grew into
 * an out-of-memory crash at ~3.7GB RSS.
 *
 * This test parses a real source file repeatedly and asserts RSS stays flat.
 * Without the fix the same loop retains roughly 49x the source size per
 * iteration, several hundred megabytes over the iteration count used here.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import path from "node:path";
import { TreeSitterParser } from "../../../../src/graph/parsing/TreeSitterParser.js";
import { LanguageLoader } from "../../../../src/graph/parsing/LanguageLoader.js";
import { initializeLogger, resetLogger } from "../../../../src/logging/index.js";

/** Iterations measured after warmup. */
const ITERATIONS = 40;

/** Iterations discarded first, so lazy WASM/grammar init isn't counted. */
const WARMUP_ITERATIONS = 5;

/**
 * Ceiling on RSS growth across the measured iterations.
 *
 * Deliberately generous: the fixed parser holds nothing between iterations,
 * but the WASM heap never shrinks and the runtime is free to keep arenas
 * warm. The unfixed parser blows past this by an order of magnitude.
 */
const MAX_RSS_GROWTH_MB = 100;

describe("TreeSitterParser memory", () => {
  let parser: TreeSitterParser;
  let source: string;

  beforeAll(async () => {
    initializeLogger({ level: "error", format: "json" });
    parser = new TreeSitterParser();

    // Real, non-trivial source: the parser's own implementation (~145KB).
    source = await Bun.file(
      path.join(process.cwd(), "src/graph/parsing/TreeSitterParser.ts")
    ).text();
    expect(source.length).toBeGreaterThan(100_000);
  });

  afterAll(() => {
    LanguageLoader.resetInstance();
    resetLogger();
  });

  it(
    "should not grow RSS when parsing the same file repeatedly",
    async () => {
      for (let i = 0; i < WARMUP_ITERATIONS; i++) {
        await parser.parseFile(source, "TreeSitterParser.ts");
      }

      Bun.gc(true);
      const rssBefore = process.memoryUsage.rss();

      for (let i = 0; i < ITERATIONS; i++) {
        const result = await parser.parseFile(source, "TreeSitterParser.ts");
        expect(result.entities.length).toBeGreaterThan(0);
      }

      Bun.gc(true);

      // Compared in MB so a failure reports the leak size directly.
      const growthMb = Math.round((process.memoryUsage.rss() - rssBefore) / 1024 / 1024);
      expect(growthMb).toBeLessThan(MAX_RSS_GROWTH_MB);
    },
    { timeout: 300_000 }
  );
});
