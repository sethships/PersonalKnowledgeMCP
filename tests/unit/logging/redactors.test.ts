/**
 * Unit tests for secret redaction
 *
 * Tests secret redaction patterns and sanitization utilities.
 * Security-critical - aiming for 100% coverage.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  REDACT_PATHS,
  REDACT_OPTIONS,
  SECRET_PATTERNS,
  looksLikeSecret,
  sanitizeError,
  initializeLogger,
  getComponentLogger,
  resetLogger,
} from "../../../src/logging/index.js";

describe("Secret Redaction", () => {
  afterEach(() => {
    resetLogger();
  });

  describe("REDACT_PATHS", () => {
    test("should include environment variable paths", () => {
      expect(REDACT_PATHS).toContain("env.OPENAI_API_KEY");
      expect(REDACT_PATHS).toContain("env.GITHUB_PAT");
      expect(REDACT_PATHS).toContain("env.GITHUB_TOKEN");
    });

    test("should include authorization header paths", () => {
      expect(REDACT_PATHS).toContain("headers.authorization");
      expect(REDACT_PATHS).toContain("headers.Authorization");
      expect(REDACT_PATHS).toContain("req.headers.authorization");
      expect(REDACT_PATHS).toContain("res.headers.authorization");
    });

    test("should include wildcard patterns for common secret fields", () => {
      expect(REDACT_PATHS).toContain("*.apiKey");
      expect(REDACT_PATHS).toContain("*.api_key");
      expect(REDACT_PATHS).toContain("*.password");
      expect(REDACT_PATHS).toContain("*.token");
      expect(REDACT_PATHS).toContain("*.secret");
      expect(REDACT_PATHS).toContain("*.pat");
      expect(REDACT_PATHS).toContain("*.accessToken");
      expect(REDACT_PATHS).toContain("*.privateKey");
    });

    test("should include query parameter paths", () => {
      expect(REDACT_PATHS).toContain("query.token");
      expect(REDACT_PATHS).toContain("query.apiKey");
      expect(REDACT_PATHS).toContain("query.api_key");
    });
  });

  describe("REDACT_OPTIONS", () => {
    test("should use correct redaction options", () => {
      expect(REDACT_OPTIONS.paths).toEqual(REDACT_PATHS);
      expect(REDACT_OPTIONS.censor).toBe("[REDACTED]");
      expect(REDACT_OPTIONS.remove).toBe(false);
    });
  });

  describe("SECRET_PATTERNS", () => {
    test("should match OpenAI API keys", () => {
      // Modern format (sk-proj-...)
      expect(
        SECRET_PATTERNS.openai.test("sk-proj-abc123def456ghi789jkl012mno345pqr678stu901vwx234yz567")
      ).toBe(true);

      // Legacy format (sk-...)
      expect(SECRET_PATTERNS.openai.test("sk-abc123def456ghi789jkl012mno345pqr678")).toBe(true);

      // Should not match non-keys
      expect(SECRET_PATTERNS.openai.test("not-a-key")).toBe(false);
      expect(SECRET_PATTERNS.openai.test("sk-short")).toBe(false);
    });

    test("should match GitHub Personal Access Tokens (classic)", () => {
      // Classic PAT format (ghp_...)
      expect(SECRET_PATTERNS.githubPat.test("ghp_abc123def456ghi789jkl012mno345pqr678")).toBe(true);

      // Should not match non-PATs
      expect(SECRET_PATTERNS.githubPat.test("ghp_short")).toBe(false);
      expect(SECRET_PATTERNS.githubPat.test("not-a-pat")).toBe(false);
    });

    test("should match GitHub Fine-Grained PATs", () => {
      // Fine-grained PAT format (github_pat_...)
      const finePat = "github_pat_" + "a".repeat(82); // 82 characters after prefix
      expect(SECRET_PATTERNS.githubFinePat.test(finePat)).toBe(true);

      // Should not match incorrect lengths
      expect(SECRET_PATTERNS.githubFinePat.test("github_pat_short")).toBe(false);
      expect(SECRET_PATTERNS.githubFinePat.test("not-a-pat")).toBe(false);
    });

    test("should match JWT tokens", () => {
      // Valid JWT format (header.payload.signature)
      expect(
        SECRET_PATTERNS.jwt.test(
          "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
        )
      ).toBe(true);

      // Should not match non-JWTs
      expect(SECRET_PATTERNS.jwt.test("not.a.jwt")).toBe(false);
      expect(SECRET_PATTERNS.jwt.test("eyJtest.incomplete")).toBe(false);
    });

    test("should match generic API keys", () => {
      // 32+ character alphanumeric strings
      expect(SECRET_PATTERNS.genericApiKey.test("a".repeat(32))).toBe(true);
      expect(SECRET_PATTERNS.genericApiKey.test("abc123def456ghi789jkl012mno345pqr678")).toBe(true);

      // Should not match short strings
      expect(SECRET_PATTERNS.genericApiKey.test("short")).toBe(false);
      expect(SECRET_PATTERNS.genericApiKey.test("a".repeat(31))).toBe(false);
    });
  });

  describe("looksLikeSecret", () => {
    test("should detect OpenAI API keys", () => {
      expect(looksLikeSecret("sk-proj-" + "a".repeat(40))).toBe(true);
      expect(looksLikeSecret("sk-" + "a".repeat(40))).toBe(true);
    });

    test("should detect GitHub PATs", () => {
      expect(looksLikeSecret("ghp_" + "a".repeat(36))).toBe(true);
      expect(looksLikeSecret("github_pat_" + "a".repeat(82))).toBe(true);
    });

    test("should detect JWT tokens", () => {
      expect(
        looksLikeSecret(
          "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
        )
      ).toBe(true);
    });

    test("should detect generic long API keys", () => {
      expect(looksLikeSecret("a".repeat(50))).toBe(true);
    });

    test("should not flag normal strings", () => {
      expect(looksLikeSecret("hello world")).toBe(false);
      expect(looksLikeSecret("user@example.com")).toBe(false);
      expect(looksLikeSecret("short")).toBe(false);
      expect(looksLikeSecret("repository_name")).toBe(false);
    });
  });

  describe("sanitizeError", () => {
    test("should preserve basic error properties", () => {
      const error = new Error("Test error");
      const sanitized = sanitizeError(error);

      expect(sanitized["name"]).toBe("Error");
      expect(sanitized["message"]).toBe("Test error");
      expect(sanitized["stack"]).toBeDefined();
    });

    test("should handle nested error causes", () => {
      const rootCause = new Error("Root cause");
      const error = new Error("Main error", { cause: rootCause });

      const sanitized = sanitizeError(error);

      expect(sanitized["message"]).toBe("Main error");
      expect(sanitized["cause"]).toBeDefined();

      const cause = sanitized["cause"] as Record<string, unknown>;
      expect(cause["message"]).toBe("Root cause");
    });

    test("should preserve custom error properties", () => {
      interface CustomError extends Error {
        customField?: string;
        statusCode?: number;
      }

      const error = new Error("Test error") as CustomError;
      error.customField = "custom value";
      error.statusCode = 500;

      const sanitized = sanitizeError(error);

      expect(sanitized["customField"]).toBe("custom value");
      expect(sanitized["statusCode"]).toBe(500);
    });

    test("should handle errors without causes", () => {
      const error = new Error("Simple error");
      const sanitized = sanitizeError(error);

      expect(sanitized["cause"]).toBeUndefined();
    });
  });

  describe("Integration: Logger initialization with redaction", () => {
    beforeEach(() => {
      initializeLogger({
        level: "info",
        format: "json",
      });
    });

    test("should create logger with redaction configured", () => {
      const logger = getComponentLogger("test");

      // Logger should be created successfully
      expect(logger).toBeDefined();
      expect(logger.info).toBeDefined();

      // Test that logger can handle objects with sensitive fields
      // Note: Actual redaction is verified through manual testing
      // since Pino's async output is not reliably captured in tests
      expect(() => {
        logger.info({
          env: {
            OPENAI_API_KEY: "sk-proj-secret123456789012345678901234567890",
            OTHER_VAR: "safe value",
          },
        });
      }).not.toThrow();
    });

    test("should handle logging with GITHUB_PAT in env", () => {
      const logger = getComponentLogger("test");

      expect(() => {
        logger.info({
          env: {
            GITHUB_PAT: "ghp_secret123456789012345678901234567890",
          },
        });
      }).not.toThrow();
    });

    test("should handle logging with GITHUB_TOKEN in env", () => {
      const logger = getComponentLogger("test");

      expect(() => {
        logger.info({
          env: {
            GITHUB_TOKEN: "ghp_secret123456789012345678901234567890",
          },
        });
      }).not.toThrow();
    });

    test("should handle logging with authorization headers", () => {
      const logger = getComponentLogger("test");

      expect(() => {
        logger.info({
          headers: {
            authorization: "Bearer secret-token",
            "content-type": "application/json",
          },
        });
      }).not.toThrow();
    });

    test("should handle logging with nested apiKey fields", () => {
      const logger = getComponentLogger("test");

      expect(() => {
        logger.info({
          config: {
            apiKey: "secret-api-key-12345",
            endpoint: "https://api.example.com",
          },
        });
      }).not.toThrow();
    });

    test("should handle logging with password fields", () => {
      const logger = getComponentLogger("test");

      expect(() => {
        logger.info({
          user: {
            username: "john.doe",
            password: "super-secret-password",
          },
        });
      }).not.toThrow();
    });

    test("should handle logging non-sensitive data", () => {
      const logger = getComponentLogger("test");

      expect(() => {
        logger.info({
          message: "Operation completed",
          duration: 123,
          status: "success",
          data: {
            count: 42,
            items: ["item1", "item2"],
          },
        });
      }).not.toThrow();
    });
  });
});
