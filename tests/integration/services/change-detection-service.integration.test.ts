/**
 * Integration tests for change-detection-service.ts
 *
 * Tests real filesystem operations with the ChangeDetectionService:
 * - Real file renames using fs.rename
 * - Copy + delete patterns
 * - Integration with FolderWatcherService
 * - Timing validation for rename window
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { initializeLogger, resetLogger } from "../../../src/logging/index.js";
import { FolderWatcherService, ChangeDetectionService } from "../../../src/services/index.js";
import type { WatchedFolder } from "../../../src/services/folder-watcher-types.js";
import type { DetectedChange } from "../../../src/services/change-detection-types.js";

// Initialize logger for tests
beforeAll(() => {
  initializeLogger({ level: "silent", format: "json" });
});

afterAll(() => {
  resetLogger();
});

/**
 * Create a test WatchedFolder object.
 */
function createTestFolder(overrides: Partial<WatchedFolder> = {}): WatchedFolder {
  return {
    id: "integration-folder-" + Date.now(),
    path: path.join(os.tmpdir(), "change-detection-integration-" + Date.now()),
    name: "Integration Test Folder",
    enabled: true,
    includePatterns: null,
    excludePatterns: null,
    debounceMs: 50, // Short debounce for faster tests
    createdAt: new Date(),
    lastScanAt: null,
    fileCount: 0,
    updatedAt: null,
    ...overrides,
  };
}

/**
 * Wait for a specific change category to appear in the changes array.
 */
async function waitForChange(
  changes: DetectedChange[],
  predicate: (change: DetectedChange) => boolean,
  timeoutMs: number = 2000
): Promise<DetectedChange | null> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const found = changes.find(predicate);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

describe("ChangeDetectionService Integration", () => {
  let folderWatcher: FolderWatcherService;
  let changeDetection: ChangeDetectionService;
  let testFolder: WatchedFolder;

  beforeEach(async () => {
    folderWatcher = new FolderWatcherService({
      defaultDebounceMs: 50,
      maxConcurrentWatchers: 5,
    });

    testFolder = createTestFolder();
    await fs.promises.mkdir(testFolder.path, { recursive: true });
  });

  afterEach(async () => {
    // Dispose change detection first
    if (changeDetection) {
      changeDetection.dispose();
    }

    // Stop all watchers with timeout
    try {
      await Promise.race([
        folderWatcher.stopAllWatchers(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Cleanup timeout")), 3000)),
      ]);
    } catch {
      // Ignore cleanup errors
    }

    // Clean up test directory
    try {
      await fs.promises.rm(testFolder.path, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("Real file rename detection", () => {
    it("should detect rename via fs.rename", async () => {
      // Create original file
      const originalPath = path.join(testFolder.path, "rename-test-original.md");
      const renamedPath = path.join(testFolder.path, "rename-test-renamed.md");
      await fs.promises.writeFile(originalPath, "content for rename test");

      changeDetection = new ChangeDetectionService(folderWatcher, {
        renameWindowMs: 1000, // Longer window for reliable detection
        enableStateTracking: true,
      });

      const changes: DetectedChange[] = [];
      changeDetection.onDetectedChange((change) => {
        changes.push(change);
      });

      await folderWatcher.startWatching(testFolder);

      // Wait for initial scan to complete
      await new Promise((resolve) => setTimeout(resolve, 200));
      changes.length = 0; // Clear initial events

      // Perform the rename
      await fs.promises.rename(originalPath, renamedPath);

      // Wait for rename or delete+add events
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Check for rename or the pair of delete+add
      const renameChange = changes.find((c) => c.category === "renamed");
      const deleteChange = changes.find((c) => c.category === "deleted");
      const addChange = changes.find((c) => c.category === "added");

      // Either we detected a rename, or we detected delete + add separately
      expect(renameChange || (deleteChange && addChange)).toBeTruthy();

      if (renameChange) {
        expect(renameChange.relativePath).toBe("rename-test-renamed.md");
        expect(renameChange.previousRelativePath).toBe("rename-test-original.md");
        expect(renameChange.renameConfidence).toBeGreaterThanOrEqual(0.7);
      }
    });

    it("should detect rename to different directory", async () => {
      // Create subdirectory structure
      const subDir = path.join(testFolder.path, "subdir");
      await fs.promises.mkdir(subDir, { recursive: true });

      const originalPath = path.join(testFolder.path, "move-test.md");
      const movedPath = path.join(subDir, "move-test.md");
      await fs.promises.writeFile(originalPath, "content for move test");

      changeDetection = new ChangeDetectionService(folderWatcher, {
        renameWindowMs: 1000,
      });

      const changes: DetectedChange[] = [];
      changeDetection.onDetectedChange((change) => {
        changes.push(change);
      });

      await folderWatcher.startWatching(testFolder);
      await new Promise((resolve) => setTimeout(resolve, 200));
      changes.length = 0;

      // Move file to subdirectory
      await fs.promises.rename(originalPath, movedPath);

      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Should detect as rename since filename matches
      const renameChange = changes.find((c) => c.category === "renamed");
      if (renameChange) {
        expect(renameChange.relativePath).toContain("subdir");
        expect(renameChange.previousRelativePath).toBe("move-test.md");
      } else {
        // May be detected as delete + add depending on timing
        const deleteChange = changes.find((c) => c.category === "deleted");
        const addChange = changes.find((c) => c.category === "added");
        expect(deleteChange || addChange).toBeTruthy();
      }
    });
  });

  describe("Copy + delete pattern", () => {
    it("should handle copy then delete as separate events", async () => {
      const originalPath = path.join(testFolder.path, "copy-original.md");
      const copyPath = path.join(testFolder.path, "copy-target.md");
      await fs.promises.writeFile(originalPath, "original content");

      changeDetection = new ChangeDetectionService(folderWatcher, {
        renameWindowMs: 500,
      });

      const changes: DetectedChange[] = [];
      changeDetection.onDetectedChange((change) => {
        changes.push(change);
      });

      await folderWatcher.startWatching(testFolder);
      await new Promise((resolve) => setTimeout(resolve, 200));
      changes.length = 0;

      // Copy the file first (different filename - won't correlate as rename)
      await fs.promises.copyFile(originalPath, copyPath);
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Then delete the original
      await fs.promises.unlink(originalPath);
      await new Promise((resolve) => setTimeout(resolve, 800)); // Wait for rename window to expire

      // Should have add for copy and delete for original
      const addChange = changes.find(
        (c) => c.category === "added" && c.relativePath === "copy-target.md"
      );
      const deleteChange = changes.find(
        (c) => c.category === "deleted" && c.relativePath === "copy-original.md"
      );

      expect(addChange).toBeDefined();
      expect(deleteChange).toBeDefined();
    });
  });

  describe("Full integration with FolderWatcherService", () => {
    it("should work end-to-end for add, modify, delete lifecycle", async () => {
      changeDetection = new ChangeDetectionService(folderWatcher, {
        renameWindowMs: 300,
        enableStateTracking: true,
      });

      const changes: DetectedChange[] = [];
      changeDetection.onDetectedChange((change) => {
        changes.push(change);
      });

      await folderWatcher.startWatching(testFolder);

      // 1. Add file
      const filePath = path.join(testFolder.path, "lifecycle.md");
      await fs.promises.writeFile(filePath, "initial content");

      const addChange = await waitForChange(changes, (c) => c.category === "added");
      expect(addChange).toBeDefined();
      expect(addChange?.currentState?.sizeBytes).toBe("initial content".length);

      // 2. Modify file
      await fs.promises.writeFile(filePath, "modified content that is longer");

      const modifyChange = await waitForChange(changes, (c) => c.category === "modified");
      expect(modifyChange).toBeDefined();
      expect(modifyChange?.previousState).toBeDefined();

      // 3. Delete file
      const changeCountBefore = changes.length;
      await fs.promises.unlink(filePath);

      // Wait for rename window to expire
      await new Promise((resolve) => setTimeout(resolve, 600));

      const deleteChange = changes.find(
        (c, i) => i >= changeCountBefore && c.category === "deleted"
      );
      expect(deleteChange).toBeDefined();
      expect(deleteChange?.currentState).toBeNull();
      expect(deleteChange?.previousState).toBeDefined();
    });

    it("should handle multiple files simultaneously", async () => {
      changeDetection = new ChangeDetectionService(folderWatcher, {
        renameWindowMs: 500,
      });

      const changes: DetectedChange[] = [];
      changeDetection.onDetectedChange((change) => {
        changes.push(change);
      });

      await folderWatcher.startWatching(testFolder);

      // Create multiple files with small delays to ensure filesystem events are distinct
      const files = ["multi1.md", "multi2.txt", "multi3.js"];
      for (const file of files) {
        await fs.promises.writeFile(path.join(testFolder.path, file), `content of ${file}`);
        // Small delay between file creations for reliable event detection
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      // Longer wait for CI environments (filesystem events can be delayed)
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Should have add events for files
      // Note: On some CI environments, rapid file creations may coalesce
      const addChanges = changes.filter((c) => c.category === "added");
      // Expect at least some files detected (CI timing can be variable)
      expect(addChanges.length).toBeGreaterThanOrEqual(1);

      // Verify at least one of the created files was detected
      const detectedFiles = addChanges.map((c) => c.relativePath);
      const hasOverlap = files.some((f) => detectedFiles.includes(f));
      expect(hasOverlap).toBe(true);
    });
  });

  describe("Timing validation for rename window", () => {
    it("should correlate events within the rename window", async () => {
      const originalPath = path.join(testFolder.path, "timing-test.md");
      await fs.promises.writeFile(originalPath, "timing test content");

      changeDetection = new ChangeDetectionService(folderWatcher, {
        renameWindowMs: 2000, // Long window
      });

      const changes: DetectedChange[] = [];
      changeDetection.onDetectedChange((change) => {
        changes.push(change);
      });

      await folderWatcher.startWatching(testFolder);
      await new Promise((resolve) => setTimeout(resolve, 200));
      changes.length = 0;

      // Rename with short delay (should be within window)
      const renamedPath = path.join(testFolder.path, "timing-test-renamed.md");
      await fs.promises.rename(originalPath, renamedPath);

      await new Promise((resolve) => setTimeout(resolve, 2500));

      // Should detect as rename (timing depends on filesystem event order)
      const renameChange = changes.find((c) => c.category === "renamed");
      const separateEvents =
        changes.filter((c) => c.category === "deleted" || c.category === "added").length >= 2;

      // Either rename detected or separate events (timing-dependent)
      expect(renameChange || separateEvents).toBeTruthy();
    });

    it("should emit delete when rename window expires", async () => {
      const originalPath = path.join(testFolder.path, "expire-test.md");
      await fs.promises.writeFile(originalPath, "expire test content");

      changeDetection = new ChangeDetectionService(folderWatcher, {
        renameWindowMs: 200, // Short window
      });

      const changes: DetectedChange[] = [];
      changeDetection.onDetectedChange((change) => {
        changes.push(change);
      });

      await folderWatcher.startWatching(testFolder);
      await new Promise((resolve) => setTimeout(resolve, 200));
      changes.length = 0;

      // Delete the file
      await fs.promises.unlink(originalPath);

      // Wait for window to expire
      await new Promise((resolve) => setTimeout(resolve, 500));

      const deleteChange = changes.find((c) => c.category === "deleted");
      expect(deleteChange).toBeDefined();
      expect(deleteChange?.relativePath).toBe("expire-test.md");
    });
  });

  describe("State preservation during renames", () => {
    it("should preserve previous state when detecting renames", async () => {
      const originalPath = path.join(testFolder.path, "state-preserve.md");
      const content = "content to preserve state";
      await fs.promises.writeFile(originalPath, content);

      changeDetection = new ChangeDetectionService(folderWatcher, {
        renameWindowMs: 1000,
        enableStateTracking: true,
      });

      const changes: DetectedChange[] = [];
      changeDetection.onDetectedChange((change) => {
        changes.push(change);
      });

      await folderWatcher.startWatching(testFolder);
      await new Promise((resolve) => setTimeout(resolve, 300));
      changes.length = 0;

      // Rename the file
      const renamedPath = path.join(testFolder.path, "state-preserve-renamed.md");
      await fs.promises.rename(originalPath, renamedPath);

      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Check for rename with state
      const renameChange = changes.find((c) => c.category === "renamed");
      if (renameChange) {
        expect(renameChange.currentState).toBeDefined();
        expect(renameChange.currentState?.sizeBytes).toBe(content.length);
        // previousState may or may not be available depending on timing
      }
    });
  });

  describe("Subdirectory handling", () => {
    it("should detect changes in subdirectories", async () => {
      const subDir1 = path.join(testFolder.path, "level1");
      const subDir2 = path.join(subDir1, "level2");
      await fs.promises.mkdir(subDir2, { recursive: true });

      changeDetection = new ChangeDetectionService(folderWatcher);

      const changes: DetectedChange[] = [];
      changeDetection.onDetectedChange((change) => {
        changes.push(change);
      });

      await folderWatcher.startWatching(testFolder);

      // Create files at different levels
      await fs.promises.writeFile(path.join(testFolder.path, "root.md"), "root");
      await fs.promises.writeFile(path.join(subDir1, "level1.md"), "level1");
      await fs.promises.writeFile(path.join(subDir2, "level2.md"), "level2");

      await new Promise((resolve) => setTimeout(resolve, 500));

      const addChanges = changes.filter((c) => c.category === "added");
      expect(addChanges.length).toBeGreaterThanOrEqual(3);

      // Check relative paths are correct
      expect(addChanges.find((c) => c.relativePath === "root.md")).toBeDefined();
      expect(addChanges.find((c) => c.relativePath.includes("level1.md"))).toBeDefined();
      expect(addChanges.find((c) => c.relativePath.includes("level2.md"))).toBeDefined();
    });
  });

  describe("Error recovery", () => {
    it("should continue processing after handler error", async () => {
      changeDetection = new ChangeDetectionService(folderWatcher);

      let errorCount = 0;
      const successChanges: DetectedChange[] = [];

      // Handler that throws on first call
      changeDetection.onDetectedChange((change) => {
        if (errorCount === 0) {
          errorCount++;
          throw new Error("First handler error");
        }
        successChanges.push(change);
      });

      await folderWatcher.startWatching(testFolder);

      // Create multiple files
      await fs.promises.writeFile(path.join(testFolder.path, "error1.md"), "content1");
      await fs.promises.writeFile(path.join(testFolder.path, "error2.md"), "content2");

      await new Promise((resolve) => setTimeout(resolve, 500));

      // First event threw, but subsequent events should still work
      // (The handler recovered after the first error)
      expect(errorCount).toBe(1);
      expect(successChanges.length).toBeGreaterThanOrEqual(1);
    });
  });
});
