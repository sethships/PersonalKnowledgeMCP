/**
 * Graph Database Configuration Utility
 *
 * Shared utility for reading graph database configuration from environment variables.
 * Used by all graph commands (migrate, populate, etc.)
 *
 * Note: File named neo4j-config.ts for backward compatibility. Environment variables
 * still use NEO4J_ prefix for existing deployments.
 */

import type { GraphStorageConfig } from "../../graph/adapters/types.js";

/**
 * Get graph database configuration from environment
 *
 * Reads graph database connection settings from environment variables:
 * - NEO4J_HOST: Graph database host (default: localhost)
 * - NEO4J_BOLT_PORT: Connection port (default: 7687)
 * - NEO4J_USER: Username (default: neo4j)
 * - NEO4J_PASSWORD: Password (required)
 *
 * Note: Environment variable names use NEO4J_ prefix for backward compatibility
 * with existing deployments and configuration.
 *
 * @returns Graph storage configuration object
 * @throws Error if required environment variables are missing or invalid
 *
 * @example
 * ```typescript
 * import { getGraphConfig } from "../utils/neo4j-config.js";
 * import { createGraphAdapter } from "../../graph/adapters/index.js";
 *
 * try {
 *   const config = getGraphConfig();
 *   const adapter = createGraphAdapter('neo4j', config);
 * } catch (error) {
 *   console.error("Graph database not configured:", error.message);
 * }
 * ```
 */
export function getGraphConfig(): GraphStorageConfig {
  const host = process.env["NEO4J_HOST"] || "localhost";
  const portEnv = process.env["NEO4J_BOLT_PORT"] || "7687";
  const username = process.env["NEO4J_USER"] || "neo4j";
  const password = process.env["NEO4J_PASSWORD"];

  // Validate port is a valid integer (parseInt silently truncates "7687abc" to 7687)
  const port = parseInt(portEnv, 10);
  if (!/^\d+$/.test(portEnv) || isNaN(port) || port < 1 || port > 65535) {
    throw new Error(
      `Invalid NEO4J_BOLT_PORT value: "${portEnv}". ` +
        "Port must be a valid integer between 1 and 65535."
    );
  }

  if (!password) {
    throw new Error(
      "NEO4J_PASSWORD environment variable is required. " +
        "Set it in your .env file or export it in your shell."
    );
  }

  return {
    host,
    port,
    username,
    password,
  };
}

/**
 * @deprecated Use getGraphConfig() instead. This function is provided for backward compatibility.
 */
export const getNeo4jConfig = getGraphConfig;
