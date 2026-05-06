/**
 * Unit tests for LocalFolderChangeDetector (T3.1 acceptance).
 *
 * @module tests/services/local-folder-change-detector
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, rm, utimes } from "node:fs/promises";
import { join } from "node:path";
import { LocalFolderChangeDetector } from "../../src/services/local-folder-change-detector.js";
import {
  FileManifestStoreImpl,
  type FileManifest,
} from "../../src/services/file-manifest-store.js";
import { initializeLogger, resetLogger } from "../../src/logging/index.js";
import type { RepositoryInfo } from "../../src/repositories/types.js";

function makeRepo(name: string, localPath: string): RepositoryInfo {
  return {
    name,
    source: "local-folder",
    url: null,
    localPath,
    collectionName: `repo_${name}`,
    fileCount: 0,
    chunkCount: 0,
    lastIndexedAt: new Date().toISOString(),
    indexDurationMs: 0,
    status: "ready",
    branch: "(local-folder)",
    includeExtensions: [".ts", ".md"],
    excludePatterns: [],
  };
}

describe("LocalFolderChangeDetector", () => {
  let testDir: string;
  let dataDir: string;
  let store: FileManifestStoreImpl;

  beforeEach(async () => {
    initializeLogger({ level: "silent", format: "json" });
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    testDir = join(import.meta.dir, "..", "..", "test-temp", `lfcd-${stamp}`);
    dataDir = join(import.meta.dir, "..", "..", "test-temp", `lfcd-data-${stamp}`);
    await mkdir(testDir, { recursive: true });
    await mkdir(dataDir, { recursive: true });
    FileManifestStoreImpl.resetInstance();
    store = FileManifestStoreImpl.getInstance(dataDir);
  });

  afterEach(async () => {
    FileManifestStoreImpl.resetInstance();
    await rm(testDir, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
    resetLogger();
  });

  it("detects added files when manifest is empty", async () => {
    await writeFile(join(testDir, "a.ts"), "console.log(1);");
    await writeFile(join(testDir, "b.ts"), "console.log(2);");
    const repo = makeRepo("test", testDir);

    const detector = new LocalFolderChangeDetector(store);
    const result = await detector.detect(repo);

    const adds = result.changes
      .filter((c) => c.status === "added")
      .map((c) => c.path)
      .sort();
    expect(adds).toEqual(["a.ts", "b.ts"]);
    expect(Object.keys(result.nextManifestFiles).sort()).toEqual(["a.ts", "b.ts"]);
  });

  it("detects modified files (size differs)", async () => {
    await writeFile(join(testDir, "a.ts"), "v1");
    const repo = makeRepo("test", testDir);
    const detector = new LocalFolderChangeDetector(store);

    // Seed manifest from initial scan.
    const initial = await detector.detect(repo);
    await store.saveManifest(repo.name, {
      version: "1.0",
      repository: repo.name,
      generatedAt: new Date().toISOString(),
      files: initial.nextManifestFiles,
    });

    // Modify content (size changes).
    await writeFile(join(testDir, "a.ts"), "v2-longer");
    const result = await detector.detect(repo);

    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toEqual({ path: "a.ts", status: "modified" });
  });

  it("detects modified files when mtime differs but size is identical (rare)", async () => {
    // Two equal-length contents with different bytes.
    await writeFile(join(testDir, "a.ts"), "AAAA");
    const repo = makeRepo("test", testDir);
    const detector = new LocalFolderChangeDetector(store);
    const initial = await detector.detect(repo);
    await store.saveManifest(repo.name, {
      version: "1.0",
      repository: repo.name,
      generatedAt: new Date().toISOString(),
      files: initial.nextManifestFiles,
    });

    // Same length, different content. Bump mtime to trigger the slow path.
    await writeFile(join(testDir, "a.ts"), "BBBB");
    const future = new Date(Date.now() + 60_000);
    await utimes(join(testDir, "a.ts"), future, future);

    const result = await detector.detect(repo);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]?.status).toBe("modified");
  });

  it("treats touch-only (mtime drift, hash match) as no change", async () => {
    await writeFile(join(testDir, "a.ts"), "stable");
    const repo = makeRepo("test", testDir);
    const detector = new LocalFolderChangeDetector(store);
    const initial = await detector.detect(repo);
    await store.saveManifest(repo.name, {
      version: "1.0",
      repository: repo.name,
      generatedAt: new Date().toISOString(),
      files: initial.nextManifestFiles,
    });

    // Same bytes, future mtime → triggers hash recomputation, hashes match → skip.
    const future = new Date(Date.now() + 120_000);
    await utimes(join(testDir, "a.ts"), future, future);

    const result = await detector.detect(repo);
    expect(result.changes).toEqual([]);
  });

  it("detects deletions", async () => {
    await writeFile(join(testDir, "a.ts"), "x");
    await writeFile(join(testDir, "b.ts"), "y");
    const repo = makeRepo("test", testDir);
    const detector = new LocalFolderChangeDetector(store);
    const initial = await detector.detect(repo);
    await store.saveManifest(repo.name, {
      version: "1.0",
      repository: repo.name,
      generatedAt: new Date().toISOString(),
      files: initial.nextManifestFiles,
    });

    await rm(join(testDir, "b.ts"));
    const result = await detector.detect(repo);
    expect(result.changes).toEqual([{ path: "b.ts", status: "deleted" }]);
  });

  it("paranoid mode hashes every file even on apparent (size, mtime) match", async () => {
    // Goal: verify paranoid mode catches a content change that the fast path
    // would miss because mtime + size happen to be unchanged. Filesystem mtime
    // preservation across writeFile + utimes is platform-dependent (Windows
    // NTFS rounds to ~16 ms in some configurations), so this test does not
    // assert that the fast path actually misses — only that paranoid catches.
    await writeFile(join(testDir, "a.ts"), "AAAA");
    const repo = makeRepo("test", testDir);
    const detector = new LocalFolderChangeDetector(store);
    const initial = await detector.detect(repo);
    const seedManifest = {
      version: "1.0" as const,
      repository: repo.name,
      generatedAt: new Date().toISOString(),
      files: initial.nextManifestFiles,
    };
    await store.saveManifest(repo.name, seedManifest);

    // Same length, different bytes. Force mtime back to the seeded value so
    // the fast path *might* skip on platforms with mtime preservation.
    await writeFile(join(testDir, "a.ts"), "BBBB");
    const original = initial.nextManifestFiles["a.ts"];
    if (!original) throw new Error("seed manifest missing a.ts");
    await utimes(join(testDir, "a.ts"), new Date(original.mtimeMs), new Date(original.mtimeMs));

    // Re-seed manifest after the second write so the prior fingerprint matches
    // what stat() now reports — this isolates the "content-changed-but-fast-path-
    // would-skip" condition from any mtime jitter.
    const stale = await detector.detect(repo);
    const staleEntry = stale.nextManifestFiles["a.ts"]!;
    await store.saveManifest(repo.name, {
      version: "1.0",
      repository: repo.name,
      generatedAt: new Date().toISOString(),
      // Persist the OLD (AAAA) sha256 against the NEW (BBBB) size+mtime so the
      // fast path matches but the content actually differs.
      files: {
        "a.ts": {
          sha256: original.sha256,
          sizeBytes: staleEntry.sizeBytes,
          mtimeMs: staleEntry.mtimeMs,
        },
      },
    });

    const paranoid = await detector.detect(repo, { paranoid: true });
    expect(paranoid.changes).toEqual([{ path: "a.ts", status: "modified" }]);
  });

  it("excludes files outside the include-extensions whitelist", async () => {
    await writeFile(join(testDir, "code.ts"), "x");
    await writeFile(join(testDir, "binary.bin"), "x");
    const repo = makeRepo("test", testDir);
    repo.includeExtensions = [".ts"];

    const detector = new LocalFolderChangeDetector(store);
    const result = await detector.detect(repo);
    const paths = result.changes.map((c) => c.path);
    expect(paths).toEqual(["code.ts"]);
    // `toHaveProperty` treats "." as a path separator, so use array form
    // to look up the literal "code.ts" key.
    expect(result.nextManifestFiles["code.ts"]).toBeDefined();
    expect(result.nextManifestFiles["binary.bin"]).toBeUndefined();
  });

  it("respects nested .gitignore", async () => {
    await mkdir(join(testDir, "src"), { recursive: true });
    await writeFile(join(testDir, ".gitignore"), "build/\n");
    await mkdir(join(testDir, "build"), { recursive: true });
    await writeFile(join(testDir, "build", "out.ts"), "x");
    await writeFile(join(testDir, "src", "in.ts"), "x");

    const repo = makeRepo("test", testDir);
    const detector = new LocalFolderChangeDetector(store);
    const result = await detector.detect(repo);
    const paths = result.changes.map((c) => c.path).sort();
    expect(paths).toEqual(["src/in.ts"]);
  });

  it("buildNextManifest returns a well-formed manifest envelope", () => {
    const detector = new LocalFolderChangeDetector(store);
    const m: FileManifest = detector.buildNextManifest("repo", {
      "a.ts": { sha256: "0".repeat(64), sizeBytes: 4, mtimeMs: 1 },
    });
    expect(m.version).toBe("1.0");
    expect(m.repository).toBe("repo");
    expect(m.files["a.ts"]?.sha256.length).toBe(64);
    // generatedAt is a valid ISO string
    expect(() => new Date(m.generatedAt).toISOString()).not.toThrow();
  });
});
