/**
 * Relationship Type Mapper Utility
 *
 * This module provides a shared utility function for mapping MCP relationship
 * type strings to internal RelationshipType enum values. This consolidates
 * duplicate code previously found across multiple MCP tool implementations.
 *
 * @module mcp/tools/utils/relationship-mapper
 */

import type { DependencyRelationshipType } from "../../types.js";
import { RelationshipType } from "../../../graph/types.js";

/**
 * Mapping from lowercase MCP relationship type strings to internal enum values
 */
const RELATIONSHIP_TYPE_MAPPING: Record<DependencyRelationshipType, RelationshipType> = {
  imports: RelationshipType.IMPORTS,
  calls: RelationshipType.CALLS,
  extends: RelationshipType.EXTENDS,
  implements: RelationshipType.IMPLEMENTS,
  references: RelationshipType.REFERENCES,
};

/**
 * Maps MCP relationship type strings to internal RelationshipType enum values
 *
 * Converts lowercase string identifiers used in MCP tool input schemas
 * (e.g., "imports", "calls") to the corresponding RelationshipType enum
 * values used by the GraphService layer.
 *
 * @param mcpTypes - Array of lowercase relationship type strings from MCP input,
 *                   or undefined/empty array
 * @returns Array of RelationshipType enum values for GraphService, or undefined
 *          if input is undefined or empty
 *
 * @example
 * ```typescript
 * // Returns [RelationshipType.IMPORTS, RelationshipType.CALLS]
 * mapMCPRelationshipTypes(["imports", "calls"]);
 *
 * // Returns undefined (for "all types" semantics)
 * mapMCPRelationshipTypes(undefined);
 * mapMCPRelationshipTypes([]);
 * ```
 */
export function mapMCPRelationshipTypes(
  mcpTypes?: DependencyRelationshipType[]
): RelationshipType[] | undefined {
  if (!mcpTypes || mcpTypes.length === 0) {
    return undefined;
  }

  return mcpTypes.map((t) => RELATIONSHIP_TYPE_MAPPING[t]);
}
