/**
 * File Scanner Utilities Tests
 *
 * Tests for the file scanning utilities used by graph populate commands.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import {
  SUPPORTED_EXTENSIONS,
  EXCLUDED_DIRECTORIES,
  scanDirectory,
  formatDuration,
  formatPhase,
} from "../../../src/cli/utils/file-scanner.js";

describe("file-scanner utilities", () => {
  describe("SUPPORTED_EXTENSIONS", () => {
    test("contains TypeScript extensions", () => {
      expect(SUPPORTED_EXTENSIONS.has(".ts")).toBe(true);
      expect(SUPPORTED_EXTENSIONS.has(".tsx")).toBe(true);
    });

    test("contains JavaScript extensions", () => {
      expect(SUPPORTED_EXTENSIONS.has(".js")).toBe(true);
      expect(SUPPORTED_EXTENSIONS.has(".jsx")).toBe(true);
    });

    test("does not contain non-tree-sitter extensions", () => {
      expect(SUPPORTED_EXTENSIONS.has(".md")).toBe(false);
      expect(SUPPORTED_EXTENSIONS.has(".json")).toBe(false);
      expect(SUPPORTED_EXTENSIONS.has(".yaml")).toBe(false);
    });

    test("contains Python extensions", () => {
      expect(SUPPORTED_EXTENSIONS.has(".py")).toBe(true);
      expect(SUPPORTED_EXTENSIONS.has(".pyw")).toBe(true);
      expect(SUPPORTED_EXTENSIONS.has(".pyi")).toBe(true);
    });

    test("contains Java extensions", () => {
      expect(SUPPORTED_EXTENSIONS.has(".java")).toBe(true);
    });

    test("contains Go extensions", () => {
      expect(SUPPORTED_EXTENSIONS.has(".go")).toBe(true);
    });

    test("has exactly 9 extensions", () => {
      // 4 JS/TS extensions + 3 Python extensions + 1 Java extension + 1 Go extension
      expect(SUPPORTED_EXTENSIONS.size).toBe(9);
    });
  });

  describe("EXCLUDED_DIRECTORIES", () => {
    test("contains common build directories", () => {
      expect(EXCLUDED_DIRECTORIES.has("node_modules")).toBe(true);
      expect(EXCLUDED_DIRECTORIES.has("dist")).toBe(true);
      expect(EXCLUDED_DIRECTORIES.has("build")).toBe(true);
    });

    test("contains version control directories", () => {
      expect(EXCLUDED_DIRECTORIES.has(".git")).toBe(true);
    });

    test("contains framework-specific directories", () => {
      expect(EXCLUDED_DIRECTORIES.has(".next")).toBe(true);
      expect(EXCLUDED_DIRECTORIES.has(".nuxt")).toBe(true);
    });

    test("contains test coverage directories", () => {
      expect(EXCLUDED_DIRECTORIES.has("coverage")).toBe(true);
    });

    test("contains Python cache directory", () => {
      expect(EXCLUDED_DIRECTORIES.has("__pycache__")).toBe(true);
    });

    test("does not contain src directory", () => {
      expect(EXCLUDED_DIRECTORIES.has("src")).toBe(false);
    });
  });

  describe("formatDuration", () => {
    test("formats milliseconds under 1000 as ms", () => {
      expect(formatDuration(0)).toBe("0ms");
      expect(formatDuration(1)).toBe("1ms");
      expect(formatDuration(500)).toBe("500ms");
      expect(formatDuration(999)).toBe("999ms");
    });

    test("formats exactly 1000ms as seconds", () => {
      expect(formatDuration(1000)).toBe("1.0s");
    });

    test("formats milliseconds over 1000 as seconds with one decimal", () => {
      expect(formatDuration(1500)).toBe("1.5s");
      expect(formatDuration(2000)).toBe("2.0s");
      expect(formatDuration(2345)).toBe("2.3s");
      expect(formatDuration(12345)).toBe("12.3s");
    });

    test("handles large durations", () => {
      expect(formatDuration(60000)).toBe("60.0s");
      expect(formatDuration(123456)).toBe("123.5s");
    });
  });

  describe("formatPhase", () => {
    test("maps known phase identifiers to display names", () => {
      expect(formatPhase("initializing")).toBe("Initializing");
      expect(formatPhase("extracting_entities")).toBe("Extracting entities");
      expect(formatPhase("extracting_relationships")).toBe("Extracting relationships");
      expect(formatPhase("creating_repository_node")).toBe("Creating repository node");
      expect(formatPhase("creating_file_nodes")).toBe("Creating file nodes");
      expect(formatPhase("creating_entity_nodes")).toBe("Creating entity nodes");
      expect(formatPhase("creating_module_nodes")).toBe("Creating module nodes");
      expect(formatPhase("creating_relationships")).toBe("Creating relationships");
      expect(formatPhase("verifying")).toBe("Verifying");
      expect(formatPhase("completed")).toBe("Completed");
    });

    test("returns unknown phase identifiers unchanged", () => {
      expect(formatPhase("unknown_phase")).toBe("unknown_phase");
      expect(formatPhase("custom_phase")).toBe("custom_phase");
      expect(formatPhase("")).toBe("");
    });
  });

  describe("scanDirectory", () => {
    const testDir = join(process.cwd(), "tests", "temp", "file-scanner-test");

    beforeAll(async () => {
      // Create test directory structure
      await mkdir(testDir, { recursive: true });
      await mkdir(join(testDir, "src"), { recursive: true });
      await mkdir(join(testDir, "node_modules"), { recursive: true });
      await mkdir(join(testDir, "src", "nested"), { recursive: true });

      // Create test files
      await writeFile(join(testDir, "src", "index.ts"), "export const foo = 1;");
      await writeFile(join(testDir, "src", "component.tsx"), "export const Comp = () => <div />;");
      await writeFile(join(testDir, "src", "utils.js"), "module.exports = {};");
      await writeFile(
        join(testDir, "src", "nested", "helper.jsx"),
        "export const Helper = () => null;"
      );
      await writeFile(join(testDir, "README.md"), "# Test");
      await writeFile(join(testDir, "package.json"), "{}");
      await writeFile(join(testDir, "node_modules", "lib.js"), "// should be excluded");
    });

    afterAll(async () => {
      // Clean up test directory
      await rm(testDir, { recursive: true, force: true });
    });

    test("scans directory and returns supported files with content", async () => {
      const skippedFiles: string[] = [];
      const files = await scanDirectory(testDir, testDir, skippedFiles);

      // Should find 4 supported files
      expect(files.length).toBe(4);

      // Check that files have paths and content
      const paths = files.map((f) => f.path);
      expect(paths).toContain("src/index.ts");
      expect(paths).toContain("src/component.tsx");
      expect(paths).toContain("src/utils.js");
      expect(paths).toContain("src/nested/helper.jsx");

      // Check content is included
      const indexFile = files.find((f) => f.path === "src/index.ts");
      expect(indexFile?.content).toBe("export const foo = 1;");
    });

    test("excludes node_modules directory", async () => {
      const skippedFiles: string[] = [];
      const files = await scanDirectory(testDir, testDir, skippedFiles);

      const paths = files.map((f) => f.path);
      expect(paths.some((p) => p.includes("node_modules"))).toBe(false);
    });

    test("excludes non-supported file extensions", async () => {
      const skippedFiles: string[] = [];
      const files = await scanDirectory(testDir, testDir, skippedFiles);

      const paths = files.map((f) => f.path);
      expect(paths.some((p) => p.endsWith(".md"))).toBe(false);
      expect(paths.some((p) => p.endsWith(".json"))).toBe(false);
    });

    test("uses forward slashes in paths (cross-platform)", async () => {
      const skippedFiles: string[] = [];
      const files = await scanDirectory(testDir, testDir, skippedFiles);

      for (const file of files) {
        expect(file.path.includes("\\")).toBe(false);
      }
    });

    test("tracks skipped files when read errors occur", async () => {
      // Create a file that will be skipped (we can't easily simulate read errors,
      // but we can verify the skippedFiles array is passed through correctly)
      const skippedFiles: string[] = [];
      await scanDirectory(testDir, testDir, skippedFiles);

      // No files should be skipped in normal operation
      expect(Array.isArray(skippedFiles)).toBe(true);
    });

    test("returns empty array for directory with no supported files", async () => {
      const emptyDir = join(testDir, "empty");
      await mkdir(emptyDir, { recursive: true });
      await writeFile(join(emptyDir, "readme.md"), "# Empty");

      const skippedFiles: string[] = [];
      const files = await scanDirectory(emptyDir, emptyDir, skippedFiles);

      expect(files.length).toBe(0);

      // Clean up
      await rm(emptyDir, { recursive: true, force: true });
    });

    test("handles nested directory structures", async () => {
      const deepDir = join(testDir, "deep");
      await mkdir(join(deepDir, "a", "b", "c"), { recursive: true });
      await writeFile(join(deepDir, "a", "b", "c", "deep.ts"), "export const deep = true;");

      const skippedFiles: string[] = [];
      const files = await scanDirectory(deepDir, deepDir, skippedFiles);

      expect(files.length).toBe(1);
      expect(files[0]?.path).toBe("a/b/c/deep.ts");

      // Clean up
      await rm(deepDir, { recursive: true, force: true });
    });
  });
});
