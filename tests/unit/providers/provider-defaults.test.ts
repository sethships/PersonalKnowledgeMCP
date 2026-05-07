/**
 * Unit tests for resolveEmbeddingDefaults — the provider-aware defaults
 * helper that prevents EMBEDDING_MODEL leaking across providers (#581).
 */

import { describe, test, expect } from "bun:test";
import {
  resolveEmbeddingDefaults,
  PROVIDER_DEFAULT_MODEL,
  PROVIDER_DEFAULT_DIMENSIONS,
} from "../../../src/providers/provider-defaults.js";

describe("resolveEmbeddingDefaults", () => {
  describe("when envModel is undefined", () => {
    test("returns provider default for openai", () => {
      const result = resolveEmbeddingDefaults("openai", undefined, undefined);
      expect(result.model).toBe(PROVIDER_DEFAULT_MODEL.openai);
      expect(result.dimensions).toBe(PROVIDER_DEFAULT_DIMENSIONS.openai);
      expect(result.warning).toBeUndefined();
    });

    test("returns provider default for transformersjs", () => {
      const result = resolveEmbeddingDefaults("transformersjs", undefined, undefined);
      expect(result.model).toBe("Xenova/all-MiniLM-L6-v2");
      expect(result.dimensions).toBe(384);
      expect(result.warning).toBeUndefined();
    });

    test("returns provider default for ollama", () => {
      const result = resolveEmbeddingDefaults("ollama", undefined, undefined);
      expect(result.model).toBe("nomic-embed-text");
      expect(result.dimensions).toBe(768);
      expect(result.warning).toBeUndefined();
    });

    test("respects envDimensions when supplied without envModel", () => {
      const result = resolveEmbeddingDefaults("openai", undefined, 3072);
      expect(result.model).toBe(PROVIDER_DEFAULT_MODEL.openai);
      expect(result.dimensions).toBe(3072);
    });
  });

  describe("when envModel is empty string", () => {
    test("treats it like undefined and returns provider default", () => {
      const result = resolveEmbeddingDefaults("transformersjs", "", undefined);
      expect(result.model).toBe("Xenova/all-MiniLM-L6-v2");
      expect(result.dimensions).toBe(384);
      expect(result.warning).toBeUndefined();
    });

    test("treats whitespace-only as empty", () => {
      const result = resolveEmbeddingDefaults("ollama", "   ", undefined);
      expect(result.model).toBe("nomic-embed-text");
      expect(result.warning).toBeUndefined();
    });
  });

  describe("openai provider — trusts user-supplied model", () => {
    test("passes through text-embedding-3-large", () => {
      const result = resolveEmbeddingDefaults("openai", "text-embedding-3-large", 3072);
      expect(result.model).toBe("text-embedding-3-large");
      expect(result.dimensions).toBe(3072);
      expect(result.warning).toBeUndefined();
    });

    test("passes through text-embedding-ada-002", () => {
      const result = resolveEmbeddingDefaults("openai", "text-embedding-ada-002", 1536);
      expect(result.model).toBe("text-embedding-ada-002");
      expect(result.warning).toBeUndefined();
    });

    test("trusts non-OpenAI-shaped names too — let the API surface its own error", () => {
      // We don't second-guess the user when they pick OpenAI explicitly.
      const result = resolveEmbeddingDefaults("openai", "Xenova/foo", 1536);
      expect(result.model).toBe("Xenova/foo");
      expect(result.warning).toBeUndefined();
    });
  });

  describe("transformersjs provider — substitutes when env model looks like OpenAI's", () => {
    test("passes through HuggingFace-style model", () => {
      const result = resolveEmbeddingDefaults("transformersjs", "Xenova/bge-base-en-v1.5", undefined);
      expect(result.model).toBe("Xenova/bge-base-en-v1.5");
      expect(result.warning).toBeUndefined();
    });

    test("passes through user-set HuggingFace model with custom dimensions", () => {
      const result = resolveEmbeddingDefaults(
        "transformersjs",
        "mixedbread-ai/mxbai-embed-large-v1",
        1024
      );
      expect(result.model).toBe("mixedbread-ai/mxbai-embed-large-v1");
      expect(result.dimensions).toBe(1024);
      expect(result.warning).toBeUndefined();
    });

    test("substitutes provider default when env model is text-embedding-3-small (the #581 bug)", () => {
      const result = resolveEmbeddingDefaults("transformersjs", "text-embedding-3-small", 1536);
      expect(result.model).toBe("Xenova/all-MiniLM-L6-v2");
      expect(result.dimensions).toBe(384);
      expect(result.warning).toBeDefined();
      expect(result.warning).toContain("text-embedding-3-small");
      expect(result.warning).toContain("transformersjs");
    });

    test("substitutes provider default for any text-embedding-* env model", () => {
      const result = resolveEmbeddingDefaults("transformersjs", "text-embedding-3-large", 3072);
      expect(result.model).toBe("Xenova/all-MiniLM-L6-v2");
      expect(result.dimensions).toBe(384);
      expect(result.warning).toBeDefined();
    });

    test("when substituting, ignores envDimensions in favour of provider default dimensions", () => {
      const result = resolveEmbeddingDefaults("transformersjs", "text-embedding-3-small", 1536);
      // The substituted model is Xenova/all-MiniLM-L6-v2 (384 dims), not the leaked 1536.
      expect(result.dimensions).toBe(384);
    });

    test("trusts non-slash names that are not OpenAI-prefixed (e.g. an Ollama-style name)", () => {
      // This case is rare but the helper errs on the side of trusting the user
      // unless the name looks unambiguously like another provider's model.
      const result = resolveEmbeddingDefaults("transformersjs", "nomic-embed-text", undefined);
      expect(result.model).toBe("nomic-embed-text");
      expect(result.warning).toBeUndefined();
    });
  });

  describe("ollama provider — substitutes when env model looks foreign", () => {
    test("passes through ollama-style slug", () => {
      const result = resolveEmbeddingDefaults("ollama", "mxbai-embed-large", 1024);
      expect(result.model).toBe("mxbai-embed-large");
      expect(result.dimensions).toBe(1024);
      expect(result.warning).toBeUndefined();
    });

    test("substitutes when env model is text-embedding-3-small", () => {
      const result = resolveEmbeddingDefaults("ollama", "text-embedding-3-small", 1536);
      expect(result.model).toBe("nomic-embed-text");
      expect(result.dimensions).toBe(768);
      expect(result.warning).toBeDefined();
      expect(result.warning).toContain("ollama");
    });

    test("substitutes when env model is a HuggingFace-style id", () => {
      const result = resolveEmbeddingDefaults("ollama", "Xenova/all-MiniLM-L6-v2", 384);
      expect(result.model).toBe("nomic-embed-text");
      expect(result.dimensions).toBe(768);
      expect(result.warning).toBeDefined();
    });
  });

  describe("warning content", () => {
    test("warning names the offending env model and the resolved provider", () => {
      const { warning } = resolveEmbeddingDefaults("transformersjs", "text-embedding-3-small", 1536);
      expect(warning).toContain("text-embedding-3-small");
      expect(warning).toContain("transformersjs");
      expect(warning).toContain("Xenova/all-MiniLM-L6-v2");
    });

    test("warning suggests the actionable fix", () => {
      const { warning } = resolveEmbeddingDefaults("ollama", "Xenova/foo", 384);
      expect(warning).toContain("EMBEDDING_MODEL");
      expect(warning).toContain(".env");
    });
  });

  describe("dimensions contract (Fix #1)", () => {
    test("returns helper-default dimensions for unknown-but-passthrough HF model — factory's per-model table overrides at runtime", () => {
      // Helper has no per-model table of its own; it returns the provider's
      // default (384). The factory's TRANSFORMERSJS_MODEL_DIMENSIONS for
      // Xenova/bge-base-en-v1.5 is 768 and overrides this at construction time.
      // This test pins the helper-side contract — see the JSDoc on
      // ResolvedEmbeddingDefaults.dimensions.
      const result = resolveEmbeddingDefaults("transformersjs", "Xenova/bge-base-en-v1.5", undefined);
      expect(result.dimensions).toBe(384);
    });
  });

  describe("non-OpenAI cloud-provider prefixes also trigger substitution", () => {
    test("voyage-* with transformersjs substitutes default", () => {
      const result = resolveEmbeddingDefaults("transformersjs", "voyage-large-2", undefined);
      expect(result.model).toBe("Xenova/all-MiniLM-L6-v2");
      expect(result.warning).toBeDefined();
    });

    test("cohere.embed-* with ollama substitutes default", () => {
      const result = resolveEmbeddingDefaults("ollama", "cohere.embed-english-v3.0", undefined);
      expect(result.model).toBe("nomic-embed-text");
      expect(result.warning).toBeDefined();
    });

    test("amazon.titan-embed-* with transformersjs substitutes default", () => {
      const result = resolveEmbeddingDefaults("transformersjs", "amazon.titan-embed-text-v1", undefined);
      expect(result.model).toBe("Xenova/all-MiniLM-L6-v2");
      expect(result.warning).toBeDefined();
    });

    test("voyage-* with openai trusts user (cross-provider — let the API surface its own error)", () => {
      const result = resolveEmbeddingDefaults("openai", "voyage-2", 1024);
      expect(result.model).toBe("voyage-2");
      expect(result.warning).toBeUndefined();
    });
  });

  describe("envModel trimming (Fix #3)", () => {
    test("trims leading/trailing whitespace from envModel before checks", () => {
      const result = resolveEmbeddingDefaults("transformersjs", "  Xenova/bge-base-en-v1.5  ", undefined);
      expect(result.model).toBe("Xenova/bge-base-en-v1.5");
      expect(result.warning).toBeUndefined();
    });

    test("trimmed envModel is reflected in the warning text", () => {
      const result = resolveEmbeddingDefaults("transformersjs", "  text-embedding-3-small  ", 1536);
      expect(result.warning).toContain("'text-embedding-3-small'");
      expect(result.warning).not.toContain("  ");
    });
  });

  describe("provider: undefined (unknown-provider fallback)", () => {
    test("returns OpenAI-shaped fallbacks when provider is undefined and no env values", () => {
      const result = resolveEmbeddingDefaults(undefined, undefined, undefined);
      expect(result.model).toBe("text-embedding-3-small");
      expect(result.dimensions).toBe(1536);
      expect(result.warning).toBeUndefined();
    });

    test("respects env values when provider is undefined", () => {
      const result = resolveEmbeddingDefaults(undefined, "some-custom-model", 512);
      expect(result.model).toBe("some-custom-model");
      expect(result.dimensions).toBe(512);
      expect(result.warning).toBeUndefined();
    });

    test("trims envModel even when provider is undefined", () => {
      const result = resolveEmbeddingDefaults(undefined, "  some-model  ", undefined);
      expect(result.model).toBe("some-model");
    });
  });
});
