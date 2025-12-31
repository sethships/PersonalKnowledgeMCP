/**
 * User Mapping Module Type Definitions
 *
 * Defines types for user-to-instance authorization mapping including
 * rule definitions, claims extraction, and audit logging.
 *
 * @module auth/user-mapping/types
 */

import type { TokenScope, InstanceAccess } from "../types.js";

/**
 * Supported identity provider types for claims extraction
 */
export type IdpType = "azure-ad" | "auth0" | "generic";

/**
 * Rule type for pattern matching
 *
 * - `email`: Exact email address match
 * - `email_wildcard`: Domain wildcard (e.g., `*@company.com`)
 * - `group`: Group membership from OIDC claims
 * - `role`: Role assignment from OIDC claims
 * - `default`: Catch-all fallback rule
 */
export type MappingRuleType = "email" | "email_wildcard" | "group" | "role" | "default";

/**
 * Single mapping rule definition
 *
 * Rules are evaluated in priority order (highest first).
 * First matching rule wins - no merging of permissions.
 */
export interface UserMappingRule {
  /** Unique identifier (UUID) */
  id: string;

  /** Pattern to match against user claims */
  pattern: string;

  /** Type of pattern matching to apply */
  type: MappingRuleType;

  /** Permission scopes granted by this rule */
  scopes: TokenScope[];

  /** Instance access levels granted by this rule */
  instanceAccess: InstanceAccess[];

  /** Priority for rule evaluation (higher = checked first) */
  priority: number;

  /** Human-readable description of the rule */
  description?: string;

  /** Whether this rule is active */
  enabled: boolean;

  /** ISO 8601 timestamp when rule was created */
  createdAt: string;

  /** ISO 8601 timestamp when rule was last updated */
  updatedAt: string;
}

/**
 * OIDC claims normalized for mapping evaluation
 *
 * This interface represents the claims we need from the IdP,
 * regardless of which IdP is being used.
 */
export interface NormalizedClaims {
  /** OIDC subject identifier */
  sub: string;

  /** User's email address */
  email?: string;

  /** Group memberships (normalized from IdP-specific format) */
  groups: string[];

  /** Role assignments (normalized from IdP-specific format) */
  roles: string[];
}

/**
 * Raw OIDC claims as received from the identity provider
 */
export type RawOidcClaims = Record<string, unknown>;

/**
 * Result of mapping resolution
 */
export interface ResolvedMapping {
  /** Permission scopes assigned to the user */
  scopes: TokenScope[];

  /** Instance access levels assigned to the user */
  instanceAccess: InstanceAccess[];

  /** The rule that matched (null if using defaults) */
  matchedRule: UserMappingRule | null;

  /** The pattern that matched (null if using defaults) */
  matchedPattern: string | null;

  /** Whether defaults were used (no rule matched) */
  isDefault: boolean;
}

/**
 * User mapping store file format for persistence
 */
export interface UserMappingStoreFile {
  /** File format version */
  version: "1.0";

  /** Array of mapping rules */
  rules: UserMappingRule[];

  /** ISO 8601 timestamp when file was last modified */
  lastModified: string;
}

/**
 * User mapping configuration from environment variables
 */
export interface UserMappingConfig {
  /** Whether user mapping is enabled */
  enabled: boolean;

  /** Identity provider type for claims extraction */
  idpType: IdpType;

  /** OIDC claim name for group membership (used by generic extractor) */
  groupClaimName: string;

  /** OIDC claim name for roles (used by generic extractor) */
  roleClaimName: string;

  /** Whether to watch mapping file for changes */
  enableFileWatcher: boolean;

  /** Debounce delay in milliseconds for file watcher */
  fileWatcherDebounceMs: number;
}

/**
 * Audit log entry for mapping decisions
 *
 * Logged for every mapping resolution to track access decisions.
 */
export interface MappingAuditEntry {
  /** ISO 8601 timestamp of the decision */
  timestamp: string;

  /** OIDC subject identifier */
  userId: string;

  /** User's email (if available) */
  email?: string;

  /** Pattern that matched (null if defaults used) */
  matchedPattern: string | null;

  /** ID of the rule that matched (null if defaults used) */
  matchedRuleId: string | null;

  /** Scopes assigned to the user */
  resultScopes: TokenScope[];

  /** Instance access assigned to the user */
  resultInstanceAccess: InstanceAccess[];

  /** Whether defaults were used */
  isDefault: boolean;

  /** Number of rules evaluated before match/default */
  evaluatedRulesCount: number;
}

/**
 * Claims extractor interface
 *
 * Adapts IdP-specific claim formats to normalized claims.
 * Implementations exist for Azure AD, Auth0, and generic IdPs.
 */
export interface ClaimsExtractor {
  /**
   * Extract group memberships from raw OIDC claims
   *
   * @param claims - Raw claims from the IdP
   * @returns Array of group names/identifiers
   */
  extractGroups(claims: RawOidcClaims): string[];

  /**
   * Extract role assignments from raw OIDC claims
   *
   * @param claims - Raw claims from the IdP
   * @returns Array of role names
   */
  extractRoles(claims: RawOidcClaims): string[];

  /**
   * Extract email address from raw OIDC claims
   *
   * @param claims - Raw claims from the IdP
   * @returns Email address or undefined
   */
  extractEmail(claims: RawOidcClaims): string | undefined;

  /**
   * Normalize all relevant claims
   *
   * @param claims - Raw claims from the IdP
   * @returns Normalized claims for mapping evaluation
   */
  normalize(claims: RawOidcClaims): NormalizedClaims;
}

/**
 * User mapping store interface for persistence
 *
 * Handles loading, saving, and watching mapping rules.
 */
export interface UserMappingStore {
  /**
   * Load all mapping rules from storage
   *
   * @returns Array of mapping rules
   */
  loadRules(): Promise<UserMappingRule[]>;

  /**
   * Save mapping rules to storage
   *
   * @param rules - Rules to save
   */
  saveRules(rules: UserMappingRule[]): Promise<void>;

  /**
   * Get the storage file path
   *
   * @returns Absolute path to the storage file
   */
  getStoragePath(): string;

  /**
   * Invalidate any in-memory cache
   */
  invalidateCache(): void;

  /**
   * Start watching the storage file for changes
   */
  startWatcher(): void;

  /**
   * Stop watching the storage file
   */
  stopWatcher(): void;

  /**
   * Check if file watcher is running
   *
   * @returns True if watcher is active
   */
  isWatcherRunning(): boolean;

  /**
   * Register a callback for when rules change
   *
   * @param callback - Function to call when rules change
   */
  onRulesChanged(callback: () => void): void;

  /**
   * Unregister a rules changed callback
   *
   * @param callback - Function to unregister
   */
  offRulesChanged(callback: () => void): void;
}

/**
 * User mapping service interface
 *
 * Core service for resolving user claims to permissions.
 */
export interface UserMappingService {
  /**
   * Resolve user claims to scopes and instance access
   *
   * @param claims - Normalized claims from the IdP
   * @returns Resolved mapping with matched rule info
   */
  resolveMapping(claims: NormalizedClaims): Promise<ResolvedMapping>;

  /**
   * Get all configured mapping rules
   *
   * @returns Array of all rules (enabled and disabled)
   */
  getAllRules(): Promise<UserMappingRule[]>;

  /**
   * Reload rules from storage
   *
   * Called automatically when file watcher detects changes.
   */
  reloadRules(): Promise<void>;

  /**
   * Check if the service is ready
   *
   * @returns True if service is initialized and ready
   */
  isReady(): boolean;
}
