/**
 * Streamable HTTP Route Unit Tests
 *
 * Tests for Streamable HTTP session management functions.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { initializeLogger } from "../../../../src/logging/index.js";
import {
  getActiveStreamableSessionCount,
  getMaxStreamableSessions,
  closeAllStreamableSessions,
  startStreamableSessionCleanup,
  stopStreamableSessionCleanup,
} from "../../../../src/http/routes/streamable-http.js";

// Initialize logger before tests (silent mode for unit tests)
try {
  initializeLogger({ level: "silent", format: "json" });
} catch {
  // Logger already initialized by another test file, ignore
}

describe("Streamable HTTP Session Management", () => {
  beforeEach(async () => {
    // Ensure clean state before each test
    stopStreamableSessionCleanup();
    await closeAllStreamableSessions();
  });

  afterEach(async () => {
    // Clean up after each test
    stopStreamableSessionCleanup();
    await closeAllStreamableSessions();
  });

  describe("getActiveStreamableSessionCount", () => {
    test("should return 0 when no sessions exist", () => {
      const count = getActiveStreamableSessionCount();
      expect(count).toBe(0);
    });
  });

  describe("getMaxStreamableSessions", () => {
    test("should return default max sessions (100)", () => {
      const maxSessions = getMaxStreamableSessions();
      expect(maxSessions).toBe(100);
    });
  });

  describe("closeAllStreamableSessions", () => {
    test("should result in zero active sessions", async () => {
      await closeAllStreamableSessions();
      expect(getActiveStreamableSessionCount()).toBe(0);
    });

    test("should be idempotent (safe to call multiple times)", async () => {
      await closeAllStreamableSessions();
      await closeAllStreamableSessions();
      await closeAllStreamableSessions();
      expect(getActiveStreamableSessionCount()).toBe(0);
    });
  });

  describe("Session Cleanup Timer", () => {
    test("startStreamableSessionCleanup should be idempotent", () => {
      // Should not throw when called multiple times
      startStreamableSessionCleanup();
      startStreamableSessionCleanup();
      startStreamableSessionCleanup();

      // Clean up
      stopStreamableSessionCleanup();
    });

    test("stopStreamableSessionCleanup should be idempotent", () => {
      // Should not throw when called multiple times
      stopStreamableSessionCleanup();
      stopStreamableSessionCleanup();
      stopStreamableSessionCleanup();
    });

    test("should allow start after stop", () => {
      startStreamableSessionCleanup();
      stopStreamableSessionCleanup();
      startStreamableSessionCleanup();
      stopStreamableSessionCleanup();
    });
  });
});
