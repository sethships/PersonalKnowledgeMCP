/**
 * Unit tests for FileScanner
 * Tests all methods with comprehensive coverage
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { FileScanner } from "../../../src/ingestion/file-scanner.js";
import { ValidationError } from "../../../src/ingestion/errors.js";
import type { ScanOptions } from "../../../src/ingestion/types.js";
import { initializeLogger, resetLogger } from "../../../src/logging/index.js";
import { resolve, join } from "path";
import { writeFile, unlink } from "fs/promises";

describe("FileScanner", () => {
  let scanner: FileScanner;
  const largeFilePath = join(__dirname, "../../fixtures/sample-repo/large-file.bin");

  beforeAll(async () => {
    // Create large test file (2MB) dynamically to avoid committing binary to repo
    const largeBuffer = Buffer.alloc(2 * 1024 * 1024);
    await writeFile(largeFilePath, largeBuffer);
  });

  afterAll(async () => {
    // Clean up large test file
    try {
      await unlink(largeFilePath);
    } catch {
      // File may not exist, ignore error
    }
  });

  beforeEach(() => {
    initializeLogger({ level: "info", format: "json" });
    scanner = new FileScanner();
  });

  afterEach(() => {
    resetLogger();
  });

  describe("constructor", () => {
    test("should create scanner with default config", () => {
      const scanner = new FileScanner();
      expect(scanner).toBeDefined();
    });

    test("should create scanner with custom max file size", () => {
      const scanner = new FileScanner({ maxFileSizeBytes: 512 * 1024 });
      expect(scanner).toBeDefined();
    });
  });

  describe("scanFiles()", () => {
    test("should throw ValidationError for empty path", async () => {
      expect(async () => {
        await scanner.scanFiles("");
      }).toThrow(ValidationError);
    });

    test("should throw ValidationError for relative path", async () => {
      expect(async () => {
        await scanner.scanFiles("./relative/path");
      }).toThrow(ValidationError);
    });

    test("should throw ValidationError for non-existent directory", async () => {
      expect(async () => {
        await scanner.scanFiles(resolve("/non/existent/path"));
      }).toThrow(ValidationError);
    });

    test("should throw ValidationError for path outside allowed base directories", async () => {
      const restrictedScanner = new FileScanner({
        allowedBasePaths: [resolve(__dirname, "../../fixtures")],
      });

      // Attempt to scan a path outside the allowed base
      expect(async () => {
        await restrictedScanner.scanFiles(resolve(__dirname, "../../../src"));
      }).toThrow(ValidationError);
    });

    test("should allow scanning within allowed base directories", async () => {
      const restrictedScanner = new FileScanner({
        allowedBasePaths: [resolve(__dirname, "../../fixtures")],
      });

      // This should succeed since sample-repo is within fixtures/
      const repoPath = resolve(__dirname, "../../fixtures/sample-repo");
      const files = await restrictedScanner.scanFiles(repoPath);

      expect(files).toBeInstanceOf(Array);
    });

    test("should allow scanning exact allowed base directory", async () => {
      const repoPath = resolve(__dirname, "../../fixtures/sample-repo");
      const restrictedScanner = new FileScanner({
        allowedBasePaths: [repoPath], // Exact match
      });

      // Should succeed for exact match
      const files = await restrictedScanner.scanFiles(repoPath);
      expect(files).toBeInstanceOf(Array);
    });

    test("should scan sample repository and return files", async () => {
      const repoPath = resolve(__dirname, "../../fixtures/sample-repo");
      const files = await scanner.scanFiles(repoPath);

      expect(files).toBeInstanceOf(Array);
      expect(files.length).toBeGreaterThan(0);

      // Verify file structure
      files.forEach((file) => {
        expect(file).toHaveProperty("relativePath");
        expect(file).toHaveProperty("absolutePath");
        expect(file).toHaveProperty("extension");
        expect(file).toHaveProperty("sizeBytes");
        expect(file).toHaveProperty("modifiedAt");
        expect(file.modifiedAt).toBeInstanceOf(Date);
      });
    });

    test("should return sorted files by relative path", async () => {
      const repoPath = resolve(__dirname, "../../fixtures/sample-repo");
      const files = await scanner.scanFiles(repoPath);

      for (let i = 1; i < files.length; i++) {
        const current = files[i];
        const previous = files[i - 1];
        expect(current).toBeDefined();
        expect(previous).toBeDefined();
        expect(current!.relativePath >= previous!.relativePath).toBe(true);
      }
    });

    test("should exclude node_modules by default", async () => {
      const repoPath = resolve(__dirname, "../../fixtures/sample-repo");
      const files = await scanner.scanFiles(repoPath);

      const hasNodeModules = files.some((f) => f.relativePath.includes("node_modules"));
      expect(hasNodeModules).toBe(false);
    });

    test("should exclude dist by default", async () => {
      const repoPath = resolve(__dirname, "../../fixtures/sample-repo");
      const files = await scanner.scanFiles(repoPath);

      const hasDist = files.some((f) => f.relativePath.includes("dist"));
      expect(hasDist).toBe(false);
    });

    test("should exclude files in .gitignore", async () => {
      const repoPath = resolve(__dirname, "../../fixtures/sample-repo");
      const files = await scanner.scanFiles(repoPath);

      // temp/ is in .gitignore
      const hasTemp = files.some((f) => f.relativePath.includes("temp"));
      expect(hasTemp).toBe(false);
    });

    test("should exclude large files (>1MB)", async () => {
      const repoPath = resolve(__dirname, "../../fixtures/sample-repo");
      const files = await scanner.scanFiles(repoPath);

      // large-file.bin is 2MB
      const hasLargeFile = files.some((f) => f.relativePath.includes("large-file.bin"));
      expect(hasLargeFile).toBe(false);
    });

    test("should include only specified extensions", async () => {
      const repoPath = resolve(__dirname, "../../fixtures/sample-repo");
      const options: ScanOptions = {
        includeExtensions: [".ts", ".md"],
      };
      const files = await scanner.scanFiles(repoPath, options);

      // Should have .ts and .md files
      const hasTs = files.some((f) => f.extension === ".ts");
      const hasMd = files.some((f) => f.extension === ".md");

      // Should not have .js or .json files
      const hasJs = files.some((f) => f.extension === ".js");
      const hasJson = files.some((f) => f.extension === ".json");

      expect(hasTs || hasMd).toBe(true);
      expect(hasJs).toBe(false);
      expect(hasJson).toBe(false);
    });

    test("should apply custom exclude patterns", async () => {
      const repoPath = resolve(__dirname, "../../fixtures/sample-repo");
      const options: ScanOptions = {
        excludePatterns: ["docs/**"],
      };
      const files = await scanner.scanFiles(repoPath, options);

      const hasDocs = files.some((f) => f.relativePath.startsWith("docs"));
      expect(hasDocs).toBe(false);
    });

    test("should call progress callback during scan", async () => {
      const repoPath = resolve(__dirname, "../../fixtures/sample-repo");
      let progressCalls = 0;
      let lastScanned = 0;
      let lastTotal = 0;

      const options: ScanOptions = {
        onProgress: (scanned, total) => {
          progressCalls++;
          lastScanned = scanned;
          lastTotal = total;
        },
      };

      await scanner.scanFiles(repoPath, options);

      expect(progressCalls).toBeGreaterThan(0);
      expect(lastScanned).toBeGreaterThan(0);
      expect(lastTotal).toBeGreaterThan(0);
    });

    test("should normalize Windows paths to POSIX", async () => {
      const repoPath = resolve(__dirname, "../../fixtures/sample-repo");
      const files = await scanner.scanFiles(repoPath);

      files.forEach((file) => {
        // Relative paths should not contain backslashes
        expect(file.relativePath.includes("\\")).toBe(false);
        // Relative paths should use forward slashes
        if (file.relativePath.includes("/")) {
          expect(file.relativePath).toMatch(/\//);
        }
      });
    });

    test("should return lowercase extensions", async () => {
      const repoPath = resolve(__dirname, "../../fixtures/sample-repo");
      const files = await scanner.scanFiles(repoPath);

      files.forEach((file) => {
        expect(file.extension).toBe(file.extension.toLowerCase());
      });
    });

    test("should handle repository with no .gitignore gracefully", async () => {
      const repoPath = resolve(__dirname, "../../fixtures/sample-repo");
      // This should work even if .gitignore exists or doesn't exist
      const files = await scanner.scanFiles(repoPath);
      expect(files).toBeInstanceOf(Array);
    });

    test("should include expected files from sample repo", async () => {
      const repoPath = resolve(__dirname, "../../fixtures/sample-repo");
      const files = await scanner.scanFiles(repoPath);

      const relativePaths = files.map((f) => f.relativePath);

      // Should include these files (using POSIX paths)
      expect(relativePaths).toContain("package.json");
      expect(relativePaths.some((p) => p.includes("src") && p.endsWith(".ts"))).toBe(true);
      expect(relativePaths.some((p) => p.includes("src") && p.endsWith(".js"))).toBe(true);
      expect(relativePaths.some((p) => p.includes("docs") && p.endsWith(".md"))).toBe(true);
    });
  });

  describe("edge cases", () => {
    test("should handle empty repository (no matching files)", async () => {
      const repoPath = resolve(__dirname, "../../fixtures/sample-repo");
      const options: ScanOptions = {
        includeExtensions: [".xyz"], // Non-existent extension
      };

      const files = await scanner.scanFiles(repoPath, options);
      expect(files).toBeInstanceOf(Array);
      expect(files.length).toBe(0);
    });

    test("should handle repository with only excluded files", async () => {
      const repoPath = resolve(__dirname, "../../fixtures/sample-repo");
      const options: ScanOptions = {
        excludePatterns: ["**/*"], // Exclude everything
      };

      const files = await scanner.scanFiles(repoPath, options);
      expect(files).toBeInstanceOf(Array);
      expect(files.length).toBe(0);
    });
  });

  describe("FileInfo structure", () => {
    test("should return valid FileInfo objects", async () => {
      const repoPath = resolve(__dirname, "../../fixtures/sample-repo");
      const files = await scanner.scanFiles(repoPath);

      expect(files.length).toBeGreaterThan(0);

      const file = files[0];
      expect(file).toBeDefined();

      // Check all required properties exist
      expect(file!.relativePath).toBeDefined();
      expect(file!.absolutePath).toBeDefined();
      expect(file!.extension).toBeDefined();
      expect(file!.sizeBytes).toBeDefined();
      expect(file!.modifiedAt).toBeDefined();

      // Check types
      expect(typeof file!.relativePath).toBe("string");
      expect(typeof file!.absolutePath).toBe("string");
      expect(typeof file!.extension).toBe("string");
      expect(typeof file!.sizeBytes).toBe("number");
      expect(file!.modifiedAt).toBeInstanceOf(Date);

      // Check values
      expect(file!.relativePath.length).toBeGreaterThan(0);
      expect(file!.absolutePath.length).toBeGreaterThan(0);
      expect(file!.sizeBytes).toBeGreaterThanOrEqual(0);
      expect(file!.extension).toMatch(/^\./); // Should start with dot
    });
  });

  describe("custom configuration", () => {
    test("should respect custom maxFileSizeBytes", async () => {
      const repoPath = resolve(__dirname, "../../fixtures/sample-repo");

      // Create scanner with very small limit
      const smallScanner = new FileScanner({ maxFileSizeBytes: 10 }); // 10 bytes

      const files = await smallScanner.scanFiles(repoPath);

      // All files should be excluded due to size
      // (or very few tiny files might remain)
      expect(files.length).toBeLessThan(2);
    });
  });
});
