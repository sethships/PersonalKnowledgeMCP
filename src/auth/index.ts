/**
 * Authentication Module - Public API
 *
 * Provides bearer token authentication for HTTP transport.
 *
 * @module auth
 *
 * @example
 * ```typescript
 * import {
 *   TokenServiceImpl,
 *   TokenStoreImpl,
 *   type TokenScope,
 *   type GenerateTokenParams
 * } from "./auth/index.js";
 *
 * // Initialize token service
 * const tokenStore = TokenStoreImpl.getInstance();
 * const tokenService = new TokenServiceImpl(tokenStore);
 *
 * // Generate a new token
 * const { rawToken, metadata } = await tokenService.generateToken({
 *   name: "Cursor IDE",
 *   scopes: ["read", "write"],
 *   instanceAccess: ["work"]
 * });
 *
 * // Validate token
 * const result = await tokenService.validateToken(rawToken);
 * if (result.valid) {
 *   console.log("Token valid:", result.metadata);
 * }
 *
 * // Check scopes
 * const hasAccess = await tokenService.hasScopes(rawToken, ["write"]);
 * ```
 */

// Types
export type {
  TokenScope,
  InstanceAccess,
  TokenMetadata,
  StoredToken,
  GeneratedToken,
  TokenValidationResult,
  GenerateTokenParams,
  TokenService,
  TokenStore,
  TokenListItem,
  TokenStoreFile,
} from "./types.js";

// Errors
export {
  AuthError,
  TokenValidationError,
  TokenNotFoundError,
  TokenRevokedError,
  TokenExpiredError,
  InsufficientScopesError,
  InstanceAccessDeniedError,
  TokenStorageError,
  TokenGenerationError,
} from "./errors.js";

// Validation schemas
export {
  TOKEN_PREFIX,
  TokenScopeSchema,
  InstanceAccessSchema,
  RawTokenSchema,
  TokenHashSchema,
  TokenNameSchema,
  GenerateTokenParamsSchema,
  TokenMetadataSchema,
  StoredTokenSchema,
  TokenStoreFileSchema,
  type ValidatedGenerateTokenParams,
  type ValidatedTokenMetadata,
  type ValidatedStoredToken,
  type ValidatedTokenStoreFile,
} from "./validation.js";

// Implementation classes
export { TokenServiceImpl } from "./token-service.js";
export { TokenStoreImpl } from "./token-store.js";
