/**
 * Type definitions for MCP server and tools
 *
 * This module defines TypeScript interfaces and types for the Model Context Protocol
 * (MCP) server implementation, including tool handlers, registries, and configurations.
 */

import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types.js";

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
}
