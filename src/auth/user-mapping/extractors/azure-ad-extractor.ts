/**
 * Azure AD / Entra ID Claims Extractor
 *
 * Extracts and normalizes claims from Azure AD (Entra ID) OIDC tokens.
 *
 * Azure AD uses the following claim structure:
 * - `groups`: Array of group object IDs (GUIDs) or names (if configured)
 * - `roles`: Array of app role assignments
 * - `email` or `preferred_username`: User's email address
 * - `oid`: Object ID (alternative to sub in some cases)
 *
 * @module auth/user-mapping/extractors/azure-ad
 */

import type { Logger } from "pino";
import type { RawOidcClaims } from "../user-mapping-types.js";
import { BaseClaimsExtractor } from "./claims-extractor.js";
import { getComponentLogger } from "../../../logging/index.js";

/**
 * Claims extractor for Azure AD / Entra ID
 *
 * Handles the specific claim formats used by Azure AD:
 * - Groups may be GUIDs or names depending on "Emit groups as role claims" setting
 * - Roles come from application role assignments
 * - Email can be in `email`, `preferred_username`, or `upn` claims
 *
 * @example
 * ```typescript
 * const extractor = new AzureAdExtractor();
 * const groups = extractor.extractGroups(claims);
 * // Returns: ["550e8400-e29b-41d4-a716-446655440000", ...]
 * ```
 */
export class AzureAdExtractor extends BaseClaimsExtractor {
  /**
   * Lazy-initialized logger for group overflow diagnostics
   */
  private _logger: Logger | null = null;

  /**
   * Get logger instance (lazy initialization)
   */
  private get logger(): Logger {
    if (!this._logger) {
      this._logger = getComponentLogger("auth:claims-extractor:azure-ad");
    }
    return this._logger;
  }

  /**
   * Azure AD claim keys
   */
  private static readonly CLAIM_KEYS = {
    /** Primary groups claim */
    GROUPS: "groups",

    /** Application roles claim */
    ROLES: "roles",

    /** When groups are emitted as role claims */
    WIDS: "wids",

    /** Primary email claim */
    EMAIL: "email",

    /** Fallback email claim (usually the UPN) */
    PREFERRED_USERNAME: "preferred_username",

    /** User Principal Name (often email format) */
    UPN: "upn",

    /** Object ID (alternative unique identifier) */
    OID: "oid",
  } as const;

  /**
   * Extract group memberships from Azure AD claims
   *
   * Azure AD returns groups as:
   * - Array of group object IDs (GUIDs) by default
   * - Array of group names if "Emit groups as role claims" is enabled
   * - May be in `groups` or `wids` (for directory roles)
   *
   * Note: If a user is in too many groups (>200), Azure AD may return
   * a `_claim_sources` with a Graph API URL instead. This implementation
   * does not fetch from Graph API - configure group filtering in Azure AD.
   *
   * @param claims - Raw Azure AD claims
   * @returns Array of group identifiers (GUIDs or names)
   */
  extractGroups(claims: RawOidcClaims): string[] {
    // Primary groups claim
    const groups = this.extractStringArray(claims, AzureAdExtractor.CLAIM_KEYS.GROUPS);

    // Also check directory roles (wids)
    const directoryRoles = this.extractStringArray(claims, AzureAdExtractor.CLAIM_KEYS.WIDS);

    // Combine and deduplicate
    const allGroups = [...new Set([...groups, ...directoryRoles])];

    // Warn if _claim_sources is present but groups array is empty (group overflow)
    if (allGroups.length === 0 && claims["_claim_sources"] !== undefined) {
      this.logger.warn(
        { hasClaimSources: true },
        "Azure AD token contains _claim_sources but no groups - user may belong to >200 groups. " +
          "Configure group filtering in Azure AD or use Microsoft Graph API for full group membership."
      );
    }

    return allGroups;
  }

  /**
   * Extract role assignments from Azure AD claims
   *
   * Azure AD returns application role assignments in the `roles` claim.
   * These are defined in the application manifest and assigned to users/groups.
   *
   * @param claims - Raw Azure AD claims
   * @returns Array of role names
   */
  extractRoles(claims: RawOidcClaims): string[] {
    return this.extractStringArray(claims, AzureAdExtractor.CLAIM_KEYS.ROLES);
  }

  /**
   * Extract email address from Azure AD claims
   *
   * Azure AD may provide email in different claims:
   * - `email`: Primary email (may not be present for all users)
   * - `preferred_username`: Usually the UPN, often in email format
   * - `upn`: User Principal Name
   *
   * @param claims - Raw Azure AD claims
   * @returns Email address or undefined
   */
  extractEmail(claims: RawOidcClaims): string | undefined {
    // Try primary email first
    const email = this.extractString(claims, AzureAdExtractor.CLAIM_KEYS.EMAIL);
    if (email && this.isValidEmail(email)) {
      return email.toLowerCase();
    }

    // Fall back to preferred_username
    const preferredUsername = this.extractString(
      claims,
      AzureAdExtractor.CLAIM_KEYS.PREFERRED_USERNAME
    );
    if (preferredUsername && this.isValidEmail(preferredUsername)) {
      return preferredUsername.toLowerCase();
    }

    // Fall back to UPN
    const upn = this.extractString(claims, AzureAdExtractor.CLAIM_KEYS.UPN);
    if (upn && this.isValidEmail(upn)) {
      return upn.toLowerCase();
    }

    return undefined;
  }

  /**
   * Override extractSub to handle Azure AD's oid claim
   *
   * Azure AD typically uses `sub` but some configurations may use `oid`.
   */
  protected override extractSub(claims: RawOidcClaims): string | undefined {
    // Try standard sub first
    const sub = super.extractSub(claims);
    if (sub) {
      return sub;
    }

    // Fall back to oid
    return this.extractString(claims, AzureAdExtractor.CLAIM_KEYS.OID);
  }

  /**
   * Basic email format validation
   *
   * @param value - String to validate
   * @returns True if string looks like an email
   */
  private isValidEmail(value: string): boolean {
    // Simple check: contains @ and at least one dot after @
    const atIndex = value.indexOf("@");
    if (atIndex < 1) return false;

    const domain = value.substring(atIndex + 1);
    return domain.includes(".") && domain.length > 2;
  }
}
