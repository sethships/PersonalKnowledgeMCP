/**
 * Neo4j Storage Client Implementation
 *
 * This module provides the concrete implementation of the Neo4jStorageClient interface,
 * handling all interactions with the Neo4j graph database including connection
 * management, node/relationship operations, and graph traversals.
 *
 * Features:
 * - Connection pooling with neo4j-driver (default: 50 connections)
 * - Automatic retry with exponential backoff for transient failures
 * - Proper session lifecycle management
 * - Comprehensive error handling with typed error classes
 *
 * @module graph/Neo4jClient
 */

import neo4j, {
  type Driver,
  type Session,
  type Record as Neo4jRecord,
  type Node as Neo4jNode,
  type Relationship as Neo4jRelationship,
} from "neo4j-driver";
import type {
  Neo4jConfig,
  Neo4jStorageClient,
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
} from "./types.js";
import {
  GraphError,
  GraphConnectionError,
  NodeNotFoundError,
  isRetryableGraphError,
  mapNeo4jError,
} from "./errors.js";
import { getComponentLogger } from "../logging/index.js";
import {
  withRetry,
  createRetryOptions,
  createRetryLogger,
  DEFAULT_RETRY_CONFIG,
  type RetryConfig,
} from "../utils/retry.js";

/**
 * Implementation of the Neo4jStorageClient interface
 *
 * Provides a high-level abstraction over the Neo4j JavaScript driver with:
 * - Connection pooling and lifecycle management
 * - Automatic session handling
 * - Retry logic for transient failures
 * - Comprehensive error handling
 *
 * @example
 * ```typescript
 * const config: Neo4jConfig = {
 *   host: "localhost",
 *   port: 7687,
 *   username: "neo4j",
 *   password: process.env.NEO4J_PASSWORD!,
 * };
 *
 * const client = new Neo4jStorageClientImpl(config);
 * await client.connect();
 *
 * // Execute queries
 * const results = await client.runQuery<{ name: string }>(
 *   "MATCH (n:Repository) RETURN n.name as name"
 * );
 *
 * // Clean up
 * await client.disconnect();
 * ```
 */
export class Neo4jStorageClientImpl implements Neo4jStorageClient {
  private driver: Driver | null = null;
  /** Normalization factor for impact score calculation (higher = lower score per dependency) */
  private static readonly IMPACT_SCORE_NORMALIZATION = 100;
  private config: Neo4jConfig;
  private retryConfig: RetryConfig;
  private logger = getComponentLogger("graph:neo4j");

  /**
   * Create a new Neo4j storage client
   *
   * @param config - Connection configuration including retry settings
   */
  constructor(config: Neo4jConfig) {
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
   * Ensure the driver is connected before operations
   *
   * @throws {GraphConnectionError} If not connected
   */
  private ensureConnected(): void {
    if (!this.driver) {
      throw new GraphConnectionError("Not connected to Neo4j. Call connect() first.");
    }
  }

  /**
   * Create a new session for database operations
   *
   * @returns A new Neo4j session
   */
  private createSession(): Session {
    this.ensureConnected();
    return this.driver!.session();
  }

  /**
   * Initialize connection to Neo4j server
   *
   * Creates the driver with connection pooling configuration.
   * Uses retry logic with exponential backoff for transient connection failures.
   *
   * @throws {GraphConnectionError} If connection initialization fails after all retries
   */
  async connect(): Promise<void> {
    const startTime = Date.now();
    this.logger.info({ host: this.config.host, port: this.config.port }, "Connecting to Neo4j");

    try {
      const uri = `bolt://${this.config.host}:${this.config.port}`;
      const auth = neo4j.auth.basic(this.config.username, this.config.password);

      this.driver = neo4j.driver(uri, auth, {
        maxConnectionPoolSize: this.config.maxConnectionPoolSize ?? 50,
        connectionAcquisitionTimeout: this.config.connectionAcquisitionTimeout ?? 30000,
        maxTransactionRetryTime: 30000,
      });

      // Verify connection with retry
      await this.withRetryWrapper(async () => {
        const healthy = await this.performHealthCheck();
        if (!healthy) {
          throw new GraphConnectionError("Neo4j health check failed - server not responding");
        }
      }, "Neo4j connection");

      const durationMs = Date.now() - startTime;
      this.logger.info(
        {
          metric: "neo4j.connection_ms",
          value: durationMs,
          host: this.config.host,
          port: this.config.port,
        },
        "Connected to Neo4j"
      );
    } catch (error) {
      const durationMs = Date.now() - startTime;
      this.logger.error(
        {
          metric: "neo4j.connection_ms",
          value: durationMs,
          host: this.config.host,
          port: this.config.port,
          err: error,
        },
        "Failed to connect to Neo4j"
      );

      // Clean up partial connection
      if (this.driver) {
        await this.driver.close().catch(() => {});
        this.driver = null;
      }

      if (error instanceof GraphError) {
        throw error;
      }
      throw new GraphConnectionError(
        `Failed to connect to Neo4j at ${this.config.host}:${this.config.port}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Disconnect from Neo4j server
   *
   * Closes the driver and releases all connections in the pool.
   */
  async disconnect(): Promise<void> {
    if (this.driver) {
      const startTime = Date.now();
      this.logger.info("Disconnecting from Neo4j");

      try {
        await this.driver.close();
        this.driver = null;

        const durationMs = Date.now() - startTime;
        this.logger.info(
          { metric: "neo4j.disconnect_ms", value: durationMs },
          "Disconnected from Neo4j"
        );
      } catch (error) {
        this.logger.error({ err: error }, "Error during Neo4j disconnect");
        this.driver = null;
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
    if (!this.driver) {
      return false;
    }

    try {
      const serverInfo = await this.driver.getServerInfo();
      return serverInfo !== undefined;
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
    if (!this.driver) {
      this.logger.warn("Health check: Driver not connected");
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
   * Convert Neo4j Integer to JavaScript number
   *
   * @param value - Neo4j Integer or primitive
   * @returns JavaScript number or the original value
   */
  private toNumber(value: unknown): unknown {
    if (neo4j.isInt(value)) {
      return value.toNumber();
    }
    return value;
  }

  /**
   * Validate and sanitize a Neo4j label
   *
   * Labels must match Neo4j naming rules: start with letter, contain only
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
    // Validate that the type matches Neo4j naming rules (same as labels)
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(type)) {
      throw new GraphError(`Invalid relationship type: ${type}`);
    }
  }

  /**
   * Convert Neo4j record to a plain JavaScript object
   *
   * @param record - Neo4j record from query result
   * @returns Plain object with converted values
   */
  private mapRecordToObject<T>(record: Neo4jRecord): T {
    const obj: Record<string, unknown> = {};
    record.keys.forEach((key) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const value = record.get(key);
      obj[key as string] = this.convertNeo4jValue(value);
    });
    return obj as T;
  }

  /**
   * Convert Neo4j values to JavaScript values recursively
   *
   * @param value - Neo4j value (Node, Relationship, Integer, etc.)
   * @returns Converted JavaScript value
   */
  private convertNeo4jValue(value: unknown): unknown {
    if (value === null || value === undefined) {
      return value;
    }

    // Handle Neo4j Integer
    if (neo4j.isInt(value)) {
      return value.toNumber();
    }

    // Handle Neo4j Node
    if (this.isNeo4jNode(value)) {
      return this.convertNode(value);
    }

    // Handle Neo4j Relationship
    if (this.isNeo4jRelationship(value)) {
      return this.convertRelationship(value);
    }

    // Handle arrays
    if (Array.isArray(value)) {
      return value.map((v) => this.convertNeo4jValue(v));
    }

    // Handle plain objects
    if (typeof value === "object") {
      const obj: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        obj[k] = this.convertNeo4jValue(v);
      }
      return obj;
    }

    return value;
  }

  /**
   * Type guard for Neo4j Node
   */
  private isNeo4jNode(value: unknown): value is Neo4jNode {
    return (
      typeof value === "object" &&
      value !== null &&
      "labels" in value &&
      "properties" in value &&
      "identity" in value
    );
  }

  /**
   * Type guard for Neo4j Relationship
   */
  private isNeo4jRelationship(value: unknown): value is Neo4jRelationship {
    return (
      typeof value === "object" &&
      value !== null &&
      "type" in value &&
      "properties" in value &&
      "start" in value &&
      "end" in value
    );
  }

  /**
   * Convert Neo4j Node to plain object
   */
  private convertNode(node: Neo4jNode): Record<string, unknown> {
    const properties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node.properties)) {
      properties[key] = this.convertNeo4jValue(value);
    }
    return {
      id: node.identity.toString(),
      labels: node.labels,
      ...properties,
    };
  }

  /**
   * Convert Neo4j Relationship to plain object
   */
  private convertRelationship(rel: Neo4jRelationship): Record<string, unknown> {
    const properties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rel.properties)) {
      properties[key] = this.convertNeo4jValue(value);
    }
    return {
      id: rel.identity.toString(),
      type: rel.type,
      fromNodeId: rel.start.toString(),
      toNodeId: rel.end.toString(),
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
    const session = this.createSession();

    try {
      const result = await this.withRetryWrapper(
        () => session.run(cypher, params ?? {}),
        "Cypher query"
      );

      const records = result.records.map((r) => this.mapRecordToObject<T>(r));

      const durationMs = Date.now() - startTime;
      this.logger.debug(
        {
          metric: "neo4j.query_ms",
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
          metric: "neo4j.query_ms",
          value: durationMs,
          err: error,
          cypher: cypher.substring(0, 200),
        },
        "Query failed"
      );

      if (error instanceof GraphError) {
        throw error;
      }
      throw mapNeo4jError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      await session.close();
    }
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
   * @param paramPrefix - Parameter prefix for the query
   * @returns Object with SET clause and parameters
   */
  private buildNodeSetClause(
    node: Omit<GraphNode, "id"> & { id?: string },
    paramPrefix: string = "prop"
  ): { setClause: string; params: Record<string, unknown> } {
    const params: Record<string, unknown> = {};
    const setParts: string[] = [];

    // Get properties excluding 'id' and 'labels'
    const properties = Object.entries(node).filter(([key]) => key !== "id" && key !== "labels");

    properties.forEach(([key, value], index) => {
      const paramName = `${paramPrefix}_${index}`;
      params[paramName] = value;
      setParts.push(`n.${key} = $${paramName}`);
    });

    return {
      setClause: setParts.length > 0 ? `SET ${setParts.join(", ")}` : "",
      params,
    };
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
    const session = this.createSession();
    const nodeId = this.generateNodeId(node);
    // Validate each label to prevent Cypher injection
    const validatedLabels = node.labels.map((label) => this.validateLabel(label));
    const labels = validatedLabels.join(":");

    try {
      const { setClause, params } = this.buildNodeSetClause(node);

      const cypher = `
        MERGE (n:${labels} {id: $nodeId})
        ${setClause}
        RETURN n
      `;

      const result = await this.withRetryWrapper(
        () => session.run(cypher, { nodeId, ...params }),
        "upsertNode"
      );

      if (result.records.length === 0) {
        throw new GraphError("Failed to upsert node - no result returned");
      }

      const record = result.records[0];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const neo4jNode = record?.get("n");

      if (!neo4jNode) {
        throw new GraphError("Failed to upsert node - invalid result");
      }

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      const resultNode = this.convertNode(neo4jNode) as N;

      const durationMs = Date.now() - startTime;
      this.logger.debug(
        {
          metric: "neo4j.upsert_node_ms",
          value: durationMs,
          nodeId,
          labels,
        },
        "Node upserted"
      );

      return resultNode;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      this.logger.error(
        {
          metric: "neo4j.upsert_node_ms",
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
      throw mapNeo4jError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      await session.close();
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
    const session = this.createSession();

    try {
      const cypher = `
        MATCH (n {id: $nodeId})
        DETACH DELETE n
        RETURN count(n) as deleted
      `;

      const result = await this.withRetryWrapper(
        () => session.run(cypher, { nodeId }),
        "deleteNode"
      );

      const record = result.records[0];
      const deletedCount = record ? (this.toNumber(record.get("deleted")) as number) : 0;

      const durationMs = Date.now() - startTime;
      this.logger.debug(
        {
          metric: "neo4j.delete_node_ms",
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
          metric: "neo4j.delete_node_ms",
          value: durationMs,
          nodeId,
          err: error,
        },
        "Failed to delete node"
      );

      if (error instanceof GraphError) {
        throw error;
      }
      throw mapNeo4jError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      await session.close();
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
    const session = this.createSession();

    try {
      // Build properties clause
      let propsClause = "";
      const params: Record<string, unknown> = { fromNodeId, toNodeId };

      if (properties && Object.keys(properties).length > 0) {
        const propEntries = Object.entries(properties);
        const propAssignments = propEntries.map(([key, value], idx) => {
          const paramName = `prop_${idx}`;
          params[paramName] = value;
          return `${key}: $${paramName}`;
        });
        propsClause = `{${propAssignments.join(", ")}}`;
      }

      const cypher = `
        MATCH (from {id: $fromNodeId})
        MATCH (to {id: $toNodeId})
        CREATE (from)-[r:${type} ${propsClause}]->(to)
        RETURN r, elementId(r) as relId
      `;

      const result = await this.withRetryWrapper(
        () => session.run(cypher, params),
        "createRelationship"
      );

      if (result.records.length === 0) {
        // Check if nodes exist
        const checkCypher = `
          OPTIONAL MATCH (from {id: $fromNodeId})
          OPTIONAL MATCH (to {id: $toNodeId})
          RETURN from IS NOT NULL as fromExists, to IS NOT NULL as toExists
        `;
        const checkResult = await session.run(checkCypher, { fromNodeId, toNodeId });
        const checkRecord = checkResult.records[0];

        if (checkRecord) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          const fromExists = checkRecord.get("fromExists");
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          const toExists = checkRecord.get("toExists");

          if (!fromExists) {
            throw new NodeNotFoundError(
              fromNodeId,
              undefined,
              `Source node not found: ${fromNodeId}`
            );
          }
          if (!toExists) {
            throw new NodeNotFoundError(toNodeId, undefined, `Target node not found: ${toNodeId}`);
          }
        }

        throw new GraphError("Failed to create relationship - no result returned");
      }

      const record = result.records[0];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const neo4jRel = record?.get("r");
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const relId = record?.get("relId");

      if (!neo4jRel) {
        throw new GraphError("Failed to create relationship - invalid result");
      }

      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const relIdentity = (relId?.toString() ?? neo4jRel.identity.toString()) as string;
      const relationship: Relationship<P> = {
        id: relIdentity,
        type,
        fromNodeId,
        toNodeId,
        properties: (properties ?? {}) as P,
      };

      const durationMs = Date.now() - startTime;
      this.logger.debug(
        {
          metric: "neo4j.create_relationship_ms",
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
          metric: "neo4j.create_relationship_ms",
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
      throw mapNeo4jError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      await session.close();
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
    const session = this.createSession();

    try {
      // Neo4j 5.x uses elementId for relationship IDs
      const cypher = `
        MATCH ()-[r]->()
        WHERE elementId(r) = $relationshipId OR toString(id(r)) = $relationshipId
        DELETE r
        RETURN count(r) as deleted
      `;

      const result = await this.withRetryWrapper(
        () => session.run(cypher, { relationshipId }),
        "deleteRelationship"
      );

      const record = result.records[0];
      const deletedCount = record ? (this.toNumber(record.get("deleted")) as number) : 0;

      const durationMs = Date.now() - startTime;
      this.logger.debug(
        {
          metric: "neo4j.delete_relationship_ms",
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
          metric: "neo4j.delete_relationship_ms",
          value: durationMs,
          relationshipId,
          err: error,
        },
        "Failed to delete relationship"
      );

      if (error instanceof GraphError) {
        throw error;
      }
      throw mapNeo4jError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      await session.close();
    }
  }

  /**
   * Traverse the graph from a starting node
   *
   * @param input - Traversal parameters
   * @returns Traversal results with nodes and relationships
   */
  async traverse(input: GraphTraverseInput): Promise<GraphTraverseResult> {
    this.ensureConnected();

    const startTime = Date.now();
    const session = this.createSession();

    const { startNode, relationships, depth = 2, limit = 100 } = input;
    const maxDepth = Math.min(depth, 5); // Cap at 5 to prevent runaway queries
    const maxLimit = Math.min(limit, 1000); // Cap at 1000 results

    try {
      // Build the relationship pattern
      const relTypes = relationships.join("|");
      const relPattern = relationships.length > 0 ? `:${relTypes}` : "";

      // Build the start node match based on type
      let startMatch: string;
      const params: Record<string, unknown> = {
        identifier: startNode.identifier,
        maxLimit,
      };

      switch (startNode.type) {
        case "file":
          startMatch = "(start:File {path: $identifier})";
          break;
        case "function":
          startMatch = "(start:Function {name: $identifier})";
          break;
        case "class":
          startMatch = "(start:Class {name: $identifier})";
          break;
        case "concept":
          startMatch = "(start:Concept {name: $identifier})";
          break;
        case "chunk":
          startMatch = "(start:Chunk {chromaId: $identifier})";
          break;
        case "module":
          startMatch = "(start:Module {name: $identifier})";
          break;
        default:
          startMatch = "(start {id: $identifier})";
      }

      if (startNode.repository) {
        params["repository"] = startNode.repository;
        startMatch = startMatch.replace(")", ", repository: $repository})");
      }

      const cypher = `
        MATCH ${startMatch}
        CALL apoc.path.subgraphAll(start, {
          relationshipFilter: "${relTypes}",
          maxLevel: ${maxDepth},
          limit: ${maxLimit}
        })
        YIELD nodes, relationships
        RETURN nodes, relationships
      `;

      // Try with APOC first, fall back to basic traversal
      let result;
      try {
        result = await this.withRetryWrapper(() => session.run(cypher, params), "traverse (APOC)");
      } catch (apocError) {
        // Log APOC failure for debugging
        this.logger.debug(
          { err: apocError },
          "APOC not available or failed, falling back to basic traversal"
        );
        // Fall back to basic traversal without APOC
        const fallbackCypher = `
          MATCH ${startMatch}
          OPTIONAL MATCH path = (start)-[${relPattern}*1..${maxDepth}]-(connected)
          WITH start, collect(DISTINCT connected) as connectedNodes, collect(DISTINCT relationships(path)) as allRels
          RETURN start, connectedNodes, allRels
          LIMIT ${maxLimit}
        `;

        result = await this.withRetryWrapper(
          () => session.run(fallbackCypher, params),
          "traverse (fallback)"
        );
      }

      // Process results
      const nodes: GraphTraverseResult["nodes"] = [];
      const rels: GraphTraverseResult["relationships"] = [];
      const seenNodes = new Set<string>();
      const seenRels = new Set<string>();

      for (const record of result.records) {
        const recordKeys = record.keys;

        // Handle APOC result format (nodes, relationships)
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const nodesVal = recordKeys.includes("nodes") ? record.get("nodes") : undefined;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const relsVal = recordKeys.includes("relationships")
          ? record.get("relationships")
          : undefined;

        if (Array.isArray(nodesVal)) {
          for (const node of nodesVal) {
            if (this.isNeo4jNode(node)) {
              const converted = this.convertNode(node);
              const nodeId = converted["id"] as string;
              if (!seenNodes.has(nodeId)) {
                seenNodes.add(nodeId);
                nodes.push({
                  id: nodeId,
                  type: (converted["labels"] as string[])[0] ?? "Unknown",
                  properties: converted,
                });
              }
            }
          }
        }

        if (Array.isArray(relsVal)) {
          for (const rel of relsVal) {
            if (this.isNeo4jRelationship(rel)) {
              const converted = this.convertRelationship(rel);
              const relId = converted["id"] as string;
              if (!seenRels.has(relId)) {
                seenRels.add(relId);
                rels.push({
                  from: converted["fromNodeId"] as string,
                  to: converted["toNodeId"] as string,
                  type: converted["type"] as RelationshipType,
                  properties: converted["properties"] as Record<string, unknown>,
                });
              }
            }
          }
        }

        // Handle fallback result format (start, connectedNodes, allRels)
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const startVal = recordKeys.includes("start") ? record.get("start") : undefined;
        if (this.isNeo4jNode(startVal)) {
          const converted = this.convertNode(startVal);
          const nodeId = converted["id"] as string;
          if (!seenNodes.has(nodeId)) {
            seenNodes.add(nodeId);
            nodes.push({
              id: nodeId,
              type: (converted["labels"] as string[])[0] ?? "Unknown",
              properties: converted,
            });
          }
        }

        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const connectedNodes = recordKeys.includes("connectedNodes")
          ? record.get("connectedNodes")
          : undefined;
        if (Array.isArray(connectedNodes)) {
          for (const node of connectedNodes) {
            if (this.isNeo4jNode(node)) {
              const converted = this.convertNode(node);
              const nodeId = converted["id"] as string;
              if (!seenNodes.has(nodeId)) {
                seenNodes.add(nodeId);
                nodes.push({
                  id: nodeId,
                  type: (converted["labels"] as string[])[0] ?? "Unknown",
                  properties: converted,
                });
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
          metric: "neo4j.traverse_ms",
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
          metric: "neo4j.traverse_ms",
          value: durationMs,
          startNode,
          err: error,
        },
        "Traversal failed"
      );

      if (error instanceof GraphError) {
        throw error;
      }
      throw mapNeo4jError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      await session.close();
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
    const session = this.createSession();

    const { target, direction, transitive = false, maxDepth = 3 } = input;
    const depthLimit = Math.min(maxDepth, 5);

    try {
      const params: Record<string, unknown> = {
        identifier: target.identifier,
        repository: target.repository,
      };

      // Build target node match
      let targetMatch: string;
      switch (target.type) {
        case "file":
          targetMatch = "(target:File {path: $identifier, repository: $repository})";
          break;
        case "function":
          targetMatch = "(target:Function {name: $identifier, repository: $repository})";
          break;
        case "class":
          targetMatch = "(target:Class {name: $identifier, repository: $repository})";
          break;
        default:
          targetMatch = "(target {id: $identifier})";
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
        () => session.run(directQuery, params),
        "analyzeDependencies (direct)"
      );

      const directDeps: DependencyInfo[] = [];
      const seenDeps = new Set<string>();

      for (const record of directResult.records) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const depNode = record.get("dep");
        if (depNode && this.isNeo4jNode(depNode)) {
          const converted = this.convertNode(depNode);
          const depId = converted["id"] as string;

          if (!seenDeps.has(depId)) {
            seenDeps.add(depId);
            directDeps.push({
              type: this.getNodeType(converted["labels"] as string[]),
              identifier: this.getNodeIdentifier(converted),
              repository: (converted["repository"] as string) ?? target.repository,
              relationshipType: record.get("relType") as RelationshipType,
              depth: 1,
            });
          }
        }
      }

      // Execute transitive dependencies query if requested
      let transitiveDeps: DependencyInfo[] | undefined;
      if (transitiveQuery) {
        const transitiveResult = await this.withRetryWrapper(
          () => session.run(transitiveQuery, params),
          "analyzeDependencies (transitive)"
        );

        transitiveDeps = [];
        for (const record of transitiveResult.records) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          const depNode = record.get("dep");
          if (depNode && this.isNeo4jNode(depNode)) {
            const converted = this.convertNode(depNode);
            const depId = converted["id"] as string;

            if (!seenDeps.has(depId)) {
              seenDeps.add(depId);
              transitiveDeps.push({
                type: this.getNodeType(converted["labels"] as string[]),
                identifier: this.getNodeIdentifier(converted),
                repository: (converted["repository"] as string) ?? target.repository,
                relationshipType: "REFERENCES" as RelationshipType, // Transitive
                depth: this.toNumber(record.get("depth")) as number,
              });
            }
          }
        }
      }

      // Calculate impact score
      const totalDeps = directDeps.length + (transitiveDeps?.length ?? 0);
      const impactScore = Math.min(
        1,
        totalDeps / Neo4jStorageClientImpl.IMPACT_SCORE_NORMALIZATION
      );

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
          metric: "neo4j.analyze_dependencies_ms",
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
          metric: "neo4j.analyze_dependencies_ms",
          value: durationMs,
          target,
          err: error,
        },
        "Dependency analysis failed"
      );

      if (error instanceof GraphError) {
        throw error;
      }
      throw mapNeo4jError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      await session.close();
    }
  }

  /**
   * Build a batched Cypher query for a specific context type.
   * Uses UNWIND with CALL subqueries to process all seeds in a single query,
   * reducing N queries to 1 while ensuring Neo4j can use indexes efficiently.
   *
   * Note: CALL {} subquery syntax requires Neo4j 4.1+.
   *
   * @param ctxType - The context type to query for
   * @returns Object containing the Cypher query and reason description
   */
  private buildBatchedContextQuery(ctxType: ContextType): { cypher: string; reason: string } {
    // Use CALL subqueries for each seed type to ensure index usage.
    // This pattern allows Neo4j to use indexes on File.path, Chunk.chromaId,
    // Function.name, and node.id properties instead of doing full scans.
    const seedMatchClause = `
      UNWIND $seeds as seed
      CALL {
        WITH seed
        OPTIONAL MATCH (f:File {path: seed.identifier})
        WHERE seed.type = 'file' AND (seed.repository IS NULL OR f.repository = seed.repository)
        RETURN f as n
        UNION ALL
        WITH seed
        OPTIONAL MATCH (c:Chunk {chromaId: seed.identifier})
        WHERE seed.type = 'chunk' AND (seed.repository IS NULL OR c.repository = seed.repository)
        RETURN c as n
        UNION ALL
        WITH seed
        OPTIONAL MATCH (fn:Function {name: seed.identifier})
        WHERE seed.type = 'function' AND (seed.repository IS NULL OR fn.repository = seed.repository)
        RETURN fn as n
        UNION ALL
        WITH seed
        OPTIONAL MATCH (d {id: seed.identifier})
        WHERE seed.type = 'default' AND (seed.repository IS NULL OR d.repository = seed.repository)
        RETURN d as n
      }
      WITH seed, n WHERE n IS NOT NULL
    `;

    switch (ctxType) {
      case "imports":
        return {
          cypher: `
            ${seedMatchClause}
            OPTIONAL MATCH (n)-[:IMPORTS]->(imported)
            RETURN seed.identifier as seedId, seed.repository as seedRepo, imported as context, 'imports' as reason
          `,
          reason: "imported by seed",
        };
      case "callers":
        return {
          cypher: `
            ${seedMatchClause}
            OPTIONAL MATCH (caller)-[:CALLS]->(n)
            RETURN seed.identifier as seedId, seed.repository as seedRepo, caller as context, 'callers' as reason
          `,
          reason: "calls seed",
        };
      case "callees":
        return {
          cypher: `
            ${seedMatchClause}
            OPTIONAL MATCH (n)-[:CALLS]->(callee)
            RETURN seed.identifier as seedId, seed.repository as seedRepo, callee as context, 'callees' as reason
          `,
          reason: "called by seed",
        };
      case "siblings":
        return {
          cypher: `
            ${seedMatchClause}
            OPTIONAL MATCH (parent)-[:CONTAINS|DEFINES]->(n)
            OPTIONAL MATCH (parent)-[:CONTAINS|DEFINES]->(sibling)
            WHERE sibling <> n
            RETURN seed.identifier as seedId, seed.repository as seedRepo, sibling as context, 'siblings' as reason
          `,
          reason: "sibling of seed",
        };
      case "documentation":
        return {
          cypher: `
            ${seedMatchClause}
            OPTIONAL MATCH (n)-[:REFERENCES]->(doc)
            WHERE doc:File AND doc.extension IN ['md', 'txt', 'rst']
            RETURN seed.identifier as seedId, seed.repository as seedRepo, doc as context, 'documentation' as reason
          `,
          reason: "documentation for seed",
        };
      default: {
        // TypeScript exhaustiveness check - this should never be reached
        const _exhaustiveCheck: never = ctxType;
        this.logger.error({ ctxType: _exhaustiveCheck }, "Unknown context type encountered");
        return { cypher: "", reason: "" };
      }
    }
  }

  /**
   * Get related context for RAG enhancement
   *
   * This method uses batched queries to reduce database round trips.
   * Instead of N seeds × M context types = N×M queries, it executes
   * M queries (one per context type) using UNWIND to process all seeds at once.
   *
   * @param input - Context expansion parameters
   * @returns Context items for RAG
   */
  async getContext(input: GraphContextInput): Promise<GraphContextResult> {
    this.ensureConnected();

    const startTime = Date.now();
    const session = this.createSession();

    const { seeds, includeContext, limit = 20 } = input;
    const maxLimit = Math.min(limit, 100);

    // Prepare seeds array for UNWIND parameter
    // Normalize type to handle default case
    const seedsParam = seeds.map((s) => ({
      type: s.type === "file" || s.type === "chunk" || s.type === "function" ? s.type : "default",
      identifier: s.identifier,
      repository: s.repository ?? null,
    }));

    try {
      const contextItems: ContextItem[] = [];
      const seenItems = new Set<string>();
      let queriesExecuted = 0;

      // Execute one batched query per context type (O(M) instead of O(N×M))
      for (const ctxType of includeContext) {
        const { cypher, reason } = this.buildBatchedContextQuery(ctxType);

        // Skip if no valid query (shouldn't happen with proper types)
        if (!cypher) {
          continue;
        }

        const result = await this.withRetryWrapper(
          () => session.run(cypher, { seeds: seedsParam }),
          "getContext"
        );
        queriesExecuted++;

        for (const record of result.records) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          const ctxNode = record.get("context");
          const seedRepo = record.get("seedRepo") as string | null;

          if (ctxNode && this.isNeo4jNode(ctxNode)) {
            const converted = this.convertNode(ctxNode);
            const itemId = converted["id"] as string;

            if (!seenItems.has(itemId) && contextItems.length < maxLimit) {
              seenItems.add(itemId);
              contextItems.push({
                type: (converted["labels"] as string[])[0] ?? "Unknown",
                path: (converted["path"] as string) ?? (converted["name"] as string) ?? itemId,
                repository: (converted["repository"] as string) ?? seedRepo ?? "",
                relevance: 0.8, // Fixed relevance for direct connections
                reason,
              });
            }
          }
        }

        // Early exit if we've reached the limit
        if (contextItems.length >= maxLimit) {
          break;
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
          metric: "neo4j.get_context_ms",
          value: durationMs,
          seedsProcessed: seeds.length,
          contextItemsFound: contextItems.length,
          queriesExecuted,
          contextTypesRequested: includeContext.length,
        },
        "Context retrieval complete"
      );

      return result;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      this.logger.error(
        {
          metric: "neo4j.get_context_ms",
          value: durationMs,
          seeds,
          err: error,
        },
        "Context retrieval failed"
      );

      if (error instanceof GraphError) {
        throw error;
      }
      throw mapNeo4jError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      await session.close();
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
      (node["path"] as string) ??
      (node["name"] as string) ??
      (node["chromaId"] as string) ??
      (node["id"] as string) ??
      ""
    );
  }
}
