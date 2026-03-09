/**
 * @module tests/unit/services/processing-queue
 *
 * Tests for ProcessingQueue core behavior.
 *
 * Uses real timers with short delays for accurate async behavior testing.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { initializeLogger, resetLogger } from "../../../src/logging/index.js";
import { ProcessingQueue } from "../../../src/services/processing-queue.js";
import {
  QueueFullError,
  QueueStoppedError,
  ShutdownTimeoutError,
} from "../../../src/services/processing-queue-errors.js";
import type {
  BatchProcessor,
  BatchProcessorResult,
} from "../../../src/services/processing-queue-types.js";
import type { DetectedChange } from "../../../src/services/change-detection-types.js";

// =============================================================================
// Test Helpers
// =============================================================================

/** Short delays for test-friendly timing (minimum 100ms per validation) */
const TEST_BATCH_DELAY_MS = 100;
const TEST_MAX_BATCH_WAIT_MS = 500;
const TEST_RETRY_DELAY_MS = 100;
const TEST_SHUTDOWN_TIMEOUT_MS = 1000;

/**
 * Create a minimal DetectedChange for testing.
 */
function createTestChange(overrides: Partial<DetectedChange> = {}): DetectedChange {
  return {
    category: "modified",
    absolutePath: `/test/path/${overrides.relativePath ?? "file.ts"}`,
    relativePath: overrides.relativePath ?? "file.ts",
    extension: "ts",
    folderId: "folder-1",
    folderPath: "/test/path",
    timestamp: new Date(),
    currentState: {
      absolutePath: `/test/path/${overrides.relativePath ?? "file.ts"}`,
      relativePath: overrides.relativePath ?? "file.ts",
      sizeBytes: 1024,
      modifiedAt: new Date(),
      extension: "ts",
      capturedAt: new Date(),
    },
    ...overrides,
  };
}

/**
 * Create a successful batch processor mock that records calls.
 */
function createSuccessProcessor(): {
  processor: BatchProcessor;
  calls: DetectedChange[][];
} {
  const calls: DetectedChange[][] = [];
  const processor: BatchProcessor = async (
    changes: DetectedChange[]
  ): Promise<BatchProcessorResult> => {
    calls.push([...changes]);
    return {
      processedCount: changes.length,
      errorCount: 0,
      errors: [],
    };
  };
  return { processor, calls };
}

/**
 * Create a processor that fails a configurable number of times then succeeds.
 */
function createFailThenSucceedProcessor(failCount: number): {
  processor: BatchProcessor;
  calls: DetectedChange[][];
  attempts: number[];
} {
  let attempt = 0;
  const calls: DetectedChange[][] = [];
  const attempts: number[] = [];

  const processor: BatchProcessor = async (
    changes: DetectedChange[]
  ): Promise<BatchProcessorResult> => {
    attempt++;
    attempts.push(attempt);

    if (attempt <= failCount) {
      throw new Error(`Simulated failure (attempt ${attempt})`);
    }

    calls.push([...changes]);
    return {
      processedCount: changes.length,
      errorCount: 0,
      errors: [],
    };
  };

  return { processor, calls, attempts };
}

/**
 * Create a processor that always fails.
 */
function createAlwaysFailProcessor(): {
  processor: BatchProcessor;
  attempts: number[];
} {
  let attempt = 0;
  const attempts: number[] = [];

  const processor: BatchProcessor = async (): Promise<BatchProcessorResult> => {
    attempt++;
    attempts.push(attempt);
    throw new Error(`Simulated permanent failure (attempt ${attempt})`);
  };

  return { processor, attempts };
}

/**
 * Create a slow processor that takes a specified duration.
 */
function createSlowProcessor(durationMs: number): {
  processor: BatchProcessor;
  calls: DetectedChange[][];
} {
  const calls: DetectedChange[][] = [];
  const processor: BatchProcessor = async (
    changes: DetectedChange[]
  ): Promise<BatchProcessorResult> => {
    await new Promise((resolve) => setTimeout(resolve, durationMs));
    calls.push([...changes]);
    return {
      processedCount: changes.length,
      errorCount: 0,
      errors: [],
    };
  };
  return { processor, calls };
}

/**
 * Wait for a specified duration.
 */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// Test Suite
// =============================================================================

// Initialize logger for all tests
beforeAll(() => {
  initializeLogger({ level: "silent", format: "json" });
});

afterAll(() => {
  resetLogger();
});

describe("ProcessingQueue", () => {
  let queue: ProcessingQueue;

  afterEach(async () => {
    // Ensure queue is stopped after each test
    try {
      queue?.forceStop();
    } catch {
      // Already stopped
    }
  });

  // ===========================================================================
  // Construction and Configuration
  // ===========================================================================

  describe("construction", () => {
    test("creates queue with default configuration", () => {
      const { processor } = createSuccessProcessor();
      queue = new ProcessingQueue(processor);

      const status = queue.getStatus();
      expect(status.state).toBe("idle");
      expect(status.queueDepth).toBe(0);
      expect(status.isProcessing).toBe(false);
      expect(status.config.maxBatchSize).toBe(50);
      expect(status.config.maxQueueSize).toBe(1000);
      expect(status.config.batchDelayMs).toBe(2000);
      expect(status.config.maxBatchWaitMs).toBe(30000);
      expect(status.config.maxRetries).toBe(2);
      expect(status.config.retryDelayMs).toBe(5000);
      expect(status.config.shutdownTimeoutMs).toBe(30000);
    });

    test("accepts custom configuration", () => {
      const { processor } = createSuccessProcessor();
      queue = new ProcessingQueue(processor, {
        maxBatchSize: 100,
        batchDelayMs: 500,
      });

      const status = queue.getStatus();
      expect(status.config.maxBatchSize).toBe(100);
      expect(status.config.batchDelayMs).toBe(500);
      // Defaults for unset values
      expect(status.config.maxQueueSize).toBe(1000);
    });

    test("throws on invalid configuration", () => {
      const { processor } = createSuccessProcessor();
      expect(() => new ProcessingQueue(processor, { maxBatchSize: -1 })).toThrow();
    });
  });

  // ===========================================================================
  // Enqueue Behavior
  // ===========================================================================

  describe("enqueue", () => {
    test("adds item to queue and increments depth", () => {
      const { processor } = createSuccessProcessor();
      queue = new ProcessingQueue(processor, {
        batchDelayMs: TEST_BATCH_DELAY_MS,
        maxBatchWaitMs: TEST_MAX_BATCH_WAIT_MS,
      });

      queue.enqueue(createTestChange());
      expect(queue.getStatus().queueDepth).toBe(1);

      queue.enqueue(createTestChange({ relativePath: "file2.ts" }));
      expect(queue.getStatus().queueDepth).toBe(2);
    });

    test("throws QueueStoppedError when queue is stopped", () => {
      const { processor } = createSuccessProcessor();
      queue = new ProcessingQueue(processor);
      queue.forceStop();

      expect(() => queue.enqueue(createTestChange())).toThrow(QueueStoppedError);
    });

    test("throws QueueFullError when at max capacity", () => {
      const { processor } = createSuccessProcessor();
      queue = new ProcessingQueue(processor, {
        maxQueueSize: 2,
        maxBatchSize: 2,
        batchDelayMs: 60000, // Long delay to prevent processing
        maxBatchWaitMs: 60000,
      });

      queue.enqueue(createTestChange({ relativePath: "a.ts" }));
      queue.enqueue(createTestChange({ relativePath: "b.ts" }));

      expect(() => queue.enqueue(createTestChange({ relativePath: "c.ts" }))).toThrow(
        QueueFullError
      );
    });

    test("tracks peak queue depth", () => {
      const { processor } = createSuccessProcessor();
      queue = new ProcessingQueue(processor, {
        batchDelayMs: 60000,
        maxBatchWaitMs: 60000,
      });

      queue.enqueue(createTestChange({ relativePath: "a.ts" }));
      queue.enqueue(createTestChange({ relativePath: "b.ts" }));
      queue.enqueue(createTestChange({ relativePath: "c.ts" }));

      const metrics = queue.getMetrics();
      expect(metrics.peakQueueDepth).toBe(3);
      expect(metrics.totalEnqueued).toBe(3);
    });
  });

  // ===========================================================================
  // Batch Processing (FIFO Order)
  // ===========================================================================

  describe("batch processing", () => {
    test("processes items in FIFO order after debounce delay", async () => {
      const { processor, calls } = createSuccessProcessor();
      queue = new ProcessingQueue(processor, {
        batchDelayMs: TEST_BATCH_DELAY_MS,
        maxBatchWaitMs: TEST_MAX_BATCH_WAIT_MS,
      });

      queue.enqueue(createTestChange({ relativePath: "first.ts" }));
      queue.enqueue(createTestChange({ relativePath: "second.ts" }));
      queue.enqueue(createTestChange({ relativePath: "third.ts" }));

      // Wait for debounce timer to fire and processing to complete
      await wait(TEST_BATCH_DELAY_MS + 100);

      expect(calls.length).toBe(1);
      expect(calls[0]!.length).toBe(3);
      expect(calls[0]![0]!.relativePath).toBe("first.ts");
      expect(calls[0]![1]!.relativePath).toBe("second.ts");
      expect(calls[0]![2]!.relativePath).toBe("third.ts");
    });

    test("respects maxBatchSize and processes remaining in next batch", async () => {
      const { processor, calls } = createSuccessProcessor();
      queue = new ProcessingQueue(processor, {
        maxBatchSize: 2,
        batchDelayMs: TEST_BATCH_DELAY_MS,
        maxBatchWaitMs: TEST_MAX_BATCH_WAIT_MS,
      });

      queue.enqueue(createTestChange({ relativePath: "a.ts" }));
      queue.enqueue(createTestChange({ relativePath: "b.ts" }));
      queue.enqueue(createTestChange({ relativePath: "c.ts" }));
      queue.enqueue(createTestChange({ relativePath: "d.ts" }));
      queue.enqueue(createTestChange({ relativePath: "e.ts" }));

      // Wait for all batches to complete
      await wait(TEST_BATCH_DELAY_MS + 200);

      // Should process in batches of 2: [a,b], [c,d], [e]
      expect(calls.length).toBe(3);
      expect(calls[0]!.length).toBe(2);
      expect(calls[0]![0]!.relativePath).toBe("a.ts");
      expect(calls[0]![1]!.relativePath).toBe("b.ts");
      expect(calls[1]!.length).toBe(2);
      expect(calls[1]![0]!.relativePath).toBe("c.ts");
      expect(calls[1]![1]!.relativePath).toBe("d.ts");
      expect(calls[2]!.length).toBe(1);
      expect(calls[2]![0]!.relativePath).toBe("e.ts");
    });

    test("debounce timer resets on new items", async () => {
      const { processor, calls } = createSuccessProcessor();
      queue = new ProcessingQueue(processor, {
        batchDelayMs: 100,
        maxBatchWaitMs: 500,
      });

      queue.enqueue(createTestChange({ relativePath: "first.ts" }));

      // Wait 50ms (before debounce fires), add another
      await wait(50);
      queue.enqueue(createTestChange({ relativePath: "second.ts" }));

      // At t=50ms, debounce was reset. Wait another 50ms (t=100ms total),
      // still not enough since debounce was reset
      await wait(50);
      expect(calls.length).toBe(0); // Not yet fired

      // Wait for debounce to fire from last reset (100ms from second enqueue)
      await wait(100);
      expect(calls.length).toBe(1);
      expect(calls[0]!.length).toBe(2);
    });

    test("max-wait timer forces processing during sustained activity", async () => {
      const { processor, calls } = createSuccessProcessor();
      queue = new ProcessingQueue(processor, {
        batchDelayMs: 100,
        maxBatchWaitMs: 200,
      });

      // Rapidly enqueue items to keep resetting debounce
      queue.enqueue(createTestChange({ relativePath: "a.ts" }));

      // Keep adding items every 60ms - debounce (100ms) never fires
      for (let i = 1; i <= 5; i++) {
        await wait(60);
        queue.enqueue(createTestChange({ relativePath: `item-${i}.ts` }));
      }

      // maxBatchWaitMs (200ms) should have triggered processing
      // Wait a bit for processing to complete
      await wait(200);

      // At least one batch should have been processed by now
      expect(calls.length).toBeGreaterThanOrEqual(1);
    });

    test("returns to idle state after processing empty queue", async () => {
      const { processor } = createSuccessProcessor();
      queue = new ProcessingQueue(processor, {
        batchDelayMs: TEST_BATCH_DELAY_MS,
        maxBatchWaitMs: TEST_MAX_BATCH_WAIT_MS,
      });

      queue.enqueue(createTestChange());
      await wait(TEST_BATCH_DELAY_MS + 100);

      expect(queue.getStatus().state).toBe("idle");
      expect(queue.getStatus().queueDepth).toBe(0);
    });
  });

  // ===========================================================================
  // Retry Behavior
  // ===========================================================================

  describe("retry behavior", () => {
    test("retries failed batch up to maxRetries times", async () => {
      // Fail twice, succeed on third attempt (maxRetries=2 means 3 total attempts)
      const { processor, calls, attempts } = createFailThenSucceedProcessor(2);
      queue = new ProcessingQueue(processor, {
        maxRetries: 2,
        retryDelayMs: TEST_RETRY_DELAY_MS,
        batchDelayMs: TEST_BATCH_DELAY_MS,
        maxBatchWaitMs: TEST_MAX_BATCH_WAIT_MS,
      });

      queue.enqueue(createTestChange());

      // Wait for debounce + processing + retries
      await wait(TEST_BATCH_DELAY_MS + 300);

      expect(attempts.length).toBe(3);
      expect(calls.length).toBe(1); // Succeeded on third attempt
    });

    test("gives up after maxRetries failures", async () => {
      const { processor, attempts } = createAlwaysFailProcessor();
      queue = new ProcessingQueue(processor, {
        maxRetries: 1,
        retryDelayMs: TEST_RETRY_DELAY_MS,
        batchDelayMs: TEST_BATCH_DELAY_MS,
        maxBatchWaitMs: TEST_MAX_BATCH_WAIT_MS,
      });

      queue.enqueue(createTestChange());

      // Wait for debounce + processing + retries
      await wait(TEST_BATCH_DELAY_MS + 300);

      // maxRetries=1 means 2 total attempts
      expect(attempts.length).toBe(2);

      // Error metrics should be updated
      const metrics = queue.getMetrics();
      expect(metrics.totalErrors).toBeGreaterThan(0);
      expect(metrics.totalBatches).toBe(1);
    });

    test("processes with no retries when maxRetries is 0", async () => {
      const { processor, attempts } = createAlwaysFailProcessor();
      queue = new ProcessingQueue(processor, {
        maxRetries: 0,
        retryDelayMs: TEST_RETRY_DELAY_MS,
        batchDelayMs: TEST_BATCH_DELAY_MS,
        maxBatchWaitMs: TEST_MAX_BATCH_WAIT_MS,
      });

      queue.enqueue(createTestChange());
      await wait(TEST_BATCH_DELAY_MS + 100);

      expect(attempts.length).toBe(1); // Only one attempt, no retries
    });
  });

  // ===========================================================================
  // Shutdown
  // ===========================================================================

  describe("shutdown", () => {
    test("drains remaining items before stopping", async () => {
      const { processor, calls } = createSuccessProcessor();
      queue = new ProcessingQueue(processor, {
        batchDelayMs: 60000, // Long delay - won't fire before shutdown
        maxBatchWaitMs: 60000,
        shutdownTimeoutMs: TEST_SHUTDOWN_TIMEOUT_MS,
      });

      queue.enqueue(createTestChange({ relativePath: "a.ts" }));
      queue.enqueue(createTestChange({ relativePath: "b.ts" }));

      await queue.shutdown();

      expect(calls.length).toBe(1);
      expect(calls[0]!.length).toBe(2);
      expect(queue.getStatus().state).toBe("stopped");
    });

    test("rejects enqueue during draining", async () => {
      const { processor: slowProcessor } = createSlowProcessor(100);
      queue = new ProcessingQueue(slowProcessor, {
        batchDelayMs: TEST_BATCH_DELAY_MS,
        maxBatchWaitMs: TEST_MAX_BATCH_WAIT_MS,
        shutdownTimeoutMs: TEST_SHUTDOWN_TIMEOUT_MS,
      });

      queue.enqueue(createTestChange());

      // Start shutdown (don't await yet)
      const shutdownPromise = queue.shutdown();

      // Try to enqueue during draining
      expect(() => queue.enqueue(createTestChange())).toThrow(QueueStoppedError);

      await shutdownPromise;
    });

    test("completes immediately if queue is empty", async () => {
      const { processor } = createSuccessProcessor();
      queue = new ProcessingQueue(processor);

      await queue.shutdown();
      expect(queue.getStatus().state).toBe("stopped");
    });

    test("is idempotent when already stopped", async () => {
      const { processor } = createSuccessProcessor();
      queue = new ProcessingQueue(processor);

      queue.forceStop();
      await queue.shutdown(); // Should not throw
      expect(queue.getStatus().state).toBe("stopped");
    });

    test("throws ShutdownTimeoutError when drain exceeds timeout", async () => {
      // Create a very slow processor that takes longer than shutdown timeout
      const { processor: slowProcessor } = createSlowProcessor(5000);
      queue = new ProcessingQueue(slowProcessor, {
        batchDelayMs: 60000,
        maxBatchWaitMs: 60000,
        shutdownTimeoutMs: 1000, // Minimum allowed timeout
      });

      queue.enqueue(createTestChange());

      // Shutdown starts processing. With a 5s processor and 1s timeout, it should timeout.
      let caughtError: unknown;
      try {
        await queue.shutdown();
      } catch (error: unknown) {
        caughtError = error;
      }
      expect(caughtError).toBeInstanceOf(ShutdownTimeoutError);
    });
  });

  // ===========================================================================
  // Force Stop
  // ===========================================================================

  describe("forceStop", () => {
    test("immediately discards all pending items", () => {
      const { processor } = createSuccessProcessor();
      queue = new ProcessingQueue(processor, {
        batchDelayMs: 60000,
        maxBatchWaitMs: 60000,
      });

      queue.enqueue(createTestChange({ relativePath: "a.ts" }));
      queue.enqueue(createTestChange({ relativePath: "b.ts" }));

      queue.forceStop();

      expect(queue.getStatus().state).toBe("stopped");
      expect(queue.getStatus().queueDepth).toBe(0);
    });

    test("prevents further enqueues", () => {
      const { processor } = createSuccessProcessor();
      queue = new ProcessingQueue(processor);

      queue.forceStop();

      expect(() => queue.enqueue(createTestChange())).toThrow(QueueStoppedError);
    });
  });

  // ===========================================================================
  // Metrics
  // ===========================================================================

  describe("metrics", () => {
    test("returns zero metrics initially", () => {
      const { processor } = createSuccessProcessor();
      queue = new ProcessingQueue(processor);

      const metrics = queue.getMetrics();
      expect(metrics.queueDepth).toBe(0);
      expect(metrics.processingRate).toBe(0);
      expect(metrics.totalEnqueued).toBe(0);
      expect(metrics.totalProcessed).toBe(0);
      expect(metrics.totalBatches).toBe(0);
      expect(metrics.totalErrors).toBe(0);
      expect(metrics.averageBatchDurationMs).toBe(0);
      expect(metrics.peakQueueDepth).toBe(0);
    });

    test("tracks totalEnqueued and totalProcessed", async () => {
      const { processor } = createSuccessProcessor();
      queue = new ProcessingQueue(processor, {
        batchDelayMs: TEST_BATCH_DELAY_MS,
        maxBatchWaitMs: TEST_MAX_BATCH_WAIT_MS,
      });

      queue.enqueue(createTestChange({ relativePath: "a.ts" }));
      queue.enqueue(createTestChange({ relativePath: "b.ts" }));
      queue.enqueue(createTestChange({ relativePath: "c.ts" }));

      await wait(TEST_BATCH_DELAY_MS + 100);

      const metrics = queue.getMetrics();
      expect(metrics.totalEnqueued).toBe(3);
      expect(metrics.totalProcessed).toBe(3);
      expect(metrics.totalBatches).toBe(1);
    });

    test("tracks errors from batch results", async () => {
      const processor: BatchProcessor = async (
        changes: DetectedChange[]
      ): Promise<BatchProcessorResult> => ({
        processedCount: changes.length - 1,
        errorCount: 1,
        errors: [{ change: changes[0]!, error: "Test error" }],
      });

      queue = new ProcessingQueue(processor, {
        batchDelayMs: TEST_BATCH_DELAY_MS,
        maxBatchWaitMs: TEST_MAX_BATCH_WAIT_MS,
      });

      queue.enqueue(createTestChange({ relativePath: "a.ts" }));
      queue.enqueue(createTestChange({ relativePath: "b.ts" }));

      await wait(TEST_BATCH_DELAY_MS + 100);

      const metrics = queue.getMetrics();
      expect(metrics.totalProcessed).toBe(1);
      expect(metrics.totalErrors).toBe(1);
    });

    test("calculates average batch duration", async () => {
      const { processor } = createSuccessProcessor();
      queue = new ProcessingQueue(processor, {
        batchDelayMs: TEST_BATCH_DELAY_MS,
        maxBatchWaitMs: TEST_MAX_BATCH_WAIT_MS,
      });

      queue.enqueue(createTestChange());
      await wait(TEST_BATCH_DELAY_MS + 100);

      const metrics = queue.getMetrics();
      expect(metrics.averageBatchDurationMs).toBeGreaterThanOrEqual(0);
      expect(metrics.totalBatches).toBe(1);
    });

    test("tracks processing rate", async () => {
      const { processor } = createSuccessProcessor();
      queue = new ProcessingQueue(processor, {
        batchDelayMs: TEST_BATCH_DELAY_MS,
        maxBatchWaitMs: TEST_MAX_BATCH_WAIT_MS,
      });

      // Enqueue and process several items
      for (let i = 0; i < 10; i++) {
        queue.enqueue(createTestChange({ relativePath: `file-${i}.ts` }));
      }

      await wait(TEST_BATCH_DELAY_MS + 100);

      const metrics = queue.getMetrics();
      expect(metrics.processingRate).toBeGreaterThan(0);
    });

    test("tracks peak queue depth across multiple enqueue cycles", async () => {
      const { processor } = createSuccessProcessor();
      queue = new ProcessingQueue(processor, {
        batchDelayMs: TEST_BATCH_DELAY_MS,
        maxBatchWaitMs: TEST_MAX_BATCH_WAIT_MS,
      });

      // First burst: 5 items
      for (let i = 0; i < 5; i++) {
        queue.enqueue(createTestChange({ relativePath: `batch1-${i}.ts` }));
      }

      // Wait for first batch to process
      await wait(TEST_BATCH_DELAY_MS + 100);

      // Second burst: 3 items
      for (let i = 0; i < 3; i++) {
        queue.enqueue(createTestChange({ relativePath: `batch2-${i}.ts` }));
      }

      await wait(TEST_BATCH_DELAY_MS + 100);

      // Peak was 5 from the first burst
      const metrics = queue.getMetrics();
      expect(metrics.peakQueueDepth).toBe(5);
    });
  });

  // ===========================================================================
  // Concurrent Safety
  // ===========================================================================

  describe("concurrent safety", () => {
    test("processes only one batch at a time", async () => {
      let concurrentBatches = 0;
      let maxConcurrentBatches = 0;

      const processor: BatchProcessor = async (
        changes: DetectedChange[]
      ): Promise<BatchProcessorResult> => {
        concurrentBatches++;
        if (concurrentBatches > maxConcurrentBatches) {
          maxConcurrentBatches = concurrentBatches;
        }
        await wait(50); // Simulate work
        concurrentBatches--;
        return { processedCount: changes.length, errorCount: 0, errors: [] };
      };

      queue = new ProcessingQueue(processor, {
        maxBatchSize: 2,
        batchDelayMs: TEST_BATCH_DELAY_MS,
        maxBatchWaitMs: TEST_MAX_BATCH_WAIT_MS,
      });

      // Enqueue enough for multiple batches
      for (let i = 0; i < 6; i++) {
        queue.enqueue(createTestChange({ relativePath: `file-${i}.ts` }));
      }

      // Wait for all processing
      await wait(TEST_BATCH_DELAY_MS + 500);

      expect(maxConcurrentBatches).toBe(1);
    });
  });

  // ===========================================================================
  // Status
  // ===========================================================================

  describe("getStatus", () => {
    test("returns idle state initially", () => {
      const { processor } = createSuccessProcessor();
      queue = new ProcessingQueue(processor);

      const status = queue.getStatus();
      expect(status.state).toBe("idle");
      expect(status.queueDepth).toBe(0);
      expect(status.isProcessing).toBe(false);
    });

    test("reflects current queue depth", () => {
      const { processor } = createSuccessProcessor();
      queue = new ProcessingQueue(processor, {
        batchDelayMs: 60000,
        maxBatchWaitMs: 60000,
      });

      queue.enqueue(createTestChange({ relativePath: "a.ts" }));
      queue.enqueue(createTestChange({ relativePath: "b.ts" }));

      const status = queue.getStatus();
      expect(status.queueDepth).toBe(2);
    });

    test("returns stopped state after forceStop", () => {
      const { processor } = createSuccessProcessor();
      queue = new ProcessingQueue(processor);

      queue.forceStop();
      expect(queue.getStatus().state).toBe("stopped");
    });

    test("returns config with defaults applied", () => {
      const { processor } = createSuccessProcessor();
      queue = new ProcessingQueue(processor, { maxBatchSize: 25 });

      const status = queue.getStatus();
      expect(status.config.maxBatchSize).toBe(25);
      expect(status.config.maxQueueSize).toBe(1000); // default
    });
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe("edge cases", () => {
    test("handles processor returning partial errors", async () => {
      const processor: BatchProcessor = async (
        changes: DetectedChange[]
      ): Promise<BatchProcessorResult> => ({
        processedCount: Math.floor(changes.length / 2),
        errorCount: changes.length - Math.floor(changes.length / 2),
        errors: changes.slice(Math.floor(changes.length / 2)).map((c) => ({
          change: c,
          error: "Partial failure",
        })),
      });

      queue = new ProcessingQueue(processor, {
        batchDelayMs: TEST_BATCH_DELAY_MS,
        maxBatchWaitMs: TEST_MAX_BATCH_WAIT_MS,
      });

      for (let i = 0; i < 4; i++) {
        queue.enqueue(createTestChange({ relativePath: `file-${i}.ts` }));
      }

      await wait(TEST_BATCH_DELAY_MS + 100);

      const metrics = queue.getMetrics();
      expect(metrics.totalProcessed).toBe(2);
      expect(metrics.totalErrors).toBe(2);
    });

    test("handles enqueue of different change categories", async () => {
      const { processor, calls } = createSuccessProcessor();
      queue = new ProcessingQueue(processor, {
        batchDelayMs: TEST_BATCH_DELAY_MS,
        maxBatchWaitMs: TEST_MAX_BATCH_WAIT_MS,
      });

      queue.enqueue(createTestChange({ category: "added", relativePath: "new.ts" }));
      queue.enqueue(createTestChange({ category: "modified", relativePath: "changed.ts" }));
      queue.enqueue(createTestChange({ category: "deleted", relativePath: "removed.ts" }));
      queue.enqueue(
        createTestChange({
          category: "renamed",
          relativePath: "new-name.ts",
          previousPath: "/test/old-name.ts",
        })
      );

      await wait(TEST_BATCH_DELAY_MS + 100);

      expect(calls.length).toBe(1);
      expect(calls[0]!.length).toBe(4);
      expect(calls[0]![0]!.category).toBe("added");
      expect(calls[0]![1]!.category).toBe("modified");
      expect(calls[0]![2]!.category).toBe("deleted");
      expect(calls[0]![3]!.category).toBe("renamed");
    });

    test("multiple rapid forceStop calls don't throw", () => {
      const { processor } = createSuccessProcessor();
      queue = new ProcessingQueue(processor);

      queue.forceStop();
      queue.forceStop(); // Should not throw
      queue.forceStop();

      expect(queue.getStatus().state).toBe("stopped");
    });

    test("shutdown after forceStop completes without error", async () => {
      const { processor } = createSuccessProcessor();
      queue = new ProcessingQueue(processor);

      queue.forceStop();
      await queue.shutdown(); // Should resolve immediately

      expect(queue.getStatus().state).toBe("stopped");
    });
  });
});
