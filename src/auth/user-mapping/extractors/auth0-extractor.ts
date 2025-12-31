/**
 * Auth0 Claims Extractor
 *
 * Extracts and normalizes claims from Auth0 OIDC tokens.
 *
 * Auth0 uses the following claim structure:
 * - Custom namespace for groups/roles (e.g., `https://myapp.com/groups`)
 * - Standard `email` claim
 * - Roles may be in custom namespace or Auth0 RBAC extension
 *
 * @module auth/user-mapping/extractors/auth0
 */

import type { Logger } from "pino";
import type { RawOidcClaims } from "../user-mapping-types.js";
import { BaseClaimsExtractor } from "./claims-extractor.js";
import { getComponentLogger } from "../../../logging/index.js";

/**
 * Claims extractor for Auth0
 *
 * Handles Auth0's claim namespacing conventions:
 * - Custom claims require namespace (https://...)
 * - Groups/roles may be added via Rules, Actions, or RBAC extension
 * - Looks for common patterns used in Auth0 deployments
 *
 * @example
 * ```typescript
 * const extractor = new Auth0Extractor();
 * const groups = extractor.extractGroups(claims);
 * // Returns: ["admin", "developers", ...]
 * ```
 */
export class Auth0Extractor extends BaseClaimsExtractor {
  /**
   * Lazy-initialized logger for fuzzy matching diagnostics
   */
  private _logger: Logger | null = null;

  /**
   * Get logger instance (lazy initialization)
   */
  private get logger(): Logger {
    if (!this._logger) {
      this._logger = getComponentLogger("auth:claims-extractor:auth0");
    }
    return this._logger;
  }

  /**
   * Common claim keys used by Auth0
   */
  private static readonly CLAIM_KEYS = {
    /** Standard email claim */
    EMAIL: "email",

    /** Auth0 permissions claim (from RBAC) */
    PERMISSIONS: "permissions",

    /** Common namespace patterns for groups */
    GROUPS_PATTERNS: [
      "groups",
      "https://groups",
      "https://auth0.com/groups",
      "https://claims.auth0.com/groups",
    ],

    /** Common namespace patterns for roles */
    ROLES_PATTERNS: [
      "roles",
      "https://roles",
      "https://auth0.com/roles",
      "https://claims.auth0.com/roles",
    ],
  } as const;

  /**
   * Extract group memberships from Auth0 claims
   *
   * Auth0 doesn't have a standard groups claim. Groups are typically
   * added via:
   * - Rules or Actions that add custom namespaced claims
   * - Connection-specific mappings (e.g., LDAP groups)
   * - Auth0 Organizations
   *
   * This extractor looks for common patterns.
   *
   * @param claims - Raw Auth0 claims
   * @returns Array of group names
   */
  extractGroups(claims: RawOidcClaims): string[] {
    // Try each known groups pattern
    for (const pattern of Auth0Extractor.CLAIM_KEYS.GROUPS_PATTERNS) {
      // Try exact match
      const groups = this.extractStringArray(claims, pattern);
      if (groups.length > 0) {
        return groups;
      }
    }

    // Try to find any claim containing "groups" in its key (fuzzy matching)
    for (const [key, value] of Object.entries(claims)) {
      if (
        key.toLowerCase().includes("groups") &&
        (Array.isArray(value) || typeof value === "string")
      ) {
        const groups = this.extractStringArray(claims, key);
        if (groups.length > 0) {
          this.logger.debug(
            { claimKey: key, groupCount: groups.length },
            "Auth0 groups extracted via fuzzy claim matching"
          );
          return groups;
        }
      }
    }

    return [];
  }

  /**
   * Extract role assignments from Auth0 claims
   *
   * Auth0 provides roles through:
   * - RBAC extension (in `permissions` claim)
   * - Custom rules/actions (custom namespaced claims)
   * - Auth0 Authorization extension
   *
   * @param claims - Raw Auth0 claims
   * @returns Array of role names
   */
  extractRoles(claims: RawOidcClaims): string[] {
    // Try each known roles pattern
    for (const pattern of Auth0Extractor.CLAIM_KEYS.ROLES_PATTERNS) {
      const roles = this.extractStringArray(claims, pattern);
      if (roles.length > 0) {
        return roles;
      }
    }

    // Try to find any claim containing "roles" in its key (fuzzy matching)
    for (const [key, value] of Object.entries(claims)) {
      if (
        key.toLowerCase().includes("roles") &&
        (Array.isArray(value) || typeof value === "string")
      ) {
        const roles = this.extractStringArray(claims, key);
        if (roles.length > 0) {
          this.logger.debug(
            { claimKey: key, roleCount: roles.length },
            "Auth0 roles extracted via fuzzy claim matching"
          );
          return roles;
        }
      }
    }

    // Fall back to permissions claim (Auth0 RBAC)
    const permissions = this.extractStringArray(claims, Auth0Extractor.CLAIM_KEYS.PERMISSIONS);
    if (permissions.length > 0) {
      return permissions;
    }

    return [];
  }

  /**
   * Extract email address from Auth0 claims
   *
   * Auth0 uses the standard `email` claim.
   *
   * @param claims - Raw Auth0 claims
   * @returns Email address or undefined
   */
  extractEmail(claims: RawOidcClaims): string | undefined {
    const email = this.extractString(claims, Auth0Extractor.CLAIM_KEYS.EMAIL);
    return email?.toLowerCase();
  }
}
