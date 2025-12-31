/**
 * Claims Extractor Interface and Factory
 *
 * Provides an adapter pattern for extracting normalized claims from
 * different identity providers (Azure AD, Auth0, generic OIDC).
 *
 * @module auth/user-mapping/extractors
 */

import type { ClaimsExtractor, RawOidcClaims, NormalizedClaims } from "../user-mapping-types.js";

/**
 * Abstract base class for claims extractors
 *
 * Provides common utilities for claim extraction.
 */
export abstract class BaseClaimsExtractor implements ClaimsExtractor {
  /**
   * Extract group memberships from raw OIDC claims
   */
  abstract extractGroups(claims: RawOidcClaims): string[];

  /**
   * Extract role assignments from raw OIDC claims
   */
  abstract extractRoles(claims: RawOidcClaims): string[];

  /**
   * Extract email address from raw OIDC claims
   */
  abstract extractEmail(claims: RawOidcClaims): string | undefined;

  /**
   * Normalize all relevant claims
   *
   * @param claims - Raw claims from the IdP
   * @returns Normalized claims for mapping evaluation
   */
  normalize(claims: RawOidcClaims): NormalizedClaims {
    const sub = this.extractSub(claims);
    if (!sub) {
      throw new Error("Missing required 'sub' claim");
    }

    return {
      sub,
      email: this.extractEmail(claims),
      groups: this.extractGroups(claims),
      roles: this.extractRoles(claims),
    };
  }

  /**
   * Extract the subject identifier from claims
   *
   * @param claims - Raw claims
   * @returns Subject identifier or undefined
   */
  protected extractSub(claims: RawOidcClaims): string | undefined {
    const sub = claims["sub"];
    return typeof sub === "string" ? sub : undefined;
  }

  /**
   * Safely extract a string array from claims
   *
   * Handles various formats:
   * - Already an array of strings
   * - Single string value (converted to array)
   * - Comma-separated string (split into array)
   *
   * @param claims - Raw claims
   * @param key - Claim key to extract
   * @returns Array of strings
   */
  protected extractStringArray(claims: RawOidcClaims, key: string): string[] {
    const value = claims[key];

    if (value === undefined || value === null) {
      return [];
    }

    // Already an array
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === "string").map((s) => s.trim());
    }

    // Single string - could be comma-separated
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed === "") {
        return [];
      }
      // Check if comma-separated
      if (trimmed.includes(",")) {
        return trimmed
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
      }
      return [trimmed];
    }

    return [];
  }

  /**
   * Safely extract a string from claims
   *
   * @param claims - Raw claims
   * @param key - Claim key to extract
   * @returns String value or undefined
   */
  protected extractString(claims: RawOidcClaims, key: string): string | undefined {
    const value = claims[key];
    return typeof value === "string" ? value.trim() : undefined;
  }
}
