/**
 * Multi-Instance Configuration Module
 *
 * Defines configuration schema and loading for multi-instance deployment.
 * Supports isolated knowledge tiers: Private, Work, and Public.
 *
 * @module config/instance-config
 */

import { z } from "zod";
import type { InstanceAccess } from "../auth/types.js";

/**
 * All valid instance names
 */
export const INSTANCE_NAMES: readonly InstanceAccess[] = ["private", "work", "public"] as const;

/**
 * Zod schema for instance access validation
 */
export const InstanceAccessSchema = z.enum(["private", "work", "public"]);

/**
 * ChromaDB connection configuration for an instance
 */
export interface InstanceChromaConfig {
  /** ChromaDB server host */
  host: string;
  /** ChromaDB server port */
  port: number;
  /** Optional authentication token */
  authToken?: string;
}

/**
 * Configuration for a single instance
 */
export interface InstanceConfig {
  /** Instance name (private, work, or public) */
  name: InstanceAccess;
  /** ChromaDB connection settings for this instance */
  chromadb: InstanceChromaConfig;
  /** Data path for instance-specific files (metadata, tokens, etc.) */
  dataPath: string;
  /** Whether this instance is enabled */
  enabled: boolean;
}

/**
 * Multi-instance configuration
 */
export interface MultiInstanceConfig {
  /** Configuration for each instance */
  instances: Record<InstanceAccess, InstanceConfig>;
  /** Default instance for unauthenticated requests (e.g., stdio transport) */
  defaultInstance: InstanceAccess;
  /**
   * Whether to require authentication for default instance access.
   * Set to true for internet-hosted deployments.
   * Set to false for local/LAN deployments where stdio is trusted.
   */
  requireAuthForDefaultInstance: boolean;
}

/**
 * Default instance configurations
 *
 * - Private: Port 8000, ./data/private
 * - Work: Port 8001, ./data/work
 * - Public: Port 8002, ./data/public
 */
const DEFAULT_INSTANCES: Record<InstanceAccess, InstanceConfig> = {
  private: {
    name: "private",
    chromadb: {
      host: "localhost",
      port: 8000,
    },
    dataPath: "./data/private",
    enabled: true,
  },
  work: {
    name: "work",
    chromadb: {
      host: "localhost",
      port: 8001,
    },
    dataPath: "./data/work",
    enabled: true,
  },
  public: {
    name: "public",
    chromadb: {
      host: "localhost",
      port: 8002,
    },
    dataPath: "./data/public",
    enabled: true,
  },
};

/**
 * Environment variable names for instance configuration
 */
const ENV_KEYS = {
  // Global settings
  DEFAULT_INSTANCE: "DEFAULT_INSTANCE",
  REQUIRE_AUTH_FOR_DEFAULT_INSTANCE: "REQUIRE_AUTH_FOR_DEFAULT_INSTANCE",

  // Instance-specific (pattern: INSTANCE_{NAME}_{SETTING})
  getChromaHost: (instance: InstanceAccess) => `INSTANCE_${instance.toUpperCase()}_CHROMADB_HOST`,
  getChromaPort: (instance: InstanceAccess) => `INSTANCE_${instance.toUpperCase()}_CHROMADB_PORT`,
  getChromaAuthToken: (instance: InstanceAccess) =>
    `INSTANCE_${instance.toUpperCase()}_CHROMADB_AUTH_TOKEN`,
  getDataPath: (instance: InstanceAccess) => `INSTANCE_${instance.toUpperCase()}_DATA_PATH`,
  getEnabled: (instance: InstanceAccess) => `INSTANCE_${instance.toUpperCase()}_ENABLED`,
} as const;

/**
 * Parse a boolean environment variable
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
 * Load configuration for a single instance from environment variables
 */
function loadInstanceConfigFromEnv(
  instanceName: InstanceAccess,
  defaults: InstanceConfig
): InstanceConfig {
  const env = Bun.env;

  return {
    name: instanceName,
    chromadb: {
      host: env[ENV_KEYS.getChromaHost(instanceName)] || defaults.chromadb.host,
      port: parseEnvInt(env[ENV_KEYS.getChromaPort(instanceName)], defaults.chromadb.port),
      authToken: env[ENV_KEYS.getChromaAuthToken(instanceName)] || defaults.chromadb.authToken,
    },
    dataPath: env[ENV_KEYS.getDataPath(instanceName)] || defaults.dataPath,
    enabled: parseEnvBoolean(env[ENV_KEYS.getEnabled(instanceName)], defaults.enabled),
  };
}

/**
 * Load multi-instance configuration from environment variables
 *
 * Environment variables:
 * - DEFAULT_INSTANCE: Default instance for unauthenticated requests (default: "public")
 * - REQUIRE_AUTH_FOR_DEFAULT_INSTANCE: Require auth for default instance (default: false)
 * - INSTANCE_{NAME}_CHROMADB_HOST: ChromaDB host for instance
 * - INSTANCE_{NAME}_CHROMADB_PORT: ChromaDB port for instance
 * - INSTANCE_{NAME}_CHROMADB_AUTH_TOKEN: ChromaDB auth token for instance
 * - INSTANCE_{NAME}_DATA_PATH: Data path for instance
 * - INSTANCE_{NAME}_ENABLED: Whether instance is enabled
 *
 * @returns Multi-instance configuration
 */
export function loadInstanceConfig(): MultiInstanceConfig {
  const env = Bun.env;

  // Load default instance setting
  const defaultInstanceRaw = env[ENV_KEYS.DEFAULT_INSTANCE] || "public";
  const defaultInstanceResult = InstanceAccessSchema.safeParse(defaultInstanceRaw);

  if (!defaultInstanceResult.success) {
    throw new Error(
      `Invalid DEFAULT_INSTANCE: "${defaultInstanceRaw}". Must be one of: ${INSTANCE_NAMES.join(", ")}`
    );
  }

  const defaultInstance = defaultInstanceResult.data;

  // Load require auth setting
  const requireAuthForDefaultInstance = parseEnvBoolean(
    env[ENV_KEYS.REQUIRE_AUTH_FOR_DEFAULT_INSTANCE],
    false
  );

  // Load configuration for each instance
  const instances: Record<InstanceAccess, InstanceConfig> = {
    private: loadInstanceConfigFromEnv("private", DEFAULT_INSTANCES.private),
    work: loadInstanceConfigFromEnv("work", DEFAULT_INSTANCES.work),
    public: loadInstanceConfigFromEnv("public", DEFAULT_INSTANCES.public),
  };

  // Validate that default instance is enabled
  if (!instances[defaultInstance].enabled) {
    throw new Error(
      `Default instance "${defaultInstance}" is disabled. Enable it or choose a different default.`
    );
  }

  return {
    instances,
    defaultInstance,
    requireAuthForDefaultInstance,
  };
}

/**
 * Get enabled instances from configuration
 *
 * @param config - Multi-instance configuration
 * @returns Array of enabled instance names
 */
export function getEnabledInstances(config: MultiInstanceConfig): InstanceAccess[] {
  return INSTANCE_NAMES.filter((name) => config.instances[name].enabled);
}

/**
 * Validate that an instance name is valid
 *
 * @param name - Instance name to validate
 * @returns True if valid, false otherwise
 */
export function isValidInstanceName(name: string): name is InstanceAccess {
  return INSTANCE_NAMES.includes(name as InstanceAccess);
}

/**
 * Get configuration for a specific instance
 *
 * @param config - Multi-instance configuration
 * @param instanceName - Instance name
 * @returns Instance configuration or undefined if not found/disabled
 */
export function getInstanceConfig(
  config: MultiInstanceConfig,
  instanceName: InstanceAccess
): InstanceConfig | undefined {
  const instanceConfig = config.instances[instanceName];
  if (!instanceConfig || !instanceConfig.enabled) {
    return undefined;
  }
  return instanceConfig;
}
