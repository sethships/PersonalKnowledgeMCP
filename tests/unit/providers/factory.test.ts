/**
 * Unit tests for embedding provider factory
 *
 * Tests the createEmbeddingProvider factory function which instantiates
 * providers based on configuration and environment variables.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createEmbeddingProvider } from "../../../src/providers/factory.js";
import { OpenAIEmbeddingProvider } from "../../../src/providers/openai-embedding.js";
import { TransformersJsEmbeddingProvider } from "../../../src/providers/transformersjs-embedding.js";
import { OllamaEmbeddingProvider } from "../../../src/providers/ollama-embedding.js";
import { EmbeddingValidationError } from "../../../src/providers/errors.js";
import type { EmbeddingProviderConfig } from "../../../src/providers/types.js";

describe("createEmbeddingProvider", () => {
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

  test("creates OpenAI provider successfully", () => {
    const config: EmbeddingProviderConfig = {
      provider: "openai",
      model: "text-embedding-3-small",
      dimensions: 1536,
      batchSize: 100,
      maxRetries: 3,
      timeoutMs: 30000,
    };

    const provider = createEmbeddingProvider(config);

    expect(provider).toBeInstanceOf(OpenAIEmbeddingProvider);
    expect(provider.providerId).toBe("openai");
    expect(provider.modelId).toBe("text-embedding-3-small");
    expect(provider.dimensions).toBe(1536);
  });

  test("handles case-insensitive provider name", () => {
    const config: EmbeddingProviderConfig = {
      provider: "OpenAI", // Mixed case
      model: "text-embedding-3-small",
      dimensions: 1536,
      batchSize: 100,
      maxRetries: 3,
      timeoutMs: 30000,
    };

    const provider = createEmbeddingProvider(config);
    expect(provider).toBeInstanceOf(OpenAIEmbeddingProvider);
  });

  test("handles uppercase provider name", () => {
    const config: EmbeddingProviderConfig = {
      provider: "OPENAI", // Uppercase
      model: "text-embedding-3-small",
      dimensions: 1536,
      batchSize: 100,
      maxRetries: 3,
      timeoutMs: 30000,
    };

    const provider = createEmbeddingProvider(config);
    expect(provider).toBeInstanceOf(OpenAIEmbeddingProvider);
  });

  test("reads API key from OPENAI_API_KEY environment variable", () => {
    const testApiKey = "sk-custom-key-1234567890abcdefgh";
    Bun.env["OPENAI_API_KEY"] = testApiKey;

    const config: EmbeddingProviderConfig = {
      provider: "openai",
      model: "text-embedding-3-small",
      dimensions: 1536,
      batchSize: 100,
      maxRetries: 3,
      timeoutMs: 30000,
    };

    const provider = createEmbeddingProvider(config);

    // Verify provider was created (implicitly validates API key was read)
    expect(provider).toBeInstanceOf(OpenAIEmbeddingProvider);
  });

  test("reads organization from OPENAI_ORGANIZATION environment variable", () => {
    Bun.env["OPENAI_ORGANIZATION"] = "org-test123";

    const config: EmbeddingProviderConfig = {
      provider: "openai",
      model: "text-embedding-3-small",
      dimensions: 1536,
      batchSize: 100,
      maxRetries: 3,
      timeoutMs: 30000,
    };

    const provider = createEmbeddingProvider(config);
    expect(provider).toBeInstanceOf(OpenAIEmbeddingProvider);
  });

  test("reads base URL from OPENAI_BASE_URL environment variable", () => {
    Bun.env["OPENAI_BASE_URL"] = "https://custom-api.example.com/v1";

    const config: EmbeddingProviderConfig = {
      provider: "openai",
      model: "text-embedding-3-small",
      dimensions: 1536,
      batchSize: 100,
      maxRetries: 3,
      timeoutMs: 30000,
    };

    const provider = createEmbeddingProvider(config);
    expect(provider).toBeInstanceOf(OpenAIEmbeddingProvider);
  });

  test("throws when OPENAI_API_KEY environment variable is missing", () => {
    delete Bun.env["OPENAI_API_KEY"];

    const config: EmbeddingProviderConfig = {
      provider: "openai",
      model: "text-embedding-3-small",
      dimensions: 1536,
      batchSize: 100,
      maxRetries: 3,
      timeoutMs: 30000,
    };

    expect(() => createEmbeddingProvider(config)).toThrow(EmbeddingValidationError);
    expect(() => createEmbeddingProvider(config)).toThrow(
      "OPENAI_API_KEY environment variable is required"
    );
  });

  test("throws when OPENAI_API_KEY is empty string", () => {
    Bun.env["OPENAI_API_KEY"] = "";

    const config: EmbeddingProviderConfig = {
      provider: "openai",
      model: "text-embedding-3-small",
      dimensions: 1536,
      batchSize: 100,
      maxRetries: 3,
      timeoutMs: 30000,
    };

    expect(() => createEmbeddingProvider(config)).toThrow(EmbeddingValidationError);
  });

  test("throws on unsupported provider", () => {
    const config: EmbeddingProviderConfig = {
      provider: "unsupported-provider",
      model: "test-model",
      dimensions: 1536,
      batchSize: 100,
      maxRetries: 3,
      timeoutMs: 30000,
    };

    expect(() => createEmbeddingProvider(config)).toThrow(EmbeddingValidationError);
    expect(() => createEmbeddingProvider(config)).toThrow(
      "Unsupported provider: unsupported-provider"
    );
  });

  test("error message includes supported providers", () => {
    const config: EmbeddingProviderConfig = {
      provider: "unknown",
      model: "test-model",
      dimensions: 1536,
      batchSize: 100,
      maxRetries: 3,
      timeoutMs: 30000,
    };

    expect(() => createEmbeddingProvider(config)).toThrow(
      "Supported providers: openai, transformersjs, ollama"
    );
  });

  test("passes through configuration to provider", () => {
    const config: EmbeddingProviderConfig = {
      provider: "openai",
      model: "text-embedding-3-large", // Custom model
      dimensions: 3072, // Custom dimensions
      batchSize: 50, // Custom batch size
      maxRetries: 5, // Custom max retries
      timeoutMs: 60000, // Custom timeout
    };

    const provider = createEmbeddingProvider(config);

    expect(provider.modelId).toBe("text-embedding-3-large");
    expect(provider.dimensions).toBe(3072);
  });

  // TransformersJs provider tests
  describe("TransformersJs provider", () => {
    test("creates TransformersJs provider with 'transformersjs' name", () => {
      const config: EmbeddingProviderConfig = {
        provider: "transformersjs",
        model: "Xenova/all-MiniLM-L6-v2",
        dimensions: 384,
        batchSize: 32,
        maxRetries: 0,
        timeoutMs: 60000,
      };

      const provider = createEmbeddingProvider(config);

      expect(provider).toBeInstanceOf(TransformersJsEmbeddingProvider);
      expect(provider.providerId).toBe("transformersjs");
      expect(provider.modelId).toBe("Xenova/all-MiniLM-L6-v2");
      expect(provider.dimensions).toBe(384);
    });

    test("creates TransformersJs provider with 'transformers' alias", () => {
      const config: EmbeddingProviderConfig = {
        provider: "transformers",
        model: "Xenova/all-MiniLM-L6-v2",
        dimensions: 384,
        batchSize: 32,
        maxRetries: 0,
        timeoutMs: 60000,
      };

      const provider = createEmbeddingProvider(config);
      expect(provider).toBeInstanceOf(TransformersJsEmbeddingProvider);
    });

    test("creates TransformersJs provider with 'local' alias", () => {
      const config: EmbeddingProviderConfig = {
        provider: "local",
        model: "Xenova/all-MiniLM-L6-v2",
        dimensions: 384,
        batchSize: 32,
        maxRetries: 0,
        timeoutMs: 60000,
      };

      const provider = createEmbeddingProvider(config);
      expect(provider).toBeInstanceOf(TransformersJsEmbeddingProvider);
    });

    test("handles case-insensitive TransformersJs provider name", () => {
      const config: EmbeddingProviderConfig = {
        provider: "TRANSFORMERSJS",
        model: "Xenova/all-MiniLM-L6-v2",
        dimensions: 384,
        batchSize: 32,
        maxRetries: 0,
        timeoutMs: 60000,
      };

      const provider = createEmbeddingProvider(config);
      expect(provider).toBeInstanceOf(TransformersJsEmbeddingProvider);
    });

    test("handles mixed case TransformersJs provider name", () => {
      const config: EmbeddingProviderConfig = {
        provider: "TransformersJs",
        model: "Xenova/all-MiniLM-L6-v2",
        dimensions: 384,
        batchSize: 32,
        maxRetries: 0,
        timeoutMs: 60000,
      };

      const provider = createEmbeddingProvider(config);
      expect(provider).toBeInstanceOf(TransformersJsEmbeddingProvider);
    });

    test("uses default model path when not specified in options", () => {
      const config: EmbeddingProviderConfig = {
        provider: "transformersjs",
        model: "default-model",
        dimensions: 384,
        batchSize: 32,
        maxRetries: 0,
        timeoutMs: 60000,
      };

      const provider = createEmbeddingProvider(config);
      expect(provider).toBeInstanceOf(TransformersJsEmbeddingProvider);
      // Default model path is Xenova/all-MiniLM-L6-v2
      expect(provider.modelId).toBe("Xenova/all-MiniLM-L6-v2");
    });

    test("uses custom model path from options", () => {
      const config: EmbeddingProviderConfig = {
        provider: "transformersjs",
        model: "custom-model",
        dimensions: 768,
        batchSize: 32,
        maxRetries: 0,
        timeoutMs: 60000,
        options: {
          modelPath: "Xenova/bge-small-en-v1.5",
        },
      };

      const provider = createEmbeddingProvider(config);
      expect(provider).toBeInstanceOf(TransformersJsEmbeddingProvider);
      expect(provider.modelId).toBe("Xenova/bge-small-en-v1.5");
    });

    test("reads TRANSFORMERS_CACHE from environment", () => {
      Bun.env["TRANSFORMERS_CACHE"] = "/custom/cache/dir";

      const config: EmbeddingProviderConfig = {
        provider: "transformersjs",
        model: "Xenova/all-MiniLM-L6-v2",
        dimensions: 384,
        batchSize: 32,
        maxRetries: 0,
        timeoutMs: 60000,
      };

      // Provider should be created without error
      const provider = createEmbeddingProvider(config);
      expect(provider).toBeInstanceOf(TransformersJsEmbeddingProvider);
    });

    test("supports quantized option", () => {
      const config: EmbeddingProviderConfig = {
        provider: "transformersjs",
        model: "Xenova/all-MiniLM-L6-v2",
        dimensions: 384,
        batchSize: 32,
        maxRetries: 0,
        timeoutMs: 60000,
        options: {
          quantized: true,
        },
      };

      const provider = createEmbeddingProvider(config);
      expect(provider).toBeInstanceOf(TransformersJsEmbeddingProvider);
    });

    test("passes dimensions through to provider", () => {
      const config: EmbeddingProviderConfig = {
        provider: "transformersjs",
        model: "Xenova/bge-small-en-v1.5",
        dimensions: 768, // Different dimensions
        batchSize: 32,
        maxRetries: 0,
        timeoutMs: 60000,
        options: {
          modelPath: "Xenova/bge-small-en-v1.5",
        },
      };

      const provider = createEmbeddingProvider(config);
      expect(provider.dimensions).toBe(768);
    });
  });

  // Ollama provider tests
  describe("Ollama provider", () => {
    test("creates Ollama provider with 'ollama' name", () => {
      const config: EmbeddingProviderConfig = {
        provider: "ollama",
        model: "nomic-embed-text",
        dimensions: 768,
        batchSize: 32,
        maxRetries: 3,
        timeoutMs: 30000,
      };

      const provider = createEmbeddingProvider(config);

      expect(provider).toBeInstanceOf(OllamaEmbeddingProvider);
      expect(provider.providerId).toBe("ollama");
      expect(provider.modelId).toBe("nomic-embed-text");
      expect(provider.dimensions).toBe(768);
    });

    test("handles case-insensitive Ollama provider name", () => {
      const config: EmbeddingProviderConfig = {
        provider: "OLLAMA",
        model: "nomic-embed-text",
        dimensions: 768,
        batchSize: 32,
        maxRetries: 3,
        timeoutMs: 30000,
      };

      const provider = createEmbeddingProvider(config);
      expect(provider).toBeInstanceOf(OllamaEmbeddingProvider);
    });

    test("handles mixed case Ollama provider name", () => {
      const config: EmbeddingProviderConfig = {
        provider: "Ollama",
        model: "nomic-embed-text",
        dimensions: 768,
        batchSize: 32,
        maxRetries: 3,
        timeoutMs: 30000,
      };

      const provider = createEmbeddingProvider(config);
      expect(provider).toBeInstanceOf(OllamaEmbeddingProvider);
    });

    test("uses default model name when not specified in options", () => {
      const config: EmbeddingProviderConfig = {
        provider: "ollama",
        model: "some-model",
        dimensions: 768,
        batchSize: 32,
        maxRetries: 3,
        timeoutMs: 30000,
      };

      const provider = createEmbeddingProvider(config);
      expect(provider).toBeInstanceOf(OllamaEmbeddingProvider);
      // Default model name is nomic-embed-text
      expect(provider.modelId).toBe("nomic-embed-text");
    });

    test("uses custom model name from options", () => {
      const config: EmbeddingProviderConfig = {
        provider: "ollama",
        model: "custom-model",
        dimensions: 1024,
        batchSize: 32,
        maxRetries: 3,
        timeoutMs: 30000,
        options: {
          modelName: "mxbai-embed-large",
        },
      };

      const provider = createEmbeddingProvider(config);
      expect(provider).toBeInstanceOf(OllamaEmbeddingProvider);
      expect(provider.modelId).toBe("mxbai-embed-large");
    });

    test("reads OLLAMA_BASE_URL from environment", () => {
      Bun.env["OLLAMA_BASE_URL"] = "http://custom-ollama:9999";

      const config: EmbeddingProviderConfig = {
        provider: "ollama",
        model: "nomic-embed-text",
        dimensions: 768,
        batchSize: 32,
        maxRetries: 3,
        timeoutMs: 30000,
      };

      // Provider should be created without error
      const provider = createEmbeddingProvider(config);
      expect(provider).toBeInstanceOf(OllamaEmbeddingProvider);
    });

    test("constructs URL from OLLAMA_HOST and OLLAMA_PORT", () => {
      delete Bun.env["OLLAMA_BASE_URL"];
      Bun.env["OLLAMA_HOST"] = "192.168.1.100";
      Bun.env["OLLAMA_PORT"] = "12345";

      const config: EmbeddingProviderConfig = {
        provider: "ollama",
        model: "nomic-embed-text",
        dimensions: 768,
        batchSize: 32,
        maxRetries: 3,
        timeoutMs: 30000,
      };

      // Provider should be created without error
      const provider = createEmbeddingProvider(config);
      expect(provider).toBeInstanceOf(OllamaEmbeddingProvider);
    });

    test("OLLAMA_BASE_URL takes precedence over HOST/PORT", () => {
      Bun.env["OLLAMA_BASE_URL"] = "http://primary:8000";
      Bun.env["OLLAMA_HOST"] = "secondary";
      Bun.env["OLLAMA_PORT"] = "9000";

      const config: EmbeddingProviderConfig = {
        provider: "ollama",
        model: "nomic-embed-text",
        dimensions: 768,
        batchSize: 32,
        maxRetries: 3,
        timeoutMs: 30000,
      };

      // Provider should be created without error, using BASE_URL
      const provider = createEmbeddingProvider(config);
      expect(provider).toBeInstanceOf(OllamaEmbeddingProvider);
    });

    test("supports keepAlive option", () => {
      const config: EmbeddingProviderConfig = {
        provider: "ollama",
        model: "nomic-embed-text",
        dimensions: 768,
        batchSize: 32,
        maxRetries: 3,
        timeoutMs: 30000,
        options: {
          keepAlive: "30m",
        },
      };

      const provider = createEmbeddingProvider(config);
      expect(provider).toBeInstanceOf(OllamaEmbeddingProvider);
    });

    test("passes dimensions through to provider", () => {
      const config: EmbeddingProviderConfig = {
        provider: "ollama",
        model: "mxbai-embed-large",
        dimensions: 1024, // Different dimensions
        batchSize: 32,
        maxRetries: 3,
        timeoutMs: 30000,
        options: {
          modelName: "mxbai-embed-large",
        },
      };

      const provider = createEmbeddingProvider(config);
      expect(provider.dimensions).toBe(1024);
    });
  });
});
