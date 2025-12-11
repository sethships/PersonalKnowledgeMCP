/**
 * Unit tests for embedding provider error classes
 *
 * Tests error hierarchy, retryability flags, cause chaining, and API key sanitization.
 */

import { describe, test, expect } from "bun:test";
import {
  EmbeddingError,
  EmbeddingAuthenticationError,
  EmbeddingRateLimitError,
  EmbeddingNetworkError,
  EmbeddingTimeoutError,
  EmbeddingValidationError,
} from "../../../src/providers/errors.js";

describe("EmbeddingError", () => {
  test("creates error with code and message", () => {
    const error = new EmbeddingError("Test error", "TEST_CODE");
    expect(error.message).toBe("Test error");
    expect(error.code).toBe("TEST_CODE");
    expect(error.name).toBe("EmbeddingError");
    expect(error.retryable).toBe(false);
  });

  test("sets retryable flag when provided", () => {
    const error = new EmbeddingError("Test", "TEST", true);
    expect(error.retryable).toBe(true);
  });

  test("defaults to non-retryable", () => {
    const error = new EmbeddingError("Test", "TEST");
    expect(error.retryable).toBe(false);
  });

  test("captures cause chain", () => {
    const cause = new Error("Root cause");
    const error = new EmbeddingError("Wrapper", "TEST", false, cause);
    expect(error.cause).toBe(cause);
    expect(error.stack).toContain("Caused by:");
    expect(error.stack).toContain("Root cause");
  });

  test("works without cause", () => {
    const error = new EmbeddingError("No cause", "TEST");
    expect(error.cause).toBeUndefined();
    expect(error.stack).toBeDefined();
  });

  test("sanitizes API keys in message (sk- format)", () => {
    const error = new EmbeddingError("Failed with key: sk-1234567890abcdefghijklmnop", "TEST");
    expect(error.message).not.toContain("sk-1234567890");
    expect(error.message).toContain("sk-***REDACTED***");
  });

  test("sanitizes long alphanumeric strings", () => {
    const longToken = "a".repeat(50);
    const error = new EmbeddingError(`Token: ${longToken}`, "TEST");
    expect(error.message).not.toContain(longToken);
    expect(error.message).toContain("***REDACTED***");
  });

  test("preserves stack trace", () => {
    const error = new EmbeddingError("Test", "TEST");
    expect(error.stack).toBeDefined();
    expect(error.stack).toContain("EmbeddingError");
  });
});

describe("EmbeddingAuthenticationError", () => {
  test("is not retryable", () => {
    const error = new EmbeddingAuthenticationError("Invalid key");
    expect(error.retryable).toBe(false);
  });

  test("has correct error code", () => {
    const error = new EmbeddingAuthenticationError("Invalid key");
    expect(error.code).toBe("AUTHENTICATION_ERROR");
  });

  test("has correct name", () => {
    const error = new EmbeddingAuthenticationError("Invalid key");
    expect(error.name).toBe("EmbeddingAuthenticationError");
  });

  test("sanitizes API keys from message", () => {
    const error = new EmbeddingAuthenticationError(
      "Failed with key: sk-proj-1234567890abcdefghijklmnopqrstuvwxyz"
    );
    expect(error.message).not.toContain("sk-proj-12345");
    expect(error.message).toContain("sk-***REDACTED***");
  });

  test("accepts and chains cause", () => {
    const cause = new Error("Network failure");
    const error = new EmbeddingAuthenticationError("Auth failed", cause);
    expect(error.cause).toBe(cause);
    expect(error.stack).toContain("Caused by:");
  });
});

describe("EmbeddingRateLimitError", () => {
  test("is retryable", () => {
    const error = new EmbeddingRateLimitError("Rate limited");
    expect(error.retryable).toBe(true);
  });

  test("has correct error code", () => {
    const error = new EmbeddingRateLimitError("Rate limited");
    expect(error.code).toBe("RATE_LIMIT_ERROR");
  });

  test("has correct name", () => {
    const error = new EmbeddingRateLimitError("Rate limited");
    expect(error.name).toBe("EmbeddingRateLimitError");
  });

  test("stores retry-after value when provided", () => {
    const error = new EmbeddingRateLimitError("Rate limited", 5000);
    expect(error.retryAfterMs).toBe(5000);
  });

  test("allows undefined retry-after value", () => {
    const error = new EmbeddingRateLimitError("Rate limited");
    expect(error.retryAfterMs).toBeUndefined();
  });

  test("accepts and chains cause", () => {
    const cause = new Error("HTTP 429");
    const error = new EmbeddingRateLimitError("Rate limited", 1000, cause);
    expect(error.cause).toBe(cause);
  });
});

describe("EmbeddingNetworkError", () => {
  test("is retryable", () => {
    const error = new EmbeddingNetworkError("Connection failed");
    expect(error.retryable).toBe(true);
  });

  test("has correct error code", () => {
    const error = new EmbeddingNetworkError("Connection failed");
    expect(error.code).toBe("NETWORK_ERROR");
  });

  test("has correct name", () => {
    const error = new EmbeddingNetworkError("Connection failed");
    expect(error.name).toBe("EmbeddingNetworkError");
  });

  test("accepts and chains cause", () => {
    const cause = new Error("ECONNREFUSED");
    const error = new EmbeddingNetworkError("Network error", cause);
    expect(error.cause).toBe(cause);
    expect(error.stack).toContain("Caused by:");
  });
});

describe("EmbeddingTimeoutError", () => {
  test("is retryable", () => {
    const error = new EmbeddingTimeoutError("Request timed out");
    expect(error.retryable).toBe(true);
  });

  test("has correct error code", () => {
    const error = new EmbeddingTimeoutError("Request timed out");
    expect(error.code).toBe("TIMEOUT_ERROR");
  });

  test("has correct name", () => {
    const error = new EmbeddingTimeoutError("Request timed out");
    expect(error.name).toBe("EmbeddingTimeoutError");
  });

  test("accepts and chains cause", () => {
    const cause = new Error("Socket timeout");
    const error = new EmbeddingTimeoutError("Timeout", cause);
    expect(error.cause).toBe(cause);
  });
});

describe("EmbeddingValidationError", () => {
  test("is not retryable", () => {
    const error = new EmbeddingValidationError("Invalid input");
    expect(error.retryable).toBe(false);
  });

  test("has correct error code", () => {
    const error = new EmbeddingValidationError("Invalid input");
    expect(error.code).toBe("VALIDATION_ERROR");
  });

  test("has correct name", () => {
    const error = new EmbeddingValidationError("Invalid input");
    expect(error.name).toBe("EmbeddingValidationError");
  });

  test("stores parameter name when provided", () => {
    const error = new EmbeddingValidationError("Invalid text", "text");
    expect(error.parameterName).toBe("text");
  });

  test("allows undefined parameter name", () => {
    const error = new EmbeddingValidationError("Invalid input");
    expect(error.parameterName).toBeUndefined();
  });

  test("accepts and chains cause", () => {
    const cause = new TypeError("Expected string");
    const error = new EmbeddingValidationError("Validation failed", "text", cause);
    expect(error.cause).toBe(cause);
  });
});

describe("Error hierarchy", () => {
  test("all custom errors extend EmbeddingError", () => {
    const authError = new EmbeddingAuthenticationError("test");
    const rateLimitError = new EmbeddingRateLimitError("test");
    const networkError = new EmbeddingNetworkError("test");
    const timeoutError = new EmbeddingTimeoutError("test");
    const validationError = new EmbeddingValidationError("test");

    expect(authError).toBeInstanceOf(EmbeddingError);
    expect(rateLimitError).toBeInstanceOf(EmbeddingError);
    expect(networkError).toBeInstanceOf(EmbeddingError);
    expect(timeoutError).toBeInstanceOf(EmbeddingError);
    expect(validationError).toBeInstanceOf(EmbeddingError);
  });

  test("all custom errors extend Error", () => {
    const authError = new EmbeddingAuthenticationError("test");
    const rateLimitError = new EmbeddingRateLimitError("test");
    const networkError = new EmbeddingNetworkError("test");
    const timeoutError = new EmbeddingTimeoutError("test");
    const validationError = new EmbeddingValidationError("test");

    expect(authError).toBeInstanceOf(Error);
    expect(rateLimitError).toBeInstanceOf(Error);
    expect(networkError).toBeInstanceOf(Error);
    expect(timeoutError).toBeInstanceOf(Error);
    expect(validationError).toBeInstanceOf(Error);
  });
});

describe("Retryability classification", () => {
  test("non-retryable errors return false", () => {
    const authError = new EmbeddingAuthenticationError("test");
    const validationError = new EmbeddingValidationError("test");

    expect(authError.retryable).toBe(false);
    expect(validationError.retryable).toBe(false);
  });

  test("retryable errors return true", () => {
    const rateLimitError = new EmbeddingRateLimitError("test");
    const networkError = new EmbeddingNetworkError("test");
    const timeoutError = new EmbeddingTimeoutError("test");

    expect(rateLimitError.retryable).toBe(true);
    expect(networkError.retryable).toBe(true);
    expect(timeoutError.retryable).toBe(true);
  });
});
