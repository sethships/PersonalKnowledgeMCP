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
   * Secondary index mapping prefixes to cache keys for O(1) prefix-based invalidation.
   * Keys are prefixes (e.g., "dep:repo-name:"), values are Sets of full cache keys.
   */
  private readonly prefixIndex: Map<string, Set<string>>;

  /**
   * Create a new QueryCache instance
   *
   * @param config - Cache configuration options
   */
  constructor(config: Partial<CacheConfig> = {}) {
    this.config = { ...DEFAULT_CACHE_CONFIG, ...config };
    this.cache = new Map();
    this.prefixIndex = new Map();
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
      this.removeFromIndex(key);
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
      this.removeFromIndex(key);
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

    // Update prefix index for O(1) prefix-based invalidation
    this.addToIndex(key);
  }

  /**
   * Extract the prefix from a cache key.
   * Keys follow the format "{queryType}:{repository}:{hash}".
   * Returns the prefix "{queryType}:{repository}:" for indexing.
   *
   * @param key - Full cache key
   * @returns Prefix portion of the key, or the full key if no valid prefix found
   */
  private extractPrefix(key: string): string {
    // Find the second colon to extract "{queryType}:{repository}:"
    const firstColon = key.indexOf(":");
    if (firstColon === -1) {
      return key;
    }
    const secondColon = key.indexOf(":", firstColon + 1);
    if (secondColon === -1) {
      return key;
    }
    return key.substring(0, secondColon + 1);
  }

  /**
   * Add a key to the prefix index
   *
   * @param key - Cache key to index
   */
  private addToIndex(key: string): void {
    const prefix = this.extractPrefix(key);
    let keySet = this.prefixIndex.get(prefix);
    if (!keySet) {
      keySet = new Set();
      this.prefixIndex.set(prefix, keySet);
    }
    keySet.add(key);
  }

  /**
   * Remove a key from the prefix index
   *
   * @param key - Cache key to remove from index
   */
  private removeFromIndex(key: string): void {
    const prefix = this.extractPrefix(key);
    const keySet = this.prefixIndex.get(prefix);
    if (keySet) {
      keySet.delete(key);
      // Clean up empty sets to avoid memory leaks
      if (keySet.size === 0) {
        this.prefixIndex.delete(prefix);
      }
    }
  }

  /**
   * Delete a specific entry from the cache
   *
   * @param key - Cache key
   * @returns true if entry was deleted
   */
  delete(key: string): boolean {
    const deleted = this.cache.delete(key);
    if (deleted) {
      this.removeFromIndex(key);
    }
    return deleted;
  }

  /**
   * Clear all entries from the cache
   */
  clear(): void {
    this.cache.clear();
    this.prefixIndex.clear();
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

    // First pass: collect and remove expired entries
    const expiredKeys: string[] = [];
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        expiredKeys.push(key);
      }
    }
    for (const key of expiredKeys) {
      this.cache.delete(key);
      this.removeFromIndex(key);
    }

    // If still at capacity, remove oldest entries
    // Map maintains insertion order, so first entries are oldest
    while (this.cache.size >= this.config.maxEntries) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
        this.removeFromIndex(firstKey);
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
    const expiredKeys: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        expiredKeys.push(key);
      }
    }

    for (const key of expiredKeys) {
      this.cache.delete(key);
      this.removeFromIndex(key);
    }

    return expiredKeys.length;
  }

  /**
   * Clear all entries whose keys start with the given prefix
   *
   * This method uses a secondary index for O(1) lookup when the prefix
   * matches the indexed format "{queryType}:{repository}:". Falls back
   * to O(n) scan for non-standard prefixes.
   *
   * @param prefix - Key prefix to match
   * @returns Number of entries removed
   */
  clearByPrefix(prefix: string): number {
    // Try O(1) lookup using the prefix index first
    const indexedKeys = this.prefixIndex.get(prefix);
    if (indexedKeys && indexedKeys.size > 0) {
      // Copy the set to avoid mutation during iteration
      const keysToDelete = [...indexedKeys];
      for (const key of keysToDelete) {
        this.cache.delete(key);
        // removeFromIndex is called by delete(), which cleans up the set
      }
      return keysToDelete.length;
    }

    // Fallback to O(n) scan for non-indexed prefixes or partial matches
    const keysToDelete: string[] = [];
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key);
    }

    return keysToDelete.length;
  }
}
