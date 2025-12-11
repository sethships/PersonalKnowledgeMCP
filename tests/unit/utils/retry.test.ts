/**
 * Unit tests for retry utility
 *
 * Tests exponential backoff, conditional retry, backoff calculation, and retry callbacks.
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/await-thenable */
/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { describe, test, expect, mock } from "bun:test";
import {
  withRetry,
  defaultExponentialBackoff,
  type RetryOptions,
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
  test("waits between retry attempts", async () => {
    const timestamps: number[] = [];
    let attempts = 0;

    const operation = mock(async () => {
      timestamps.push(Date.now());
      attempts++;
      if (attempts <= 2) throw new Error("Fail");
      return "success";
    });

    const startTime = Date.now();

    await withRetry(operation, {
      maxRetries: 2,
      calculateBackoff: () => 50, // 50ms delays for fast test
    });

    const endTime = Date.now();
    const totalTime = endTime - startTime;

    // Should take at least 100ms (2 retries * 50ms each)
    // Allow some tolerance for execution time
    expect(totalTime).toBeGreaterThanOrEqual(80);

    // Verify timestamps show delays between attempts
    expect(timestamps.length).toBe(3);
    const gap1 = timestamps[1]! - timestamps[0]!;
    const gap2 = timestamps[2]! - timestamps[1]!;

    expect(gap1).toBeGreaterThanOrEqual(40); // ~50ms with tolerance
    expect(gap2).toBeGreaterThanOrEqual(40);
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
