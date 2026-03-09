/**
 * @module services/processing-queue
 *
 * Processing queue for batching detected file changes before downstream processing.
 *
 * Sits between ChangeDetectionService and IncrementalUpdatePipeline in the pipeline:
 *   FolderWatcherService -> ChangeDetectionService -> ProcessingQueue -> IncrementalUpdatePipeline
 *
 * Features:
 * - FIFO ordering with configurable batch sizes
 * - Debounce/max-wait timer management for efficient batching
 * - Sequential batch processing (one batch at a time)
 * - Retry with configurable attempts and delay
 * - Graceful shutdown with drain support
 * - Comprehensive metrics and observability
 */

import type pino from "pino";
import { getComponentLogger } from "../logging/index.js";
import type { DetectedChange } from "./change-detection-types.js";
import {
  BatchProcessingError,
  QueueFullError,
  QueueStoppedError,
  ShutdownTimeoutError,
} from "./processing-queue-errors.js";
import type {
  BatchProcessor,
  BatchProcessorResult,
  ProcessingQueueConfig,
  ProcessingQueueMetrics,
  ProcessingQueueState,
  ProcessingQueueStatus,
} from "./processing-queue-types.js";
import { DEFAULT_PROCESSING_QUEUE_CONFIG } from "./processing-queue-types.js";
import { validateProcessingQueueConfig } from "./processing-queue-validation.js";

// =============================================================================
// Internal Types
// =============================================================================

/**
 * Record of a completed batch for metrics calculation.
 * @internal
 */
interface BatchRecord {
  /** When the batch completed */
  completedAt: number;
  /** Number of items processed in this batch */
  processedCount: number;
  /** Duration of batch processing in milliseconds */
  durationMs: number;
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Rolling window size for processing rate calculation (60 seconds).
 */
const RATE_WINDOW_MS = 60_000;

// =============================================================================
// ProcessingQueue Implementation
// =============================================================================

/**
 * Queue for batching detected file changes with debounce, retry, and metrics.
 *
 * The queue accumulates DetectedChange items and processes them in FIFO order.
 * A debounce timer delays processing to allow batching of rapid changes.
 * A max-wait timer ensures processing occurs even during sustained activity.
 *
 * Only one batch is processed at a time (sequential processing). When a batch
 * completes and more items are queued, the next batch starts immediately.
 *
 * @example
 * ```typescript
 * const queue = new ProcessingQueue(
 *   async (changes) => {
 *     const results = await pipeline.processChanges(changes);
 *     return { processedCount: results.length, errorCount: 0, errors: [] };
 *   },
 *   { maxBatchSize: 100, batchDelayMs: 1000 }
 * );
 *
 * // Enqueue changes as they arrive
 * queue.enqueue(detectedChange);
 *
 * // On application shutdown
 * await queue.shutdown();
 * ```
 */
export class ProcessingQueue {
  // =========================================================================
  // Private Fields
  // =========================================================================

  /** The downstream batch processor callback */
  private readonly processor: BatchProcessor;

  /** Resolved configuration with defaults applied */
  private readonly config: Required<ProcessingQueueConfig>;

  /** FIFO queue of pending changes */
  private readonly queue: DetectedChange[] = [];

  /** Current state machine state */
  private state: ProcessingQueueState = "idle";

  /** Debounce timer handle */
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  /** Max-wait timer handle */
  private maxWaitTimer: ReturnType<typeof setTimeout> | null = null;

  /** Whether a batch is currently being processed */
  private processing = false;

  /** Timestamp of first enqueue after idle (for max-wait tracking) */
  private firstEnqueueTime: number | null = null;

  /** Promise that resolves when shutdown drain completes */
  private drainPromiseResolve: (() => void) | null = null;

  /** Lazy-initialized logger */
  private _logger: pino.Logger | null = null;

  // =========================================================================
  // Metrics State
  // =========================================================================

  /** Total items enqueued since creation */
  private totalEnqueued = 0;

  /** Total items successfully processed */
  private totalProcessed = 0;

  /** Total batches processed */
  private totalBatches = 0;

  /** Total individual item processing errors */
  private totalErrors = 0;

  /** Highest observed queue depth */
  private peakQueueDepth = 0;

  /** Sum of all batch durations for average calculation */
  private totalBatchDurationMs = 0;

  /** Rolling window of batch completion records for rate calculation */
  private batchRecords: BatchRecord[] = [];

  // =========================================================================
  // Constructor
  // =========================================================================

  /**
   * Create a new ProcessingQueue.
   *
   * @param processor - Callback function to process batches of changes
   * @param config - Optional configuration (defaults applied for missing fields)
   * @throws z.ZodError if configuration values are invalid
   */
  constructor(processor: BatchProcessor, config?: ProcessingQueueConfig) {
    // Validate config if provided
    if (config !== undefined) {
      validateProcessingQueueConfig(config);
    }

    this.processor = processor;
    this.config = {
      ...DEFAULT_PROCESSING_QUEUE_CONFIG,
      ...config,
    };
  }

  // =========================================================================
  // Logger (lazy initialization)
  // =========================================================================

  /**
   * Get the logger instance, initializing on first access.
   */
  private get logger(): pino.Logger {
    if (this._logger === null) {
      this._logger = getComponentLogger("services:processing-queue");
    }
    return this._logger;
  }

  // =========================================================================
  // Public API
  // =========================================================================

  /**
   * Add a detected change to the queue for processing.
   *
   * The change is added to the FIFO queue and the debounce timer is
   * started or reset. Processing occurs after the debounce delay or
   * when the max-wait time is reached.
   *
   * @param change - The detected change to enqueue
   * @throws QueueStoppedError if the queue is stopped or draining
   * @throws QueueFullError if the queue is at maximum capacity
   */
  enqueue(change: DetectedChange): void {
    // Check state
    if (this.state === "stopped" || this.state === "draining") {
      throw new QueueStoppedError(this.state);
    }

    // Check capacity
    if (this.queue.length >= this.config.maxQueueSize) {
      throw new QueueFullError(this.queue.length, this.config.maxQueueSize);
    }

    // Add to queue
    this.queue.push(change);
    this.totalEnqueued++;

    // Track peak depth
    if (this.queue.length > this.peakQueueDepth) {
      this.peakQueueDepth = this.queue.length;
    }

    this.logger.debug(
      {
        category: change.category,
        path: change.relativePath,
        queueDepth: this.queue.length,
      },
      "Change enqueued"
    );

    // Manage timers
    const wasIdle = this.firstEnqueueTime === null;
    if (wasIdle) {
      this.firstEnqueueTime = Date.now();
      this.startMaxWaitTimer();
    }

    this.resetDebounceTimer();
  }

  /**
   * Gracefully shut down the queue.
   *
   * Sets the queue to "draining" state, clears timers, and processes all
   * remaining items. Resolves when the queue is empty or the shutdown
   * timeout is reached.
   *
   * @returns Promise that resolves when drain is complete
   * @throws ShutdownTimeoutError if drain does not complete within the timeout
   */
  async shutdown(): Promise<void> {
    if (this.state === "stopped") {
      return;
    }

    this.logger.info(
      { queueDepth: this.queue.length, isProcessing: this.processing },
      "Processing queue shutdown initiated"
    );

    this.state = "draining";
    this.clearTimers();

    // If queue is empty and not processing, we're done
    if (this.queue.length === 0 && !this.processing) {
      this.state = "stopped";
      return;
    }

    // Start draining: process remaining items
    return new Promise<void>((resolve, reject) => {
      // Set up timeout
      const timeoutTimer = setTimeout(() => {
        const remaining = this.queue.length;
        this.state = "stopped";
        this.drainPromiseResolve = null;
        reject(new ShutdownTimeoutError(remaining, this.config.shutdownTimeoutMs));
      }, this.config.shutdownTimeoutMs);

      // Store resolve so processNextBatch can call it when done
      this.drainPromiseResolve = () => {
        clearTimeout(timeoutTimer);
        this.state = "stopped";
        this.drainPromiseResolve = null;
        resolve();
      };

      // If not currently processing, kick off processing
      if (!this.processing) {
        this.processNextBatch().catch((error: unknown) => {
          this.logger.error({ error }, "Error during shutdown drain processing");
        });
      }
      // If already processing, processNextBatch will chain and eventually
      // call drainPromiseResolve when the queue is empty
    });
  }

  /**
   * Immediately stop the queue and discard all pending items.
   *
   * Unlike shutdown(), this does not wait for pending items to be processed.
   * Any currently running batch will complete but no new batches will start.
   */
  forceStop(): void {
    this.logger.warn(
      { queueDepth: this.queue.length, isProcessing: this.processing },
      "Processing queue force-stopped"
    );

    this.clearTimers();
    this.queue.length = 0;
    this.firstEnqueueTime = null;
    this.state = "stopped";

    // Resolve any pending drain promise
    if (this.drainPromiseResolve) {
      this.drainPromiseResolve();
    }
  }

  /**
   * Get the current queue status.
   *
   * @returns Snapshot of queue state and configuration
   */
  getStatus(): ProcessingQueueStatus {
    return {
      state: this.state,
      queueDepth: this.queue.length,
      isProcessing: this.processing,
      config: { ...this.config },
    };
  }

  /**
   * Get performance and throughput metrics.
   *
   * @returns Current metrics snapshot including processing rate and error counts
   */
  getMetrics(): ProcessingQueueMetrics {
    return {
      queueDepth: this.queue.length,
      processingRate: this.calculateProcessingRate(),
      totalEnqueued: this.totalEnqueued,
      totalProcessed: this.totalProcessed,
      totalBatches: this.totalBatches,
      totalErrors: this.totalErrors,
      averageBatchDurationMs: this.calculateAverageBatchDuration(),
      peakQueueDepth: this.peakQueueDepth,
    };
  }

  // =========================================================================
  // Timer Management
  // =========================================================================

  /**
   * Clear all active timers.
   */
  private clearTimers(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.maxWaitTimer !== null) {
      clearTimeout(this.maxWaitTimer);
      this.maxWaitTimer = null;
    }
  }

  /**
   * Reset the debounce timer.
   *
   * Clears any existing debounce timer and starts a new one.
   * When the timer fires, batch processing begins.
   */
  private resetDebounceTimer(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.onTimerFired();
    }, this.config.batchDelayMs);
  }

  /**
   * Start the max-wait timer.
   *
   * This timer fires after maxBatchWaitMs, ensuring batches are processed
   * even if new items keep arriving within the debounce window.
   */
  private startMaxWaitTimer(): void {
    if (this.maxWaitTimer !== null) {
      return; // Already running
    }

    this.maxWaitTimer = setTimeout(() => {
      this.maxWaitTimer = null;
      this.logger.debug(
        { queueDepth: this.queue.length, maxBatchWaitMs: this.config.maxBatchWaitMs },
        "Max wait time reached, forcing batch processing"
      );
      this.onTimerFired();
    }, this.config.maxBatchWaitMs);
  }

  /**
   * Handle timer fire event (debounce or max-wait).
   *
   * If not already processing, kicks off batch processing.
   */
  private onTimerFired(): void {
    // Clear remaining timers since we're about to process
    this.clearTimers();
    this.firstEnqueueTime = null;

    if (!this.processing && this.queue.length > 0) {
      this.processNextBatch().catch((error: unknown) => {
        this.logger.error({ error }, "Error in batch processing triggered by timer");
      });
    }
  }

  // =========================================================================
  // Batch Processing
  // =========================================================================

  /**
   * Process the next batch of items from the queue.
   *
   * Takes up to maxBatchSize items from the front of the queue (FIFO),
   * processes them with retry logic, updates metrics, and chains to the
   * next batch if more items are available.
   */
  private async processNextBatch(): Promise<void> {
    if (this.processing) {
      return; // Already processing a batch
    }

    if (this.queue.length === 0) {
      // Queue is empty - check if we're draining
      if (this.state === "draining" && this.drainPromiseResolve) {
        this.drainPromiseResolve();
      }
      return;
    }

    this.processing = true;
    if (this.state === "idle") {
      this.state = "processing";
    }

    // Take batch from front of queue (FIFO)
    const batch = this.queue.splice(0, this.config.maxBatchSize);
    const batchStartTime = Date.now();

    this.logger.info(
      { batchSize: batch.length, remainingInQueue: this.queue.length },
      "Processing batch"
    );

    try {
      const result = await this.processWithRetry(batch);

      // Update metrics
      const durationMs = Date.now() - batchStartTime;
      this.totalProcessed += result.processedCount;
      this.totalErrors += result.errorCount;
      this.totalBatches++;
      this.totalBatchDurationMs += durationMs;

      this.batchRecords.push({
        completedAt: Date.now(),
        processedCount: result.processedCount,
        durationMs,
      });

      this.logger.info(
        {
          processedCount: result.processedCount,
          errorCount: result.errorCount,
          durationMs,
          remainingInQueue: this.queue.length,
        },
        "Batch processing complete"
      );

      if (result.errorCount > 0) {
        this.logger.warn(
          {
            errorCount: result.errorCount,
            errors: result.errors.map((e) => ({
              path: e.change.relativePath,
              error: e.error,
            })),
          },
          "Some items in batch had errors"
        );
      }
    } catch (error: unknown) {
      // Batch failed entirely after retries
      const durationMs = Date.now() - batchStartTime;
      this.totalErrors += batch.length;
      this.totalBatches++;
      this.totalBatchDurationMs += durationMs;

      this.batchRecords.push({
        completedAt: Date.now(),
        processedCount: 0,
        durationMs,
      });

      this.logger.error(
        { error, batchSize: batch.length, durationMs },
        "Batch processing failed after all retries"
      );
    } finally {
      this.processing = false;
    }

    // Chain to next batch if items remain
    if (this.queue.length > 0) {
      if (this.state === "draining" || this.state === "processing") {
        // Process next batch immediately
        await this.processNextBatch();
      }
    } else {
      // Queue is empty
      if (this.state === "draining" && this.drainPromiseResolve) {
        this.drainPromiseResolve();
      } else if (this.state === "processing") {
        this.state = "idle";
      }
    }
  }

  /**
   * Process a batch with retry logic.
   *
   * Attempts processing up to maxRetries + 1 times. On failure, waits
   * retryDelayMs before the next attempt.
   *
   * @param batch - Array of changes to process
   * @returns Result from the successful processing attempt
   * @throws BatchProcessingError if all attempts fail
   */
  private async processWithRetry(batch: DetectedChange[]): Promise<BatchProcessorResult> {
    const maxAttempts = this.config.maxRetries + 1;
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this.processor(batch);
      } catch (error: unknown) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < maxAttempts) {
          this.logger.warn(
            {
              attempt,
              maxAttempts,
              retryDelayMs: this.config.retryDelayMs,
              error: lastError.message,
            },
            "Batch processing attempt failed, retrying"
          );

          await this.delay(this.config.retryDelayMs);
        }
      }
    }

    throw new BatchProcessingError(
      batch.length,
      maxAttempts,
      lastError?.message ?? "Unknown error",
      false,
      lastError
    );
  }

  // =========================================================================
  // Metrics Calculation
  // =========================================================================

  /**
   * Calculate the processing rate (events/second) over a rolling 60-second window.
   */
  private calculateProcessingRate(): number {
    const now = Date.now();
    const windowStart = now - RATE_WINDOW_MS;

    // Prune old records
    this.batchRecords = this.batchRecords.filter((r) => r.completedAt >= windowStart);

    if (this.batchRecords.length === 0) {
      return 0;
    }

    const totalProcessedInWindow = this.batchRecords.reduce((sum, r) => sum + r.processedCount, 0);

    // Calculate rate over the actual window duration
    const oldestRecord = this.batchRecords[0] as BatchRecord | undefined;
    if (!oldestRecord) {
      return 0;
    }
    const windowDurationMs = now - oldestRecord.completedAt;

    if (windowDurationMs <= 0) {
      return totalProcessedInWindow; // All in same millisecond, return count as rate
    }

    return (totalProcessedInWindow / windowDurationMs) * 1000;
  }

  /**
   * Calculate the average batch processing duration.
   */
  private calculateAverageBatchDuration(): number {
    if (this.totalBatches === 0) {
      return 0;
    }
    return this.totalBatchDurationMs / this.totalBatches;
  }

  // =========================================================================
  // Utilities
  // =========================================================================

  /**
   * Await a delay (for retry backoff).
   *
   * @param ms - Milliseconds to wait
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
