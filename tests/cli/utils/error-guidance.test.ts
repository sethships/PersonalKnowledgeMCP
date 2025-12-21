/**
 * Error Guidance Module Tests
 *
 * Tests for the error pattern matching and guidance functionality.
 */

import { describe, test, expect } from "bun:test";
import { getErrorGuidance, ERROR_GUIDANCE } from "../../../src/cli/utils/error-guidance.js";

describe("error-guidance", () => {
  describe("getErrorGuidance", () => {
    describe("file system errors", () => {
      test("matches ENOENT errors", () => {
        const guidance = getErrorGuidance(
          "ENOENT: no such file or directory, open '/path/to/file.ts'"
        );
        expect(guidance).toBe("File was deleted between pull and processing. Safe to ignore.");
      });

      test("matches 'no such file' errors", () => {
        const guidance = getErrorGuidance("Failed to read file: no such file or directory");
        expect(guidance).toBe("File was deleted between pull and processing. Safe to ignore.");
      });

      test("matches EACCES permission errors", () => {
        const guidance = getErrorGuidance("EACCES: permission denied, open '/path/to/file.ts'");
        expect(guidance).toBe("Permission denied. Check file permissions.");
      });
    });

    describe("parsing and syntax errors", () => {
      test("matches Unexpected token errors", () => {
        const guidance = getErrorGuidance("SyntaxError: Unexpected token '}'");
        expect(guidance).toBe("Source file has syntax errors. Fix the file and retry.");
      });

      test("matches syntax error messages", () => {
        const guidance = getErrorGuidance("Failed to parse: syntax error at line 42");
        expect(guidance).toBe("Source file has syntax errors. Fix the file and retry.");
      });

      test("matches chunking errors", () => {
        const guidance = getErrorGuidance("Failed to chunk file: invalid format");
        expect(guidance).toBe("File could not be split into chunks. Check file format.");
      });
    });

    describe("size limit errors", () => {
      test("matches file too large errors", () => {
        const guidance = getErrorGuidance("File too large: exceeds 10MB limit");
        expect(guidance).toBe("File exceeds size limit. Add to excludePatterns or increase limit.");
      });

      test("matches size limit exceeded errors", () => {
        const guidance = getErrorGuidance("Content size exceeds configured limit");
        expect(guidance).toBe("File exceeds size limit. Add to excludePatterns or increase limit.");
      });
    });

    describe("rate limit errors", () => {
      test("matches rate limit message", () => {
        const guidance = getErrorGuidance("OpenAI API rate limit exceeded");
        expect(guidance).toBe("Rate limited by API. Wait 60 seconds and retry.");
      });

      test("matches HTTP 429 errors", () => {
        const guidance = getErrorGuidance("Request failed with status 429");
        expect(guidance).toBe("Rate limited by API. Wait 60 seconds and retry.");
      });

      test("matches too many requests errors", () => {
        const guidance = getErrorGuidance("Too many requests, please try again later");
        expect(guidance).toBe("Rate limited by API. Wait 60 seconds and retry.");
      });
    });

    describe("security errors", () => {
      test("matches path traversal errors", () => {
        const guidance = getErrorGuidance("Path traversal detected: ../../../etc/passwd");
        expect(guidance).toBe(
          "Security issue detected. Investigate repository for malicious paths."
        );
      });
    });

    describe("embedding and API errors", () => {
      test("matches embedding failed errors", () => {
        const guidance = getErrorGuidance("Embedding generation failed for batch");
        expect(guidance).toBe("Embedding API error. Check OPENAI_API_KEY and API status.");
      });

      test("matches OpenAI error messages", () => {
        const guidance = getErrorGuidance("OpenAI API error: service unavailable");
        expect(guidance).toBe("Embedding API error. Check OPENAI_API_KEY and API status.");
      });

      test("matches authentication errors (401)", () => {
        const guidance = getErrorGuidance("Request failed with status 401 Unauthorized");
        expect(guidance).toBe("API authentication failed. Verify API key is valid.");
      });

      test("matches invalid key errors", () => {
        const guidance = getErrorGuidance("Invalid API key provided");
        expect(guidance).toBe("API authentication failed. Verify API key is valid.");
      });
    });

    describe("ChromaDB and storage errors", () => {
      test("matches ChromaDB connection errors", () => {
        const guidance = getErrorGuidance("Failed to connect to ChromaDB");
        expect(guidance).toBe("ChromaDB connection issue. Verify it's running: docker ps");
      });

      test("matches chromadb keyword", () => {
        const guidance = getErrorGuidance("chromadb: insert timeout");
        expect(guidance).toBe("ChromaDB connection issue. Verify it's running: docker ps");
      });

      test("matches batch upsert failures", () => {
        const guidance = getErrorGuidance("batch upsert failed at ChromaDB layer");
        expect(guidance).toBe("ChromaDB connection issue. Verify it's running: docker ps");
      });
    });

    describe("network errors", () => {
      test("matches ETIMEDOUT errors", () => {
        const guidance = getErrorGuidance("ETIMEDOUT: connection timed out");
        expect(guidance).toBe("Network error. Check connectivity and retry.");
      });

      test("matches socket hang up errors", () => {
        const guidance = getErrorGuidance("socket hang up");
        expect(guidance).toBe("Network error. Check connectivity and retry.");
      });
    });

    describe("renamed file errors", () => {
      test("matches renamed file missing previousPath", () => {
        const guidance = getErrorGuidance("Renamed file missing previousPath");
        expect(guidance).toBe(
          "Renamed file missing old path info. Re-run full re-index with --force."
        );
      });
    });

    describe("unknown errors", () => {
      test("returns undefined for unknown errors", () => {
        const guidance = getErrorGuidance("Some completely unknown error message");
        expect(guidance).toBeUndefined();
      });

      test("returns undefined for empty string", () => {
        const guidance = getErrorGuidance("");
        expect(guidance).toBeUndefined();
      });
    });

    describe("case insensitivity", () => {
      test("matches ENOENT in lowercase", () => {
        const guidance = getErrorGuidance("enoent: no such file");
        expect(guidance).toBe("File was deleted between pull and processing. Safe to ignore.");
      });

      test("matches ENOENT in mixed case", () => {
        const guidance = getErrorGuidance("Enoent error occurred");
        expect(guidance).toBe("File was deleted between pull and processing. Safe to ignore.");
      });
    });

    describe("first match wins", () => {
      test("returns first matching pattern when multiple could match", () => {
        // This error contains both ENOENT (first pattern) and could technically match others
        const guidance = getErrorGuidance("ENOENT with network issue");
        expect(guidance).toBe("File was deleted between pull and processing. Safe to ignore.");
      });
    });
  });

  describe("ERROR_GUIDANCE array", () => {
    test("contains at least 10 patterns", () => {
      expect(ERROR_GUIDANCE.length).toBeGreaterThanOrEqual(10);
    });

    test("all entries have pattern and guidance", () => {
      for (const entry of ERROR_GUIDANCE) {
        expect(entry.pattern).toBeInstanceOf(RegExp);
        expect(typeof entry.guidance).toBe("string");
        expect(entry.guidance.length).toBeGreaterThan(0);
      }
    });

    test("all patterns are case-insensitive", () => {
      for (const entry of ERROR_GUIDANCE) {
        expect(entry.pattern.flags).toContain("i");
      }
    });
  });
});
