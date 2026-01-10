/**
 * Neo4j Configuration Utility
 *
 * Shared utility for reading Neo4j configuration from environment variables.
 * Used by all graph commands (migrate, populate, etc.)
 */

import type { Neo4jConfig } from "../../graph/types.js";

/**
 * Get Neo4j configuration from environment
 *
 * Reads Neo4j connection settings from environment variables:
 * - NEO4J_HOST: Neo4j host (default: localhost)
 * - NEO4J_BOLT_PORT: Bolt protocol port (default: 7687)
 * - NEO4J_USER: Username (default: neo4j)
 * - NEO4J_PASSWORD: Password (required)
 *
 * @returns Neo4j configuration object
 * @throws Error if required environment variables are missing or invalid
 *
 * @example
 * ```typescript
 * import { getNeo4jConfig } from "../utils/neo4j-config.js";
 *
 * try {
 *   const config = getNeo4jConfig();
 *   const client = new Neo4jStorageClientImpl(config);
 * } catch (error) {
 *   console.error("Neo4j not configured:", error.message);
 * }
 * ```
 */
export function getNeo4jConfig(): Neo4jConfig {
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
