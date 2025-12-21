/**
 * Error Guidance Module
 *
 * Maps common error patterns to actionable user guidance for partial failure handling.
 * Used by CLI commands to provide helpful suggestions when file processing errors occur.
 *
 * @module cli/utils/error-guidance
 */

/**
 * Error pattern with associated user guidance
 */
export interface ErrorGuidanceEntry {
  /** Regular expression pattern to match against error messages */
  pattern: RegExp;
  /** Short actionable guidance for the user */
  guidance: string;
}

/**
 * Collection of error patterns mapped to actionable guidance.
 *
 * Patterns are checked in order; first match wins.
 * Patterns use case-insensitive matching by default.
 */
export const ERROR_GUIDANCE: ErrorGuidanceEntry[] = [
  // File system errors
  {
    pattern: /ENOENT|no such file or directory/i,
    guidance: "File was deleted between pull and processing. Safe to ignore.",
  },
  {
    pattern: /EACCES|permission denied/i,
    guidance: "Permission denied. Check file permissions.",
  },

  // Parsing/syntax errors
  {
    pattern: /Unexpected token|syntax error|SyntaxError/i,
    guidance: "Source file has syntax errors. Fix the file and retry.",
  },
  {
    pattern: /Failed to chunk|chunking error/i,
    guidance: "File could not be split into chunks. Check file format.",
  },

  // Size limits
  {
    pattern: /File too large|exceeds.*limit|size limit/i,
    guidance: "File exceeds size limit. Add to excludePatterns or increase limit.",
  },

  // API rate limits
  {
    pattern: /rate limit|429|too many requests/i,
    guidance: "Rate limited by API. Wait 60 seconds and retry.",
  },

  // Security
  {
    pattern: /Path traversal/i,
    guidance: "Security issue detected. Investigate repository for malicious paths.",
  },

  // Embedding/OpenAI errors
  {
    pattern: /embedding.*failed|openai.*error|OPENAI/i,
    guidance: "Embedding API error. Check OPENAI_API_KEY and API status.",
  },
  {
    pattern: /401|unauthorized|invalid.*key/i,
    guidance: "API authentication failed. Verify API key is valid.",
  },

  // ChromaDB/storage errors
  {
    pattern: /chroma|chromadb|connection.*refused/i,
    guidance: "ChromaDB connection issue. Verify it's running: docker ps",
  },
  {
    pattern: /batch embedding.*storage|upsert.*failed/i,
    guidance: "Batch storage failed. Check ChromaDB connection and retry.",
  },

  // Network errors
  {
    pattern: /ECONNREFUSED|ETIMEDOUT|network|socket hang up/i,
    guidance: "Network error. Check connectivity and retry.",
  },

  // Renamed file missing previousPath
  {
    pattern: /Renamed file missing previousPath/i,
    guidance: "Renamed file missing old path info. Re-run full re-index with --force.",
  },
];

/**
 * Get actionable guidance for an error message.
 *
 * Checks the error message against known patterns and returns
 * user-friendly guidance if a match is found.
 *
 * @param errorMessage - The error message to analyze
 * @returns Guidance string if a pattern matches, undefined otherwise
 *
 * @example
 * ```typescript
 * const guidance = getErrorGuidance("ENOENT: no such file or directory");
 * // Returns: "File was deleted between pull and processing. Safe to ignore."
 *
 * const unknown = getErrorGuidance("Some unknown error");
 * // Returns: undefined
 * ```
 */
export function getErrorGuidance(errorMessage: string): string | undefined {
  for (const entry of ERROR_GUIDANCE) {
    if (entry.pattern.test(errorMessage)) {
      return entry.guidance;
    }
  }
  return undefined;
}
