/**
 * Input validation schemas for SearchService
 *
 * This module provides Zod schemas for runtime validation of search queries.
 */

import { z } from "zod";

/**
 * Zod schema for SearchQuery input validation
 *
 * Enforces:
 * - Query text: 1-1000 characters (non-empty after trim)
 * - Limit: 1-50 integer (defaults to 10)
 * - Threshold: 0.0-1.0 float (defaults to 0.7)
 * - Repository: Optional string (validated separately for existence)
 */
export const SearchQuerySchema = z
  .object({
    query: z
      .string()
      .trim()
      .min(1, "Query must not be empty")
      .max(1000, "Query must not exceed 1000 characters"),

    limit: z
      .number()
      .int("Limit must be an integer")
      .min(1, "Limit must be at least 1")
      .max(50, "Limit must not exceed 50")
      .default(10),

    threshold: z
      .number()
      .min(0.0, "Threshold must be at least 0.0")
      .max(1.0, "Threshold must not exceed 1.0")
      .default(0.7),

    repository: z.string().trim().min(1, "Repository name must not be empty").optional(),

    language: z.string().trim().min(1, "Language must not be empty").optional(),
  })
  .strict(); // Disallow extra properties

/**
 * Validated SearchQuery type after Zod parsing
 */
export type ValidatedSearchQuery = z.infer<typeof SearchQuerySchema>;
