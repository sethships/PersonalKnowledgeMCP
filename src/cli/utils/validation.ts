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
  check: z.boolean().optional(),
  metrics: z.boolean().optional(),
});

/**
 * Schema for remove command options
 */
export const RemoveCommandOptionsSchema = z.object({
  force: z.boolean().optional(),
  deleteFiles: z.boolean().optional(),
});

/**
 * Schema for update command options
 */
export const UpdateCommandOptionsSchema = z.object({
  force: z.boolean().optional(),
  json: z.boolean().optional(),
  verbose: z.boolean().optional(),
});

/**
 * Schema for update-all command options
 */
export const UpdateAllCommandOptionsSchema = z.object({
  json: z.boolean().optional(),
});

/**
 * Schema for history command options
 */
export const HistoryCommandOptionsSchema = z.object({
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
  json: z.boolean().optional(),
});

/**
 * Inferred TypeScript types from schemas
 */
export type ValidatedIndexOptions = z.infer<typeof IndexCommandOptionsSchema>;
export type ValidatedSearchOptions = z.infer<typeof SearchCommandOptionsSchema>;
export type ValidatedStatusOptions = z.infer<typeof StatusCommandOptionsSchema>;
export type ValidatedRemoveOptions = z.infer<typeof RemoveCommandOptionsSchema>;
export type ValidatedUpdateOptions = z.infer<typeof UpdateCommandOptionsSchema>;
export type ValidatedUpdateAllOptions = z.infer<typeof UpdateAllCommandOptionsSchema>;
export type ValidatedHistoryOptions = z.infer<typeof HistoryCommandOptionsSchema>;

/**
 * Schema for reset-update command options
 */
export const ResetUpdateCommandOptionsSchema = z.object({
  force: z.boolean().optional(),
  recover: z.boolean().optional(),
  json: z.boolean().optional(),
});

export type ValidatedResetUpdateOptions = z.infer<typeof ResetUpdateCommandOptionsSchema>;

// ============================================================================
// Token Command Validation Schemas
// ============================================================================

/**
 * Valid token scopes
 */
const TokenScopeEnum = z.enum(["read", "write", "admin"]);

/**
 * Valid instance access levels
 */
const InstanceAccessEnum = z.enum(["private", "work", "public"]);

/**
 * Parse duration string to seconds
 *
 * Supported formats: "30d", "1y", "12h", "2w", "3m", "never", ""
 *
 * @param value - Duration string
 * @returns Number of seconds or null for "never"
 * @throws Error if format is invalid
 */
function parseDuration(value: string): number | null {
  if (value === "never" || value === "") {
    return null;
  }

  const match = value.match(/^(\d+)(h|d|w|m|y)$/);
  if (!match || !match[1] || !match[2]) {
    throw new Error(
      `Invalid duration format: "${value}". Use formats like "30d", "1y", "12h", "2w", "3m", or "never".`
    );
  }

  const num = parseInt(match[1], 10);
  const unit = match[2] as "h" | "d" | "w" | "m" | "y";

  const multipliers: Record<"h" | "d" | "w" | "m" | "y", number> = {
    h: 3600, // hours
    d: 86400, // days
    w: 604800, // weeks
    m: 2592000, // months (30 days)
    y: 31536000, // years (365 days)
  };

  return num * multipliers[unit];
}

/**
 * Schema for token create command options
 */
export const TokenCreateCommandOptionsSchema = z.object({
  name: z
    .string()
    .min(1, "Token name is required")
    .max(100, "Token name cannot exceed 100 characters")
    .regex(
      /^[a-zA-Z0-9 _.-]+$/,
      "Token name can only contain alphanumeric characters, spaces, underscores, hyphens, and periods"
    ),
  scopes: z
    .string()
    .optional()
    .default("read")
    .transform((val) => val.split(",").map((s) => s.trim().toLowerCase()))
    .pipe(
      z
        .array(TokenScopeEnum)
        .min(1, "At least one scope is required")
        .refine(
          (scopes) => {
            const unique = new Set(scopes);
            return unique.size === scopes.length;
          },
          { message: "Duplicate scopes are not allowed" }
        )
    ),
  instances: z
    .string()
    .optional()
    .default("public")
    .transform((val) => val.split(",").map((s) => s.trim().toLowerCase()))
    .pipe(
      z
        .array(InstanceAccessEnum)
        .min(1, "At least one instance access level is required")
        .refine(
          (instances) => {
            const unique = new Set(instances);
            return unique.size === instances.length;
          },
          { message: "Duplicate instance access levels are not allowed" }
        )
    ),
  expires: z
    .string()
    .optional()
    .default("never")
    .transform((val) => {
      try {
        return parseDuration(val);
      } catch (error) {
        throw new z.ZodError([
          {
            code: z.ZodIssueCode.custom,
            message: error instanceof Error ? error.message : String(error),
            path: ["expires"],
          },
        ]);
      }
    }),
});

/**
 * Schema for token list command options
 */
export const TokenListCommandOptionsSchema = z.object({
  json: z.boolean().optional(),
  all: z.boolean().optional(),
});

/**
 * Schema for token revoke command options
 */
export const TokenRevokeCommandOptionsSchema = z
  .object({
    name: z.string().optional(),
    id: z
      .string()
      .optional()
      .refine(
        (val) => !val || val.length >= 8,
        "Hash prefix must be at least 8 characters for safety"
      ),
    force: z.boolean().optional(),
  })
  .refine((data) => data.name || data.id, {
    message: "Either --name or --id must be provided",
    path: ["name"],
  });

/**
 * Schema for token rotate command options
 */
export const TokenRotateCommandOptionsSchema = z.object({
  name: z
    .string()
    .min(1, "Token name is required")
    .max(100, "Token name cannot exceed 100 characters"),
});

/**
 * Inferred TypeScript types for token commands
 */
export type ValidatedTokenCreateOptions = z.infer<typeof TokenCreateCommandOptionsSchema>;
export type ValidatedTokenListOptions = z.infer<typeof TokenListCommandOptionsSchema>;
export type ValidatedTokenRevokeOptions = z.infer<typeof TokenRevokeCommandOptionsSchema>;
export type ValidatedTokenRotateOptions = z.infer<typeof TokenRotateCommandOptionsSchema>;
