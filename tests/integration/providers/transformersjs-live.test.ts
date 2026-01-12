/* eslint-disable @typescript-eslint/no-non-null-assertion */
/**
 * Integration tests for TransformersJsEmbeddingProvider with real model
 *
 * These tests use actual Transformers.js models and require model download.
 * They are skipped by default due to download time and resource requirements.
 *
 * To run these tests:
 * - Set TRANSFORMERS_LIVE_TESTS=true environment variable
 * - Allow 2-5 minutes for initial model download
 * - Subsequent runs will use cached model
 *
 * @example
 * TRANSFORMERS_LIVE_TESTS=true bun test tests/integration/providers/transformersjs-live.test.ts
 */

import { describe, test, expect, beforeAll } from "bun:test";
import {
  TransformersJsEmbeddingProvider,
  type TransformersJsProviderConfig,
} from "../../../src/providers/transformersjs-embedding.js";
import { createEmbeddingProvider } from "../../../src/providers/factory.js";
import type { EmbeddingProviderConfig } from "../../../src/providers/types.js";

// Skip all tests unless TRANSFORMERS_LIVE_TESTS is set
const shouldRunLiveTests = Bun.env["TRANSFORMERS_LIVE_TESTS"] === "true";

describe.skipIf(!shouldRunLiveTests)("TransformersJsEmbeddingProvider - Live Integration", () => {
  let provider: TransformersJsEmbeddingProvider;

  beforeAll(async () => {
    console.log("Initializing TransformersJs provider (may download model on first run)...");

    const config: TransformersJsProviderConfig = {
      provider: "transformersjs",
      model: "Xenova/all-MiniLM-L6-v2",
      dimensions: 384,
      batchSize: 32,
      maxRetries: 0,
      timeoutMs: 300000, // 5 minutes for model download
      modelPath: "Xenova/all-MiniLM-L6-v2",
      onProgress: (progress) => {
        if (progress.status === "progress" && progress.file && progress.progress !== undefined) {
          console.log(`Downloading ${progress.file}: ${Math.round(progress.progress)}%`);
        }
      },
    };

    provider = new TransformersJsEmbeddingProvider(config);

    // Warm up the model by running a test embedding
    console.log("Warming up model...");
    await provider.generateEmbedding("test");
    console.log("Model ready.");
  }, 600000); // 10 minute timeout for beforeAll (model download)

  test("health check returns true after initialization", async () => {
    const isHealthy = await provider.healthCheck();
    expect(isHealthy).toBe(true);
  });

  test("generates single embedding with correct dimensions", async () => {
    const text = "Hello world! This is a test of the Transformers.js embedding provider.";
    const embedding = await provider.generateEmbedding(text);

    expect(embedding).toBeInstanceOf(Array);
    expect(embedding.length).toBe(384);
    expect(embedding.every((val) => typeof val === "number")).toBe(true);

    // Embeddings should be normalized (roughly between -1 and 1)
    const maxVal = Math.max(...embedding.map(Math.abs));
    expect(maxVal).toBeLessThanOrEqual(1.5); // Some tolerance
  });

  test("generates batch embeddings correctly", async () => {
    const texts = [
      "The quick brown fox jumps over the lazy dog.",
      "Machine learning is a subset of artificial intelligence.",
      "TypeScript is a typed superset of JavaScript.",
    ];

    const embeddings = await provider.generateEmbeddings(texts);

    expect(embeddings.length).toBe(3);
    expect(embeddings[0]!.length).toBe(384);
    expect(embeddings[1]!.length).toBe(384);
    expect(embeddings[2]!.length).toBe(384);
  });

  test("similar texts produce similar embeddings", async () => {
    const text1 = "The cat sat on the mat.";
    const text2 = "A feline rested on the rug."; // Similar meaning
    const text3 = "JavaScript is a programming language."; // Different meaning

    const embeddings = await provider.generateEmbeddings([text1, text2, text3]);

    // Calculate cosine similarity
    const cosineSimilarity = (a: number[], b: number[]): number => {
      const dotProduct = a.reduce((sum, val, i) => sum + val * b[i]!, 0);
      const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
      const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
      return dotProduct / (magnitudeA * magnitudeB);
    };

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

    expect(embedding.length).toBe(384);
    expect(embedding.every((val) => typeof val === "number")).toBe(true);
  });

  test("handles unicode and special characters", async () => {
    const texts = ["Hello 世界 🌍", "Привет мир", "مرحبا بالعالم"];

    const embeddings = await provider.generateEmbeddings(texts);

    expect(embeddings.length).toBe(3);
    embeddings.forEach((embedding) => {
      expect(embedding.length).toBe(384);
    });
  });

  test("handles long text", async () => {
    // Create a long text (should be truncated by the model if too long)
    const longText = "This is a test sentence. ".repeat(100);

    const embedding = await provider.generateEmbedding(longText);

    expect(embedding.length).toBe(384);
    expect(embedding.every((val) => typeof val === "number")).toBe(true);
  });

  test("getCapabilities returns correct values", () => {
    const capabilities = provider.getCapabilities();

    expect(capabilities.maxBatchSize).toBe(32);
    expect(capabilities.maxTokensPerText).toBe(512);
    expect(capabilities.supportsGPU).toBe(false);
    expect(capabilities.requiresNetwork).toBe(false);
    expect(capabilities.estimatedLatencyMs).toBe(100);
  });
});

describe.skipIf(!shouldRunLiveTests)(
  "TransformersJsEmbeddingProvider - Factory Integration",
  () => {
    test("factory creates working provider", async () => {
      const config: EmbeddingProviderConfig = {
        provider: "transformersjs",
        model: "Xenova/all-MiniLM-L6-v2",
        dimensions: 384,
        batchSize: 32,
        maxRetries: 0,
        timeoutMs: 300000,
      };

      const provider = createEmbeddingProvider(config);

      const embedding = await provider.generateEmbedding("Test via factory");

      expect(embedding.length).toBe(384);
      expect(provider.providerId).toBe("transformersjs");
    }, 600000);

    test("factory with 'local' alias creates TransformersJs provider", async () => {
      const config: EmbeddingProviderConfig = {
        provider: "local",
        model: "Xenova/all-MiniLM-L6-v2",
        dimensions: 384,
        batchSize: 32,
        maxRetries: 0,
        timeoutMs: 300000,
      };

      const provider = createEmbeddingProvider(config);

      expect(provider.providerId).toBe("transformersjs");

      const embedding = await provider.generateEmbedding("Test via local alias");
      expect(embedding.length).toBe(384);
    }, 600000);
  }
);

// Print instructions if tests are skipped
if (!shouldRunLiveTests) {
  console.log(
    "\n📝 TransformersJs live integration tests are SKIPPED by default.\n" +
      "To run these tests, set TRANSFORMERS_LIVE_TESTS=true:\n\n" +
      "  TRANSFORMERS_LIVE_TESTS=true bun test tests/integration/providers/transformersjs-live.test.ts\n\n" +
      "Note: First run may take 2-5 minutes to download the model (~22MB).\n"
  );
}
