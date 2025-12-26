/**
 * MCP Rate Limiter
 *
 * Provides in-memory rate limiting for MCP tool operations.
 * Designed to prevent abuse of expensive operations like incremental updates.
 *
 * @module mcp/rate-limiter
 */

import { getComponentLogger } from "../logging/index.js";

/**
 * Rate limit entry tracking state for a single repository
 */
interface RateLimitEntry {
  /** Unix timestamp (ms) of the last successful trigger */
  lastTriggerTime: number;
  /** Whether an update operation is currently in progress */
  inProgress: boolean;
}

/**
 * Result of checking if a trigger is allowed
 */
export interface RateLimitCheckResult {
  /** Whether the trigger is allowed */
  allowed: boolean;
  /** If not allowed, reason why */
  reason?: "rate_limited" | "in_progress";
  /** If rate limited, milliseconds until retry is allowed */
  retryAfterMs?: number;
}

/**
 * Configuration for the rate limiter
 */
export interface RateLimiterConfig {
  /** Cooldown period between triggers in milliseconds (default: 5 minutes) */
  cooldownMs?: number;
}

/**
 * Default cooldown period: 5 minutes
 */
const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * MCP Rate Limiter
 *
 * Provides per-repository rate limiting for MCP operations.
 * State is stored in-memory and resets on service restart.
 *
 * Async-safe due to JavaScript's single-threaded event loop - state
 * transitions are atomic between await points.
 *
 * @example
 * ```typescript
 * const limiter = new MCPRateLimiter({ cooldownMs: 5 * 60 * 1000 });
 *
 * // Check if trigger is allowed
 * const check = limiter.canTrigger("my-repo");
 * if (!check.allowed) {
 *   return { error: check.reason, retryAfterMs: check.retryAfterMs };
 * }
 *
 * // Mark as in progress before starting
 * limiter.markInProgress("my-repo");
 *
 * try {
 *   await performUpdate();
 * } finally {
 *   // Always mark complete when done
 *   limiter.markComplete("my-repo");
 * }
 * ```
 */
export class MCPRateLimiter {
  private readonly limits: Map<string, RateLimitEntry> = new Map();
  private readonly cooldownMs: number;
  private readonly logger: ReturnType<typeof getComponentLogger>;

  /**
   * Creates a new rate limiter instance
   *
   * @param config - Configuration options
   */
  constructor(config: RateLimiterConfig = {}) {
    this.cooldownMs = config.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.logger = getComponentLogger("mcp:rate-limiter");
  }

  /**
   * Check if a trigger is allowed for the given repository
   *
   * A trigger is allowed if:
   * 1. No update is currently in progress for this repository
   * 2. Either this is the first trigger, OR the cooldown period has elapsed
   *
   * @param repositoryName - Name of the repository to check
   * @returns Check result indicating if trigger is allowed
   */
  canTrigger(repositoryName: string): RateLimitCheckResult {
    const entry = this.limits.get(repositoryName);

    // First trigger for this repository - always allowed
    if (!entry) {
      this.logger.debug({ repository: repositoryName }, "First trigger for repository - allowed");
      return { allowed: true };
    }

    // Check if update is in progress
    if (entry.inProgress) {
      this.logger.debug(
        { repository: repositoryName },
        "Update in progress for repository - blocked"
      );
      return {
        allowed: false,
        reason: "in_progress",
      };
    }

    // Check cooldown period
    const now = Date.now();
    const elapsed = now - entry.lastTriggerTime;
    const remaining = this.cooldownMs - elapsed;

    if (remaining > 0) {
      this.logger.debug(
        {
          repository: repositoryName,
          elapsedMs: elapsed,
          remainingMs: remaining,
          cooldownMs: this.cooldownMs,
        },
        "Repository in cooldown period - rate limited"
      );
      return {
        allowed: false,
        reason: "rate_limited",
        retryAfterMs: remaining,
      };
    }

    // Cooldown elapsed - allowed
    this.logger.debug(
      { repository: repositoryName, elapsedMs: elapsed },
      "Cooldown elapsed - trigger allowed"
    );
    return { allowed: true };
  }

  /**
   * Mark a repository as having an update in progress
   *
   * Call this before starting an update operation.
   * Must call markComplete() when the operation finishes.
   *
   * @param repositoryName - Name of the repository
   */
  markInProgress(repositoryName: string): void {
    const entry = this.limits.get(repositoryName);
    if (entry) {
      entry.inProgress = true;
    } else {
      this.limits.set(repositoryName, {
        lastTriggerTime: 0,
        inProgress: true,
      });
    }
    this.logger.debug({ repository: repositoryName }, "Marked update in progress");
  }

  /**
   * Mark a repository update as complete
   *
   * Call this after an update operation finishes (success or failure).
   * Updates the lastTriggerTime and clears the inProgress flag.
   *
   * @param repositoryName - Name of the repository
   */
  markComplete(repositoryName: string): void {
    const now = Date.now();
    this.limits.set(repositoryName, {
      lastTriggerTime: now,
      inProgress: false,
    });
    this.logger.debug(
      { repository: repositoryName, lastTriggerTime: now },
      "Marked update complete"
    );
  }

  /**
   * Check if an update is currently in progress for a repository
   *
   * @param repositoryName - Name of the repository
   * @returns True if an update is in progress
   */
  isInProgress(repositoryName: string): boolean {
    return this.limits.get(repositoryName)?.inProgress ?? false;
  }

  /**
   * Get the configured cooldown period in milliseconds
   *
   * @returns Cooldown period in milliseconds
   */
  getCooldownMs(): number {
    return this.cooldownMs;
  }

  /**
   * Clear all rate limit state (useful for testing)
   */
  clear(): void {
    this.limits.clear();
    this.logger.debug("Cleared all rate limit state");
  }

  /**
   * Get the number of tracked repositories (useful for testing/monitoring)
   *
   * @returns Number of repositories with rate limit state
   */
  size(): number {
    return this.limits.size;
  }
}

/**
 * Singleton instance for shared rate limiting across MCP tools
 *
 * Use this for production code. For testing, create individual instances.
 */
let sharedInstance: MCPRateLimiter | null = null;

/**
 * Get the shared rate limiter instance
 *
 * Creates the instance on first call with default configuration.
 *
 * @returns Shared rate limiter instance
 */
export function getSharedRateLimiter(): MCPRateLimiter {
  if (!sharedInstance) {
    sharedInstance = new MCPRateLimiter();
  }
  return sharedInstance;
}

/**
 * Reset the shared rate limiter instance (for testing)
 */
export function resetSharedRateLimiter(): void {
  sharedInstance = null;
}
