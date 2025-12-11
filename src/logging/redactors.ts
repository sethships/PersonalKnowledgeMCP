/**
 * Secret Redaction Configuration
 *
 * This module defines patterns for automatically redacting sensitive information from logs.
 * Implements defense-in-depth: path-based redaction catches known locations,
 * heuristic patterns catch unexpected leaks.
 *
 * @module logging/redactors
 */

/**
 * Paths to redact from log objects
 *
 * Uses Pino's redaction path syntax:
 * - Dot notation for nested objects: "env.OPENAI_API_KEY"
 * - Wildcard for any level: "*.apiKey" matches obj.foo.apiKey
 * - Array notation: "users[*].password"
 *
 * These paths are checked on every log entry and replaced with [REDACTED]
 */
export const REDACT_PATHS = [
  // Environment variables
  "env.OPENAI_API_KEY",
  "env.GITHUB_PAT",
  "env.DATABASE_URL",
  "env.AWS_SECRET_ACCESS_KEY",
  "env.AZURE_CLIENT_SECRET",

  // HTTP headers
  "headers.authorization",
  "headers.Authorization",
  "req.headers.authorization",
  "res.headers.authorization",

  // Common secret field names (wildcard matching)
  "*.apiKey",
  "*.api_key",
  "*.password",
  "*.token",
  "*.secret",
  "*.pat",
  "*.accessToken",
  "*.access_token",
  "*.refreshToken",
  "*.refresh_token",
  "*.privateKey",
  "*.private_key",
  "*.credentials",
  "*.connectionString",
  "*.secretKey",

  // Query parameters that might contain secrets
  "query.token",
  "query.apiKey",
  "query.api_key",
];

/**
 * Pino redaction options
 *
 * Configuration for Pino's built-in redaction feature.
 * See: https://getpino.io/#/docs/redaction
 */
export const REDACT_OPTIONS = {
  /**
   * Paths to redact (see REDACT_PATHS above)
   */
  paths: REDACT_PATHS,

  /**
   * Replacement text for redacted values
   * Using [REDACTED] makes it obvious in logs that redaction occurred
   */
  censor: "[REDACTED]",

  /**
   * Keep the key, just replace the value
   * This maintains log structure while hiding secrets
   */
  remove: false,
} as const;

/**
 * Heuristic patterns to detect potential secrets in string values
 *
 * These regex patterns catch secrets that might not be in known fields.
 * Used for additional validation in tests, not runtime redaction.
 */
export const SECRET_PATTERNS = {
  /**
   * OpenAI API key format: sk-proj-... or sk-...
   * @example "sk-proj-abc123def456..." or "sk-abc123def456..."
   */
  openai: /^sk-(?:proj-)?[A-Za-z0-9_-]{32,}$/,

  /**
   * GitHub Personal Access Token (classic): ghp_...
   * @example "ghp_abc123def456ghi789..."
   */
  githubPat: /^ghp_[A-Za-z0-9]{36,}$/,

  /**
   * GitHub Fine-Grained PAT: github_pat_...
   * @example "github_pat_abc123..."
   */
  githubFinePat: /^github_pat_[A-Za-z0-9_]{82}$/,

  /**
   * JWT token format (base64.base64.base64)
   * @example "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOi..."
   */
  jwt: /^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,

  /**
   * Generic API key pattern: long alphanumeric string
   * @example 32+ character strings that look like keys
   */
  genericApiKey: /^[A-Za-z0-9_-]{32,}$/,
} as const;

/**
 * Check if a string value looks like a secret
 *
 * This is a heuristic check, not perfect, but helps catch accidental leaks.
 * Used primarily in tests to validate redaction is working.
 *
 * @param value - String to check
 * @returns true if value matches known secret patterns
 *
 * @example
 * ```typescript
 * looksLikeSecret("sk-proj-abc123...") // true
 * looksLikeSecret("hello world") // false
 * looksLikeSecret("ghp_abc123...") // true
 * ```
 */
export function looksLikeSecret(value: string): boolean {
  return Object.values(SECRET_PATTERNS).some((pattern) => pattern.test(value));
}

/**
 * Sanitize an error object for safe logging
 *
 * Redacts common secret fields while preserving error structure.
 *
 * **IMPORTANT LIMITATION**: This function does NOT scan error messages or stack
 * traces for embedded secrets. If secrets are included in error message strings
 * (e.g., `new Error("Failed with key sk-proj-...")`), they will NOT be redacted.
 *
 * Best practice: Never include secrets in error messages. Use structured error
 * properties instead, which will be caught by path-based redaction.
 *
 * @param error - Error object to sanitize
 * @returns Sanitized error object safe for logging
 *
 * @example
 * ```typescript
 * const err = new Error("Connection failed");
 * err.cause = new Error("Auth failed");
 * const safe = sanitizeError(err);
 *
 * // ❌ BAD: Secret in message - will NOT be redacted
 * const bad = new Error("Failed with key sk-proj-abc123...");
 *
 * // ✅ GOOD: Secret in property - will be redacted by path patterns
 * const good = new Error("Failed to authenticate");
 * (good as any).apiKey = "sk-proj-abc123..."; // Redacted by *.apiKey pattern
 * ```
 */
export function sanitizeError(error: Error): Record<string, unknown> {
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    cause: error.cause ? sanitizeError(error.cause as Error) : undefined,
    // Any additional properties on the error
    ...Object.fromEntries(
      Object.entries(error).filter(([key]) => !["name", "message", "stack", "cause"].includes(key))
    ),
  };
}
