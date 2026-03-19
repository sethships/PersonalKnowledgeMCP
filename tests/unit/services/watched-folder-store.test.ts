/**
 * Unit tests for watched-folder-store.ts
 *
 * Tests the WatchedFolderStoreImpl singleton file-based persistence.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "bun:test";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { initializeLogger, resetLogger } from "../../../src/logging/index.js";
import { WatchedFolderStoreImpl } from "../../../src/services/watched-folder-store.js";
import { createTestFolder } from "../../helpers/folder-fixtures.js";

// Initialize logger for tests
beforeAll(() => {
  initializeLogger({ level: "silent", format: "json" });
});

afterAll(() => {
  resetLogger();
});

describe("WatchedFolderStoreImpl", () => {
  let tmpDir: string;

  beforeEach(() => {
    WatchedFolderStoreImpl.resetInstance();
    // Create a unique temp directory for each test
    tmpDir = path.join(
      os.tmpdir(),
      `watched-folder-store-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    WatchedFolderStoreImpl.resetInstance();
    // Clean up temp directory
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("addFolder", () => {
    it("should add a folder and persist to disk", async () => {
      const store = WatchedFolderStoreImpl.getInstance(tmpDir);
      const folder = createTestFolder({ id: "add-test-1" });

      await store.addFolder(folder);

      // Verify in memory
      const result = await store.getFolder("add-test-1");
      expect(result).not.toBeNull();
      expect(result?.id).toBe("add-test-1");
      expect(result?.name).toBe("Test Folder");

      // Verify file exists on disk
      const filePath = path.join(tmpDir, "watched-folders.json");
      expect(fs.existsSync(filePath)).toBe(true);

      // Verify file content is valid JSON
      const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      expect(content.version).toBe("1.0");
      expect(content.folders).toHaveLength(1);
      expect(content.folders[0].id).toBe("add-test-1");
    });

    it("should upsert when adding a folder with an existing ID", async () => {
      const store = WatchedFolderStoreImpl.getInstance(tmpDir);
      const folder = createTestFolder({ id: "upsert-test-1", name: "Original" });
      await store.addFolder(folder);

      // Add the same ID again with different name
      const duplicate = { ...folder, name: "Updated via Upsert" };
      await store.addFolder(duplicate);

      // Should not create a duplicate
      const all = await store.listFolders();
      expect(all).toHaveLength(1);
      expect(all[0]?.name).toBe("Updated via Upsert");
    });
  });

  describe("listFolders", () => {
    it("should return empty array when file doesn't exist", async () => {
      const store = WatchedFolderStoreImpl.getInstance(tmpDir);
      const folders = await store.listFolders();
      expect(folders).toEqual([]);
    });

    it("should return folders after add", async () => {
      const store = WatchedFolderStoreImpl.getInstance(tmpDir);
      const folder1 = createTestFolder({ id: "list-1", name: "Folder 1" });
      const folder2 = createTestFolder({ id: "list-2", name: "Folder 2" });

      await store.addFolder(folder1);
      await store.addFolder(folder2);

      const folders = await store.listFolders();
      expect(folders).toHaveLength(2);
      expect(folders.map((f) => f.id).sort()).toEqual(["list-1", "list-2"]);
    });
  });

  describe("getFolder", () => {
    it("should return folder by ID", async () => {
      const store = WatchedFolderStoreImpl.getInstance(tmpDir);
      const folder = createTestFolder({ id: "get-test-1", name: "Get Test" });

      await store.addFolder(folder);

      const result = await store.getFolder("get-test-1");
      expect(result).not.toBeNull();
      expect(result?.id).toBe("get-test-1");
      expect(result?.name).toBe("Get Test");
    });

    it("should return null for missing ID", async () => {
      const store = WatchedFolderStoreImpl.getInstance(tmpDir);
      const result = await store.getFolder("non-existent");
      expect(result).toBeNull();
    });
  });

  describe("updateFolder", () => {
    it("should update an existing folder config", async () => {
      const store = WatchedFolderStoreImpl.getInstance(tmpDir);
      const folder = createTestFolder({ id: "update-1", name: "Original" });
      await store.addFolder(folder);

      const updated = { ...folder, name: "Updated Name", fileCount: 99 };
      await store.updateFolder(updated);

      const result = await store.getFolder("update-1");
      expect(result?.name).toBe("Updated Name");
      expect(result?.fileCount).toBe(99);

      // Verify only one folder exists (not duplicated)
      const all = await store.listFolders();
      expect(all).toHaveLength(1);
    });
  });

  describe("removeFolder", () => {
    it("should remove a folder", async () => {
      const store = WatchedFolderStoreImpl.getInstance(tmpDir);
      const folder = createTestFolder({ id: "remove-1" });
      await store.addFolder(folder);

      await store.removeFolder("remove-1");

      const result = await store.getFolder("remove-1");
      expect(result).toBeNull();

      const all = await store.listFolders();
      expect(all).toHaveLength(0);
    });

    it("should be a no-op if folder doesn't exist (no throw)", async () => {
      const store = WatchedFolderStoreImpl.getInstance(tmpDir);
      // Should not throw
      await store.removeFolder("non-existent-id");
      const all = await store.listFolders();
      expect(all).toHaveLength(0);
    });
  });

  describe("persistence across instances", () => {
    it("should persist data across singleton resets", async () => {
      // First instance: add a folder
      const store1 = WatchedFolderStoreImpl.getInstance(tmpDir);
      const folder = createTestFolder({ id: "persist-1", name: "Persistent" });
      await store1.addFolder(folder);

      // Reset singleton and create new instance
      WatchedFolderStoreImpl.resetInstance();
      const store2 = WatchedFolderStoreImpl.getInstance(tmpDir);

      // Verify folder is loaded from disk
      const result = await store2.getFolder("persist-1");
      expect(result).not.toBeNull();
      expect(result?.id).toBe("persist-1");
      expect(result?.name).toBe("Persistent");
    });
  });

  describe("atomic write integrity", () => {
    it("should produce a valid JSON file after add", async () => {
      const store = WatchedFolderStoreImpl.getInstance(tmpDir);
      const folder = createTestFolder({ id: "atomic-1" });
      await store.addFolder(folder);

      const filePath = path.join(tmpDir, "watched-folders.json");
      const raw = fs.readFileSync(filePath, "utf-8");

      // Should not throw on parse
      const parsed = JSON.parse(raw);
      expect(parsed.version).toBe("1.0");
      expect(Array.isArray(parsed.folders)).toBe(true);
      expect(parsed.folders).toHaveLength(1);
    });
  });

  describe("date serialization", () => {
    it("should serialize dates as ISO strings and deserialize back to Date objects", async () => {
      const store1 = WatchedFolderStoreImpl.getInstance(tmpDir);
      const folder = createTestFolder({
        id: "date-test-1",
        createdAt: new Date("2026-03-19T08:30:00.000Z"),
        lastScanAt: new Date("2026-03-19T09:00:00.000Z"),
        updatedAt: new Date("2026-03-19T08:45:00.000Z"),
      });

      await store1.addFolder(folder);

      // Verify on-disk format stores ISO strings
      const filePath = path.join(tmpDir, "watched-folders.json");
      const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      expect(raw.folders[0].createdAt).toBe("2026-03-19T08:30:00.000Z");
      expect(raw.folders[0].lastScanAt).toBe("2026-03-19T09:00:00.000Z");
      expect(raw.folders[0].updatedAt).toBe("2026-03-19T08:45:00.000Z");

      // Reset and reload from disk
      WatchedFolderStoreImpl.resetInstance();
      const store2 = WatchedFolderStoreImpl.getInstance(tmpDir);
      const loaded = await store2.getFolder("date-test-1");

      expect(loaded).not.toBeNull();
      if (!loaded) throw new Error("loaded should not be null");
      expect(loaded.createdAt).toBeInstanceOf(Date);
      expect(loaded.lastScanAt).toBeInstanceOf(Date);
      expect(loaded.updatedAt).toBeInstanceOf(Date);
      expect(loaded.createdAt.toISOString()).toBe("2026-03-19T08:30:00.000Z");
      expect((loaded.lastScanAt as Date).toISOString()).toBe("2026-03-19T09:00:00.000Z");
      expect((loaded.updatedAt as Date).toISOString()).toBe("2026-03-19T08:45:00.000Z");
    });

    it("should handle null date fields", async () => {
      const store1 = WatchedFolderStoreImpl.getInstance(tmpDir);
      const folder = createTestFolder({
        id: "date-null-test",
        lastScanAt: null,
        updatedAt: null,
      });

      await store1.addFolder(folder);

      WatchedFolderStoreImpl.resetInstance();
      const store2 = WatchedFolderStoreImpl.getInstance(tmpDir);
      const loaded = await store2.getFolder("date-null-test");

      expect(loaded).not.toBeNull();
      if (!loaded) throw new Error("loaded should not be null");
      expect(loaded.lastScanAt).toBeNull();
      expect(loaded.updatedAt).toBeNull();
    });
  });

  describe("cache invalidation", () => {
    it("should re-read from disk after invalidateCache", async () => {
      const store = WatchedFolderStoreImpl.getInstance(tmpDir);
      const folder = createTestFolder({ id: "cache-test-1", name: "Before" });
      await store.addFolder(folder);

      // Directly modify the file on disk (bypassing cache)
      const filePath = path.join(tmpDir, "watched-folders.json");
      const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      raw.folders[0].name = "After Direct Edit";
      fs.writeFileSync(filePath, JSON.stringify(raw, null, 2));

      // Without invalidation, cache still has "Before"
      const cached = await store.getFolder("cache-test-1");
      expect(cached?.name).toBe("Before");

      // After invalidation, reads from disk
      store.invalidateCache();
      const fresh = await store.getFolder("cache-test-1");
      expect(fresh?.name).toBe("After Direct Edit");
    });
  });

  describe("error handling", () => {
    it("should throw on corrupted JSON file", async () => {
      const store = WatchedFolderStoreImpl.getInstance(tmpDir);
      // Write invalid JSON to the store file
      const filePath = path.join(tmpDir, "watched-folders.json");
      fs.writeFileSync(filePath, "{ this is not valid json }");

      // Invalidate cache so it reads from disk
      store.invalidateCache();

      expect(store.listFolders()).rejects.toThrow();
    });

    it("should throw on invalid schema (missing required fields)", async () => {
      const store = WatchedFolderStoreImpl.getInstance(tmpDir);
      // Write JSON that parses but fails schema validation
      const filePath = path.join(tmpDir, "watched-folders.json");
      fs.writeFileSync(
        filePath,
        JSON.stringify({ version: "1.0", folders: [{ id: "x" }] }) // missing required fields
      );

      store.invalidateCache();

      expect(store.listFolders()).rejects.toThrow();
    });
  });
});
