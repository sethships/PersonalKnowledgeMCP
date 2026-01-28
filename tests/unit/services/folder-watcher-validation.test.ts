/**
 * Unit tests for folder-watcher-validation.ts
 *
 * Tests Zod validation schemas for folder watcher configuration and options.
 */

import { describe, it, expect } from "bun:test";
import {
  WatchFolderOptionsSchema,
  FolderWatcherConfigSchema,
  FolderIdSchema,
  GlobPatternSchema,
  validateWatchFolderOptions,
  validateFolderWatcherConfig,
  safeValidateWatchFolderOptions,
  safeValidateFolderWatcherConfig,
} from "../../../src/services/folder-watcher-validation.js";

describe("folder-watcher-validation", () => {
  describe("WatchFolderOptionsSchema", () => {
    describe("valid inputs", () => {
      it("should accept valid options with all fields", () => {
        const options = {
          path: "/home/user/documents",
          name: "My Documents",
          includePatterns: ["*.md", "*.txt"],
          excludePatterns: ["node_modules/**"],
          debounceMs: 2000,
        };

        const result = WatchFolderOptionsSchema.safeParse(options);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toEqual(options);
        }
      });

      it("should accept valid options with required fields only", () => {
        const options = {
          path: "/home/user/documents",
          name: "My Documents",
        };

        const result = WatchFolderOptionsSchema.safeParse(options);
        expect(result.success).toBe(true);
      });

      it("should accept Windows absolute paths", () => {
        const windowsPaths = [
          "C:\\Users\\test",
          "D:/Projects/myapp",
          "C:/src/test",
          "\\\\server\\share",
        ];

        for (const path of windowsPaths) {
          const result = WatchFolderOptionsSchema.safeParse({ path, name: "Test" });
          expect(result.success).toBe(true);
        }
      });

      it("should accept Unix absolute paths", () => {
        const unixPaths = ["/home/user", "/var/log", "/", "/opt/app"];

        for (const path of unixPaths) {
          const result = WatchFolderOptionsSchema.safeParse({ path, name: "Test" });
          expect(result.success).toBe(true);
        }
      });

      it("should accept minimum debounce value", () => {
        const options = {
          path: "/test",
          name: "Test",
          debounceMs: 100,
        };

        const result = WatchFolderOptionsSchema.safeParse(options);
        expect(result.success).toBe(true);
      });

      it("should accept maximum debounce value", () => {
        const options = {
          path: "/test",
          name: "Test",
          debounceMs: 300000,
        };

        const result = WatchFolderOptionsSchema.safeParse(options);
        expect(result.success).toBe(true);
      });
    });

    describe("invalid inputs", () => {
      it("should reject empty path", () => {
        const options = {
          path: "",
          name: "Test",
        };

        const result = WatchFolderOptionsSchema.safeParse(options);
        expect(result.success).toBe(false);
      });

      it("should reject relative paths", () => {
        const relativePaths = ["relative/path", "./local", "../parent", "folder"];

        for (const path of relativePaths) {
          const result = WatchFolderOptionsSchema.safeParse({ path, name: "Test" });
          expect(result.success).toBe(false);
        }
      });

      it("should reject empty name", () => {
        const options = {
          path: "/test",
          name: "",
        };

        const result = WatchFolderOptionsSchema.safeParse(options);
        expect(result.success).toBe(false);
      });

      it("should reject name over 255 characters", () => {
        const options = {
          path: "/test",
          name: "a".repeat(256),
        };

        const result = WatchFolderOptionsSchema.safeParse(options);
        expect(result.success).toBe(false);
      });

      it("should reject debounce below minimum", () => {
        const options = {
          path: "/test",
          name: "Test",
          debounceMs: 50,
        };

        const result = WatchFolderOptionsSchema.safeParse(options);
        expect(result.success).toBe(false);
      });

      it("should reject debounce above maximum", () => {
        const options = {
          path: "/test",
          name: "Test",
          debounceMs: 400000,
        };

        const result = WatchFolderOptionsSchema.safeParse(options);
        expect(result.success).toBe(false);
      });

      it("should reject empty patterns in arrays", () => {
        const options = {
          path: "/test",
          name: "Test",
          includePatterns: ["*.md", ""],
        };

        const result = WatchFolderOptionsSchema.safeParse(options);
        expect(result.success).toBe(false);
      });
    });
  });

  describe("FolderWatcherConfigSchema", () => {
    describe("valid inputs", () => {
      it("should accept valid config with all fields", () => {
        const config = {
          defaultDebounceMs: 3000,
          maxConcurrentWatchers: 20,
          usePolling: true,
          pollInterval: 200,
          emitExistingFiles: true,
        };

        const result = FolderWatcherConfigSchema.safeParse(config);
        expect(result.success).toBe(true);
      });

      it("should accept empty config", () => {
        const result = FolderWatcherConfigSchema.safeParse({});
        expect(result.success).toBe(true);
      });

      it("should accept partial config", () => {
        const config = {
          usePolling: true,
        };

        const result = FolderWatcherConfigSchema.safeParse(config);
        expect(result.success).toBe(true);
      });
    });

    describe("invalid inputs", () => {
      it("should reject defaultDebounceMs below minimum", () => {
        const config = { defaultDebounceMs: 50 };
        const result = FolderWatcherConfigSchema.safeParse(config);
        expect(result.success).toBe(false);
      });

      it("should reject maxConcurrentWatchers below 1", () => {
        const config = { maxConcurrentWatchers: 0 };
        const result = FolderWatcherConfigSchema.safeParse(config);
        expect(result.success).toBe(false);
      });

      it("should reject maxConcurrentWatchers above 100", () => {
        const config = { maxConcurrentWatchers: 101 };
        const result = FolderWatcherConfigSchema.safeParse(config);
        expect(result.success).toBe(false);
      });

      it("should reject pollInterval below 100ms", () => {
        const config = { pollInterval: 50 };
        const result = FolderWatcherConfigSchema.safeParse(config);
        expect(result.success).toBe(false);
      });

      it("should reject pollInterval above 60000ms", () => {
        const config = { pollInterval: 61000 };
        const result = FolderWatcherConfigSchema.safeParse(config);
        expect(result.success).toBe(false);
      });
    });
  });

  describe("FolderIdSchema", () => {
    it("should accept valid UUIDs", () => {
      const validUUIDs = [
        "123e4567-e89b-12d3-a456-426614174000",
        "550e8400-e29b-41d4-a716-446655440000",
      ];

      for (const id of validUUIDs) {
        const result = FolderIdSchema.safeParse(id);
        expect(result.success).toBe(true);
      }
    });

    it("should accept non-UUID strings", () => {
      const validIds = ["folder-1", "my-folder", "test123"];

      for (const id of validIds) {
        const result = FolderIdSchema.safeParse(id);
        expect(result.success).toBe(true);
      }
    });

    it("should reject empty strings", () => {
      const result = FolderIdSchema.safeParse("");
      expect(result.success).toBe(false);
    });
  });

  describe("GlobPatternSchema", () => {
    it("should accept valid glob patterns", () => {
      const validPatterns = ["*.md", "**/*.ts", "src/**/*", "*.{js,ts}", "[a-z]*.txt"];

      for (const pattern of validPatterns) {
        const result = GlobPatternSchema.safeParse(pattern);
        expect(result.success).toBe(true);
      }
    });

    it("should reject empty patterns", () => {
      const result = GlobPatternSchema.safeParse("");
      expect(result.success).toBe(false);
    });

    it("should reject patterns with unmatched brackets", () => {
      const result = GlobPatternSchema.safeParse("[a-z");
      expect(result.success).toBe(false);
    });

    it("should reject patterns with unmatched braces", () => {
      const result = GlobPatternSchema.safeParse("{a,b");
      expect(result.success).toBe(false);
    });
  });

  describe("Helper functions", () => {
    describe("validateWatchFolderOptions", () => {
      it("should return validated options for valid input", () => {
        const options = { path: "/test", name: "Test" };
        const result = validateWatchFolderOptions(options);
        expect(result).toEqual(options);
      });

      it("should throw ZodError for invalid input", () => {
        const options = { path: "", name: "" };
        expect(() => validateWatchFolderOptions(options)).toThrow();
      });
    });

    describe("validateFolderWatcherConfig", () => {
      it("should return validated config for valid input", () => {
        const config = { usePolling: true };
        const result = validateFolderWatcherConfig(config);
        expect(result).toEqual(config);
      });

      it("should throw ZodError for invalid input", () => {
        const config = { pollInterval: -1 };
        expect(() => validateFolderWatcherConfig(config)).toThrow();
      });
    });

    describe("safeValidateWatchFolderOptions", () => {
      it("should return success result for valid input", () => {
        const options = { path: "/test", name: "Test" };
        const result = safeValidateWatchFolderOptions(options);
        expect(result.success).toBe(true);
      });

      it("should return error result for invalid input", () => {
        const options = { path: "", name: "" };
        const result = safeValidateWatchFolderOptions(options);
        expect(result.success).toBe(false);
      });
    });

    describe("safeValidateFolderWatcherConfig", () => {
      it("should return success result for valid input", () => {
        const config = { usePolling: false };
        const result = safeValidateFolderWatcherConfig(config);
        expect(result.success).toBe(true);
      });

      it("should return error result for invalid input", () => {
        const config = { maxConcurrentWatchers: -1 };
        const result = safeValidateFolderWatcherConfig(config);
        expect(result.success).toBe(false);
      });
    });
  });
});
