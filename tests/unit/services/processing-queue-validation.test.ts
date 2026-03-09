/**
 * @module tests/unit/services/processing-queue-validation
 *
 * Tests for ProcessingQueue Zod validation schemas.
 */

import { describe, expect, test } from "bun:test";
import { ZodError } from "zod";

import {
  ProcessingQueueConfigSchema,
  validateProcessingQueueConfig,
  safeValidateProcessingQueueConfig,
} from "../../../src/services/processing-queue-validation.js";

// =============================================================================
// Schema Validation Tests
// =============================================================================

describe("ProcessingQueueConfigSchema", () => {
  describe("valid configurations", () => {
    test("accepts empty object (all optional)", () => {
      const result = ProcessingQueueConfigSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    test("accepts full valid configuration", () => {
      const result = ProcessingQueueConfigSchema.safeParse({
        maxBatchSize: 100,
        maxQueueSize: 5000,
        batchDelayMs: 1000,
        maxBatchWaitMs: 10000,
        maxRetries: 3,
        retryDelayMs: 2000,
        shutdownTimeoutMs: 60000,
      });
      expect(result.success).toBe(true);
    });

    test("accepts partial configuration", () => {
      const result = ProcessingQueueConfigSchema.safeParse({
        maxBatchSize: 25,
        batchDelayMs: 500,
      });
      expect(result.success).toBe(true);
    });

    test("accepts boundary minimum values", () => {
      const result = ProcessingQueueConfigSchema.safeParse({
        maxBatchSize: 1,
        maxQueueSize: 1,
        batchDelayMs: 100,
        maxBatchWaitMs: 100,
        maxRetries: 0,
        retryDelayMs: 100,
        shutdownTimeoutMs: 1000,
      });
      expect(result.success).toBe(true);
    });

    test("accepts boundary maximum values", () => {
      const result = ProcessingQueueConfigSchema.safeParse({
        maxBatchSize: 1000,
        maxQueueSize: 100000,
        batchDelayMs: 300000,
        maxBatchWaitMs: 300000,
        maxRetries: 10,
        retryDelayMs: 60000,
        shutdownTimeoutMs: 300000,
      });
      expect(result.success).toBe(true);
    });
  });

  describe("maxBatchSize validation", () => {
    test("rejects zero", () => {
      const result = ProcessingQueueConfigSchema.safeParse({ maxBatchSize: 0 });
      expect(result.success).toBe(false);
    });

    test("rejects negative values", () => {
      const result = ProcessingQueueConfigSchema.safeParse({ maxBatchSize: -1 });
      expect(result.success).toBe(false);
    });

    test("rejects values above 1000", () => {
      const result = ProcessingQueueConfigSchema.safeParse({ maxBatchSize: 1001 });
      expect(result.success).toBe(false);
    });

    test("rejects non-integer values", () => {
      const result = ProcessingQueueConfigSchema.safeParse({ maxBatchSize: 50.5 });
      expect(result.success).toBe(false);
    });
  });

  describe("maxQueueSize validation", () => {
    test("rejects zero", () => {
      const result = ProcessingQueueConfigSchema.safeParse({ maxQueueSize: 0 });
      expect(result.success).toBe(false);
    });

    test("rejects values above 100000", () => {
      const result = ProcessingQueueConfigSchema.safeParse({ maxQueueSize: 100001 });
      expect(result.success).toBe(false);
    });
  });

  describe("batchDelayMs validation", () => {
    test("rejects values below 100", () => {
      const result = ProcessingQueueConfigSchema.safeParse({ batchDelayMs: 50 });
      expect(result.success).toBe(false);
    });

    test("rejects values above 300000", () => {
      const result = ProcessingQueueConfigSchema.safeParse({ batchDelayMs: 300001 });
      expect(result.success).toBe(false);
    });
  });

  describe("maxBatchWaitMs validation", () => {
    test("rejects values below 100", () => {
      const result = ProcessingQueueConfigSchema.safeParse({ maxBatchWaitMs: 50 });
      expect(result.success).toBe(false);
    });

    test("rejects values above 300000", () => {
      const result = ProcessingQueueConfigSchema.safeParse({ maxBatchWaitMs: 300001 });
      expect(result.success).toBe(false);
    });
  });

  describe("maxRetries validation", () => {
    test("accepts zero (no retries)", () => {
      const result = ProcessingQueueConfigSchema.safeParse({ maxRetries: 0 });
      expect(result.success).toBe(true);
    });

    test("rejects negative values", () => {
      const result = ProcessingQueueConfigSchema.safeParse({ maxRetries: -1 });
      expect(result.success).toBe(false);
    });

    test("rejects values above 10", () => {
      const result = ProcessingQueueConfigSchema.safeParse({ maxRetries: 11 });
      expect(result.success).toBe(false);
    });
  });

  describe("retryDelayMs validation", () => {
    test("rejects values below 100", () => {
      const result = ProcessingQueueConfigSchema.safeParse({ retryDelayMs: 50 });
      expect(result.success).toBe(false);
    });

    test("rejects values above 60000", () => {
      const result = ProcessingQueueConfigSchema.safeParse({ retryDelayMs: 60001 });
      expect(result.success).toBe(false);
    });
  });

  describe("shutdownTimeoutMs validation", () => {
    test("rejects values below 1000", () => {
      const result = ProcessingQueueConfigSchema.safeParse({ shutdownTimeoutMs: 500 });
      expect(result.success).toBe(false);
    });

    test("rejects values above 300000", () => {
      const result = ProcessingQueueConfigSchema.safeParse({ shutdownTimeoutMs: 300001 });
      expect(result.success).toBe(false);
    });
  });

  describe("cross-field validation", () => {
    test("rejects maxBatchWaitMs < batchDelayMs", () => {
      const result = ProcessingQueueConfigSchema.safeParse({
        batchDelayMs: 5000,
        maxBatchWaitMs: 1000,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]!.path).toContain("maxBatchWaitMs");
      }
    });

    test("accepts maxBatchWaitMs equal to batchDelayMs", () => {
      const result = ProcessingQueueConfigSchema.safeParse({
        batchDelayMs: 5000,
        maxBatchWaitMs: 5000,
      });
      expect(result.success).toBe(true);
    });

    test("rejects maxQueueSize < maxBatchSize", () => {
      const result = ProcessingQueueConfigSchema.safeParse({
        maxBatchSize: 100,
        maxQueueSize: 50,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]!.path).toContain("maxQueueSize");
      }
    });

    test("accepts maxQueueSize equal to maxBatchSize", () => {
      const result = ProcessingQueueConfigSchema.safeParse({
        maxBatchSize: 50,
        maxQueueSize: 50,
      });
      expect(result.success).toBe(true);
    });
  });

  describe("type validation", () => {
    test("rejects string values for numeric fields", () => {
      const result = ProcessingQueueConfigSchema.safeParse({ maxBatchSize: "50" });
      expect(result.success).toBe(false);
    });

    test("rejects boolean values for numeric fields", () => {
      const result = ProcessingQueueConfigSchema.safeParse({ maxRetries: true });
      expect(result.success).toBe(false);
    });
  });
});

// =============================================================================
// Helper Function Tests
// =============================================================================

describe("validateProcessingQueueConfig", () => {
  test("returns validated config for valid input", () => {
    const result = validateProcessingQueueConfig({ maxBatchSize: 25 });
    expect(result.maxBatchSize).toBe(25);
  });

  test("throws ZodError for invalid input", () => {
    expect(() => validateProcessingQueueConfig({ maxBatchSize: -1 })).toThrow(ZodError);
  });
});

describe("safeValidateProcessingQueueConfig", () => {
  test("returns success for valid input", () => {
    const result = safeValidateProcessingQueueConfig({ maxBatchSize: 25 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.maxBatchSize).toBe(25);
    }
  });

  test("returns failure for invalid input", () => {
    const result = safeValidateProcessingQueueConfig({ maxBatchSize: -1 });
    expect(result.success).toBe(false);
  });
});
