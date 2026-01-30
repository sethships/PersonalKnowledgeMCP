/**
 * Unit tests for Graph Data Migration Service
 *
 * Tests the data migration functionality from Neo4j to FalkorDB.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import {
  GraphDataMigrationService,
  createMigrationService,
  type ExportedNode,
  type ExportedRelationship,
} from "../../../src/migration/graph-data-migration.js";
import type { GraphStorageAdapter } from "../../../src/graph/adapters/types.js";
import { initializeLogger, resetLogger } from "../../../src/logging/index.js";

// Initialize logger for tests
beforeEach(() => {
  initializeLogger({ level: "silent", format: "json" });
});

afterEach(() => {
  resetLogger();
});

/**
 * Create a mock graph storage adapter
 */
function createMockAdapter(
  options: {
    nodes?: ExportedNode[];
    relationships?: ExportedRelationship[];
    nodeCountByLabel?: Record<string, number>;
    relationshipCountByType?: Record<string, number>;
  } = {}
): GraphStorageAdapter {
  const nodes = options.nodes ?? [];
  const relationships = options.relationships ?? [];
  const nodeCountByLabel = options.nodeCountByLabel ?? {};
  const relationshipCountByType = options.relationshipCountByType ?? {};

  let newNodeId = 1000;

  const runQueryImpl = async <T>(
    cypher: string,
    params?: Record<string, unknown>
  ): Promise<T[]> => {
    // Handle node export query
    if (cypher.includes("MATCH (n)") && cypher.includes("labels(n)") && cypher.includes("SKIP")) {
      const offset = (params?.["offset"] as number) ?? 0;
      const limit = (params?.["limit"] as number) ?? 1000;
      const batch = nodes.slice(offset, offset + limit).map((n) => ({
        id: n.id,
        labels: n.labels,
        properties: n.properties,
      }));
      return batch as unknown as T[];
    }

    // Handle relationship export query
    if (cypher.includes("MATCH (a)-[r]->(b)") && cypher.includes("SKIP")) {
      const offset = (params?.["offset"] as number) ?? 0;
      const limit = (params?.["limit"] as number) ?? 1000;
      const batch = relationships.slice(offset, offset + limit).map((r) => ({
        id: r.id,
        type: r.type,
        startNodeId: r.startNodeId,
        endNodeId: r.endNodeId,
        properties: r.properties,
      }));
      return batch as unknown as T[];
    }

    // Handle node count query
    if (cypher.includes("count(n)") && !cypher.includes("UNWIND")) {
      return [{ count: nodes.length }] as unknown as T[];
    }

    // Handle relationship count query
    if (cypher.includes("count(r)")) {
      return [{ count: relationships.length }] as unknown as T[];
    }

    // Handle node count by label query
    if (cypher.includes("UNWIND labels(n)")) {
      const counts = Object.entries(nodeCountByLabel).map(([label, count]) => ({
        label,
        count,
      }));
      return counts as unknown as T[];
    }

    // Handle relationship count by type query
    if (cypher.includes("type(r) AS type")) {
      const counts = Object.entries(relationshipCountByType).map(([type, count]) => ({
        type,
        count,
      }));
      return counts as unknown as T[];
    }

    // Handle node creation (import)
    if (cypher.includes("CREATE (n")) {
      newNodeId++;
      return [{ newId: String(newNodeId) }] as unknown as T[];
    }

    // Handle relationship creation (import)
    if (cypher.includes("CREATE (a)-[r:")) {
      return [] as unknown as T[];
    }

    // Handle sample query for validation
    if (cypher.includes("rand()") && cypher.includes("ORDER BY r")) {
      const limit = (params?.["limit"] as number) ?? 10;
      return nodes.slice(0, limit).map((n) => ({
        id: n.id,
        labels: n.labels,
        properties: n.properties,
      })) as unknown as T[];
    }

    // Handle source ID lookup for validation
    if (cypher.includes("_source_id = $sourceId")) {
      const sourceId = params?.["sourceId"] as string;
      const node = nodes.find((n) => n.id === sourceId);
      if (node) {
        return [{ properties: { ...node.properties, _source_id: sourceId } }] as unknown as T[];
      }
      return [] as unknown as T[];
    }

    return [] as unknown as T[];
  };

  return {
    connect: mock(() => Promise.resolve()),
    disconnect: mock(() => Promise.resolve()),
    healthCheck: mock(() => Promise.resolve(true)),
    runQuery: runQueryImpl,
    upsertNode: mock(() => Promise.resolve({} as never)),
    deleteNode: mock(() => Promise.resolve(true)),
    createRelationship: mock(() => Promise.resolve({} as never)),
    deleteRelationship: mock(() => Promise.resolve(true)),
    traverse: mock(
      () => Promise.resolve({ nodes: [], relationships: [], paths: [], metadata: {} }) as never
    ),
    analyzeDependencies: mock(() => Promise.resolve({}) as never),
    getContext: mock(() => Promise.resolve({ context: [], metadata: {} }) as never),
  };
}

describe("GraphDataMigrationService", () => {
  describe("createMigrationService", () => {
    test("should create a migration service instance", () => {
      const service = createMigrationService();
      expect(service).toBeInstanceOf(GraphDataMigrationService);
    });
  });

  describe("exportNodes", () => {
    test("should export all nodes from adapter", async () => {
      const testNodes: ExportedNode[] = [
        { id: "1", labels: ["Repository"], properties: { name: "test-repo" } },
        { id: "2", labels: ["File"], properties: { path: "src/index.ts" } },
      ];

      const mockAdapter = createMockAdapter({ nodes: testNodes });
      const service = new GraphDataMigrationService();

      const result = await service.exportNodes(mockAdapter);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(testNodes[0]);
      expect(result[1]).toEqual(testNodes[1]);
    });

    test("should handle empty graph", async () => {
      const mockAdapter = createMockAdapter({ nodes: [] });
      const service = new GraphDataMigrationService();

      const result = await service.exportNodes(mockAdapter);

      expect(result).toHaveLength(0);
    });

    test("should process nodes in batches", async () => {
      const testNodes: ExportedNode[] = Array.from({ length: 2500 }, (_, i) => ({
        id: String(i),
        labels: ["TestNode"],
        properties: { index: i },
      }));

      const mockAdapter = createMockAdapter({ nodes: testNodes });
      const service = new GraphDataMigrationService();

      const result = await service.exportNodes(mockAdapter, { batchSize: 1000 });

      expect(result).toHaveLength(2500);
    });

    test("should call progress callback", async () => {
      const testNodes: ExportedNode[] = [
        { id: "1", labels: ["Repository"], properties: { name: "test" } },
      ];

      const mockAdapter = createMockAdapter({ nodes: testNodes });
      const service = new GraphDataMigrationService();

      const progressCalls: unknown[] = [];
      await service.exportNodes(mockAdapter, {
        onProgress: (progress) => progressCalls.push(progress),
      });

      expect(progressCalls.length).toBeGreaterThan(0);
      expect(progressCalls[0]).toMatchObject({
        phase: "export",
        step: "Exporting nodes",
      });
    });
  });

  describe("exportRelationships", () => {
    test("should export all relationships from adapter", async () => {
      const testRelationships: ExportedRelationship[] = [
        {
          id: "r1",
          type: "CONTAINS",
          startNodeId: "1",
          endNodeId: "2",
          properties: {},
        },
        {
          id: "r2",
          type: "IMPORTS",
          startNodeId: "2",
          endNodeId: "3",
          properties: { kind: "default" },
        },
      ];

      const mockAdapter = createMockAdapter({ relationships: testRelationships });
      const service = new GraphDataMigrationService();

      const result = await service.exportRelationships(mockAdapter);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(testRelationships[0]);
      expect(result[1]).toEqual(testRelationships[1]);
    });

    test("should handle empty relationships", async () => {
      const mockAdapter = createMockAdapter({ relationships: [] });
      const service = new GraphDataMigrationService();

      const result = await service.exportRelationships(mockAdapter);

      expect(result).toHaveLength(0);
    });
  });

  describe("exportGraph", () => {
    test("should export complete graph with metadata", async () => {
      const testNodes: ExportedNode[] = [
        { id: "1", labels: ["Repository"], properties: { name: "test" } },
        { id: "2", labels: ["File"], properties: { path: "index.ts" } },
      ];
      const testRelationships: ExportedRelationship[] = [
        { id: "r1", type: "CONTAINS", startNodeId: "1", endNodeId: "2", properties: {} },
      ];

      const mockAdapter = createMockAdapter({
        nodes: testNodes,
        relationships: testRelationships,
      });
      const service = new GraphDataMigrationService();

      const result = await service.exportGraph(mockAdapter, "neo4j");

      expect(result.nodes).toHaveLength(2);
      expect(result.relationships).toHaveLength(1);
      expect(result.metadata.sourceType).toBe("neo4j");
      expect(result.metadata.nodeCount).toBe(2);
      expect(result.metadata.relationshipCount).toBe(1);
      expect(result.metadata.nodeLabels).toContain("Repository");
      expect(result.metadata.nodeLabels).toContain("File");
      expect(result.metadata.relationshipTypes).toContain("CONTAINS");
      expect(result.metadata.exportedAt).toBeDefined();
    });
  });

  describe("getCounts", () => {
    test("should return counts from adapter", async () => {
      const testNodes: ExportedNode[] = [
        { id: "1", labels: ["Repository"], properties: {} },
        { id: "2", labels: ["File"], properties: {} },
        { id: "3", labels: ["File"], properties: {} },
      ];
      const testRelationships: ExportedRelationship[] = [
        { id: "r1", type: "CONTAINS", startNodeId: "1", endNodeId: "2", properties: {} },
        { id: "r2", type: "CONTAINS", startNodeId: "1", endNodeId: "3", properties: {} },
      ];

      const mockAdapter = createMockAdapter({
        nodes: testNodes,
        relationships: testRelationships,
        nodeCountByLabel: { Repository: 1, File: 2 },
        relationshipCountByType: { CONTAINS: 2 },
      });
      const service = new GraphDataMigrationService();

      const result = await service.getCounts(mockAdapter);

      expect(result.nodes).toBe(3);
      expect(result.relationships).toBe(2);
      expect(result.nodesByLabel["Repository"]).toBe(1);
      expect(result.nodesByLabel["File"]).toBe(2);
      expect(result.relationshipsByType["CONTAINS"]).toBe(2);
    });
  });

  describe("validate", () => {
    test("should return valid when counts match", async () => {
      const testNodes: ExportedNode[] = [
        { id: "1", labels: ["Repository"], properties: { name: "test" } },
      ];

      const mockSourceAdapter = createMockAdapter({
        nodes: testNodes,
        relationships: [],
        nodeCountByLabel: { Repository: 1 },
        relationshipCountByType: {},
      });

      const mockTargetAdapter = createMockAdapter({
        nodes: testNodes,
        relationships: [],
        nodeCountByLabel: { Repository: 1 },
        relationshipCountByType: {},
      });

      const service = new GraphDataMigrationService();

      const result = await service.validate(mockSourceAdapter, mockTargetAdapter, {
        validationSamples: 0,
      });

      expect(result.isValid).toBe(true);
      expect(result.discrepancies).toHaveLength(0);
    });

    test("should detect node count mismatch", async () => {
      const mockSourceAdapter = createMockAdapter({
        nodes: [
          { id: "1", labels: ["Repository"], properties: {} },
          { id: "2", labels: ["Repository"], properties: {} },
        ],
        relationships: [],
        nodeCountByLabel: { Repository: 2 },
        relationshipCountByType: {},
      });

      const mockTargetAdapter = createMockAdapter({
        nodes: [{ id: "1", labels: ["Repository"], properties: {} }],
        relationships: [],
        nodeCountByLabel: { Repository: 1 },
        relationshipCountByType: {},
      });

      const service = new GraphDataMigrationService();

      const result = await service.validate(mockSourceAdapter, mockTargetAdapter, {
        validationSamples: 0,
      });

      expect(result.isValid).toBe(false);
      expect(result.discrepancies.some((d) => d.includes("Node count mismatch"))).toBe(true);
    });

    test("should detect relationship count mismatch", async () => {
      const mockSourceAdapter = createMockAdapter({
        nodes: [],
        relationships: [
          { id: "r1", type: "CONTAINS", startNodeId: "1", endNodeId: "2", properties: {} },
        ],
        nodeCountByLabel: {},
        relationshipCountByType: { CONTAINS: 1 },
      });

      const mockTargetAdapter = createMockAdapter({
        nodes: [],
        relationships: [],
        nodeCountByLabel: {},
        relationshipCountByType: {},
      });

      const service = new GraphDataMigrationService();

      const result = await service.validate(mockSourceAdapter, mockTargetAdapter, {
        validationSamples: 0,
      });

      expect(result.isValid).toBe(false);
      expect(result.discrepancies.some((d) => d.includes("Relationship count mismatch"))).toBe(
        true
      );
    });
  });

  describe("importNodes", () => {
    test("should import nodes and build ID mapping", async () => {
      const testNodes: ExportedNode[] = [
        { id: "old-1", labels: ["Repository"], properties: { name: "test" } },
        { id: "old-2", labels: ["File"], properties: { path: "index.ts" } },
      ];

      const mockAdapter = createMockAdapter();
      const service = new GraphDataMigrationService();
      const nodeIdMap = new Map<string, string>();

      const result = await service.importNodes(mockAdapter, testNodes, {}, nodeIdMap);

      expect(result.imported).toBe(2);
      expect(result.errors).toHaveLength(0);
      expect(nodeIdMap.size).toBe(2);
      expect(nodeIdMap.has("old-1")).toBe(true);
      expect(nodeIdMap.has("old-2")).toBe(true);
    });

    test("should reject nodes with invalid labels (Cypher injection prevention)", async () => {
      const testNodes: ExportedNode[] = [
        { id: "valid-1", labels: ["ValidLabel"], properties: { name: "test" } },
        { id: "invalid-1", labels: ["Bad Label"], properties: { name: "spaces not allowed" } },
        {
          id: "invalid-2",
          labels: ["Inject]->(x) DELETE x//"],
          properties: { name: "injection attempt" },
        },
        { id: "invalid-3", labels: ["123StartWithNumber"], properties: { name: "bad start" } },
        { id: "valid-2", labels: ["_UnderscoreStart", "AlsoValid123"], properties: {} },
      ];

      const mockAdapter = createMockAdapter();
      const service = new GraphDataMigrationService();
      const nodeIdMap = new Map<string, string>();

      const result = await service.importNodes(mockAdapter, testNodes, {}, nodeIdMap);

      expect(result.imported).toBe(2); // Only valid-1 and valid-2
      expect(result.errors).toHaveLength(3); // invalid-1, invalid-2, invalid-3
      expect(result.errors.some((e) => e.error.includes("Bad Label"))).toBe(true);
      expect(result.errors.some((e) => e.error.includes("Inject"))).toBe(true);
      expect(result.errors.some((e) => e.error.includes("123StartWithNumber"))).toBe(true);
    });
  });

  describe("importRelationships", () => {
    test("should import relationships using ID mapping", async () => {
      const testRelationships: ExportedRelationship[] = [
        { id: "r1", type: "CONTAINS", startNodeId: "old-1", endNodeId: "old-2", properties: {} },
      ];

      const nodeIdMap = new Map<string, string>([
        ["old-1", "new-1"],
        ["old-2", "new-2"],
      ]);

      const mockAdapter = createMockAdapter();
      const service = new GraphDataMigrationService();

      const result = await service.importRelationships(
        mockAdapter,
        testRelationships,
        nodeIdMap,
        {}
      );

      expect(result.imported).toBe(1);
      expect(result.errors).toHaveLength(0);
    });

    test("should report error for missing node mappings", async () => {
      const testRelationships: ExportedRelationship[] = [
        { id: "r1", type: "CONTAINS", startNodeId: "old-1", endNodeId: "missing", properties: {} },
      ];

      const nodeIdMap = new Map<string, string>([["old-1", "new-1"]]);

      const mockAdapter = createMockAdapter();
      const service = new GraphDataMigrationService();

      const result = await service.importRelationships(
        mockAdapter,
        testRelationships,
        nodeIdMap,
        {}
      );

      expect(result.imported).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.error).toContain("Missing node mapping");
    });

    test("should reject relationships with invalid types (Cypher injection prevention)", async () => {
      const testRelationships: ExportedRelationship[] = [
        { id: "r1", type: "VALID_TYPE", startNodeId: "old-1", endNodeId: "old-2", properties: {} },
        {
          id: "r2",
          type: "BAD TYPE",
          startNodeId: "old-1",
          endNodeId: "old-2",
          properties: {},
        },
        {
          id: "r3",
          type: "INJECT]->(x) DELETE x WITH a CREATE (a)-[r:FAKE",
          startNodeId: "old-1",
          endNodeId: "old-2",
          properties: {},
        },
        {
          id: "r4",
          type: "123STARTS_WITH_NUMBER",
          startNodeId: "old-1",
          endNodeId: "old-2",
          properties: {},
        },
        {
          id: "r5",
          type: "_UNDERSCORE_START",
          startNodeId: "old-1",
          endNodeId: "old-2",
          properties: {},
        },
      ];

      const nodeIdMap = new Map<string, string>([
        ["old-1", "new-1"],
        ["old-2", "new-2"],
      ]);

      const mockAdapter = createMockAdapter();
      const service = new GraphDataMigrationService();

      const result = await service.importRelationships(
        mockAdapter,
        testRelationships,
        nodeIdMap,
        {}
      );

      expect(result.imported).toBe(2); // Only VALID_TYPE and _UNDERSCORE_START
      expect(result.errors).toHaveLength(3); // BAD TYPE, INJECT..., 123STARTS...
      expect(result.errors.some((e) => e.error.includes("BAD TYPE"))).toBe(true);
      expect(result.errors.some((e) => e.error.includes("INJECT"))).toBe(true);
      expect(result.errors.some((e) => e.error.includes("123STARTS_WITH_NUMBER"))).toBe(true);
    });
  });
});

describe("Validation Schema", () => {
  test("GraphTransferCommandOptionsSchema should validate defaults", async () => {
    const { GraphTransferCommandOptionsSchema } =
      await import("../../../src/cli/utils/validation.js");

    const result = GraphTransferCommandOptionsSchema.parse({});

    expect(result.source).toBe("neo4j");
    expect(result.target).toBe("falkordb");
    expect(result.batchSize).toBe(1000);
    expect(result.validationSamples).toBe(10);
  });

  test("GraphTransferCommandOptionsSchema should validate custom values", async () => {
    const { GraphTransferCommandOptionsSchema } =
      await import("../../../src/cli/utils/validation.js");

    const result = GraphTransferCommandOptionsSchema.parse({
      source: "FalkorDB",
      target: "Neo4j",
      batchSize: "500",
      validationSamples: "20",
      dryRun: true,
      json: true,
    });

    expect(result.source).toBe("falkordb");
    expect(result.target).toBe("neo4j");
    expect(result.batchSize).toBe(500);
    expect(result.validationSamples).toBe(20);
    expect(result.dryRun).toBe(true);
    expect(result.json).toBe(true);
  });

  test("GraphTransferCommandOptionsSchema should reject invalid adapter type", async () => {
    const { GraphTransferCommandOptionsSchema } =
      await import("../../../src/cli/utils/validation.js");

    expect(() => {
      GraphTransferCommandOptionsSchema.parse({
        source: "invalid",
      });
    }).toThrow();
  });

  test("GraphTransferCommandOptionsSchema should reject invalid batch size", async () => {
    const { GraphTransferCommandOptionsSchema } =
      await import("../../../src/cli/utils/validation.js");

    expect(() => {
      GraphTransferCommandOptionsSchema.parse({
        batchSize: "0",
      });
    }).toThrow();

    expect(() => {
      GraphTransferCommandOptionsSchema.parse({
        batchSize: "99999",
      });
    }).toThrow();
  });
});
