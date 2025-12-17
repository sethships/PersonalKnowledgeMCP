/**
 * Logging Types and Interfaces
 *
 * This module defines TypeScript types and interfaces for the structured logging system.
 * The log schema is designed to be OpenTelemetry-compatible for future migration.
 *
 * @module logging/types
 */

/**
 * Log levels supported by the logger
 *
 * Ordered from highest to lowest severity:
 * - silent: Suppress all logging (typically used in tests)
 * - fatal: Application crash, requires immediate attention
 * - error: Error events that might still allow the application to continue
 * - warn: Warning events indicating potential issues
 * - info: Informational messages highlighting progress (default)
 * - debug: Detailed information for debugging
 * - trace: Very detailed information, typically for development only
 */
export type LogLevel = "silent" | "fatal" | "error" | "warn" | "info" | "debug" | "trace";

/**
 * Logger configuration
 *
 * Controls logger behavior including log level filtering and output format.
 */
export interface LoggerConfig {
  /**
   * Minimum log level to output
   * @default "info"
   */
  level: LogLevel;

  /**
   * Log output format
   * - json: Structured JSON for production/log aggregation
   * - pretty: Human-readable colorized output for development
   * @default "pretty"
   */
  format: "json" | "pretty";

  /**
   * Optional custom output stream for testing
   * When provided, logs will be written to this stream instead of stderr
   * @internal - Only used in tests for log capture
   */
  stream?: NodeJS.WritableStream;
}

/**
 * Component context for child loggers
 *
 * Provides automatic context propagation to all logs from a component.
 */
export interface ComponentContext {
  /**
   * Component name (e.g., "mcp-server", "storage:chromadb", "cli")
   *
   * Use colon notation for hierarchical components:
   * - "storage:chromadb" - ChromaDB storage client
   * - "mcp:tools" - MCP tool handlers
   * - "ingestion:cloner" - Repository cloner
   */
  component: string;

  /**
   * Optional request/correlation ID for tracing
   *
   * When set, automatically included in all logs from this component.
   * Maps to OpenTelemetry trace.id for future compatibility.
   */
  requestId?: string;
}

/**
 * Structured log entry format
 *
 * This interface documents the expected log output structure.
 * OpenTelemetry-compatible field naming for future migration.
 */
export interface LogEntry {
  /**
   * ISO 8601 timestamp
   * @example "2025-12-11T15:30:45.123Z"
   */
  timestamp: string;

  /**
   * Log level name
   * @example "info", "error", "warn"
   */
  level: string;

  /**
   * Component name that generated the log
   * Maps to OpenTelemetry service.name
   * @example "storage:chromadb", "mcp-server"
   */
  component: string;

  /**
   * Log message
   * @example "Search completed", "Connection established"
   */
  msg: string;

  /**
   * Optional request/correlation ID for tracing
   * Maps to OpenTelemetry trace.id
   * @example "req-abc123"
   */
  requestId?: string;

  /**
   * Additional structured data
   *
   * Can include:
   * - Operation details (query parameters, file counts, etc.)
   * - Performance metrics (duration_ms, batch_size, etc.)
   * - Error information (error_type, error_code, stack trace)
   */
  [key: string]: unknown;
}

/**
 * Metric log entry for lightweight metrics tracking
 *
 * Emits key performance metrics as structured log events.
 * Can be aggregated later with log analysis tools or migrated to proper metrics.
 */
export interface MetricLogEntry extends LogEntry {
  /**
   * Metric name
   * @example "search.duration_ms", "error.count", "index.duration_ms"
   */
  metric: string;

  /**
   * Metric value
   * For durations: milliseconds
   * For counts: integer
   * @example 145, 5, 45230
   */
  value: number;
}
