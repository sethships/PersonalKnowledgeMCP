/**
 * FalkorDB Storage Adapter Implementation
 *
 * This module provides an implementation of the GraphStorageAdapter interface
 * for FalkorDB, an Apache 2.0 licensed Redis-based graph database with 95%+
 * Cypher compatibility.
 *
 * Features:
 * - Redis-based connection (default port: 6379)
 * - Full Cypher query support with FalkorDB-specific adaptations
 * - Automatic retry with exponential backoff for transient failures
 * - Comprehensive error handling with typed error classes
 *
 * Key differences from Neo4j:
 * - Uses id() instead of elementId() for relationship IDs
 * - No APOC procedures available - uses native Cypher fallback only
 * - CALL subqueries may have limited support - uses UNION ALL patterns
 *
 * @module graph/adapters/FalkorDBAdapter
 */

import { FalkorDB, type FalkorDBOptions, type Graph } from "falkordb";
import type {
  GraphNode,
  RepositoryNode,
  FileNode,
  FunctionNode,
  ClassNode,
  ModuleNode,
  ChunkNode,
  ConceptNode,
  RelationshipType,
  Relationship,
  RelationshipProperties,
  GraphTraverseInput,
  GraphTraverseResult,
  GraphDependenciesInput,
  GraphDependenciesResult,
  GraphContextInput,
  GraphContextResult,
  DependencyInfo,
  ContextItem,
  ContextType,
} from "../types.js";
import type { GraphStorageAdapter, GraphStorageConfig } from "./types.js";
import {
  GraphError,
  GraphConnectionError,
  NodeNotFoundError,
  isRetryableGraphError,
  mapGraphError,
} from "../errors.js";
import { getComponentLogger } from "../../logging/index.js";
import {
  withRetry,
  createRetryOptions,
  createRetryLogger,
  DEFAULT_RETRY_CONFIG,
  type RetryConfig,
} from "../../utils/retry.js";

/**
 * Implementation of the GraphStorageAdapter interface for FalkorDB
 *
 * Provides a high-level abstraction over the FalkorDB TypeScript client with:
 * - Redis-based connection management
 * - Graph selection for multi-graph support
 * - Retry logic for transient failures
 * - Comprehensive error handling
 *
 * @example
 * ```typescript
 * import { createGraphAdapter } from './graph/adapters';
 *
 * const adapter = createGraphAdapter('falkordb', {
 *   host: "localhost",
 *   port: 6379,
 *   username: "default",
 *   password: process.env.FALKORDB_PASSWORD!,
 *   database: "knowledge_graph",
 * });
 *
 * await adapter.connect();
 *
 * // Execute queries
 * const results = await adapter.runQuery<{ name: string }>(
 *   "MATCH (n:Repository) RETURN n.name as name"
 * );
 *
 * // Clean up
 * await adapter.disconnect();
 * ```
 */
export class FalkorDBAdapter implements GraphStorageAdapter {
  private client: InstanceType<typeof FalkorDB> | null = null;
  private graph: Graph | null = null;
  /** Normalization factor for impact score calculation (higher = lower score per dependency) */
  private static readonly IMPACT_SCORE_NORMALIZATION = 100;
  private config: GraphStorageConfig;
  private retryConfig: RetryConfig;
  private logger = getComponentLogger("graph:falkordb");

  /**
   * Create a new FalkorDB storage adapter
   *
   * @param config - Connection configuration including retry settings
   */
  constructor(config: GraphStorageConfig) {
    this.config = config;
    this.retryConfig = config.retry ?? DEFAULT_RETRY_CONFIG;
  }

  /**
   * Execute an operation with retry logic for transient failures
   *
   * Wraps the operation with exponential backoff retry for network and server errors.
   *
   * @param operation - Async operation to execute
   * @param operationName - Human-readable name for logging
   * @returns Promise resolving to the operation result
   */
  private async withRetryWrapper<T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    const options = createRetryOptions(this.retryConfig, {
      shouldRetry: (error) => isRetryableGraphError(error),
      onRetry: createRetryLogger(this.logger, operationName, this.retryConfig.maxRetries),
    });

    return withRetry(operation, options);
  }

  /**
   * Ensure the client and graph are connected before operations
   *
   * @throws {GraphConnectionError} If not connected
   */
  private ensureConnected(): void {
    if (!this.client || !this.graph) {
      throw new GraphConnectionError("Not connected to FalkorDB. Call connect() first.");
    }
  }

  /**
   * Initialize connection to FalkorDB server
   *
   * Creates the client and selects the graph with the configured name.
   * Uses retry logic with exponential backoff for transient connection failures.
   *
   * @throws {GraphConnectionError} If connection initialization fails after all retries
   */
  async connect(): Promise<void> {
    const startTime = Date.now();
    this.logger.info({ host: this.config.host, port: this.config.port }, "Connecting to FalkorDB");

    try {
      const falkorOptions: FalkorDBOptions = {
        socket: {
          host: this.config.host,
          port: this.config.port,
          connectTimeout: this.config.connectionAcquisitionTimeout ?? 30000,
        },
        username: this.config.username,
        password: this.config.password,
      };

      this.client = await this.withRetryWrapper(
        () => FalkorDB.connect(falkorOptions),
        "FalkorDB connection"
      );

      const graphName = this.config.database ?? "knowledge_graph";
      this.graph = this.client.selectGraph(graphName);

      // Verify connection with a simple query
      await this.withRetryWrapper(async () => {
        const healthy = await this.performHealthCheck();
        if (!healthy) {
          throw new GraphConnectionError("FalkorDB health check failed - server not responding");
        }
      }, "FalkorDB health check");

      const durationMs = Date.now() - startTime;
      this.logger.info(
        {
          metric: "falkordb.connection_ms",
          value: durationMs,
          host: this.config.host,
          port: this.config.port,
          graph: graphName,
        },
        "Connected to FalkorDB"
      );
    } catch (error) {
      const durationMs = Date.now() - startTime;
      this.logger.error(
        {
          metric: "falkordb.connection_ms",
          value: durationMs,
          host: this.config.host,
          port: this.config.port,
          err: error,
        },
        "Failed to connect to FalkorDB"
      );

      // Clean up partial connection
      if (this.client) {
        await this.client.close().catch(() => {});
        this.client = null;
        this.graph = null;
      }

      if (error instanceof GraphError) {
        throw error;
      }
      throw new GraphConnectionError(
        `Failed to connect to FalkorDB at ${this.config.host}:${this.config.port}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Disconnect from FalkorDB server
   *
   * Closes the client and releases the connection.
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      const startTime = Date.now();
      this.logger.info("Disconnecting from FalkorDB");

      try {
        await this.client.close();
        this.client = null;
        this.graph = null;

        const durationMs = Date.now() - startTime;
        this.logger.info(
          { metric: "falkordb.disconnect_ms", value: durationMs },
          "Disconnected from FalkorDB"
        );
      } catch (error) {
        this.logger.error({ err: error }, "Error during FalkorDB disconnect");
        this.client = null;
        this.graph = null;
        throw error;
      }
    }
  }

  /**
   * Perform a health check without retry
   *
   * @returns true if the server is healthy
   */
  private async performHealthCheck(): Promise<boolean> {
    if (!this.graph) {
      return false;
    }

    try {
      // Execute a simple query to verify connectivity
      await this.graph.query("RETURN 1 as health");
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if the connection is healthy
   *
   * @returns true if connected and server is responding
   */
  async healthCheck(): Promise<boolean> {
    if (!this.client || !this.graph) {
      this.logger.warn("Health check: Client not connected");
      return false;
    }

    try {
      const healthy = await this.performHealthCheck();
      if (!healthy) {
        this.logger.warn("Health check: Server not responding");
      }
      return healthy;
    } catch (error) {
      this.logger.error({ err: error }, "Health check failed");
      return false;
    }
  }

  /**
   * Validate and sanitize a label (node label or relationship type)
   *
   * Labels must match naming rules: start with letter, contain only
   * alphanumeric characters and underscores.
   *
   * @param label - The label to validate
   * @returns The validated label
   * @throws {GraphError} If the label contains invalid characters
   */
  private validateLabel(label: string): string {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(label)) {
      throw new GraphError(
        `Invalid node label: ${label}. Labels must start with a letter and contain only alphanumeric characters and underscores.`
      );
    }
    return label;
  }

  /**
   * Validate relationship type against allowed values
   *
   * Provides runtime validation to prevent Cypher injection through
   * malicious relationship type strings.
   *
   * @param type - The relationship type to validate
   * @throws {GraphError} If the relationship type is not valid
   */
  private validateRelationshipType(type: RelationshipType): void {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(type)) {
      throw new GraphError(`Invalid relationship type: ${type}`);
    }
  }

  /**
   * Convert FalkorDB query result to array of typed objects
   *
   * FalkorDB returns results with headers (column names) and data (row arrays).
   * This method maps each row to an object using the headers as keys.
   *
   * @param result - FalkorDB query result
   * @returns Array of mapped objects
   */
  private convertFalkorResult<T>(result: { headers?: string[]; data?: Array<unknown[]> }): T[] {
    if (!result.headers || !result.data) {
      return [];
    }

    return result.data.map((row) => {
      const obj: Record<string, unknown> = {};
      result.headers!.forEach((header, index) => {
        obj[header] = this.convertFalkorValue(row[index]);
      });
      return obj as T;
    });
  }

  /**
   * Convert FalkorDB values to JavaScript values recursively
   *
   * @param value - FalkorDB value
   * @returns Converted JavaScript value
   */
  private convertFalkorValue(value: unknown): unknown {
    if (value === null || value === undefined) {
      return value;
    }

    // Handle arrays (can contain nodes, relationships, or primitives)
    if (Array.isArray(value)) {
      return value.map((v) => this.convertFalkorValue(v));
    }

    // Handle FalkorDB Node structure
    if (this.isFalkorNode(value)) {
      return this.convertNode(value);
    }

    // Handle FalkorDB Relationship structure
    if (this.isFalkorRelationship(value)) {
      return this.convertRelationship(value);
    }

    // Handle plain objects
    if (typeof value === "object") {
      const obj: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        obj[k] = this.convertFalkorValue(v);
      }
      return obj;
    }

    return value;
  }

  /**
   * Type guard for FalkorDB Node
   * FalkorDB nodes typically have id, labels, and properties
   */
  private isFalkorNode(value: unknown): value is FalkorNode {
    return (
      typeof value === "object" &&
      value !== null &&
      "labels" in value &&
      "properties" in value &&
      "id" in value
    );
  }

  /**
   * Type guard for FalkorDB Relationship
   * FalkorDB relationships have id, type, src_node, dest_node, and properties
   */
  private isFalkorRelationship(value: unknown): value is FalkorRelationship {
    return (
      typeof value === "object" &&
      value !== null &&
      "type" in value &&
      "properties" in value &&
      ("src_node" in value || "sourceNode" in value)
    );
  }

  /**
   * Convert FalkorDB Node to plain object
   */
  private convertNode(node: FalkorNode): Record<string, unknown> {
    const properties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node.properties)) {
      properties[key] = this.convertFalkorValue(value);
    }
    return {
      id: String(node.id),
      labels: node.labels,
      ...properties,
    };
  }

  /**
   * Convert FalkorDB Relationship to plain object
   */
  private convertRelationship(rel: FalkorRelationship): Record<string, unknown> {
    const properties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rel.properties)) {
      properties[key] = this.convertFalkorValue(value);
    }
    return {
      id: String(rel.id),
      type: rel.type,
      fromNodeId: String(rel.src_node ?? rel.sourceNode),
      toNodeId: String(rel.dest_node ?? rel.destNode),
      properties,
    };
  }

  /**
   * Execute a Cypher query
   *
   * @param cypher - Cypher query string
   * @param params - Optional query parameters
   * @returns Array of query results
   */
  async runQuery<T>(cypher: string, params?: Record<string, unknown>): Promise<T[]> {
    this.ensureConnected();

    const startTime = Date.now();

    try {
      // Build query with parameters
      const queryWithParams = params ? this.buildParameterizedQuery(cypher, params) : cypher;

      const result = await this.withRetryWrapper(
        () => this.graph!.query<unknown[]>(queryWithParams),
        "Cypher query"
      );

      const records = this.convertFalkorResult<T>(result);

      const durationMs = Date.now() - startTime;
      this.logger.debug(
        {
          metric: "falkordb.query_ms",
          value: durationMs,
          recordCount: records.length,
        },
        "Query executed"
      );

      return records;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      this.logger.error(
        {
          metric: "falkordb.query_ms",
          value: durationMs,
          err: error,
          cypher: cypher.substring(0, 200),
        },
        "Query failed"
      );

      if (error instanceof GraphError) {
        throw error;
      }
      throw mapGraphError(error instanceof Error ? error : new Error(String(error)), "falkordb");
    }
  }

  /**
   * Build a Cypher query with parameters interpolated
   *
   * FalkorDB's query method accepts parameters differently than Neo4j.
   * For compatibility, we can either use the options.params or interpolate.
   * This helper safely interpolates string, number, boolean, and null values.
   *
   * @param cypher - Cypher query with $paramName placeholders
   * @param params - Parameter values
   * @returns Query string with parameters substituted
   */
  private buildParameterizedQuery(cypher: string, params: Record<string, unknown>): string {
    let result = cypher;
    for (const [key, value] of Object.entries(params)) {
      const placeholder = new RegExp(`\\$${key}\\b`, "g");
      result = result.replace(placeholder, this.serializeValue(value));
    }
    return result;
  }

  /**
   * Serialize a JavaScript value for use in Cypher query
   */
  private serializeValue(value: unknown): string {
    if (value === null || value === undefined) {
      return "null";
    }
    if (typeof value === "string") {
      // Escape single quotes and wrap in quotes
      return `'${value.replace(/'/g, "\\'")}'`;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    if (Array.isArray(value)) {
      return `[${value.map((v) => this.serializeValue(v)).join(", ")}]`;
    }
    if (typeof value === "object") {
      const entries = Object.entries(value)
        .map(([k, v]) => `${k}: ${this.serializeValue(v)}`)
        .join(", ");
      return `{${entries}}`;
    }
    return String(value);
  }

  /**
   * Generate a node ID based on its type and properties
   *
   * @param node - Node data without ID
   * @returns Generated ID string
   */
  private generateNodeId(node: Omit<GraphNode, "id"> & { id?: string }): string {
    if (node.id) {
      return node.id;
    }

    const label = node.labels[0];

    // Generate ID based on node type
    switch (label) {
      case "Repository":
        return `Repository:${(node as Omit<RepositoryNode, "id">).name}`;
      case "File":
        return `File:${(node as Omit<FileNode, "id">).repository}:${(node as Omit<FileNode, "id">).path}`;
      case "Function":
        return `Function:${(node as Omit<FunctionNode, "id">).repository}:${(node as Omit<FunctionNode, "id">).filePath}:${(node as Omit<FunctionNode, "id">).name}`;
      case "Class":
        return `Class:${(node as Omit<ClassNode, "id">).repository}:${(node as Omit<ClassNode, "id">).filePath}:${(node as Omit<ClassNode, "id">).name}`;
      case "Module":
        return `Module:${(node as Omit<ModuleNode, "id">).name}`;
      case "Chunk":
        return `Chunk:${(node as Omit<ChunkNode, "id">).chromaId}`;
      case "Concept":
        return `Concept:${(node as Omit<ConceptNode, "id">).name}`;
      default:
        // Fallback to random ID
        return `${label}:${crypto.randomUUID()}`;
    }
  }

  /**
   * Build Cypher SET clause for node properties
   *
   * @param node - Node with properties
   * @returns Object with SET clause and serialized values inline
   */
  private buildNodeSetClause(node: Omit<GraphNode, "id"> & { id?: string }): string {
    // Get properties excluding 'id' and 'labels'
    const properties = Object.entries(node).filter(([key]) => key !== "id" && key !== "labels");

    if (properties.length === 0) {
      return "";
    }

    const setParts = properties.map(([key, value]) => `n.${key} = ${this.serializeValue(value)}`);
    return `SET ${setParts.join(", ")}`;
  }

  /**
   * Create or update a node
   *
   * @param node - Node data to create or update
   * @returns The created/updated node with ID
   */
  async upsertNode<N extends GraphNode>(node: Omit<N, "id"> & { id?: string }): Promise<N> {
    this.ensureConnected();

    const startTime = Date.now();
    const nodeId = this.generateNodeId(node);
    // Validate each label to prevent Cypher injection
    const validatedLabels = node.labels.map((label) => this.validateLabel(label));
    const labels = validatedLabels.join(":");

    try {
      const setClause = this.buildNodeSetClause(node);

      const cypher = `
        MERGE (n:${labels} {id: ${this.serializeValue(nodeId)}})
        ${setClause}
        RETURN n
      `;

      const result = await this.withRetryWrapper(
        () => this.graph!.query<unknown[]>(cypher),
        "upsertNode"
      );

      const records = this.convertFalkorResult<{ n: Record<string, unknown> }>(result);

      if (records.length === 0) {
        throw new GraphError("Failed to upsert node - no result returned");
      }

      const resultNode = records[0]?.n;
      if (!resultNode) {
        throw new GraphError("Failed to upsert node - invalid result");
      }

      const durationMs = Date.now() - startTime;
      this.logger.debug(
        {
          metric: "falkordb.upsert_node_ms",
          value: durationMs,
          nodeId,
          labels,
        },
        "Node upserted"
      );

      return resultNode as N;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      this.logger.error(
        {
          metric: "falkordb.upsert_node_ms",
          value: durationMs,
          nodeId,
          labels,
          err: error,
        },
        "Failed to upsert node"
      );

      if (error instanceof GraphError) {
        throw error;
      }
      throw mapGraphError(error instanceof Error ? error : new Error(String(error)), "falkordb");
    }
  }

  /**
   * Delete a node by ID
   *
   * @param nodeId - ID of the node to delete
   * @returns true if deleted, false if not found
   */
  async deleteNode(nodeId: string): Promise<boolean> {
    this.ensureConnected();

    const startTime = Date.now();

    try {
      const cypher = `
        MATCH (n {id: ${this.serializeValue(nodeId)}})
        DETACH DELETE n
        RETURN count(n) as deleted
      `;

      const result = await this.withRetryWrapper(
        () => this.graph!.query<unknown[]>(cypher),
        "deleteNode"
      );

      const records = this.convertFalkorResult<{ deleted: number }>(result);
      const deletedCount = records[0]?.deleted ?? 0;

      const durationMs = Date.now() - startTime;
      this.logger.debug(
        {
          metric: "falkordb.delete_node_ms",
          value: durationMs,
          nodeId,
          deleted: deletedCount > 0,
        },
        deletedCount > 0 ? "Node deleted" : "Node not found"
      );

      return deletedCount > 0;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      this.logger.error(
        {
          metric: "falkordb.delete_node_ms",
          value: durationMs,
          nodeId,
          err: error,
        },
        "Failed to delete node"
      );

      if (error instanceof GraphError) {
        throw error;
      }
      throw mapGraphError(error instanceof Error ? error : new Error(String(error)), "falkordb");
    }
  }

  /**
   * Create a relationship between nodes
   *
   * @param fromNodeId - Source node ID
   * @param toNodeId - Target node ID
   * @param type - Relationship type
   * @param properties - Optional relationship properties
   * @returns The created relationship
   */
  async createRelationship<P extends RelationshipProperties>(
    fromNodeId: string,
    toNodeId: string,
    type: RelationshipType,
    properties?: P
  ): Promise<Relationship<P>> {
    this.ensureConnected();

    // Validate relationship type to prevent Cypher injection
    this.validateRelationshipType(type);

    const startTime = Date.now();

    try {
      // Build properties clause
      let propsClause = "";

      if (properties && Object.keys(properties).length > 0) {
        const propAssignments = Object.entries(properties).map(
          ([key, value]) => `${key}: ${this.serializeValue(value)}`
        );
        propsClause = `{${propAssignments.join(", ")}}`;
      }

      // FalkorDB uses id() instead of elementId()
      const cypher = `
        MATCH (from {id: ${this.serializeValue(fromNodeId)}})
        MATCH (to {id: ${this.serializeValue(toNodeId)}})
        CREATE (from)-[r:${type} ${propsClause}]->(to)
        RETURN r, id(r) as relId
      `;

      const result = await this.withRetryWrapper(
        () => this.graph!.query<unknown[]>(cypher),
        "createRelationship"
      );

      const records = this.convertFalkorResult<{ r: Record<string, unknown>; relId: number }>(
        result
      );

      if (records.length === 0) {
        // Check if nodes exist
        const checkCypher = `
          OPTIONAL MATCH (from {id: ${this.serializeValue(fromNodeId)}})
          OPTIONAL MATCH (to {id: ${this.serializeValue(toNodeId)}})
          RETURN from IS NOT NULL as fromExists, to IS NOT NULL as toExists
        `;
        const checkResult = await this.graph!.query<unknown[]>(checkCypher);
        const checkRecords = this.convertFalkorResult<{ fromExists: boolean; toExists: boolean }>(
          checkResult
        );

        if (checkRecords[0]) {
          if (!checkRecords[0].fromExists) {
            throw new NodeNotFoundError(
              fromNodeId,
              undefined,
              `Source node not found: ${fromNodeId}`
            );
          }
          if (!checkRecords[0].toExists) {
            throw new NodeNotFoundError(toNodeId, undefined, `Target node not found: ${toNodeId}`);
          }
        }

        throw new GraphError("Failed to create relationship - no result returned");
      }

      const relId = String(records[0]?.relId ?? records[0]?.r?.["id"] ?? "");

      const relationship: Relationship<P> = {
        id: relId,
        type,
        fromNodeId,
        toNodeId,
        properties: (properties ?? {}) as P,
      };

      const durationMs = Date.now() - startTime;
      this.logger.debug(
        {
          metric: "falkordb.create_relationship_ms",
          value: durationMs,
          type,
          fromNodeId,
          toNodeId,
        },
        "Relationship created"
      );

      return relationship;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      this.logger.error(
        {
          metric: "falkordb.create_relationship_ms",
          value: durationMs,
          type,
          fromNodeId,
          toNodeId,
          err: error,
        },
        "Failed to create relationship"
      );

      if (error instanceof GraphError) {
        throw error;
      }
      throw mapGraphError(error instanceof Error ? error : new Error(String(error)), "falkordb");
    }
  }

  /**
   * Delete a relationship by ID
   *
   * @param relationshipId - ID of the relationship to delete
   * @returns true if deleted, false if not found
   */
  async deleteRelationship(relationshipId: string): Promise<boolean> {
    this.ensureConnected();

    const startTime = Date.now();

    try {
      // FalkorDB uses id() instead of elementId()
      const cypher = `
        MATCH ()-[r]->()
        WHERE id(r) = ${relationshipId} OR toString(id(r)) = ${this.serializeValue(relationshipId)}
        DELETE r
        RETURN count(r) as deleted
      `;

      const result = await this.withRetryWrapper(
        () => this.graph!.query<unknown[]>(cypher),
        "deleteRelationship"
      );

      const records = this.convertFalkorResult<{ deleted: number }>(result);
      const deletedCount = records[0]?.deleted ?? 0;

      const durationMs = Date.now() - startTime;
      this.logger.debug(
        {
          metric: "falkordb.delete_relationship_ms",
          value: durationMs,
          relationshipId,
          deleted: deletedCount > 0,
        },
        deletedCount > 0 ? "Relationship deleted" : "Relationship not found"
      );

      return deletedCount > 0;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      this.logger.error(
        {
          metric: "falkordb.delete_relationship_ms",
          value: durationMs,
          relationshipId,
          err: error,
        },
        "Failed to delete relationship"
      );

      if (error instanceof GraphError) {
        throw error;
      }
      throw mapGraphError(error instanceof Error ? error : new Error(String(error)), "falkordb");
    }
  }

  /**
   * Traverse the graph from a starting node
   *
   * Note: FalkorDB does not support APOC procedures, so this uses native Cypher only.
   *
   * @param input - Traversal parameters
   * @returns Traversal results with nodes and relationships
   */
  async traverse(input: GraphTraverseInput): Promise<GraphTraverseResult> {
    this.ensureConnected();

    const startTime = Date.now();

    const { startNode, relationships, depth = 2, limit = 100 } = input;
    const maxDepth = Math.min(depth, 5); // Cap at 5 to prevent runaway queries
    const maxLimit = Math.min(limit, 1000); // Cap at 1000 results

    try {
      // Build the relationship pattern
      const relTypes = relationships.join("|");
      const relPattern = relationships.length > 0 ? `:${relTypes}` : "";

      // Build the start node match based on type
      let startMatch: string;

      switch (startNode.type) {
        case "file":
          startMatch = `(start:File {path: ${this.serializeValue(startNode.identifier)}})`;
          break;
        case "function":
          startMatch = `(start:Function {name: ${this.serializeValue(startNode.identifier)}})`;
          break;
        case "class":
          startMatch = `(start:Class {name: ${this.serializeValue(startNode.identifier)}})`;
          break;
        case "concept":
          startMatch = `(start:Concept {name: ${this.serializeValue(startNode.identifier)}})`;
          break;
        case "chunk":
          startMatch = `(start:Chunk {chromaId: ${this.serializeValue(startNode.identifier)}})`;
          break;
        case "module":
          startMatch = `(start:Module {name: ${this.serializeValue(startNode.identifier)}})`;
          break;
        default:
          startMatch = `(start {id: ${this.serializeValue(startNode.identifier)}})`;
      }

      if (startNode.repository) {
        startMatch = startMatch.replace(
          "})",
          `, repository: ${this.serializeValue(startNode.repository)}})`
        );
      }

      // FalkorDB native Cypher traversal (no APOC)
      const cypher = `
        MATCH ${startMatch}
        OPTIONAL MATCH path = (start)-[${relPattern}*1..${maxDepth}]-(connected)
        WITH start, collect(DISTINCT connected) as connectedNodes, collect(DISTINCT relationships(path)) as allRels
        RETURN start, connectedNodes, allRels
        LIMIT ${maxLimit}
      `;

      const result = await this.withRetryWrapper(
        () => this.graph!.query<unknown[]>(cypher),
        "traverse"
      );

      const records = this.convertFalkorResult<{
        start: Record<string, unknown>;
        connectedNodes: Array<Record<string, unknown>>;
        allRels: Array<Array<Record<string, unknown>>>;
      }>(result);

      // Process results
      const nodes: GraphTraverseResult["nodes"] = [];
      const rels: GraphTraverseResult["relationships"] = [];
      const seenNodes = new Set<string>();
      const seenRels = new Set<string>();

      for (const record of records) {
        // Add start node
        if (record.start) {
          const nodeId = String(record.start["id"]);
          if (!seenNodes.has(nodeId)) {
            seenNodes.add(nodeId);
            nodes.push({
              id: nodeId,
              type: (record.start["labels"] as string[] | undefined)?.[0] ?? "Unknown",
              properties: record.start,
            });
          }
        }

        // Add connected nodes
        if (Array.isArray(record.connectedNodes)) {
          for (const node of record.connectedNodes) {
            if (node) {
              const nodeId = String(node["id"]);
              if (!seenNodes.has(nodeId)) {
                seenNodes.add(nodeId);
                nodes.push({
                  id: nodeId,
                  type: (node["labels"] as string[] | undefined)?.[0] ?? "Unknown",
                  properties: node,
                });
              }
            }
          }
        }

        // Add relationships
        if (Array.isArray(record.allRels)) {
          for (const relPath of record.allRels) {
            if (Array.isArray(relPath)) {
              for (const rel of relPath) {
                if (rel) {
                  const relId = String(rel["id"]);
                  if (!seenRels.has(relId)) {
                    seenRels.add(relId);
                    rels.push({
                      from: String(rel["fromNodeId"]),
                      to: String(rel["toNodeId"]),
                      type: rel["type"] as RelationshipType,
                      properties: (rel["properties"] as Record<string, unknown>) ?? {},
                    });
                  }
                }
              }
            }
          }
        }
      }

      const durationMs = Date.now() - startTime;
      const traverseResult: GraphTraverseResult = {
        nodes,
        relationships: rels,
        metadata: {
          nodesCount: nodes.length,
          relationshipsCount: rels.length,
          queryTimeMs: durationMs,
        },
      };

      this.logger.debug(
        {
          metric: "falkordb.traverse_ms",
          value: durationMs,
          nodesCount: nodes.length,
          relationshipsCount: rels.length,
        },
        "Traversal complete"
      );

      return traverseResult;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      this.logger.error(
        {
          metric: "falkordb.traverse_ms",
          value: durationMs,
          startNode,
          err: error,
        },
        "Traversal failed"
      );

      if (error instanceof GraphError) {
        throw error;
      }
      throw mapGraphError(error instanceof Error ? error : new Error(String(error)), "falkordb");
    }
  }

  /**
   * Analyze dependencies for a target entity
   *
   * @param input - Dependency analysis parameters
   * @returns Dependency analysis results
   */
  async analyzeDependencies(input: GraphDependenciesInput): Promise<GraphDependenciesResult> {
    this.ensureConnected();

    const startTime = Date.now();

    const { target, direction, transitive = false, maxDepth = 3 } = input;
    const depthLimit = Math.min(maxDepth, 5);

    try {
      // Build target node match
      let targetMatch: string;
      switch (target.type) {
        case "file":
          targetMatch = `(target:File {path: ${this.serializeValue(target.identifier)}, repository: ${this.serializeValue(target.repository)}})`;
          break;
        case "function":
          targetMatch = `(target:Function {name: ${this.serializeValue(target.identifier)}, repository: ${this.serializeValue(target.repository)}})`;
          break;
        case "class":
          targetMatch = `(target:Class {name: ${this.serializeValue(target.identifier)}, repository: ${this.serializeValue(target.repository)}})`;
          break;
        default:
          targetMatch = `(target {id: ${this.serializeValue(target.identifier)}})`;
      }

      // Build direction-specific queries
      let directQuery: string;
      let transitiveQuery: string | null = null;

      switch (direction) {
        case "dependsOn":
          directQuery = `
            MATCH ${targetMatch}
            OPTIONAL MATCH (target)-[r:IMPORTS|CALLS|REFERENCES]->(dep)
            RETURN dep, type(r) as relType, 1 as depth
          `;
          if (transitive) {
            transitiveQuery = `
              MATCH ${targetMatch}
              OPTIONAL MATCH path = (target)-[:IMPORTS|CALLS|REFERENCES*2..${depthLimit}]->(dep)
              WHERE dep <> target
              RETURN dep, 'TRANSITIVE' as relType, length(path) as depth
            `;
          }
          break;
        case "dependedOnBy":
          directQuery = `
            MATCH ${targetMatch}
            OPTIONAL MATCH (dep)-[r:IMPORTS|CALLS|REFERENCES]->(target)
            RETURN dep, type(r) as relType, 1 as depth
          `;
          if (transitive) {
            transitiveQuery = `
              MATCH ${targetMatch}
              OPTIONAL MATCH path = (dep)-[:IMPORTS|CALLS|REFERENCES*2..${depthLimit}]->(target)
              WHERE dep <> target
              RETURN dep, 'TRANSITIVE' as relType, length(path) as depth
            `;
          }
          break;
        case "both":
          directQuery = `
            MATCH ${targetMatch}
            OPTIONAL MATCH (target)-[r1:IMPORTS|CALLS|REFERENCES]->(depOut)
            OPTIONAL MATCH (depIn)-[r2:IMPORTS|CALLS|REFERENCES]->(target)
            WITH target, collect({dep: depOut, relType: type(r1), dir: 'out'}) + collect({dep: depIn, relType: type(r2), dir: 'in'}) as deps
            UNWIND deps as d
            RETURN d.dep as dep, d.relType as relType, 1 as depth
          `;
          break;
      }

      // Execute direct dependencies query
      const directResult = await this.withRetryWrapper(
        () => this.graph!.query<unknown[]>(directQuery),
        "analyzeDependencies (direct)"
      );

      const directRecords = this.convertFalkorResult<{
        dep: Record<string, unknown> | null;
        relType: string;
        depth: number;
      }>(directResult);

      const directDeps: DependencyInfo[] = [];
      const seenDeps = new Set<string>();

      for (const record of directRecords) {
        if (record.dep) {
          const depId = String(record.dep["id"]);

          if (!seenDeps.has(depId)) {
            seenDeps.add(depId);
            directDeps.push({
              type: this.getNodeType((record.dep["labels"] as string[] | undefined) ?? []),
              identifier: this.getNodeIdentifier(record.dep),
              repository: (record.dep["repository"] as string | undefined) ?? target.repository,
              relationshipType: record.relType as RelationshipType,
              depth: 1,
            });
          }
        }
      }

      // Execute transitive dependencies query if requested
      let transitiveDeps: DependencyInfo[] | undefined;
      if (transitiveQuery) {
        const transitiveResult = await this.withRetryWrapper(
          () => this.graph!.query<unknown[]>(transitiveQuery),
          "analyzeDependencies (transitive)"
        );

        const transitiveRecords = this.convertFalkorResult<{
          dep: Record<string, unknown> | null;
          relType: string;
          depth: number;
        }>(transitiveResult);

        transitiveDeps = [];
        for (const record of transitiveRecords) {
          if (record.dep) {
            const depId = String(record.dep["id"]);

            if (!seenDeps.has(depId)) {
              seenDeps.add(depId);
              transitiveDeps.push({
                type: this.getNodeType((record.dep["labels"] as string[] | undefined) ?? []),
                identifier: this.getNodeIdentifier(record.dep),
                repository: (record.dep["repository"] as string | undefined) ?? target.repository,
                relationshipType: "REFERENCES" as RelationshipType, // Transitive
                depth: record.depth,
              });
            }
          }
        }
      }

      // Calculate impact score
      const totalDeps = directDeps.length + (transitiveDeps?.length ?? 0);
      const impactScore = Math.min(1, totalDeps / FalkorDBAdapter.IMPACT_SCORE_NORMALIZATION);

      const durationMs = Date.now() - startTime;
      const result: GraphDependenciesResult = {
        direct: directDeps,
        transitive: transitiveDeps,
        impactScore,
        metadata: {
          directCount: directDeps.length,
          transitiveCount: transitiveDeps?.length ?? 0,
          queryTimeMs: durationMs,
        },
      };

      this.logger.debug(
        {
          metric: "falkordb.analyze_dependencies_ms",
          value: durationMs,
          directCount: directDeps.length,
          transitiveCount: transitiveDeps?.length ?? 0,
        },
        "Dependency analysis complete"
      );

      return result;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      this.logger.error(
        {
          metric: "falkordb.analyze_dependencies_ms",
          value: durationMs,
          target,
          err: error,
        },
        "Dependency analysis failed"
      );

      if (error instanceof GraphError) {
        throw error;
      }
      throw mapGraphError(error instanceof Error ? error : new Error(String(error)), "falkordb");
    }
  }

  /**
   * Build a simple context query for a specific context type.
   *
   * FalkorDB may have limited CALL subquery support, so we use simpler
   * UNION ALL patterns for seed type handling.
   *
   * @param ctxType - The context type to query for
   * @param seedType - The seed type to match
   * @param seedIdentifier - The seed identifier
   * @param seedRepository - Optional repository filter
   * @returns Object containing the Cypher query and reason description
   */
  private buildContextQuery(
    ctxType: ContextType,
    seedType: string,
    seedIdentifier: string,
    seedRepository: string | null
  ): { cypher: string; reason: string } {
    // Build seed match based on type
    let seedMatch: string;
    const repoFilter = seedRepository
      ? ` AND n.repository = ${this.serializeValue(seedRepository)}`
      : "";

    switch (seedType) {
      case "file":
        seedMatch = `MATCH (n:File {path: ${this.serializeValue(seedIdentifier)}}) WHERE true ${repoFilter}`;
        break;
      case "chunk":
        seedMatch = `MATCH (n:Chunk {chromaId: ${this.serializeValue(seedIdentifier)}}) WHERE true ${repoFilter}`;
        break;
      case "function":
        seedMatch = `MATCH (n:Function {name: ${this.serializeValue(seedIdentifier)}}) WHERE true ${repoFilter}`;
        break;
      default:
        seedMatch = `MATCH (n {id: ${this.serializeValue(seedIdentifier)}}) WHERE true ${repoFilter}`;
    }

    switch (ctxType) {
      case "imports":
        return {
          cypher: `
            ${seedMatch}
            OPTIONAL MATCH (n)-[:IMPORTS]->(imported)
            RETURN imported as context, 'imports' as reason
          `,
          reason: "imported by seed",
        };
      case "callers":
        return {
          cypher: `
            ${seedMatch}
            OPTIONAL MATCH (caller)-[:CALLS]->(n)
            RETURN caller as context, 'callers' as reason
          `,
          reason: "calls seed",
        };
      case "callees":
        return {
          cypher: `
            ${seedMatch}
            OPTIONAL MATCH (n)-[:CALLS]->(callee)
            RETURN callee as context, 'callees' as reason
          `,
          reason: "called by seed",
        };
      case "siblings":
        return {
          cypher: `
            ${seedMatch}
            OPTIONAL MATCH (parent)-[:CONTAINS|DEFINES]->(n)
            OPTIONAL MATCH (parent)-[:CONTAINS|DEFINES]->(sibling)
            WHERE sibling <> n
            RETURN sibling as context, 'siblings' as reason
          `,
          reason: "sibling of seed",
        };
      case "documentation":
        return {
          cypher: `
            ${seedMatch}
            OPTIONAL MATCH (n)-[:REFERENCES]->(doc)
            WHERE doc:File AND doc.extension IN ['md', 'txt', 'rst']
            RETURN doc as context, 'documentation' as reason
          `,
          reason: "documentation for seed",
        };
      default: {
        // TypeScript exhaustiveness check
        const _exhaustiveCheck: never = ctxType;
        this.logger.error({ ctxType: _exhaustiveCheck }, "Unknown context type encountered");
        return { cypher: "", reason: "" };
      }
    }
  }

  /**
   * Get related context for RAG enhancement
   *
   * Unlike Neo4j implementation, this uses separate queries per seed due to
   * potential CALL subquery limitations in FalkorDB.
   *
   * @param input - Context expansion parameters
   * @returns Context items for RAG
   */
  async getContext(input: GraphContextInput): Promise<GraphContextResult> {
    this.ensureConnected();

    const startTime = Date.now();

    const { seeds, includeContext, limit = 20 } = input;
    const maxLimit = Math.min(limit, 100);

    try {
      const contextItems: ContextItem[] = [];
      const seenItems = new Set<string>();

      // Process each seed and context type combination
      for (const seed of seeds) {
        const seedType =
          seed.type === "file" || seed.type === "chunk" || seed.type === "function"
            ? seed.type
            : "default";

        for (const ctxType of includeContext) {
          if (contextItems.length >= maxLimit) {
            break;
          }

          const { cypher, reason } = this.buildContextQuery(
            ctxType,
            seedType,
            seed.identifier,
            seed.repository ?? null
          );

          if (!cypher) {
            continue;
          }

          const result = await this.withRetryWrapper(
            () => this.graph!.query<unknown[]>(cypher),
            "getContext"
          );

          const records = this.convertFalkorResult<{
            context: Record<string, unknown> | null;
            reason: string;
          }>(result);

          for (const record of records) {
            if (record.context && contextItems.length < maxLimit) {
              const itemId = String(record.context["id"]);

              if (!seenItems.has(itemId)) {
                seenItems.add(itemId);
                contextItems.push({
                  type: (record.context["labels"] as string[] | undefined)?.[0] ?? "Unknown",
                  path:
                    (record.context["path"] as string | undefined) ??
                    (record.context["name"] as string | undefined) ??
                    itemId,
                  repository:
                    (record.context["repository"] as string | undefined) ?? seed.repository ?? "",
                  relevance: 0.8, // Fixed relevance for direct connections
                  reason,
                });
              }
            }
          }
        }
      }

      const durationMs = Date.now() - startTime;
      const result: GraphContextResult = {
        context: contextItems.slice(0, maxLimit),
        metadata: {
          seedsProcessed: seeds.length,
          contextItemsFound: contextItems.length,
          queryTimeMs: durationMs,
        },
      };

      this.logger.debug(
        {
          metric: "falkordb.get_context_ms",
          value: durationMs,
          seedsProcessed: seeds.length,
          contextItemsFound: contextItems.length,
        },
        "Context retrieval complete"
      );

      return result;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      this.logger.error(
        {
          metric: "falkordb.get_context_ms",
          value: durationMs,
          seeds,
          err: error,
        },
        "Context retrieval failed"
      );

      if (error instanceof GraphError) {
        throw error;
      }
      throw mapGraphError(error instanceof Error ? error : new Error(String(error)), "falkordb");
    }
  }

  /**
   * Get node type from labels
   */
  private getNodeType(labels: string[]): "file" | "function" | "class" | "module" {
    const label = labels[0]?.toLowerCase();
    switch (label) {
      case "file":
        return "file";
      case "function":
        return "function";
      case "class":
        return "class";
      case "module":
        return "module";
      default:
        return "file";
    }
  }

  /**
   * Get node identifier from converted node
   */
  private getNodeIdentifier(node: Record<string, unknown>): string {
    return (
      (node["path"] as string | undefined) ??
      (node["name"] as string | undefined) ??
      (node["chromaId"] as string | undefined) ??
      (node["id"] as string | undefined) ??
      ""
    );
  }
}

// =============================================================================
// Internal Types
// =============================================================================

/**
 * FalkorDB Node structure
 */
interface FalkorNode {
  id: number | string;
  labels: string[];
  properties: Record<string, unknown>;
}

/**
 * FalkorDB Relationship structure
 */
interface FalkorRelationship {
  id: number | string;
  type: string;
  properties: Record<string, unknown>;
  src_node?: number | string;
  dest_node?: number | string;
  sourceNode?: number | string;
  destNode?: number | string;
}
