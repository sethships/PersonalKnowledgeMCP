/**
 * Unit tests for GitignoreFilter (T2.3 / T2.4 acceptance).
 *
 * @module tests/ingestion/gitignore-filter
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { GitignoreFilter } from "../../src/ingestion/gitignore-filter.js";
import { initializeLogger, resetLogger } from "../../src/logging/index.js";

describe("GitignoreFilter", () => {
  let testDir: string;

  beforeEach(async () => {
    initializeLogger({ level: "silent", format: "json" });
    testDir = join(import.meta.dir, "..", "..", "test-temp", `gitignore-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
    resetLogger();
  });

  it("returns false (not ignored) when no .gitignore exists anywhere", async () => {
    await writeFile(join(testDir, "a.ts"), "x");
    await mkdir(join(testDir, "src"), { recursive: true });
    await writeFile(join(testDir, "src", "b.ts"), "x");

    const filter = await GitignoreFilter.load(testDir);

    expect(filter.isIgnored(join(testDir, "a.ts"))).toBe(false);
    expect(filter.isIgnored(join(testDir, "src", "b.ts"))).toBe(false);
    expect(filter.ruleFileCount).toBe(0);
  });

  it("honors a root .gitignore", async () => {
    await writeFile(join(testDir, ".gitignore"), "node_modules/\n*.log\n");
    await mkdir(join(testDir, "node_modules"), { recursive: true });
    await writeFile(join(testDir, "node_modules", "pkg.js"), "x");
    await writeFile(join(testDir, "app.log"), "x");
    await writeFile(join(testDir, "app.ts"), "x");

    const filter = await GitignoreFilter.load(testDir);

    expect(filter.isIgnored(join(testDir, "node_modules", "pkg.js"))).toBe(true);
    expect(filter.isIgnored(join(testDir, "app.log"))).toBe(true);
    expect(filter.isIgnored(join(testDir, "app.ts"))).toBe(false);
  });

  it("merges nested .gitignore so a deeper rule scopes correctly", async () => {
    // Root says ignore *.tmp; nested folder /docs/.gitignore adds *.bak.
    await writeFile(join(testDir, ".gitignore"), "*.tmp\n");
    await mkdir(join(testDir, "docs"), { recursive: true });
    await writeFile(join(testDir, "docs", ".gitignore"), "*.bak\n");
    await writeFile(join(testDir, "x.tmp"), "x");
    await writeFile(join(testDir, "docs", "y.tmp"), "x");
    await writeFile(join(testDir, "docs", "z.bak"), "x");
    await writeFile(join(testDir, "y.bak"), "x");
    await writeFile(join(testDir, "keep.md"), "x");

    const filter = await GitignoreFilter.load(testDir);

    // Root rule applies everywhere.
    expect(filter.isIgnored(join(testDir, "x.tmp"))).toBe(true);
    expect(filter.isIgnored(join(testDir, "docs", "y.tmp"))).toBe(true);
    // Nested rule only inside docs/.
    expect(filter.isIgnored(join(testDir, "docs", "z.bak"))).toBe(true);
    expect(filter.isIgnored(join(testDir, "y.bak"))).toBe(false);
    // Files not matched by either rule.
    expect(filter.isIgnored(join(testDir, "keep.md"))).toBe(false);
  });

  it("supports negation (!keep.txt) in a nested .gitignore", async () => {
    await writeFile(join(testDir, ".gitignore"), "*.txt\n");
    await mkdir(join(testDir, "vendor"), { recursive: true });
    // Inside vendor we want to keep one specific txt file.
    await writeFile(join(testDir, "vendor", ".gitignore"), "!keep.txt\n");
    await writeFile(join(testDir, "vendor", "drop.txt"), "x");
    await writeFile(join(testDir, "vendor", "keep.txt"), "x");
    await writeFile(join(testDir, "drop-too.txt"), "x");

    const filter = await GitignoreFilter.load(testDir);

    expect(filter.isIgnored(join(testDir, "drop-too.txt"))).toBe(true);
    expect(filter.isIgnored(join(testDir, "vendor", "drop.txt"))).toBe(true);
    expect(filter.isIgnored(join(testDir, "vendor", "keep.txt"))).toBe(false);
  });

  it("rejects paths outside the root as ignored (defense against escapes)", async () => {
    const filter = await GitignoreFilter.load(testDir);
    // A sibling path outside the rootPath is reported ignored — callers must not
    // accidentally process files outside the registered folder.
    expect(filter.isIgnored("C:/some/other/path/file.ts")).toBe(true);
  });

  it("filterAbsolute returns only paths that survive the filter", async () => {
    await writeFile(join(testDir, ".gitignore"), "node_modules/\n");
    await mkdir(join(testDir, "node_modules"), { recursive: true });
    await writeFile(join(testDir, "node_modules", "x.js"), "x");
    await writeFile(join(testDir, "src.ts"), "x");

    const filter = await GitignoreFilter.load(testDir);
    const survivors = filter.filterAbsolute([
      join(testDir, "node_modules", "x.js"),
      join(testDir, "src.ts"),
    ]);

    expect(survivors).toEqual([join(testDir, "src.ts")]);
  });

  it("does not crash on unreadable .gitignore (logged + skipped)", async () => {
    // Write a directory at the .gitignore path — readFile will fail with EISDIR.
    await mkdir(join(testDir, ".gitignore"), { recursive: true });
    await writeFile(join(testDir, "a.ts"), "x");

    const filter = await GitignoreFilter.load(testDir);
    expect(filter.isIgnored(join(testDir, "a.ts"))).toBe(false);
  });
});
