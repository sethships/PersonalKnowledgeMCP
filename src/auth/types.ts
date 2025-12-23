/**
 * Authentication Module Type Definitions
 *
 * Defines types for bearer token authentication including token scopes,
 * instance access control, and service interfaces.
 *
 * @module auth/types
 */

/**
 * Token permission scopes
 *
 * - `read`: Can query/search the knowledge base
 * - `write`: Can add/update/remove repositories
 * - `admin`: Full access including token management
 */
export type TokenScope = "read" | "write" | "admin";

/**
 * Instance access levels for multi-instance isolation
 *
 * - `private`: Personal/sensitive knowledge base
 * - `work`: Work-related repositories
 * - `public`: Public/OSS repositories
 */
export type InstanceAccess = "private" | "work" | "public";

/**
 * Metadata stored with each token
 */
export interface TokenMetadata {
  /** Human-readable token name (e.g., "Cursor IDE", "CLI Tool") */
  name: string;

  /** ISO 8601 timestamp when token was created */
  createdAt: string;

  /** ISO 8601 timestamp when token expires (null = never expires) */
  expiresAt: string | null;

  /** Permission scopes granted to this token */
  scopes: TokenScope[];

  /** Instance access levels this token can access */
  instanceAccess: InstanceAccess[];

  /** ISO 8601 timestamp when token was last used (optional) */
  lastUsedAt?: string;

  /** Number of times token has been used (optional) */
  useCount?: number;
}

/**
 * Token record as stored on disk
 *
 * NOTE: Raw token is NEVER stored - only SHA-256 hash
 */
export interface StoredToken {
  /** SHA-256 hash of the raw token (hex encoded, 64 chars) */
  tokenHash: string;

  /** Token metadata */
  metadata: TokenMetadata;

  /** Whether token has been revoked */
  revoked: boolean;

  /** ISO 8601 timestamp when revoked (if applicable) */
  revokedAt?: string;
}

/**
 * Result of token generation
 *
 * This is the ONLY time the raw token is returned to the caller.
 * The raw token must be shown to the user immediately and cannot
 * be retrieved later.
 */
export interface GeneratedToken {
  /** Raw token value - MUST be shown to user immediately */
  rawToken: string;

  /** Token hash (for reference/revocation) */
  tokenHash: string;

  /** Token metadata */
  metadata: TokenMetadata;
}

/**
 * Result of token validation
 */
export interface TokenValidationResult {
  /** Whether token is valid */
  valid: boolean;

  /** Token metadata (only present if valid) */
  metadata?: TokenMetadata;

  /** Error reason (only present if invalid) */
  reason?: "invalid" | "expired" | "revoked" | "not_found";
}

/**
 * Parameters for token generation
 */
export interface GenerateTokenParams {
  /** Human-readable name for the token */
  name: string;

  /** Permission scopes (defaults to ["read"]) */
  scopes?: TokenScope[];

  /** Instance access levels (defaults to ["public"]) */
  instanceAccess?: InstanceAccess[];

  /** Expiration time in seconds from now (null = never expires) */
  expiresInSeconds?: number | null;
}

/**
 * Token storage interface for persistence
 *
 * Abstracts the underlying storage mechanism (file-based for MVP).
 */
export interface TokenStore {
  /**
   * Load all tokens from storage
   *
   * @returns Map of token hash to stored token record
   */
  loadTokens(): Promise<Map<string, StoredToken>>;

  /**
   * Save all tokens to storage
   *
   * @param tokens - Map of token hash to stored token record
   */
  saveTokens(tokens: Map<string, StoredToken>): Promise<void>;

  /**
   * Get token storage file path (for logging/diagnostics)
   *
   * @returns Absolute path to storage file
   */
  getStoragePath(): string;

  /**
   * Invalidate any in-memory cache
   *
   * Used after external modifications or for testing.
   */
  invalidateCache(): void;
}

/**
 * Token listing result with hash and metadata
 */
export interface TokenListItem {
  /** Token hash (for reference/revocation) */
  hash: string;

  /** Token metadata */
  metadata: TokenMetadata;
}

/**
 * Token service interface for authentication operations
 *
 * Provides methods for token lifecycle management and validation.
 */
export interface TokenService {
  /**
   * Generate a new token
   *
   * @param params - Token generation parameters
   * @returns Generated token with raw value (only shown once)
   */
  generateToken(params: GenerateTokenParams): Promise<GeneratedToken>;

  /**
   * Validate a raw token
   *
   * Optimized for speed (<10ms target) using cached lookups.
   *
   * @param rawToken - Raw token string to validate
   * @returns Validation result with metadata if valid
   */
  validateToken(rawToken: string): Promise<TokenValidationResult>;

  /**
   * Revoke a token by its hash
   *
   * Revoked tokens cannot be used for authentication.
   *
   * @param tokenHash - SHA-256 hash of the token
   * @returns True if token was found and revoked
   */
  revokeToken(tokenHash: string): Promise<boolean>;

  /**
   * List all active (non-revoked, non-expired) tokens
   *
   * @returns Array of token hashes with metadata
   */
  listTokens(): Promise<TokenListItem[]>;

  /**
   * Check if token has required scopes
   *
   * Admin scope grants all permissions.
   *
   * @param rawToken - Raw token string
   * @param requiredScopes - Scopes that must be present
   * @returns True if token has all required scopes
   */
  hasScopes(rawToken: string, requiredScopes: TokenScope[]): Promise<boolean>;

  /**
   * Check if token has required instance access
   *
   * @param rawToken - Raw token string
   * @param requiredAccess - Instance access levels that must be present
   * @returns True if token has all required access levels
   */
  hasInstanceAccess(rawToken: string, requiredAccess: InstanceAccess[]): Promise<boolean>;

  /**
   * Delete a token permanently
   *
   * Unlike revocation, deletion removes the token entirely.
   * This is an admin-only operation.
   *
   * @param tokenHash - SHA-256 hash of the token
   * @returns True if token was found and deleted
   */
  deleteToken(tokenHash: string): Promise<boolean>;

  /**
   * Find a token by its name
   *
   * Searches active (non-revoked, non-expired) tokens by exact name match.
   *
   * @param name - Token name to search for
   * @returns Token if found, undefined otherwise
   */
  findTokenByName(name: string): Promise<TokenListItem | undefined>;

  /**
   * Find tokens by hash prefix
   *
   * Searches all tokens (including revoked/expired) by hash prefix.
   * Returns array to handle potential ambiguity.
   *
   * @param prefix - Hash prefix (minimum 8 characters recommended)
   * @returns Array of matching tokens (may be empty or have multiple matches)
   */
  findTokenByHashPrefix(prefix: string): Promise<TokenListItem[]>;

  /**
   * List all tokens including expired and revoked
   *
   * Returns all tokens with status flags for UI display.
   *
   * @returns Array of all tokens with status information
   */
  listAllTokens(): Promise<Array<TokenListItem & { isExpired: boolean; isRevoked: boolean }>>;
}

/**
 * Token store file format for persistence
 */
export interface TokenStoreFile {
  /** File format version */
  version: "1.0";

  /** Map of token hash to stored token */
  tokens: Record<string, StoredToken>;
}
