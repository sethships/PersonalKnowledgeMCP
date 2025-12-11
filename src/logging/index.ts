/**
 * Logging Module - Public API
 *
 * This module provides structured logging infrastructure for the Personal Knowledge MCP project.
 * Built on Pino with automatic secret redaction and component-based context.
 *
 * ## Quick Start
 *
 * ```typescript
 * // 1. Initialize logger at app startup (once)
 * import { initializeLogger } from './logging/index.js';
 *
 * initializeLogger({
 *   level: (process.env.LOG_LEVEL as LogLevel) || 'info',
 *   format: (process.env.LOG_FORMAT as 'json' | 'pretty') || 'pretty'
 * });
 *
 * // 2. Get a component logger in your modules
 * import { getComponentLogger } from './logging/index.js';
 *
 * const logger = getComponentLogger('mcp-server');
 * logger.info('Server started');
 * logger.error({ err }, 'Operation failed');
 * ```
 *
 * ## Features
 *
 * - **Structured Logging**: JSON format for production, pretty-print for development
 * - **Secret Redaction**: Automatic redaction of API keys, tokens, and passwords
 * - **Component Context**: Child loggers with automatic component name in all logs
 * - **MCP Compatible**: All logs to stderr (stdout reserved for MCP protocol)
 * - **Request Tracing**: Optional request IDs for correlation
 * - **Metric Logging**: Lightweight metrics as structured log events
 *
 * ## Environment Variables
 *
 * - `LOG_LEVEL`: Log level (fatal|error|warn|info|debug|trace) - default: info
 * - `LOG_FORMAT`: Output format (json|pretty) - default: pretty
 *
 * @module logging
 */

// Export all types
export * from "./types.js";

// Export logger initialization and factory functions
export {
  initializeLogger,
  getComponentLogger,
  getRootLogger,
  resetLogger,
} from "./logger-factory.js";

// Export redaction utilities (useful for tests and custom sanitization)
export {
  REDACT_PATHS,
  REDACT_OPTIONS,
  SECRET_PATTERNS,
  looksLikeSecret,
  sanitizeError,
} from "./redactors.js";
