/**
 * Logger Factory
 *
 * This module provides the core logging infrastructure using Pino.
 * Handles logger creation, configuration, and component-scoped child loggers.
 *
 * Key features:
 * - Outputs to stderr (stdout reserved for MCP protocol)
 * - Automatic secret redaction
 * - JSON format for production, pretty-print for development
 * - Component-based child loggers with automatic context
 *
 * @module logging/logger-factory
 */

import pino from "pino";
import type { LoggerConfig, ComponentContext } from "./types.js";
import { REDACT_OPTIONS } from "./redactors.js";

/**
 * Singleton root logger instance
 * Initialized once at application startup
 */
let rootLogger: pino.Logger | null = null;

/**
 * Create the root Pino logger with full configuration
 *
 * This is the base logger from which all component loggers are derived.
 * Should only be called once at application startup.
 *
 * @param config - Logger configuration (level, format, optional stream)
 * @returns Configured Pino logger instance
 *
 * @internal
 */
function createRootLogger(config: LoggerConfig): pino.Logger {
  const pinoOptions: pino.LoggerOptions = {
    // Log level filtering
    level: config.level,

    // Redact sensitive information
    redact: REDACT_OPTIONS,

    // ISO 8601 timestamps for all formats
    timestamp: pino.stdTimeFunctions.isoTime,

    // Format log level as string (not number)
    formatters: {
      level: (label) => ({ level: label }),
    },
  };

  // If custom stream provided (for testing), use it directly
  if (config.stream) {
    return pino(pinoOptions, config.stream);
  }

  // Add stderr destination for normal operation
  // @ts-expect-error - Pino types don't include destination but it works
  pinoOptions.destination = 2; // File descriptor 2 = stderr

  // Configure transport based on format
  if (config.format === "pretty") {
    return pino({
      ...pinoOptions,
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname",
          singleLine: false,
          destination: 2, // Ensure stderr output (critical for MCP compatibility)
        },
      },
    });
  }

  // JSON format (production)
  return pino(pinoOptions);
}

/**
 * Initialize the global logger
 *
 * Must be called once at application startup before any logging occurs.
 * Subsequent calls will throw an error.
 *
 * @param config - Logger configuration
 * @throws Error if logger is already initialized
 *
 * @example
 * ```typescript
 * import { initializeLogger } from './logging/index.js';
 *
 * // At application startup
 * const config = {
 *   level: (process.env.LOG_LEVEL as LogLevel) || 'info',
 *   format: (process.env.LOG_FORMAT as 'json' | 'pretty') || 'pretty'
 * };
 * initializeLogger(config);
 * ```
 */
export function initializeLogger(config: LoggerConfig): void {
  if (rootLogger !== null) {
    throw new Error("Logger already initialized. initializeLogger() should only be called once.");
  }

  try {
    rootLogger = createRootLogger(config);

    // Log initialization (helps verify logger is working)
    rootLogger.debug({ config }, "Logger initialized");
  } catch (error) {
    // Graceful degradation: If logger creation fails (e.g., pino-pretty not installed),
    // fall back to basic JSON logger without transport
    const fallbackConfig: LoggerConfig = {
      level: config.level,
      format: "json", // Always use JSON for fallback (no dependencies)
    };

    // Create simple JSON logger without transport (but with redaction)
    rootLogger = pino({
      level: fallbackConfig.level,
      redact: REDACT_OPTIONS, // Maintain secret redaction even in fallback
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level: (label) => ({ level: label }),
      },
      // @ts-expect-error - Pino types don't include destination but it works
      destination: 2, // stderr
    });

    // Log fallback warning
    rootLogger.warn(
      {
        requestedFormat: config.format,
        fallbackFormat: "json",
        error: error instanceof Error ? error.message : String(error),
      },
      "Logger initialization failed, using fallback JSON logger"
    );
  }
}

/**
 * Get the root logger instance
 *
 * Returns the singleton root logger. Throws if logger not initialized.
 *
 * @returns Root logger instance
 * @throws Error if logger not initialized
 *
 * @internal - Most code should use getComponentLogger() instead
 */
export function getRootLogger(): pino.Logger {
  if (rootLogger === null) {
    throw new Error("Logger not initialized. Call initializeLogger() first.");
  }
  return rootLogger;
}

/**
 * Get a component-scoped logger
 *
 * Creates a child logger with automatic component context.
 * This is the primary API for application code.
 *
 * Component loggers automatically include:
 * - component: Component name in all logs
 * - requestId: Optional request/correlation ID
 *
 * @param component - Component name (use colon notation for hierarchy)
 * @param requestId - Optional request/correlation ID for tracing
 * @returns Child logger with component context
 *
 * @example
 * ```typescript
 * import { getComponentLogger } from './logging/index.js';
 *
 * // In MCP server
 * const logger = getComponentLogger('mcp-server');
 * logger.info('Server started');
 * // Output: {"level":"info","component":"mcp-server","msg":"Server started",...}
 *
 * // In storage client
 * const logger = getComponentLogger('storage:chromadb');
 * logger.info({ collection: 'repo_test' }, 'Collection created');
 *
 * // With request ID for tracing
 * const logger = getComponentLogger('mcp:tools', 'req-123');
 * logger.info({ tool: 'semantic_search' }, 'Processing tool call');
 * // Output includes: "requestId":"req-123"
 * ```
 */
export function getComponentLogger(component: string, requestId?: string): pino.Logger {
  const root = getRootLogger();

  const context: ComponentContext = {
    component,
    ...(requestId && { requestId }),
  };

  return root.child(context);
}

/**
 * Reset logger (for testing only)
 *
 * Clears the singleton root logger to allow re-initialization.
 * Should ONLY be used in tests.
 *
 * @internal
 */
export function resetLogger(): void {
  rootLogger = null;
}
