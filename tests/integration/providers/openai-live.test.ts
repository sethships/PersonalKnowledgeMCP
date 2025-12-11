/**
 * Live integration tests for OpenAI embedding provider
 *
 * These tests make REAL API calls to OpenAI and require:
 * 1. Valid OPENAI_API_KEY environment variable
 * 2. RUN_INTEGRATION_TESTS=true to enable
 * 3. Network connectivity
 * 4. OpenAI API access (costs ~$0.00002 per test run)
 *
 * Run with: RUN_INTEGRATION_TESTS=true bun test tests/integration/providers/openai-live.test.ts
 * Or: RUN_INTEGRATION_TESTS=true bun test (runs all integration tests)
 */

/* eslint-disable @typescript-eslint/await-thenable */

import { describe, test, expect, beforeAll } from "bun:test";
import { createEmbeddingProvider } from "../../../src/providers/index.js";
import type { EmbeddingProviderConfig } from "../../../src/providers/index.js";

// Only run these tests if explicitly enabled
const shouldRunIntegrationTests = Bun.env["RUN_INTEGRATION_TESTS"] === "true";
const describeIntegration = shouldRunIntegrationTests ? describe : describe.skip;

describeIntegration("OpenAI Embedding Provider - Live Integration", () => {
  let provider: ReturnType<typeof createEmbeddingProvider>;

  beforeAll(() => {
    const apiKey = Bun.env["OPENAI_API_KEY"];
    if (!apiKey) {
      throw new Error(
        "OPENAI_API_KEY environment variable is required for integration tests. " +
          "Set it in your .env file or export it."
      );
    }

    const config: EmbeddingProviderConfig = {
      provider: "openai",
      model: "text-embedding-3-small",
      dimensions: 1536,
      batchSize: 100,
      maxRetries: 3,
      timeoutMs: 30000,
    };

    provider = createEmbeddingProvider(config);
  });

  test("health check passes with real API", async () => {
    const isHealthy = await provider.healthCheck();
    expect(isHealthy).toBe(true);
  });

  test("generates single embedding with real API", async () => {
    const text = "Hello world! This is a test of the OpenAI embedding provider.";
    const embedding = await provider.generateEmbedding(text);

    expect(embedding).toBeInstanceOf(Array);
    expect(embedding.length).toBe(1536);
    expect(embedding.every((val) => typeof val === "number")).toBe(true);

    // Embeddings should be normalized (roughly between -1 and 1)
    expect(embedding.every((val) => val >= -2 && val <= 2)).toBe(true);
  });

  test("generates batch embeddings with real API", async () => {
    const texts = [
      "First test sentence",
      "Second test sentence",
      "Third test sentence",
      "Fourth test sentence",
      "Fifth test sentence",
    ];

    const embeddings = await provider.generateEmbeddings(texts);

    expect(embeddings).toBeInstanceOf(Array);
    expect(embeddings.length).toBe(5);

    // Each embedding should be 1536 dimensions
    embeddings.forEach((embedding) => {
      expect(embedding.length).toBe(1536);
      expect(embedding.every((val) => typeof val === "number")).toBe(true);
    });
  });

  test("sanitizes API key in error messages", async () => {
    // Create provider with fake API key to trigger auth error
    const badConfig: EmbeddingProviderConfig = {
      provider: "openai",
      model: "text-embedding-3-small",
      dimensions: 1536,
      batchSize: 100,
      maxRetries: 0, // No retries for faster failure
      timeoutMs: 5000,
    };

    // Save and replace API key temporarily
    const originalKey = Bun.env["OPENAI_API_KEY"];
    const fakeKey = "sk-fake1234567890abcdefghijklmnop";
    Bun.env["OPENAI_API_KEY"] = fakeKey;

    try {
      const badProvider = createEmbeddingProvider(badConfig);

      // Restore original key before making request
      Bun.env["OPENAI_API_KEY"] = originalKey;

      await expect(badProvider.generateEmbedding("test")).rejects.toThrow();

      // If we get here, test failed to throw
      throw new Error("Expected provider to throw error with invalid API key");
    } catch (error) {
      // Restore original key in case of any error
      Bun.env["OPENAI_API_KEY"] = originalKey;

      const errorMessage = (error as Error).message;

      // Verify the fake key is NOT in the error message
      expect(errorMessage).not.toContain("sk-fake");
      expect(errorMessage).not.toContain(fakeKey);

      // Error should mention authentication/permissions
      expect(
        errorMessage.toLowerCase().includes("api key") ||
          errorMessage.toLowerCase().includes("authentication") ||
          errorMessage.toLowerCase().includes("permissions")
      ).toBe(true);
    } finally {
      // Always restore original key
      Bun.env["OPENAI_API_KEY"] = originalKey;
    }
  });

  test("provider metadata is correct", () => {
    expect(provider.providerId).toBe("openai");
    expect(provider.modelId).toBe("text-embedding-3-small");
    expect(provider.dimensions).toBe(1536);
  });
});
