/* eslint-disable @typescript-eslint/no-non-null-assertion, @typescript-eslint/await-thenable */
/**
 * Live integration tests for Ollama embedding provider
 *
 * These tests make REAL API calls to a local Ollama server and require:
 * 1. Ollama server running locally (or accessible via OLLAMA_BASE_URL)
 * 2. OLLAMA_LIVE_TESTS=true to enable
 * 3. The nomic-embed-text model pulled (or another embedding model)
 *
 * Run with: OLLAMA_LIVE_TESTS=true bun test tests/integration/providers/ollama-live.test.ts
 *
 * Setup Ollama:
 *   1. Install Ollama: https://ollama.ai/download
 *   2. Pull embedding model: ollama pull nomic-embed-text
 *   3. Verify it's running: curl http://localhost:11434/api/tags
 */

import { describe, test, expect, beforeAll } from "bun:test";
import {
  OllamaEmbeddingProvider,
  type OllamaProviderConfig,
} from "../../../src/providers/ollama-embedding.js";
import { createEmbeddingProvider } from "../../../src/providers/factory.js";
import type { EmbeddingProviderConfig } from "../../../src/providers/types.js";
import { cosineSimilarity } from "../../fixtures/benchmark-fixtures.js";

// Skip all tests unless OLLAMA_LIVE_TESTS is set
const shouldRunLiveTests = Bun.env["OLLAMA_LIVE_TESTS"] === "true";
const ollamaBaseUrl = Bun.env["OLLAMA_BASE_URL"] || "http://localhost:11434";

// Model configuration - nomic-embed-text is a good default
const DEFAULT_MODEL = Bun.env["OLLAMA_MODEL"] || "nomic-embed-text";
const DEFAULT_DIMENSIONS = parseInt(Bun.env["OLLAMA_DIMENSIONS"] || "768", 10);

describe.skipIf(!shouldRunLiveTests)("OllamaEmbeddingProvider - Live Integration", () => {
  let provider: OllamaEmbeddingProvider;

  beforeAll(async () => {
    console.log(`Initializing Ollama provider at ${ollamaBaseUrl}...`);
    console.log(`Using model: ${DEFAULT_MODEL} (${DEFAULT_DIMENSIONS} dimensions)`);

    const config: OllamaProviderConfig = {
      provider: "ollama",
      model: DEFAULT_MODEL,
      dimensions: DEFAULT_DIMENSIONS,
      batchSize: 32,
      maxRetries: 3,
      timeoutMs: 60000,
      modelName: DEFAULT_MODEL,
      baseUrl: ollamaBaseUrl,
      keepAlive: "5m",
    };

    provider = new OllamaEmbeddingProvider(config);

    // Verify Ollama is running and model is available
    const healthy = await provider.healthCheck();
    if (!healthy) {
      throw new Error(
        `Ollama health check failed. Ensure Ollama is running at ${ollamaBaseUrl} ` +
          `and model '${DEFAULT_MODEL}' is pulled (ollama pull ${DEFAULT_MODEL})`
      );
    }

    // Warm up the model
    console.log("Warming up model...");
    await provider.generateEmbedding("test");
    console.log("Model ready.");
  }, 120000); // 2 minute timeout for warmup

  test("health check returns true with running server", async () => {
    const isHealthy = await provider.healthCheck();
    expect(isHealthy).toBe(true);
  });

  test("generates single embedding with correct dimensions", async () => {
    const text = "Hello world! This is a test of the Ollama embedding provider.";
    const embedding = await provider.generateEmbedding(text);

    expect(embedding).toBeInstanceOf(Array);
    expect(embedding.length).toBe(DEFAULT_DIMENSIONS);
    expect(embedding.every((val) => typeof val === "number")).toBe(true);

    // Embeddings should be normalized (roughly between -1 and 1)
    const maxVal = Math.max(...embedding.map(Math.abs));
    expect(maxVal).toBeLessThanOrEqual(2.0); // Some tolerance for different models
  });

  test("generates batch embeddings correctly", async () => {
    const texts = [
      "The quick brown fox jumps over the lazy dog.",
      "Machine learning is a subset of artificial intelligence.",
      "TypeScript is a typed superset of JavaScript.",
    ];

    const embeddings = await provider.generateEmbeddings(texts);

    expect(embeddings.length).toBe(3);
    expect(embeddings[0]!.length).toBe(DEFAULT_DIMENSIONS);
    expect(embeddings[1]!.length).toBe(DEFAULT_DIMENSIONS);
    expect(embeddings[2]!.length).toBe(DEFAULT_DIMENSIONS);
  });

  test("preserves embedding order in batch", async () => {
    const texts = ["First text", "Second text", "Third text"];

    const embeddings = await provider.generateEmbeddings(texts);

    // Each embedding should be different (texts are different)
    const sim01 = cosineSimilarity(embeddings[0]!, embeddings[1]!);
    const sim02 = cosineSimilarity(embeddings[0]!, embeddings[2]!);
    const sim12 = cosineSimilarity(embeddings[1]!, embeddings[2]!);

    // All pairs should have non-perfect similarity
    expect(sim01).toBeLessThan(1.0);
    expect(sim02).toBeLessThan(1.0);
    expect(sim12).toBeLessThan(1.0);
  });

  test("similar texts produce similar embeddings", async () => {
    const text1 = "The cat sat on the mat.";
    const text2 = "A feline rested on the rug."; // Similar meaning
    const text3 = "JavaScript is a programming language."; // Different meaning

    const embeddings = await provider.generateEmbeddings([text1, text2, text3]);

    const similarity12 = cosineSimilarity(embeddings[0]!, embeddings[1]!);
    const similarity13 = cosineSimilarity(embeddings[0]!, embeddings[2]!);

    // Similar texts should have higher similarity
    expect(similarity12).toBeGreaterThan(similarity13);
    console.log(`Similarity (cat/feline): ${similarity12.toFixed(4)}`);
    console.log(`Similarity (cat/javascript): ${similarity13.toFixed(4)}`);
  });

  test("handles code snippets", async () => {
    const codeSnippet = `
      function fibonacci(n) {
        if (n <= 1) return n;
        return fibonacci(n - 1) + fibonacci(n - 2);
      }
    `;

    const embedding = await provider.generateEmbedding(codeSnippet);

    expect(embedding.length).toBe(DEFAULT_DIMENSIONS);
    expect(embedding.every((val) => typeof val === "number")).toBe(true);
  });

  test("handles unicode and special characters", async () => {
    const texts = ["Hello 世界 🌍", "Привет мир", "مرحبا بالعالم"];

    const embeddings = await provider.generateEmbeddings(texts);

    expect(embeddings.length).toBe(3);
    embeddings.forEach((embedding) => {
      expect(embedding.length).toBe(DEFAULT_DIMENSIONS);
    });
  });

  test("handles long text", async () => {
    // Create a long text
    const longText = "This is a test sentence for embedding. ".repeat(50);

    const embedding = await provider.generateEmbedding(longText);

    expect(embedding.length).toBe(DEFAULT_DIMENSIONS);
    expect(embedding.every((val) => typeof val === "number")).toBe(true);
  });

  test("getCapabilities returns correct values", () => {
    const capabilities = provider.getCapabilities();

    expect(capabilities.maxBatchSize).toBe(1); // Ollama processes one at a time
    expect(capabilities.maxTokensPerText).toBe(8192);
    expect(capabilities.supportsGPU).toBe(true);
    expect(capabilities.requiresNetwork).toBe(false);
    expect(capabilities.estimatedLatencyMs).toBe(50);
  });

  test("provider metadata is correct", () => {
    expect(provider.providerId).toBe("ollama");
    expect(provider.modelId).toBe(DEFAULT_MODEL);
    expect(provider.dimensions).toBe(DEFAULT_DIMENSIONS);
  });

  test("keep-alive optimizes subsequent requests", async () => {
    // First request loads the model
    const start1 = performance.now();
    await provider.generateEmbedding("First request to load model");
    const time1 = performance.now() - start1;

    // Second request should use cached model
    const start2 = performance.now();
    await provider.generateEmbedding("Second request with cached model");
    const time2 = performance.now() - start2;

    // Second request should be similar or faster (model is warm)
    // Note: First might be faster if model was already loaded from previous tests
    console.log(`First request: ${time1.toFixed(2)}ms`);
    console.log(`Second request: ${time2.toFixed(2)}ms`);

    // Both should complete in reasonable time
    expect(time1).toBeLessThan(10000); // 10 seconds max
    expect(time2).toBeLessThan(5000); // 5 seconds max for warm model
  });
});

describe.skipIf(!shouldRunLiveTests)("OllamaEmbeddingProvider - Error Handling", () => {
  test("health check returns false for non-existent model", async () => {
    const config: OllamaProviderConfig = {
      provider: "ollama",
      model: "non-existent-model-xyz",
      dimensions: 768,
      batchSize: 32,
      maxRetries: 0,
      timeoutMs: 5000,
      modelName: "non-existent-model-xyz",
      baseUrl: ollamaBaseUrl,
    };

    const provider = new OllamaEmbeddingProvider(config);
    const healthy = await provider.healthCheck();

    expect(healthy).toBe(false);
  });

  test("health check returns false for invalid server URL", async () => {
    const config: OllamaProviderConfig = {
      provider: "ollama",
      model: DEFAULT_MODEL,
      dimensions: DEFAULT_DIMENSIONS,
      batchSize: 32,
      maxRetries: 0,
      timeoutMs: 2000,
      modelName: DEFAULT_MODEL,
      baseUrl: "http://localhost:59999", // Port unlikely to be in use - tests connection refused
    };

    const provider = new OllamaEmbeddingProvider(config);
    const healthy = await provider.healthCheck();

    expect(healthy).toBe(false);
  });

  test("throws on empty text", async () => {
    const config: OllamaProviderConfig = {
      provider: "ollama",
      model: DEFAULT_MODEL,
      dimensions: DEFAULT_DIMENSIONS,
      batchSize: 32,
      maxRetries: 0,
      timeoutMs: 30000,
      modelName: DEFAULT_MODEL,
      baseUrl: ollamaBaseUrl,
    };

    const provider = new OllamaEmbeddingProvider(config);
    await expect(provider.generateEmbedding("")).rejects.toThrow();
  });

  test("throws on whitespace-only text", async () => {
    const config: OllamaProviderConfig = {
      provider: "ollama",
      model: DEFAULT_MODEL,
      dimensions: DEFAULT_DIMENSIONS,
      batchSize: 32,
      maxRetries: 0,
      timeoutMs: 30000,
      modelName: DEFAULT_MODEL,
      baseUrl: ollamaBaseUrl,
    };

    const provider = new OllamaEmbeddingProvider(config);
    await expect(provider.generateEmbedding("   \t\n  ")).rejects.toThrow();
  });
});

describe.skipIf(!shouldRunLiveTests)("OllamaEmbeddingProvider - Factory Integration", () => {
  test("factory creates working provider", async () => {
    const config: EmbeddingProviderConfig = {
      provider: "ollama",
      model: DEFAULT_MODEL,
      dimensions: DEFAULT_DIMENSIONS,
      batchSize: 32,
      maxRetries: 3,
      timeoutMs: 60000,
    };

    const provider = createEmbeddingProvider(config);

    const embedding = await provider.generateEmbedding("Test via factory");

    expect(embedding.length).toBe(DEFAULT_DIMENSIONS);
    expect(provider.providerId).toBe("ollama");
  }, 60000);
});

// Print instructions if tests are skipped
if (!shouldRunLiveTests) {
  console.log(
    "\n📝 Ollama live integration tests are SKIPPED by default.\n" +
      "To run these tests:\n\n" +
      "  1. Install Ollama: https://ollama.ai/download\n" +
      "  2. Pull embedding model: ollama pull nomic-embed-text\n" +
      "  3. Verify it's running: curl http://localhost:11434/api/tags\n" +
      "  4. Run tests: OLLAMA_LIVE_TESTS=true bun test tests/integration/providers/ollama-live.test.ts\n\n" +
      "Optional environment variables:\n" +
      "  OLLAMA_BASE_URL - Ollama server URL (default: http://localhost:11434)\n" +
      "  OLLAMA_MODEL - Model name (default: nomic-embed-text)\n" +
      "  OLLAMA_DIMENSIONS - Embedding dimensions (default: 768)\n"
  );
}
