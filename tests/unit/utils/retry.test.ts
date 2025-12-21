/**
 * Unit tests for retry utility
 *
 * Tests exponential backoff, conditional retry, backoff calculation, and retry callbacks.
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/await-thenable */
/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import {
  withRetry,
  defaultExponentialBackoff,
  createRetryConfigFromEnv,
  createExponentialBackoff,
  createRetryLogger,
  createRetryOptions,
  DEFAULT_RETRY_CONFIG,
  type RetryOptions,
  type RetryConfig,
} from "../../../src/utils/retry.js";

describe("defaultExponentialBackoff", () => {
  test("calculates correct delay for attempt 0 (first retry)", () => {
    expect(defaultExponentialBackoff(0)).toBe(1000); // 2^0 * 1000 = 1 second
  });

  test("calculates correct delay for attempt 1 (second retry)", () => {
    expect(defaultExponentialBackoff(1)).toBe(2000); // 2^1 * 1000 = 2 seconds
  });

  test("calculates correct delay for attempt 2 (third retry)", () => {
    expect(defaultExponentialBackoff(2)).toBe(4000); // 2^2 * 1000 = 4 seconds
  });

  test("calculates correct delay for attempt 3 (fourth retry)", () => {
    expect(defaultExponentialBackoff(3)).toBe(8000); // 2^3 * 1000 = 8 seconds
  });

  test("handles large attempt numbers", () => {
    expect(defaultExponentialBackoff(10)).toBe(1024000); // 2^10 * 1000 = 1024 seconds
  });
});

describe("withRetry - success scenarios", () => {
  test("returns result on first attempt (no retries needed)", async () => {
    const operation = mock(() => Promise.resolve("success"));

    const result = await withRetry(operation, { maxRetries: 3 });

    expect(result).toBe("success");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  test("succeeds after 1 retry", async () => {
    let attempts = 0;
    const operation = mock(async () => {
      attempts++;
      if (attempts === 1) throw new Error("First attempt fails");
      return "success";
    });

    const result = await withRetry(operation, { maxRetries: 3 });

    expect(result).toBe("success");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  test("succeeds after 2 retries", async () => {
    let attempts = 0;
    const operation = mock(async () => {
      attempts++;
      if (attempts <= 2) throw new Error("Attempts 1-2 fail");
      return "success";
    });

    const result = await withRetry(operation, { maxRetries: 3 });

    expect(result).toBe("success");
    expect(operation).toHaveBeenCalledTimes(3);
  });

  test("succeeds on final retry attempt", async () => {
    let attempts = 0;
    const operation = mock(async () => {
      attempts++;
      if (attempts <= 3) throw new Error("Attempts 1-3 fail");
      return "success";
    });

    const result = await withRetry(operation, {
      maxRetries: 3,
      calculateBackoff: () => 10, // Fast retry for testing
    });

    expect(result).toBe("success");
    expect(operation).toHaveBeenCalledTimes(4); // Initial + 3 retries
  });
});

describe("withRetry - failure scenarios", () => {
  test("throws after exhausting all retries", async () => {
    const error = new Error("Persistent failure");
    const operation = mock(() => Promise.reject(error));

    await expect(
      withRetry(operation, {
        maxRetries: 3,
        calculateBackoff: () => 10, // Fast retry for testing
      })
    ).rejects.toThrow("Persistent failure");
    expect(operation).toHaveBeenCalledTimes(4); // Initial + 3 retries
  });

  test("throws immediately with maxRetries=0", async () => {
    const error = new Error("Immediate failure");
    const operation = mock(() => Promise.reject(error));

    await expect(withRetry(operation, { maxRetries: 0 })).rejects.toThrow("Immediate failure");
    expect(operation).toHaveBeenCalledTimes(1); // No retries
  });

  test("throws last error after all retries", async () => {
    let attempts = 0;
    const operation = mock(async () => {
      attempts++;
      throw new Error(`Failure ${attempts}`);
    });

    await expect(withRetry(operation, { maxRetries: 2 })).rejects.toThrow("Failure 3");
    expect(operation).toHaveBeenCalledTimes(3);
  });
});

describe("withRetry - shouldRetry conditional logic", () => {
  class RetryableError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "RetryableError";
    }
  }

  class NonRetryableError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "NonRetryableError";
    }
  }

  test("retries only when shouldRetry returns true", async () => {
    let attempts = 0;
    const operation = mock(async () => {
      attempts++;
      if (attempts <= 2) throw new RetryableError("Retryable");
      return "success";
    });

    const options: RetryOptions = {
      maxRetries: 3,
      shouldRetry: (error) => error instanceof RetryableError,
    };

    const result = await withRetry(operation, options);

    expect(result).toBe("success");
    expect(operation).toHaveBeenCalledTimes(3);
  });

  test("stops retrying when shouldRetry returns false", async () => {
    const operation = mock(() => Promise.reject(new NonRetryableError("Non-retryable")));

    const options: RetryOptions = {
      maxRetries: 3,
      shouldRetry: (error) => error instanceof RetryableError,
    };

    await expect(withRetry(operation, options)).rejects.toThrow("Non-retryable");
    expect(operation).toHaveBeenCalledTimes(1); // No retries
  });

  test("switches from retryable to non-retryable error", async () => {
    let attempts = 0;
    const operation = mock(async () => {
      attempts++;
      if (attempts === 1) throw new RetryableError("Retry this");
      throw new NonRetryableError("Don't retry this");
    });

    const options: RetryOptions = {
      maxRetries: 3,
      shouldRetry: (error) => error instanceof RetryableError,
    };

    await expect(withRetry(operation, options)).rejects.toThrow("Don't retry this");
    expect(operation).toHaveBeenCalledTimes(2); // Initial + 1 retry, then stops
  });
});

describe("withRetry - custom backoff calculation", () => {
  test("uses custom backoff function", async () => {
    const delays: number[] = [];
    let attempts = 0;

    const operation = mock(async () => {
      attempts++;
      if (attempts <= 3) throw new Error("Fail");
      return "success";
    });

    const customBackoff = mock((attempt: number) => {
      const delay = (attempt + 1) * 100; // 100ms, 200ms, 300ms
      return delay;
    });

    const options: RetryOptions = {
      maxRetries: 3,
      calculateBackoff: customBackoff,
      onRetry: (_attempt, _error, delayMs) => delays.push(delayMs),
    };

    await withRetry(operation, options);

    expect(customBackoff).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([100, 200, 300]);
  });

  test("backoff receives attempt number and error", async () => {
    let attempts = 0;
    const operation = mock(async () => {
      attempts++;
      if (attempts <= 2) throw new Error(`Error ${attempts}`);
      return "success";
    });

    const backoffCalls: Array<{ attempt: number; error: Error }> = [];
    const customBackoff = mock((attempt: number, error: Error) => {
      backoffCalls.push({ attempt, error });
      return 10; // Fast retry for testing
    });

    await withRetry(operation, { maxRetries: 3, calculateBackoff: customBackoff });

    expect(backoffCalls).toHaveLength(2);
    expect(backoffCalls[0]!.attempt).toBe(0);
    expect(backoffCalls[0]!.error.message).toBe("Error 1");
    expect(backoffCalls[1]!.attempt).toBe(1);
    expect(backoffCalls[1]!.error.message).toBe("Error 2");
  });
});

describe("withRetry - onRetry callback", () => {
  test("invokes onRetry before each retry", async () => {
    const retryCalls: Array<{ attempt: number; error: Error; delayMs: number }> = [];
    let attempts = 0;

    const operation = mock(async () => {
      attempts++;
      if (attempts <= 2) throw new Error(`Attempt ${attempts}`);
      return "success";
    });

    const onRetry = mock((attempt: number, error: Error, delayMs: number) => {
      retryCalls.push({ attempt, error, delayMs });
    });

    await withRetry(operation, { maxRetries: 3, onRetry });

    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(retryCalls).toHaveLength(2);

    // First retry (attempt 0)
    expect(retryCalls[0]!.attempt).toBe(0);
    expect(retryCalls[0]!.error.message).toBe("Attempt 1");
    expect(retryCalls[0]!.delayMs).toBe(1000); // Default exponential backoff

    // Second retry (attempt 1)
    expect(retryCalls[1]!.attempt).toBe(1);
    expect(retryCalls[1]!.error.message).toBe("Attempt 2");
    expect(retryCalls[1]!.delayMs).toBe(2000);
  });

  test("does not invoke onRetry on initial attempt", async () => {
    const onRetry = mock(() => {});
    const operation = mock(() => Promise.resolve("success"));

    await withRetry(operation, { maxRetries: 3, onRetry });

    expect(onRetry).not.toHaveBeenCalled();
  });

  test("does not invoke onRetry when exhausting retries", async () => {
    let retryCount = 0;
    const onRetry = mock(() => {
      retryCount++;
    });
    const operation = mock(() => Promise.reject(new Error("Always fails")));

    await expect(withRetry(operation, { maxRetries: 2, onRetry })).rejects.toThrow("Always fails");

    // Called twice (for attempts 1 and 2), but not after final failure
    expect(retryCount).toBe(2);
  });
});

describe("withRetry - timing behavior", () => {
  test("calls backoff calculation and delays between retry attempts", async () => {
    let attempts = 0;
    const delays: number[] = [];

    const operation = mock(async () => {
      attempts++;
      if (attempts <= 2) throw new Error("Fail");
      return "success";
    });

    const customBackoff = mock((_attempt: number) => {
      const delay = 50; // Fast delay for testing
      delays.push(delay);
      return delay;
    });

    await withRetry(operation, {
      maxRetries: 2,
      calculateBackoff: customBackoff,
    });

    // Verify operation was called 3 times (initial + 2 retries)
    expect(operation).toHaveBeenCalledTimes(3);

    // Verify backoff was calculated for each retry (not for initial attempt)
    expect(customBackoff).toHaveBeenCalledTimes(2);
    expect(delays).toEqual([50, 50]);

    // Verify backoff was called with correct attempt numbers
    expect(customBackoff.mock.calls[0]![0]).toBe(0); // First retry
    expect(customBackoff.mock.calls[1]![0]).toBe(1); // Second retry
  });
});

describe("withRetry - type safety", () => {
  test("preserves return type", async () => {
    const stringResult = await withRetry(() => Promise.resolve("text"), { maxRetries: 0 });
    const numResult = await withRetry(() => Promise.resolve(42), { maxRetries: 0 });
    const objResult = await withRetry(() => Promise.resolve({ key: "value" }), { maxRetries: 0 });

    // TypeScript compiler would catch type mismatches
    expect(typeof stringResult).toBe("string");
    expect(typeof numResult).toBe("number");
    expect(typeof objResult).toBe("object");
  });

  test("throws typed errors", async () => {
    class CustomError extends Error {}

    const operation = () => Promise.reject(new CustomError("Custom"));

    try {
      await withRetry(operation, { maxRetries: 0 });
      throw new Error("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(CustomError);
      expect((error as CustomError).message).toBe("Custom");
    }
  });
});

describe("DEFAULT_RETRY_CONFIG", () => {
  test("has expected default values", () => {
    expect(DEFAULT_RETRY_CONFIG).toEqual({
      maxRetries: 3,
      initialDelayMs: 1000,
      maxDelayMs: 60000,
      backoffMultiplier: 2,
    });
  });
});

describe("createRetryConfigFromEnv", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear relevant env variables before each test
    delete Bun.env["MAX_RETRIES"];
    delete Bun.env["RETRY_INITIAL_DELAY_MS"];
    delete Bun.env["RETRY_MAX_DELAY_MS"];
    delete Bun.env["RETRY_BACKOFF_MULTIPLIER"];
  });

  afterEach(() => {
    // Restore original env after each test
    Object.keys(Bun.env).forEach((key) => {
      if (key.startsWith("MAX_RETRIES") || key.startsWith("RETRY_")) {
        delete Bun.env[key];
      }
    });
    Object.assign(process.env, originalEnv);
  });

  test("returns defaults when no env vars set", () => {
    const config = createRetryConfigFromEnv();

    expect(config.maxRetries).toBe(3);
    expect(config.initialDelayMs).toBe(1000);
    expect(config.maxDelayMs).toBe(60000);
    expect(config.backoffMultiplier).toBe(2);
  });

  test("reads MAX_RETRIES from environment", () => {
    Bun.env["MAX_RETRIES"] = "5";

    const config = createRetryConfigFromEnv();

    expect(config.maxRetries).toBe(5);
  });

  test("reads RETRY_INITIAL_DELAY_MS from environment", () => {
    Bun.env["RETRY_INITIAL_DELAY_MS"] = "500";

    const config = createRetryConfigFromEnv();

    expect(config.initialDelayMs).toBe(500);
  });

  test("reads RETRY_MAX_DELAY_MS from environment", () => {
    Bun.env["RETRY_MAX_DELAY_MS"] = "120000";

    const config = createRetryConfigFromEnv();

    expect(config.maxDelayMs).toBe(120000);
  });

  test("reads RETRY_BACKOFF_MULTIPLIER from environment", () => {
    Bun.env["RETRY_BACKOFF_MULTIPLIER"] = "1.5";

    const config = createRetryConfigFromEnv();

    expect(config.backoffMultiplier).toBe(1.5);
  });

  test("reads all env vars when set", () => {
    Bun.env["MAX_RETRIES"] = "10";
    Bun.env["RETRY_INITIAL_DELAY_MS"] = "2000";
    Bun.env["RETRY_MAX_DELAY_MS"] = "300000";
    Bun.env["RETRY_BACKOFF_MULTIPLIER"] = "3";

    const config = createRetryConfigFromEnv();

    expect(config).toEqual({
      maxRetries: 10,
      initialDelayMs: 2000,
      maxDelayMs: 300000,
      backoffMultiplier: 3,
    });
  });
});

describe("createExponentialBackoff", () => {
  test("calculates backoff using configured initial delay", () => {
    const config: Pick<RetryConfig, "initialDelayMs" | "maxDelayMs" | "backoffMultiplier"> = {
      initialDelayMs: 500,
      maxDelayMs: 60000,
      backoffMultiplier: 2,
    };

    const calculateBackoff = createExponentialBackoff(config);

    expect(calculateBackoff(0, new Error())).toBe(500); // 500 * 2^0 = 500
    expect(calculateBackoff(1, new Error())).toBe(1000); // 500 * 2^1 = 1000
    expect(calculateBackoff(2, new Error())).toBe(2000); // 500 * 2^2 = 2000
  });

  test("uses configured backoff multiplier", () => {
    const config: Pick<RetryConfig, "initialDelayMs" | "maxDelayMs" | "backoffMultiplier"> = {
      initialDelayMs: 1000,
      maxDelayMs: 60000,
      backoffMultiplier: 3,
    };

    const calculateBackoff = createExponentialBackoff(config);

    expect(calculateBackoff(0, new Error())).toBe(1000); // 1000 * 3^0 = 1000
    expect(calculateBackoff(1, new Error())).toBe(3000); // 1000 * 3^1 = 3000
    expect(calculateBackoff(2, new Error())).toBe(9000); // 1000 * 3^2 = 9000
  });

  test("caps delay at maxDelayMs", () => {
    const config: Pick<RetryConfig, "initialDelayMs" | "maxDelayMs" | "backoffMultiplier"> = {
      initialDelayMs: 1000,
      maxDelayMs: 5000,
      backoffMultiplier: 2,
    };

    const calculateBackoff = createExponentialBackoff(config);

    expect(calculateBackoff(0, new Error())).toBe(1000); // 1000
    expect(calculateBackoff(1, new Error())).toBe(2000); // 2000
    expect(calculateBackoff(2, new Error())).toBe(4000); // 4000
    expect(calculateBackoff(3, new Error())).toBe(5000); // 8000 -> capped at 5000
    expect(calculateBackoff(4, new Error())).toBe(5000); // 16000 -> capped at 5000
  });

  test("handles fractional backoff multiplier", () => {
    const config: Pick<RetryConfig, "initialDelayMs" | "maxDelayMs" | "backoffMultiplier"> = {
      initialDelayMs: 1000,
      maxDelayMs: 60000,
      backoffMultiplier: 1.5,
    };

    const calculateBackoff = createExponentialBackoff(config);

    expect(calculateBackoff(0, new Error())).toBe(1000); // 1000 * 1.5^0 = 1000
    expect(calculateBackoff(1, new Error())).toBe(1500); // 1000 * 1.5^1 = 1500
    expect(calculateBackoff(2, new Error())).toBe(2250); // 1000 * 1.5^2 = 2250
  });
});

describe("createRetryLogger", () => {
  test("calls logger.warn with structured retry info", () => {
    const warnCalls: Array<{ data: unknown; message: string }> = [];
    const mockLogger = {
      warn: mock((data: unknown, message: string) => {
        warnCalls.push({ data, message });
      }),
    };

    const onRetry = createRetryLogger(mockLogger as never, "test-operation", 3);
    const error = new Error("Test error");

    onRetry(0, error, 1000);

    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(warnCalls[0]!.message).toBe("Retrying test-operation");
    expect(warnCalls[0]!.data).toEqual({
      attempt: 1, // 1-based for readability
      maxRetries: 3,
      delayMs: 1000,
      error: "Test error",
      errorType: "Error",
    });
  });

  test("logs correct attempt number (1-based)", () => {
    const warnCalls: Array<{ data: unknown }> = [];
    const mockLogger = {
      warn: mock((data: unknown, _message: string) => {
        warnCalls.push({ data });
      }),
    };

    const onRetry = createRetryLogger(mockLogger as never, "operation", 5);

    onRetry(0, new Error(), 1000);
    onRetry(1, new Error(), 2000);
    onRetry(2, new Error(), 4000);

    expect((warnCalls[0]!.data as { attempt: number }).attempt).toBe(1);
    expect((warnCalls[1]!.data as { attempt: number }).attempt).toBe(2);
    expect((warnCalls[2]!.data as { attempt: number }).attempt).toBe(3);
  });

  test("includes error type in log", () => {
    class CustomNetworkError extends Error {
      constructor() {
        super("Network failed");
        this.name = "CustomNetworkError";
      }
    }

    const warnCalls: Array<{ data: unknown }> = [];
    const mockLogger = {
      warn: mock((data: unknown, _message: string) => {
        warnCalls.push({ data });
      }),
    };

    const onRetry = createRetryLogger(mockLogger as never, "network-call", 3);
    onRetry(0, new CustomNetworkError(), 1000);

    expect((warnCalls[0]!.data as { errorType: string }).errorType).toBe("CustomNetworkError");
  });
});

describe("createRetryOptions", () => {
  test("creates options from config with calculateBackoff", () => {
    const config: RetryConfig = {
      maxRetries: 5,
      initialDelayMs: 500,
      maxDelayMs: 10000,
      backoffMultiplier: 2,
    };

    const options = createRetryOptions(config);

    expect(options.maxRetries).toBe(5);
    expect(options.calculateBackoff).toBeDefined();

    // Verify backoff calculation works correctly
    const backoff = options.calculateBackoff!;
    expect(backoff(0, new Error())).toBe(500);
    expect(backoff(1, new Error())).toBe(1000);
    expect(backoff(2, new Error())).toBe(2000);
  });

  test("allows overriding shouldRetry", () => {
    const config = DEFAULT_RETRY_CONFIG;
    const shouldRetry = (error: Error) => error.message.includes("retry");

    const options = createRetryOptions(config, { shouldRetry });

    expect(options.shouldRetry).toBe(shouldRetry);
    expect(options.shouldRetry!(new Error("please retry"))).toBe(true);
    expect(options.shouldRetry!(new Error("do not try again"))).toBe(false);
  });

  test("allows overriding onRetry", () => {
    const config = DEFAULT_RETRY_CONFIG;
    const onRetry = mock(() => {});

    const options = createRetryOptions(config, { onRetry });

    expect(options.onRetry).toBe(onRetry);
  });

  test("allows overriding calculateBackoff", () => {
    const config = DEFAULT_RETRY_CONFIG;
    const customBackoff = mock(() => 999);

    const options = createRetryOptions(config, { calculateBackoff: customBackoff });

    expect(options.calculateBackoff).toBe(customBackoff);
  });

  test("merges multiple overrides", () => {
    const config = DEFAULT_RETRY_CONFIG;
    const shouldRetry = () => true;
    const onRetry = mock(() => {});

    const options = createRetryOptions(config, { shouldRetry, onRetry });

    expect(options.maxRetries).toBe(config.maxRetries);
    expect(options.shouldRetry).toBe(shouldRetry);
    expect(options.onRetry).toBe(onRetry);
    expect(options.calculateBackoff).toBeDefined(); // From config
  });

  test("works with withRetry function", async () => {
    let attempts = 0;
    const operation = mock(async () => {
      attempts++;
      if (attempts <= 2) throw new Error("Fail");
      return "success";
    });

    const config: RetryConfig = {
      maxRetries: 3,
      initialDelayMs: 10, // Fast for testing
      maxDelayMs: 100,
      backoffMultiplier: 2,
    };

    const options = createRetryOptions(config, {
      shouldRetry: () => true,
    });

    const result = await withRetry(operation, options);

    expect(result).toBe("success");
    expect(operation).toHaveBeenCalledTimes(3);
  });
});
