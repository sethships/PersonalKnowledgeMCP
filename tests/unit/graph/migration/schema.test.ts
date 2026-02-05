/**
 * Unit tests for graph schema definitions
 *
 * Tests schema element definitions, Cypher statement generation,
 * and schema validation.
 */

import { describe, test, expect } from "bun:test";
import {
  CONSTRAINTS,
  INDEXES,
  FULLTEXT_INDEXES,
  ALL_SCHEMA_ELEMENTS,
  getAllSchemaStatements,
  getSchemaForAdapter,
  getAllSchemaElements,
  type SchemaElement,
} from "../../../../src/graph/schema.js";

describe("Schema Definitions", () => {
  describe("CONSTRAINTS", () => {
    test("should define repo_name constraint", () => {
      const constraint = CONSTRAINTS.find((c) => c.name === "repo_name");
      expect(constraint).toBeDefined();
      expect(constraint?.type).toBe("constraint");
      expect(constraint?.cypher).toContain("Repository");
      expect(constraint?.cypher).toContain("r.name IS UNIQUE");
      expect(constraint?.cypher).toContain("IF NOT EXISTS");
    });

    test("should define file_path constraint", () => {
      const constraint = CONSTRAINTS.find((c) => c.name === "file_path");
      expect(constraint).toBeDefined();
      expect(constraint?.type).toBe("constraint");
      expect(constraint?.cypher).toContain("File");
      expect(constraint?.cypher).toContain("f.repository");
      expect(constraint?.cypher).toContain("f.path");
      expect(constraint?.cypher).toContain("IF NOT EXISTS");
    });

    test("should define chunk_id constraint", () => {
      const constraint = CONSTRAINTS.find((c) => c.name === "chunk_id");
      expect(constraint).toBeDefined();
      expect(constraint?.type).toBe("constraint");
      expect(constraint?.cypher).toContain("Chunk");
      expect(constraint?.cypher).toContain("chromaId");
      expect(constraint?.cypher).toContain("IF NOT EXISTS");
    });

    test("should define concept_name constraint", () => {
      const constraint = CONSTRAINTS.find((c) => c.name === "concept_name");
      expect(constraint).toBeDefined();
      expect(constraint?.type).toBe("constraint");
      expect(constraint?.cypher).toContain("Concept");
      expect(constraint?.cypher).toContain("name IS UNIQUE");
      expect(constraint?.cypher).toContain("IF NOT EXISTS");
    });

    test("should have exactly 4 constraints", () => {
      expect(CONSTRAINTS.length).toBe(4);
    });

    test("all constraints should be idempotent (IF NOT EXISTS)", () => {
      for (const constraint of CONSTRAINTS) {
        expect(constraint.cypher).toContain("IF NOT EXISTS");
      }
    });

    test("all constraints should have required properties", () => {
      for (const constraint of CONSTRAINTS) {
        expect(constraint.name).toBeDefined();
        expect(constraint.name.length).toBeGreaterThan(0);
        expect(constraint.type).toBe("constraint");
        expect(constraint.description).toBeDefined();
        expect(constraint.description.length).toBeGreaterThan(0);
        expect(constraint.cypher).toBeDefined();
        expect(constraint.cypher).toContain("CREATE CONSTRAINT");
      }
    });
  });

  describe("INDEXES", () => {
    test("should define file_extension index", () => {
      const index = INDEXES.find((i) => i.name === "file_extension");
      expect(index).toBeDefined();
      expect(index?.type).toBe("index");
      expect(index?.cypher).toContain("File");
      expect(index?.cypher).toContain("extension");
      expect(index?.cypher).toContain("IF NOT EXISTS");
    });

    test("should define function_name index", () => {
      const index = INDEXES.find((i) => i.name === "function_name");
      expect(index).toBeDefined();
      expect(index?.type).toBe("index");
      expect(index?.cypher).toContain("Function");
      expect(index?.cypher).toContain("name");
      expect(index?.cypher).toContain("IF NOT EXISTS");
    });

    test("should define class_name index", () => {
      const index = INDEXES.find((i) => i.name === "class_name");
      expect(index).toBeDefined();
      expect(index?.type).toBe("index");
      expect(index?.cypher).toContain("Class");
      expect(index?.cypher).toContain("name");
      expect(index?.cypher).toContain("IF NOT EXISTS");
    });

    test("should define module_name index", () => {
      const index = INDEXES.find((i) => i.name === "module_name");
      expect(index).toBeDefined();
      expect(index?.type).toBe("index");
      expect(index?.cypher).toContain("Module");
      expect(index?.cypher).toContain("name");
      expect(index?.cypher).toContain("IF NOT EXISTS");
    });

    test("should have exactly 4 indexes", () => {
      expect(INDEXES.length).toBe(4);
    });

    test("all indexes should be idempotent (IF NOT EXISTS)", () => {
      for (const index of INDEXES) {
        expect(index.cypher).toContain("IF NOT EXISTS");
      }
    });

    test("all indexes should have required properties", () => {
      for (const index of INDEXES) {
        expect(index.name).toBeDefined();
        expect(index.name.length).toBeGreaterThan(0);
        expect(index.type).toBe("index");
        expect(index.description).toBeDefined();
        expect(index.description.length).toBeGreaterThan(0);
        expect(index.cypher).toBeDefined();
        expect(index.cypher).toContain("CREATE INDEX");
      }
    });
  });

  describe("FULLTEXT_INDEXES", () => {
    test("should define entity_names fulltext index", () => {
      const index = FULLTEXT_INDEXES.find((i) => i.name === "entity_names");
      expect(index).toBeDefined();
      expect(index?.type).toBe("fulltext_index");
      expect(index?.cypher).toContain("FULLTEXT INDEX");
      expect(index?.cypher).toContain("Function");
      expect(index?.cypher).toContain("Class");
      expect(index?.cypher).toContain("Module");
      expect(index?.cypher).toContain("IF NOT EXISTS");
    });

    test("all fulltext indexes should be idempotent (IF NOT EXISTS)", () => {
      for (const index of FULLTEXT_INDEXES) {
        expect(index.cypher).toContain("IF NOT EXISTS");
      }
    });

    test("all fulltext indexes should have required properties", () => {
      for (const index of FULLTEXT_INDEXES) {
        expect(index.name).toBeDefined();
        expect(index.name.length).toBeGreaterThan(0);
        expect(index.type).toBe("fulltext_index");
        expect(index.description).toBeDefined();
        expect(index.description.length).toBeGreaterThan(0);
        expect(index.cypher).toBeDefined();
        expect(index.cypher).toContain("FULLTEXT INDEX");
      }
    });
  });

  describe("ALL_SCHEMA_ELEMENTS", () => {
    test("should contain all constraints, indexes, and fulltext indexes", () => {
      const totalExpected = CONSTRAINTS.length + INDEXES.length + FULLTEXT_INDEXES.length;
      expect(ALL_SCHEMA_ELEMENTS.length).toBe(totalExpected);
    });

    test("should have unique names across all elements", () => {
      const names = ALL_SCHEMA_ELEMENTS.map((e) => e.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    });

    test("should group elements by type", () => {
      const constraintCount = ALL_SCHEMA_ELEMENTS.filter((e) => e.type === "constraint").length;
      const indexCount = ALL_SCHEMA_ELEMENTS.filter((e) => e.type === "index").length;
      const fulltextCount = ALL_SCHEMA_ELEMENTS.filter((e) => e.type === "fulltext_index").length;

      expect(constraintCount).toBe(CONSTRAINTS.length);
      expect(indexCount).toBe(INDEXES.length);
      expect(fulltextCount).toBe(FULLTEXT_INDEXES.length);
    });
  });

  describe("getAllSchemaStatements", () => {
    test("should return array of Cypher statements", () => {
      const statements = getAllSchemaStatements();
      expect(Array.isArray(statements)).toBe(true);
      expect(statements.length).toBe(ALL_SCHEMA_ELEMENTS.length);
    });

    test("should return valid Cypher statements", () => {
      const statements = getAllSchemaStatements();

      for (const statement of statements) {
        expect(typeof statement).toBe("string");
        expect(statement.length).toBeGreaterThan(0);
        expect(
          statement.startsWith("CREATE CONSTRAINT") ||
            statement.startsWith("CREATE INDEX") ||
            statement.startsWith("CREATE FULLTEXT INDEX")
        ).toBe(true);
      }
    });

    test("should return statements in order: constraints, indexes, fulltext", () => {
      const statements = getAllSchemaStatements();

      const constraintStatements = statements.filter((s) => s.startsWith("CREATE CONSTRAINT"));
      const indexStatements = statements.filter(
        (s) => s.startsWith("CREATE INDEX") && !s.includes("FULLTEXT")
      );
      const fulltextStatements = statements.filter((s) => s.startsWith("CREATE FULLTEXT INDEX"));

      expect(constraintStatements.length).toBe(CONSTRAINTS.length);
      expect(indexStatements.length).toBe(INDEXES.length);
      expect(fulltextStatements.length).toBe(FULLTEXT_INDEXES.length);
    });
  });

  describe("Schema Element Types", () => {
    test("SchemaElementType should support constraint", () => {
      const element: SchemaElement = {
        name: "test",
        type: "constraint",
        description: "Test",
        cypher: "CREATE CONSTRAINT test IF NOT EXISTS FOR (n:Test) REQUIRE n.id IS UNIQUE",
      };
      expect(element.type).toBe("constraint");
    });

    test("SchemaElementType should support index", () => {
      const element: SchemaElement = {
        name: "test",
        type: "index",
        description: "Test",
        cypher: "CREATE INDEX test IF NOT EXISTS FOR (n:Test) ON (n.name)",
      };
      expect(element.type).toBe("index");
    });

    test("SchemaElementType should support fulltext_index", () => {
      const element: SchemaElement = {
        name: "test",
        type: "fulltext_index",
        description: "Test",
        cypher: "CREATE FULLTEXT INDEX test IF NOT EXISTS FOR (n:Test) ON EACH [n.name]",
      };
      expect(element.type).toBe("fulltext_index");
    });
  });
});

describe("Schema Cypher Syntax", () => {
  test("constraint Cypher should follow Neo4j 5.x syntax", () => {
    for (const constraint of CONSTRAINTS) {
      // Neo4j 5.x uses REQUIRE instead of ASSERT
      expect(constraint.cypher).toContain("REQUIRE");
      expect(constraint.cypher).not.toContain("ASSERT");

      // Should have proper structure
      expect(constraint.cypher).toMatch(/CREATE CONSTRAINT \w+ IF NOT EXISTS FOR \(/);
    }
  });

  test("index Cypher should follow Neo4j 5.x syntax", () => {
    for (const index of INDEXES) {
      // Should have proper structure
      expect(index.cypher).toMatch(/CREATE INDEX \w+ IF NOT EXISTS FOR \(/);
      expect(index.cypher).toContain("ON (");
    }
  });

  test("fulltext index Cypher should follow Neo4j 5.x syntax", () => {
    for (const index of FULLTEXT_INDEXES) {
      expect(index.cypher).toMatch(/CREATE FULLTEXT INDEX \w+ IF NOT EXISTS FOR \(/);
      expect(index.cypher).toContain("ON EACH [");
    }
  });
});

describe("Adapter-Aware Schema Functions", () => {
  describe("getSchemaForAdapter", () => {
    test("should return Neo4j schema for neo4j adapter", () => {
      const schema = getSchemaForAdapter("neo4j");
      expect(schema.constraints.length).toBeGreaterThan(0);
      expect(schema.indexes.length).toBeGreaterThan(0);
      expect(schema.fulltextIndexes.length).toBeGreaterThan(0);

      // Neo4j uses REQUIRE syntax
      for (const constraint of schema.constraints) {
        expect(constraint.cypher).toContain("REQUIRE");
        expect(constraint.cypher).not.toContain("ASSERT");
      }
    });

    test("should return FalkorDB schema for falkordb adapter", () => {
      const schema = getSchemaForAdapter("falkordb");
      expect(schema.constraints.length).toBeGreaterThan(0);
      expect(schema.indexes.length).toBeGreaterThan(0);

      // FalkorDB uses ASSERT syntax (OpenCypher)
      for (const constraint of schema.constraints) {
        expect(constraint.cypher).toContain("ASSERT");
        expect(constraint.cypher).not.toContain("REQUIRE");
      }

      // FalkorDB doesn't support fulltext indexes
      expect(schema.fulltextIndexes.length).toBe(0);
    });

    test("FalkorDB should not have NODE KEY constraint", () => {
      const schema = getSchemaForAdapter("falkordb");

      // FalkorDB uses file_id instead of file_path NODE KEY
      const fileConstraint = schema.constraints.find((c) => c.name === "file_id");
      expect(fileConstraint).toBeDefined();
      expect(fileConstraint?.cypher).not.toContain("IS NODE KEY");

      // Verify no NODE KEY constraints exist
      for (const constraint of schema.constraints) {
        expect(constraint.cypher).not.toContain("IS NODE KEY");
      }
    });

    test("Neo4j should have NODE KEY constraint for files", () => {
      const schema = getSchemaForAdapter("neo4j");

      const fileConstraint = schema.constraints.find((c) => c.name === "file_path");
      expect(fileConstraint).toBeDefined();
      expect(fileConstraint?.cypher).toContain("IS NODE KEY");
    });
  });

  describe("getAllSchemaElements", () => {
    test("should return all schema elements for neo4j adapter", () => {
      const elements = getAllSchemaElements("neo4j");

      // Should include fulltext indexes (Neo4j feature)
      const fulltextElements = elements.filter((e) => e.type === "fulltext_index");
      expect(fulltextElements.length).toBeGreaterThan(0);

      // Should have constraints, indexes, and fulltext indexes
      const constraints = elements.filter((e) => e.type === "constraint");
      const indexes = elements.filter((e) => e.type === "index");
      expect(constraints.length).toBeGreaterThan(0);
      expect(indexes.length).toBeGreaterThan(0);
    });

    test("should return Neo4j schema elements for neo4j adapter", () => {
      const elements = getAllSchemaElements("neo4j");

      // Should have constraints with REQUIRE syntax
      const constraints = elements.filter((e) => e.type === "constraint");
      for (const constraint of constraints) {
        expect(constraint.cypher).toContain("REQUIRE");
      }
    });

    test("should return FalkorDB schema elements for falkordb adapter", () => {
      const elements = getAllSchemaElements("falkordb");

      // Should have constraints with ASSERT syntax
      const constraints = elements.filter((e) => e.type === "constraint");
      for (const constraint of constraints) {
        expect(constraint.cypher).toContain("ASSERT");
      }

      // Should not have fulltext indexes
      const fulltextElements = elements.filter((e) => e.type === "fulltext_index");
      expect(fulltextElements.length).toBe(0);
    });
  });

  describe("getAllSchemaStatements", () => {
    test("should return FalkorDB-compatible Cypher when adapter is falkordb", () => {
      const statements = getAllSchemaStatements("falkordb");

      // All statements should use ASSERT (OpenCypher) not REQUIRE (Neo4j)
      const constraintStatements = statements.filter((s) => s.startsWith("CREATE CONSTRAINT"));
      for (const statement of constraintStatements) {
        expect(statement).toContain("ASSERT");
        expect(statement).not.toContain("REQUIRE");
      }

      // Should not have fulltext index statements
      const fulltextStatements = statements.filter((s) => s.includes("FULLTEXT INDEX"));
      expect(fulltextStatements.length).toBe(0);
    });
  });
});

describe("Schema ADR-0002 Compliance", () => {
  test("should have Repository unique constraint on name", () => {
    const repoConstraint = CONSTRAINTS.find((c) => c.name === "repo_name");
    expect(repoConstraint).toBeDefined();
    expect(repoConstraint?.cypher).toContain("Repository");
    expect(repoConstraint?.cypher).toContain("name IS UNIQUE");
  });

  test("should have File node key constraint on repository and path", () => {
    const fileConstraint = CONSTRAINTS.find((c) => c.name === "file_path");
    expect(fileConstraint).toBeDefined();
    expect(fileConstraint?.cypher).toContain("File");
    expect(fileConstraint?.cypher).toContain("f.repository");
    expect(fileConstraint?.cypher).toContain("f.path");
    expect(fileConstraint?.cypher).toContain("IS NODE KEY");
  });

  test("should have Chunk unique constraint on chromaId", () => {
    const chunkConstraint = CONSTRAINTS.find((c) => c.name === "chunk_id");
    expect(chunkConstraint).toBeDefined();
    expect(chunkConstraint?.cypher).toContain("Chunk");
    expect(chunkConstraint?.cypher).toContain("chromaId IS UNIQUE");
  });

  test("should have Concept unique constraint on name", () => {
    const conceptConstraint = CONSTRAINTS.find((c) => c.name === "concept_name");
    expect(conceptConstraint).toBeDefined();
    expect(conceptConstraint?.cypher).toContain("Concept");
    expect(conceptConstraint?.cypher).toContain("name IS UNIQUE");
  });

  test("should have file extension index for filtering", () => {
    const extIndex = INDEXES.find((i) => i.name === "file_extension");
    expect(extIndex).toBeDefined();
    expect(extIndex?.cypher).toContain("File");
    expect(extIndex?.cypher).toContain("extension");
  });

  test("should have entity name indexes for lookup", () => {
    const functionIndex = INDEXES.find((i) => i.name === "function_name");
    const classIndex = INDEXES.find((i) => i.name === "class_name");
    const moduleIndex = INDEXES.find((i) => i.name === "module_name");

    expect(functionIndex).toBeDefined();
    expect(classIndex).toBeDefined();
    expect(moduleIndex).toBeDefined();
  });

  test("should have fulltext index for cross-entity name search", () => {
    const fulltextIndex = FULLTEXT_INDEXES.find((i) => i.name === "entity_names");
    expect(fulltextIndex).toBeDefined();
    expect(fulltextIndex?.cypher).toContain("Function");
    expect(fulltextIndex?.cypher).toContain("Class");
    expect(fulltextIndex?.cypher).toContain("Module");
  });
});
