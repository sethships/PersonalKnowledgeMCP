/**
 * Tests for MCP Rate Limiter
 *
 * Comprehensive test coverage for the rate limiting functionality.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  MCPRateLimiter,
  getSharedRateLimiter,
  resetSharedRateLimiter,
} from "../../src/mcp/rate-limiter.js";
import { initializeLogger, resetLogger } from "../../src/logging/index.js";

describe("MCPRateLimiter", () => {
  let limiter: MCPRateLimiter;

  beforeEach(() => {
    try {
      initializeLogger({ level: "silent", format: "json" });
    } catch {
      // Logger already initialized
    }
    limiter = new MCPRateLimiter({ cooldownMs: 1000 }); // 1 second for faster tests
  });

  afterEach(() => {
    resetLogger();
  });

  describe("canTrigger", () => {
    it("should allow first trigger for a repository", () => {
      const result = limiter.canTrigger("test-repo");
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
      expect(result.retryAfterMs).toBeUndefined();
    });

    it("should block trigger when update is in progress", () => {
      limiter.markInProgress("test-repo");

      const result = limiter.canTrigger("test-repo");
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("in_progress");
    });

    it("should block trigger during cooldown period", () => {
      // Simulate a completed update
      limiter.markInProgress("test-repo");
      limiter.markComplete("test-repo");

      const result = limiter.canTrigger("test-repo");
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("rate_limited");
      expect(result.retryAfterMs).toBeDefined();
      expect(result.retryAfterMs).toBeGreaterThan(0);
      expect(result.retryAfterMs).toBeLessThanOrEqual(1000);
    });

    it("should allow trigger after cooldown period elapses", async () => {
      // Use a very short cooldown for this test
      const shortLimiter = new MCPRateLimiter({ cooldownMs: 50 });

      shortLimiter.markInProgress("test-repo");
      shortLimiter.markComplete("test-repo");

      // Wait for cooldown to elapse
      await new Promise((resolve) => setTimeout(resolve, 60));

      const result = shortLimiter.canTrigger("test-repo");
      expect(result.allowed).toBe(true);
    });

    it("should track multiple repositories independently", () => {
      limiter.markInProgress("repo-1");

      const result1 = limiter.canTrigger("repo-1");
      const result2 = limiter.canTrigger("repo-2");

      expect(result1.allowed).toBe(false);
      expect(result1.reason).toBe("in_progress");
      expect(result2.allowed).toBe(true);
    });
  });

  describe("markInProgress", () => {
    it("should mark repository as in progress", () => {
      limiter.markInProgress("test-repo");
      expect(limiter.isInProgress("test-repo")).toBe(true);
    });

    it("should handle marking same repository multiple times", () => {
      limiter.markInProgress("test-repo");
      limiter.markInProgress("test-repo");
      expect(limiter.isInProgress("test-repo")).toBe(true);
    });

    it("should track in-progress state for new repository", () => {
      expect(limiter.isInProgress("new-repo")).toBe(false);
      limiter.markInProgress("new-repo");
      expect(limiter.isInProgress("new-repo")).toBe(true);
    });
  });

  describe("markComplete", () => {
    it("should clear in-progress flag", () => {
      limiter.markInProgress("test-repo");
      expect(limiter.isInProgress("test-repo")).toBe(true);

      limiter.markComplete("test-repo");
      expect(limiter.isInProgress("test-repo")).toBe(false);
    });

    it("should update last trigger time", () => {
      limiter.markComplete("test-repo");

      const result = limiter.canTrigger("test-repo");
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("rate_limited");
    });

    it("should handle marking complete on unknown repository", () => {
      // Should not throw
      limiter.markComplete("unknown-repo");
      expect(limiter.isInProgress("unknown-repo")).toBe(false);
    });
  });

  describe("isInProgress", () => {
    it("should return false for unknown repository", () => {
      expect(limiter.isInProgress("unknown")).toBe(false);
    });

    it("should return true for in-progress repository", () => {
      limiter.markInProgress("test-repo");
      expect(limiter.isInProgress("test-repo")).toBe(true);
    });

    it("should return false after completion", () => {
      limiter.markInProgress("test-repo");
      limiter.markComplete("test-repo");
      expect(limiter.isInProgress("test-repo")).toBe(false);
    });
  });

  describe("getCooldownMs", () => {
    it("should return configured cooldown", () => {
      expect(limiter.getCooldownMs()).toBe(1000);
    });

    it("should use default cooldown when not specified", () => {
      const defaultLimiter = new MCPRateLimiter();
      expect(defaultLimiter.getCooldownMs()).toBe(5 * 60 * 1000); // 5 minutes
    });
  });

  describe("clear", () => {
    it("should clear all rate limit state", () => {
      limiter.markInProgress("repo-1");
      limiter.markComplete("repo-2");

      limiter.clear();

      expect(limiter.size()).toBe(0);
      expect(limiter.isInProgress("repo-1")).toBe(false);
      expect(limiter.canTrigger("repo-2").allowed).toBe(true);
    });
  });

  describe("size", () => {
    it("should return 0 for empty limiter", () => {
      expect(limiter.size()).toBe(0);
    });

    it("should return correct count of tracked repositories", () => {
      limiter.markInProgress("repo-1");
      limiter.markComplete("repo-2");
      limiter.markComplete("repo-3");

      expect(limiter.size()).toBe(3);
    });
  });
});

describe("Shared Rate Limiter", () => {
  afterEach(() => {
    resetSharedRateLimiter();
    resetLogger();
  });

  beforeEach(() => {
    try {
      initializeLogger({ level: "silent", format: "json" });
    } catch {
      // Already initialized
    }
  });

  it("should return the same instance on multiple calls", () => {
    const instance1 = getSharedRateLimiter();
    const instance2 = getSharedRateLimiter();
    expect(instance1).toBe(instance2);
  });

  it("should create new instance after reset", () => {
    const instance1 = getSharedRateLimiter();
    instance1.markInProgress("test-repo");

    resetSharedRateLimiter();

    const instance2 = getSharedRateLimiter();
    expect(instance2).not.toBe(instance1);
    expect(instance2.isInProgress("test-repo")).toBe(false);
  });
});
