/**
 * Claims Extractors Module
 *
 * Provides adapters for extracting normalized claims from various
 * identity providers.
 *
 * @module auth/user-mapping/extractors
 */

import type { ClaimsExtractor, IdpType, UserMappingConfig } from "../user-mapping-types.js";
import { AzureAdExtractor } from "./azure-ad-extractor.js";
import { Auth0Extractor } from "./auth0-extractor.js";
import { GenericExtractor } from "./generic-extractor.js";

// Re-export base class and concrete implementations
export { BaseClaimsExtractor } from "./claims-extractor.js";
export { AzureAdExtractor } from "./azure-ad-extractor.js";
export { Auth0Extractor } from "./auth0-extractor.js";
export { GenericExtractor } from "./generic-extractor.js";

/**
 * Create a claims extractor for the specified IdP type
 *
 * @param idpType - Identity provider type
 * @param config - User mapping configuration
 * @returns Claims extractor instance
 *
 * @example
 * ```typescript
 * const extractor = createClaimsExtractor("azure-ad", config);
 * const normalized = extractor.normalize(rawClaims);
 * ```
 */
export function createClaimsExtractor(
  idpType: IdpType,
  config: UserMappingConfig
): ClaimsExtractor {
  switch (idpType) {
    case "azure-ad":
      return new AzureAdExtractor();

    case "auth0":
      return new Auth0Extractor();

    case "generic":
    default:
      return new GenericExtractor(config.groupClaimName, config.roleClaimName);
  }
}
