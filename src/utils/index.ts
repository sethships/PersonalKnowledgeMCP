/**
 * Utilities module exports
 *
 * This module provides reusable utility functions for the application.
 */

// Debounce utilities for batching rapid events
export {
  createDebouncedBatcher,
  createDebounceConfigFromEnv,
  validateDebounceConfig,
  DEFAULT_DEBOUNCE_CONFIG,
  MIN_DEBOUNCE_MS,
  MAX_DEBOUNCE_MS,
} from "./debounce.js";
export type { DebounceConfig, DebounceOptions, DebouncedFunction } from "./debounce.js";

// Retry utilities for error handling with exponential backoff
export {
  withRetry,
  defaultExponentialBackoff,
  createRetryConfigFromEnv,
  createExponentialBackoff,
  createRetryLogger,
  createRetryOptions,
  DEFAULT_RETRY_CONFIG,
} from "./retry.js";
export type { RetryConfig, RetryOptions } from "./retry.js";

// Git URL parsing utilities
export { parseGitHubUrl } from "./git-url-parser.js";
export type { ParsedGitHubUrl } from "./git-url-parser.js";
