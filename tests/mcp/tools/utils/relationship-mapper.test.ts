/**
 * Unit tests for mapMCPRelationshipTypes utility
 *
 * Tests the shared utility function that maps MCP relationship type strings
 * to internal RelationshipType enum values.
 *
 * @module tests/mcp/tools/utils/relationship-mapper
 */

import { describe, it, expect } from "bun:test";
import { mapMCPRelationshipTypes } from "../../../../src/mcp/tools/utils/relationship-mapper.js";
import { RelationshipType } from "../../../../src/graph/types.js";
import type { DependencyRelationshipType } from "../../../../src/mcp/types.js";

describe("mapMCPRelationshipTypes", () => {
  describe("empty/undefined input handling", () => {
    it("should return undefined for undefined input", () => {
      const result = mapMCPRelationshipTypes(undefined);
      expect(result).toBeUndefined();
    });

    it("should return undefined for empty array", () => {
      const result = mapMCPRelationshipTypes([]);
      expect(result).toBeUndefined();
    });
  });

  describe("single relationship type mapping", () => {
    it("should map 'imports' to RelationshipType.IMPORTS", () => {
      const result = mapMCPRelationshipTypes(["imports"]);
      expect(result).toEqual([RelationshipType.IMPORTS]);
    });

    it("should map 'calls' to RelationshipType.CALLS", () => {
      const result = mapMCPRelationshipTypes(["calls"]);
      expect(result).toEqual([RelationshipType.CALLS]);
    });

    it("should map 'extends' to RelationshipType.EXTENDS", () => {
      const result = mapMCPRelationshipTypes(["extends"]);
      expect(result).toEqual([RelationshipType.EXTENDS]);
    });

    it("should map 'implements' to RelationshipType.IMPLEMENTS", () => {
      const result = mapMCPRelationshipTypes(["implements"]);
      expect(result).toEqual([RelationshipType.IMPLEMENTS]);
    });

    it("should map 'references' to RelationshipType.REFERENCES", () => {
      const result = mapMCPRelationshipTypes(["references"]);
      expect(result).toEqual([RelationshipType.REFERENCES]);
    });
  });

  describe("multiple relationship types mapping", () => {
    it("should map multiple types correctly", () => {
      const input: DependencyRelationshipType[] = ["imports", "calls"];
      const result = mapMCPRelationshipTypes(input);
      expect(result).toEqual([RelationshipType.IMPORTS, RelationshipType.CALLS]);
    });

    it("should map all five types correctly", () => {
      const input: DependencyRelationshipType[] = [
        "imports",
        "calls",
        "extends",
        "implements",
        "references",
      ];
      const result = mapMCPRelationshipTypes(input);
      expect(result).toEqual([
        RelationshipType.IMPORTS,
        RelationshipType.CALLS,
        RelationshipType.EXTENDS,
        RelationshipType.IMPLEMENTS,
        RelationshipType.REFERENCES,
      ]);
    });

    it("should handle duplicate types in input", () => {
      const input: DependencyRelationshipType[] = ["imports", "imports", "calls"];
      const result = mapMCPRelationshipTypes(input);
      expect(result).toEqual([
        RelationshipType.IMPORTS,
        RelationshipType.IMPORTS,
        RelationshipType.CALLS,
      ]);
    });

    it("should preserve input array order in output", () => {
      // Order matters when filtering relationship traversal
      const input: DependencyRelationshipType[] = ["references", "imports", "calls"];
      const result = mapMCPRelationshipTypes(input);
      expect(result).toEqual([
        RelationshipType.REFERENCES,
        RelationshipType.IMPORTS,
        RelationshipType.CALLS,
      ]);
    });
  });

  describe("type coverage validation", () => {
    it("should have mappings for all DependencyRelationshipType values", () => {
      // This test ensures we don't miss any relationship types
      const allTypes: DependencyRelationshipType[] = [
        "imports",
        "calls",
        "extends",
        "implements",
        "references",
      ];

      const result = mapMCPRelationshipTypes(allTypes);
      expect(result).toBeDefined();
      expect(result).toHaveLength(5);

      // Verify each mapped value is a valid RelationshipType
      for (const mappedType of result!) {
        expect(Object.values(RelationshipType)).toContain(mappedType);
      }
    });
  });
});
