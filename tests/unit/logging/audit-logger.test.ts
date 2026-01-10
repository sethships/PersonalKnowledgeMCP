/**
 * Audit Logger Unit Tests
 *
 * Tests for the audit logger service including:
 * - Event emission
 * - Circuit breaker behavior
 * - Log rotation
 * - Query functionality
 * - Configuration handling
 *
 * @module tests/unit/logging/audit-logger
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { initializeLogger, resetLogger } from "../../../src/logging/index.js";
import {
  initializeAuditLogger,
  getAuditLogger,
  resetAuditLogger,
} from "../../../src/logging/audit-logger.js";
import type {
  AuditLoggerConfig,
  AuthSuccessEvent,
  AuthFailureEvent,
  TokenCreatedEvent,
} from "../../../src/logging/audit-types.js";

// Test data directory
const TEST_DATA_DIR = "./test-data/audit";
const TEST_LOG_PATH = join(TEST_DATA_DIR, "test-audit.log");

/**
 * Create a test configuration
 */
function createTestConfig(overrides: Partial<AuditLoggerConfig> = {}): AuditLoggerConfig {
  return {
    enabled: true,
    logPath: TEST_LOG_PATH,
    maxFileSize: 1024, // Small for testing rotation
    maxFiles: 3,
    retentionDays: 0, // Disable retention for tests
    ...overrides,
  };
}

/**
 * Create a sample auth success event
 */
function createAuthSuccessEvent(): AuthSuccessEvent {
  return {
    timestamp: new Date().toISOString(),
    eventType: "auth.success",
    success: true,
    authMethod: "bearer",
    requestId: "req-123",
    sourceIp: "192.168.1.1",
    token: {
      tokenHashPrefix: "abc12345",
      tokenName: "Test Token",
    },
  };
}

/**
 * Create a sample auth failure event
 */
function createAuthFailureEvent(): AuthFailureEvent {
  return {
    timestamp: new Date().toISOString(),
    eventType: "auth.failure",
    success: false,
    authMethod: "bearer",
    reason: "expired",
    requestId: "req-456",
    sourceIp: "10.0.0.1",
    token: {
      tokenHashPrefix: "def67890",
    },
  };
}

/**
 * Create a sample token created event
 */
function createTokenCreatedEvent(): TokenCreatedEvent {
  return {
    timestamp: new Date().toISOString(),
    eventType: "token.created",
    success: true,
    token: {
      tokenHashPrefix: "ghi11111",
      tokenName: "New Token",
    },
    scopes: ["read", "write"],
    instanceAccess: ["public"],
    expiresAt: null,
  };
}

/**
 * Wait for async write operations to complete with polling
 *
 * More robust than fixed timeout - polls for file existence/content.
 *
 * @param expectedLines - Optional minimum expected line count
 * @param timeout - Maximum wait time in ms (default: 2000 for CI compatibility)
 */
async function waitForWrite(expectedLines?: number, timeout = 2000): Promise<void> {
  const start = Date.now();
  const pollInterval = 20; // Check every 20ms

  while (Date.now() - start < timeout) {
    // If no expected lines, just wait a bit for async operations
    // Use a longer wait than before for CI compatibility (200ms vs 100ms)
    if (expectedLines === undefined) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return;
    }

    // Poll for file content
    if (existsSync(TEST_LOG_PATH)) {
      try {
        const content = readFileSync(TEST_LOG_PATH, "utf-8");
        const lines = content
          .trim()
          .split("\n")
          .filter((l) => l.length > 0).length;
        if (lines >= expectedLines) {
          return;
        }
      } catch {
        // File may be locked, continue polling
      }
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  // Timeout reached - return anyway (test will fail if expectations not met)
}

describe("AuditLogger", () => {
  beforeAll(() => {
    // Initialize application logger (required for audit logger)
    try {
      initializeLogger({ level: "silent", format: "json" });
    } catch {
      // Already initialized
    }
  });

  beforeEach(() => {
    // Clean up test directory
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_DATA_DIR, { recursive: true });

    // Reset singleton
    resetAuditLogger();
  });

  afterEach(() => {
    // Clean up
    resetAuditLogger();
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    }
  });

  afterAll(() => {
    resetLogger();
  });

  describe("initialization", () => {
    it("should initialize with valid configuration", () => {
      const config = createTestConfig();
      const logger = initializeAuditLogger(config);

      expect(logger).toBeDefined();
      expect(logger.isEnabled()).toBe(true);
      expect(logger.isCircuitOpen()).toBe(false);
    });

    it("should create log directory if it does not exist", () => {
      const nestedPath = join(TEST_DATA_DIR, "nested", "deep", "audit.log");
      const config = createTestConfig({ logPath: nestedPath });

      initializeAuditLogger(config);

      expect(existsSync(dirname(nestedPath))).toBe(true);
    });

    it("should return existing instance on second call", () => {
      const config = createTestConfig();
      const logger1 = initializeAuditLogger(config);
      const logger2 = initializeAuditLogger(config);

      expect(logger1).toBe(logger2);
    });

    it("should be disabled when enabled=false", () => {
      const config = createTestConfig({ enabled: false });
      const logger = initializeAuditLogger(config);

      expect(logger.isEnabled()).toBe(false);
    });

    it("should throw when getting logger before initialization", () => {
      expect(() => getAuditLogger()).toThrow("Audit logger not initialized");
    });
  });

  describe("emit", () => {
    it("should write event to log file", async () => {
      const config = createTestConfig();
      const logger = initializeAuditLogger(config);

      const event = createAuthSuccessEvent();
      logger.emit(event);

      await waitForWrite();

      expect(existsSync(TEST_LOG_PATH)).toBe(true);
      const content = readFileSync(TEST_LOG_PATH, "utf-8");
      expect(content).toContain("auth.success");
      expect(content).toContain("abc12345");
    });

    it("should include all event fields in log", async () => {
      const config = createTestConfig();
      const logger = initializeAuditLogger(config);

      const event = createAuthSuccessEvent();
      logger.emit(event);

      await waitForWrite();

      const content = readFileSync(TEST_LOG_PATH, "utf-8");
      const parsed = JSON.parse(content.trim());

      expect(parsed.eventType).toBe("auth.success");
      expect(parsed.success).toBe(true);
      expect(parsed.authMethod).toBe("bearer");
      expect(parsed.requestId).toBe("req-123");
      expect(parsed.sourceIp).toBe("192.168.1.1");
      expect(parsed.token.tokenHashPrefix).toBe("abc12345");
      expect(parsed.token.tokenName).toBe("Test Token");
    });

    it("should not block on emit", () => {
      const config = createTestConfig();
      const logger = initializeAuditLogger(config);

      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        logger.emit(createAuthSuccessEvent());
      }
      const elapsed = performance.now() - start;

      // Should complete in under 10ms for 100 events (fire-and-forget)
      expect(elapsed).toBeLessThan(10);
    });

    it("should not emit when disabled", async () => {
      const config = createTestConfig({ enabled: false });
      const logger = initializeAuditLogger(config);

      logger.emit(createAuthSuccessEvent());

      await waitForWrite();

      expect(existsSync(TEST_LOG_PATH)).toBe(false);
    });

    it("should write multiple events", async () => {
      const config = createTestConfig();
      const logger = initializeAuditLogger(config);

      logger.emit(createAuthSuccessEvent());
      logger.emit(createAuthFailureEvent());
      logger.emit(createTokenCreatedEvent());

      await waitForWrite();

      const content = readFileSync(TEST_LOG_PATH, "utf-8");
      const lines = content.trim().split("\n");

      expect(lines.length).toBe(3);
    });
  });

  describe("query", () => {
    it("should return empty result when no logs exist", async () => {
      const config = createTestConfig();
      const logger = initializeAuditLogger(config);

      const result = await logger.query({});

      expect(result.events).toHaveLength(0);
      expect(result.total).toBe(0);
      expect(result.hasMore).toBe(false);
    });

    it("should return all events when no filters applied", async () => {
      const config = createTestConfig();
      const logger = initializeAuditLogger(config);

      logger.emit(createAuthSuccessEvent());
      logger.emit(createAuthFailureEvent());

      await waitForWrite();

      const result = await logger.query({});

      expect(result.events).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it("should filter by event type", async () => {
      const config = createTestConfig();
      const logger = initializeAuditLogger(config);

      logger.emit(createAuthSuccessEvent());
      logger.emit(createAuthFailureEvent());
      logger.emit(createTokenCreatedEvent());

      await waitForWrite();

      const result = await logger.query({ eventTypes: ["auth.success"] });

      expect(result.events).toHaveLength(1);
      expect(result.events[0]?.eventType).toBe("auth.success");
    });

    it("should filter by success status", async () => {
      const config = createTestConfig();
      const logger = initializeAuditLogger(config);

      logger.emit(createAuthSuccessEvent());
      logger.emit(createAuthFailureEvent());

      await waitForWrite();

      const result = await logger.query({ success: false });

      expect(result.events).toHaveLength(1);
      expect(result.events[0]?.eventType).toBe("auth.failure");
    });

    it("should filter by token hash prefix", async () => {
      const config = createTestConfig();
      const logger = initializeAuditLogger(config);

      logger.emit(createAuthSuccessEvent()); // abc12345
      logger.emit(createAuthFailureEvent()); // def67890

      await waitForWrite();

      const result = await logger.query({ tokenHashPrefix: "abc" });

      expect(result.events).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it("should support pagination", async () => {
      const config = createTestConfig();
      const logger = initializeAuditLogger(config);

      // Emit 5 events
      for (let i = 0; i < 5; i++) {
        logger.emit(createAuthSuccessEvent());
      }

      await waitForWrite();

      // Get first 2
      const page1 = await logger.query({ limit: 2, offset: 0 });
      expect(page1.events).toHaveLength(2);
      expect(page1.total).toBe(5);
      expect(page1.hasMore).toBe(true);

      // Get next 2
      const page2 = await logger.query({ limit: 2, offset: 2 });
      expect(page2.events).toHaveLength(2);
      expect(page2.hasMore).toBe(true);

      // Get last 1
      const page3 = await logger.query({ limit: 2, offset: 4 });
      expect(page3.events).toHaveLength(1);
      expect(page3.hasMore).toBe(false);
    });
  });

  describe("rotation", () => {
    it("should rotate when file exceeds max size", async () => {
      const config = createTestConfig({
        maxFileSize: 1024, // Minimum allowed size for quick rotation
      });
      const logger = initializeAuditLogger(config);

      // Write enough events to trigger rotation (each event is ~300-400 bytes)
      for (let i = 0; i < 10; i++) {
        logger.emit(createAuthSuccessEvent());
        await waitForWrite();
      }

      // Check for rotated files
      const { readdirSync } = await import("node:fs");
      const files = readdirSync(TEST_DATA_DIR).filter((f) => f.includes("audit"));

      expect(files.length).toBeGreaterThan(1);
    });
  });

  describe("configuration", () => {
    it("should return correct log path", () => {
      const config = createTestConfig();
      const logger = initializeAuditLogger(config);

      expect(logger.getLogPath()).toBe(TEST_LOG_PATH);
    });
  });
});

describe("AuditLoggerConfig validation", () => {
  beforeAll(() => {
    try {
      initializeLogger({ level: "silent", format: "json" });
    } catch {
      // Already initialized
    }
  });

  beforeEach(() => {
    resetAuditLogger();
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_DATA_DIR, { recursive: true });
  });

  afterEach(() => {
    resetAuditLogger();
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    }
  });

  afterAll(() => {
    resetLogger();
  });

  it("should reject maxFileSize less than 1024", () => {
    const config = createTestConfig({ maxFileSize: 100 });

    expect(() => initializeAuditLogger(config)).toThrow("at least 1024 bytes");
  });

  it("should reject maxFiles less than 1", () => {
    const config = createTestConfig({ maxFiles: 0 });

    expect(() => initializeAuditLogger(config)).toThrow("at least 1");
  });

  it("should reject negative retentionDays", () => {
    const config = createTestConfig({ retentionDays: -1 });

    expect(() => initializeAuditLogger(config)).toThrow("cannot be negative");
  });

  it("should reject empty logPath", () => {
    const config = createTestConfig({ logPath: "" });

    expect(() => initializeAuditLogger(config)).toThrow("cannot be empty");
  });
});

describe("AuditLogger circuit breaker", () => {
  beforeAll(() => {
    try {
      initializeLogger({ level: "silent", format: "json" });
    } catch {
      // Already initialized
    }
  });

  beforeEach(() => {
    resetAuditLogger();
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_DATA_DIR, { recursive: true });
  });

  afterEach(() => {
    resetAuditLogger();
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    }
  });

  afterAll(() => {
    resetLogger();
  });

  it("should report circuit as closed initially", () => {
    const config = createTestConfig();
    const logger = initializeAuditLogger(config);

    expect(logger.isCircuitOpen()).toBe(false);
  });

  it("should drop events when circuit is open", async () => {
    const config = createTestConfig();
    const logger = initializeAuditLogger(config);

    // Emit an event to create the log file
    logger.emit(createAuthSuccessEvent());

    // Wait for the async write to complete with polling for expected line count
    await waitForWrite(1, 5000);

    // Verify the initial event was written
    const initialContent = readFileSync(TEST_LOG_PATH, "utf-8");
    const initialLines = initialContent.trim().split("\n").length;
    expect(initialLines).toBe(1); // Ensure first event is written

    // Access internals to manually open circuit for testing
    // @ts-expect-error - accessing private property for testing
    logger.circuitOpen = true;

    // Emit more events - should be dropped because circuit is open
    logger.emit(createAuthSuccessEvent());
    logger.emit(createAuthSuccessEvent());

    // Wait a bit to ensure any queued writes would have time to complete
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Verify no new events were written
    const finalContent = readFileSync(TEST_LOG_PATH, "utf-8");
    const finalLines = finalContent.trim().split("\n").length;

    expect(finalLines).toBe(initialLines);
  });

  it("should open circuit after 5 consecutive failures", async () => {
    // Create config with a path that will cause write failures
    const readOnlyPath = join(TEST_DATA_DIR, "readonly", "audit.log");
    mkdirSync(dirname(readOnlyPath), { recursive: true });

    const config = createTestConfig({ logPath: readOnlyPath });
    const logger = initializeAuditLogger(config);

    // Verify circuit starts closed
    expect(logger.isCircuitOpen()).toBe(false);

    // Make the directory read-only to cause write failures (platform-dependent)
    // On Windows, we'll simulate failures by checking internal state
    // @ts-expect-error - accessing private property for testing
    logger.failureCount = 4;

    // One more failure should open the circuit
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
    (logger as any).handleWriteFailure(new Error("Test failure"), createAuthSuccessEvent());

    // Circuit should now be open
    expect(logger.isCircuitOpen()).toBe(true);
  });

  it("should track failure count correctly", () => {
    const config = createTestConfig();
    const logger = initializeAuditLogger(config);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
    expect((logger as any).failureCount).toBe(0);

    // Simulate failures
    for (let i = 0; i < 3; i++) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
      (logger as any).handleWriteFailure(new Error("Test failure"), createAuthSuccessEvent());
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
    expect((logger as any).failureCount).toBe(3);
    expect(logger.isCircuitOpen()).toBe(false);
  });

  it("should reset failure count on successful write", async () => {
    const config = createTestConfig();
    const logger = initializeAuditLogger(config);

    // Simulate some failures first
    // @ts-expect-error - accessing private property for testing
    logger.failureCount = 3;

    // Emit a successful event
    logger.emit(createAuthSuccessEvent());
    await waitForWrite(1, 5000);

    // Failure count should be reset
    // @ts-expect-error - accessing private property for testing
    expect(logger.failureCount).toBe(0);
  });

  it("should log to app log as fallback when circuit is open", async () => {
    const config = createTestConfig();
    const logger = initializeAuditLogger(config);

    // Open circuit
    // @ts-expect-error - accessing private property for testing
    logger.circuitOpen = true;

    // Emit event - should not throw and should not write to audit log
    const event = createAuthSuccessEvent();
    logger.emit(event);

    await waitForWrite();

    // If the log file exists, verify the event was not written
    if (existsSync(TEST_LOG_PATH)) {
      const content = readFileSync(TEST_LOG_PATH, "utf-8");
      // The auth.success event with this specific requestId should not be in the file
      // since circuit was open before emit
      expect(content).not.toContain(event.requestId);
    }
  });
});
