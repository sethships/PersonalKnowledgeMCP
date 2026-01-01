/**
 * Audit Logger Service
 *
 * Provides security audit logging with:
 * - Separate log file (not mixed with application logs)
 * - Automatic log rotation based on file size
 * - Fire-and-forget event emission (non-blocking)
 * - Circuit breaker for failure handling
 * - Query capability for compliance reporting
 *
 * Design principles:
 * - Never block request handling
 * - Fall back to application log on failures
 * - Only log first 8 chars of token hashes
 * - Structured JSON format for querying
 *
 * @module logging/audit-logger
 */

import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, renameSync } from "node:fs";
import { dirname, basename, join } from "node:path";
import pino from "pino";
import type { Logger } from "pino";
import { getComponentLogger } from "./logger-factory.js";
import { loadAuditConfig, validateAuditConfig } from "./audit-config.js";
import type {
  AuditEvent,
  AuditEventType,
  AuditLogger,
  AuditLoggerConfig,
  AuditQueryOptions,
  AuditQueryResult,
} from "./audit-types.js";

/**
 * Circuit breaker configuration
 */
const CIRCUIT_BREAKER = {
  /** Number of failures before opening circuit */
  FAILURE_THRESHOLD: 5,
  /** Time in ms before attempting to reset circuit */
  RESET_TIMEOUT_MS: 60000,
} as const;

/**
 * Singleton audit logger instance
 */
let auditLoggerInstance: AuditLoggerImpl | null = null;

/**
 * Audit Logger Implementation
 *
 * Implements fire-and-forget logging with circuit breaker pattern.
 */
export class AuditLoggerImpl implements AuditLogger {
  private readonly config: AuditLoggerConfig;
  private readonly appLogger: Logger;
  private auditLogger: Logger | null = null;

  // Circuit breaker state
  private failureCount = 0;
  private circuitOpen = false;
  private resetTimeoutId: ReturnType<typeof setTimeout> | null = null;

  /**
   * Create a new audit logger
   *
   * @param config - Audit logger configuration
   */
  constructor(config: AuditLoggerConfig) {
    this.config = config;
    this.appLogger = getComponentLogger("audit");

    if (config.enabled) {
      try {
        this.initializeAuditLogger();
        this.appLogger.info(
          {
            logPath: config.logPath,
            maxFileSize: config.maxFileSize,
            maxFiles: config.maxFiles,
            retentionDays: config.retentionDays,
          },
          "Audit logger initialized"
        );
      } catch (error) {
        this.appLogger.error(
          { err: error },
          "Failed to initialize audit logger, audit logging disabled"
        );
      }
    } else {
      this.appLogger.info("Audit logging is disabled");
    }
  }

  /**
   * Initialize the Pino logger for audit events
   */
  private initializeAuditLogger(): void {
    // Ensure directory exists
    const logDir = dirname(this.config.logPath);
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true, mode: 0o700 });
    }

    // Create Pino logger with file destination
    this.auditLogger = pino(
      {
        level: "info",
        timestamp: pino.stdTimeFunctions.isoTime,
        formatters: {
          level: (label) => ({ level: label }),
        },
        // No redaction needed - we control what fields are included
        base: undefined, // Don't include pid/hostname
      },
      pino.destination({
        dest: this.config.logPath,
        sync: false, // Async writes for performance
      })
    );

    // Run initial cleanup
    this.cleanupOldFiles();
  }

  /**
   * Emit an audit event (fire-and-forget)
   *
   * @param event - Audit event to log
   */
  emit(event: AuditEvent): void {
    if (!this.config.enabled || !this.auditLogger) {
      return;
    }

    if (this.circuitOpen) {
      // Log to app log as fallback when circuit is open
      this.appLogger.debug({ eventType: event.eventType }, "Audit event dropped (circuit open)");
      return;
    }

    // Fire-and-forget: schedule write without blocking
    setImmediate(() => {
      this.writeEvent(event);
    });
  }

  /**
   * Write event to audit log
   */
  private writeEvent(event: AuditEvent): void {
    try {
      // Check if rotation is needed before writing
      this.checkAndRotate();

      // Write the event
      this.auditLogger!.info(event);

      // Reset failure count on success
      if (this.failureCount > 0) {
        this.failureCount = 0;
        this.appLogger.debug("Audit logger recovered from previous failures");
      }
    } catch (error) {
      this.handleWriteFailure(error as Error, event);
    }
  }

  /**
   * Handle write failure with circuit breaker logic
   */
  private handleWriteFailure(error: Error, event: AuditEvent): void {
    this.failureCount++;

    // Log to application log as fallback
    this.appLogger.warn(
      {
        err: error,
        failureCount: this.failureCount,
        eventType: event.eventType,
        threshold: CIRCUIT_BREAKER.FAILURE_THRESHOLD,
      },
      "Audit log write failed"
    );

    // Open circuit after threshold failures
    if (this.failureCount >= CIRCUIT_BREAKER.FAILURE_THRESHOLD && !this.circuitOpen) {
      this.openCircuit();
    }
  }

  /**
   * Open the circuit breaker
   */
  private openCircuit(): void {
    this.circuitOpen = true;
    this.appLogger.error(
      { failureCount: this.failureCount },
      "Audit logger circuit breaker opened - audit events will be dropped"
    );

    // Schedule circuit reset attempt
    this.resetTimeoutId = setTimeout(() => {
      this.attemptCircuitReset();
    }, CIRCUIT_BREAKER.RESET_TIMEOUT_MS);
  }

  /**
   * Attempt to reset the circuit breaker
   */
  private attemptCircuitReset(): void {
    this.appLogger.info("Attempting audit logger circuit breaker reset");

    // Try to reinitialize the logger
    try {
      this.initializeAuditLogger();
      this.circuitOpen = false;
      this.failureCount = 0;
      this.appLogger.info("Audit logger circuit breaker reset successfully");
    } catch (error) {
      this.appLogger.error(
        { err: error },
        "Audit logger circuit breaker reset failed, scheduling retry"
      );
      // Schedule another attempt
      this.resetTimeoutId = setTimeout(() => {
        this.attemptCircuitReset();
      }, CIRCUIT_BREAKER.RESET_TIMEOUT_MS);
    }
  }

  /**
   * Check if rotation is needed and rotate if so
   */
  private checkAndRotate(): void {
    try {
      if (!existsSync(this.config.logPath)) {
        return;
      }

      const stats = statSync(this.config.logPath);
      if (stats.size >= this.config.maxFileSize) {
        this.rotateLogFile();
      }
    } catch {
      // Ignore errors during rotation check
    }
  }

  /**
   * Rotate the log file
   */
  private rotateLogFile(): void {
    const logDir = dirname(this.config.logPath);
    const logName = basename(this.config.logPath, ".log");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const rotatedName = `${logName}.${timestamp}.log`;
    const rotatedPath = join(logDir, rotatedName);

    try {
      // Close current logger
      // Note: Pino doesn't have a clean close method, so we just reinitialize
      renameSync(this.config.logPath, rotatedPath);

      // Reinitialize logger with new file
      this.initializeAuditLogger();

      this.appLogger.info({ rotatedTo: rotatedPath }, "Audit log rotated");

      // Clean up old files
      this.cleanupOldFiles();
    } catch (error) {
      this.appLogger.error({ err: error }, "Failed to rotate audit log");
    }
  }

  /**
   * Clean up old log files based on maxFiles and retentionDays
   */
  private cleanupOldFiles(): void {
    try {
      const logDir = dirname(this.config.logPath);
      const logName = basename(this.config.logPath, ".log");

      if (!existsSync(logDir)) {
        return;
      }

      // Find all rotated log files
      const files = readdirSync(logDir)
        .filter(
          (f) => f.startsWith(logName) && f.endsWith(".log") && f !== basename(this.config.logPath)
        )
        .map((f) => ({
          name: f,
          path: join(logDir, f),
          mtime: statSync(join(logDir, f)).mtimeMs,
        }))
        .sort((a, b) => b.mtime - a.mtime); // Newest first

      // Delete files beyond maxFiles limit
      const filesToDelete = files.slice(this.config.maxFiles - 1); // -1 because current file counts

      // Also delete files older than retention period
      if (this.config.retentionDays > 0) {
        const retentionMs = this.config.retentionDays * 24 * 60 * 60 * 1000;
        const cutoffTime = Date.now() - retentionMs;

        for (const file of files) {
          if (file.mtime < cutoffTime && !filesToDelete.includes(file)) {
            filesToDelete.push(file);
          }
        }
      }

      // Delete the files
      for (const file of filesToDelete) {
        try {
          unlinkSync(file.path);
          this.appLogger.debug({ file: file.name }, "Deleted old audit log file");
        } catch {
          // Ignore errors deleting individual files
        }
      }

      if (filesToDelete.length > 0) {
        this.appLogger.info(
          { deletedCount: filesToDelete.length },
          "Cleaned up old audit log files"
        );
      }
    } catch (error) {
      this.appLogger.warn({ err: error }, "Failed to clean up old audit log files");
    }
  }

  /**
   * Query audit events from log files
   *
   * @param options - Query filter options
   * @returns Matching events with pagination info
   */
  async query(options: AuditQueryOptions): Promise<AuditQueryResult> {
    const limit = options.limit ?? 100;
    const offset = options.offset ?? 0;
    const events: AuditEvent[] = [];
    let total = 0;

    try {
      const logDir = dirname(this.config.logPath);
      if (!existsSync(logDir)) {
        return { events: [], total: 0, hasMore: false };
      }

      // Get all log files (current + rotated)
      const logName = basename(this.config.logPath, ".log");
      const files = readdirSync(logDir)
        .filter((f) => f.startsWith(logName) && f.endsWith(".log"))
        .map((f) => join(logDir, f))
        .sort(); // Process in order

      // Read and parse events from all files
      for (const filePath of files) {
        const content = await Bun.file(filePath).text();
        const lines = content.split("\n").filter((line) => line.trim());

        for (const line of lines) {
          try {
            const event = JSON.parse(line) as AuditEvent;

            // Apply filters
            if (!this.matchesFilters(event, options)) {
              continue;
            }

            total++;

            // Apply pagination
            if (total > offset && events.length < limit) {
              events.push(event);
            }
          } catch {
            // Skip malformed lines
          }
        }
      }
    } catch (error) {
      this.appLogger.error({ err: error }, "Failed to query audit logs");
    }

    return {
      events,
      total,
      hasMore: total > offset + events.length,
    };
  }

  /**
   * Check if an event matches the query filters
   */
  private matchesFilters(event: AuditEvent, options: AuditQueryOptions): boolean {
    // Event type filter
    if (options.eventTypes && options.eventTypes.length > 0) {
      if (!options.eventTypes.includes(event.eventType as AuditEventType)) {
        return false;
      }
    }

    // Time range filter
    if (options.startTime) {
      const eventTime = new Date(event.timestamp).getTime();
      const startTime = new Date(options.startTime).getTime();
      if (eventTime < startTime) {
        return false;
      }
    }

    if (options.endTime) {
      const eventTime = new Date(event.timestamp).getTime();
      const endTime = new Date(options.endTime).getTime();
      if (eventTime > endTime) {
        return false;
      }
    }

    // Token hash prefix filter
    if (options.tokenHashPrefix) {
      const token = "token" in event ? event.token : undefined;
      if (!token || !token.tokenHashPrefix?.startsWith(options.tokenHashPrefix)) {
        return false;
      }
    }

    // User email filter
    if (options.userEmail) {
      const user = "user" in event ? event.user : undefined;
      if (!user || user.email !== options.userEmail) {
        return false;
      }
    }

    // Success filter
    if (options.success !== undefined) {
      if (event.success !== options.success) {
        return false;
      }
    }

    // Instance filter
    if (options.instance) {
      if (event.instance !== options.instance) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if audit logging is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled && this.auditLogger !== null;
  }

  /**
   * Check if circuit breaker is open
   */
  isCircuitOpen(): boolean {
    return this.circuitOpen;
  }

  /**
   * Get the path to the current audit log file
   */
  getLogPath(): string {
    return this.config.logPath;
  }

  /**
   * Shutdown the audit logger (for testing)
   */
  shutdown(): void {
    if (this.resetTimeoutId) {
      clearTimeout(this.resetTimeoutId);
      this.resetTimeoutId = null;
    }
    this.auditLogger = null;
  }
}

/**
 * Initialize the global audit logger
 *
 * Should be called once at application startup after the main logger is initialized.
 *
 * @param config - Optional configuration (defaults to environment variables)
 * @returns The audit logger instance
 *
 * @example
 * ```typescript
 * import { initializeAuditLogger } from './logging/audit-logger.js';
 *
 * // At application startup (after initializeLogger)
 * initializeAuditLogger();
 * ```
 */
export function initializeAuditLogger(config?: AuditLoggerConfig): AuditLogger {
  if (auditLoggerInstance !== null) {
    return auditLoggerInstance;
  }

  const resolvedConfig = config ?? loadAuditConfig();
  validateAuditConfig(resolvedConfig);

  auditLoggerInstance = new AuditLoggerImpl(resolvedConfig);
  return auditLoggerInstance;
}

/**
 * Get the audit logger instance
 *
 * Returns the singleton audit logger. Throws if not initialized.
 *
 * @returns Audit logger instance
 * @throws Error if audit logger not initialized
 *
 * @example
 * ```typescript
 * import { getAuditLogger } from './logging/audit-logger.js';
 *
 * const auditLogger = getAuditLogger();
 * auditLogger.emit({
 *   timestamp: new Date().toISOString(),
 *   eventType: 'auth.success',
 *   success: true,
 *   authMethod: 'bearer',
 * });
 * ```
 */
export function getAuditLogger(): AuditLogger {
  if (auditLoggerInstance === null) {
    throw new Error("Audit logger not initialized. Call initializeAuditLogger() first.");
  }
  return auditLoggerInstance;
}

/**
 * Reset the audit logger (for testing only)
 *
 * Clears the singleton instance to allow re-initialization.
 *
 * @internal
 */
export function resetAuditLogger(): void {
  if (auditLoggerInstance) {
    auditLoggerInstance.shutdown();
    auditLoggerInstance = null;
  }
}
