/**
 * User Mapping Configuration
 *
 * Loads user mapping configuration from environment variables.
 *
 * @module auth/user-mapping/config
 */

import type { UserMappingConfig, IdpType } from "./user-mapping-types.js";
import { IdpTypeSchema } from "./user-mapping-validation.js";

/**
 * Environment variable keys for user mapping configuration
 */
const ENV_KEYS = {
  /** Enable or disable user mapping */
  ENABLED: "USER_MAPPING_ENABLED",

  /** Identity provider type (azure-ad, auth0, generic) */
  IDP_TYPE: "OIDC_IDP_TYPE",

  /** OIDC claim name for group membership */
  GROUP_CLAIM: "OIDC_GROUP_CLAIM_NAME",

  /** OIDC claim name for roles */
  ROLE_CLAIM: "OIDC_ROLE_CLAIM_NAME",

  /** Enable or disable file watching */
  FILE_WATCHER: "USER_MAPPING_FILE_WATCHER",

  /** File watcher debounce delay in milliseconds */
  DEBOUNCE_MS: "USER_MAPPING_DEBOUNCE_MS",
} as const;

/**
 * Default configuration values
 */
const DEFAULTS: UserMappingConfig = {
  enabled: true,
  idpType: "generic",
  groupClaimName: "groups",
  roleClaimName: "roles",
  enableFileWatcher: true,
  fileWatcherDebounceMs: 500,
};

/**
 * Parse a boolean environment variable
 *
 * @param value - Environment variable value
 * @param defaultValue - Default value if not set
 * @returns Parsed boolean value
 */
function parseEnvBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === "") {
    return defaultValue;
  }
  const normalized = value.toLowerCase().trim();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }
  return defaultValue;
}

/**
 * Parse an integer environment variable
 *
 * @param value - Environment variable value
 * @param defaultValue - Default value if not set or invalid
 * @returns Parsed integer value
 */
function parseEnvInt(value: string | undefined, defaultValue: number): number {
  if (value === undefined || value === "") {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    return defaultValue;
  }
  return parsed;
}

/**
 * Parse IdP type from environment variable
 *
 * @param value - Environment variable value
 * @param defaultValue - Default value if not set or invalid
 * @returns Validated IdP type
 */
function parseIdpType(value: string | undefined, defaultValue: IdpType): IdpType {
  if (value === undefined || value === "") {
    return defaultValue;
  }

  const result = IdpTypeSchema.safeParse(value.toLowerCase().trim());
  if (result.success) {
    return result.data;
  }

  return defaultValue;
}

/**
 * Load user mapping configuration from environment variables
 *
 * Environment Variables:
 * - `USER_MAPPING_ENABLED`: Enable user mapping (default: true)
 * - `OIDC_IDP_TYPE`: IdP type - "azure-ad", "auth0", or "generic" (default: generic)
 * - `OIDC_GROUP_CLAIM_NAME`: OIDC claim for groups (default: "groups")
 * - `OIDC_ROLE_CLAIM_NAME`: OIDC claim for roles (default: "roles")
 * - `USER_MAPPING_FILE_WATCHER`: Enable file watching (default: true)
 * - `USER_MAPPING_DEBOUNCE_MS`: File watcher debounce delay (default: 500)
 *
 * @returns User mapping configuration
 *
 * @example
 * ```typescript
 * const config = loadUserMappingConfig();
 * console.log(config.idpType); // "azure-ad"
 * console.log(config.groupClaimName); // "groups"
 * ```
 */
export function loadUserMappingConfig(): UserMappingConfig {
  const env = typeof Bun !== "undefined" ? Bun.env : process.env;

  return {
    enabled: parseEnvBoolean(env[ENV_KEYS.ENABLED], DEFAULTS.enabled),
    idpType: parseIdpType(env[ENV_KEYS.IDP_TYPE], DEFAULTS.idpType),
    groupClaimName: env[ENV_KEYS.GROUP_CLAIM]?.trim() || DEFAULTS.groupClaimName,
    roleClaimName: env[ENV_KEYS.ROLE_CLAIM]?.trim() || DEFAULTS.roleClaimName,
    enableFileWatcher: parseEnvBoolean(env[ENV_KEYS.FILE_WATCHER], DEFAULTS.enableFileWatcher),
    fileWatcherDebounceMs: parseEnvInt(env[ENV_KEYS.DEBOUNCE_MS], DEFAULTS.fileWatcherDebounceMs),
  };
}

/**
 * Create a disabled configuration for testing or when mapping is not needed
 *
 * @returns Disabled user mapping configuration
 */
export function createDisabledConfig(): UserMappingConfig {
  return {
    ...DEFAULTS,
    enabled: false,
    enableFileWatcher: false,
  };
}

/**
 * Create a test configuration with custom values
 *
 * @param overrides - Configuration values to override
 * @returns User mapping configuration with overrides applied
 */
export function createTestConfig(overrides: Partial<UserMappingConfig> = {}): UserMappingConfig {
  return {
    ...DEFAULTS,
    ...overrides,
  };
}
