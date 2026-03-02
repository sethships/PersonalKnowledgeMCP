/**
 * Tests for IndexCompletenessChecker service
 *
 * Validates completeness detection logic including threshold evaluation,
 * edge cases, and error handling.
 *
 * @module tests/services/index-completeness-checker
 */

import { describe, it, expect, beforeEach, mock } from "bun:test";
import {
  IndexCompletenessChecker,
  DEFAULT_COMPLETENESS_THRESHOLDS,
} from "../../src/services/index-completeness-checker.js";
import { initializeLogger } from "../../src/logging/index.js";
import type { RepositoryInfo } from "../../src/repositories/types.js";
import type { FileScanner } from "../../src/ingestion/file-scanner.js";
import type { FileInfo } from "../../src/ingestion/types.js";

/**
 * Create a mock FileScanner that returns a specified number of files
 */
function createMockFileScanner(fileCount: number): FileScanner {
  const files: FileInfo[] = Array.from({ length: fileCount }, (_, i) => ({
    relativePath: `src/file-${i}.ts`,
    absolutePath: `/repos/test-repo/src/file-${i}.ts`,
    extension: ".ts",
    sizeBytes: 1024,
    modifiedAt: new Date("2024-12-01T00:00:00.000Z"),
  }));

  return {
    scanFiles: async () => files,
  } as unknown as FileScanner;
}

/**
 * Create a mock FileScanner that throws an error
 */
function createErrorFileScanner(errorMessage: string): FileScanner {
  return {
    scanFiles: async () => {
      throw new Error(errorMessage);
    },
  } as unknown as FileScanner;
}

/**
 * Create a test RepositoryInfo with specified file count
 */
function createTestRepo(fileCount: number): RepositoryInfo {
  return {
    name: "test-repo",
    url: "https://github.com/owner/test-repo.git",
    localPath: "/repos/test-repo",
    collectionName: "repo_test_repo",
    fileCount,
    chunkCount: fileCount * 5,
    lastIndexedAt: "2024-12-01T00:00:00.000Z",
    indexDurationMs: 5000,
    status: "ready",
    branch: "main",
    includeExtensions: [".ts", ".js", ".md"],
    excludePatterns: ["node_modules/**", "dist/**"],
  };
}

describe("IndexCompletenessChecker", () => {
  beforeEach(() => {
    initializeLogger({ level: "silent", format: "json" });
  });

  describe("DEFAULT_COMPLETENESS_THRESHOLDS", () => {
    it("should have expected default values", () => {
      expect(DEFAULT_COMPLETENESS_THRESHOLDS.completenessThresholdPercent).toBe(20);
      expect(DEFAULT_COMPLETENESS_THRESHOLDS.completenessThresholdAbsolute).toBe(50);
    });
  });

  describe("checkCompleteness", () => {
    it("should return complete when counts match exactly", async () => {
      const files: FileInfo[] = Array.from({ length: 100 }, (_, i) => ({
        relativePath: `src/file-${i}.ts`,
        absolutePath: `/repos/test-repo/src/file-${i}.ts`,
        extension: ".ts",
        sizeBytes: 1024,
        modifiedAt: new Date("2024-12-01T00:00:00.000Z"),
      }));
      const scanFilesMock = mock(async () => files);
      const scanner = { scanFiles: scanFilesMock } as unknown as FileScanner;
      const checker = new IndexCompletenessChecker(scanner);
      const repo = createTestRepo(100);

      const result = await checker.checkCompleteness(repo);

      expect(result.status).toBe("complete");
      expect(result.indexedFileCount).toBe(100);
      expect(result.eligibleFileCount).toBe(100);
      expect(result.missingFileCount).toBe(0);
      expect(result.divergencePercent).toBe(0);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.errorMessage).toBeUndefined();

      // Verify scanFiles was called with the correct arguments
      expect(scanFilesMock).toHaveBeenCalledTimes(1);
      expect(scanFilesMock).toHaveBeenCalledWith(repo.localPath, {
        includeExtensions: repo.includeExtensions,
        excludePatterns: repo.excludePatterns,
      });
    });

    it("should return complete when below both thresholds", async () => {
      // 10% divergence (10 missing out of 100), and 10 files missing
      // Both below defaults of 20% and 50
      const scanner = createMockFileScanner(100);
      const checker = new IndexCompletenessChecker(scanner);
      const repo = createTestRepo(90);

      const result = await checker.checkCompleteness(repo);

      expect(result.status).toBe("complete");
      expect(result.indexedFileCount).toBe(90);
      expect(result.eligibleFileCount).toBe(100);
      expect(result.missingFileCount).toBe(10);
      expect(result.divergencePercent).toBe(10);
    });

    it("should return incomplete when percent threshold exceeded", async () => {
      // 25% divergence (25 missing out of 100), 25 files missing
      // Percent exceeds 20% default, but absolute is below 50
      const scanner = createMockFileScanner(100);
      const checker = new IndexCompletenessChecker(scanner);
      const repo = createTestRepo(75);

      const result = await checker.checkCompleteness(repo);

      expect(result.status).toBe("incomplete");
      expect(result.indexedFileCount).toBe(75);
      expect(result.eligibleFileCount).toBe(100);
      expect(result.missingFileCount).toBe(25);
      expect(result.divergencePercent).toBe(25);
    });

    it("should return incomplete when absolute threshold exceeded", async () => {
      // 60 files missing out of 1000 (6% divergence)
      // Absolute exceeds 50 default, but percent is below 20%
      const scanner = createMockFileScanner(1000);
      const checker = new IndexCompletenessChecker(scanner);
      const repo = createTestRepo(940);

      const result = await checker.checkCompleteness(repo);

      expect(result.status).toBe("incomplete");
      expect(result.indexedFileCount).toBe(940);
      expect(result.eligibleFileCount).toBe(1000);
      expect(result.missingFileCount).toBe(60);
      expect(result.divergencePercent).toBe(6);
    });

    it("should return incomplete when both thresholds exceeded", async () => {
      // 335 missing out of 424 (~79% divergence)
      // Real-world scenario from issue #456
      const scanner = createMockFileScanner(424);
      const checker = new IndexCompletenessChecker(scanner);
      const repo = createTestRepo(89);

      const result = await checker.checkCompleteness(repo);

      expect(result.status).toBe("incomplete");
      expect(result.indexedFileCount).toBe(89);
      expect(result.eligibleFileCount).toBe(424);
      expect(result.missingFileCount).toBe(335);
      expect(result.divergencePercent).toBe(79);
    });

    it("should return complete when indexed exceeds eligible (not negative)", async () => {
      // More indexed than on disk (e.g., files deleted but index not yet updated)
      const scanner = createMockFileScanner(80);
      const checker = new IndexCompletenessChecker(scanner);
      const repo = createTestRepo(100);

      const result = await checker.checkCompleteness(repo);

      expect(result.status).toBe("complete");
      expect(result.indexedFileCount).toBe(100);
      expect(result.eligibleFileCount).toBe(80);
      expect(result.missingFileCount).toBe(0);
      expect(result.divergencePercent).toBe(0);
    });

    it("should handle zero eligible files", async () => {
      const scanner = createMockFileScanner(0);
      const checker = new IndexCompletenessChecker(scanner);
      const repo = createTestRepo(50);

      const result = await checker.checkCompleteness(repo);

      expect(result.status).toBe("complete");
      expect(result.indexedFileCount).toBe(50);
      expect(result.eligibleFileCount).toBe(0);
      expect(result.missingFileCount).toBe(0);
      expect(result.divergencePercent).toBe(0);
    });

    it("should handle zero indexed files with eligible files on disk", async () => {
      const scanner = createMockFileScanner(100);
      const checker = new IndexCompletenessChecker(scanner);
      const repo = createTestRepo(0);

      const result = await checker.checkCompleteness(repo);

      expect(result.status).toBe("incomplete");
      expect(result.indexedFileCount).toBe(0);
      expect(result.eligibleFileCount).toBe(100);
      expect(result.missingFileCount).toBe(100);
      expect(result.divergencePercent).toBe(100);
    });

    it("should return error status when FileScanner throws", async () => {
      const scanner = createErrorFileScanner("ENOENT: no such file or directory");
      const checker = new IndexCompletenessChecker(scanner);
      const repo = createTestRepo(100);

      const result = await checker.checkCompleteness(repo);

      expect(result.status).toBe("error");
      expect(result.indexedFileCount).toBe(100);
      expect(result.eligibleFileCount).toBe(0);
      expect(result.missingFileCount).toBe(0);
      expect(result.divergencePercent).toBe(0);
      expect(result.errorMessage).toBe("ENOENT: no such file or directory");
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("should track duration", async () => {
      const scanner = createMockFileScanner(100);
      const checker = new IndexCompletenessChecker(scanner);
      const repo = createTestRepo(100);

      const result = await checker.checkCompleteness(repo);

      expect(typeof result.durationMs).toBe("number");
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("custom thresholds", () => {
    it("should use custom percent threshold", async () => {
      // 15% divergence with 10% custom threshold -> incomplete
      const scanner = createMockFileScanner(100);
      const checker = new IndexCompletenessChecker(scanner, {
        completenessThresholdPercent: 10,
      });
      const repo = createTestRepo(85);

      const result = await checker.checkCompleteness(repo);

      expect(result.status).toBe("incomplete");
    });

    it("should use custom absolute threshold", async () => {
      // 15 files missing with 10-file custom threshold -> incomplete
      const scanner = createMockFileScanner(100);
      const checker = new IndexCompletenessChecker(scanner, {
        completenessThresholdAbsolute: 10,
      });
      const repo = createTestRepo(85);

      const result = await checker.checkCompleteness(repo);

      expect(result.status).toBe("incomplete");
    });

    it("should merge custom thresholds with defaults", async () => {
      // Only override percent, absolute should remain default (50)
      const scanner = createMockFileScanner(1000);
      const checker = new IndexCompletenessChecker(scanner, {
        completenessThresholdPercent: 5,
      });
      const repo = createTestRepo(960); // 4% divergence, 40 missing

      const result = await checker.checkCompleteness(repo);

      // 4% < 5% custom threshold, 40 < 50 default absolute -> complete
      expect(result.status).toBe("complete");
    });

    it("should handle very strict thresholds", async () => {
      const scanner = createMockFileScanner(100);
      const checker = new IndexCompletenessChecker(scanner, {
        completenessThresholdPercent: 0,
        completenessThresholdAbsolute: 0,
      });
      const repo = createTestRepo(99); // 1 file missing

      const result = await checker.checkCompleteness(repo);

      expect(result.status).toBe("incomplete");
      expect(result.missingFileCount).toBe(1);
    });
  });
});
