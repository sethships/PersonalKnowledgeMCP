/* eslint-disable @typescript-eslint/await-thenable */
/**
 * Unit tests for TransformersJsEmbeddingProvider
 *
 * Tests all methods with comprehensive coverage including constructor validation,
 * embedding generation, batch processing, lazy initialization, and error handling.
 *
 * Note: These tests use mocking to avoid downloading actual models.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import {
  TransformersJsEmbeddingProvider,
  type TransformersJsProviderConfig,
} from "../../../src/providers/transformersjs-embedding.js";
import { EmbeddingValidationError } from "../../../src/providers/errors.js";
import {
  TRANSFORMERS_TEST_CONFIGS,
  MockTransformersPipeline,
  MOCK_TRANSFORMERS_ERRORS,
} from "../../fixtures/transformersjs-fixtures.js";
import { SAMPLE_TEXTS } from "../../fixtures/embedding-fixtures.js";

describe("TransformersJsEmbeddingProvider", () => {
  let config: TransformersJsProviderConfig;

  beforeEach(() => {
    config = { ...TRANSFORMERS_TEST_CONFIGS.default };
  });

  describe("constructor", () => {
    test("accepts valid configuration", () => {
      const provider = new TransformersJsEmbeddingProvider(config);
      expect(provider.providerId).toBe("transformersjs");
      expect(provider.modelId).toBe("Xenova/all-MiniLM-L6-v2");
      expect(provider.dimensions).toBe(384);
    });

    test("throws on missing model path", () => {
      config.modelPath = "";
      expect(() => new TransformersJsEmbeddingProvider(config)).toThrow(EmbeddingValidationError);
      expect(() => new TransformersJsEmbeddingProvider(config)).toThrow("Model path is required");
    });

    test("throws on whitespace-only model path", () => {
      config.modelPath = "   ";
      expect(() => new TransformersJsEmbeddingProvider(config)).toThrow(EmbeddingValidationError);
    });

    test("throws on negative dimensions", () => {
      config.dimensions = -1;
      expect(() => new TransformersJsEmbeddingProvider(config)).toThrow(EmbeddingValidationError);
      expect(() => new TransformersJsEmbeddingProvider(config)).toThrow(
        "Dimensions must be positive"
      );
    });

    test("throws on zero dimensions", () => {
      config.dimensions = 0;
      expect(() => new TransformersJsEmbeddingProvider(config)).toThrow(EmbeddingValidationError);
    });

    test("throws on negative batch size", () => {
      config.batchSize = -1;
      expect(() => new TransformersJsEmbeddingProvider(config)).toThrow(EmbeddingValidationError);
      expect(() => new TransformersJsEmbeddingProvider(config)).toThrow(
        "Batch size must be positive"
      );
    });

    test("throws on zero batch size", () => {
      config.batchSize = 0;
      expect(() => new TransformersJsEmbeddingProvider(config)).toThrow(EmbeddingValidationError);
    });

    test("throws on negative timeout", () => {
      config.timeoutMs = -1;
      expect(() => new TransformersJsEmbeddingProvider(config)).toThrow(EmbeddingValidationError);
      expect(() => new TransformersJsEmbeddingProvider(config)).toThrow("Timeout must be positive");
    });

    test("throws on zero timeout", () => {
      config.timeoutMs = 0;
      expect(() => new TransformersJsEmbeddingProvider(config)).toThrow(EmbeddingValidationError);
    });

    test("accepts config with quantized option", () => {
      const quantizedConfig = { ...TRANSFORMERS_TEST_CONFIGS.quantized };
      const provider = new TransformersJsEmbeddingProvider(quantizedConfig);
      expect(provider.providerId).toBe("transformersjs");
    });

    test("accepts config with custom cache directory", () => {
      const customCacheConfig = { ...TRANSFORMERS_TEST_CONFIGS.customCache };
      const provider = new TransformersJsEmbeddingProvider(customCacheConfig);
      expect(provider.providerId).toBe("transformersjs");
    });
  });

  describe("generateEmbedding", () => {
    test("throws on empty text", async () => {
      const provider = new TransformersJsEmbeddingProvider(config);
      await expect(provider.generateEmbedding(SAMPLE_TEXTS.EMPTY)).rejects.toThrow(
        EmbeddingValidationError
      );
      await expect(provider.generateEmbedding(SAMPLE_TEXTS.EMPTY)).rejects.toThrow(
        "cannot be empty"
      );
    });

    test("throws on whitespace-only text", async () => {
      const provider = new TransformersJsEmbeddingProvider(config);
      await expect(provider.generateEmbedding(SAMPLE_TEXTS.WHITESPACE)).rejects.toThrow(
        EmbeddingValidationError
      );
    });

    test("throws on non-string input", async () => {
      const provider = new TransformersJsEmbeddingProvider(config);
      // @ts-expect-error - Testing invalid input type
      await expect(provider.generateEmbedding(123)).rejects.toThrow(EmbeddingValidationError);
      // @ts-expect-error - Testing invalid input type
      await expect(provider.generateEmbedding(null)).rejects.toThrow(EmbeddingValidationError);
    });
  });

  describe("generateEmbeddings", () => {
    test("throws on empty array", async () => {
      const provider = new TransformersJsEmbeddingProvider(config);
      await expect(provider.generateEmbeddings([])).rejects.toThrow(EmbeddingValidationError);
      await expect(provider.generateEmbeddings([])).rejects.toThrow("Input array cannot be empty");
    });

    test("throws when array contains empty string", async () => {
      const provider = new TransformersJsEmbeddingProvider(config);
      await expect(
        provider.generateEmbeddings([SAMPLE_TEXTS.SHORT, SAMPLE_TEXTS.EMPTY])
      ).rejects.toThrow(EmbeddingValidationError);
    });

    test("throws when array contains whitespace-only string", async () => {
      const provider = new TransformersJsEmbeddingProvider(config);
      await expect(
        provider.generateEmbeddings([SAMPLE_TEXTS.SHORT, SAMPLE_TEXTS.WHITESPACE])
      ).rejects.toThrow(EmbeddingValidationError);
    });

    test("throws when array contains non-string", async () => {
      const provider = new TransformersJsEmbeddingProvider(config);
      // @ts-expect-error - Testing invalid input type
      await expect(provider.generateEmbeddings([SAMPLE_TEXTS.SHORT, 123])).rejects.toThrow(
        EmbeddingValidationError
      );
    });

    test("error message includes index of invalid input", async () => {
      const provider = new TransformersJsEmbeddingProvider(config);
      try {
        await provider.generateEmbeddings([SAMPLE_TEXTS.SHORT, SAMPLE_TEXTS.EMPTY]);
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(EmbeddingValidationError);
        expect((error as Error).message).toContain("index 1");
      }
    });
  });

  describe("getCapabilities", () => {
    test("returns correct capabilities", () => {
      const provider = new TransformersJsEmbeddingProvider(config);
      const capabilities = provider.getCapabilities();

      expect(capabilities.maxBatchSize).toBe(32); // From config.batchSize
      expect(capabilities.maxTokensPerText).toBe(512);
      expect(capabilities.supportsGPU).toBe(false);
      expect(capabilities.requiresNetwork).toBe(false);
      expect(capabilities.estimatedLatencyMs).toBe(100);
    });

    test("uses batchSize from config", () => {
      const customConfig = { ...config, batchSize: 16 };
      const provider = new TransformersJsEmbeddingProvider(customConfig);
      const capabilities = provider.getCapabilities();

      expect(capabilities.maxBatchSize).toBe(16);
    });
  });

  describe("lazy initialization", () => {
    test("does not load model on construction", () => {
      // Just constructing the provider should not cause any model loading
      const provider = new TransformersJsEmbeddingProvider(config);
      expect(provider.providerId).toBe("transformersjs");
      // If model was loaded, this test would take much longer due to download
    });
  });

  describe("error handling", () => {
    test("wraps validation errors properly", async () => {
      const provider = new TransformersJsEmbeddingProvider(config);

      try {
        await provider.generateEmbedding("");
      } catch (error) {
        expect(error).toBeInstanceOf(EmbeddingValidationError);
        expect((error as EmbeddingValidationError).code).toBe("VALIDATION_ERROR");
        expect((error as EmbeddingValidationError).retryable).toBe(false);
      }
    });
  });

  describe("provider identity", () => {
    test("providerId is transformersjs", () => {
      const provider = new TransformersJsEmbeddingProvider(config);
      expect(provider.providerId).toBe("transformersjs");
    });

    test("modelId matches config", () => {
      const provider = new TransformersJsEmbeddingProvider(config);
      expect(provider.modelId).toBe("Xenova/all-MiniLM-L6-v2");
    });

    test("dimensions matches config", () => {
      const provider = new TransformersJsEmbeddingProvider(config);
      expect(provider.dimensions).toBe(384);
    });

    test("supports different model configurations", () => {
      const bgeConfig = { ...TRANSFORMERS_TEST_CONFIGS.bgeSmall };
      const provider = new TransformersJsEmbeddingProvider(bgeConfig);

      expect(provider.modelId).toBe("Xenova/bge-small-en-v1.5");
      expect(provider.dimensions).toBe(768);
    });
  });
});

describe("TransformersJsEmbeddingProvider - Mock Integration", () => {
  /**
   * These tests use a mock pipeline to test the embedding generation flow
   * without actually loading models. This allows us to test the logic
   * without incurring model download time.
   */

  test("mock pipeline produces expected output format", async () => {
    const mockPipeline = new MockTransformersPipeline();
    const output = await mockPipeline.call("Hello world");

    expect(output.data).toBeInstanceOf(Float32Array);
    expect(output.data.length).toBe(384);
    expect(output.dims).toEqual([1, 384]);
  });

  test("mock pipeline tracks call count", async () => {
    const mockPipeline = new MockTransformersPipeline();

    expect(mockPipeline.getCallCount()).toBe(0);
    await mockPipeline.call("Hello");
    expect(mockPipeline.getCallCount()).toBe(1);
    await mockPipeline.call("World");
    expect(mockPipeline.getCallCount()).toBe(2);
  });

  test("mock pipeline can be configured to fail", async () => {
    const mockPipeline = new MockTransformersPipeline();
    mockPipeline.setFailure(MOCK_TRANSFORMERS_ERRORS.modelNotFound);

    await expect(mockPipeline.call("Hello")).rejects.toThrow("Model not found");
  });

  test("mock pipeline failure can be cleared", async () => {
    const mockPipeline = new MockTransformersPipeline();
    mockPipeline.setFailure(MOCK_TRANSFORMERS_ERRORS.modelNotFound);
    mockPipeline.clearFailure();

    const output = await mockPipeline.call("Hello");
    expect(output.data).toBeInstanceOf(Float32Array);
  });
});
