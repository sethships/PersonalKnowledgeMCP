/**
 * Graph Adapter Configuration Utility
 *
 * Unified configuration helper for graph database adapters (Neo4j and FalkorDB).
 * Used by graph commands (migrate, populate, populate-all) to get the correct
 * configuration based on the selected adapter type.
 *
 * @example
 * ```typescript
 * import { getAdapterConfig, getDefaultAdapterType } from "../utils/graph-config.js";
 * import { createGraphAdapter } from "../../graph/adapters/index.js";
 *
 * const adapterType = options.adapter || getDefaultAdapterType();
 * const config = getAdapterConfig(adapterType);
 * const adapter = createGraphAdapter(adapterType, config);
 * ```
 */

import type { GraphStorageConfig, GraphAdapterType } from "../../graph/adapters/types.js";
import { getGraphConfig } from "./neo4j-config.js";
import { getFalkorDBConfig } from "./falkordb-config.js";

/**
 * Get configuration for the specified graph adapter type
 *
 * Routes to the appropriate configuration loader based on adapter type.
 *
 * @param adapterType - The graph adapter type ("neo4j" or "falkordb")
 * @returns Graph storage configuration object
 * @throws {Error} If adapter type is unsupported or configuration is invalid
 *
 * @example
 * ```typescript
 * // Get FalkorDB configuration
 * const config = getAdapterConfig("falkordb");
 *
 * // Get Neo4j configuration
 * const config = getAdapterConfig("neo4j");
 * ```
 */
export function getAdapterConfig(adapterType: GraphAdapterType): GraphStorageConfig {
  switch (adapterType) {
    case "neo4j":
      return getGraphConfig();
    case "falkordb":
      return getFalkorDBConfig();
    default: {
      // TypeScript exhaustiveness check
      const _exhaustiveCheck: never = adapterType;
      throw new Error(`Unsupported adapter type: ${String(_exhaustiveCheck)}`);
    }
  }
}

/**
 * Get the default graph adapter type from environment or fallback
 *
 * Resolution priority:
 * 1. GRAPH_ADAPTER environment variable (if explicitly set)
 * 2. FalkorDB (default, per Docker Compose setup)
 *
 * @returns The default adapter type ("falkordb" or "neo4j")
 *
 * @example
 * ```typescript
 * // With GRAPH_ADAPTER=neo4j in environment
 * getDefaultAdapterType() // Returns "neo4j"
 *
 * // Without GRAPH_ADAPTER set
 * getDefaultAdapterType() // Returns "falkordb" (default)
 * ```
 */
export function getDefaultAdapterType(): GraphAdapterType {
  const adapterEnv = process.env["GRAPH_ADAPTER"]?.toLowerCase();
  if (adapterEnv === "neo4j") {
    return "neo4j";
  }
  // FalkorDB is the default (per Docker Compose setup and project standards)
  return "falkordb";
}

/**
 * Get user-friendly adapter name for display
 *
 * @param adapterType - The graph adapter type
 * @returns Human-readable adapter name
 */
export function getAdapterDisplayName(adapterType: GraphAdapterType): string {
  switch (adapterType) {
    case "neo4j":
      return "Neo4j";
    case "falkordb":
      return "FalkorDB";
    default: {
      const _exhaustiveCheck: never = adapterType;
      return String(_exhaustiveCheck);
    }
  }
}

/**
 * Get the required environment variable hint for configuration errors
 *
 * @param adapterType - The graph adapter type
 * @returns Help text for configuring the adapter
 */
export function getAdapterConfigHint(adapterType: GraphAdapterType): string {
  switch (adapterType) {
    case "neo4j":
      return "Set NEO4J_PASSWORD in your .env file";
    case "falkordb":
      return "Set FALKORDB_PASSWORD in your .env file (or leave empty for default)";
    default: {
      const _exhaustiveCheck: never = adapterType;
      return `Configure ${String(_exhaustiveCheck)} adapter`;
    }
  }
}

/**
 * Get the docker compose start command for the adapter
 *
 * @param adapterType - The graph adapter type
 * @returns Docker compose command to start the adapter service
 */
export function getAdapterDockerCommand(adapterType: GraphAdapterType): string {
  switch (adapterType) {
    case "neo4j":
      return "docker compose up neo4j -d";
    case "falkordb":
      return "docker compose --profile default up -d";
    default: {
      const _exhaustiveCheck: never = adapterType;
      return `docker compose up ${String(_exhaustiveCheck)} -d`;
    }
  }
}
