/**
 * MCP input validation
 *
 * This module provides Zod schemas and validation functions for MCP tool arguments.
 * Validation happens at the MCP layer before calling the SearchService to enforce
 * MCP-specific constraints (e.g., character limits, parameter ranges).
 */

import { z } from "zod";
import { createValidationError } from "./errors.js";
import type { SemanticSearchArgs } from "./types.js";

/**
 * Zod schema for semantic_search tool arguments
 *
 * This schema:
 * - Enforces MCP tool contract (char limits, ranges)
 * - Provides default values for optional parameters
 * - Generates type-safe validation errors
 *
 * Aligns with the inputSchema in semantic_search tool definition.
 */
export const SemanticSearchArgsSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1, "Query cannot be empty")
    .max(1000, "Query exceeds maximum length of 1000 characters"),

  limit: z
    .number()
    .int("Limit must be an integer")
    .min(1, "Limit must be at least 1")
    .max(50, "Limit cannot exceed 50")
    .optional()
    .default(10),

  threshold: z
    .number()
    .min(0.0, "Threshold must be between 0.0 and 1.0")
    .max(1.0, "Threshold must be between 0.0 and 1.0")
    .optional()
    .default(0.7),

  repository: z
    .string()
    .trim()
    .min(1, "Repository name cannot be empty")
    .optional(),
}).strict();

/**
 * Validates and parses semantic_search tool arguments
 *
 * This function:
 * - Validates arguments against SemanticSearchArgsSchema
 * - Applies default values for optional parameters
 * - Throws MCP InvalidParams error if validation fails
 *
 * @param args - Raw arguments from MCP CallTool request
 * @returns Validated and normalized arguments with defaults applied
 * @throws {McpError} If validation fails (ErrorCode.InvalidParams)
 *
 * @example
 * ```typescript
 * const args = validateSemanticSearchArgs({
 *   query: "find authentication code",
 *   limit: 20
 * });
 * // args.limit === 20
 * // args.threshold === 0.7 (default)
 * ```
 */
export function validateSemanticSearchArgs(args: unknown): SemanticSearchArgs {
  const result = SemanticSearchArgsSchema.safeParse(args);

  if (!result.success) {
    // Format Zod errors into human-readable message
    const errorMessage = result.error.errors
      .map((e) => {
        const path = e.path.length > 0 ? `${e.path.join(".")}: ` : "";
        return `${path}${e.message}`;
      })
      .join("; ");

    throw createValidationError(`Invalid semantic_search arguments: ${errorMessage}`);
  }

  return result.data;
}
