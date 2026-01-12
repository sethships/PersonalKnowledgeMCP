/* eslint-disable @typescript-eslint/await-thenable, @typescript-eslint/no-base-to-string */
/**
 * Unit tests for OllamaEmbeddingProvider
 *
 * Tests all methods with mocked fetch for isolated testing including constructor validation,
 * embedding generation, error handling, and health checks.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import {
  OllamaEmbeddingProvider,
  type OllamaProviderConfig,
} from "../../../src/providers/ollama-embedding.js";
import {
  EmbeddingValidationError,
  EmbeddingNetworkError,
  EmbeddingError,
} from "../../../src/providers/errors.js";

// Test configuration
const DEFAULT_CONFIG: OllamaProviderConfig = {
  provider: "ollama",
  model: "nomic-embed-text",
  dimensions: 768,
  batchSize: 32,
  maxRetries: 2,
  timeoutMs: 30000,
  modelName: "nomic-embed-text",
  baseUrl: "http://localhost:11434",
  keepAlive: "5m",
};

// Sample embedding response
const MOCK_EMBEDDING = Array.from({ length: 768 }, (_, i) => Math.sin(i * 0.01));

// Mock fetch responses
const createMockResponse = (data: unknown, status = 200, statusText = "OK"): Response => {
  return new Response(JSON.stringify(data), {
    status,
    statusText,
    headers: { "Content-Type": "application/json" },
  });
};

// Helper to mock global.fetch with proper typing
type FetchImpl = (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;
const mockFetch = (impl: FetchImpl): void => {
  global.fetch = mock(impl) as unknown as typeof global.fetch;
};

describe("OllamaEmbeddingProvider", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("constructor", () => {
    test("creates provider with valid configuration", () => {
      const provider = new OllamaEmbeddingProvider(DEFAULT_CONFIG);

      expect(provider.providerId).toBe("ollama");
      expect(provider.modelId).toBe("nomic-embed-text");
      expect(provider.dimensions).toBe(768);
    });

    test("uses default baseUrl when not provided", () => {
      const config: OllamaProviderConfig = {
        ...DEFAULT_CONFIG,
        baseUrl: undefined,
      };

      // Provider should be created without error
      const provider = new OllamaEmbeddingProvider(config);
      expect(provider).toBeDefined();
    });

    test("uses default keepAlive when not provided", () => {
      const config: OllamaProviderConfig = {
        ...DEFAULT_CONFIG,
        keepAlive: undefined,
      };

      const provider = new OllamaEmbeddingProvider(config);
      expect(provider).toBeDefined();
    });

    test("throws on empty model name", () => {
      const config: OllamaProviderConfig = {
        ...DEFAULT_CONFIG,
        modelName: "",
      };

      expect(() => new OllamaEmbeddingProvider(config)).toThrow(EmbeddingValidationError);
      expect(() => new OllamaEmbeddingProvider(config)).toThrow("Model name is required");
    });

    test("throws on whitespace-only model name", () => {
      const config: OllamaProviderConfig = {
        ...DEFAULT_CONFIG,
        modelName: "   ",
      };

      expect(() => new OllamaEmbeddingProvider(config)).toThrow(EmbeddingValidationError);
    });

    test("throws on non-positive dimensions", () => {
      const config: OllamaProviderConfig = {
        ...DEFAULT_CONFIG,
        dimensions: 0,
      };

      expect(() => new OllamaEmbeddingProvider(config)).toThrow(EmbeddingValidationError);
      expect(() => new OllamaEmbeddingProvider(config)).toThrow("Dimensions must be positive");
    });

    test("throws on negative dimensions", () => {
      const config: OllamaProviderConfig = {
        ...DEFAULT_CONFIG,
        dimensions: -100,
      };

      expect(() => new OllamaEmbeddingProvider(config)).toThrow(EmbeddingValidationError);
    });

    test("throws on non-positive batch size", () => {
      const config: OllamaProviderConfig = {
        ...DEFAULT_CONFIG,
        batchSize: 0,
      };

      expect(() => new OllamaEmbeddingProvider(config)).toThrow(EmbeddingValidationError);
      expect(() => new OllamaEmbeddingProvider(config)).toThrow("Batch size must be positive");
    });

    test("throws on non-positive timeout", () => {
      const config: OllamaProviderConfig = {
        ...DEFAULT_CONFIG,
        timeoutMs: 0,
      };

      expect(() => new OllamaEmbeddingProvider(config)).toThrow(EmbeddingValidationError);
      expect(() => new OllamaEmbeddingProvider(config)).toThrow("Timeout must be positive");
    });

    test("throws on negative max retries", () => {
      const config: OllamaProviderConfig = {
        ...DEFAULT_CONFIG,
        maxRetries: -1,
      };

      expect(() => new OllamaEmbeddingProvider(config)).toThrow(EmbeddingValidationError);
      expect(() => new OllamaEmbeddingProvider(config)).toThrow("Max retries cannot be negative");
    });

    test("throws on invalid base URL format", () => {
      const config: OllamaProviderConfig = {
        ...DEFAULT_CONFIG,
        baseUrl: "not-a-valid-url",
      };

      expect(() => new OllamaEmbeddingProvider(config)).toThrow(EmbeddingValidationError);
      expect(() => new OllamaEmbeddingProvider(config)).toThrow("Invalid base URL");
    });

    test("throws on non-http/https URL scheme", () => {
      const config: OllamaProviderConfig = {
        ...DEFAULT_CONFIG,
        baseUrl: "file:///etc/passwd",
      };

      expect(() => new OllamaEmbeddingProvider(config)).toThrow(EmbeddingValidationError);
      expect(() => new OllamaEmbeddingProvider(config)).toThrow("Only http and https are allowed");
    });

    test("throws on javascript URL scheme", () => {
      const config: OllamaProviderConfig = {
        ...DEFAULT_CONFIG,
        baseUrl: "javascript:alert(1)",
      };

      expect(() => new OllamaEmbeddingProvider(config)).toThrow(EmbeddingValidationError);
    });

    test("accepts https URL scheme", () => {
      const config: OllamaProviderConfig = {
        ...DEFAULT_CONFIG,
        baseUrl: "https://ollama.example.com:443",
      };

      const provider = new OllamaEmbeddingProvider(config);
      expect(provider).toBeDefined();
    });

    test("accepts valid custom base URL", () => {
      const config: OllamaProviderConfig = {
        ...DEFAULT_CONFIG,
        baseUrl: "http://192.168.1.100:12345",
      };

      const provider = new OllamaEmbeddingProvider(config);
      expect(provider).toBeDefined();
    });
  });

  describe("generateEmbedding", () => {
    test("generates embedding for single text", async () => {
      mockFetch(() => Promise.resolve(createMockResponse({ embedding: MOCK_EMBEDDING })));

      const provider = new OllamaEmbeddingProvider(DEFAULT_CONFIG);
      const embedding = await provider.generateEmbedding("Hello world");

      expect(embedding).toBeArray();
      expect(embedding.length).toBe(768);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test("sends correct request body", async () => {
      let capturedBody: unknown;
      mockFetch((_url, init) => {
        capturedBody = JSON.parse(init?.body as string);
        return Promise.resolve(createMockResponse({ embedding: MOCK_EMBEDDING }));
      });

      const provider = new OllamaEmbeddingProvider(DEFAULT_CONFIG);
      await provider.generateEmbedding("Test text");

      expect(capturedBody).toEqual({
        model: "nomic-embed-text",
        prompt: "Test text",
        keep_alive: "5m",
      });
    });

    test("throws on empty text", async () => {
      const provider = new OllamaEmbeddingProvider(DEFAULT_CONFIG);

      await expect(provider.generateEmbedding("")).rejects.toThrow(EmbeddingValidationError);
    });

    test("throws on whitespace-only text", async () => {
      const provider = new OllamaEmbeddingProvider(DEFAULT_CONFIG);

      await expect(provider.generateEmbedding("   ")).rejects.toThrow(EmbeddingValidationError);
    });
  });

  describe("generateEmbeddings", () => {
    test("generates embeddings for multiple texts", async () => {
      mockFetch(() => Promise.resolve(createMockResponse({ embedding: MOCK_EMBEDDING })));

      const provider = new OllamaEmbeddingProvider(DEFAULT_CONFIG);
      const texts = ["Hello", "World", "Test"];
      const embeddings = await provider.generateEmbeddings(texts);

      expect(embeddings).toBeArray();
      expect(embeddings.length).toBe(3);
      expect(embeddings[0]?.length).toBe(768);
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    test("preserves order of embeddings", async () => {
      let callCount = 0;
      mockFetch(() => {
        callCount++;
        // Return different embeddings for each call
        const embedding = Array.from({ length: 768 }, () => callCount);
        return Promise.resolve(createMockResponse({ embedding }));
      });

      const provider = new OllamaEmbeddingProvider(DEFAULT_CONFIG);
      const embeddings = await provider.generateEmbeddings(["A", "B", "C"]);

      // First embedding should have all 1s, second all 2s, etc.
      expect(embeddings[0]?.[0]).toBe(1);
      expect(embeddings[1]?.[0]).toBe(2);
      expect(embeddings[2]?.[0]).toBe(3);
    });

    test("throws on empty array", async () => {
      const provider = new OllamaEmbeddingProvider(DEFAULT_CONFIG);

      await expect(provider.generateEmbeddings([])).rejects.toThrow(EmbeddingValidationError);
      await expect(provider.generateEmbeddings([])).rejects.toThrow("Input array cannot be empty");
    });

    test("throws on array with empty string", async () => {
      const provider = new OllamaEmbeddingProvider(DEFAULT_CONFIG);

      await expect(provider.generateEmbeddings(["valid", ""])).rejects.toThrow(
        EmbeddingValidationError
      );
    });

    test("throws on non-string input", async () => {
      const provider = new OllamaEmbeddingProvider(DEFAULT_CONFIG);

      await expect(
        provider.generateEmbeddings(["valid", 123 as unknown as string])
      ).rejects.toThrow(EmbeddingValidationError);
    });
  });

  describe("error handling", () => {
    test("throws EmbeddingError on API error", async () => {
      mockFetch(() =>
        Promise.resolve(createMockResponse({ error: "Model not found" }, 404, "Not Found"))
      );

      const config: OllamaProviderConfig = {
        ...DEFAULT_CONFIG,
        maxRetries: 0, // Disable retries for faster test
      };
      const provider = new OllamaEmbeddingProvider(config);

      await expect(provider.generateEmbedding("test")).rejects.toThrow(EmbeddingError);
    });

    test("throws EmbeddingNetworkError on connection refused", async () => {
      mockFetch(() => Promise.reject(new Error("fetch failed: connection refused")));

      const config: OllamaProviderConfig = {
        ...DEFAULT_CONFIG,
        maxRetries: 0,
      };
      const provider = new OllamaEmbeddingProvider(config);

      await expect(provider.generateEmbedding("test")).rejects.toThrow(EmbeddingNetworkError);
    });

    test("throws EmbeddingNetworkError on ECONNREFUSED", async () => {
      mockFetch(() => Promise.reject(new Error("ECONNREFUSED: Connection refused")));

      const config: OllamaProviderConfig = {
        ...DEFAULT_CONFIG,
        maxRetries: 0,
      };
      const provider = new OllamaEmbeddingProvider(config);

      await expect(provider.generateEmbedding("test")).rejects.toThrow(EmbeddingNetworkError);
    });

    test("handles invalid response format", async () => {
      mockFetch(() => Promise.resolve(createMockResponse({ wrongField: "value" })));

      const config: OllamaProviderConfig = {
        ...DEFAULT_CONFIG,
        maxRetries: 0,
      };
      const provider = new OllamaEmbeddingProvider(config);

      await expect(provider.generateEmbedding("test")).rejects.toThrow("missing embedding array");
    });

    test("retries on server error", async () => {
      let attempts = 0;
      mockFetch(() => {
        attempts++;
        if (attempts < 3) {
          return Promise.resolve(createMockResponse({ error: "Server busy" }, 500, "Server Error"));
        }
        return Promise.resolve(createMockResponse({ embedding: MOCK_EMBEDDING }));
      });

      const provider = new OllamaEmbeddingProvider(DEFAULT_CONFIG);
      const embedding = await provider.generateEmbedding("test");

      expect(embedding).toBeArray();
      expect(attempts).toBe(3);
    });

    test("does not retry on client error (4xx)", async () => {
      let attempts = 0;
      mockFetch(() => {
        attempts++;
        return Promise.resolve(createMockResponse({ error: "Bad request" }, 400, "Bad Request"));
      });

      const config: OllamaProviderConfig = {
        ...DEFAULT_CONFIG,
        maxRetries: 3,
      };
      const provider = new OllamaEmbeddingProvider(config);

      await expect(provider.generateEmbedding("test")).rejects.toThrow(EmbeddingError);
      expect(attempts).toBe(1); // No retries
    });
  });

  describe("healthCheck", () => {
    test("returns true when model is available", async () => {
      mockFetch(() =>
        Promise.resolve(
          createMockResponse({
            models: [
              { name: "nomic-embed-text:latest", model: "nomic-embed-text" },
              { name: "llama2:latest", model: "llama2" },
            ],
          })
        )
      );

      const provider = new OllamaEmbeddingProvider(DEFAULT_CONFIG);
      const healthy = await provider.healthCheck();

      expect(healthy).toBe(true);
    });

    test("returns true when model matches without tag", async () => {
      mockFetch(() =>
        Promise.resolve(
          createMockResponse({
            models: [{ name: "nomic-embed-text", model: "nomic-embed-text" }],
          })
        )
      );

      const provider = new OllamaEmbeddingProvider(DEFAULT_CONFIG);
      const healthy = await provider.healthCheck();

      expect(healthy).toBe(true);
    });

    test("returns false when model is not available", async () => {
      mockFetch(() =>
        Promise.resolve(
          createMockResponse({
            models: [{ name: "other-model:latest", model: "other-model" }],
          })
        )
      );

      const provider = new OllamaEmbeddingProvider(DEFAULT_CONFIG);
      const healthy = await provider.healthCheck();

      expect(healthy).toBe(false);
    });

    test("returns false when server returns error", async () => {
      mockFetch(() =>
        Promise.resolve(createMockResponse({ error: "Unauthorized" }, 401, "Unauthorized"))
      );

      const provider = new OllamaEmbeddingProvider(DEFAULT_CONFIG);
      const healthy = await provider.healthCheck();

      expect(healthy).toBe(false);
    });

    test("returns false when server is unreachable", async () => {
      mockFetch(() => Promise.reject(new Error("Network error")));

      const provider = new OllamaEmbeddingProvider(DEFAULT_CONFIG);
      const healthy = await provider.healthCheck();

      expect(healthy).toBe(false);
    });

    test("never throws even on unexpected errors", async () => {
      mockFetch(() => {
        throw new Error("Unexpected synchronous error");
      });

      const provider = new OllamaEmbeddingProvider(DEFAULT_CONFIG);
      const healthy = await provider.healthCheck();

      expect(healthy).toBe(false);
    });
  });

  describe("getCapabilities", () => {
    test("returns correct capabilities", () => {
      const provider = new OllamaEmbeddingProvider(DEFAULT_CONFIG);
      const caps = provider.getCapabilities();

      expect(caps.maxBatchSize).toBe(1);
      expect(caps.maxTokensPerText).toBe(8192);
      expect(caps.supportsGPU).toBe(true);
      expect(caps.requiresNetwork).toBe(false);
      expect(caps.estimatedLatencyMs).toBe(50);
    });
  });

  describe("timeout handling", () => {
    test("throws on timeout", async () => {
      // Create a mock that checks for abort signal
      mockFetch((_url, init) => {
        return new Promise((_resolve, reject) => {
          const signal = init?.signal;
          if (signal) {
            // Listen for abort event
            signal.addEventListener("abort", () => {
              const error = new Error("This operation was aborted");
              error.name = "AbortError";
              reject(error);
            });
          }
          // Never resolve - wait for abort
        });
      });

      const config: OllamaProviderConfig = {
        ...DEFAULT_CONFIG,
        timeoutMs: 50, // Very short timeout
        maxRetries: 0,
      };
      const provider = new OllamaEmbeddingProvider(config);

      await expect(provider.generateEmbedding("test")).rejects.toThrow("timed out");
    });
  });

  describe("custom configuration", () => {
    test("uses custom base URL", async () => {
      let capturedUrl = "";
      mockFetch((url) => {
        capturedUrl = url.toString();
        return Promise.resolve(createMockResponse({ embedding: MOCK_EMBEDDING }));
      });

      const config: OllamaProviderConfig = {
        ...DEFAULT_CONFIG,
        baseUrl: "http://custom-ollama:9999",
      };
      const provider = new OllamaEmbeddingProvider(config);
      await provider.generateEmbedding("test");

      expect(capturedUrl).toBe("http://custom-ollama:9999/api/embeddings");
    });

    test("uses custom keepAlive", async () => {
      let capturedBody: { keep_alive?: string } = {};
      mockFetch((_url, init) => {
        capturedBody = JSON.parse(init?.body as string) as { keep_alive?: string };
        return Promise.resolve(createMockResponse({ embedding: MOCK_EMBEDDING }));
      });

      const config: OllamaProviderConfig = {
        ...DEFAULT_CONFIG,
        keepAlive: "30m",
      };
      const provider = new OllamaEmbeddingProvider(config);
      await provider.generateEmbedding("test");

      expect(capturedBody.keep_alive).toBe("30m");
    });
  });
});
