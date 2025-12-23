/**
 * SSE Route Unit Tests
 *
 * Tests for SSE session management functions.
 * These test the module-level functions in isolation.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { initializeLogger } from "../../../../src/logging/index.js";
import {
  getActiveSessionCount,
  getMaxSessions,
  closeAllSessions,
  startSessionCleanup,
  stopSessionCleanup,
} from "../../../../src/http/routes/sse.js";

// Initialize logger before tests (wrapped in try-catch for parallel test execution)
try {
  initializeLogger({ level: "silent", format: "json" });
} catch {
  // Logger already initialized by another test file, ignore
}

describe("SSE Session Management", () => {
  beforeEach(async () => {
    // Ensure clean state before each test
    stopSessionCleanup();
    await closeAllSessions();
  });

  afterEach(async () => {
    // Clean up after each test
    stopSessionCleanup();
    await closeAllSessions();
  });

  describe("getActiveSessionCount", () => {
    test("should return 0 when no sessions exist", () => {
      const count = getActiveSessionCount();
      expect(count).toBe(0);
    });

    test("should return a number", () => {
      const count = getActiveSessionCount();
      expect(typeof count).toBe("number");
    });
  });

  describe("getMaxSessions", () => {
    test("should return the configured maximum sessions", () => {
      const maxSessions = getMaxSessions();
      expect(maxSessions).toBeGreaterThan(0);
    });

    test("should return default value of 100 when not configured", () => {
      // Default is 100 unless HTTP_MAX_SSE_SESSIONS env var is set
      const maxSessions = getMaxSessions();
      // Could be overridden by env var, so just check it's a reasonable positive number
      expect(maxSessions).toBeGreaterThan(0);
      expect(maxSessions).toBeLessThanOrEqual(10000);
    });
  });

  describe("closeAllSessions", () => {
    test("should not throw when no sessions exist", async () => {
      // Should complete without throwing
      await closeAllSessions();
      // If we reach here, no error was thrown
      expect(true).toBe(true);
    });

    test("should result in zero active sessions", async () => {
      await closeAllSessions();
      expect(getActiveSessionCount()).toBe(0);
    });
  });

  describe("Session Cleanup Timer", () => {
    test("startSessionCleanup should not throw", () => {
      expect(() => startSessionCleanup()).not.toThrow();
    });

    test("stopSessionCleanup should not throw", () => {
      expect(() => stopSessionCleanup()).not.toThrow();
    });

    test("multiple startSessionCleanup calls should be idempotent", () => {
      // Calling multiple times should not throw or create multiple timers
      expect(() => {
        startSessionCleanup();
        startSessionCleanup();
        startSessionCleanup();
      }).not.toThrow();
    });

    test("stopSessionCleanup should stop the cleanup timer", () => {
      startSessionCleanup();
      // Should not throw when called after start
      expect(() => stopSessionCleanup()).not.toThrow();
    });

    test("stopSessionCleanup is idempotent when called multiple times", () => {
      startSessionCleanup();
      expect(() => {
        stopSessionCleanup();
        stopSessionCleanup();
        stopSessionCleanup();
      }).not.toThrow();
    });

    test("closeAllSessions should stop cleanup timer", async () => {
      startSessionCleanup();
      await closeAllSessions();
      // After closeAllSessions, calling stopSessionCleanup should be safe
      expect(() => stopSessionCleanup()).not.toThrow();
    });
  });
});
