/**
 * Mock Audit Logger for Testing
 *
 * Provides a test double for the AuditLogger that captures all emitted events
 * for verification in tests.
 *
 * Features:
 * - Captures all emitted events
 * - Filtering by event type, success, token, user
 * - Configurable failure mode for testing error handling
 * - Clear/reset between tests
 *
 * @module tests/helpers/audit-mock
 */

import type {
  AuditEvent,
  AuditEventType,
  AuditLogger,
  AuditQueryOptions,
  AuditQueryResult,
  TokenIdentifier,
  UserIdentifier,
} from "../../src/logging/audit-types.js";

/**
 * Mock Audit Logger Implementation
 *
 * Captures all audit events for test verification.
 */
export class MockAuditLogger implements AuditLogger {
  /** All captured events */
  public readonly events: AuditEvent[] = [];

  /** Whether the mock is enabled */
  private enabled: boolean = true;

  /** Whether to simulate circuit being open */
  private circuitOpen: boolean = false;

  /** Log path for testing */
  private logPath: string = "./data/audit/test-audit.log";

  /**
   * Emit an audit event (captures for testing)
   *
   * @param event - Audit event to capture
   */
  emit(event: AuditEvent): void {
    if (!this.enabled || this.circuitOpen) {
      return;
    }
    this.events.push(event);
  }

  /**
   * Query audit events
   *
   * @param options - Query filter options
   * @returns Filtered events with pagination
   */
  async query(options: AuditQueryOptions): Promise<AuditQueryResult> {
    const limit = options.limit ?? 100;
    const offset = options.offset ?? 0;

    let filtered = [...this.events];

    // Apply filters
    if (options.eventTypes && options.eventTypes.length > 0) {
      filtered = filtered.filter((e) =>
        options.eventTypes!.includes(e.eventType as AuditEventType)
      );
    }

    if (options.startTime) {
      const startTime = new Date(options.startTime).getTime();
      filtered = filtered.filter((e) => new Date(e.timestamp).getTime() >= startTime);
    }

    if (options.endTime) {
      const endTime = new Date(options.endTime).getTime();
      filtered = filtered.filter((e) => new Date(e.timestamp).getTime() <= endTime);
    }

    if (options.tokenHashPrefix) {
      filtered = filtered.filter((e) => {
        const token = "token" in e ? (e as { token?: TokenIdentifier }).token : undefined;
        return token?.tokenHashPrefix?.startsWith(options.tokenHashPrefix!);
      });
    }

    if (options.userEmail) {
      filtered = filtered.filter((e) => {
        const user = "user" in e ? (e as { user?: UserIdentifier }).user : undefined;
        return user?.email === options.userEmail;
      });
    }

    if (options.success !== undefined) {
      filtered = filtered.filter((e) => e.success === options.success);
    }

    if (options.instance) {
      filtered = filtered.filter((e) => e.instance === options.instance);
    }

    const total = filtered.length;
    const events = filtered.slice(offset, offset + limit);

    return {
      events,
      total,
      hasMore: total > offset + events.length,
    };
  }

  /**
   * Check if audit logging is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Check if circuit breaker is open
   */
  isCircuitOpen(): boolean {
    return this.circuitOpen;
  }

  /**
   * Get the log path
   */
  getLogPath(): string {
    return this.logPath;
  }

  // =========================================================================
  // Test Helper Methods
  // =========================================================================

  /**
   * Get events by type
   *
   * @param type - Event type to filter by
   * @returns Events matching the type
   */
  getByType(type: AuditEventType): AuditEvent[] {
    return this.events.filter((e) => e.eventType === type);
  }

  /**
   * Get events by success status
   *
   * @param success - Success status to filter by
   * @returns Events matching the status
   */
  getBySuccess(success: boolean): AuditEvent[] {
    return this.events.filter((e) => e.success === success);
  }

  /**
   * Get events by token hash prefix
   *
   * @param prefix - Token hash prefix to filter by
   * @returns Events matching the token
   */
  getByTokenPrefix(prefix: string): AuditEvent[] {
    return this.events.filter((e) => {
      const token = "token" in e ? (e as { token?: TokenIdentifier }).token : undefined;
      return token?.tokenHashPrefix?.startsWith(prefix);
    });
  }

  /**
   * Get events by user email
   *
   * @param email - User email to filter by
   * @returns Events matching the user
   */
  getByUserEmail(email: string): AuditEvent[] {
    return this.events.filter((e) => {
      const user = "user" in e ? (e as { user?: UserIdentifier }).user : undefined;
      return user?.email === email;
    });
  }

  /**
   * Get events by instance
   *
   * @param instance - Instance to filter by
   * @returns Events matching the instance
   */
  getByInstance(instance: string): AuditEvent[] {
    return this.events.filter((e) => e.instance === instance);
  }

  /**
   * Check if an event with specific criteria exists
   *
   * @param predicate - Filter function
   * @returns True if any event matches
   */
  has(predicate: (event: AuditEvent) => boolean): boolean {
    return this.events.some(predicate);
  }

  /**
   * Get the count of events
   */
  count(): number {
    return this.events.length;
  }

  /**
   * Get the most recent event
   */
  getLatest(): AuditEvent | undefined {
    return this.events[this.events.length - 1];
  }

  /**
   * Clear all captured events
   */
  clear(): void {
    this.events.length = 0;
  }

  /**
   * Set enabled state (for testing disabled audit logging)
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Set circuit open state (for testing circuit breaker)
   */
  setCircuitOpen(open: boolean): void {
    this.circuitOpen = open;
  }

  /**
   * Set log path (for testing)
   */
  setLogPath(path: string): void {
    this.logPath = path;
  }

  /**
   * Reset to default state
   */
  reset(): void {
    this.events.length = 0;
    this.enabled = true;
    this.circuitOpen = false;
    this.logPath = "./data/audit/test-audit.log";
  }

  /**
   * Get a human-readable dump of all events (for debugging)
   */
  dump(): string {
    return this.events.map((e) => JSON.stringify(e, null, 2)).join("\n\n");
  }
}

/**
 * Create a new mock audit logger
 *
 * @returns A new MockAuditLogger instance
 *
 * @example
 * ```typescript
 * import { createMockAuditLogger } from './helpers/audit-mock.js';
 *
 * const mockAudit = createMockAuditLogger();
 *
 * // Use in tests
 * myService.setAuditLogger(mockAudit);
 * await myService.doSomething();
 *
 * expect(mockAudit.count()).toBe(1);
 * expect(mockAudit.getByType('auth.success')).toHaveLength(1);
 * ```
 */
export function createMockAuditLogger(): MockAuditLogger {
  return new MockAuditLogger();
}
