/**
 * @module services/processing-queue-types
 *
 * Type definitions for the ProcessingQueue service.
 *
 * This module defines interfaces for queue configuration, state management,
 * metrics tracking, and batch processing callbacks. The ProcessingQueue sits
 * between ChangeDetectionService and IncrementalUpdatePipeline, batching
 * detected changes for efficient downstream processing.
 */

import type { DetectedChange } from "./change-detection-types.js";

// =============================================================================
// Queue State Types
// =============================================================================

/**
 * State machine for the processing queue lifecycle.
 *
 * Transitions:
 * - `idle` -> `processing`: When batch timer fires
 * - `processing` -> `idle`: When batch completes and queue is empty
 * - `processing` -> `processing`: When batch completes but more items remain
 * - `idle` | `processing` -> `draining`: When shutdown() is called
 * - `draining` -> `stopped`: When all items are processed or timeout expires
 * - any -> `stopped`: When forceStop() is called
 */
export type ProcessingQueueState = "idle" | "processing" | "draining" | "stopped";

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Configuration options for ProcessingQueue.
 *
 * All fields are optional; defaults are applied from DEFAULT_PROCESSING_QUEUE_CONFIG.
 *
 * @example
 * ```typescript
 * const config: ProcessingQueueConfig = {
 *   maxBatchSize: 100,
 *   batchDelayMs: 1000,
 *   maxRetries: 3
 * };
 * ```
 */
export interface ProcessingQueueConfig {
  /**
   * Maximum number of changes to process in a single batch.
   * @default 50
   * @minimum 1
   * @maximum 1000
   */
  maxBatchSize?: number;

  /**
   * Maximum number of changes the queue can hold before rejecting new items.
   * @default 1000
   * @minimum 1
   * @maximum 100000
   */
  maxQueueSize?: number;

  /**
   * Debounce delay in milliseconds before processing a batch.
   * Timer resets when new items arrive within this window.
   * @default 2000
   * @minimum 100
   * @maximum 300000
   */
  batchDelayMs?: number;

  /**
   * Maximum time in milliseconds to wait before force-processing a batch,
   * even if new items keep arriving.
   * @default 30000
   * @minimum 100
   * @maximum 300000
   */
  maxBatchWaitMs?: number;

  /**
   * Maximum number of retry attempts for a failed batch.
   * @default 2
   * @minimum 0
   * @maximum 10
   */
  maxRetries?: number;

  /**
   * Delay in milliseconds between retry attempts.
   * @default 5000
   * @minimum 100
   * @maximum 60000
   */
  retryDelayMs?: number;

  /**
   * Maximum time in milliseconds to wait for graceful shutdown.
   * After this timeout, remaining items are discarded.
   * @default 30000
   * @minimum 1000
   * @maximum 300000
   */
  shutdownTimeoutMs?: number;
}

/**
 * Default configuration values for ProcessingQueue.
 */
export const DEFAULT_PROCESSING_QUEUE_CONFIG: Required<ProcessingQueueConfig> = {
  maxBatchSize: 50,
  maxQueueSize: 1000,
  batchDelayMs: 2000,
  maxBatchWaitMs: 30000,
  maxRetries: 2,
  retryDelayMs: 5000,
  shutdownTimeoutMs: 30000,
};

// =============================================================================
// Batch Processing Types
// =============================================================================

/**
 * Result from processing a batch of detected changes.
 *
 * @example
 * ```typescript
 * const result: BatchProcessorResult = {
 *   processedCount: 48,
 *   errorCount: 2,
 *   errors: [
 *     { change: failedChange1, error: "File not found" },
 *     { change: failedChange2, error: "Permission denied" }
 *   ]
 * };
 * ```
 */
export interface BatchProcessorResult {
  /**
   * Number of changes successfully processed.
   */
  processedCount: number;

  /**
   * Number of changes that failed processing.
   */
  errorCount: number;

  /**
   * Details of individual change processing failures.
   */
  errors: Array<{ change: DetectedChange; error: string }>;
}

/**
 * Callback function for processing a batch of detected changes.
 *
 * The ProcessingQueue calls this function with accumulated changes.
 * The implementation is responsible for forwarding changes to the
 * IncrementalUpdatePipeline or other downstream consumers.
 *
 * @param changes - Array of detected changes to process
 * @returns Result indicating success/failure counts
 */
export type BatchProcessor = (changes: DetectedChange[]) => Promise<BatchProcessorResult>;

// =============================================================================
// Status and Metrics Types
// =============================================================================

/**
 * Current status snapshot of the processing queue.
 *
 * @example
 * ```typescript
 * const status = queue.getStatus();
 * console.log(`Queue state: ${status.state}, depth: ${status.queueDepth}`);
 * ```
 */
export interface ProcessingQueueStatus {
  /**
   * Current state machine state.
   */
  state: ProcessingQueueState;

  /**
   * Number of items currently in the queue.
   */
  queueDepth: number;

  /**
   * Whether a batch is currently being processed.
   */
  isProcessing: boolean;

  /**
   * Active configuration values (with defaults applied).
   */
  config: Required<ProcessingQueueConfig>;
}

/**
 * Performance and throughput metrics for the processing queue.
 *
 * Provides observability into queue behavior including depth, throughput,
 * error rates, and timing information.
 *
 * @example
 * ```typescript
 * const metrics = queue.getMetrics();
 * console.log(`Processing rate: ${metrics.processingRate.toFixed(1)} events/sec`);
 * console.log(`Queue depth: ${metrics.queueDepth}`);
 * console.log(`Error rate: ${(metrics.totalErrors / metrics.totalEnqueued * 100).toFixed(1)}%`);
 * ```
 */
export interface ProcessingQueueMetrics {
  /**
   * Current number of items waiting in the queue.
   */
  queueDepth: number;

  /**
   * Events processed per second over a rolling 60-second window.
   */
  processingRate: number;

  /**
   * Total number of items enqueued since creation.
   */
  totalEnqueued: number;

  /**
   * Total number of items successfully processed.
   */
  totalProcessed: number;

  /**
   * Total number of batches processed.
   */
  totalBatches: number;

  /**
   * Total number of individual item processing errors.
   */
  totalErrors: number;

  /**
   * Average batch processing duration in milliseconds.
   * Zero if no batches have been processed.
   */
  averageBatchDurationMs: number;

  /**
   * Highest queue depth observed since creation.
   */
  peakQueueDepth: number;
}
