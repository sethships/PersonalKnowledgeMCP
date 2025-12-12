/**
 * Integration tests for FileScanner
 * Tests with real file system operations
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { FileScanner } from "../../../src/ingestion/file-scanner.js";
import type { ScanOptions } from "../../../src/ingestion/types.js";
import { initializeLogger, resetLogger } from "../../../src/logging/index.js";
import { mkdir, writeFile, rm, symlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

describe("FileScanner Integration", () => {
  let testDir: string;
  let scanner: FileScanner;

  beforeEach(async () => {
    initializeLogger({ level: "info", format: "json" });
    testDir = join(tmpdir(), `file-scanner-test-${Date.now()}`);
    scanner = new FileScanner();
    await createTestRepository(testDir);
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
    resetLogger();
  });

  describe("real directory scanning", () => {
    test("should scan real directory structure", async () => {
      const files = await scanner.scanFiles(testDir);

      expect(files).toBeInstanceOf(Array);
      expect(files.length).toBeGreaterThan(0);

      // Verify all files have valid metadata
      files.forEach((file) => {
        expect(file.sizeBytes).toBeGreaterThan(0);
        expect(file.modifiedAt).toBeInstanceOf(Date);
        expect(file.relativePath).not.toContain("\\"); // POSIX paths
      });
    });

    test("should respect .gitignore in real repository", async () => {
      const files = await scanner.scanFiles(testDir);

      // Files in temp/ should be excluded (in .gitignore)
      const hasTemp = files.some((f) => f.relativePath.includes("temp"));
      expect(hasTemp).toBe(false);

      // *.log files should be excluded (in .gitignore)
      const hasLogFiles = files.some((f) => f.extension === ".log");
      expect(hasLogFiles).toBe(false);
    });

    test("should exclude default patterns in real repository", async () => {
      const files = await scanner.scanFiles(testDir);

      // node_modules should be excluded
      const hasNodeModules = files.some((f) => f.relativePath.includes("node_modules"));
      expect(hasNodeModules).toBe(false);

      // dist should be excluded
      const hasDist = files.some((f) => f.relativePath.includes("dist"));
      expect(hasDist).toBe(false);
    });

    test("should include expected files", async () => {
      const files = await scanner.scanFiles(testDir);
      const relativePaths = files.map((f) => f.relativePath);

      // Should include package.json
      expect(relativePaths).toContain("package.json");

      // Should include source files
      const hasTsFiles = files.some((f) => f.extension === ".ts" && f.relativePath.includes("src"));
      const hasJsFiles = files.some((f) => f.extension === ".js" && f.relativePath.includes("src"));
      expect(hasTsFiles).toBe(true);
      expect(hasJsFiles).toBe(true);

      // Should include docs
      const hasMdFiles = files.some(
        (f) => f.extension === ".md" && f.relativePath.includes("docs")
      );
      expect(hasMdFiles).toBe(true);
    });
  });

  describe("nested directories", () => {
    test("should handle deeply nested directory structure", async () => {
      // Create deep nesting
      const deepPath = join(testDir, "a", "b", "c", "d", "e");
      await mkdir(deepPath, { recursive: true });
      await writeFile(join(deepPath, "deep.ts"), "export const deep = true;");

      const files = await scanner.scanFiles(testDir);

      // Should find the deeply nested file
      const hasDeepFile = files.some((f) => f.relativePath.includes("deep.ts"));
      expect(hasDeepFile).toBe(true);
    });
  });

  describe("file size filtering", () => {
    test("should exclude files larger than max size", async () => {
      // Large file already created in fixture
      const files = await scanner.scanFiles(testDir);

      // large-file.bin (2MB) should be excluded
      const hasLargeFile = files.some((f) => f.relativePath.includes("large-file.bin"));
      expect(hasLargeFile).toBe(false);
    });

    test("should include files under size limit", async () => {
      const files = await scanner.scanFiles(testDir);

      // All included files should be under 1MB
      files.forEach((file) => {
        expect(file.sizeBytes).toBeLessThanOrEqual(1024 * 1024);
      });
    });
  });

  describe("custom options", () => {
    test("should filter by custom extensions", async () => {
      const options: ScanOptions = {
        includeExtensions: [".md"],
      };

      const files = await scanner.scanFiles(testDir, options);

      // All files should be .md
      files.forEach((file) => {
        expect(file.extension).toBe(".md");
      });

      expect(files.length).toBeGreaterThan(0);
    });

    test("should apply custom exclude patterns", async () => {
      const options: ScanOptions = {
        excludePatterns: ["src/**"],
      };

      const files = await scanner.scanFiles(testDir, options);

      // No files from src/ directory
      const hasSrcFiles = files.some((f) => f.relativePath.startsWith("src"));
      expect(hasSrcFiles).toBe(false);
    });

    test("should call progress callback", async () => {
      let callCount = 0;
      let finalScanned = 0;
      let finalTotal = 0;

      const options: ScanOptions = {
        onProgress: (scanned, total) => {
          callCount++;
          finalScanned = scanned;
          finalTotal = total;
        },
      };

      await scanner.scanFiles(testDir, options);

      expect(callCount).toBeGreaterThan(0);
      expect(finalScanned).toBeGreaterThan(0);
      expect(finalTotal).toBeGreaterThan(0);
    });
  });

  describe("path handling", () => {
    test("should return absolute paths with platform separators", async () => {
      const files = await scanner.scanFiles(testDir);

      files.forEach((file) => {
        // Absolute path should start with test directory
        expect(file.absolutePath.startsWith(testDir)).toBe(true);
      });
    });

    test("should return relative paths with POSIX separators", async () => {
      const files = await scanner.scanFiles(testDir);

      files.forEach((file) => {
        // Relative paths should use forward slashes
        expect(file.relativePath).not.toContain("\\");

        // Should be relative, not absolute
        expect(file.relativePath.startsWith(testDir)).toBe(false);
      });
    });
  });

  describe("symlink handling", () => {
    test("should not follow symlinks (security - prevent path traversal)", async () => {
      // Create a file outside the test directory
      const outsidePath = join(testDir, "..", "outside-testdir-file.ts");
      await writeFile(outsidePath, "export const outside = true;");

      // Create a symlink inside testDir pointing to the outside file
      const symlinkPath = join(testDir, "src", "symlink.ts");
      try {
        await symlink(outsidePath, symlinkPath);
      } catch (error) {
        // Symlink creation may fail on Windows without admin rights - skip test
        await rm(outsidePath, { force: true });
        return;
      }

      const files = await scanner.scanFiles(testDir);

      // The symlink should not be followed
      // glob's default behavior is followSymbolicLinks: false
      const hasOutsideFile = files.some(
        (f) => f.relativePath.includes("symlink") || f.relativePath.includes("outside")
      );
      expect(hasOutsideFile).toBe(false);

      // Clean up
      await rm(outsidePath, { force: true });
      await rm(symlinkPath, { force: true });
    });
  });

  describe("special characters", () => {
    test("should handle filenames with spaces", async () => {
      const filename = "file with spaces.ts";
      await writeFile(join(testDir, "src", filename), "export const test = true;");

      const files = await scanner.scanFiles(testDir);
      const hasSpacedFile = files.some((f) => f.relativePath.includes("file with spaces"));
      expect(hasSpacedFile).toBe(true);
    });

    test("should handle Unicode filenames", async () => {
      const filename = "文件.ts"; // Chinese characters
      await writeFile(join(testDir, "src", filename), "export const test = true;");

      const files = await scanner.scanFiles(testDir);
      const hasUnicodeFile = files.some((f) => f.relativePath.includes("文件"));
      expect(hasUnicodeFile).toBe(true);
    });
  });
});

/**
 * Create a test repository structure
 */
async function createTestRepository(basePath: string): Promise<void> {
  const structure = {
    ".gitignore": "temp/\n*.log",
    "src/index.ts": "export const main = () => {};",
    "src/utils.js": "module.exports = {};",
    "docs/README.md": "# Test Repository",
    "node_modules/package/index.js": "// excluded",
    "dist/bundle.js": "// excluded",
    "temp/debug.log": "// excluded by gitignore",
    "package.json": '{"name": "test-repo"}',
  };

  for (const [filePath, content] of Object.entries(structure)) {
    const fullPath = join(basePath, filePath);
    await mkdir(join(fullPath, ".."), { recursive: true });
    await writeFile(fullPath, content, "utf-8");
  }

  // Create oversized file (2MB)
  const largeFilePath = join(basePath, "large-file.bin");
  const largeBuffer = Buffer.alloc(2 * 1024 * 1024);
  await writeFile(largeFilePath, largeBuffer);
}
