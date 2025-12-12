/**
 * Runtime validation schemas for CLI command options
 *
 * Uses Zod for type-safe runtime validation of Commander.js options.
 */

import { z } from "zod";

/**
 * Schema for index command options
 */
export const IndexCommandOptionsSchema = z.object({
  name: z.string().optional(),
  branch: z.string().optional(),
  force: z.boolean().optional(),
});

/**
 * Schema for search command options
 */
export const SearchCommandOptionsSchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 10))
    .pipe(
      z
        .number()
        .int()
        .min(1)
        .max(100)
        .refine((n) => !isNaN(n), {
          message: "limit must be a valid number between 1-100",
        })
    ),
  threshold: z
    .string()
    .optional()
    .transform((val) => (val ? parseFloat(val) : 0.7))
    .pipe(
      z
        .number()
        .min(0)
        .max(1)
        .refine((n) => !isNaN(n), {
          message: "threshold must be a valid number between 0.0-1.0",
        })
    ),
  repo: z.string().optional(),
  json: z.boolean().optional(),
});

/**
 * Schema for status command options
 */
export const StatusCommandOptionsSchema = z.object({
  json: z.boolean().optional(),
});

/**
 * Schema for remove command options
 */
export const RemoveCommandOptionsSchema = z.object({
  force: z.boolean().optional(),
  deleteFiles: z.boolean().optional(),
});

/**
 * Inferred TypeScript types from schemas
 */
export type ValidatedIndexOptions = z.infer<typeof IndexCommandOptionsSchema>;
export type ValidatedSearchOptions = z.infer<typeof SearchCommandOptionsSchema>;
export type ValidatedStatusOptions = z.infer<typeof StatusCommandOptionsSchema>;
export type ValidatedRemoveOptions = z.infer<typeof RemoveCommandOptionsSchema>;
