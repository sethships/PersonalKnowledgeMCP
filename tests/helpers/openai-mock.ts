/**
 * Mock OpenAI client for testing embedding provider
 *
 * Provides a test double that simulates the OpenAI SDK's behavior
 * without making real API calls.
 */

import { MOCK_OPENAI_RESPONSE } from "../fixtures/embedding-fixtures.js";

/**
 * Mock OpenAI client for testing
 *
 * Simulates the OpenAI SDK embeddings.create() method with configurable
 * success/failure responses.
 *
 * @example
 * ```typescript
 * const provider = new OpenAIEmbeddingProvider(config);
 * const mockClient = new MockOpenAIClient();
 *
 * // Replace internal client
 * // @ts-expect-error - Accessing private property for testing
 * provider.client = mockClient;
 *
 * // Configure mock behavior
 * mockClient.setFailure(MOCK_OPENAI_RESPONSE.rateLimitError);
 *
 * // Test with mocked behavior
 * await expect(provider.generateEmbedding("test")).rejects.toThrow();
 * ```
 */
export class MockOpenAIClient {
  private callCount = 0;
  private shouldFail = false;
  private failureError?: unknown;
  private successDelay = 0;

  /**
   * Mock embeddings API
   */
  embeddings = {
    /**
     * Create embeddings (mocked)
     *
     * @param params - Request parameters
     * @returns Mock response or throws error
     */
    create: async (params: { model: string; input: string | string[]; dimensions?: number }) => {
      this.callCount++;

      // Simulate network delay if configured
      if (this.successDelay > 0) {
        await this.sleep(this.successDelay);
      }

      // If configured to fail, throw the error
      if (this.shouldFail && this.failureError) {
        throw this.failureError;
      }

      // Return success response
      const inputArray = Array.isArray(params.input) ? params.input : [params.input];
      return MOCK_OPENAI_RESPONSE.success(inputArray.length);
    },
  };

  /**
   * Configure mock to fail with specific error
   *
   * @param error - Error to throw on next call
   */
  setFailure(error: unknown): void {
    this.shouldFail = true;
    this.failureError = error;
  }

  /**
   * Clear failure configuration (return to success mode)
   */
  clearFailure(): void {
    this.shouldFail = false;
    this.failureError = undefined;
  }

  /**
   * Set delay for successful responses (to test retry timing)
   *
   * @param delayMs - Delay in milliseconds
   */
  setSuccessDelay(delayMs: number): void {
    this.successDelay = delayMs;
  }

  /**
   * Get number of times embeddings.create() was called
   *
   * @returns Call count
   */
  getCallCount(): number {
    return this.callCount;
  }

  /**
   * Reset call count to zero
   */
  resetCallCount(): void {
    this.callCount = 0;
  }

  /**
   * Reset all mock state
   */
  reset(): void {
    this.callCount = 0;
    this.shouldFail = false;
    this.failureError = undefined;
    this.successDelay = 0;
  }

  /**
   * Helper to sleep for testing timing
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Mock OpenAI client that fails once then succeeds
 *
 * Useful for testing retry logic where the operation succeeds after a failure.
 */
export class MockOpenAIClientWithTransientFailure {
  private attemptCount = 0;
  private readonly failuresBeforeSuccess: number;
  private readonly failureError: unknown;
  private callCount = 0;

  /**
   * Create mock that fails N times before succeeding
   *
   * @param failuresBeforeSuccess - Number of failures before success (default: 1)
   * @param error - Error to throw for failures
   */
  constructor(
    failuresBeforeSuccess: number = 1,
    error: unknown = MOCK_OPENAI_RESPONSE.rateLimitError
  ) {
    this.failuresBeforeSuccess = failuresBeforeSuccess;
    this.failureError = error;
  }

  /**
   * Mock embeddings API
   */
  embeddings = {
    /**
     * Create embeddings that fail N times then succeed
     */
    create: async (params: { model: string; input: string | string[]; dimensions?: number }) => {
      this.callCount++;
      this.attemptCount++;

      if (this.attemptCount <= this.failuresBeforeSuccess) {
        // Fail for the first N attempts
        throw this.failureError;
      } else {
        // Succeed after N failures
        const inputArray = Array.isArray(params.input) ? params.input : [params.input];
        return MOCK_OPENAI_RESPONSE.success(inputArray.length);
      }
    },
  };

  /**
   * Get number of attempts made
   */
  getAttemptCount(): number {
    return this.attemptCount;
  }

  /**
   * Get number of calls made
   */
  getCallCount(): number {
    return this.callCount;
  }

  /**
   * Reset attempt count
   */
  reset(): void {
    this.attemptCount = 0;
    this.callCount = 0;
  }
}
