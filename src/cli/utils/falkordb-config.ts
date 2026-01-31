/**
 * FalkorDB Configuration Utility
 *
 * Shared utility for reading FalkorDB configuration from environment variables.
 * Used by graph commands that interact with FalkorDB.
 */

import type { GraphStorageConfig } from "../../graph/adapters/types.js";

/**
 * Get FalkorDB configuration from environment
 *
 * Reads FalkorDB connection settings from environment variables:
 * - FALKORDB_HOST: FalkorDB host (default: localhost)
 * - FALKORDB_PORT: Connection port (default: 6379)
 * - FALKORDB_USER: Username (default: default)
 * - FALKORDB_PASSWORD: Password (optional, empty string if not set)
 * - FALKORDB_GRAPH_NAME: Graph name (default: knowledge_graph)
 *
 * @returns Graph storage configuration object
 * @throws Error if required environment variables are missing or invalid
 *
 * @example
 * ```typescript
 * import { getFalkorDBConfig } from "../utils/falkordb-config.js";
 * import { createGraphAdapter } from "../../graph/adapters/index.js";
 *
 * try {
 *   const config = getFalkorDBConfig();
 *   const adapter = createGraphAdapter('falkordb', config);
 * } catch (error) {
 *   console.error("FalkorDB not configured:", error.message);
 * }
 * ```
 */
export function getFalkorDBConfig(): GraphStorageConfig {
  const host = process.env["FALKORDB_HOST"] || "localhost";
  const portEnv = process.env["FALKORDB_PORT"] || "6379";
  const username = process.env["FALKORDB_USER"] || "default";
  const password = process.env["FALKORDB_PASSWORD"] || "";
  const database = process.env["FALKORDB_GRAPH_NAME"] || "knowledge_graph";

  // Validate port is a valid integer
  const port = parseInt(portEnv, 10);
  if (!/^\d+$/.test(portEnv) || isNaN(port) || port < 1 || port > 65535) {
    throw new Error(
      `Invalid FALKORDB_PORT value: "${portEnv}". ` +
        "Port must be a valid integer between 1 and 65535."
    );
  }

  return {
    host,
    port,
    username,
    password,
    database,
  };
}
