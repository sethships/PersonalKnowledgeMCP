/**
 * Log Capture Helper
 *
 * Utility for capturing and analyzing Pino log entries during tests.
 * Provides methods to filter, query, and assert on structured log output.
 *
 * @module tests/helpers/log-capture
 */

import { Writable } from "stream";
import type { LogLevel } from "../../src/logging/types.js";

/**
 * Captured log entry structure (Pino format)
 */
export interface LogEntry {
  level: string | number;
  time?: string | number;
  component?: string;
  correlationId?: string;
  operation?: string;
  msg: string;
  [key: string]: unknown;
}

/**
 * Log capture stream and utilities
 */
export class LogCapture {
  private logs: LogEntry[] = [];
  public readonly stream: Writable;

  constructor() {
    // Create a writable stream that captures log lines
    this.stream = new Writable({
      write: (
        chunk: Buffer | string,
        _encoding: BufferEncoding,
        callback: (error?: Error | null) => void
      ) => {
        try {
          const line = (typeof chunk === "string" ? chunk : chunk.toString()).trim();
          if (line) {
            const entry = JSON.parse(line) as LogEntry;
            this.logs.push(entry);
          }
          callback(null);
        } catch (error) {
          // Ignore parse errors (malformed JSON) but still call callback
          if (error instanceof Error) {
            console.error("Failed to parse log entry:", error.message);
          }
          callback(null);
        }
      },
    });
  }

  /**
   * Get all captured log entries
   */
  getAll(): LogEntry[] {
    return [...this.logs];
  }

  /**
   * Get logs filtered by correlation ID
   */
  getByCorrelationId(correlationId: string): LogEntry[] {
    return this.logs.filter((log) => log.correlationId === correlationId);
  }

  /**
   * Get logs filtered by operation
   */
  getByOperation(operation: string): LogEntry[] {
    return this.logs.filter((log) => log.operation === operation);
  }

  /**
   * Get logs filtered by component
   */
  getByComponent(component: string): LogEntry[] {
    return this.logs.filter((log) => log.component === component);
  }

  /**
   * Get logs filtered by level
   */
  getByLevel(level: LogLevel): LogEntry[] {
    return this.logs.filter((log) => {
      if (typeof log.level === "string") {
        return log.level === level;
      }
      // Pino numeric levels: trace=10, debug=20, info=30, warn=40, error=50, fatal=60
      const levelMap: Record<LogLevel, number> = {
        trace: 10,
        debug: 20,
        info: 30,
        warn: 40,
        error: 50,
        fatal: 60,
      };
      return log.level === levelMap[level];
    });
  }

  /**
   * Find first log matching a predicate
   */
  find(predicate: (log: LogEntry) => boolean): LogEntry | undefined {
    return this.logs.find(predicate);
  }

  /**
   * Find all logs matching a predicate
   */
  filter(predicate: (log: LogEntry) => boolean): LogEntry[] {
    return this.logs.filter(predicate);
  }

  /**
   * Check if any log matches a predicate
   */
  some(predicate: (log: LogEntry) => boolean): boolean {
    return this.logs.some(predicate);
  }

  /**
   * Check if all logs match a predicate
   */
  every(predicate: (log: LogEntry) => boolean): boolean {
    return this.logs.every(predicate);
  }

  /**
   * Get count of captured logs
   */
  count(): number {
    return this.logs.length;
  }

  /**
   * Clear all captured logs
   */
  clear(): void {
    this.logs = [];
  }

  /**
   * Get logs as formatted string for debugging
   */
  dump(): string {
    return this.logs.map((log) => JSON.stringify(log, null, 2)).join("\n\n");
  }
}

/**
 * Create a log capture instance for testing
 *
 * @example
 * ```typescript
 * import { createLogCapture } from './helpers/log-capture.js';
 * import { initializeLogger } from '../src/logging/index.js';
 *
 * const capture = createLogCapture();
 * initializeLogger({
 *   level: 'debug',
 *   format: 'json',
 *   stream: capture.stream // Custom stream for capture
 * });
 *
 * // Run code that logs
 * someFunction();
 *
 * // Assert on logs
 * const logs = capture.getByCorrelationId('update-123');
 * expect(logs).toHaveLength(5);
 * expect(logs.every(log => log.correlationId === 'update-123')).toBe(true);
 * ```
 */
export function createLogCapture(): LogCapture {
  return new LogCapture();
}
