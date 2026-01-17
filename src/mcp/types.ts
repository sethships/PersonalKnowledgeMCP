/**
 * Type definitions for MCP server and tools
 *
 * This module defines TypeScript interfaces and types for the Model Context Protocol
 * (MCP) server implementation, including tool handlers, registries, and configurations.
 */

import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { IncrementalUpdateCoordinator } from "../services/incremental-update-coordinator.js";
import type { GraphService } from "../services/graph-service-types.js";
import type { MCPRateLimiter } from "./rate-limiter.js";
import type { JobTracker } from "./job-tracker.js";

/**
 * MCP tool handler function signature
 *
 * Tool handlers receive arguments and return a CallToolResult that may contain
 * content (text, images, etc.) and an error status.
 *
 * @param args - Tool-specific arguments (validated before handler is called)
 * @returns Promise resolving to MCP-compliant tool result
 */
export type ToolHandler = (args: unknown) => Promise<CallToolResult>;

/**
 * Registry entry for a single MCP tool
 *
 * Combines the tool definition (for ListTools responses) with the handler
 * function (for CallTool execution).
 */
export interface ToolRegistryEntry {
  /** MCP tool definition with name, description, and input schema */
  definition: Tool;

  /** Handler function that executes the tool logic */
  handler: ToolHandler;
}

/**
 * Registry of all available MCP tools
 *
 * Maps tool names to their definitions and handlers. This enables dynamic
 * tool discovery and routing without hardcoding tool names in the server.
 */
export interface ToolRegistry {
  [toolName: string]: ToolRegistryEntry;
}

/**
 * MCP server configuration
 *
 * Defines server metadata and capabilities advertised to MCP clients during
 * the initialization handshake.
 */
export interface MCPServerConfig {
  /** Server name (e.g., "personal-knowledge-mcp") */
  name: string;

  /** Server version following semver (e.g., "1.0.0") */
  version: string;

  /** Server capabilities advertised to clients */
  capabilities?: {
    /** Whether the server provides tools */
    tools?: boolean;

    /** Whether the server provides resources (future) */
    resources?: boolean;

    /** Whether the server provides prompts (future) */
    prompts?: boolean;
  };
}

/**
 * Validated semantic_search tool arguments
 *
 * This interface represents the tool arguments after Zod schema validation.
 * All optional fields have been populated with defaults.
 */
export interface SemanticSearchArgs {
  /** Natural language search query (1-1000 characters) */
  query: string;

  /** Maximum number of results to return (1-50) */
  limit: number;

  /** Minimum similarity score threshold (0.0-1.0) */
  threshold: number;

  /** Optional repository name filter */
  repository?: string;

  /**
   * Optional language filter. If provided, only returns results from files
   * of the specified programming language. Supported values: typescript, tsx, javascript, jsx.
   */
  language?: string;
}

/**
 * HTTP transport configuration
 *
 * Configuration options for the HTTP/SSE transport layer that enables
 * network-accessible MCP clients like Cursor, VS Code, etc.
 */
export interface HttpTransportConfig {
  /** Whether HTTP transport is enabled (default: false) */
  enabled: boolean;

  /** HTTP server port (default: 3001) */
  port: number;

  /** HTTP server host (default: 127.0.0.1) */
  host: string;
}

/**
 * Optional dependencies for MCP server
 *
 * These dependencies enable administrative tools when provided.
 * When not provided, the server operates with only the core tools.
 */
export interface MCPServerOptionalDeps {
  /** Coordinator for incremental repository updates */
  updateCoordinator?: IncrementalUpdateCoordinator;

  /** Rate limiter for administrative operations */
  rateLimiter?: MCPRateLimiter;

  /** Job tracker for async update operations */
  jobTracker?: JobTracker;

  /** GraphService for graph-based dependency queries */
  graphService?: GraphService;
}

/**
 * Valid entity type for get_dependencies tool
 */
export type DependencyEntityType = "file" | "function" | "class";

/**
 * Valid entity type for get_dependents tool
 *
 * Extends DependencyEntityType to include "package" for impact analysis
 * across package boundaries.
 */
export type DependentEntityType = "file" | "function" | "class" | "package";

/**
 * Valid relationship type strings for get_dependencies tool
 *
 * These are the lowercase string values accepted by the MCP tool.
 * They map to the RelationshipType enum values internally.
 */
export type DependencyRelationshipType =
  | "imports"
  | "calls"
  | "extends"
  | "implements"
  | "references";

/**
 * Validated get_dependencies tool arguments
 *
 * This interface represents the tool arguments after Zod schema validation.
 * All optional fields have been populated with defaults where applicable.
 */
export interface GetDependenciesArgs {
  /** Type of entity to query dependencies for */
  entity_type: DependencyEntityType;

  /**
   * Entity identifier:
   * - For files: relative path (e.g., 'src/auth/middleware.ts')
   * - For functions/classes: name or fully qualified name
   */
  entity_path: string;

  /** Repository name to scope the query */
  repository: string;

  /** Depth of transitive dependencies (1-5, default: 1) */
  depth: number;

  /** Filter to specific relationship types (optional, all types if omitted) */
  relationship_types?: DependencyRelationshipType[];
}

/**
 * Validated get_dependents tool arguments
 *
 * This interface represents the tool arguments after Zod schema validation.
 * All optional fields have been populated with defaults where applicable.
 */
export interface GetDependentsArgs {
  /** Type of entity to find dependents for */
  entity_type: DependentEntityType;

  /**
   * Entity identifier:
   * - For files: relative path (e.g., 'src/auth/middleware.ts')
   * - For functions/classes: name or fully qualified name
   * - For packages: package name or path
   */
  entity_path: string;

  /** Repository name to scope the query (optional - search all if omitted) */
  repository?: string;

  /** Depth of transitive dependents (1-5, default: 1) */
  depth: number;

  /** Include dependents from other repositories (default: false) */
  include_cross_repo: boolean;
}

/**
 * Valid detail level for get_architecture tool
 *
 * Controls the granularity of the architectural overview returned.
 * - packages: High-level package/module structure only
 * - modules: Packages and their internal modules
 * - files: Full file listing within modules
 * - entities: Individual functions, classes, and definitions within files
 */
export type ArchitectureDetailLevel = "packages" | "modules" | "files" | "entities";

/**
 * Validated get_architecture tool arguments
 *
 * This interface represents the tool arguments after Zod schema validation.
 * All optional fields have been populated with defaults where applicable.
 */
export interface GetArchitectureArgs {
  /** Repository name to analyze */
  repository: string;

  /**
   * Specific package or directory to focus on (e.g., 'src/services')
   * If omitted, analyzes full repository.
   */
  scope?: string;

  /** Level of detail to return */
  detail_level: ArchitectureDetailLevel;

  /** Include external dependencies (node_modules, etc.) (default: false) */
  include_external: boolean;
}

/**
 * Validated find_path tool arguments
 *
 * This interface represents the tool arguments after Zod schema validation.
 * All optional fields have been populated with defaults where applicable.
 *
 * The from_entity and to_entity strings can be:
 * - File paths: 'src/routes/api.ts' (type inferred as "file")
 * - Qualified names: 'src/routes/api.ts::handleLogin' (type inferred from case)
 */
export interface FindPathArgs {
  /**
   * Starting entity string (e.g., 'src/routes/api.ts::handleLogin')
   * If contains '::', treated as function/class. Otherwise, treated as file.
   */
  from_entity: string;

  /**
   * Target entity string (e.g., 'src/db/users.ts::findUser')
   * If contains '::', treated as function/class. Otherwise, treated as file.
   */
  to_entity: string;

  /** Repository name to scope the query */
  repository: string;

  /** Maximum path length to search (1-20, default: 10) */
  max_hops: number;

  /** Filter to specific relationship types (optional, all types if omitted) */
  relationship_types?: DependencyRelationshipType[];
}
