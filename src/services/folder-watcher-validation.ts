/**
 * @module services/folder-watcher-validation
 *
 * Zod validation schemas for FolderWatcherService inputs.
 *
 * This module provides runtime validation for folder watcher configuration
 * and watch options using Zod schemas.
 */

import { z } from "zod";

// =============================================================================
// Watch Options Schema
// =============================================================================

/**
 * Schema for validating folder watch options
 */
export const WatchFolderOptionsSchema = z.object({
  /**
   * Absolute path to the folder to watch
   */
  path: z
    .string()
    .min(1, "Path is required")
    .refine(
      (path) => {
        // Basic path validation - must be absolute
        // Windows: C:\... or \\server\...
        // Unix: /...
        return /^([a-zA-Z]:[/\\]|[/\\]{2}|[/])/.test(path);
      },
      { message: "Path must be an absolute path" }
    ),

  /**
   * Display name for the folder
   */
  name: z.string().min(1, "Name is required").max(255, "Name must be 255 characters or less"),

  /**
   * Glob patterns for files to include
   * @example ["*.md", "*.txt", "*.pdf"]
   */
  includePatterns: z.array(z.string().min(1, "Pattern cannot be empty")).optional(),

  /**
   * Glob patterns for files to exclude
   * @example ["node_modules/**", ".git/**"]
   */
  excludePatterns: z.array(z.string().min(1, "Pattern cannot be empty")).optional(),

  /**
   * Debounce time in milliseconds
   * @minimum 100
   * @maximum 300000 (5 minutes)
   */
  debounceMs: z
    .number()
    .min(100, "Debounce must be at least 100ms")
    .max(300000, "Debounce must be at most 300000ms (5 minutes)")
    .optional(),
});

/**
 * Type for validated watch folder options
 */
export type ValidatedWatchFolderOptions = z.infer<typeof WatchFolderOptionsSchema>;

// =============================================================================
// Configuration Schema
// =============================================================================

/**
 * Schema for validating FolderWatcherService configuration
 */
export const FolderWatcherConfigSchema = z.object({
  /**
   * Default debounce time in milliseconds
   */
  defaultDebounceMs: z
    .number()
    .min(100, "Default debounce must be at least 100ms")
    .max(300000, "Default debounce must be at most 300000ms (5 minutes)")
    .optional(),

  /**
   * Maximum number of concurrent watchers
   */
  maxConcurrentWatchers: z
    .number()
    .min(1, "Must allow at least 1 concurrent watcher")
    .max(100, "Cannot exceed 100 concurrent watchers")
    .optional(),

  /**
   * Use polling mode for file watching
   */
  usePolling: z.boolean().optional(),

  /**
   * Polling interval in milliseconds
   */
  pollInterval: z
    .number()
    .min(100, "Poll interval must be at least 100ms")
    .max(60000, "Poll interval must be at most 60000ms (1 minute)")
    .optional(),

  /**
   * Whether to emit events for existing files when starting to watch
   */
  emitExistingFiles: z.boolean().optional(),
});

/**
 * Type for validated configuration
 */
export type ValidatedFolderWatcherConfig = z.infer<typeof FolderWatcherConfigSchema>;

// =============================================================================
// Folder ID Schema
// =============================================================================

/**
 * Schema for validating folder IDs (UUIDs)
 */
export const FolderIdSchema = z
  .string()
  .uuid("Folder ID must be a valid UUID")
  .or(z.string().min(1, "Folder ID is required")); // Allow non-UUID IDs for flexibility

/**
 * Type for validated folder ID
 */
export type ValidatedFolderId = z.infer<typeof FolderIdSchema>;

// =============================================================================
// Glob Pattern Schema
// =============================================================================

/**
 * Schema for validating glob patterns
 */
export const GlobPatternSchema = z
  .string()
  .min(1, "Pattern cannot be empty")
  .refine(
    (pattern) => {
      // Basic glob pattern validation
      // Reject obviously invalid patterns
      try {
        // Check for unmatched brackets
        let bracketDepth = 0;
        let braceDepth = 0;
        for (const char of pattern) {
          if (char === "[") bracketDepth++;
          if (char === "]") bracketDepth--;
          if (char === "{") braceDepth++;
          if (char === "}") braceDepth--;
          if (bracketDepth < 0 || braceDepth < 0) return false;
        }
        return bracketDepth === 0 && braceDepth === 0;
      } catch {
        return false;
      }
    },
    { message: "Invalid glob pattern syntax" }
  );

/**
 * Type for validated glob pattern
 */
export type ValidatedGlobPattern = z.infer<typeof GlobPatternSchema>;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Validate watch folder options
 *
 * @param options - Options to validate
 * @returns Validated options
 * @throws z.ZodError if validation fails
 */
export function validateWatchFolderOptions(options: unknown): ValidatedWatchFolderOptions {
  return WatchFolderOptionsSchema.parse(options);
}

/**
 * Validate folder watcher configuration
 *
 * @param config - Configuration to validate
 * @returns Validated configuration
 * @throws z.ZodError if validation fails
 */
export function validateFolderWatcherConfig(config: unknown): ValidatedFolderWatcherConfig {
  return FolderWatcherConfigSchema.parse(config);
}

/**
 * Safe validation that returns result instead of throwing
 *
 * @param options - Options to validate
 * @returns SafeParseResult with success/failure and data/error
 */
export function safeValidateWatchFolderOptions(
  options: unknown
): z.SafeParseReturnType<ValidatedWatchFolderOptions, ValidatedWatchFolderOptions> {
  return WatchFolderOptionsSchema.safeParse(options);
}

/**
 * Safe validation that returns result instead of throwing
 *
 * @param config - Configuration to validate
 * @returns SafeParseResult with success/failure and data/error
 */
export function safeValidateFolderWatcherConfig(
  config: unknown
): z.SafeParseReturnType<ValidatedFolderWatcherConfig, ValidatedFolderWatcherConfig> {
  return FolderWatcherConfigSchema.safeParse(config);
}
