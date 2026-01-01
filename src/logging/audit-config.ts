/**
 * Audit Logger Configuration
 *
 * Loads audit logging configuration from environment variables.
 * Follows the same patterns as instance-config.ts.
 *
 * Environment variables:
 * - AUDIT_LOG_ENABLED: Enable/disable audit logging (default: true)
 * - AUDIT_LOG_PATH: Path to audit log file (default: ./data/audit/audit.log)
 * - AUDIT_LOG_MAX_FILE_SIZE: Max file size before rotation in bytes (default: 10MB)
 * - AUDIT_LOG_MAX_FILES: Number of rotated files to keep (default: 10)
 * - AUDIT_LOG_RETENTION_DAYS: Auto-delete files older than N days (default: 90, 0=disabled)
 *
 * @module logging/audit-config
 */

import type { AuditLoggerConfig } from "./audit-types.js";

/**
 * Default audit logger configuration
 *
 * Note: For production deployments, use absolute paths for logPath to avoid
 * issues with working directory changes. The default relative path is suitable
 * for development but may behave unexpectedly in production environments where
 * the service may be started from different directories.
 *
 * Example production config:
 *   AUDIT_LOG_PATH=/var/log/pk-mcp/audit.log
 */
const DEFAULT_CONFIG: AuditLoggerConfig = {
  enabled: true,
  logPath: "./data/audit/audit.log",
  maxFileSize: 10 * 1024 * 1024, // 10 MB
  maxFiles: 10,
  retentionDays: 90,
};

/**
 * Environment variable names for audit configuration
 */
const ENV_KEYS = {
  ENABLED: "AUDIT_LOG_ENABLED",
  LOG_PATH: "AUDIT_LOG_PATH",
  MAX_FILE_SIZE: "AUDIT_LOG_MAX_FILE_SIZE",
  MAX_FILES: "AUDIT_LOG_MAX_FILES",
  RETENTION_DAYS: "AUDIT_LOG_RETENTION_DAYS",
} as const;

/**
 * Parse a boolean environment variable
 *
 * @param value - Environment variable value
 * @param defaultValue - Default if not set or invalid
 * @returns Parsed boolean
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
 * @param defaultValue - Default if not set or invalid
 * @returns Parsed integer
 */
function parseEnvInt(value: string | undefined, defaultValue: number): number {
  if (value === undefined || value === "") {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed < 0) {
    return defaultValue;
  }
  return parsed;
}

/**
 * Load audit logger configuration from environment variables
 *
 * @returns Audit logger configuration with defaults applied
 *
 * @example
 * ```typescript
 * import { loadAuditConfig } from './logging/audit-config.js';
 *
 * const config = loadAuditConfig();
 * console.log(config.enabled); // true
 * console.log(config.logPath); // "./data/audit/audit.log"
 * ```
 */
export function loadAuditConfig(): AuditLoggerConfig {
  const env = Bun.env;

  return {
    enabled: parseEnvBoolean(env[ENV_KEYS.ENABLED], DEFAULT_CONFIG.enabled),
    logPath: env[ENV_KEYS.LOG_PATH] || DEFAULT_CONFIG.logPath,
    maxFileSize: parseEnvInt(env[ENV_KEYS.MAX_FILE_SIZE], DEFAULT_CONFIG.maxFileSize),
    maxFiles: parseEnvInt(env[ENV_KEYS.MAX_FILES], DEFAULT_CONFIG.maxFiles),
    retentionDays: parseEnvInt(env[ENV_KEYS.RETENTION_DAYS], DEFAULT_CONFIG.retentionDays),
  };
}

/**
 * Validate audit logger configuration
 *
 * @param config - Configuration to validate
 * @throws Error if configuration is invalid
 */
export function validateAuditConfig(config: AuditLoggerConfig): void {
  if (config.maxFileSize < 1024) {
    throw new Error(
      `AUDIT_LOG_MAX_FILE_SIZE must be at least 1024 bytes, got ${config.maxFileSize}`
    );
  }

  if (config.maxFiles < 1) {
    throw new Error(`AUDIT_LOG_MAX_FILES must be at least 1, got ${config.maxFiles}`);
  }

  if (config.retentionDays < 0) {
    throw new Error(`AUDIT_LOG_RETENTION_DAYS cannot be negative, got ${config.retentionDays}`);
  }

  if (!config.logPath || config.logPath.trim() === "") {
    throw new Error("AUDIT_LOG_PATH cannot be empty");
  }
}

/**
 * Get the default audit configuration (for testing)
 *
 * @returns Default configuration values
 */
export function getDefaultAuditConfig(): Readonly<AuditLoggerConfig> {
  return { ...DEFAULT_CONFIG };
}
