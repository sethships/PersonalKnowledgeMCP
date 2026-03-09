/**
 * @module tests/unit/services/processing-queue-errors
 *
 * Tests for ProcessingQueue error class hierarchy.
 */

import { describe, expect, test } from "bun:test";

import {
  ProcessingQueueError,
  QueueFullError,
  QueueStoppedError,
  BatchProcessingError,
  ShutdownTimeoutError,
  isProcessingQueueError,
  isRetryableProcessingQueueError,
} from "../../../src/services/processing-queue-errors.js";

// =============================================================================
// QueueFullError Tests
// =============================================================================

describe("QueueFullError", () => {
  test("is an instance of ProcessingQueueError", () => {
    const error = new QueueFullError(1000, 1000);
    expect(error).toBeInstanceOf(ProcessingQueueError);
    expect(error).toBeInstanceOf(Error);
  });

  test("has correct name", () => {
    const error = new QueueFullError(1000, 1000);
    expect(error.name).toBe("QueueFullError");
  });

  test("includes size information in message", () => {
    const error = new QueueFullError(500, 500);
    expect(error.message).toContain("500/500");
  });

  test("stores currentSize and maxSize", () => {
    const error = new QueueFullError(750, 1000);
    expect(error.currentSize).toBe(750);
    expect(error.maxSize).toBe(1000);
  });

  test("is retryable", () => {
    const error = new QueueFullError(1000, 1000);
    expect(error.retryable).toBe(true);
  });

  test("has a stack trace", () => {
    const error = new QueueFullError(1000, 1000);
    expect(error.stack).toBeDefined();
    expect(error.stack).toContain("QueueFullError");
  });
});

// =============================================================================
// QueueStoppedError Tests
// =============================================================================

describe("QueueStoppedError", () => {
  test("is an instance of ProcessingQueueError", () => {
    const error = new QueueStoppedError("stopped");
    expect(error).toBeInstanceOf(ProcessingQueueError);
  });

  test("has correct name", () => {
    const error = new QueueStoppedError("stopped");
    expect(error.name).toBe("QueueStoppedError");
  });

  test("includes state in message", () => {
    const error = new QueueStoppedError("draining");
    expect(error.message).toContain("draining");
  });

  test("stores queueState", () => {
    const error = new QueueStoppedError("stopped");
    expect(error.queueState).toBe("stopped");
  });

  test("is not retryable", () => {
    const error = new QueueStoppedError("stopped");
    expect(error.retryable).toBe(false);
  });
});

// =============================================================================
// BatchProcessingError Tests
// =============================================================================

describe("BatchProcessingError", () => {
  test("is an instance of ProcessingQueueError", () => {
    const error = new BatchProcessingError(50, 3, "Connection refused");
    expect(error).toBeInstanceOf(ProcessingQueueError);
  });

  test("has correct name", () => {
    const error = new BatchProcessingError(50, 3, "Connection refused");
    expect(error.name).toBe("BatchProcessingError");
  });

  test("includes batch size and attempts in message", () => {
    const error = new BatchProcessingError(50, 3, "Connection refused");
    expect(error.message).toContain("50 items");
    expect(error.message).toContain("3 attempt(s)");
  });

  test("stores batchSize and attemptsMade", () => {
    const error = new BatchProcessingError(25, 2, "Timeout");
    expect(error.batchSize).toBe(25);
    expect(error.attemptsMade).toBe(2);
  });

  test("defaults to not retryable", () => {
    const error = new BatchProcessingError(50, 3, "Error");
    expect(error.retryable).toBe(false);
  });

  test("can be marked retryable", () => {
    const error = new BatchProcessingError(50, 1, "Timeout", true);
    expect(error.retryable).toBe(true);
  });

  test("stores cause error", () => {
    const cause = new Error("Original error");
    const error = new BatchProcessingError(50, 3, "Wrapped", false, cause);
    expect(error.cause).toBe(cause);
  });

  test("appends cause stack trace", () => {
    const cause = new Error("Original error");
    const error = new BatchProcessingError(50, 3, "Wrapped", false, cause);
    expect(error.stack).toContain("Caused by:");
  });

  test("handles missing cause gracefully", () => {
    const error = new BatchProcessingError(50, 3, "No cause");
    expect(error.cause).toBeUndefined();
  });
});

// =============================================================================
// ShutdownTimeoutError Tests
// =============================================================================

describe("ShutdownTimeoutError", () => {
  test("is an instance of ProcessingQueueError", () => {
    const error = new ShutdownTimeoutError(10, 30000);
    expect(error).toBeInstanceOf(ProcessingQueueError);
  });

  test("has correct name", () => {
    const error = new ShutdownTimeoutError(10, 30000);
    expect(error.name).toBe("ShutdownTimeoutError");
  });

  test("includes remaining items and timeout in message", () => {
    const error = new ShutdownTimeoutError(10, 30000);
    expect(error.message).toContain("10 items");
    expect(error.message).toContain("30000ms");
  });

  test("stores remainingItems and timeoutMs", () => {
    const error = new ShutdownTimeoutError(5, 15000);
    expect(error.remainingItems).toBe(5);
    expect(error.timeoutMs).toBe(15000);
  });

  test("is not retryable", () => {
    const error = new ShutdownTimeoutError(10, 30000);
    expect(error.retryable).toBe(false);
  });
});

// =============================================================================
// Helper Function Tests
// =============================================================================

describe("isProcessingQueueError", () => {
  test("returns true for QueueFullError", () => {
    expect(isProcessingQueueError(new QueueFullError(100, 100))).toBe(true);
  });

  test("returns true for QueueStoppedError", () => {
    expect(isProcessingQueueError(new QueueStoppedError("stopped"))).toBe(true);
  });

  test("returns true for BatchProcessingError", () => {
    expect(isProcessingQueueError(new BatchProcessingError(10, 1, "err"))).toBe(true);
  });

  test("returns true for ShutdownTimeoutError", () => {
    expect(isProcessingQueueError(new ShutdownTimeoutError(5, 30000))).toBe(true);
  });

  test("returns false for plain Error", () => {
    expect(isProcessingQueueError(new Error("not a queue error"))).toBe(false);
  });

  test("returns false for non-error values", () => {
    expect(isProcessingQueueError("string")).toBe(false);
    expect(isProcessingQueueError(null)).toBe(false);
    expect(isProcessingQueueError(undefined)).toBe(false);
    expect(isProcessingQueueError(42)).toBe(false);
  });
});

describe("isRetryableProcessingQueueError", () => {
  test("returns true for retryable errors", () => {
    expect(isRetryableProcessingQueueError(new QueueFullError(100, 100))).toBe(true);
  });

  test("returns false for non-retryable errors", () => {
    expect(isRetryableProcessingQueueError(new QueueStoppedError("stopped"))).toBe(false);
    expect(isRetryableProcessingQueueError(new ShutdownTimeoutError(5, 30000))).toBe(false);
  });

  test("returns false for non-queue errors", () => {
    expect(isRetryableProcessingQueueError(new Error("plain error"))).toBe(false);
  });

  test("returns false for non-error values", () => {
    expect(isRetryableProcessingQueueError(null)).toBe(false);
  });
});
