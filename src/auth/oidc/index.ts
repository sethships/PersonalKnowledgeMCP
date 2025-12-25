/**
 * OIDC Authentication Module - Public API
 *
 * Provides OpenID Connect authentication for enterprise SSO.
 * Works alongside bearer token authentication.
 *
 * @module auth/oidc
 *
 * @example
 * ```typescript
 * import {
 *   loadOidcConfig,
 *   OidcProviderImpl,
 *   OidcSessionStoreImpl,
 *   createOidcAuthMiddleware,
 * } from "./auth/oidc/index.js";
 *
 * // Load OIDC configuration from environment
 * const oidcConfig = loadOidcConfig();
 *
 * // Initialize session store (singleton)
 * const sessionStore = OidcSessionStoreImpl.getInstance();
 *
 * // Create OIDC provider
 * const oidcProvider = new OidcProviderImpl(oidcConfig, sessionStore);
 *
 * // Check if OIDC is enabled
 * if (oidcProvider.isEnabled()) {
 *   // Create middleware for Express app
 *   const middleware = createOidcAuthMiddleware({
 *     oidcProvider,
 *     sessionStore,
 *   });
 *   app.use("/api/v1", middleware);
 * }
 * ```
 */

// Types
export type {
  OidcConfig,
  OidcSession,
  OidcTokens,
  OidcUserInfo,
  OidcAuthFlowState,
  OidcProvider,
  OidcSessionStore,
} from "./oidc-types.js";

export { OIDC_SESSION_COOKIE } from "./oidc-types.js";

// Errors
export {
  OidcError,
  OidcDiscoveryError,
  OidcAuthFlowError,
  OidcStateValidationError,
  OidcTokenRefreshError,
  OidcSessionNotFoundError,
  OidcUserInfoError,
} from "./oidc-errors.js";

// Validation schemas
export {
  OidcConfigSchema,
  OidcSessionSchema,
  OidcTokensSchema,
  OidcUserInfoSchema,
  OidcAuthFlowStateSchema,
} from "./oidc-validation.js";

// Configuration
export { loadOidcConfig, createDisabledOidcConfig, isOidcConfigComplete } from "./oidc-config.js";

// Implementation classes
export { OidcProviderImpl } from "./oidc-provider.js";
export { OidcSessionStoreImpl } from "./oidc-session-store.js";

// Middleware
export {
  createOidcAuthMiddleware,
  sessionToTokenMetadata,
  OIDC_COOKIE_OPTIONS,
  type OidcAuthMiddlewareDeps,
} from "./oidc-middleware.js";
