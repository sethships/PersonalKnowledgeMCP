/**
 * @module services/change-detection-validation
 *
 * Zod validation schemas for ChangeDetectionService inputs.
 *
 * This module provides runtime validation for change detection configuration
 * using Zod schemas, following the pattern from folder-watcher-validation.ts.
 */

import { z } from "zod";

// =============================================================================
// Configuration Schema
// =============================================================================

/**
 * Schema for validating ChangeDetectionService configuration.
 */
export const ChangeDetectionConfigSchema = z.object({
  /**
   * Time window in milliseconds to correlate unlink+add as a rename.
   * @minimum 50
   * @maximum 5000
   */
  renameWindowMs: z
    .number()
    .min(50, "Rename window must be at least 50ms")
    .max(5000, "Rename window must be at most 5000ms")
    .optional(),

  /**
   * Whether to capture and track file states.
   */
  enableStateTracking: z.boolean().optional(),
});

/**
 * Type for validated change detection configuration.
 */
export type ValidatedChangeDetectionConfig = z.infer<typeof ChangeDetectionConfigSchema>;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Validate change detection configuration.
 *
 * @param config - Configuration to validate
 * @returns Validated configuration
 * @throws z.ZodError if validation fails
 */
export function validateChangeDetectionConfig(config: unknown): ValidatedChangeDetectionConfig {
  return ChangeDetectionConfigSchema.parse(config);
}

/**
 * Safe validation that returns result instead of throwing.
 *
 * @param config - Configuration to validate
 * @returns SafeParseResult with success/failure and data/error
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function safeValidateChangeDetectionConfig(config: unknown) {
  return ChangeDetectionConfigSchema.safeParse(config);
}
