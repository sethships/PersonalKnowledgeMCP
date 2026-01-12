/**
 * Test fixtures for Transformers.js embedding provider tests
 *
 * Provides sample data, mock responses, and helper functions for testing
 * the TransformersJsEmbeddingProvider without downloading actual models.
 */

import type { TransformersJsProviderConfig } from "../../src/providers/transformersjs-embedding.js";

/**
 * Create a mock embedding vector with deterministic values for 384-dimension models
 *
 * Generates a 384-dimension embedding vector (matching all-MiniLM-L6-v2)
 * with values derived from a seed for reproducibility.
 *
 * @param seed - Seed value for generating consistent embeddings
 * @returns 384-dimension embedding vector as Float32Array
 */
export function createMockTransformersEmbedding(seed: number = 0): Float32Array {
  const embedding = new Float32Array(384);
  for (let i = 0; i < 384; i++) {
    // Use sine function with seed to create normalized values
    embedding[i] = Math.sin(seed + i / 100) * 0.5;
  }
  return embedding;
}

/**
 * Create multiple mock embeddings for batch testing
 *
 * @param count - Number of embeddings to create
 * @returns Array of Float32Array embeddings
 */
export function createMockTransformersEmbeddings(count: number): Float32Array[] {
  return Array.from({ length: count }, (_, i) => createMockTransformersEmbedding(i));
}

/**
 * Mock pipeline response structure matching Transformers.js output
 */
export interface MockPipelineOutput {
  data: Float32Array;
  dims: number[];
}

/**
 * Create a mock pipeline output for testing
 *
 * @param seed - Seed for generating consistent embeddings
 * @returns Mock output matching Transformers.js pipeline format
 */
export function createMockPipelineOutput(seed: number = 0): MockPipelineOutput {
  return {
    data: createMockTransformersEmbedding(seed),
    dims: [1, 384],
  };
}

/**
 * Mock Transformers.js pipeline function for testing
 *
 * Returns a function that behaves like the Transformers.js pipeline,
 * but returns mock embeddings instead of running actual inference.
 */
export class MockTransformersPipeline {
  private callCount = 0;
  private shouldFail = false;
  private failureError: Error | null = null;

  /**
   * Simulate pipeline call
   *
   * @param text - Input text (or texts)
   * @param options - Pipeline options
   * @returns Mock pipeline output
   */
  async call(
    text: string | string[],
    _options?: { pooling?: string; normalize?: boolean }
  ): Promise<MockPipelineOutput> {
    this.callCount++;

    if (this.shouldFail && this.failureError) {
      throw this.failureError;
    }

    // Use text length as seed for reproducibility
    const seed = typeof text === "string" ? text.length : text[0]?.length || 0;
    return createMockPipelineOutput(seed);
  }

  /**
   * Get number of times the pipeline was called
   */
  getCallCount(): number {
    return this.callCount;
  }

  /**
   * Reset call count
   */
  resetCallCount(): void {
    this.callCount = 0;
  }

  /**
   * Configure the mock to fail with a specific error
   *
   * @param error - Error to throw on next call
   */
  setFailure(error: Error): void {
    this.shouldFail = true;
    this.failureError = error;
  }

  /**
   * Clear any configured failure
   */
  clearFailure(): void {
    this.shouldFail = false;
    this.failureError = null;
  }
}

/**
 * Test configurations for Transformers.js provider
 */
export const TRANSFORMERS_TEST_CONFIGS = {
  /**
   * Valid default configuration for all-MiniLM-L6-v2
   */
  default: {
    provider: "transformersjs",
    model: "Xenova/all-MiniLM-L6-v2",
    dimensions: 384,
    batchSize: 32,
    maxRetries: 0,
    timeoutMs: 60000,
    modelPath: "Xenova/all-MiniLM-L6-v2",
  } as TransformersJsProviderConfig,

  /**
   * Configuration with quantized model
   */
  quantized: {
    provider: "transformersjs",
    model: "Xenova/all-MiniLM-L6-v2",
    dimensions: 384,
    batchSize: 32,
    maxRetries: 0,
    timeoutMs: 60000,
    modelPath: "Xenova/all-MiniLM-L6-v2",
    quantized: true,
  } as TransformersJsProviderConfig,

  /**
   * Configuration for bge-small model (768 dimensions)
   */
  bgeSmall: {
    provider: "transformersjs",
    model: "Xenova/bge-small-en-v1.5",
    dimensions: 768,
    batchSize: 32,
    maxRetries: 0,
    timeoutMs: 60000,
    modelPath: "Xenova/bge-small-en-v1.5",
  } as TransformersJsProviderConfig,

  /**
   * Configuration with custom cache directory
   */
  customCache: {
    provider: "transformersjs",
    model: "Xenova/all-MiniLM-L6-v2",
    dimensions: 384,
    batchSize: 32,
    maxRetries: 0,
    timeoutMs: 60000,
    modelPath: "Xenova/all-MiniLM-L6-v2",
    cacheDir: "/tmp/transformers-cache",
  } as TransformersJsProviderConfig,
};

/**
 * Mock error scenarios for testing
 */
export const MOCK_TRANSFORMERS_ERRORS = {
  /**
   * Model not found error
   */
  modelNotFound: new Error("Error: 404 - Model not found: InvalidModel/does-not-exist"),

  /**
   * Network error during model download
   */
  networkError: new Error("TypeError: fetch failed: ECONNREFUSED"),

  /**
   * Out of memory error during inference
   */
  outOfMemory: new Error("RuntimeError: Out of memory"),

  /**
   * Invalid model format error
   */
  invalidFormat: new Error("Error: Invalid model format"),

  /**
   * Initialization timeout
   */
  initTimeout: new Error("Timeout: Model initialization exceeded 60000ms"),
};
