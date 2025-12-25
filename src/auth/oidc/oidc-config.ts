/**
 * OIDC Configuration Module
 *
 * Loads and validates OIDC configuration from environment variables.
 *
 * @module auth/oidc/config
 */

import type { OidcConfig } from "./oidc-types.js";
import type { TokenScope, InstanceAccess } from "../types.js";
import { OidcConfigSchema } from "./oidc-validation.js";
import { getComponentLogger } from "../../logging/index.js";
import type { Logger } from "pino";

/**
 * Lazy-initialized logger
 */
let logger: Logger | null = null;

function getLogger(): Logger {
  if (!logger) {
    logger = getComponentLogger("auth:oidc-config");
  }
  return logger;
}

/**
 * Environment variable names for OIDC configuration
 */
const ENV_KEYS = {
  ENABLED: "OIDC_ENABLED",
  ISSUER: "OIDC_ISSUER",
  CLIENT_ID: "OIDC_CLIENT_ID",
  CLIENT_SECRET: "OIDC_CLIENT_SECRET",
  REDIRECT_URI: "OIDC_REDIRECT_URI",
  DEFAULT_SCOPES: "OIDC_DEFAULT_SCOPES",
  DEFAULT_INSTANCE_ACCESS: "OIDC_DEFAULT_INSTANCE_ACCESS",
  SESSION_TTL: "OIDC_SESSION_TTL_SECONDS",
  REFRESH_BEFORE_EXPIRY: "OIDC_REFRESH_BEFORE_EXPIRY_SECONDS",
  COOKIE_SECURE: "OIDC_COOKIE_SECURE",
} as const;

/**
 * Default OIDC configuration values
 */
const DEFAULTS = {
  enabled: false,
  defaultScopes: ["read"] as TokenScope[],
  defaultInstanceAccess: ["public"] as InstanceAccess[],
  sessionTtlSeconds: 3600, // 1 hour
  refreshBeforeExpirySeconds: 300, // 5 minutes
} as const;

/**
 * Parse comma-separated scopes string to TokenScope array
 *
 * @param value - Comma-separated scopes (e.g., "read,write")
 * @returns Array of valid scopes
 */
function parseScopes(value: string | undefined): TokenScope[] {
  if (!value || value.trim() === "") {
    return DEFAULTS.defaultScopes;
  }

  const validScopes: TokenScope[] = ["read", "write", "admin"];
  const parsed = value
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is TokenScope => validScopes.includes(s as TokenScope));

  if (parsed.length === 0) {
    getLogger().warn(
      { value },
      `No valid scopes found in ${ENV_KEYS.DEFAULT_SCOPES}, using defaults`
    );
    return DEFAULTS.defaultScopes;
  }

  return parsed;
}

/**
 * Parse comma-separated instance access string to InstanceAccess array
 *
 * @param value - Comma-separated instance access (e.g., "work,public")
 * @returns Array of valid instance access levels
 */
function parseInstanceAccess(value: string | undefined): InstanceAccess[] {
  if (!value || value.trim() === "") {
    return DEFAULTS.defaultInstanceAccess;
  }

  const validAccess: InstanceAccess[] = ["private", "work", "public"];
  const parsed = value
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is InstanceAccess => validAccess.includes(s as InstanceAccess));

  if (parsed.length === 0) {
    getLogger().warn(
      { value },
      `No valid instance access found in ${ENV_KEYS.DEFAULT_INSTANCE_ACCESS}, using defaults`
    );
    return DEFAULTS.defaultInstanceAccess;
  }

  return parsed;
}

/**
 * Parse integer environment variable with default
 *
 * @param value - String value to parse
 * @param defaultValue - Default if parsing fails
 * @param envKey - Environment variable name for logging
 * @returns Parsed integer or default
 */
function parseEnvInt(value: string | undefined, defaultValue: number, envKey: string): number {
  if (value === undefined || value.trim() === "") {
    return defaultValue;
  }

  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed < 0) {
    getLogger().warn({ envKey, value, defaultValue }, `Invalid ${envKey} value, using default`);
    return defaultValue;
  }

  return parsed;
}

/**
 * Parse optional boolean environment variable for cookie security
 *
 * @param value - String value to parse ("true", "false", or undefined)
 * @returns true, false, or undefined for auto-detection
 */
function parseCookieSecure(value: string | undefined): boolean | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined; // Auto-detect based on NODE_ENV
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }

  getLogger().warn(
    { value },
    `Invalid ${ENV_KEYS.COOKIE_SECURE} value (expected 'true' or 'false'), using auto-detection`
  );
  return undefined;
}

/**
 * Load OIDC configuration from environment variables
 *
 * Environment variables:
 * - OIDC_ENABLED: Enable OIDC authentication (default: false)
 * - OIDC_ISSUER: OIDC issuer URL (required if enabled)
 * - OIDC_CLIENT_ID: OAuth2 client ID (required if enabled)
 * - OIDC_CLIENT_SECRET: OAuth2 client secret (required if enabled)
 * - OIDC_REDIRECT_URI: Authorization callback URI (required if enabled)
 * - OIDC_DEFAULT_SCOPES: Default scopes for OIDC users (default: "read")
 * - OIDC_DEFAULT_INSTANCE_ACCESS: Default instance access (default: "public")
 * - OIDC_SESSION_TTL_SECONDS: Session lifetime in seconds (default: 3600)
 * - OIDC_REFRESH_BEFORE_EXPIRY_SECONDS: Refresh threshold (default: 300)
 * - OIDC_COOKIE_SECURE: Cookie secure flag (true/false/undefined for auto-detect)
 *
 * @returns Validated OIDC configuration
 * @throws Error if configuration is invalid when OIDC is enabled
 */
export function loadOidcConfig(): OidcConfig {
  const env = Bun.env;

  // Check if OIDC is enabled (case-insensitive for user convenience)
  const enabled = env[ENV_KEYS.ENABLED]?.toLowerCase() === "true";

  // Build raw config object
  const rawConfig = {
    enabled,
    issuer: env[ENV_KEYS.ISSUER],
    clientId: env[ENV_KEYS.CLIENT_ID],
    clientSecret: env[ENV_KEYS.CLIENT_SECRET],
    redirectUri: env[ENV_KEYS.REDIRECT_URI],
    defaultScopes: parseScopes(env[ENV_KEYS.DEFAULT_SCOPES]),
    defaultInstanceAccess: parseInstanceAccess(env[ENV_KEYS.DEFAULT_INSTANCE_ACCESS]),
    sessionTtlSeconds: parseEnvInt(
      env[ENV_KEYS.SESSION_TTL],
      DEFAULTS.sessionTtlSeconds,
      ENV_KEYS.SESSION_TTL
    ),
    refreshBeforeExpirySeconds: parseEnvInt(
      env[ENV_KEYS.REFRESH_BEFORE_EXPIRY],
      DEFAULTS.refreshBeforeExpirySeconds,
      ENV_KEYS.REFRESH_BEFORE_EXPIRY
    ),
    cookieSecure: parseCookieSecure(env[ENV_KEYS.COOKIE_SECURE]),
  };

  // Validate configuration
  const result = OidcConfigSchema.safeParse(rawConfig);

  if (!result.success) {
    // ZodError has issues property with error details
    const issues = result.error.issues;
    const errorMessage = issues.map((e) => e.message).join("; ");
    getLogger().error({ issues }, "OIDC configuration validation failed");
    throw new Error(`Invalid OIDC configuration: ${errorMessage}`);
  }

  // Log configuration status (never log secrets)
  if (result.data.enabled) {
    getLogger().info(
      {
        issuer: result.data.issuer,
        redirectUri: result.data.redirectUri,
        defaultScopes: result.data.defaultScopes,
        defaultInstanceAccess: result.data.defaultInstanceAccess,
        sessionTtlSeconds: result.data.sessionTtlSeconds,
        cookieSecure: result.data.cookieSecure ?? "auto",
      },
      "OIDC enabled"
    );
  } else {
    getLogger().debug("OIDC disabled");
  }

  return result.data as OidcConfig;
}

/**
 * Create a disabled OIDC configuration
 *
 * Useful for testing or when OIDC should be explicitly disabled.
 *
 * @returns Disabled OIDC configuration
 */
export function createDisabledOidcConfig(): OidcConfig {
  return {
    enabled: false,
    defaultScopes: DEFAULTS.defaultScopes,
    defaultInstanceAccess: DEFAULTS.defaultInstanceAccess,
    sessionTtlSeconds: DEFAULTS.sessionTtlSeconds,
    refreshBeforeExpirySeconds: DEFAULTS.refreshBeforeExpirySeconds,
  };
}

/**
 * Validate OIDC configuration is complete for enabled mode
 *
 * @param config - Configuration to validate
 * @returns True if configuration is valid for enabled mode
 */
export function isOidcConfigComplete(config: OidcConfig): boolean {
  if (!config.enabled) {
    return true; // Disabled config is always valid
  }

  return !!(config.issuer && config.clientId && config.clientSecret && config.redirectUri);
}
