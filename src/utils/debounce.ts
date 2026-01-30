/**
 * Debounce utility for batching rapid events
 *
 * Provides a reusable debounce mechanism for event batching with:
 * - Configurable delay (100ms - 300000ms)
 * - Timer reset on new events
 * - Batch accumulation during debounce window
 * - Optional maximum wait time for forced execution
 * - Flush and cancel methods for graceful shutdown
 * - Type-safe generic implementation
 *
 * Primary use case: File watcher events during active editing
 */

import type pino from "pino";

/**
 * Minimum allowed debounce delay in milliseconds
 */
export const MIN_DEBOUNCE_MS = 100;

/**
 * Maximum allowed debounce delay in milliseconds
 */
export const MAX_DEBOUNCE_MS = 300000;

/**
 * Configuration for debounce behavior
 *
 * @example
 * ```typescript
 * const config: DebounceConfig = {
 *   delayMs: 2000,      // Wait 2 seconds after last event
 *   maxWaitMs: 30000,   // Force execution after 30 seconds max
 * };
 * ```
 */
export interface DebounceConfig {
  /**
   * Delay in milliseconds before executing (100-300000ms)
   * Timer resets when new items arrive within this window
   * @default 2000
   */
  delayMs: number;

  /**
   * Maximum wait time before forcing execution (optional)
   * If set, execution will occur after this duration even if new events keep arriving
   * Useful to prevent indefinite accumulation during sustained activity
   *
   * **Note**: When not set, batch size is unbounded - items accumulate indefinitely
   * until a quiet period occurs. For memory-constrained environments or
   * high-throughput scenarios, consider setting this to bound accumulation.
   */
  maxWaitMs?: number;
}

/**
 * Default debounce configuration matching database defaults
 */
export const DEFAULT_DEBOUNCE_CONFIG: DebounceConfig = {
  delayMs: 2000, // Match watched_folders table default
  maxWaitMs: undefined, // No forced execution by default
};

/**
 * Options for creating a debounced batcher
 */
export interface DebounceOptions<T> {
  /**
   * Callback when debounce timer starts (first item arrives after idle)
   */
  onDebounceStart?: () => void;

  /**
   * Callback when function executes with batched items
   * @param items - Array of accumulated items
   */
  onExecute?: (items: T[]) => void | Promise<void>;

  /**
   * Logger for observability
   */
  logger?: pino.Logger;
}

/**
 * A debounced function that batches items
 */
export interface DebouncedFunction<T> {
  /**
   * Add an item to the pending batch
   * Resets the debounce timer
   * @param item - Item to add to the batch
   */
  push(item: T): void;

  /**
   * Force immediate execution of pending items
   * Returns a promise that resolves when execution completes
   * No-op if no items are pending
   */
  flush(): Promise<void>;

  /**
   * Cancel pending execution and discard accumulated items
   * Clears the debounce timer without executing
   */
  cancel(): void;

  /**
   * Get count of pending items waiting to be processed
   */
  readonly pendingCount: number;

  /**
   * Check if debounce timer is active
   */
  readonly isActive: boolean;
}

/**
 * Parse an environment variable as a bounded integer
 *
 * @param value - Environment variable value (may be undefined)
 * @param defaultVal - Default value to use if parsing fails
 * @param min - Minimum allowed value
 * @param max - Maximum allowed value
 * @returns Parsed integer clamped to bounds or default
 */
function parseBoundedInt(
  value: string | undefined,
  defaultVal: number,
  min: number,
  max: number
): number {
  if (value === undefined || value === "") {
    return defaultVal;
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    return defaultVal;
  }
  return Math.max(min, Math.min(max, parsed));
}

/**
 * Load debounce configuration from environment variables
 *
 * Reads the following environment variables:
 * - DEBOUNCE_DELAY_MS: Delay in ms (default: 2000, range: 100-300000)
 * - DEBOUNCE_MAX_WAIT_MS: Maximum wait in ms (optional, range: 100-300000)
 *
 * Invalid values fall back to defaults. Values outside range are clamped.
 *
 * @returns DebounceConfig with values from environment or defaults
 */
export function createDebounceConfigFromEnv(): DebounceConfig {
  const delayMs = parseBoundedInt(
    Bun.env["DEBOUNCE_DELAY_MS"],
    DEFAULT_DEBOUNCE_CONFIG.delayMs,
    MIN_DEBOUNCE_MS,
    MAX_DEBOUNCE_MS
  );

  const maxWaitEnv = Bun.env["DEBOUNCE_MAX_WAIT_MS"];
  let maxWaitMs: number | undefined;
  if (maxWaitEnv !== undefined && maxWaitEnv !== "") {
    const parsed = parseInt(maxWaitEnv, 10);
    if (!isNaN(parsed)) {
      maxWaitMs = Math.max(MIN_DEBOUNCE_MS, Math.min(MAX_DEBOUNCE_MS, parsed));
    }
  }

  return {
    delayMs,
    maxWaitMs,
  };
}

/**
 * Validate debounce configuration
 *
 * Ensures delay is within allowed range and maxWaitMs >= delayMs if set.
 *
 * @param config - Configuration to validate
 * @returns Validated configuration with clamped values
 */
export function validateDebounceConfig(config: DebounceConfig): DebounceConfig {
  const delayMs = Math.max(MIN_DEBOUNCE_MS, Math.min(MAX_DEBOUNCE_MS, config.delayMs));
  let maxWaitMs = config.maxWaitMs;

  if (maxWaitMs !== undefined) {
    // Clamp to range
    maxWaitMs = Math.max(MIN_DEBOUNCE_MS, Math.min(MAX_DEBOUNCE_MS, maxWaitMs));
    // Ensure maxWaitMs >= delayMs
    if (maxWaitMs < delayMs) {
      maxWaitMs = delayMs;
    }
  }

  return { delayMs, maxWaitMs };
}

/**
 * Create a debounced batcher that accumulates items and processes them after a quiet period
 *
 * The batcher delays execution until no new items arrive within the configured delay.
 * All items accumulated during the debounce window are passed to the handler as a batch.
 *
 * @template T - Type of items being batched
 * @param config - Debounce configuration (delay and optional max wait)
 * @param options - Callbacks and logging options
 * @returns DebouncedFunction interface for pushing items and controlling execution
 *
 * @example
 * ```typescript
 * // Create debounced batcher for file changes
 * const batcher = createDebouncedBatcher<FileChange>(
 *   { delayMs: 2000 },
 *   {
 *     logger: getComponentLogger('watcher'),
 *     onExecute: async (changes) => {
 *       await processBatch(changes);
 *     },
 *   }
 * );
 *
 * // On file change events:
 * batcher.push({ path: '/src/index.ts', status: 'modified' });
 * batcher.push({ path: '/src/utils.ts', status: 'modified' });
 *
 * // After 2 seconds of quiet: onExecute called with both changes
 *
 * // On shutdown:
 * await batcher.flush();  // Process any remaining items
 * batcher.cancel();       // Or discard remaining items
 * ```
 */
export function createDebouncedBatcher<T>(
  config: DebounceConfig,
  options: DebounceOptions<T> = {}
): DebouncedFunction<T> {
  const validatedConfig = validateDebounceConfig(config);
  const { delayMs, maxWaitMs } = validatedConfig;
  const { onDebounceStart, onExecute, logger } = options;

  // State
  let pendingItems: T[] = [];
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let maxWaitTimer: ReturnType<typeof setTimeout> | null = null;
  let firstItemTime: number | null = null;
  let executionInProgress = false;

  /**
   * Clear all timers
   */
  function clearTimers(): void {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (maxWaitTimer !== null) {
      clearTimeout(maxWaitTimer);
      maxWaitTimer = null;
    }
  }

  /**
   * Execute with current pending items.
   * Uses executionInProgress guard to prevent race conditions between
   * flush() calls and timer-triggered executions.
   */
  async function execute(): Promise<void> {
    // Guard against concurrent execution (e.g., flush() racing with timer)
    if (executionInProgress) {
      return;
    }
    executionInProgress = true;

    try {
      clearTimers();

      const items = pendingItems;
      const totalWaitMs = firstItemTime !== null ? Date.now() - firstItemTime : delayMs;

      pendingItems = [];
      firstItemTime = null;

      if (items.length === 0) {
        return;
      }

      logger?.debug(
        {
          batchSize: items.length,
          totalWaitMs,
          delayMs,
        },
        "Executing debounced batch"
      );

      if (onExecute) {
        await onExecute(items);
      }
    } finally {
      executionInProgress = false;
    }
  }

  /**
   * Start the debounce timer
   */
  function startDebounceTimer(): void {
    // Clear existing debounce timer
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      execute().catch((error: unknown) => {
        logger?.error({ error }, "Error executing debounced batch");
      });
    }, delayMs);
  }

  /**
   * Start the max wait timer (if configured)
   */
  function startMaxWaitTimer(): void {
    if (maxWaitMs === undefined || maxWaitTimer !== null) {
      return;
    }

    maxWaitTimer = setTimeout(() => {
      logger?.debug(
        {
          maxWaitMs,
          pendingCount: pendingItems.length,
        },
        "Max wait time reached, forcing execution"
      );
      execute().catch((error: unknown) => {
        logger?.error({ error }, "Error executing debounced batch (max wait)");
      });
    }, maxWaitMs);
  }

  return {
    push(item: T): void {
      const wasIdle = pendingItems.length === 0;

      pendingItems.push(item);

      if (wasIdle) {
        // First item after idle - record time and trigger callbacks
        firstItemTime = Date.now();

        logger?.debug(
          {
            delayMs,
            maxWaitMs,
          },
          "Debounce timer started"
        );

        if (onDebounceStart) {
          onDebounceStart();
        }

        // Start max wait timer on first item
        startMaxWaitTimer();
      }

      // Always reset the debounce timer
      startDebounceTimer();
    },

    async flush(): Promise<void> {
      await execute();
    },

    cancel(): void {
      clearTimers();

      const discardedCount = pendingItems.length;
      pendingItems = [];
      firstItemTime = null;

      if (discardedCount > 0) {
        logger?.debug(
          {
            discardedCount,
          },
          "Debounce cancelled, items discarded"
        );
      }
    },

    get pendingCount(): number {
      return pendingItems.length;
    },

    get isActive(): boolean {
      return debounceTimer !== null;
    },
  };
}
