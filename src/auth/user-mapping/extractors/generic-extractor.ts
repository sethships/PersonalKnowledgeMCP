/**
 * Generic Claims Extractor
 *
 * A configurable claims extractor that works with any OIDC-compliant
 * identity provider. Uses configurable claim names for groups and roles.
 *
 * @module auth/user-mapping/extractors/generic
 */

import type { RawOidcClaims } from "../user-mapping-types.js";
import { BaseClaimsExtractor } from "./claims-extractor.js";

/**
 * Generic claims extractor with configurable claim names
 *
 * Use this extractor when:
 * - Using an OIDC provider not explicitly supported (not Azure AD or Auth0)
 * - The IdP uses standard claim names
 * - You need to specify custom claim names via configuration
 *
 * @example
 * ```typescript
 * // Default claim names
 * const extractor = new GenericExtractor();
 *
 * // Custom claim names
 * const extractor = new GenericExtractor("user_groups", "user_roles");
 * ```
 */
export class GenericExtractor extends BaseClaimsExtractor {
  /**
   * Claim key for groups
   */
  private readonly groupClaimName: string;

  /**
   * Claim key for roles
   */
  private readonly roleClaimName: string;

  /**
   * Standard email claim key
   */
  private static readonly EMAIL_CLAIM = "email";

  /**
   * Create a generic claims extractor
   *
   * @param groupClaimName - Claim key for group memberships (default: "groups")
   * @param roleClaimName - Claim key for role assignments (default: "roles")
   */
  constructor(groupClaimName: string = "groups", roleClaimName: string = "roles") {
    super();
    this.groupClaimName = groupClaimName;
    this.roleClaimName = roleClaimName;
  }

  /**
   * Extract group memberships using the configured claim name
   *
   * @param claims - Raw OIDC claims
   * @returns Array of group names
   */
  extractGroups(claims: RawOidcClaims): string[] {
    return this.extractStringArray(claims, this.groupClaimName);
  }

  /**
   * Extract role assignments using the configured claim name
   *
   * @param claims - Raw OIDC claims
   * @returns Array of role names
   */
  extractRoles(claims: RawOidcClaims): string[] {
    return this.extractStringArray(claims, this.roleClaimName);
  }

  /**
   * Extract email address from standard email claim
   *
   * @param claims - Raw OIDC claims
   * @returns Email address or undefined
   */
  extractEmail(claims: RawOidcClaims): string | undefined {
    const email = this.extractString(claims, GenericExtractor.EMAIL_CLAIM);
    return email?.toLowerCase();
  }

  /**
   * Get the configured group claim name
   */
  getGroupClaimName(): string {
    return this.groupClaimName;
  }

  /**
   * Get the configured role claim name
   */
  getRoleClaimName(): string {
    return this.roleClaimName;
  }
}
