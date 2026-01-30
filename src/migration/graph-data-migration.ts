/**
 * Graph Data Migration Service
 *
 * Provides functionality to migrate graph data between different graph database
 * backends (Neo4j to FalkorDB). Supports batch processing for large graphs,
 * validation, and progress reporting.
 *
 * @module migration/graph-data-migration
 */

import type { GraphStorageAdapter, GraphAdapterType } from "../graph/adapters/types.js";
import { createGraphAdapter, type GraphStorageConfig } from "../graph/adapters/index.js";
import { getComponentLogger } from "../logging/index.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Represents a node exported from the graph database
 */
export interface ExportedNode {
  /** Internal graph database ID */
  id: string;
  /** Node labels (e.g., ['Repository'], ['File']) */
  labels: string[];
  /** Node properties */
  properties: Record<string, unknown>;
}

/**
 * Represents a relationship exported from the graph database
 */
export interface ExportedRelationship {
  /** Internal relationship ID */
  id: string;
  /** Relationship type (e.g., 'CONTAINS', 'IMPORTS') */
  type: string;
  /** Source node ID */
  startNodeId: string;
  /** Target node ID */
  endNodeId: string;
  /** Relationship properties */
  properties: Record<string, unknown>;
}

/**
 * Export result from the source database
 */
export interface GraphExportResult {
  /** Exported nodes */
  nodes: ExportedNode[];
  /** Exported relationships */
  relationships: ExportedRelationship[];
  /** Export metadata */
  metadata: {
    sourceType: GraphAdapterType;
    exportedAt: string;
    nodeCount: number;
    relationshipCount: number;
    nodeLabels: string[];
    relationshipTypes: string[];
  };
}

/**
 * Import result to the target database
 */
export interface GraphImportResult {
  /** Number of nodes imported */
  nodesImported: number;
  /** Number of relationships imported */
  relationshipsImported: number;
  /** Nodes that failed to import */
  nodeErrors: Array<{ node: ExportedNode; error: string }>;
  /** Relationships that failed to import */
  relationshipErrors: Array<{ relationship: ExportedRelationship; error: string }>;
  /** Import duration in milliseconds */
  durationMs: number;
}

/**
 * Validation result comparing source and target databases
 */
export interface ValidationResult {
  /** Whether the validation passed */
  isValid: boolean;
  /** Source database counts */
  sourceCounts: {
    nodes: number;
    relationships: number;
    nodesByLabel: Record<string, number>;
    relationshipsByType: Record<string, number>;
  };
  /** Target database counts */
  targetCounts: {
    nodes: number;
    relationships: number;
    nodesByLabel: Record<string, number>;
    relationshipsByType: Record<string, number>;
  };
  /** Discrepancies found */
  discrepancies: string[];
  /** Sample node comparisons */
  sampleChecks: Array<{
    nodeId: string;
    label: string;
    sourceFound: boolean;
    targetFound: boolean;
    propertiesMatch: boolean;
  }>;
}

/**
 * Migration options
 */
export interface MigrationOptions {
  /** Batch size for processing (default: 1000) */
  batchSize?: number;
  /** Whether to perform a dry run (no writes) */
  dryRun?: boolean;
  /** Progress callback for reporting */
  onProgress?: (progress: MigrationProgress) => void;
  /** Number of random samples to check during validation */
  validationSamples?: number;
}

/**
 * Progress information during migration
 */
export interface MigrationProgress {
  /** Current phase of migration */
  phase: "export" | "import" | "validate";
  /** Current step within the phase */
  step: string;
  /** Items processed so far */
  processed: number;
  /** Total items to process (if known) */
  total?: number;
  /** Percentage complete (0-100) */
  percentage?: number;
}

/**
 * Full migration result
 */
export interface MigrationResult {
  /** Whether the migration completed successfully */
  success: boolean;
  /** Export result */
  export: GraphExportResult;
  /** Import result (null if dry run) */
  import: GraphImportResult | null;
  /** Validation result */
  validation: ValidationResult;
  /** Total duration in milliseconds */
  totalDurationMs: number;
  /** Error message if failed */
  error?: string;
}

// =============================================================================
// Migration Service
// =============================================================================

/**
 * Service for migrating graph data between database backends
 *
 * @example
 * ```typescript
 * const migrationService = new GraphDataMigrationService();
 *
 * const result = await migrationService.migrate(
 *   { host: 'localhost', port: 7687, ... }, // Neo4j config
 *   { host: 'localhost', port: 6379, ... }, // FalkorDB config
 *   'neo4j',
 *   'falkordb',
 *   { batchSize: 500 }
 * );
 * ```
 */
export class GraphDataMigrationService {
  private logger = getComponentLogger("migration:graph");

  /**
   * Export all nodes from a graph database
   *
   * @param adapter - Connected graph storage adapter
   * @param options - Migration options
   * @returns Exported nodes
   */
  async exportNodes(
    adapter: GraphStorageAdapter,
    options: MigrationOptions = {}
  ): Promise<ExportedNode[]> {
    const batchSize = options.batchSize ?? 1000;
    const nodes: ExportedNode[] = [];
    let offset = 0;
    let hasMore = true;

    this.logger.info({ batchSize }, "Starting node export");

    while (hasMore) {
      const batch = await adapter.runQuery<{
        id: string;
        labels: string[];
        properties: Record<string, unknown>;
      }>(
        `MATCH (n)
         RETURN id(n) AS id, labels(n) AS labels, properties(n) AS properties
         SKIP $offset LIMIT $limit`,
        { offset, limit: batchSize }
      );

      if (batch.length === 0) {
        hasMore = false;
      } else {
        for (const record of batch) {
          nodes.push({
            id: String(record.id),
            labels: record.labels,
            properties: record.properties,
          });
        }
        offset += batch.length;

        options.onProgress?.({
          phase: "export",
          step: "Exporting nodes",
          processed: nodes.length,
        });

        this.logger.debug({ exported: nodes.length }, "Exported node batch");
      }
    }

    this.logger.info({ totalNodes: nodes.length }, "Node export complete");
    return nodes;
  }

  /**
   * Export all relationships from a graph database
   *
   * @param adapter - Connected graph storage adapter
   * @param options - Migration options
   * @returns Exported relationships
   */
  async exportRelationships(
    adapter: GraphStorageAdapter,
    options: MigrationOptions = {}
  ): Promise<ExportedRelationship[]> {
    const batchSize = options.batchSize ?? 1000;
    const relationships: ExportedRelationship[] = [];
    let offset = 0;
    let hasMore = true;

    this.logger.info({ batchSize }, "Starting relationship export");

    while (hasMore) {
      const batch = await adapter.runQuery<{
        id: string;
        type: string;
        startNodeId: string;
        endNodeId: string;
        properties: Record<string, unknown>;
      }>(
        `MATCH (a)-[r]->(b)
         RETURN id(r) AS id, type(r) AS type, id(a) AS startNodeId, id(b) AS endNodeId, properties(r) AS properties
         SKIP $offset LIMIT $limit`,
        { offset, limit: batchSize }
      );

      if (batch.length === 0) {
        hasMore = false;
      } else {
        for (const record of batch) {
          relationships.push({
            id: String(record.id),
            type: record.type,
            startNodeId: String(record.startNodeId),
            endNodeId: String(record.endNodeId),
            properties: record.properties,
          });
        }
        offset += batch.length;

        options.onProgress?.({
          phase: "export",
          step: "Exporting relationships",
          processed: relationships.length,
        });

        this.logger.debug({ exported: relationships.length }, "Exported relationship batch");
      }
    }

    this.logger.info({ totalRelationships: relationships.length }, "Relationship export complete");
    return relationships;
  }

  /**
   * Export complete graph from source database
   *
   * @param sourceAdapter - Connected source adapter
   * @param sourceType - Source adapter type
   * @param options - Migration options
   * @returns Complete export result
   */
  async exportGraph(
    sourceAdapter: GraphStorageAdapter,
    sourceType: GraphAdapterType,
    options: MigrationOptions = {}
  ): Promise<GraphExportResult> {
    this.logger.info({ sourceType }, "Starting full graph export");

    const nodes = await this.exportNodes(sourceAdapter, options);
    const relationships = await this.exportRelationships(sourceAdapter, options);

    // Collect metadata
    const nodeLabels = new Set<string>();
    const relationshipTypes = new Set<string>();

    for (const node of nodes) {
      for (const label of node.labels) {
        nodeLabels.add(label);
      }
    }

    for (const rel of relationships) {
      relationshipTypes.add(rel.type);
    }

    return {
      nodes,
      relationships,
      metadata: {
        sourceType,
        exportedAt: new Date().toISOString(),
        nodeCount: nodes.length,
        relationshipCount: relationships.length,
        nodeLabels: Array.from(nodeLabels),
        relationshipTypes: Array.from(relationshipTypes),
      },
    };
  }

  /**
   * Import nodes into target database
   *
   * @param adapter - Connected target adapter
   * @param nodes - Nodes to import
   * @param options - Migration options
   * @param nodeIdMap - Map from source node IDs to target node IDs
   * @returns Import statistics
   */
  async importNodes(
    adapter: GraphStorageAdapter,
    nodes: ExportedNode[],
    options: MigrationOptions = {},
    nodeIdMap: Map<string, string>
  ): Promise<{ imported: number; errors: Array<{ node: ExportedNode; error: string }> }> {
    const batchSize = options.batchSize ?? 1000;
    const errors: Array<{ node: ExportedNode; error: string }> = [];
    let imported = 0;

    this.logger.info({ totalNodes: nodes.length, batchSize }, "Starting node import");

    // Process in batches
    for (let i = 0; i < nodes.length; i += batchSize) {
      const batch = nodes.slice(i, i + batchSize);

      for (const node of batch) {
        try {
          // Build labels string
          const labelsStr = node.labels.map((l) => `:${l}`).join("");

          // Build properties, adding source_id for tracking
          const props = { ...node.properties, _source_id: node.id };

          // Create the node and get the new ID
          const result = await adapter.runQuery<{ newId: string }>(
            `CREATE (n${labelsStr} $props) RETURN id(n) AS newId`,
            { props }
          );

          if (result.length > 0 && result[0]) {
            nodeIdMap.set(node.id, String(result[0].newId));
            imported++;
          }
        } catch (error) {
          errors.push({
            node,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      options.onProgress?.({
        phase: "import",
        step: "Importing nodes",
        processed: i + batch.length,
        total: nodes.length,
        percentage: Math.round(((i + batch.length) / nodes.length) * 100),
      });

      this.logger.debug({ imported, processed: i + batch.length }, "Imported node batch");
    }

    this.logger.info({ imported, errors: errors.length }, "Node import complete");
    return { imported, errors };
  }

  /**
   * Import relationships into target database
   *
   * @param adapter - Connected target adapter
   * @param relationships - Relationships to import
   * @param nodeIdMap - Map from source node IDs to target node IDs
   * @param options - Migration options
   * @returns Import statistics
   */
  async importRelationships(
    adapter: GraphStorageAdapter,
    relationships: ExportedRelationship[],
    nodeIdMap: Map<string, string>,
    options: MigrationOptions = {}
  ): Promise<{
    imported: number;
    errors: Array<{ relationship: ExportedRelationship; error: string }>;
  }> {
    const batchSize = options.batchSize ?? 1000;
    const errors: Array<{ relationship: ExportedRelationship; error: string }> = [];
    let imported = 0;

    this.logger.info(
      { totalRelationships: relationships.length, batchSize },
      "Starting relationship import"
    );

    for (let i = 0; i < relationships.length; i += batchSize) {
      const batch = relationships.slice(i, i + batchSize);

      for (const rel of batch) {
        try {
          // Get the new node IDs from the mapping
          const newStartId = nodeIdMap.get(rel.startNodeId);
          const newEndId = nodeIdMap.get(rel.endNodeId);

          if (!newStartId || !newEndId) {
            errors.push({
              relationship: rel,
              error: `Missing node mapping: start=${rel.startNodeId}->${newStartId}, end=${rel.endNodeId}->${newEndId}`,
            });
            continue;
          }

          // Create the relationship using internal IDs
          // Note: We use MATCH by _source_id property since id() values differ between DBs
          await adapter.runQuery(
            `MATCH (a), (b)
             WHERE a._source_id = $startSourceId AND b._source_id = $endSourceId
             CREATE (a)-[r:${rel.type} $props]->(b)`,
            {
              startSourceId: rel.startNodeId,
              endSourceId: rel.endNodeId,
              props: rel.properties,
            }
          );
          imported++;
        } catch (error) {
          errors.push({
            relationship: rel,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      options.onProgress?.({
        phase: "import",
        step: "Importing relationships",
        processed: i + batch.length,
        total: relationships.length,
        percentage: Math.round(((i + batch.length) / relationships.length) * 100),
      });

      this.logger.debug({ imported, processed: i + batch.length }, "Imported relationship batch");
    }

    this.logger.info({ imported, errors: errors.length }, "Relationship import complete");
    return { imported, errors };
  }

  /**
   * Import complete graph into target database
   *
   * @param targetAdapter - Connected target adapter
   * @param exportData - Exported graph data
   * @param options - Migration options
   * @returns Import result
   */
  async importGraph(
    targetAdapter: GraphStorageAdapter,
    exportData: GraphExportResult,
    options: MigrationOptions = {}
  ): Promise<GraphImportResult> {
    const startTime = Date.now();
    const nodeIdMap = new Map<string, string>();

    this.logger.info(
      { nodes: exportData.nodes.length, relationships: exportData.relationships.length },
      "Starting full graph import"
    );

    // Import nodes first to build ID mapping
    const nodeResult = await this.importNodes(targetAdapter, exportData.nodes, options, nodeIdMap);

    // Import relationships using the ID mapping
    const relResult = await this.importRelationships(
      targetAdapter,
      exportData.relationships,
      nodeIdMap,
      options
    );

    const durationMs = Date.now() - startTime;

    this.logger.info(
      {
        nodesImported: nodeResult.imported,
        relationshipsImported: relResult.imported,
        durationMs,
      },
      "Graph import complete"
    );

    return {
      nodesImported: nodeResult.imported,
      relationshipsImported: relResult.imported,
      nodeErrors: nodeResult.errors,
      relationshipErrors: relResult.errors,
      durationMs,
    };
  }

  /**
   * Get counts from a graph database for validation
   *
   * @param adapter - Connected adapter
   * @returns Node and relationship counts by type
   */
  async getCounts(adapter: GraphStorageAdapter): Promise<{
    nodes: number;
    relationships: number;
    nodesByLabel: Record<string, number>;
    relationshipsByType: Record<string, number>;
  }> {
    // Get total node count
    const nodeCountResult = await adapter.runQuery<{ count: number }>(
      "MATCH (n) RETURN count(n) AS count"
    );
    const totalNodes = nodeCountResult[0]?.count ?? 0;

    // Get total relationship count
    const relCountResult = await adapter.runQuery<{ count: number }>(
      "MATCH ()-[r]->() RETURN count(r) AS count"
    );
    const totalRelationships = relCountResult[0]?.count ?? 0;

    // Get nodes by label
    const labelCounts = await adapter.runQuery<{ label: string; count: number }>(
      `MATCH (n)
       UNWIND labels(n) AS label
       RETURN label, count(*) AS count`
    );
    const nodesByLabel: Record<string, number> = {};
    for (const row of labelCounts) {
      nodesByLabel[row.label] = row.count;
    }

    // Get relationships by type
    const typeCounts = await adapter.runQuery<{ type: string; count: number }>(
      `MATCH ()-[r]->()
       RETURN type(r) AS type, count(*) AS count`
    );
    const relationshipsByType: Record<string, number> = {};
    for (const row of typeCounts) {
      relationshipsByType[row.type] = row.count;
    }

    return {
      nodes: totalNodes,
      relationships: totalRelationships,
      nodesByLabel,
      relationshipsByType,
    };
  }

  /**
   * Validate migration by comparing source and target databases
   *
   * @param sourceAdapter - Connected source adapter
   * @param targetAdapter - Connected target adapter
   * @param options - Migration options
   * @returns Validation result
   */
  async validate(
    sourceAdapter: GraphStorageAdapter,
    targetAdapter: GraphStorageAdapter,
    options: MigrationOptions = {}
  ): Promise<ValidationResult> {
    const sampleCount = options.validationSamples ?? 10;

    this.logger.info({ sampleCount }, "Starting migration validation");

    options.onProgress?.({
      phase: "validate",
      step: "Getting source counts",
      processed: 0,
    });

    const sourceCounts = await this.getCounts(sourceAdapter);

    options.onProgress?.({
      phase: "validate",
      step: "Getting target counts",
      processed: 1,
    });

    const targetCounts = await this.getCounts(targetAdapter);

    // Find discrepancies
    const discrepancies: string[] = [];

    if (sourceCounts.nodes !== targetCounts.nodes) {
      discrepancies.push(
        `Node count mismatch: source=${sourceCounts.nodes}, target=${targetCounts.nodes}`
      );
    }

    if (sourceCounts.relationships !== targetCounts.relationships) {
      discrepancies.push(
        `Relationship count mismatch: source=${sourceCounts.relationships}, target=${targetCounts.relationships}`
      );
    }

    // Check label counts
    for (const [label, count] of Object.entries(sourceCounts.nodesByLabel)) {
      const targetCount = targetCounts.nodesByLabel[label] ?? 0;
      if (count !== targetCount) {
        discrepancies.push(
          `Label '${label}' count mismatch: source=${count}, target=${targetCount}`
        );
      }
    }

    // Check relationship type counts
    for (const [type, count] of Object.entries(sourceCounts.relationshipsByType)) {
      const targetCount = targetCounts.relationshipsByType[type] ?? 0;
      if (count !== targetCount) {
        discrepancies.push(
          `Relationship type '${type}' count mismatch: source=${count}, target=${targetCount}`
        );
      }
    }

    options.onProgress?.({
      phase: "validate",
      step: "Performing sample checks",
      processed: 2,
    });

    // Sample some nodes to verify properties
    const sampleChecks: ValidationResult["sampleChecks"] = [];

    if (sampleCount > 0 && sourceCounts.nodes > 0) {
      // Get random sample of nodes from source
      const samples = await sourceAdapter.runQuery<{
        id: string;
        labels: string[];
        properties: Record<string, unknown>;
      }>(
        `MATCH (n)
         WITH n, rand() AS r
         ORDER BY r
         LIMIT $limit
         RETURN id(n) AS id, labels(n) AS labels, properties(n) AS properties`,
        { limit: sampleCount }
      );

      for (const sample of samples) {
        // Try to find this node in target by _source_id
        const targetNodes = await targetAdapter.runQuery<{
          properties: Record<string, unknown>;
        }>(
          `MATCH (n)
           WHERE n._source_id = $sourceId
           RETURN properties(n) AS properties`,
          { sourceId: String(sample.id) }
        );

        const targetFound = targetNodes.length > 0;
        let propertiesMatch = false;

        if (targetFound && targetNodes[0]) {
          // Compare properties (excluding _source_id which we added)
          const sourceProps = sample.properties;
          const targetProps = { ...targetNodes[0].properties };
          delete targetProps["_source_id"];

          propertiesMatch =
            JSON.stringify(sourceProps, Object.keys(sourceProps).sort()) ===
            JSON.stringify(targetProps, Object.keys(targetProps).sort());
        }

        sampleChecks.push({
          nodeId: String(sample.id),
          label: sample.labels[0] ?? "unknown",
          sourceFound: true,
          targetFound,
          propertiesMatch,
        });
      }
    }

    const isValid = discrepancies.length === 0 && sampleChecks.every((s) => s.propertiesMatch);

    this.logger.info(
      { isValid, discrepancies: discrepancies.length, sampleChecks: sampleChecks.length },
      "Validation complete"
    );

    return {
      isValid,
      sourceCounts,
      targetCounts,
      discrepancies,
      sampleChecks,
    };
  }

  /**
   * Perform full migration from source to target database
   *
   * @param sourceConfig - Source database configuration
   * @param targetConfig - Target database configuration
   * @param sourceType - Source database type
   * @param targetType - Target database type
   * @param options - Migration options
   * @returns Complete migration result
   */
  async migrate(
    sourceConfig: GraphStorageConfig,
    targetConfig: GraphStorageConfig,
    sourceType: GraphAdapterType,
    targetType: GraphAdapterType,
    options: MigrationOptions = {}
  ): Promise<MigrationResult> {
    const startTime = Date.now();
    let sourceAdapter: GraphStorageAdapter | null = null;
    let targetAdapter: GraphStorageAdapter | null = null;

    this.logger.info({ sourceType, targetType, dryRun: options.dryRun }, "Starting migration");

    try {
      // Connect to source
      sourceAdapter = createGraphAdapter(sourceType, sourceConfig);
      await sourceAdapter.connect();
      this.logger.info({ sourceType }, "Connected to source database");

      // Export from source
      const exportResult = await this.exportGraph(sourceAdapter, sourceType, options);

      let importResult: GraphImportResult | null = null;

      if (!options.dryRun) {
        // Connect to target
        targetAdapter = createGraphAdapter(targetType, targetConfig);
        await targetAdapter.connect();
        this.logger.info({ targetType }, "Connected to target database");

        // Import to target
        importResult = await this.importGraph(targetAdapter, exportResult, options);
      } else {
        this.logger.info("Dry run - skipping import");
      }

      // Validate
      let validation: ValidationResult;
      if (options.dryRun || !targetAdapter) {
        // For dry run, return empty validation
        validation = {
          isValid: true,
          sourceCounts: {
            nodes: exportResult.nodes.length,
            relationships: exportResult.relationships.length,
            nodesByLabel: {},
            relationshipsByType: {},
          },
          targetCounts: {
            nodes: 0,
            relationships: 0,
            nodesByLabel: {},
            relationshipsByType: {},
          },
          discrepancies: ["Dry run - no validation performed"],
          sampleChecks: [],
        };
      } else {
        validation = await this.validate(sourceAdapter, targetAdapter, options);
      }

      const totalDurationMs = Date.now() - startTime;

      this.logger.info(
        {
          success: true,
          durationMs: totalDurationMs,
          nodesExported: exportResult.nodes.length,
          nodesImported: importResult?.nodesImported ?? 0,
        },
        "Migration complete"
      );

      return {
        success: validation.isValid || options.dryRun === true,
        export: exportResult,
        import: importResult,
        validation,
        totalDurationMs,
      };
    } catch (error) {
      const totalDurationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.logger.error({ error: errorMessage, durationMs: totalDurationMs }, "Migration failed");

      return {
        success: false,
        export: {
          nodes: [],
          relationships: [],
          metadata: {
            sourceType,
            exportedAt: new Date().toISOString(),
            nodeCount: 0,
            relationshipCount: 0,
            nodeLabels: [],
            relationshipTypes: [],
          },
        },
        import: null,
        validation: {
          isValid: false,
          sourceCounts: { nodes: 0, relationships: 0, nodesByLabel: {}, relationshipsByType: {} },
          targetCounts: { nodes: 0, relationships: 0, nodesByLabel: {}, relationshipsByType: {} },
          discrepancies: [errorMessage],
          sampleChecks: [],
        },
        totalDurationMs,
        error: errorMessage,
      };
    } finally {
      // Clean up connections
      if (sourceAdapter) {
        try {
          await sourceAdapter.disconnect();
        } catch {
          // Ignore disconnect errors
        }
      }
      if (targetAdapter) {
        try {
          await targetAdapter.disconnect();
        } catch {
          // Ignore disconnect errors
        }
      }
    }
  }
}

/**
 * Create a new graph data migration service instance
 */
export function createMigrationService(): GraphDataMigrationService {
  return new GraphDataMigrationService();
}
