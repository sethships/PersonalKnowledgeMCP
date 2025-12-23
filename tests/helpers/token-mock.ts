/**
 * Mock Token Store for Testing
 *
 * Provides an in-memory token store implementation for unit tests.
 * Supports configurable failure modes for error handling tests.
 *
 * @module tests/helpers/token-mock
 */

import type { TokenStore, StoredToken } from "../../src/auth/types.js";
import { TokenStorageError } from "../../src/auth/errors.js";

/**
 * Mock implementation of TokenStore for testing
 *
 * Features:
 * - In-memory storage (no file I/O)
 * - Configurable failure modes for error testing
 * - Helper methods for test setup and assertions
 *
 * @example
 * ```typescript
 * const mockStore = new MockTokenStore();
 *
 * // Set up test data
 * mockStore.setTokens(new Map([
 *   ["abc123...", { tokenHash: "abc123...", metadata: {...}, revoked: false }]
 * ]));
 *
 * // Test error handling
 * mockStore.setShouldFailLoad(true);
 * await expect(service.validateToken("...")).rejects.toThrow();
 * ```
 */
export class MockTokenStore implements TokenStore {
  private tokens: Map<string, StoredToken> = new Map();
  private shouldFailLoad = false;
  private shouldFailSave = false;
  private loadFailureError?: Error;
  private saveFailureError?: Error;
  private storagePath = "/mock/data/tokens.json";

  // Call tracking for assertions
  public loadCallCount = 0;
  public saveCallCount = 0;
  public lastSavedTokens: Map<string, StoredToken> | null = null;

  /**
   * Set the mock tokens for testing
   *
   * @param tokens - Map of token hash to stored token
   */
  setTokens(tokens: Map<string, StoredToken>): void {
    this.tokens = new Map(tokens);
  }

  /**
   * Get the current mock tokens
   *
   * @returns Copy of the current tokens map
   */
  getTokens(): Map<string, StoredToken> {
    return new Map(this.tokens);
  }

  /**
   * Add a single token for convenience
   *
   * @param token - Stored token to add
   */
  addToken(token: StoredToken): void {
    this.tokens.set(token.tokenHash, token);
  }

  /**
   * Configure whether loadTokens should fail
   *
   * @param shouldFail - Whether to throw on load
   * @param error - Optional specific error to throw
   */
  setShouldFailLoad(shouldFail: boolean, error?: Error): void {
    this.shouldFailLoad = shouldFail;
    this.loadFailureError = error;
  }

  /**
   * Configure whether saveTokens should fail
   *
   * @param shouldFail - Whether to throw on save
   * @param error - Optional specific error to throw
   */
  setShouldFailSave(shouldFail: boolean, error?: Error): void {
    this.shouldFailSave = shouldFail;
    this.saveFailureError = error;
  }

  /**
   * Set the mock storage path for testing
   *
   * @param path - Path to return from getStoragePath
   */
  setStoragePath(path: string): void {
    this.storagePath = path;
  }

  /**
   * Load tokens (returns mock data)
   */
  async loadTokens(): Promise<Map<string, StoredToken>> {
    this.loadCallCount++;

    if (this.shouldFailLoad) {
      const error = this.loadFailureError || new TokenStorageError("read", "Mock load failure");
      throw error;
    }

    // Return a copy to prevent test interference
    return new Map(this.tokens);
  }

  /**
   * Save tokens (stores in memory)
   */
  async saveTokens(tokens: Map<string, StoredToken>): Promise<void> {
    this.saveCallCount++;

    if (this.shouldFailSave) {
      const error = this.saveFailureError || new TokenStorageError("write", "Mock save failure");
      throw error;
    }

    // Store a copy
    this.tokens = new Map(tokens);
    this.lastSavedTokens = new Map(tokens);
  }

  /**
   * Get storage path (returns mock path)
   */
  getStoragePath(): string {
    return this.storagePath;
  }

  /**
   * Invalidate cache (no-op for mock)
   */
  invalidateCache(): void {
    // No-op for mock - included for interface compliance
  }

  /**
   * Reset the mock to initial state
   *
   * Call this in beforeEach to ensure clean test state.
   */
  reset(): void {
    this.tokens.clear();
    this.shouldFailLoad = false;
    this.shouldFailSave = false;
    this.loadFailureError = undefined;
    this.saveFailureError = undefined;
    this.loadCallCount = 0;
    this.saveCallCount = 0;
    this.lastSavedTokens = null;
    this.storagePath = "/mock/data/tokens.json";
  }
}

/**
 * Create a valid stored token for testing
 *
 * @param overrides - Optional property overrides
 * @returns A valid StoredToken object
 */
export function createMockStoredToken(overrides: Partial<StoredToken> = {}): StoredToken {
  const now = new Date();
  const defaults: StoredToken = {
    tokenHash: "a".repeat(64), // Valid SHA-256 hash format
    metadata: {
      name: "Test Token",
      createdAt: now.toISOString(),
      expiresAt: null,
      scopes: ["read"],
      instanceAccess: ["public"],
      useCount: 0,
    },
    revoked: false,
    ...overrides,
  };

  // Merge metadata if overriding
  if (overrides.metadata) {
    defaults.metadata = { ...defaults.metadata, ...overrides.metadata };
  }

  return defaults;
}

/**
 * Create a valid raw token for testing
 *
 * @returns A valid raw token string matching pk_mcp_<32 hex chars> format
 */
export function createMockRawToken(): string {
  return "pk_mcp_" + "a".repeat(32);
}

/**
 * Create a token hash for a raw token
 *
 * Uses same algorithm as production code.
 *
 * @param rawToken - Raw token to hash
 * @returns SHA-256 hash as hex string
 */
export async function hashToken(rawToken: string): Promise<string> {
  const crypto = await import("crypto");
  return crypto.createHash("sha256").update(rawToken, "utf8").digest("hex");
}
