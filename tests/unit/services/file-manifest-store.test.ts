/**
 * Unit tests for FileManifestStoreImpl
 *
 * Real-disk tests using a per-test tmpdir, mirroring the watched-folder-store
 * unit-test pattern. The acceptance criterion in issue #564 is 100% line
 * coverage for the manifest store, including the concurrent-write
 * serialization path.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "bun:test";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { initializeLogger, resetLogger } from "../../../src/logging/index.js";
import {
  FileManifestStoreImpl,
  type FileManifest,
  type FileManifestEntry,
} from "../../../src/services/file-manifest-store.js";

beforeAll(() => {
  initializeLogger({ level: "silent", format: "json" });
});

afterAll(() => {
  resetLogger();
});

describe("FileManifestStoreImpl", () => {
  let tmpDir: string;

  beforeEach(() => {
    FileManifestStoreImpl.resetInstance();
    tmpDir = path.join(
      os.tmpdir(),
      `file-manifest-store-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    FileManifestStoreImpl.resetInstance();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("Singleton Pattern", () => {
    it("returns same instance on multiple getInstance calls", () => {
      const a = FileManifestStoreImpl.getInstance(tmpDir);
      const b = FileManifestStoreImpl.getInstance(tmpDir);
      expect(a).toBe(b);
    });

    it("uses default DATA_PATH when no path provided", () => {
      const instance = FileManifestStoreImpl.getInstance();
      expect(instance).toBeDefined();
    });

    it("ignores subsequent dataPath after init (warns)", () => {
      const first = FileManifestStoreImpl.getInstance(tmpDir);
      const second = FileManifestStoreImpl.getInstance(`${tmpDir}-other`);
      expect(second).toBe(first);
    });

    it("resetInstance() clears the singleton", () => {
      const a = FileManifestStoreImpl.getInstance(tmpDir);
      FileManifestStoreImpl.resetInstance();
      const b = FileManifestStoreImpl.getInstance(tmpDir);
      expect(a).not.toBe(b);
    });
  });

  describe("getManifestPath", () => {
    it("uses sanitizeCollectionName for filesystem-safe filenames", () => {
      const store = FileManifestStoreImpl.getInstance(tmpDir);
      const filePath = store.getManifestPath("My-API");
      expect(filePath).toBe(path.join(tmpDir, "manifests", "repo_my_api.json"));
    });
  });

  describe("loadManifest", () => {
    it("returns an empty manifest when no file exists (does NOT create the file)", async () => {
      const store = FileManifestStoreImpl.getInstance(tmpDir);
      const manifest = await store.loadManifest("missing-repo");

      expect(manifest.version).toBe("1.0");
      expect(manifest.repository).toBe("missing-repo");
      expect(manifest.files).toEqual({});
      expect(typeof manifest.generatedAt).toBe("string");

      // Confirm we did NOT write a manifest file as a side effect
      expect(fs.existsSync(store.getManifestPath("missing-repo"))).toBe(false);
    });

    it("loads a previously saved manifest from disk", async () => {
      const store = FileManifestStoreImpl.getInstance(tmpDir);
      const original = buildManifest("alpha", {
        "src/index.ts": { sha256: "a".repeat(64), sizeBytes: 100, mtimeMs: 1234 },
      });
      await store.saveManifest("alpha", original);

      // Reset the singleton so the in-memory cache doesn't short-circuit the read
      FileManifestStoreImpl.resetInstance();
      const store2 = FileManifestStoreImpl.getInstance(tmpDir);
      const reloaded = await store2.loadManifest("alpha");

      expect(reloaded.repository).toBe("alpha");
      expect(reloaded.files["src/index.ts"]).toEqual({
        sha256: "a".repeat(64),
        sizeBytes: 100,
        mtimeMs: 1234,
      });
    });

    it("hits the in-memory cache on second load", async () => {
      const store = FileManifestStoreImpl.getInstance(tmpDir);
      const m = buildManifest("cached-repo", {
        "a.ts": { sha256: "b".repeat(64), sizeBytes: 1, mtimeMs: 1 },
      });
      await store.saveManifest("cached-repo", m);

      // First load populates from save; delete the on-disk file to prove the
      // second load returns the cached copy without touching disk.
      const filePath = store.getManifestPath("cached-repo");
      fs.unlinkSync(filePath);

      const reloaded = await store.loadManifest("cached-repo");
      expect(reloaded.files["a.ts"]?.sha256).toBe("b".repeat(64));
    });

    it("surfaces an error when the manifest file contains malformed JSON", async () => {
      const store = FileManifestStoreImpl.getInstance(tmpDir);
      const filePath = store.getManifestPath("broken");
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, "{ this is not JSON }", "utf-8");

      await expect(store.loadManifest("broken")).rejects.toThrow();
    });

    it("surfaces an error when the manifest fails schema validation", async () => {
      const store = FileManifestStoreImpl.getInstance(tmpDir);
      const filePath = store.getManifestPath("schema-bad");
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(
        filePath,
        JSON.stringify({ version: "0.9", repository: "schema-bad", files: {} }),
        "utf-8"
      );

      await expect(store.loadManifest("schema-bad")).rejects.toThrow();
    });

    it("returns a deep-copied manifest so mutation does not pollute the cache", async () => {
      const store = FileManifestStoreImpl.getInstance(tmpDir);
      await store.saveManifest(
        "iso",
        buildManifest("iso", {
          "a.ts": { sha256: "c".repeat(64), sizeBytes: 1, mtimeMs: 1 },
        })
      );
      const first = await store.loadManifest("iso");
      first.files["evil.ts"] = { sha256: "x".repeat(64), sizeBytes: 0, mtimeMs: 0 };

      const second = await store.loadManifest("iso");
      expect(second.files["evil.ts"]).toBeUndefined();
    });
  });

  describe("saveManifest", () => {
    it("auto-creates the manifests/ directory and writes a JSON file", async () => {
      const store = FileManifestStoreImpl.getInstance(tmpDir);
      const filePath = store.getManifestPath("auto-dir");

      // Manifests directory should NOT exist before the first save
      expect(fs.existsSync(path.dirname(filePath))).toBe(false);

      await store.saveManifest("auto-dir", buildManifest("auto-dir", {}));

      expect(fs.existsSync(path.dirname(filePath))).toBe(true);
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it("persists the full manifest schema verbatim", async () => {
      const store = FileManifestStoreImpl.getInstance(tmpDir);
      const manifest = buildManifest("schema", {
        "lib/util.ts": { sha256: "d".repeat(64), sizeBytes: 42, mtimeMs: 9999 },
        "src/main.ts": { sha256: "e".repeat(64), sizeBytes: 1024, mtimeMs: 1700000000000 },
      });
      manifest.generatedAt = "2026-05-05T12:00:00.000Z";

      await store.saveManifest("schema", manifest);

      const onDisk = JSON.parse(fs.readFileSync(store.getManifestPath("schema"), "utf-8"));
      expect(onDisk).toEqual({
        version: "1.0",
        repository: "schema",
        generatedAt: "2026-05-05T12:00:00.000Z",
        files: {
          "lib/util.ts": { sha256: "d".repeat(64), sizeBytes: 42, mtimeMs: 9999 },
          "src/main.ts": { sha256: "e".repeat(64), sizeBytes: 1024, mtimeMs: 1700000000000 },
        },
      });
    });

    it("forces the persisted repository field to match the argument (storage authority)", async () => {
      const store = FileManifestStoreImpl.getInstance(tmpDir);
      const manifest = buildManifest("WRONG-REPO", {});

      await store.saveManifest("right-repo", manifest);

      const onDisk = JSON.parse(fs.readFileSync(store.getManifestPath("right-repo"), "utf-8"));
      expect(onDisk.repository).toBe("right-repo");
    });

    it("does not leave a .tmp file behind on success", async () => {
      const store = FileManifestStoreImpl.getInstance(tmpDir);
      await store.saveManifest("clean", buildManifest("clean", {}));

      const filePath = store.getManifestPath("clean");
      expect(fs.existsSync(`${filePath}.tmp`)).toBe(false);
    });

    it("cleans up the temp file when rename fails (target path is a directory)", async () => {
      const store = FileManifestStoreImpl.getInstance(tmpDir);
      const filePath = store.getManifestPath("rename-fail");

      // Pre-create the manifests/ directory plus a directory at the target
      // file path. The rename in saveManifestInternal will fail because the
      // destination is a directory, exercising the catch-block cleanup.
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.mkdirSync(filePath, { recursive: true });

      await expect(
        store.saveManifest("rename-fail", buildManifest("rename-fail", {}))
      ).rejects.toThrow();

      // Temp file should be gone (catch-block unlink ran)
      expect(fs.existsSync(`${filePath}.tmp`)).toBe(false);
      // Destination directory still exists (we didn't rmdir it)
      expect(fs.statSync(filePath).isDirectory()).toBe(true);

      // Clean up the directory we created so afterEach can remove tmpDir
      fs.rmdirSync(filePath);
    });
  });

  describe("deleteManifest", () => {
    it("removes the manifest file and clears the cache", async () => {
      const store = FileManifestStoreImpl.getInstance(tmpDir);
      await store.saveManifest(
        "to-delete",
        buildManifest("to-delete", {
          "a.ts": { sha256: "f".repeat(64), sizeBytes: 1, mtimeMs: 1 },
        })
      );
      const filePath = store.getManifestPath("to-delete");
      expect(fs.existsSync(filePath)).toBe(true);

      await store.deleteManifest("to-delete");

      expect(fs.existsSync(filePath)).toBe(false);

      // After delete, loading returns the empty in-memory shape (cache cleared)
      const reloaded = await store.loadManifest("to-delete");
      expect(reloaded.files).toEqual({});
    });

    it("is idempotent when the manifest file does not exist", async () => {
      const store = FileManifestStoreImpl.getInstance(tmpDir);
      await expect(store.deleteManifest("never-existed")).resolves.toBeUndefined();
    });

    it("propagates non-ENOENT errors (target path is a directory)", async () => {
      const store = FileManifestStoreImpl.getInstance(tmpDir);
      const filePath = store.getManifestPath("perm-denied");

      // unlink on a directory throws EISDIR/EPERM (NOT ENOENT), so the
      // store's catch block must propagate the error rather than swallow it.
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.mkdirSync(filePath, { recursive: true });

      await expect(store.deleteManifest("perm-denied")).rejects.toThrow();

      // Clean up before afterEach
      fs.rmdirSync(filePath);
    });
  });

  describe("Concurrent-write serialization", () => {
    it("serializes many parallel saves so the final file is the last queued payload", async () => {
      const store = FileManifestStoreImpl.getInstance(tmpDir);
      const total = 50;

      const writes: Promise<void>[] = [];
      for (let i = 0; i < total; i++) {
        writes.push(
          store.saveManifest(
            "concurrent",
            buildManifest("concurrent", {
              "a.ts": {
                sha256: i.toString().padStart(64, "0"),
                sizeBytes: i,
                mtimeMs: i,
              },
            })
          )
        );
      }
      await Promise.all(writes);

      // Re-read from disk by clearing the in-memory cache
      FileManifestStoreImpl.resetInstance();
      const store2 = FileManifestStoreImpl.getInstance(tmpDir);
      const final = await store2.loadManifest("concurrent");

      expect(final.files["a.ts"]?.sizeBytes).toBe(total - 1);
      expect(final.files["a.ts"]?.sha256).toBe((total - 1).toString().padStart(64, "0"));
    });
  });

  describe("Cross-repo isolation", () => {
    it("writes to repo A do not affect repo B", async () => {
      const store = FileManifestStoreImpl.getInstance(tmpDir);
      const aFile: FileManifestEntry = { sha256: "a".repeat(64), sizeBytes: 10, mtimeMs: 1 };
      const bFile: FileManifestEntry = { sha256: "b".repeat(64), sizeBytes: 20, mtimeMs: 2 };

      await store.saveManifest("alpha", buildManifest("alpha", { "x.ts": aFile }));
      await store.saveManifest("beta", buildManifest("beta", { "y.ts": bFile }));

      const alpha = await store.loadManifest("alpha");
      const beta = await store.loadManifest("beta");

      expect(alpha.files["x.ts"]).toEqual(aFile);
      expect(alpha.files["y.ts"]).toBeUndefined();
      expect(beta.files["y.ts"]).toEqual(bFile);
      expect(beta.files["x.ts"]).toBeUndefined();
    });
  });
});

function buildManifest(
  repository: string,
  files: Record<string, FileManifestEntry>
): FileManifest {
  return {
    version: "1.0",
    repository,
    generatedAt: new Date("2026-05-05T00:00:00.000Z").toISOString(),
    files,
  };
}
