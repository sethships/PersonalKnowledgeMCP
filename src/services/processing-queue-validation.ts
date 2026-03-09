/**
 * @module services/processing-queue-validation
 *
 * Zod validation schemas for ProcessingQueue configuration.
 *
 * This module provides runtime validation for queue configuration
 * using Zod schemas, following the pattern from change-detection-validation.ts.
 */

import { z } from "zod";

// =============================================================================
// Configuration Schema
// =============================================================================

/**
 * Schema for validating ProcessingQueue configuration.
 */
export const ProcessingQueueConfigSchema = z
  .object({
    /**
     * Maximum number of changes to process in a single batch.
     * @minimum 1
     * @maximum 1000
     */
    maxBatchSize: z
      .number()
      .int("maxBatchSize must be an integer")
      .min(1, "maxBatchSize must be at least 1")
      .max(1000, "maxBatchSize must be at most 1000")
      .optional(),

    /**
     * Maximum number of changes the queue can hold.
     * @minimum 1
     * @maximum 100000
     */
    maxQueueSize: z
      .number()
      .int("maxQueueSize must be an integer")
      .min(1, "maxQueueSize must be at least 1")
      .max(100000, "maxQueueSize must be at most 100000")
      .optional(),

    /**
     * Debounce delay in milliseconds before processing a batch.
     * @minimum 100
     * @maximum 300000
     */
    batchDelayMs: z
      .number()
      .int("batchDelayMs must be an integer")
      .min(100, "batchDelayMs must be at least 100ms")
      .max(300000, "batchDelayMs must be at most 300000ms")
      .optional(),

    /**
     * Maximum wait time in milliseconds before force-processing.
     * @minimum 100
     * @maximum 300000
     */
    maxBatchWaitMs: z
      .number()
      .int("maxBatchWaitMs must be an integer")
      .min(100, "maxBatchWaitMs must be at least 100ms")
      .max(300000, "maxBatchWaitMs must be at most 300000ms")
      .optional(),

    /**
     * Maximum number of retry attempts for a failed batch.
     * @minimum 0
     * @maximum 10
     */
    maxRetries: z
      .number()
      .int("maxRetries must be an integer")
      .min(0, "maxRetries must be at least 0")
      .max(10, "maxRetries must be at most 10")
      .optional(),

    /**
     * Delay in milliseconds between retry attempts.
     * @minimum 100
     * @maximum 60000
     */
    retryDelayMs: z
      .number()
      .int("retryDelayMs must be an integer")
      .min(100, "retryDelayMs must be at least 100ms")
      .max(60000, "retryDelayMs must be at most 60000ms")
      .optional(),

    /**
     * Maximum time in milliseconds to wait for graceful shutdown.
     * @minimum 1000
     * @maximum 300000
     */
    shutdownTimeoutMs: z
      .number()
      .int("shutdownTimeoutMs must be an integer")
      .min(1000, "shutdownTimeoutMs must be at least 1000ms")
      .max(300000, "shutdownTimeoutMs must be at most 300000ms")
      .optional(),
  })
  .refine(
    (data) => {
      // If both are provided, maxBatchWaitMs should be >= batchDelayMs
      if (data.batchDelayMs !== undefined && data.maxBatchWaitMs !== undefined) {
        return data.maxBatchWaitMs >= data.batchDelayMs;
      }
      return true;
    },
    {
      message: "maxBatchWaitMs must be greater than or equal to batchDelayMs",
      path: ["maxBatchWaitMs"],
    }
  )
  .refine(
    (data) => {
      // maxQueueSize should be >= maxBatchSize if both are provided
      if (data.maxQueueSize !== undefined && data.maxBatchSize !== undefined) {
        return data.maxQueueSize >= data.maxBatchSize;
      }
      return true;
    },
    {
      message: "maxQueueSize must be greater than or equal to maxBatchSize",
      path: ["maxQueueSize"],
    }
  );

/**
 * Type for validated processing queue configuration.
 */
export type ValidatedProcessingQueueConfig = z.infer<typeof ProcessingQueueConfigSchema>;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Validate processing queue configuration.
 *
 * @param config - Configuration to validate
 * @returns Validated configuration
 * @throws z.ZodError if validation fails
 */
export function validateProcessingQueueConfig(config: unknown): ValidatedProcessingQueueConfig {
  return ProcessingQueueConfigSchema.parse(config);
}

/**
 * Safe validation that returns result instead of throwing.
 *
 * @param config - Configuration to validate
 * @returns SafeParseResult with success/failure and data/error
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function safeValidateProcessingQueueConfig(config: unknown) {
  return ProcessingQueueConfigSchema.safeParse(config);
}
