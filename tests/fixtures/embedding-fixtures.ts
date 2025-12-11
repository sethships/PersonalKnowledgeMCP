/**
 * Test fixtures for embedding provider tests
 *
 * Provides sample data, mock responses, and helper functions for testing
 * embedding providers without making real API calls.
 */

/**
 * Sample texts for testing various input scenarios
 */
export const SAMPLE_TEXTS = {
  /** Short text for basic testing */
  SHORT: "Hello world",

  /** Medium-length text for typical use cases */
  MEDIUM: "This is a medium-length text for testing embedding generation with realistic content.",

  /** Long text for batch processing tests */
  LONG: "A".repeat(1000),

  /** Empty string for validation testing */
  EMPTY: "",

  /** Whitespace-only for validation testing */
  WHITESPACE: "   \t\n  ",
};

/**
 * Create a mock embedding vector with deterministic values
 *
 * Generates a 1536-dimension embedding vector (matching text-embedding-3-small)
 * with values derived from a seed for reproducibility.
 *
 * @param seed - Seed value for generating consistent embeddings
 * @returns 1536-dimension embedding vector
 */
export function createMockEmbedding(seed: number = 0): number[] {
  const embedding: number[] = new Array<number>(1536);
  for (let i = 0; i < 1536; i++) {
    // Use sine function with seed to create normalized values
    embedding[i] = Math.sin(seed + i / 100) * 0.5;
  }
  return embedding;
}

/**
 * Create multiple mock embeddings for batch testing
 *
 * @param count - Number of embeddings to create
 * @returns Array of embedding vectors
 */
export function createMockEmbeddings(count: number): number[][] {
  return Array.from({ length: count }, (_, i) => createMockEmbedding(i));
}

/**
 * Mock OpenAI API responses for testing
 */
export const MOCK_OPENAI_RESPONSE = {
  /**
   * Successful embedding response
   *
   * @param count - Number of embeddings to include in response
   * @returns Mock OpenAI API response
   */
  success: (count: number) => ({
    object: "list" as const,
    data: Array.from({ length: count }, (_, i) => ({
      object: "embedding" as const,
      index: i,
      embedding: createMockEmbedding(i),
    })),
    model: "text-embedding-3-small",
    usage: {
      prompt_tokens: count * 10,
      total_tokens: count * 10,
    },
  }),

  /**
   * Rate limit error (429)
   */
  rateLimitError: {
    status: 429,
    message: "Rate limit exceeded",
    response: {
      headers: {
        "retry-after": "2", // 2 seconds
      },
    },
  },

  /**
   * Authentication error (401)
   */
  authError: {
    status: 401,
    message: "Invalid API key",
  },

  /**
   * Forbidden error (403)
   */
  forbiddenError: {
    status: 403,
    message: "Insufficient permissions",
  },

  /**
   * Timeout error (408)
   */
  timeoutError: {
    status: 408,
    message: "Request timeout",
  },

  /**
   * Gateway timeout error (504)
   */
  gatewayTimeoutError: {
    status: 504,
    message: "Gateway timeout",
  },

  /**
   * Server error (500)
   */
  serverError: {
    status: 500,
    message: "Internal server error",
  },

  /**
   * Service unavailable error (503)
   */
  serviceUnavailableError: {
    status: 503,
    message: "Service temporarily unavailable",
  },

  /**
   * Bad request error (400)
   */
  badRequestError: {
    status: 400,
    message: "Invalid request parameters",
  },
};

/**
 * Mock network errors for testing connectivity issues
 */
export const MOCK_NETWORK_ERRORS = {
  /**
   * Connection refused error
   */
  ECONNREFUSED: new Error("connect ECONNREFUSED 127.0.0.1:443"),

  /**
   * DNS lookup failure
   */
  ENOTFOUND: new Error("getaddrinfo ENOTFOUND api.openai.com"),

  /**
   * Connection reset error
   */
  ECONNRESET: new Error("socket hang up ECONNRESET"),

  /**
   * Timeout error
   */
  ETIMEDOUT: new Error("connect ETIMEDOUT"),

  /**
   * Generic timeout
   */
  TIMEOUT: new Error("Request timeout"),
};

/**
 * Test configurations for different scenarios
 */
export const TEST_CONFIGS = {
  /**
   * Valid default configuration
   */
  default: {
    provider: "openai",
    model: "text-embedding-3-small",
    dimensions: 1536,
    batchSize: 100,
    maxRetries: 3,
    timeoutMs: 30000,
    apiKey: "sk-test1234567890abcdefghijklmnop",
  },

  /**
   * Configuration with small batch size for testing splitting
   */
  smallBatch: {
    provider: "openai",
    model: "text-embedding-3-small",
    dimensions: 1536,
    batchSize: 10,
    maxRetries: 3,
    timeoutMs: 30000,
    apiKey: "sk-test1234567890abcdefghijklmnop",
  },

  /**
   * Configuration with zero retries for testing immediate failures
   */
  noRetries: {
    provider: "openai",
    model: "text-embedding-3-small",
    dimensions: 1536,
    batchSize: 100,
    maxRetries: 0,
    timeoutMs: 30000,
    apiKey: "sk-test1234567890abcdefghijklmnop",
  },
};
