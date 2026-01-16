/**
 * @module services/graph-service-cache
 *
 * In-memory TTL cache for GraphService query results.
 *
 * This module provides a simple, efficient cache with time-based expiration
 * and size limits to improve query performance for repeated requests.
 */

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Cache configuration options
 */
export interface CacheConfig {
  /**
   * Time-to-live for cached entries in milliseconds
   * @default 300000 (5 minutes)
   */
  ttlMs: number;

  /**
   * Maximum number of entries in the cache
   * @default 100
   */
  maxEntries: number;
}

/**
 * Default cache configuration
 */
export const DEFAULT_CACHE_CONFIG: CacheConfig = {
  ttlMs: 5 * 60 * 1000, // 5 minutes
  maxEntries: 100,
};

// =============================================================================
// Cache Statistics
// =============================================================================

/**
 * Statistics about cache usage
 */
export interface CacheStats {
  /**
   * Current number of entries in the cache
   */
  size: number;

  /**
   * Maximum number of entries allowed
   */
  maxEntries: number;

  /**
   * TTL in milliseconds
   */
  ttlMs: number;

  /**
   * Number of cache hits
   */
  hits: number;

  /**
   * Number of cache misses
   */
  misses: number;

  /**
   * Hit rate (0-1)
   */
  hitRate: number;
}

// =============================================================================
// Cache Entry
// =============================================================================

/**
 * Internal cache entry with value and expiration
 */
interface CacheEntry<T> {
  /**
   * Cached value
   */
  value: T;

  /**
   * Timestamp when the entry expires
   */
  expiresAt: number;

  /**
   * Timestamp when the entry was created
   */
  createdAt: number;
}

// =============================================================================
// QueryCache Class
// =============================================================================

/**
 * Simple in-memory cache with TTL and size limits
 *
 * Uses a Map for O(1) lookups and maintains insertion order
 * for LRU-like eviction when the cache is full.
 *
 * @example
 * ```typescript
 * const cache = new QueryCache<MyResult>({ ttlMs: 60000, maxEntries: 50 });
 *
 * // Check cache
 * const cached = cache.get("my-key");
 * if (cached) {
 *   return cached;
 * }
 *
 * // Compute and cache result
 * const result = await expensiveOperation();
 * cache.set("my-key", result);
 * return result;
 * ```
 */
export class QueryCache<T> {
  private readonly cache: Map<string, CacheEntry<T>>;
  private readonly config: CacheConfig;
  private hits: number = 0;
  private misses: number = 0;

  /**
   * Create a new QueryCache instance
   *
   * @param config - Cache configuration options
   */
  constructor(config: Partial<CacheConfig> = {}) {
    this.config = { ...DEFAULT_CACHE_CONFIG, ...config };
    this.cache = new Map();
  }

  /**
   * Generate a cache key from query parameters
   *
   * Uses djb2 hash algorithm for fast, deterministic key generation.
   *
   * @param prefix - Key prefix to namespace different query types
   * @param params - Query parameters object
   * @returns Unique cache key string
   */
  static generateKey(prefix: string, params: Record<string, unknown>): string {
    // Sort keys for consistent ordering
    const sortedParams = JSON.stringify(params, Object.keys(params).sort());

    // djb2 hash algorithm
    let hash = 5381;
    for (let i = 0; i < sortedParams.length; i++) {
      hash = (hash * 33) ^ sortedParams.charCodeAt(i);
    }

    // Convert to unsigned 32-bit integer and return with prefix
    return `${prefix}:${(hash >>> 0).toString(16)}`;
  }

  /**
   * Get a cached value by key
   *
   * Returns undefined if the key doesn't exist or the entry has expired.
   *
   * @param key - Cache key
   * @returns Cached value or undefined
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return undefined;
    }

    // Check if entry has expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.misses++;
      return undefined;
    }

    this.hits++;
    return entry.value;
  }

  /**
   * Check if a key exists and is not expired
   *
   * @param key - Cache key
   * @returns true if key exists and is valid
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);

    if (!entry) {
      return false;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Set a value in the cache
   *
   * If the cache is at capacity, older entries will be evicted.
   *
   * @param key - Cache key
   * @param value - Value to cache
   */
  set(key: string, value: T): void {
    // Evict expired and oldest entries if at capacity
    if (this.cache.size >= this.config.maxEntries) {
      this.evict();
    }

    const now = Date.now();
    this.cache.set(key, {
      value,
      expiresAt: now + this.config.ttlMs,
      createdAt: now,
    });
  }

  /**
   * Delete a specific entry from the cache
   *
   * @param key - Cache key
   * @returns true if entry was deleted
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all entries from the cache
   */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Get cache statistics
   *
   * @returns Current cache statistics
   */
  stats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      maxEntries: this.config.maxEntries,
      ttlMs: this.config.ttlMs,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }

  /**
   * Get all valid (non-expired) keys in the cache
   *
   * @returns Array of valid cache keys
   */
  keys(): string[] {
    const now = Date.now();
    const validKeys: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (now <= entry.expiresAt) {
        validKeys.push(key);
      }
    }

    return validKeys;
  }

  /**
   * Remove expired entries and oldest entries if at capacity
   */
  private evict(): void {
    const now = Date.now();

    // First pass: remove expired entries
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }

    // If still at capacity, remove oldest entries
    // Map maintains insertion order, so first entries are oldest
    while (this.cache.size >= this.config.maxEntries) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      } else {
        break;
      }
    }
  }

  /**
   * Manually trigger cleanup of expired entries
   *
   * This is called automatically on set(), but can be called
   * explicitly for maintenance.
   *
   * @returns Number of entries removed
   */
  cleanup(): number {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Clear all entries whose keys start with the given prefix
   *
   * This is useful for invalidating cache entries related to a specific
   * repository or query category without clearing the entire cache.
   *
   * @param prefix - Key prefix to match
   * @returns Number of entries removed
   */
  clearByPrefix(prefix: string): number {
    let removed = 0;

    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        removed++;
      }
    }

    return removed;
  }
}
