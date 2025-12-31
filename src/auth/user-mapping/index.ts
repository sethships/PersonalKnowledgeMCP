/**
 * User Mapping Module
 *
 * Provides user-to-instance authorization mapping based on OIDC claims.
 * Supports multiple identity providers through an adapter pattern.
 *
 * @module auth/user-mapping
 */

// Types
export type {
  IdpType,
  MappingRuleType,
  UserMappingRule,
  NormalizedClaims,
  RawOidcClaims,
  ResolvedMapping,
  UserMappingStoreFile,
  UserMappingConfig,
  MappingAuditEntry,
  ClaimsExtractor,
  UserMappingStore,
  UserMappingService,
} from "./user-mapping-types.js";

// Errors
export {
  UserMappingError,
  UserMappingNotConfiguredError,
  UserMappingRuleNotFoundError,
  UserMappingStorageError,
  UserMappingValidationError,
  UserMappingDuplicateRuleError,
  UserMappingWatcherError,
} from "./user-mapping-errors.js";

// Validation
export {
  IdpTypeSchema,
  MappingRuleTypeSchema,
  EmailPatternSchema,
  WildcardPatternSchema,
  GroupPatternSchema,
  RolePatternSchema,
  DefaultPatternSchema,
  UserMappingRuleSchema,
  UserMappingStoreFileSchema,
  UserMappingConfigSchema,
  validatePatternForType,
  validateMappingRule,
} from "./user-mapping-validation.js";

export type {
  ValidatedUserMappingRule,
  ValidatedUserMappingStoreFile,
  ValidatedUserMappingConfig,
  MappingRuleValidationResult,
} from "./user-mapping-validation.js";

// Store
export { UserMappingStoreImpl } from "./user-mapping-store.js";

// Configuration
export {
  loadUserMappingConfig,
  createDisabledConfig,
  createTestConfig,
} from "./user-mapping-config.js";

// Claims Extractors
export {
  BaseClaimsExtractor,
  createClaimsExtractor,
  AzureAdExtractor,
  Auth0Extractor,
  GenericExtractor,
} from "./extractors/index.js";

// Service
export { UserMappingServiceImpl, createUserMappingService } from "./user-mapping-service.js";
