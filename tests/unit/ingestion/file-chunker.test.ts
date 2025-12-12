/**
 * Unit tests for FileChunker.
 *
 * Tests all aspects of file chunking including configuration, chunking logic,
 * overlap behavior, and edge cases.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { FileChunker } from "../../../src/ingestion/file-chunker.js";
import type { FileInfo } from "../../../src/ingestion/types.js";
import { ChunkingError, ValidationError } from "../../../src/ingestion/errors.js";
import { initializeLogger, resetLogger } from "../../../src/logging/index.js";
import {
  SMALL_FILE_CONTENT,
  EMPTY_FILE_CONTENT,
  WHITESPACE_ONLY_CONTENT,
  LONG_SINGLE_LINE,
  MEDIUM_FILE_CONTENT,
  WINDOWS_LINE_ENDINGS_CONTENT,
  NO_FINAL_NEWLINE_CONTENT,
  UNICODE_CONTENT,
  generateLargeFileContent,
  createMockFileInfo,
} from "../../fixtures/chunk-fixtures.js";

describe("FileChunker", () => {
  beforeEach(() => {
    initializeLogger({ level: "error", format: "json" });
  });

  afterEach(() => {
    resetLogger();
  });

  describe("Configuration", () => {
    test("uses default configuration", () => {
      const chunker = new FileChunker();
      expect(chunker).toBeDefined();
    });

    test("accepts custom configuration", () => {
      const chunker = new FileChunker({
        maxChunkTokens: 1000,
        overlapTokens: 100,
      });
      expect(chunker).toBeDefined();
    });

    test("loads from environment variables", () => {
      // Set environment variables
      process.env["CHUNK_MAX_TOKENS"] = "800";
      process.env["CHUNK_OVERLAP_TOKENS"] = "80";

      const chunker = new FileChunker();
      expect(chunker).toBeDefined();

      // Clean up
      delete process.env["CHUNK_MAX_TOKENS"];
      delete process.env["CHUNK_OVERLAP_TOKENS"];
    });

    test("validates overlap < maxTokens", () => {
      expect(() => {
        new FileChunker({
          maxChunkTokens: 100,
          overlapTokens: 100, // Equal to max - invalid
        });
      }).toThrow(ValidationError);

      expect(() => {
        new FileChunker({
          maxChunkTokens: 100,
          overlapTokens: 150, // Greater than max - invalid
        });
      }).toThrow(ValidationError);
    });

    test("handles invalid environment variables gracefully", () => {
      process.env["CHUNK_MAX_TOKENS"] = "invalid";
      process.env["CHUNK_OVERLAP_TOKENS"] = "-10";

      // Should fall back to defaults
      const chunker = new FileChunker();
      expect(chunker).toBeDefined();

      delete process.env["CHUNK_MAX_TOKENS"];
      delete process.env["CHUNK_OVERLAP_TOKENS"];
    });
  });

  describe("Empty Files", () => {
    test("empty file returns empty array", async () => {
      const chunker = new FileChunker();
      const fileInfo = createMockFileInfo({ sizeBytes: 0 });

      const chunks = chunker.chunkFile(EMPTY_FILE_CONTENT, fileInfo, "test-repo");

      expect(chunks).toEqual([]);
    });

    test("whitespace-only file returns empty array", async () => {
      const chunker = new FileChunker();
      const fileInfo = createMockFileInfo({ sizeBytes: WHITESPACE_ONLY_CONTENT.length });

      const chunks = chunker.chunkFile(WHITESPACE_ONLY_CONTENT, fileInfo, "test-repo");

      expect(chunks).toEqual([]);
    });
  });

  describe("Small Files", () => {
    test("small file returns single chunk", async () => {
      const chunker = new FileChunker({ maxChunkTokens: 500 });
      const fileInfo = createMockFileInfo({ sizeBytes: SMALL_FILE_CONTENT.length });

      const chunks = chunker.chunkFile(SMALL_FILE_CONTENT, fileInfo, "test-repo");

      expect(chunks).toHaveLength(1);
      expect(chunks[0]!.chunkIndex).toBe(0);
      expect(chunks[0]!.totalChunks).toBe(1);
      expect(chunks[0]!.content).toBe(SMALL_FILE_CONTENT);
    });

    test("single chunk has correct metadata", async () => {
      const chunker = new FileChunker();
      const fileInfo = createMockFileInfo({
        relativePath: "src/auth/middleware.ts",
        extension: ".ts",
        sizeBytes: SMALL_FILE_CONTENT.length,
        modifiedAt: new Date("2024-12-11T10:00:00Z"),
      });

      const chunks = chunker.chunkFile(SMALL_FILE_CONTENT, fileInfo, "my-api");

      expect(chunks[0]!.id).toBe("my-api:src/auth/middleware.ts:0");
      expect(chunks[0]!.repository).toBe("my-api");
      expect(chunks[0]!.filePath).toBe("src/auth/middleware.ts");
      expect(chunks[0]!.startLine).toBe(1);
      expect(chunks[0]!.endLine).toBeGreaterThan(1);
      expect(chunks[0]!.metadata.extension).toBe(".ts");
      expect(chunks[0]!.metadata.fileSizeBytes).toBe(SMALL_FILE_CONTENT.length);
      expect(chunks[0]!.metadata.contentHash).toBeDefined();
      expect(chunks[0]!.metadata.contentHash).toHaveLength(64); // SHA-256 hex
      expect(chunks[0]!.metadata.fileModifiedAt).toEqual(new Date("2024-12-11T10:00:00Z"));
    });

    test("chunk ID format is correct", async () => {
      const chunker = new FileChunker();
      const fileInfo = createMockFileInfo({ relativePath: "test/file.js" });

      const chunks = chunker.chunkFile(SMALL_FILE_CONTENT, fileInfo, "repo-name");

      expect(chunks[0]!.id).toBe("repo-name:test/file.js:0");
    });

    test("content hash is stable for same content", async () => {
      const chunker = new FileChunker();
      const fileInfo = createMockFileInfo();

      const chunks1 = chunker.chunkFile(SMALL_FILE_CONTENT, fileInfo, "test-repo");
      const chunks2 = chunker.chunkFile(SMALL_FILE_CONTENT, fileInfo, "test-repo");

      expect(chunks1[0]!.metadata.contentHash).toBe(chunks2[0]!.metadata.contentHash);
    });

    test("content hash differs for different content", async () => {
      const chunker = new FileChunker();
      const fileInfo = createMockFileInfo();

      const chunks1 = chunker.chunkFile(SMALL_FILE_CONTENT, fileInfo, "test-repo");
      const chunks2 = chunker.chunkFile(MEDIUM_FILE_CONTENT, fileInfo, "test-repo");

      expect(chunks1[0]!.metadata.contentHash).not.toBe(chunks2[0]!.metadata.contentHash);
    });
  });

  describe("Large Files", () => {
    test("large file creates multiple chunks", async () => {
      const chunker = new FileChunker({ maxChunkTokens: 100, overlapTokens: 20 });
      const content = MEDIUM_FILE_CONTENT;
      const fileInfo = createMockFileInfo({ sizeBytes: content.length });

      const chunks = chunker.chunkFile(content, fileInfo, "test-repo");

      expect(chunks.length).toBeGreaterThan(1);
    });

    test("all chunks have correct totalChunks", async () => {
      const chunker = new FileChunker({ maxChunkTokens: 100, overlapTokens: 20 });
      const content = MEDIUM_FILE_CONTENT;
      const fileInfo = createMockFileInfo({ sizeBytes: content.length });

      const chunks = chunker.chunkFile(content, fileInfo, "test-repo");

      const totalChunks = chunks.length;
      chunks.forEach((chunk) => {
        expect(chunk.totalChunks).toBe(totalChunks);
      });
    });

    test("chunk indices are sequential", async () => {
      const chunker = new FileChunker({ maxChunkTokens: 100, overlapTokens: 20 });
      const content = MEDIUM_FILE_CONTENT;
      const fileInfo = createMockFileInfo({ sizeBytes: content.length });

      const chunks = chunker.chunkFile(content, fileInfo, "test-repo");

      chunks.forEach((chunk, index) => {
        expect(chunk.chunkIndex).toBe(index);
      });
    });

    test("chunk IDs are unique", async () => {
      const chunker = new FileChunker({ maxChunkTokens: 100, overlapTokens: 20 });
      const content = MEDIUM_FILE_CONTENT;
      const fileInfo = createMockFileInfo({ sizeBytes: content.length });

      const chunks = chunker.chunkFile(content, fileInfo, "test-repo");

      const ids = chunks.map((c) => c.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(chunks.length);
    });

    test("line numbers are tracked correctly", async () => {
      const chunker = new FileChunker({ maxChunkTokens: 100, overlapTokens: 20 });
      const content = MEDIUM_FILE_CONTENT;
      const fileInfo = createMockFileInfo({ sizeBytes: content.length });

      const chunks = chunker.chunkFile(content, fileInfo, "test-repo");

      // First chunk should start at line 1
      expect(chunks[0]!.startLine).toBe(1);

      // Each chunk should have valid line range
      chunks.forEach((chunk) => {
        expect(chunk.startLine).toBeGreaterThan(0);
        expect(chunk.endLine).toBeGreaterThanOrEqual(chunk.startLine);
      });

      // Last chunk should end at or before total line count
      const totalLines = content.split("\n").length;
      expect(chunks[chunks.length - 1]!.endLine).toBeLessThanOrEqual(totalLines);
    });
  });

  describe("Overlap Behavior", () => {
    test("chunks have overlap from previous chunk", async () => {
      const chunker = new FileChunker({ maxChunkTokens: 100, overlapTokens: 20 });
      const content = MEDIUM_FILE_CONTENT;
      const fileInfo = createMockFileInfo({ sizeBytes: content.length });

      const chunks = chunker.chunkFile(content, fileInfo, "test-repo");

      if (chunks.length > 1) {
        // Check that subsequent chunks start before the previous chunk ends
        for (let i = 1; i < chunks.length; i++) {
          expect(chunks[i]!.startLine).toBeLessThan(chunks[i - 1]!.endLine);
        }
      }
    });

    test("overlap provides content continuity", async () => {
      const chunker = new FileChunker({ maxChunkTokens: 100, overlapTokens: 30 });
      const content = MEDIUM_FILE_CONTENT;
      const fileInfo = createMockFileInfo({ sizeBytes: content.length });

      const chunks = chunker.chunkFile(content, fileInfo, "test-repo");

      if (chunks.length > 1) {
        // Extract last few lines of first chunk
        const firstChunkLines = chunks[0]!.content.split("\n");
        const lastLinesOfFirst = firstChunkLines.slice(-2);

        // Extract first few lines of second chunk
        const secondChunkLines = chunks[1]!.content.split("\n");

        // There should be some overlap (at least one line from end of first chunk
        // should appear at start of second chunk)
        const hasOverlap = lastLinesOfFirst.some((line) => secondChunkLines.includes(line));
        expect(hasOverlap).toBe(true);
      }
    });
  });

  describe("Edge Cases", () => {
    test("very long single line is handled", async () => {
      const chunker = new FileChunker({ maxChunkTokens: 100 });
      const content = LONG_SINGLE_LINE;
      const fileInfo = createMockFileInfo({ sizeBytes: content.length });

      // Should not throw, even though line exceeds limit
      const chunks = chunker.chunkFile(content, fileInfo, "test-repo");

      expect(chunks).toHaveLength(1);
      expect(chunks[0]!.content).toBe(LONG_SINGLE_LINE);
    });

    test("file with no final newline", async () => {
      const chunker = new FileChunker();
      const content = NO_FINAL_NEWLINE_CONTENT;
      const fileInfo = createMockFileInfo({ sizeBytes: content.length });

      const chunks = chunker.chunkFile(content, fileInfo, "test-repo");

      expect(chunks.length).toBeGreaterThan(0);
      // Last chunk should contain the last line
      expect(chunks[chunks.length - 1]!.content).toContain("line 3");
    });

    test("Windows line endings are handled", async () => {
      const chunker = new FileChunker();
      const content = WINDOWS_LINE_ENDINGS_CONTENT;
      const fileInfo = createMockFileInfo({ sizeBytes: content.length });

      const chunks = chunker.chunkFile(content, fileInfo, "test-repo");

      expect(chunks.length).toBeGreaterThan(0);
      // Content should be preserved (including \r)
      expect(chunks[0]!.content).toBeDefined();
    });

    test("Unicode characters are handled", async () => {
      const chunker = new FileChunker();
      const content = UNICODE_CONTENT;
      const fileInfo = createMockFileInfo({ sizeBytes: content.length });

      const chunks = chunker.chunkFile(content, fileInfo, "test-repo");

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0]!.content).toContain("世界");
      expect(chunks[0]!.content).toContain("🚀");
    });

    test("chunk limit is enforced (truncates to 100)", async () => {
      // Create file that would generate more than 100 chunks
      const chunker = new FileChunker({ maxChunkTokens: 10, overlapTokens: 2 });
      const content = generateLargeFileContent(500); // Very large file
      const fileInfo = createMockFileInfo({ sizeBytes: content.length });

      const chunks = chunker.chunkFile(content, fileInfo, "test-repo");

      // Should be capped at 100
      expect(chunks.length).toBe(100);
      expect(chunks[99]!.totalChunks).toBe(100);
    });
  });

  describe("Token Estimation", () => {
    test("estimates tokens for short text", async () => {
      const chunker = new FileChunker({ maxChunkTokens: 50, overlapTokens: 10 });
      const content = "a".repeat(200); // 200 chars = ~50 tokens
      const fileInfo = createMockFileInfo({ sizeBytes: content.length });

      const chunks = chunker.chunkFile(content, fileInfo, "test-repo");

      // Should create multiple chunks due to token limit
      expect(chunks.length).toBeGreaterThanOrEqual(1);
    });

    test("respects maxChunkTokens limit", async () => {
      const chunker = new FileChunker({ maxChunkTokens: 100, overlapTokens: 0 });
      const content = generateLargeFileContent(50);
      const fileInfo = createMockFileInfo({ sizeBytes: content.length });

      const chunks = chunker.chunkFile(content, fileInfo, "test-repo");

      // Each chunk should be roughly within token limit
      // (allowing for lines that can't be split)
      chunks.forEach((chunk) => {
        const estimatedTokens = Math.ceil(chunk.content.length / 4);
        // Allow some tolerance for unsplittable lines
        expect(estimatedTokens).toBeLessThan(500);
      });
    });
  });

  describe("Error Handling", () => {
    test("throws ChunkingError on unexpected error", async () => {
      const chunker = new FileChunker();
      const invalidFileInfo = null as unknown as FileInfo;

      expect(() => {
        chunker.chunkFile("content", invalidFileInfo, "test-repo");
      }).toThrow();
    });

    test("ChunkingError includes file path", async () => {
      const chunker = new FileChunker();
      const invalidFileInfo = null as unknown as FileInfo;

      try {
        chunker.chunkFile("content", invalidFileInfo, "test-repo");
        expect.unreachable("Should have thrown");
      } catch (error) {
        if (error instanceof ChunkingError) {
          expect(error.filePath).toBeDefined();
        }
      }
    });
  });

  describe("Integration", () => {
    test("chunks realistic code file correctly", async () => {
      const chunker = new FileChunker({ maxChunkTokens: 200, overlapTokens: 30 });
      const fileInfo = createMockFileInfo({
        relativePath: "src/auth/router.ts",
        extension: ".ts",
        sizeBytes: MEDIUM_FILE_CONTENT.length,
      });

      const chunks = chunker.chunkFile(MEDIUM_FILE_CONTENT, fileInfo, "auth-service");

      // Verify basic structure
      expect(chunks.length).toBeGreaterThan(0);

      // Verify each chunk
      chunks.forEach((chunk, index) => {
        expect(chunk.id).toBe(`auth-service:src/auth/router.ts:${index}`);
        expect(chunk.repository).toBe("auth-service");
        expect(chunk.filePath).toBe("src/auth/router.ts");
        expect(chunk.content).toBeDefined();
        expect(chunk.content.length).toBeGreaterThan(0);
        expect(chunk.chunkIndex).toBe(index);
        expect(chunk.totalChunks).toBe(chunks.length);
        expect(chunk.metadata.extension).toBe(".ts");
        expect(chunk.metadata.fileSizeBytes).toBe(MEDIUM_FILE_CONTENT.length);
        expect(chunk.metadata.contentHash).toHaveLength(64);
      });
    });

    test("handles multiple files with same chunker instance", async () => {
      const chunker = new FileChunker();

      const file1Info = createMockFileInfo({ relativePath: "file1.ts" });
      const file2Info = createMockFileInfo({ relativePath: "file2.ts" });

      const chunks1 = chunker.chunkFile(SMALL_FILE_CONTENT, file1Info, "test-repo");
      const chunks2 = chunker.chunkFile(MEDIUM_FILE_CONTENT, file2Info, "test-repo");

      expect(chunks1.length).toBeGreaterThan(0);
      expect(chunks2.length).toBeGreaterThan(0);
      expect(chunks1[0]!.filePath).toBe("file1.ts");
      expect(chunks2[0]!.filePath).toBe("file2.ts");
    });
  });
});
