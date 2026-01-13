/**
 * Tests for CLI Validation Schemas
 */

import { describe, it, expect } from "bun:test";
import { IndexCommandOptionsSchema } from "../../../src/cli/utils/validation.js";

describe("IndexCommandOptionsSchema", () => {
  describe("provider validation", () => {
    it("should accept valid provider 'openai'", () => {
      const result = IndexCommandOptionsSchema.safeParse({ provider: "openai" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.provider).toBe("openai");
      }
    });

    it("should accept valid provider 'transformersjs'", () => {
      const result = IndexCommandOptionsSchema.safeParse({ provider: "transformersjs" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.provider).toBe("transformersjs");
      }
    });

    it("should accept valid provider 'transformers' (alias)", () => {
      const result = IndexCommandOptionsSchema.safeParse({ provider: "transformers" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.provider).toBe("transformers");
      }
    });

    it("should accept valid provider 'local' (alias for transformersjs)", () => {
      const result = IndexCommandOptionsSchema.safeParse({ provider: "local" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.provider).toBe("local");
      }
    });

    it("should accept valid provider 'ollama'", () => {
      const result = IndexCommandOptionsSchema.safeParse({ provider: "ollama" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.provider).toBe("ollama");
      }
    });

    it("should convert provider to lowercase", () => {
      const result = IndexCommandOptionsSchema.safeParse({ provider: "OPENAI" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.provider).toBe("openai");
      }
    });

    it("should convert mixed case provider to lowercase", () => {
      const result = IndexCommandOptionsSchema.safeParse({ provider: "TransformersJS" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.provider).toBe("transformersjs");
      }
    });

    it("should reject invalid provider", () => {
      const result = IndexCommandOptionsSchema.safeParse({ provider: "invalid" });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain("Invalid provider");
      }
    });

    it("should reject unknown provider", () => {
      const result = IndexCommandOptionsSchema.safeParse({ provider: "anthropic" });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain("Invalid provider");
      }
    });

    it("should allow undefined provider (optional)", () => {
      const result = IndexCommandOptionsSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.provider).toBeUndefined();
      }
    });

    it("should allow empty options object", () => {
      const result = IndexCommandOptionsSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  describe("combined options validation", () => {
    it("should accept all options together", () => {
      const result = IndexCommandOptionsSchema.safeParse({
        name: "custom-repo",
        branch: "develop",
        force: true,
        provider: "openai",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("custom-repo");
        expect(result.data.branch).toBe("develop");
        expect(result.data.force).toBe(true);
        expect(result.data.provider).toBe("openai");
      }
    });

    it("should accept partial options with provider", () => {
      const result = IndexCommandOptionsSchema.safeParse({
        force: true,
        provider: "local",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.force).toBe(true);
        expect(result.data.provider).toBe("local");
        expect(result.data.name).toBeUndefined();
        expect(result.data.branch).toBeUndefined();
      }
    });
  });
});
