/* eslint-disable @typescript-eslint/no-non-null-assertion */
/**
 * Offline operation tests for local embedding providers
 *
 * These tests verify that Transformers.js and Ollama providers can operate
 * without external network access after initial model download/server setup.
 *
 * Tests validate:
 * 1. Transformers.js works with cached models (no network calls)
 * 2. Ollama works with local server (no external network calls)
 * 3. Providers correctly report requiresNetwork=false
 *
 * Run with: OFFLINE_TESTS=true bun test tests/integration/providers/offline.test.ts
 *
 * Prerequisites:
 * - Transformers.js model must be pre-downloaded (cached)
 * - Ollama must be running locally with the model pulled
 */

import { describe, test, expect, beforeAll, afterAll, mock } from "bun:test";
import {
  TransformersJsEmbeddingProvider,
  type TransformersJsProviderConfig,
} from "../../../src/providers/transformersjs-embedding.js";
import {
  OllamaEmbeddingProvider,
  type OllamaProviderConfig,
} from "../../../src/providers/ollama-embedding.js";

// Skip all tests unless OFFLINE_TESTS is set
const shouldRunOfflineTests = Bun.env["OFFLINE_TESTS"] === "true";

/**
 * Track if global fetch was called with external URLs
 */
interface FetchCall {
  url: string;
  isExternal: boolean;
  timestamp: number;
}

/**
 * List of known external domains that should not be called in offline mode
 */
const EXTERNAL_DOMAINS = [
  "huggingface.co",
  "cdn-lfs.huggingface.co",
  "api.openai.com",
  "storage.googleapis.com",
  "s3.amazonaws.com",
];

/**
 * Check if a URL is external (not localhost)
 */
function isExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    // localhost and 127.0.0.x are local
    if (hostname === "localhost" || hostname.startsWith("127.")) {
      return false;
    }

    // Check against known external domains
    for (const domain of EXTERNAL_DOMAINS) {
      if (hostname.includes(domain)) {
        return true;
      }
    }

    // Assume any other domain could be external
    return !hostname.includes("local") && !hostname.includes("internal");
  } catch {
    return false;
  }
}

describe.skipIf(!shouldRunOfflineTests)("Local Providers - Offline Operation Verification", () => {
  describe("Provider Capabilities", () => {
    test("Transformers.js reports requiresNetwork=false", () => {
      const config: TransformersJsProviderConfig = {
        provider: "transformersjs",
        model: "Xenova/all-MiniLM-L6-v2",
        dimensions: 384,
        batchSize: 32,
        maxRetries: 0,
        timeoutMs: 60000,
        modelPath: "Xenova/all-MiniLM-L6-v2",
      };

      const provider = new TransformersJsEmbeddingProvider(config);
      const capabilities = provider.getCapabilities();

      expect(capabilities.requiresNetwork).toBe(false);
    });

    test("Ollama reports requiresNetwork=false", () => {
      const config: OllamaProviderConfig = {
        provider: "ollama",
        model: "nomic-embed-text",
        dimensions: 768,
        batchSize: 32,
        maxRetries: 0,
        timeoutMs: 30000,
        modelName: "nomic-embed-text",
        baseUrl: "http://localhost:11434",
      };

      const provider = new OllamaEmbeddingProvider(config);
      const capabilities = provider.getCapabilities();

      expect(capabilities.requiresNetwork).toBe(false);
    });
  });
});

describe.skipIf(!shouldRunOfflineTests)("Transformers.js - Offline Operation", () => {
  let provider: TransformersJsEmbeddingProvider;
  let fetchCalls: FetchCall[] = [];
  let originalFetch: typeof global.fetch;

  beforeAll(async () => {
    // Save original fetch
    originalFetch = global.fetch;

    // Wrap fetch to track calls
    const wrappedFetch = mock((input: string | URL | Request, init?: RequestInit) => {
      let url: string;
      if (typeof input === "string") {
        url = input;
      } else if (input instanceof URL) {
        url = input.toString();
      } else {
        url = input.url;
      }
      fetchCalls.push({
        url,
        isExternal: isExternalUrl(url),
        timestamp: Date.now(),
      });
      return originalFetch(input, init);
    });

    global.fetch = wrappedFetch as unknown as typeof global.fetch;

    // Initialize provider (model should already be cached from previous tests)
    console.log("Initializing TransformersJs provider with cached model...");

    const config: TransformersJsProviderConfig = {
      provider: "transformersjs",
      model: "Xenova/all-MiniLM-L6-v2",
      dimensions: 384,
      batchSize: 32,
      maxRetries: 0,
      timeoutMs: 120000,
      modelPath: "Xenova/all-MiniLM-L6-v2",
    };

    provider = new TransformersJsEmbeddingProvider(config);

    // Generate test embedding to initialize model
    await provider.generateEmbedding("test initialization");

    // Clear fetch tracking for subsequent tests
    fetchCalls = [];
    console.log("Model initialized, starting offline tests...");
  }, 300000); // 5 minute timeout for model loading

  afterAll(() => {
    // Restore original fetch
    global.fetch = originalFetch;
  });

  test("generates embeddings without external network calls", async () => {
    fetchCalls = []; // Reset tracking

    const embedding = await provider.generateEmbedding("Test embedding generation in offline mode");

    expect(embedding).toBeInstanceOf(Array);
    expect(embedding.length).toBe(384);

    // Check for external calls
    const externalCalls = fetchCalls.filter((call) => call.isExternal);
    expect(externalCalls.length).toBe(0);

    if (externalCalls.length > 0) {
      console.error("Unexpected external network calls:");
      externalCalls.forEach((call) => console.error(`  - ${call.url}`));
    }
  });

  test("batch embeddings work without external network calls", async () => {
    fetchCalls = []; // Reset tracking

    const texts = ["First offline text", "Second offline text", "Third offline text"];

    const embeddings = await provider.generateEmbeddings(texts);

    expect(embeddings.length).toBe(3);
    embeddings.forEach((embedding) => {
      expect(embedding.length).toBe(384);
    });

    // Check for external calls
    const externalCalls = fetchCalls.filter((call) => call.isExternal);
    expect(externalCalls.length).toBe(0);
  });

  test("health check works without external network calls", async () => {
    fetchCalls = []; // Reset tracking

    const healthy = await provider.healthCheck();

    expect(healthy).toBe(true);

    // Check for external calls
    const externalCalls = fetchCalls.filter((call) => call.isExternal);
    expect(externalCalls.length).toBe(0);
  });

  test("multiple sequential requests work offline", async () => {
    fetchCalls = []; // Reset tracking

    // Simulate typical usage pattern
    for (let i = 0; i < 5; i++) {
      const embedding = await provider.generateEmbedding(`Request ${i + 1} in sequence`);
      expect(embedding.length).toBe(384);
    }

    // Check for external calls
    const externalCalls = fetchCalls.filter((call) => call.isExternal);
    expect(externalCalls.length).toBe(0);

    console.log(`Total fetch calls: ${fetchCalls.length} (${externalCalls.length} external)`);
  });
});

describe.skipIf(!shouldRunOfflineTests)("Ollama - Offline Operation", () => {
  let provider: OllamaEmbeddingProvider;
  let fetchCalls: FetchCall[] = [];
  let originalFetch: typeof global.fetch;
  const ollamaBaseUrl = Bun.env["OLLAMA_BASE_URL"] || "http://localhost:11434";

  beforeAll(async () => {
    // Save original fetch
    originalFetch = global.fetch;

    // Wrap fetch to track calls
    const wrappedFetch = mock((input: string | URL | Request, init?: RequestInit) => {
      let url: string;
      if (typeof input === "string") {
        url = input;
      } else if (input instanceof URL) {
        url = input.toString();
      } else {
        url = input.url;
      }
      fetchCalls.push({
        url,
        isExternal: isExternalUrl(url),
        timestamp: Date.now(),
      });
      return originalFetch(input, init);
    });

    global.fetch = wrappedFetch as unknown as typeof global.fetch;

    // Initialize provider
    console.log(`Initializing Ollama provider at ${ollamaBaseUrl}...`);

    const config: OllamaProviderConfig = {
      provider: "ollama",
      model: "nomic-embed-text",
      dimensions: 768,
      batchSize: 32,
      maxRetries: 3,
      timeoutMs: 60000,
      modelName: "nomic-embed-text",
      baseUrl: ollamaBaseUrl,
      keepAlive: "5m",
    };

    provider = new OllamaEmbeddingProvider(config);

    // Verify server is running
    const healthy = await provider.healthCheck();
    if (!healthy) {
      throw new Error(`Ollama server not available at ${ollamaBaseUrl}`);
    }

    // Warm up the model
    await provider.generateEmbedding("test initialization");

    // Clear fetch tracking for subsequent tests
    fetchCalls = [];
    console.log("Ollama ready, starting offline tests...");
  }, 120000);

  afterAll(() => {
    // Restore original fetch
    global.fetch = originalFetch;
  });

  test("generates embeddings with only local server calls", async () => {
    fetchCalls = []; // Reset tracking

    const embedding = await provider.generateEmbedding(
      "Test embedding generation with local Ollama"
    );

    expect(embedding).toBeInstanceOf(Array);
    expect(embedding.length).toBe(768);

    // All calls should be to localhost
    const externalCalls = fetchCalls.filter((call) => call.isExternal);
    expect(externalCalls.length).toBe(0);

    // Should have local calls to Ollama
    const localCalls = fetchCalls.filter((call) => !call.isExternal);
    expect(localCalls.length).toBeGreaterThan(0);

    if (externalCalls.length > 0) {
      console.error("Unexpected external network calls:");
      externalCalls.forEach((call) => console.error(`  - ${call.url}`));
    }
  });

  test("batch embeddings use only local server", async () => {
    fetchCalls = []; // Reset tracking

    const texts = ["First local text", "Second local text", "Third local text"];

    const embeddings = await provider.generateEmbeddings(texts);

    expect(embeddings.length).toBe(3);

    // All calls should be to localhost
    const externalCalls = fetchCalls.filter((call) => call.isExternal);
    expect(externalCalls.length).toBe(0);
  });

  test("health check uses only local server", async () => {
    fetchCalls = []; // Reset tracking

    const healthy = await provider.healthCheck();

    expect(healthy).toBe(true);

    // All calls should be to localhost
    const externalCalls = fetchCalls.filter((call) => call.isExternal);
    expect(externalCalls.length).toBe(0);
  });

  test("multiple requests stay local", async () => {
    fetchCalls = []; // Reset tracking

    for (let i = 0; i < 5; i++) {
      const embedding = await provider.generateEmbedding(`Local request ${i + 1}`);
      expect(embedding.length).toBe(768);
    }

    // All calls should be to localhost
    const externalCalls = fetchCalls.filter((call) => call.isExternal);
    expect(externalCalls.length).toBe(0);

    console.log(`Total fetch calls: ${fetchCalls.length} (${externalCalls.length} external)`);
  });
});

// Print instructions if tests are skipped
if (!shouldRunOfflineTests) {
  console.log(
    "\n📝 Offline operation tests are SKIPPED by default.\n" +
      "To run these tests:\n\n" +
      "  1. Ensure Transformers.js model is cached:\n" +
      "     TRANSFORMERS_LIVE_TESTS=true bun test tests/integration/providers/transformersjs-live.test.ts\n\n" +
      "  2. Ensure Ollama is running with model pulled:\n" +
      "     ollama pull nomic-embed-text\n\n" +
      "  3. Run offline tests:\n" +
      "     OFFLINE_TESTS=true bun test tests/integration/providers/offline.test.ts\n\n" +
      "These tests verify that local providers work without external network access.\n"
  );
}
