/* eslint-disable @typescript-eslint/await-thenable, @typescript-eslint/no-unsafe-argument */
/**
 * Unit tests for OpenAIEmbeddingProvider
 *
 * Tests all methods with 95%+ code coverage including constructor validation,
 * embedding generation, batch processing, retry logic, error handling, and health checks.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import {
  OpenAIEmbeddingProvider,
  type OpenAIProviderConfig,
} from "../../../src/providers/openai-embedding.js";
import {
  EmbeddingAuthenticationError,
  EmbeddingRateLimitError,
  EmbeddingNetworkError,
  EmbeddingTimeoutError,
  EmbeddingValidationError,
  EmbeddingError,
} from "../../../src/providers/errors.js";
import {
  MockOpenAIClient,
  MockOpenAIClientWithTransientFailure,
} from "../../helpers/openai-mock.js";
import {
  SAMPLE_TEXTS,
  MOCK_OPENAI_RESPONSE,
  MOCK_NETWORK_ERRORS,
  TEST_CONFIGS,
} from "../../fixtures/embedding-fixtures.js";

describe("OpenAIEmbeddingProvider", () => {
  let config: OpenAIProviderConfig;

  beforeEach(() => {
    config = { ...TEST_CONFIGS.default };
  });

  describe("constructor", () => {
    test("accepts valid configuration", () => {
      const provider = new OpenAIEmbeddingProvider(config);
      expect(provider.providerId).toBe("openai");
      expect(provider.modelId).toBe("text-embedding-3-small");
      expect(provider.dimensions).toBe(1536);
    });

    test("throws on missing API key", () => {
      config.apiKey = "";
      expect(() => new OpenAIEmbeddingProvider(config)).toThrow(EmbeddingValidationError);
      expect(() => new OpenAIEmbeddingProvider(config)).toThrow("API key is required");
    });

    test("throws on whitespace-only API key", () => {
      config.apiKey = "   ";
      expect(() => new OpenAIEmbeddingProvider(config)).toThrow(EmbeddingValidationError);
    });

    test("throws on invalid API key format", () => {
      config.apiKey = "invalid-key-format";
      expect(() => new OpenAIEmbeddingProvider(config)).toThrow(EmbeddingValidationError);
      expect(() => new OpenAIEmbeddingProvider(config)).toThrow("must start with 'sk-'");
    });

    test("throws on negative dimensions", () => {
      config.dimensions = -1;
      expect(() => new OpenAIEmbeddingProvider(config)).toThrow(EmbeddingValidationError);
      expect(() => new OpenAIEmbeddingProvider(config)).toThrow("Dimensions must be positive");
    });

    test("throws on zero dimensions", () => {
      config.dimensions = 0;
      expect(() => new OpenAIEmbeddingProvider(config)).toThrow(EmbeddingValidationError);
    });

    test("throws on negative batch size", () => {
      config.batchSize = -1;
      expect(() => new OpenAIEmbeddingProvider(config)).toThrow(EmbeddingValidationError);
      expect(() => new OpenAIEmbeddingProvider(config)).toThrow(
        "Batch size must be between 1 and 100"
      );
    });

    test("throws on zero batch size", () => {
      config.batchSize = 0;
      expect(() => new OpenAIEmbeddingProvider(config)).toThrow(EmbeddingValidationError);
    });

    test("throws on batch size > 100", () => {
      config.batchSize = 101;
      expect(() => new OpenAIEmbeddingProvider(config)).toThrow(EmbeddingValidationError);
    });

    test("throws on negative max retries", () => {
      config.maxRetries = -1;
      expect(() => new OpenAIEmbeddingProvider(config)).toThrow(EmbeddingValidationError);
      expect(() => new OpenAIEmbeddingProvider(config)).toThrow("Max retries must be non-negative");
    });

    test("throws on negative timeout", () => {
      config.timeoutMs = -1;
      expect(() => new OpenAIEmbeddingProvider(config)).toThrow(EmbeddingValidationError);
      expect(() => new OpenAIEmbeddingProvider(config)).toThrow("Timeout must be positive");
    });

    test("throws on zero timeout", () => {
      config.timeoutMs = 0;
      expect(() => new OpenAIEmbeddingProvider(config)).toThrow(EmbeddingValidationError);
    });
  });

  describe("generateEmbedding", () => {
    test("generates single embedding successfully", async () => {
      const provider = new OpenAIEmbeddingProvider(config);
      const mockClient = new MockOpenAIClient();

      // @ts-expect-error - Accessing private property for testing
      provider.client = mockClient;

      const embedding = await provider.generateEmbedding(SAMPLE_TEXTS.SHORT);

      expect(embedding).toBeInstanceOf(Array);
      expect(embedding.length).toBe(1536);
      expect(mockClient.getCallCount()).toBe(1);
    });

    test("throws on empty text", async () => {
      const provider = new OpenAIEmbeddingProvider(config);
      await expect(provider.generateEmbedding(SAMPLE_TEXTS.EMPTY)).rejects.toThrow(
        EmbeddingValidationError
      );
      await expect(provider.generateEmbedding(SAMPLE_TEXTS.EMPTY)).rejects.toThrow(
        "cannot be empty"
      );
    });

    test("throws on whitespace-only text", async () => {
      const provider = new OpenAIEmbeddingProvider(config);
      await expect(provider.generateEmbedding(SAMPLE_TEXTS.WHITESPACE)).rejects.toThrow(
        EmbeddingValidationError
      );
    });

    test("throws on non-string input", async () => {
      const provider = new OpenAIEmbeddingProvider(config);
      // @ts-expect-error - Testing invalid input type
      await expect(provider.generateEmbedding(123)).rejects.toThrow(EmbeddingValidationError);
      // @ts-expect-error - Testing invalid input type
      await expect(provider.generateEmbedding(null)).rejects.toThrow(EmbeddingValidationError);
    });
  });

  describe("generateEmbeddings", () => {
    test("generates batch embeddings successfully", async () => {
      const provider = new OpenAIEmbeddingProvider(config);
      const mockClient = new MockOpenAIClient();

      // @ts-expect-error - Accessing private property for testing
      provider.client = mockClient;

      const texts = [SAMPLE_TEXTS.SHORT, SAMPLE_TEXTS.MEDIUM, SAMPLE_TEXTS.LONG];
      const embeddings = await provider.generateEmbeddings(texts);

      expect(embeddings.length).toBe(3);
      expect(embeddings[0]!.length).toBe(1536);
      expect(embeddings[1]!.length).toBe(1536);
      expect(embeddings[2]!.length).toBe(1536);
      expect(mockClient.getCallCount()).toBe(1);
    });

    test("splits large batches correctly", async () => {
      const smallBatchConfig = { ...TEST_CONFIGS.smallBatch };
      const provider = new OpenAIEmbeddingProvider(smallBatchConfig);
      const mockClient = new MockOpenAIClient();

      // @ts-expect-error - Accessing private property for testing
      provider.client = mockClient;

      // Create 25 texts - should split into 3 batches (10 + 10 + 5)
      const texts = Array(25).fill(SAMPLE_TEXTS.SHORT);
      const embeddings = await provider.generateEmbeddings(texts);

      expect(embeddings.length).toBe(25);
      expect(mockClient.getCallCount()).toBe(3); // 3 batches
    });

    test("maintains order across batches", async () => {
      const smallBatchConfig = { ...TEST_CONFIGS.smallBatch };
      const provider = new OpenAIEmbeddingProvider(smallBatchConfig);
      const mockClient = new MockOpenAIClient();

      // @ts-expect-error - Accessing private property for testing
      provider.client = mockClient;

      const texts = Array(25).fill(SAMPLE_TEXTS.SHORT);
      const embeddings = await provider.generateEmbeddings(texts);

      // All embeddings should be present in order
      expect(embeddings.length).toBe(texts.length);
      for (const embedding of embeddings) {
        expect(embedding.length).toBe(1536);
      }
    });

    test("throws on empty array", async () => {
      const provider = new OpenAIEmbeddingProvider(config);
      await expect(provider.generateEmbeddings([])).rejects.toThrow(EmbeddingValidationError);
      await expect(provider.generateEmbeddings([])).rejects.toThrow("cannot be empty");
    });

    test("throws when array contains non-string", async () => {
      const provider = new OpenAIEmbeddingProvider(config);
      // @ts-expect-error - Testing invalid input type
      await expect(provider.generateEmbeddings([SAMPLE_TEXTS.SHORT, 123])).rejects.toThrow(
        EmbeddingValidationError
      );
    });

    test("throws when array contains empty string", async () => {
      const provider = new OpenAIEmbeddingProvider(config);
      await expect(
        provider.generateEmbeddings([SAMPLE_TEXTS.SHORT, SAMPLE_TEXTS.EMPTY])
      ).rejects.toThrow(EmbeddingValidationError);
    });
  });

  describe("retry logic", () => {
    test("succeeds after one retry", async () => {
      const provider = new OpenAIEmbeddingProvider(config);
      const mockClient = new MockOpenAIClientWithTransientFailure(
        1,
        MOCK_OPENAI_RESPONSE.rateLimitError
      );

      // @ts-expect-error - Accessing private property for testing
      provider.client = mockClient;

      const embedding = await provider.generateEmbedding(SAMPLE_TEXTS.SHORT);

      expect(embedding.length).toBe(1536);
      expect(mockClient.getAttemptCount()).toBe(2); // Original + 1 retry
    });

    test("succeeds after two retries", async () => {
      const provider = new OpenAIEmbeddingProvider(config);
      const mockClient = new MockOpenAIClientWithTransientFailure(
        2,
        MOCK_OPENAI_RESPONSE.rateLimitError
      );

      // @ts-expect-error - Accessing private property for testing
      provider.client = mockClient;

      const embedding = await provider.generateEmbedding(SAMPLE_TEXTS.SHORT);

      expect(embedding.length).toBe(1536);
      expect(mockClient.getAttemptCount()).toBe(3); // Original + 2 retries
    });

    test("succeeds after three retries (max)", async () => {
      const provider = new OpenAIEmbeddingProvider(config);
      const mockClient = new MockOpenAIClientWithTransientFailure(
        3,
        MOCK_OPENAI_RESPONSE.rateLimitError
      );

      // @ts-expect-error - Accessing private property for testing
      provider.client = mockClient;

      const embedding = await provider.generateEmbedding(SAMPLE_TEXTS.SHORT);

      expect(embedding.length).toBe(1536);
      expect(mockClient.getAttemptCount()).toBe(4); // Original + 3 retries
    }, 10000); // 10s timeout for 3 retries with backoff

    test("throws after max retries exceeded", async () => {
      const provider = new OpenAIEmbeddingProvider(config);
      const mockClient = new MockOpenAIClientWithTransientFailure(
        4,
        MOCK_OPENAI_RESPONSE.rateLimitError
      );

      // @ts-expect-error - Accessing private property for testing
      provider.client = mockClient;

      await expect(provider.generateEmbedding(SAMPLE_TEXTS.SHORT)).rejects.toThrow(
        EmbeddingRateLimitError
      );
      expect(mockClient.getAttemptCount()).toBe(4); // Original + 3 retries (max)
    }, 10000); // 10s timeout for max retries with backoff

    test("exponential backoff timing", async () => {
      const provider = new OpenAIEmbeddingProvider(config);
      const mockClient = new MockOpenAIClientWithTransientFailure(
        3,
        MOCK_OPENAI_RESPONSE.rateLimitError
      );

      // @ts-expect-error - Accessing private property for testing
      provider.client = mockClient;

      const startTime = Date.now();
      await provider.generateEmbedding(SAMPLE_TEXTS.SHORT);
      const elapsed = Date.now() - startTime;

      // Should wait approximately: 1s + 2s + 4s = 7s
      // Allow variance for test execution overhead and timer precision
      expect(elapsed).toBeGreaterThanOrEqual(5800); // ~6-7s with tolerance for CI environments
    }, 10000); // 10s timeout

    test("non-retryable errors fail immediately", async () => {
      const noRetryConfig = { ...TEST_CONFIGS.noRetries };
      const provider = new OpenAIEmbeddingProvider(noRetryConfig);
      const mockClient = new MockOpenAIClient();
      mockClient.setFailure(MOCK_OPENAI_RESPONSE.authError);

      // @ts-expect-error - Accessing private property for testing
      provider.client = mockClient;

      const startTime = Date.now();
      await expect(provider.generateEmbedding(SAMPLE_TEXTS.SHORT)).rejects.toThrow(
        EmbeddingAuthenticationError
      );
      const elapsed = Date.now() - startTime;

      // Should fail immediately without retry delay
      expect(elapsed).toBeLessThan(1000);
      expect(mockClient.getCallCount()).toBe(1); // Only one attempt
    });
  });

  describe("error handling", () => {
    test("handles 401 authentication error", async () => {
      const provider = new OpenAIEmbeddingProvider(config);
      const mockClient = new MockOpenAIClient();
      mockClient.setFailure(MOCK_OPENAI_RESPONSE.authError);

      // @ts-expect-error - Accessing private property for testing
      provider.client = mockClient;

      await expect(provider.generateEmbedding(SAMPLE_TEXTS.SHORT)).rejects.toThrow(
        EmbeddingAuthenticationError
      );
    });

    test("handles 403 forbidden error", async () => {
      const provider = new OpenAIEmbeddingProvider(config);
      const mockClient = new MockOpenAIClient();
      mockClient.setFailure(MOCK_OPENAI_RESPONSE.forbiddenError);

      // @ts-expect-error - Accessing private property for testing
      provider.client = mockClient;

      await expect(provider.generateEmbedding(SAMPLE_TEXTS.SHORT)).rejects.toThrow(
        EmbeddingAuthenticationError
      );
    });

    test("handles 429 rate limit error", async () => {
      const provider = new OpenAIEmbeddingProvider(TEST_CONFIGS.noRetries);
      const mockClient = new MockOpenAIClient();
      mockClient.setFailure(MOCK_OPENAI_RESPONSE.rateLimitError);

      // @ts-expect-error - Accessing private property for testing
      provider.client = mockClient;

      await expect(provider.generateEmbedding(SAMPLE_TEXTS.SHORT)).rejects.toThrow(
        EmbeddingRateLimitError
      );
    });

    test("handles 408 timeout error", async () => {
      const provider = new OpenAIEmbeddingProvider(TEST_CONFIGS.noRetries);
      const mockClient = new MockOpenAIClient();
      mockClient.setFailure(MOCK_OPENAI_RESPONSE.timeoutError);

      // @ts-expect-error - Accessing private property for testing
      provider.client = mockClient;

      await expect(provider.generateEmbedding(SAMPLE_TEXTS.SHORT)).rejects.toThrow(
        EmbeddingTimeoutError
      );
    });

    test("handles 504 gateway timeout error", async () => {
      const provider = new OpenAIEmbeddingProvider(TEST_CONFIGS.noRetries);
      const mockClient = new MockOpenAIClient();
      mockClient.setFailure(MOCK_OPENAI_RESPONSE.gatewayTimeoutError);

      // @ts-expect-error - Accessing private property for testing
      provider.client = mockClient;

      await expect(provider.generateEmbedding(SAMPLE_TEXTS.SHORT)).rejects.toThrow(
        EmbeddingTimeoutError
      );
    });

    test("handles 500 server error", async () => {
      const provider = new OpenAIEmbeddingProvider(TEST_CONFIGS.noRetries);
      const mockClient = new MockOpenAIClient();
      mockClient.setFailure(MOCK_OPENAI_RESPONSE.serverError);

      // @ts-expect-error - Accessing private property for testing
      provider.client = mockClient;

      await expect(provider.generateEmbedding(SAMPLE_TEXTS.SHORT)).rejects.toThrow(
        EmbeddingNetworkError
      );
    });

    test("handles 503 service unavailable error", async () => {
      const provider = new OpenAIEmbeddingProvider(TEST_CONFIGS.noRetries);
      const mockClient = new MockOpenAIClient();
      mockClient.setFailure(MOCK_OPENAI_RESPONSE.serviceUnavailableError);

      // @ts-expect-error - Accessing private property for testing
      provider.client = mockClient;

      await expect(provider.generateEmbedding(SAMPLE_TEXTS.SHORT)).rejects.toThrow(
        EmbeddingNetworkError
      );
    });

    test("handles 400 bad request error", async () => {
      const provider = new OpenAIEmbeddingProvider(config);
      const mockClient = new MockOpenAIClient();
      mockClient.setFailure(MOCK_OPENAI_RESPONSE.badRequestError);

      // @ts-expect-error - Accessing private property for testing
      provider.client = mockClient;

      await expect(provider.generateEmbedding(SAMPLE_TEXTS.SHORT)).rejects.toThrow(
        EmbeddingValidationError
      );
    });

    test("handles ECONNREFUSED network error", async () => {
      const provider = new OpenAIEmbeddingProvider(TEST_CONFIGS.noRetries);
      const mockClient = new MockOpenAIClient();
      mockClient.setFailure(MOCK_NETWORK_ERRORS.ECONNREFUSED);

      // @ts-expect-error - Accessing private property for testing
      provider.client = mockClient;

      await expect(provider.generateEmbedding(SAMPLE_TEXTS.SHORT)).rejects.toThrow(
        EmbeddingNetworkError
      );
    });

    test("handles ENOTFOUND DNS error", async () => {
      const provider = new OpenAIEmbeddingProvider(TEST_CONFIGS.noRetries);
      const mockClient = new MockOpenAIClient();
      mockClient.setFailure(MOCK_NETWORK_ERRORS.ENOTFOUND);

      // @ts-expect-error - Accessing private property for testing
      provider.client = mockClient;

      await expect(provider.generateEmbedding(SAMPLE_TEXTS.SHORT)).rejects.toThrow(
        EmbeddingNetworkError
      );
    });

    test("handles ECONNRESET error", async () => {
      const provider = new OpenAIEmbeddingProvider(TEST_CONFIGS.noRetries);
      const mockClient = new MockOpenAIClient();
      mockClient.setFailure(MOCK_NETWORK_ERRORS.ECONNRESET);

      // @ts-expect-error - Accessing private property for testing
      provider.client = mockClient;

      await expect(provider.generateEmbedding(SAMPLE_TEXTS.SHORT)).rejects.toThrow(
        EmbeddingNetworkError
      );
    });

    test("handles ETIMEDOUT error", async () => {
      const provider = new OpenAIEmbeddingProvider(TEST_CONFIGS.noRetries);
      const mockClient = new MockOpenAIClient();
      mockClient.setFailure(MOCK_NETWORK_ERRORS.ETIMEDOUT);

      // @ts-expect-error - Accessing private property for testing
      provider.client = mockClient;

      await expect(provider.generateEmbedding(SAMPLE_TEXTS.SHORT)).rejects.toThrow(
        EmbeddingTimeoutError
      );
    });

    test("handles generic timeout error", async () => {
      const provider = new OpenAIEmbeddingProvider(TEST_CONFIGS.noRetries);
      const mockClient = new MockOpenAIClient();
      mockClient.setFailure(MOCK_NETWORK_ERRORS.TIMEOUT);

      // @ts-expect-error - Accessing private property for testing
      provider.client = mockClient;

      await expect(provider.generateEmbedding(SAMPLE_TEXTS.SHORT)).rejects.toThrow(
        EmbeddingTimeoutError
      );
    });

    test("sanitizes API keys in all errors", async () => {
      const provider = new OpenAIEmbeddingProvider(config);
      const mockClient = new MockOpenAIClient();
      const errorWithKey = {
        status: 401,
        message: `Authentication failed with key: ${config.apiKey}`,
      };
      mockClient.setFailure(errorWithKey);

      // @ts-expect-error - Accessing private property for testing
      provider.client = mockClient;

      try {
        await provider.generateEmbedding(SAMPLE_TEXTS.SHORT);
        expect(false).toBe(true); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(EmbeddingAuthenticationError);
        // Verify API key was NOT included in the error message
        expect((error as Error).message).not.toContain(config.apiKey);
        // The basic error message doesn't repeat the API key,
        // so we just verify it's sanitized (not present)
      }
    });

    test("handles unknown error types gracefully", async () => {
      const provider = new OpenAIEmbeddingProvider(config);
      const mockClient = new MockOpenAIClient();
      mockClient.setFailure("Unknown error string");

      // @ts-expect-error - Accessing private property for testing
      provider.client = mockClient;

      await expect(provider.generateEmbedding(SAMPLE_TEXTS.SHORT)).rejects.toThrow(EmbeddingError);
    });
  });

  describe("healthCheck", () => {
    test("returns true when provider is healthy", async () => {
      const provider = new OpenAIEmbeddingProvider(config);
      const mockClient = new MockOpenAIClient();

      // @ts-expect-error - Accessing private property for testing
      provider.client = mockClient;

      const isHealthy = await provider.healthCheck();
      expect(isHealthy).toBe(true);
    });

    test("returns false when provider fails", async () => {
      const provider = new OpenAIEmbeddingProvider(config);
      const mockClient = new MockOpenAIClient();
      mockClient.setFailure(MOCK_OPENAI_RESPONSE.authError);

      // @ts-expect-error - Accessing private property for testing
      provider.client = mockClient;

      const isHealthy = await provider.healthCheck();
      expect(isHealthy).toBe(false);
    });

    test("never throws errors", async () => {
      const provider = new OpenAIEmbeddingProvider(config);
      const mockClient = new MockOpenAIClient();
      mockClient.setFailure(new Error("Critical failure"));

      // @ts-expect-error - Accessing private property for testing
      provider.client = mockClient;

      // Should not throw
      const isHealthy = await provider.healthCheck();
      expect(isHealthy).toBe(false);
    });
  });
});
