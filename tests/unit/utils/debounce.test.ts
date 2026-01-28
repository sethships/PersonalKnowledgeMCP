/**
 * Unit tests for debounce utility
 *
 * Tests timer management, batch accumulation, flush/cancel behavior,
 * max wait functionality, and configuration validation.
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import {
  createDebouncedBatcher,
  createDebounceConfigFromEnv,
  validateDebounceConfig,
  DEFAULT_DEBOUNCE_CONFIG,
  MIN_DEBOUNCE_MS,
  MAX_DEBOUNCE_MS,
  type DebounceConfig,
} from "../../../src/utils/debounce.js";

/**
 * Helper to wait for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("DEFAULT_DEBOUNCE_CONFIG", () => {
  test("has expected default values", () => {
    expect(DEFAULT_DEBOUNCE_CONFIG).toEqual({
      delayMs: 2000,
      maxWaitMs: undefined,
    });
  });
});

describe("validateDebounceConfig", () => {
  test("returns unchanged config when valid", () => {
    const config: DebounceConfig = { delayMs: 2000, maxWaitMs: 10000 };
    const result = validateDebounceConfig(config);

    expect(result.delayMs).toBe(2000);
    expect(result.maxWaitMs).toBe(10000);
  });

  test("clamps delayMs to minimum", () => {
    const config: DebounceConfig = { delayMs: 50 }; // Below MIN_DEBOUNCE_MS
    const result = validateDebounceConfig(config);

    expect(result.delayMs).toBe(MIN_DEBOUNCE_MS);
  });

  test("clamps delayMs to maximum", () => {
    const config: DebounceConfig = { delayMs: 500000 }; // Above MAX_DEBOUNCE_MS
    const result = validateDebounceConfig(config);

    expect(result.delayMs).toBe(MAX_DEBOUNCE_MS);
  });

  test("clamps maxWaitMs to minimum", () => {
    const config: DebounceConfig = { delayMs: 100, maxWaitMs: 50 };
    const result = validateDebounceConfig(config);

    expect(result.maxWaitMs).toBe(MIN_DEBOUNCE_MS);
  });

  test("clamps maxWaitMs to maximum", () => {
    const config: DebounceConfig = { delayMs: 2000, maxWaitMs: 500000 };
    const result = validateDebounceConfig(config);

    expect(result.maxWaitMs).toBe(MAX_DEBOUNCE_MS);
  });

  test("ensures maxWaitMs >= delayMs", () => {
    const config: DebounceConfig = { delayMs: 5000, maxWaitMs: 3000 };
    const result = validateDebounceConfig(config);

    expect(result.delayMs).toBe(5000);
    expect(result.maxWaitMs).toBe(5000);
  });

  test("handles undefined maxWaitMs", () => {
    const config: DebounceConfig = { delayMs: 2000 };
    const result = validateDebounceConfig(config);

    expect(result.delayMs).toBe(2000);
    expect(result.maxWaitMs).toBeUndefined();
  });
});

describe("createDebounceConfigFromEnv", () => {
  beforeEach(() => {
    // Clear relevant env variables
    delete Bun.env["DEBOUNCE_DELAY_MS"];
    delete Bun.env["DEBOUNCE_MAX_WAIT_MS"];
  });

  afterEach(() => {
    // Cleanup
    delete Bun.env["DEBOUNCE_DELAY_MS"];
    delete Bun.env["DEBOUNCE_MAX_WAIT_MS"];
  });

  test("returns defaults when no env vars set", () => {
    const config = createDebounceConfigFromEnv();

    expect(config.delayMs).toBe(2000);
    expect(config.maxWaitMs).toBeUndefined();
  });

  test("reads DEBOUNCE_DELAY_MS from environment", () => {
    Bun.env["DEBOUNCE_DELAY_MS"] = "5000";

    const config = createDebounceConfigFromEnv();

    expect(config.delayMs).toBe(5000);
  });

  test("reads DEBOUNCE_MAX_WAIT_MS from environment", () => {
    Bun.env["DEBOUNCE_MAX_WAIT_MS"] = "30000";

    const config = createDebounceConfigFromEnv();

    expect(config.maxWaitMs).toBe(30000);
  });

  test("clamps DEBOUNCE_DELAY_MS to minimum", () => {
    Bun.env["DEBOUNCE_DELAY_MS"] = "10";

    const config = createDebounceConfigFromEnv();

    expect(config.delayMs).toBe(MIN_DEBOUNCE_MS);
  });

  test("clamps DEBOUNCE_DELAY_MS to maximum", () => {
    Bun.env["DEBOUNCE_DELAY_MS"] = "999999";

    const config = createDebounceConfigFromEnv();

    expect(config.delayMs).toBe(MAX_DEBOUNCE_MS);
  });

  test("clamps DEBOUNCE_MAX_WAIT_MS to minimum", () => {
    Bun.env["DEBOUNCE_MAX_WAIT_MS"] = "10";

    const config = createDebounceConfigFromEnv();

    expect(config.maxWaitMs).toBe(MIN_DEBOUNCE_MS);
  });

  test("clamps DEBOUNCE_MAX_WAIT_MS to maximum", () => {
    Bun.env["DEBOUNCE_MAX_WAIT_MS"] = "999999";

    const config = createDebounceConfigFromEnv();

    expect(config.maxWaitMs).toBe(MAX_DEBOUNCE_MS);
  });

  test("falls back to default for NaN DEBOUNCE_DELAY_MS", () => {
    Bun.env["DEBOUNCE_DELAY_MS"] = "not-a-number";

    const config = createDebounceConfigFromEnv();

    expect(config.delayMs).toBe(DEFAULT_DEBOUNCE_CONFIG.delayMs);
  });

  test("ignores NaN DEBOUNCE_MAX_WAIT_MS", () => {
    Bun.env["DEBOUNCE_MAX_WAIT_MS"] = "invalid";

    const config = createDebounceConfigFromEnv();

    expect(config.maxWaitMs).toBeUndefined();
  });

  test("falls back to default for empty string values", () => {
    Bun.env["DEBOUNCE_DELAY_MS"] = "";
    Bun.env["DEBOUNCE_MAX_WAIT_MS"] = "";

    const config = createDebounceConfigFromEnv();

    expect(config.delayMs).toBe(DEFAULT_DEBOUNCE_CONFIG.delayMs);
    expect(config.maxWaitMs).toBeUndefined();
  });
});

describe("createDebouncedBatcher - basic functionality", () => {
  test("does not execute immediately when item pushed", async () => {
    const onExecute = mock(async (_items: string[]) => {});
    const batcher = createDebouncedBatcher<string>({ delayMs: 100 }, { onExecute });

    batcher.push("item1");

    expect(onExecute).not.toHaveBeenCalled();
    expect(batcher.pendingCount).toBe(1);
    expect(batcher.isActive).toBe(true);

    // Cleanup
    batcher.cancel();
  });

  test("executes after delay expires", async () => {
    const executedItems: string[][] = [];
    const onExecute = mock(async (items: string[]) => {
      executedItems.push([...items]);
    });
    const batcher = createDebouncedBatcher<string>({ delayMs: MIN_DEBOUNCE_MS }, { onExecute });

    batcher.push("item1");
    batcher.push("item2");

    // Wait for debounce to complete (MIN_DEBOUNCE_MS is 100ms)
    await sleep(150);

    expect(onExecute).toHaveBeenCalledTimes(1);
    expect(executedItems[0]).toEqual(["item1", "item2"]);
    expect(batcher.pendingCount).toBe(0);
    expect(batcher.isActive).toBe(false);
  });

  test("resets timer when new item arrives", async () => {
    const executedItems: string[][] = [];
    const onExecute = mock(async (items: string[]) => {
      executedItems.push([...items]);
    });
    const batcher = createDebouncedBatcher<string>({ delayMs: 100 }, { onExecute });

    batcher.push("item1");

    // Wait 60ms (less than delay)
    await sleep(60);

    // Push another item - should reset timer
    batcher.push("item2");

    // Wait another 60ms (total 120ms from first, but only 60ms from last)
    await sleep(60);

    // Should not have executed yet
    expect(onExecute).not.toHaveBeenCalled();
    expect(batcher.pendingCount).toBe(2);

    // Wait for remaining time
    await sleep(60);

    expect(onExecute).toHaveBeenCalledTimes(1);
    expect(executedItems[0]).toEqual(["item1", "item2"]);
  });

  test("accumulates multiple items in batch", async () => {
    const executedItems: number[][] = [];
    const onExecute = mock(async (items: number[]) => {
      executedItems.push([...items]);
    });
    const batcher = createDebouncedBatcher<number>({ delayMs: MIN_DEBOUNCE_MS }, { onExecute });

    for (let i = 1; i <= 10; i++) {
      batcher.push(i);
    }

    expect(batcher.pendingCount).toBe(10);

    await sleep(150);

    expect(onExecute).toHaveBeenCalledTimes(1);
    expect(executedItems[0]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  test("handles multiple batches sequentially", async () => {
    const executedBatches: string[][] = [];
    const onExecute = mock(async (items: string[]) => {
      executedBatches.push([...items]);
    });
    const batcher = createDebouncedBatcher<string>({ delayMs: MIN_DEBOUNCE_MS }, { onExecute });

    // First batch
    batcher.push("a");
    batcher.push("b");

    await sleep(150);

    expect(executedBatches).toHaveLength(1);
    expect(executedBatches[0]).toEqual(["a", "b"]);

    // Second batch
    batcher.push("c");
    batcher.push("d");

    await sleep(150);

    expect(executedBatches).toHaveLength(2);
    expect(executedBatches[1]).toEqual(["c", "d"]);
  });
});

describe("createDebouncedBatcher - flush behavior", () => {
  test("flush immediately executes pending items", async () => {
    const executedItems: string[][] = [];
    const onExecute = mock(async (items: string[]) => {
      executedItems.push([...items]);
    });
    const batcher = createDebouncedBatcher<string>({ delayMs: 10000 }, { onExecute });

    batcher.push("item1");
    batcher.push("item2");

    expect(batcher.pendingCount).toBe(2);
    expect(onExecute).not.toHaveBeenCalled();

    await batcher.flush();

    expect(onExecute).toHaveBeenCalledTimes(1);
    expect(executedItems[0]).toEqual(["item1", "item2"]);
    expect(batcher.pendingCount).toBe(0);
    expect(batcher.isActive).toBe(false);
  });

  test("flush is no-op when no pending items", async () => {
    const onExecute = mock(async (_items: string[]) => {});
    const batcher = createDebouncedBatcher<string>({ delayMs: 100 }, { onExecute });

    await batcher.flush();

    expect(onExecute).not.toHaveBeenCalled();
  });

  test("flush clears timer", async () => {
    const executedItems: string[][] = [];
    const onExecute = mock(async (items: string[]) => {
      executedItems.push([...items]);
    });
    const batcher = createDebouncedBatcher<string>({ delayMs: 100 }, { onExecute });

    batcher.push("item1");

    expect(batcher.isActive).toBe(true);

    await batcher.flush();

    expect(batcher.isActive).toBe(false);

    // Wait to ensure no double execution
    await sleep(150);

    expect(onExecute).toHaveBeenCalledTimes(1);
  });

  test("flush waits for async onExecute to complete", async () => {
    let executeStarted = false;
    let executeCompleted = false;

    const onExecute = mock(async (_items: string[]) => {
      executeStarted = true;
      await sleep(50);
      executeCompleted = true;
    });
    const batcher = createDebouncedBatcher<string>({ delayMs: 10000 }, { onExecute });

    batcher.push("item1");

    const flushPromise = batcher.flush();

    // onExecute should have started
    await sleep(10);
    expect(executeStarted).toBe(true);
    expect(executeCompleted).toBe(false);

    // Wait for flush to complete
    await flushPromise;
    expect(executeCompleted).toBe(true);
  });
});

describe("createDebouncedBatcher - cancel behavior", () => {
  test("cancel discards pending items", async () => {
    const onExecute = mock(async (_items: string[]) => {});
    const batcher = createDebouncedBatcher<string>({ delayMs: 10000 }, { onExecute });

    batcher.push("item1");
    batcher.push("item2");

    expect(batcher.pendingCount).toBe(2);

    batcher.cancel();

    expect(batcher.pendingCount).toBe(0);
    expect(batcher.isActive).toBe(false);
  });

  test("cancel clears timer without executing", async () => {
    const onExecute = mock(async (_items: string[]) => {});
    const batcher = createDebouncedBatcher<string>({ delayMs: MIN_DEBOUNCE_MS }, { onExecute });

    batcher.push("item1");

    batcher.cancel();

    // Wait past debounce time
    await sleep(150);

    expect(onExecute).not.toHaveBeenCalled();
  });

  test("cancel is safe to call when idle", () => {
    const onExecute = mock(async (_items: string[]) => {});
    const batcher = createDebouncedBatcher<string>({ delayMs: 100 }, { onExecute });

    // Should not throw
    batcher.cancel();
    batcher.cancel();

    expect(batcher.pendingCount).toBe(0);
    expect(batcher.isActive).toBe(false);
  });

  test("can push after cancel", async () => {
    const executedItems: string[][] = [];
    const onExecute = mock(async (items: string[]) => {
      executedItems.push([...items]);
    });
    const batcher = createDebouncedBatcher<string>({ delayMs: MIN_DEBOUNCE_MS }, { onExecute });

    batcher.push("item1");
    batcher.cancel();

    batcher.push("item2");

    await sleep(150);

    expect(onExecute).toHaveBeenCalledTimes(1);
    expect(executedItems[0]).toEqual(["item2"]);
  });
});

describe("createDebouncedBatcher - maxWaitMs behavior", () => {
  test("forces execution after maxWaitMs even with continuous events", async () => {
    const executedItems: string[][] = [];
    const onExecute = mock(async (items: string[]) => {
      executedItems.push([...items]);
    });
    const batcher = createDebouncedBatcher<string>({ delayMs: 100, maxWaitMs: 200 }, { onExecute });

    // Push items rapidly, resetting debounce each time
    batcher.push("item1");
    await sleep(50);
    batcher.push("item2");
    await sleep(50);
    batcher.push("item3");
    await sleep(50);
    batcher.push("item4");
    await sleep(50);
    batcher.push("item5");

    // At this point, ~200ms have elapsed since first item
    // maxWaitMs should trigger

    await sleep(50);

    expect(onExecute).toHaveBeenCalled();
    expect(executedItems[0]!.length).toBeGreaterThan(0);

    // Cleanup
    batcher.cancel();
  });

  test("maxWaitMs timer cleared on flush", async () => {
    const onExecute = mock(async (_items: string[]) => {});
    const batcher = createDebouncedBatcher<string>({ delayMs: 100, maxWaitMs: 200 }, { onExecute });

    batcher.push("item1");

    await batcher.flush();

    // Wait past maxWaitMs - should not double execute
    await sleep(250);

    expect(onExecute).toHaveBeenCalledTimes(1);
  });

  test("maxWaitMs timer cleared on cancel", async () => {
    const onExecute = mock(async (_items: string[]) => {});
    const batcher = createDebouncedBatcher<string>({ delayMs: 100, maxWaitMs: 200 }, { onExecute });

    batcher.push("item1");

    batcher.cancel();

    // Wait past maxWaitMs - should not execute
    await sleep(250);

    expect(onExecute).not.toHaveBeenCalled();
  });

  test("no maxWaitMs timer when not configured", async () => {
    const executedItems: string[][] = [];
    const onExecute = mock(async (items: string[]) => {
      executedItems.push([...items]);
    });
    const batcher = createDebouncedBatcher<string>({ delayMs: MIN_DEBOUNCE_MS }, { onExecute });

    // Keep resetting debounce
    batcher.push("item1");
    await sleep(30);
    batcher.push("item2");
    await sleep(30);
    batcher.push("item3");
    await sleep(30);
    batcher.push("item4");

    // Should not have executed yet (debounce keeps resetting)
    expect(onExecute).not.toHaveBeenCalled();

    // Stop pushing and wait for final debounce
    await sleep(150);

    expect(onExecute).toHaveBeenCalledTimes(1);
    expect(executedItems[0]).toEqual(["item1", "item2", "item3", "item4"]);
  });
});

describe("createDebouncedBatcher - callbacks", () => {
  test("onDebounceStart called on first item only", async () => {
    const onDebounceStart = mock(() => {});
    const onExecute = mock(async (_items: string[]) => {});
    const batcher = createDebouncedBatcher<string>(
      { delayMs: MIN_DEBOUNCE_MS },
      { onDebounceStart, onExecute }
    );

    batcher.push("item1");
    expect(onDebounceStart).toHaveBeenCalledTimes(1);

    batcher.push("item2");
    batcher.push("item3");
    expect(onDebounceStart).toHaveBeenCalledTimes(1);

    await sleep(150);

    // Start of new batch
    batcher.push("item4");
    expect(onDebounceStart).toHaveBeenCalledTimes(2);

    batcher.cancel();
  });

  test("onExecute receives correct batch", async () => {
    const receivedItems: Array<{ id: number; name: string }[]> = [];
    const onExecute = mock(async (items: Array<{ id: number; name: string }>) => {
      receivedItems.push([...items]);
    });
    const batcher = createDebouncedBatcher<{ id: number; name: string }>(
      { delayMs: MIN_DEBOUNCE_MS },
      { onExecute }
    );

    batcher.push({ id: 1, name: "first" });
    batcher.push({ id: 2, name: "second" });

    await sleep(150);

    expect(receivedItems[0]).toEqual([
      { id: 1, name: "first" },
      { id: 2, name: "second" },
    ]);
  });

  test("works without any callbacks", async () => {
    const batcher = createDebouncedBatcher<string>({ delayMs: MIN_DEBOUNCE_MS }, {});

    batcher.push("item1");
    expect(batcher.pendingCount).toBe(1);

    await sleep(150);

    expect(batcher.pendingCount).toBe(0);
    expect(batcher.isActive).toBe(false);
  });
});

describe("createDebouncedBatcher - logger integration", () => {
  test("logs when debounce timer starts", () => {
    const debugCalls: Array<{ data: unknown; message: string }> = [];
    const mockLogger = {
      debug: mock((data: unknown, message: string) => {
        debugCalls.push({ data, message });
      }),
      error: mock(() => {}),
    };

    const batcher = createDebouncedBatcher<string>(
      { delayMs: 100, maxWaitMs: 500 },
      { logger: mockLogger as never }
    );

    batcher.push("item1");

    expect(debugCalls.some((c) => c.message === "Debounce timer started")).toBe(true);
    const startLog = debugCalls.find((c) => c.message === "Debounce timer started");
    expect((startLog!.data as { delayMs: number }).delayMs).toBe(100);
    expect((startLog!.data as { maxWaitMs: number }).maxWaitMs).toBe(500);

    batcher.cancel();
  });

  test("logs when items discarded on cancel", () => {
    const debugCalls: Array<{ data: unknown; message: string }> = [];
    const mockLogger = {
      debug: mock((data: unknown, message: string) => {
        debugCalls.push({ data, message });
      }),
      error: mock(() => {}),
    };

    const batcher = createDebouncedBatcher<string>(
      { delayMs: 100 },
      { logger: mockLogger as never }
    );

    batcher.push("item1");
    batcher.push("item2");
    batcher.cancel();

    const cancelLog = debugCalls.find((c) => c.message === "Debounce cancelled, items discarded");
    expect(cancelLog).toBeDefined();
    expect((cancelLog!.data as { discardedCount: number }).discardedCount).toBe(2);
  });

  test("logs execution with batch info", async () => {
    const debugCalls: Array<{ data: unknown; message: string }> = [];
    const mockLogger = {
      debug: mock((data: unknown, message: string) => {
        debugCalls.push({ data, message });
      }),
      error: mock(() => {}),
    };

    const batcher = createDebouncedBatcher<string>(
      { delayMs: MIN_DEBOUNCE_MS },
      { logger: mockLogger as never }
    );

    batcher.push("item1");
    batcher.push("item2");

    await sleep(150);

    const executeLog = debugCalls.find((c) => c.message === "Executing debounced batch");
    expect(executeLog).toBeDefined();
    expect((executeLog!.data as { batchSize: number }).batchSize).toBe(2);
    expect((executeLog!.data as { delayMs: number }).delayMs).toBe(MIN_DEBOUNCE_MS);
  });
});

describe("createDebouncedBatcher - edge cases", () => {
  test("handles empty onExecute gracefully", async () => {
    const batcher = createDebouncedBatcher<string>({ delayMs: MIN_DEBOUNCE_MS });

    batcher.push("item1");

    await sleep(150);

    expect(batcher.pendingCount).toBe(0);
  });

  test("handles thrown error in onExecute", async () => {
    const errorCalls: Array<{ data: unknown; message: string }> = [];
    const mockLogger = {
      debug: mock(() => {}),
      error: mock((data: unknown, message: string) => {
        errorCalls.push({ data, message });
      }),
    };

    const onExecute = mock(async (_items: string[]) => {
      throw new Error("Processing failed");
    });

    const batcher = createDebouncedBatcher<string>(
      { delayMs: MIN_DEBOUNCE_MS },
      { onExecute, logger: mockLogger as never }
    );

    batcher.push("item1");

    await sleep(150);

    // Should log error
    expect(errorCalls.length).toBeGreaterThan(0);
    expect(errorCalls[0]!.message).toBe("Error executing debounced batch");

    // Batcher should be reset
    expect(batcher.pendingCount).toBe(0);
    expect(batcher.isActive).toBe(false);
  });

  test("validates config with boundary values", () => {
    // Minimum delay
    const minBatcher = createDebouncedBatcher<string>({ delayMs: MIN_DEBOUNCE_MS });
    minBatcher.push("item");
    expect(minBatcher.isActive).toBe(true);
    minBatcher.cancel();

    // Maximum delay
    const maxBatcher = createDebouncedBatcher<string>({ delayMs: MAX_DEBOUNCE_MS });
    maxBatcher.push("item");
    expect(maxBatcher.isActive).toBe(true);
    maxBatcher.cancel();
  });

  test("pendingCount and isActive reflect correct state", async () => {
    const batcher = createDebouncedBatcher<string>({ delayMs: MIN_DEBOUNCE_MS });

    // Initial state
    expect(batcher.pendingCount).toBe(0);
    expect(batcher.isActive).toBe(false);

    // After push
    batcher.push("item1");
    expect(batcher.pendingCount).toBe(1);
    expect(batcher.isActive).toBe(true);

    // After another push
    batcher.push("item2");
    expect(batcher.pendingCount).toBe(2);
    expect(batcher.isActive).toBe(true);

    // After execution
    await sleep(150);
    expect(batcher.pendingCount).toBe(0);
    expect(batcher.isActive).toBe(false);
  });

  test("type safety with complex objects", async () => {
    interface FileChange {
      path: string;
      status: "added" | "modified" | "deleted";
      timestamp: number;
    }

    const changes: FileChange[][] = [];
    const onExecute = mock(async (items: FileChange[]) => {
      changes.push([...items]);
    });

    const batcher = createDebouncedBatcher<FileChange>({ delayMs: MIN_DEBOUNCE_MS }, { onExecute });

    batcher.push({ path: "/src/index.ts", status: "modified", timestamp: Date.now() });
    batcher.push({ path: "/src/utils.ts", status: "added", timestamp: Date.now() });

    await sleep(150);

    expect(changes[0]).toHaveLength(2);
    expect(changes[0]![0]!.path).toBe("/src/index.ts");
    expect(changes[0]![1]!.status).toBe("added");
  });
});
