/**
 * Unit tests for EmbeddingProviderFactory class
 *
 * Tests the class-based factory pattern for embedding provider creation,
 * including provider discovery, default selection, and availability checking.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  EmbeddingProviderFactory,
  embeddingProviderFactory,
} from "../../../src/providers/EmbeddingProviderFactory.js";
import { OpenAIEmbeddingProvider } from "../../../src/providers/openai-embedding.js";
import { TransformersJsEmbeddingProvider } from "../../../src/providers/transformersjs-embedding.js";
import { OllamaEmbeddingProvider } from "../../../src/providers/ollama-embedding.js";
import { EmbeddingValidationError } from "../../../src/providers/errors.js";
import type { EmbeddingProviderConfig } from "../../../src/providers/types.js";

describe("EmbeddingProviderFactory", () => {
  // Store original environment
  const originalEnv = { ...Bun.env };

  beforeEach(() => {
    // Set up test environment
    Bun.env["OPENAI_API_KEY"] = "sk-test1234567890abcdefghijklmnop";
  });

  afterEach(() => {
    // Restore original environment
    Object.keys(Bun.env).forEach((key) => {
      delete Bun.env[key];
    });
    Object.assign(Bun.env, originalEnv);
  });

  describe("constructor", () => {
    test("creates factory instance", () => {
      const factory = new EmbeddingProviderFactory();
      expect(factory).toBeDefined();
    });

    test("singleton instance is exported", () => {
      expect(embeddingProviderFactory).toBeInstanceOf(EmbeddingProviderFactory);
    });
  });

  describe("createProvider", () => {
    test("creates OpenAI provider", () => {
      const factory = new EmbeddingProviderFactory();
      const config: EmbeddingProviderConfig = {
        provider: "openai",
        model: "text-embedding-3-small",
        dimensions: 1536,
        batchSize: 100,
        maxRetries: 3,
        timeoutMs: 30000,
      };

      const provider = factory.createProvider(config);

      expect(provider).toBeInstanceOf(OpenAIEmbeddingProvider);
      expect(provider.providerId).toBe("openai");
    });

    test("creates TransformersJs provider", () => {
      const factory = new EmbeddingProviderFactory();
      const config: EmbeddingProviderConfig = {
        provider: "transformersjs",
        model: "Xenova/all-MiniLM-L6-v2",
        dimensions: 384,
        batchSize: 32,
        maxRetries: 0,
        timeoutMs: 60000,
      };

      const provider = factory.createProvider(config);

      expect(provider).toBeInstanceOf(TransformersJsEmbeddingProvider);
      expect(provider.providerId).toBe("transformersjs");
    });

    test("creates TransformersJs provider with 'local' alias", () => {
      const factory = new EmbeddingProviderFactory();
      const config: EmbeddingProviderConfig = {
        provider: "local",
        model: "Xenova/all-MiniLM-L6-v2",
        dimensions: 384,
        batchSize: 32,
        maxRetries: 0,
        timeoutMs: 60000,
      };

      const provider = factory.createProvider(config);

      expect(provider).toBeInstanceOf(TransformersJsEmbeddingProvider);
    });

    test("creates Ollama provider", () => {
      const factory = new EmbeddingProviderFactory();
      const config: EmbeddingProviderConfig = {
        provider: "ollama",
        model: "nomic-embed-text",
        dimensions: 768,
        batchSize: 32,
        maxRetries: 3,
        timeoutMs: 30000,
      };

      const provider = factory.createProvider(config);

      expect(provider).toBeInstanceOf(OllamaEmbeddingProvider);
      expect(provider.providerId).toBe("ollama");
    });

    test("handles case-insensitive provider names", () => {
      const factory = new EmbeddingProviderFactory();
      const config: EmbeddingProviderConfig = {
        provider: "OPENAI",
        model: "text-embedding-3-small",
        dimensions: 1536,
        batchSize: 100,
        maxRetries: 3,
        timeoutMs: 30000,
      };

      const provider = factory.createProvider(config);
      expect(provider).toBeInstanceOf(OpenAIEmbeddingProvider);
    });

    test("throws on unsupported provider", () => {
      const factory = new EmbeddingProviderFactory();
      const config: EmbeddingProviderConfig = {
        provider: "unsupported",
        model: "test-model",
        dimensions: 1536,
        batchSize: 100,
        maxRetries: 3,
        timeoutMs: 30000,
      };

      expect(() => factory.createProvider(config)).toThrow(EmbeddingValidationError);
      expect(() => factory.createProvider(config)).toThrow("Unsupported provider: unsupported");
    });

    test("error message lists all supported providers", () => {
      const factory = new EmbeddingProviderFactory();
      const config: EmbeddingProviderConfig = {
        provider: "unknown",
        model: "test-model",
        dimensions: 1536,
        batchSize: 100,
        maxRetries: 3,
        timeoutMs: 30000,
      };

      expect(() => factory.createProvider(config)).toThrow("openai, transformersjs, ollama");
    });
  });

  describe("listAvailableProviders", () => {
    test("returns all providers", () => {
      const factory = new EmbeddingProviderFactory();
      const providers = factory.listAvailableProviders();

      expect(providers).toBeArray();
      expect(providers.length).toBe(3);
    });

    test("returns provider info with correct structure", () => {
      const factory = new EmbeddingProviderFactory();
      const providers = factory.listAvailableProviders();

      for (const provider of providers) {
        expect(provider.id).toBeDefined();
        expect(provider.name).toBeDefined();
        expect(provider.description).toBeDefined();
        expect(typeof provider.requiresNetwork).toBe("boolean");
        expect(typeof provider.supportsGPU).toBe("boolean");
        expect(provider.aliases).toBeArray();
        expect(provider.requiredEnvVars).toBeArray();
        expect(provider.optionalEnvVars).toBeArray();
      }
    });

    test("includes OpenAI provider info", () => {
      const factory = new EmbeddingProviderFactory();
      const providers = factory.listAvailableProviders();
      const openai = providers.find((p) => p.id === "openai");

      expect(openai).toBeDefined();
      expect(openai?.name).toBe("OpenAI");
      expect(openai?.requiresNetwork).toBe(true);
      expect(openai?.supportsGPU).toBe(false);
      expect(openai?.requiredEnvVars).toContain("OPENAI_API_KEY");
    });

    test("includes TransformersJs provider info", () => {
      const factory = new EmbeddingProviderFactory();
      const providers = factory.listAvailableProviders();
      const transformersjs = providers.find((p) => p.id === "transformersjs");

      expect(transformersjs).toBeDefined();
      expect(transformersjs?.name).toBe("Transformers.js");
      expect(transformersjs?.requiresNetwork).toBe(false);
      expect(transformersjs?.supportsGPU).toBe(false);
      expect(transformersjs?.aliases).toContain("local");
      expect(transformersjs?.aliases).toContain("transformers");
    });

    test("includes Ollama provider info", () => {
      const factory = new EmbeddingProviderFactory();
      const providers = factory.listAvailableProviders();
      const ollama = providers.find((p) => p.id === "ollama");

      expect(ollama).toBeDefined();
      expect(ollama?.name).toBe("Ollama");
      expect(ollama?.requiresNetwork).toBe(false);
      expect(ollama?.supportsGPU).toBe(true);
      expect(ollama?.optionalEnvVars).toContain("OLLAMA_BASE_URL");
    });
  });

  describe("getDefaultProvider", () => {
    test("returns 'openai' when OPENAI_API_KEY is set", () => {
      Bun.env["OPENAI_API_KEY"] = "sk-test-key";

      const factory = new EmbeddingProviderFactory();
      const defaultProvider = factory.getDefaultProvider();

      expect(defaultProvider).toBe("openai");
    });

    test("returns 'transformersjs' when OPENAI_API_KEY is not set", () => {
      delete Bun.env["OPENAI_API_KEY"];

      const factory = new EmbeddingProviderFactory();
      const defaultProvider = factory.getDefaultProvider();

      expect(defaultProvider).toBe("transformersjs");
    });

    test("returns 'transformersjs' when OPENAI_API_KEY is empty string", () => {
      Bun.env["OPENAI_API_KEY"] = "";

      const factory = new EmbeddingProviderFactory();
      const defaultProvider = factory.getDefaultProvider();

      expect(defaultProvider).toBe("transformersjs");
    });
  });

  describe("isProviderAvailable", () => {
    test("returns true for 'openai' when API key is set", () => {
      Bun.env["OPENAI_API_KEY"] = "sk-test-key";

      const factory = new EmbeddingProviderFactory();
      const available = factory.isProviderAvailable("openai");

      expect(available).toBe(true);
    });

    test("returns false for 'openai' when API key is not set", () => {
      delete Bun.env["OPENAI_API_KEY"];

      const factory = new EmbeddingProviderFactory();
      const available = factory.isProviderAvailable("openai");

      expect(available).toBe(false);
    });

    test("returns true for 'transformersjs' always", () => {
      const factory = new EmbeddingProviderFactory();
      const available = factory.isProviderAvailable("transformersjs");

      expect(available).toBe(true);
    });

    test("returns true for 'local' alias", () => {
      const factory = new EmbeddingProviderFactory();
      const available = factory.isProviderAvailable("local");

      expect(available).toBe(true);
    });

    test("returns true for 'ollama' always", () => {
      const factory = new EmbeddingProviderFactory();
      const available = factory.isProviderAvailable("ollama");

      expect(available).toBe(true);
    });

    test("returns false for unknown provider", () => {
      const factory = new EmbeddingProviderFactory();
      const available = factory.isProviderAvailable("unknown");

      expect(available).toBe(false);
    });

    test("handles case-insensitive provider names", () => {
      Bun.env["OPENAI_API_KEY"] = "sk-test-key";

      const factory = new EmbeddingProviderFactory();

      expect(factory.isProviderAvailable("OPENAI")).toBe(true);
      expect(factory.isProviderAvailable("OpenAI")).toBe(true);
      expect(factory.isProviderAvailable("TRANSFORMERSJS")).toBe(true);
      expect(factory.isProviderAvailable("OLLAMA")).toBe(true);
    });
  });

  describe("environment variable handling", () => {
    test("reads OLLAMA_BASE_URL for Ollama provider", () => {
      Bun.env["OLLAMA_BASE_URL"] = "http://custom:9999";

      const factory = new EmbeddingProviderFactory();
      const config: EmbeddingProviderConfig = {
        provider: "ollama",
        model: "nomic-embed-text",
        dimensions: 768,
        batchSize: 32,
        maxRetries: 3,
        timeoutMs: 30000,
      };

      // Should create provider without error
      const provider = factory.createProvider(config);
      expect(provider).toBeInstanceOf(OllamaEmbeddingProvider);
    });

    test("constructs Ollama URL from HOST and PORT", () => {
      delete Bun.env["OLLAMA_BASE_URL"];
      Bun.env["OLLAMA_HOST"] = "myhost";
      Bun.env["OLLAMA_PORT"] = "12345";

      const factory = new EmbeddingProviderFactory();
      const config: EmbeddingProviderConfig = {
        provider: "ollama",
        model: "nomic-embed-text",
        dimensions: 768,
        batchSize: 32,
        maxRetries: 3,
        timeoutMs: 30000,
      };

      // Should create provider without error
      const provider = factory.createProvider(config);
      expect(provider).toBeInstanceOf(OllamaEmbeddingProvider);
    });

    test("reads TRANSFORMERS_CACHE for TransformersJs provider", () => {
      Bun.env["TRANSFORMERS_CACHE"] = "/custom/cache";

      const factory = new EmbeddingProviderFactory();
      const config: EmbeddingProviderConfig = {
        provider: "transformersjs",
        model: "Xenova/all-MiniLM-L6-v2",
        dimensions: 384,
        batchSize: 32,
        maxRetries: 0,
        timeoutMs: 60000,
      };

      // Should create provider without error
      const provider = factory.createProvider(config);
      expect(provider).toBeInstanceOf(TransformersJsEmbeddingProvider);
    });

    test("throws on non-numeric OLLAMA_PORT", () => {
      delete Bun.env["OLLAMA_BASE_URL"];
      Bun.env["OLLAMA_PORT"] = "not-a-number";

      const factory = new EmbeddingProviderFactory();
      const config: EmbeddingProviderConfig = {
        provider: "ollama",
        model: "nomic-embed-text",
        dimensions: 768,
        batchSize: 32,
        maxRetries: 3,
        timeoutMs: 30000,
      };

      expect(() => factory.createProvider(config)).toThrow(EmbeddingValidationError);
      expect(() => factory.createProvider(config)).toThrow("Must be a numeric port number");
    });

    test("throws on OLLAMA_HOST with URL special characters", () => {
      delete Bun.env["OLLAMA_BASE_URL"];
      Bun.env["OLLAMA_HOST"] = "evil.com/malicious#";
      Bun.env["OLLAMA_PORT"] = "11434";

      const factory = new EmbeddingProviderFactory();
      const config: EmbeddingProviderConfig = {
        provider: "ollama",
        model: "nomic-embed-text",
        dimensions: 768,
        batchSize: 32,
        maxRetries: 3,
        timeoutMs: 30000,
      };

      expect(() => factory.createProvider(config)).toThrow(EmbeddingValidationError);
      expect(() => factory.createProvider(config)).toThrow("Must be a valid hostname");
    });
  });
});
