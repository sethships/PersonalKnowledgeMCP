/**
 * GraphIngestionService - Orchestrates entity and relationship storage in Neo4j.
 *
 * Coordinates the complete pipeline from extracting entities/relationships
 * to storing them in the Neo4j graph database. Provides batch operations,
 * progress reporting, and transactional file processing.
 *
 * @module graph/ingestion/GraphIngestionService
 */

import type { Logger } from "pino";
import { getComponentLogger } from "../../logging/index.js";
import type { Neo4jStorageClient } from "../types.js";
import { EntityExtractor } from "../extraction/EntityExtractor.js";
import { RelationshipExtractor } from "../extraction/RelationshipExtractor.js";
import type { CodeEntity, ParameterInfo } from "../parsing/types.js";
import type {
  ImportRelationship,
  ExtractionResult,
  RelationshipExtractionResult,
} from "../extraction/types.js";
import type {
  GraphIngestionConfig,
  GraphIngestionOptions,
  GraphIngestionProgress,
  GraphIngestionResult,
  GraphIngestionStats,
  GraphIngestionError,
  FileInput,
  FileIngestionResult,
  GraphIngestionServiceStatus,
  GraphIngestionPhase,
  GraphFileDeletionResult,
} from "./types.js";
import { DEFAULT_GRAPH_INGESTION_CONFIG } from "./types.js";
import {
  GraphIngestionError as GraphIngestionErrorClass,
  IngestionInProgressError,
  RepositoryExistsError,
  IngestionExtractionError,
  toGraphIngestionError,
} from "./errors.js";

/**
 * Service for orchestrating graph ingestion operations.
 *
 * Coordinates the complete ingestion pipeline:
 * 1. Extract entities from files (functions, classes, etc.)
 * 2. Extract relationships from files (imports, exports)
 * 3. Create Repository node
 * 4. Create File nodes with CONTAINS relationships
 * 5. Create Function/Class nodes with DEFINES relationships
 * 6. Create Module nodes with IMPORTS relationships
 *
 * Features:
 * - Progress reporting via callbacks
 * - Graceful error handling with partial success
 * - Concurrency control (single ingestion operation at a time)
 * - Batch processing for efficient database operations
 * - Transactional file processing
 * - Re-ingestion support with force flag
 *
 * @example
 * ```typescript
 * const service = new GraphIngestionService(
 *   neo4jClient,
 *   entityExtractor,
 *   relationshipExtractor
 * );
 *
 * const result = await service.ingestFiles(files, {
 *   repository: "my-repo",
 *   repositoryUrl: "https://github.com/user/my-repo.git",
 *   onProgress: (progress) => console.log(`${progress.phase}: ${progress.percentage}%`),
 * });
 *
 * console.log(`Created ${result.stats.nodesCreated} nodes`);
 * ```
 */
export class GraphIngestionService {
  private _logger: Logger | null = null;
  private _isIngesting: boolean = false;
  private _currentOperation: GraphIngestionServiceStatus["currentOperation"] = null;
  private readonly config: Required<GraphIngestionConfig>;

  constructor(
    private readonly neo4jClient: Neo4jStorageClient,
    private readonly entityExtractor: EntityExtractor,
    private readonly relationshipExtractor: RelationshipExtractor,
    config?: GraphIngestionConfig
  ) {
    this.config = {
      ...DEFAULT_GRAPH_INGESTION_CONFIG,
      ...config,
    };
  }

  /**
   * Get logger instance (lazy initialization).
   */
  private get logger(): Logger {
    if (!this._logger) {
      this._logger = getComponentLogger("graph:ingestion");
    }
    return this._logger;
  }

  /**
   * Validate repository name format.
   *
   * Repository names are used directly in node IDs, so they must
   * follow a safe pattern to avoid malformed IDs or query issues.
   *
   * @param repositoryName - Repository name to validate
   * @throws {GraphIngestionErrorClass} If repository name is invalid
   *
   * @example
   * ```typescript
   * this.validateRepositoryName("my-repo");      // OK
   * this.validateRepositoryName("my_repo.v2");   // OK
   * this.validateRepositoryName("");             // Throws
   * this.validateRepositoryName("repo:invalid"); // Throws
   * ```
   */
  private validateRepositoryName(repositoryName: string): void {
    if (!repositoryName || repositoryName.trim().length === 0) {
      throw new GraphIngestionErrorClass("Repository name cannot be empty", "fatal_error", {
        retryable: false,
      });
    }
    // Allow alphanumeric, hyphens, underscores, dots (common in Git repos)
    const validPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
    if (!validPattern.test(repositoryName)) {
      throw new GraphIngestionErrorClass(
        `Invalid repository name: "${repositoryName}". Must start with alphanumeric and contain only letters, numbers, dots, hyphens, or underscores.`,
        "fatal_error",
        { retryable: false }
      );
    }
    if (repositoryName.length > 255) {
      throw new GraphIngestionErrorClass(
        "Repository name exceeds maximum length of 255 characters",
        "fatal_error",
        { retryable: false }
      );
    }
  }

  /**
   * Get current operational status of the service.
   *
   * @returns Current status including whether ingestion is in progress
   */
  getStatus(): GraphIngestionServiceStatus {
    return {
      isIngesting: this._isIngesting,
      currentOperation: this._currentOperation,
    };
  }

  /**
   * Ingest files into the Neo4j graph database.
   *
   * Performs the complete ingestion workflow:
   * 1. Check for existing repository data
   * 2. Extract entities from all files
   * 3. Extract relationships from all files
   * 4. Create Repository node
   * 5. Create File nodes in batches
   * 6. Create entity nodes (Function, Class) in batches
   * 7. Create Module nodes for imports
   * 8. Create relationships in batches
   *
   * @param files - Array of files to ingest
   * @param options - Ingestion options including repository info and callbacks
   * @returns GraphIngestionResult with status, stats, and any errors
   *
   * @throws {GraphIngestionErrorClass} If repository name is invalid
   * @throws {IngestionInProgressError} If another ingestion is in progress
   * @throws {RepositoryExistsError} If repository exists and force is false
   *
   * @example
   * ```typescript
   * const files = [
   *   { path: "src/index.ts", content: "export const main = () => {}" },
   *   { path: "src/utils.ts", content: "export function helper() {}" },
   * ];
   *
   * const result = await service.ingestFiles(files, {
   *   repository: "my-project",
   *   repositoryUrl: "https://github.com/user/my-project.git",
   *   force: true,
   * });
   * ```
   */
  async ingestFiles(
    files: FileInput[],
    options: GraphIngestionOptions
  ): Promise<GraphIngestionResult> {
    const startTime = performance.now();
    const errors: GraphIngestionError[] = [];
    const stats: GraphIngestionStats = {
      filesProcessed: 0,
      filesFailed: 0,
      nodesCreated: 0,
      relationshipsCreated: 0,
      durationMs: 0,
      nodesByType: {
        repository: 0,
        file: 0,
        function: 0,
        class: 0,
        module: 0,
      },
      relationshipsByType: {
        contains: 0,
        defines: 0,
        imports: 0,
      },
    };

    // Validate repository name before processing
    this.validateRepositoryName(options.repository);

    // Check if already ingesting
    if (this._isIngesting && this._currentOperation) {
      throw new IngestionInProgressError(this._currentOperation.repository);
    }

    this._isIngesting = true;
    this._currentOperation = {
      repository: options.repository,
      phase: "initializing",
      startedAt: new Date(),
      progress: this.createProgress("initializing", options.repository, 0, {}),
    };

    try {
      this.logger.info(
        { repository: options.repository, fileCount: files.length },
        "Starting graph ingestion"
      );

      // Check if repository already exists
      const repoExists = await this.checkRepositoryExists(options.repository);
      if (repoExists && !options.force) {
        throw new RepositoryExistsError(options.repository);
      }

      // Delete existing data if force re-indexing
      if (repoExists && options.force) {
        this.reportProgress(options, "initializing", 5, {});
        await this.deleteRepositoryData(options.repository);
      }

      // Phase 1: Extract entities from all files
      this.reportProgress(options, "extracting_entities", 10, { totalFiles: files.length });
      const entityResults = await this.extractAllEntities(files, errors);

      // Phase 2: Extract relationships from all files
      this.reportProgress(options, "extracting_relationships", 20, {
        totalFiles: files.length,
        entitiesExtracted: this.countTotalEntities(entityResults),
      });
      const relationshipResults = await this.extractAllRelationships(files, errors);

      // Phase 3: Create Repository node
      this.reportProgress(options, "creating_repository_node", 25, {});
      await this.createRepositoryNode(options.repository, options.repositoryUrl);
      stats.nodesCreated++;
      stats.nodesByType!.repository = 1;

      // Phase 4: Create File nodes with CONTAINS relationships
      this.reportProgress(options, "creating_file_nodes", 30, { totalFiles: files.length });
      const fileNodeResult = await this.createFileNodes(files, options.repository, options, errors);
      stats.nodesCreated += fileNodeResult.nodesCreated;
      stats.relationshipsCreated += fileNodeResult.relationshipsCreated;
      stats.nodesByType!.file = fileNodeResult.nodesCreated;
      stats.relationshipsByType!.contains = fileNodeResult.relationshipsCreated;
      stats.filesProcessed = fileNodeResult.nodesCreated;
      stats.filesFailed = files.length - fileNodeResult.nodesCreated;

      // Phase 5: Create entity nodes (Function, Class) with DEFINES relationships
      this.reportProgress(options, "creating_entity_nodes", 50, {
        filesProcessed: stats.filesProcessed,
        totalFiles: files.length,
      });
      const entityNodeResult = await this.createEntityNodes(
        entityResults,
        options.repository,
        options,
        errors
      );
      stats.nodesCreated += entityNodeResult.nodesCreated;
      stats.relationshipsCreated += entityNodeResult.relationshipsCreated;
      stats.nodesByType!.function = entityNodeResult.functionCount ?? 0;
      stats.nodesByType!.class = entityNodeResult.classCount ?? 0;
      stats.relationshipsByType!.defines = entityNodeResult.relationshipsCreated;

      // Phase 6: Create Module nodes with IMPORTS relationships
      this.reportProgress(options, "creating_module_nodes", 70, {
        nodesCreated: stats.nodesCreated,
      });
      const moduleResult = await this.createModuleNodes(
        relationshipResults,
        options.repository,
        options,
        errors
      );
      stats.nodesCreated += moduleResult.nodesCreated;
      stats.relationshipsCreated += moduleResult.relationshipsCreated;
      stats.nodesByType!.module = moduleResult.nodesCreated;
      stats.relationshipsByType!.imports = moduleResult.relationshipsCreated;

      // Phase 7: Verify graph integrity
      this.reportProgress(options, "verifying", 95, {
        nodesCreated: stats.nodesCreated,
        relationshipsCreated: stats.relationshipsCreated,
      });

      // Complete
      stats.durationMs = Math.round(performance.now() - startTime);
      this.reportProgress(options, "completed", 100, {
        filesProcessed: stats.filesProcessed,
        totalFiles: files.length,
        nodesCreated: stats.nodesCreated,
        relationshipsCreated: stats.relationshipsCreated,
      });

      const status = this.determineStatus(errors, stats);

      this.logger.info(
        {
          metric: "graph_ingestion.duration_ms",
          value: stats.durationMs,
          repository: options.repository,
          status,
          nodesCreated: stats.nodesCreated,
          relationshipsCreated: stats.relationshipsCreated,
          errors: errors.length,
        },
        "Graph ingestion completed"
      );

      return {
        status,
        repository: options.repository,
        stats,
        errors,
        completedAt: new Date(),
      };
    } catch (error) {
      stats.durationMs = Math.round(performance.now() - startTime);

      const ingestionError = toGraphIngestionError(error);
      errors.push({
        type: "fatal_error",
        message: ingestionError.message,
        originalError: error,
      });

      this.logger.error(
        {
          metric: "graph_ingestion.duration_ms",
          value: stats.durationMs,
          repository: options.repository,
          error: ingestionError.message,
        },
        "Graph ingestion failed"
      );

      // Re-throw specific errors
      if (error instanceof IngestionInProgressError || error instanceof RepositoryExistsError) {
        throw error;
      }

      return {
        status: "failed",
        repository: options.repository,
        stats,
        errors,
        completedAt: new Date(),
      };
    } finally {
      this._isIngesting = false;
      this._currentOperation = null;
    }
  }

  /**
   * Delete all graph data for a repository.
   *
   * Removes the Repository node and all associated File, Function, Class,
   * Module nodes, and their relationships.
   *
   * @param repositoryName - Name of the repository to delete
   */
  async deleteRepositoryData(repositoryName: string): Promise<void> {
    this.logger.info({ repository: repositoryName }, "Deleting repository graph data");

    const startTime = performance.now();

    // Delete all nodes connected to files in this repository
    // This includes Functions, Classes, and their relationships
    await this.neo4jClient.runQuery(
      `
      MATCH (r:Repository {name: $repositoryName})
      OPTIONAL MATCH (r)-[:CONTAINS]->(f:File)
      OPTIONAL MATCH (f)-[:DEFINES]->(entity)
      OPTIONAL MATCH (f)-[:IMPORTS]->(module:Module)
      OPTIONAL MATCH (f)-[:HAS_CHUNK]->(chunk:Chunk)
      DETACH DELETE entity, module, chunk, f, r
      `,
      { repositoryName }
    );

    const durationMs = Math.round(performance.now() - startTime);
    this.logger.info(
      {
        metric: "graph_ingestion.delete_repository_ms",
        value: durationMs,
        repository: repositoryName,
      },
      "Repository graph data deleted"
    );
  }

  /**
   * Delete graph data for a single file.
   *
   * Removes the File node and all associated entity nodes (Function, Class)
   * and Chunk nodes, along with their relationships. Module nodes are preserved
   * as they may be shared across multiple files.
   *
   * Used for incremental updates when a file is deleted or modified
   * (delete old data before re-ingesting).
   *
   * @param repositoryName - Name of the repository containing the file
   * @param filePath - File path relative to repository root
   * @returns Result containing deletion statistics and success status
   *
   * @example
   * ```typescript
   * const result = await service.deleteFileData("my-repo", "src/utils.ts");
   * if (result.success) {
   *   console.log(`Deleted ${result.nodesDeleted} nodes`);
   * }
   * ```
   */
  async deleteFileData(repositoryName: string, filePath: string): Promise<GraphFileDeletionResult> {
    this.validateRepositoryName(repositoryName);

    // Validate file path
    if (!filePath || filePath.trim().length === 0) {
      throw new GraphIngestionErrorClass("File path cannot be empty", "fatal_error", {
        retryable: false,
      });
    }

    const fileId = this.generateFileNodeId(repositoryName, filePath);
    const startTime = performance.now();

    try {
      // Delete File node, its entities (Functions, Classes), and chunks
      // Module nodes are preserved as they may be shared across files
      // We use a single query to count and delete atomically
      // Note: Query returns empty array when file doesn't exist (MATCH fails),
      // which is handled by the fallback to { nodesDeleted: 0, relsDeleted: 0 }
      const result = await this.neo4jClient.runQuery<{
        nodesDeleted: number;
        relsDeleted: number;
      }>(
        `
        MATCH (f:File {id: $fileId})
        OPTIONAL MATCH (f)-[:DEFINES]->(entity)
        OPTIONAL MATCH (f)-[:HAS_CHUNK]->(chunk:Chunk)
        WITH f, collect(DISTINCT entity) as entities, collect(DISTINCT chunk) as chunks
        WITH f, entities, chunks,
             size([x IN entities WHERE x IS NOT NULL]) + size([x IN chunks WHERE x IS NOT NULL]) + 1 as nodeCount
        // Count relationships before deletion
        OPTIONAL MATCH (f)-[r]-()
        WITH f, entities, chunks, nodeCount, count(r) as relCount
        // Delete entities and chunks (filter nulls)
        FOREACH (e IN [x IN entities WHERE x IS NOT NULL] | DETACH DELETE e)
        FOREACH (c IN [x IN chunks WHERE x IS NOT NULL] | DETACH DELETE c)
        DETACH DELETE f
        RETURN nodeCount as nodesDeleted, relCount as relsDeleted
        `,
        { fileId }
      );

      const durationMs = Math.round(performance.now() - startTime);
      const stats = result[0] ?? { nodesDeleted: 0, relsDeleted: 0 };

      this.logger.debug(
        {
          metric: "graph_ingestion.delete_file_ms",
          value: durationMs,
          repository: repositoryName,
          filePath,
          nodesDeleted: stats.nodesDeleted,
          relationshipsDeleted: stats.relsDeleted,
        },
        "File graph data deleted"
      );

      return {
        nodesDeleted: stats.nodesDeleted,
        relationshipsDeleted: stats.relsDeleted,
        success: true,
      };
    } catch (error) {
      const durationMs = Math.round(performance.now() - startTime);
      this.logger.error(
        {
          metric: "graph_ingestion.delete_file_ms",
          value: durationMs,
          repository: repositoryName,
          filePath,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to delete file graph data"
      );

      return {
        nodesDeleted: 0,
        relationshipsDeleted: 0,
        success: false,
      };
    }
  }

  /**
   * Process a single file and ingest it into the graph.
   *
   * @param file - File to process
   * @param repositoryName - Repository name
   * @returns Result of file ingestion
   */
  async ingestFile(file: FileInput, repositoryName: string): Promise<FileIngestionResult> {
    const errors: GraphIngestionError[] = [];
    let nodesCreated = 0;
    let relationshipsCreated = 0;

    try {
      // Skip unsupported files
      if (!EntityExtractor.isSupported(file.path)) {
        return {
          filePath: file.path,
          success: true,
          nodesCreated: 0,
          relationshipsCreated: 0,
          errors: [],
        };
      }

      // Extract entities
      const entityResult = await this.entityExtractor.extractFromContent(file.content, file.path);

      // Extract relationships
      const relationshipResult = await this.relationshipExtractor.extractFromContent(
        file.content,
        file.path
      );

      // Create File node using runQuery for flexibility
      const fileNodeId = this.generateFileNodeId(repositoryName, file.path);
      await this.neo4jClient.runQuery(
        `
        MERGE (f:File {id: $id})
        SET f.path = $path,
            f.extension = $extension,
            f.hash = $hash,
            f.repository = $repository,
            f.labels = ['File']
        `,
        {
          id: fileNodeId,
          path: file.path,
          extension: this.getExtension(file.path),
          hash: file.hash ?? "",
          repository: repositoryName,
        }
      );
      nodesCreated++;

      // Create CONTAINS relationship from Repository
      const repoNodeId = this.generateRepositoryNodeId(repositoryName);
      await this.neo4jClient.runQuery(
        `
        MATCH (r:Repository {id: $repoId})
        MATCH (f:File {id: $fileId})
        MERGE (r)-[:CONTAINS]->(f)
        `,
        { repoId: repoNodeId, fileId: fileNodeId }
      );
      relationshipsCreated++;

      // Create entity nodes and DEFINES relationships
      for (const entity of entityResult.entities) {
        const entityNodeId = this.generateEntityNodeId(repositoryName, file.path, entity);
        const nodeLabel = this.getEntityNodeType(entity);

        await this.neo4jClient.runQuery(
          `
          MERGE (e:${nodeLabel} {id: $id})
          SET e.name = $name,
              e.filePath = $filePath,
              e.repository = $repository,
              e.startLine = $startLine,
              e.endLine = $endLine,
              e.signature = $signature,
              e.entityType = $entityType
          `,
          {
            id: entityNodeId,
            name: entity.name,
            filePath: file.path,
            repository: repositoryName,
            startLine: entity.lineStart,
            endLine: entity.lineEnd,
            signature: this.buildFunctionSignature(entity),
            entityType: entity.type,
          }
        );
        nodesCreated++;

        await this.neo4jClient.runQuery(
          `
          MATCH (f:File {id: $fileId})
          MATCH (e {id: $entityId})
          MERGE (f)-[r:DEFINES]->(e)
          SET r.startLine = $startLine, r.endLine = $endLine
          `,
          {
            fileId: fileNodeId,
            entityId: entityNodeId,
            startLine: entity.lineStart,
            endLine: entity.lineEnd,
          }
        );
        relationshipsCreated++;
      }

      // Create Module nodes and IMPORTS relationships
      for (const importRel of relationshipResult.imports) {
        const moduleNodeId = this.generateModuleNodeId(importRel);

        await this.neo4jClient.runQuery(
          `
          MERGE (m:Module {id: $id})
          SET m.name = $name,
              m.type = $type
          `,
          {
            id: moduleNodeId,
            name: importRel.targetModule,
            type: importRel.isExternal ? "npm" : "local",
          }
        );
        nodesCreated++;

        await this.neo4jClient.runQuery(
          `
          MATCH (f:File {id: $fileId})
          MATCH (m:Module {id: $moduleId})
          MERGE (f)-[r:IMPORTS]->(m)
          SET r.importType = $importType,
              r.importedSymbols = $importedSymbols
          `,
          {
            fileId: fileNodeId,
            moduleId: moduleNodeId,
            importType: importRel.importInfo.isTypeOnly ? "type" : "value",
            importedSymbols: importRel.importInfo.importedNames,
          }
        );
        relationshipsCreated++;
      }

      return {
        filePath: file.path,
        success: true,
        nodesCreated,
        relationshipsCreated,
        errors,
      };
    } catch (error) {
      const ingestionError = toGraphIngestionError(error, { filePath: file.path });
      errors.push({
        type: "file_error",
        filePath: file.path,
        message: ingestionError.message,
        originalError: error,
      });

      return {
        filePath: file.path,
        success: false,
        nodesCreated,
        relationshipsCreated,
        errors,
      };
    }
  }

  // ==========================================================================
  // Private Helper Methods
  // ==========================================================================

  /**
   * Check if a repository already exists in the graph.
   */
  private async checkRepositoryExists(repositoryName: string): Promise<boolean> {
    const result = await this.neo4jClient.runQuery<{ count: number }>(
      `MATCH (r:Repository {name: $name}) RETURN count(r) as count`,
      { name: repositoryName }
    );
    return result.length > 0 && (result[0]?.count ?? 0) > 0;
  }

  /**
   * Extract entities from all files.
   */
  private async extractAllEntities(
    files: FileInput[],
    errors: GraphIngestionError[]
  ): Promise<Map<string, ExtractionResult>> {
    const results = new Map<string, ExtractionResult>();

    for (const file of files) {
      if (!EntityExtractor.isSupported(file.path)) {
        continue;
      }

      try {
        const result = await this.entityExtractor.extractFromContent(file.content, file.path);
        results.set(file.path, result);

        if (!result.success) {
          for (const parseError of result.errors) {
            errors.push({
              type: "extraction_error",
              filePath: file.path,
              message: parseError.message,
            });
          }
        }
      } catch (error) {
        const extractionError = new IngestionExtractionError(
          error instanceof Error ? error.message : String(error),
          file.path,
          { cause: error instanceof Error ? error : undefined }
        );
        errors.push({
          type: "extraction_error",
          filePath: file.path,
          message: extractionError.message,
          originalError: error,
        });
      }
    }

    return results;
  }

  /**
   * Extract relationships from all files.
   */
  private async extractAllRelationships(
    files: FileInput[],
    errors: GraphIngestionError[]
  ): Promise<Map<string, RelationshipExtractionResult>> {
    const results = new Map<string, RelationshipExtractionResult>();

    for (const file of files) {
      if (!RelationshipExtractor.isSupported(file.path)) {
        continue;
      }

      try {
        const result = await this.relationshipExtractor.extractFromContent(file.content, file.path);
        results.set(file.path, result);

        if (!result.success) {
          for (const parseError of result.errors) {
            errors.push({
              type: "extraction_error",
              filePath: file.path,
              message: parseError.message,
            });
          }
        }
      } catch (error) {
        const extractionError = new IngestionExtractionError(
          error instanceof Error ? error.message : String(error),
          file.path,
          { cause: error instanceof Error ? error : undefined }
        );
        errors.push({
          type: "extraction_error",
          filePath: file.path,
          message: extractionError.message,
          originalError: error,
        });
      }
    }

    return results;
  }

  /**
   * Create the Repository node.
   */
  private async createRepositoryNode(repositoryName: string, repositoryUrl: string): Promise<void> {
    const nodeId = this.generateRepositoryNodeId(repositoryName);
    await this.neo4jClient.runQuery(
      `
      MERGE (r:Repository {id: $id})
      SET r.name = $name,
          r.url = $url,
          r.lastIndexed = $lastIndexed,
          r.status = $status
      `,
      {
        id: nodeId,
        name: repositoryName,
        url: repositoryUrl,
        lastIndexed: new Date().toISOString(),
        status: "ready",
      }
    );
  }

  /**
   * Create File nodes with CONTAINS relationships from Repository.
   */
  private async createFileNodes(
    files: FileInput[],
    repositoryName: string,
    options: GraphIngestionOptions,
    errors: GraphIngestionError[]
  ): Promise<{ nodesCreated: number; relationshipsCreated: number }> {
    let nodesCreated = 0;
    let relationshipsCreated = 0;
    const repoNodeId = this.generateRepositoryNodeId(repositoryName);

    // Process in batches
    const batches = this.createBatches(files, this.config.nodeBatchSize);
    let batchIndex = 0;

    for (const batch of batches) {
      batchIndex++;
      const percentage = 30 + Math.round((batchIndex / batches.length) * 15);
      this.reportProgress(options, "creating_file_nodes", percentage, {
        currentBatch: batchIndex,
        totalBatches: batches.length,
        filesProcessed: nodesCreated,
        totalFiles: files.length,
      });

      for (const file of batch) {
        try {
          const fileNodeId = this.generateFileNodeId(repositoryName, file.path);
          await this.neo4jClient.runQuery(
            `
            MERGE (f:File {id: $id})
            SET f.path = $path,
                f.extension = $extension,
                f.hash = $hash,
                f.repository = $repository
            `,
            {
              id: fileNodeId,
              path: file.path,
              extension: this.getExtension(file.path),
              hash: file.hash ?? "",
              repository: repositoryName,
            }
          );
          nodesCreated++;

          await this.neo4jClient.runQuery(
            `
            MATCH (r:Repository {id: $repoId})
            MATCH (f:File {id: $fileId})
            MERGE (r)-[:CONTAINS]->(f)
            `,
            { repoId: repoNodeId, fileId: fileNodeId }
          );
          relationshipsCreated++;
        } catch (error) {
          errors.push({
            type: "node_error",
            filePath: file.path,
            message: `Failed to create File node: ${error instanceof Error ? error.message : String(error)}`,
            originalError: error,
          });
        }
      }
    }

    return { nodesCreated, relationshipsCreated };
  }

  /**
   * Create entity nodes (Function, Class) with DEFINES relationships.
   */
  private async createEntityNodes(
    entityResults: Map<string, ExtractionResult>,
    repositoryName: string,
    options: GraphIngestionOptions,
    errors: GraphIngestionError[]
  ): Promise<{
    nodesCreated: number;
    relationshipsCreated: number;
    functionCount?: number;
    classCount?: number;
  }> {
    let nodesCreated = 0;
    let relationshipsCreated = 0;
    let functionCount = 0;
    let classCount = 0;

    // Collect all entities with their file paths
    const allEntities: Array<{ filePath: string; entity: CodeEntity }> = [];
    for (const [filePath, result] of entityResults) {
      for (const entity of result.entities) {
        allEntities.push({ filePath, entity });
      }
    }

    // Process in batches
    const batches = this.createBatches(allEntities, this.config.nodeBatchSize);
    let batchIndex = 0;

    for (const batch of batches) {
      batchIndex++;
      const percentage = 50 + Math.round((batchIndex / batches.length) * 15);
      this.reportProgress(options, "creating_entity_nodes", percentage, {
        currentBatch: batchIndex,
        totalBatches: batches.length,
        nodesCreated,
      });

      for (const { filePath, entity } of batch) {
        try {
          const entityNodeId = this.generateEntityNodeId(repositoryName, filePath, entity);
          const nodeLabel = this.getEntityNodeType(entity);

          await this.neo4jClient.runQuery(
            `
            MERGE (e:${nodeLabel} {id: $id})
            SET e.name = $name,
                e.filePath = $filePath,
                e.repository = $repository,
                e.startLine = $startLine,
                e.endLine = $endLine,
                e.signature = $signature,
                e.entityType = $entityType
            `,
            {
              id: entityNodeId,
              name: entity.name,
              filePath,
              repository: repositoryName,
              startLine: entity.lineStart,
              endLine: entity.lineEnd,
              signature: this.buildFunctionSignature(entity),
              entityType: entity.type,
            }
          );
          nodesCreated++;

          if (entity.type === "function" || entity.type === "method") {
            functionCount++;
          } else if (
            entity.type === "class" ||
            entity.type === "interface" ||
            entity.type === "enum" ||
            entity.type === "type_alias"
          ) {
            classCount++;
          }

          // Create DEFINES relationship
          const fileNodeId = this.generateFileNodeId(repositoryName, filePath);
          await this.neo4jClient.runQuery(
            `
            MATCH (f:File {id: $fileId})
            MATCH (e {id: $entityId})
            MERGE (f)-[r:DEFINES]->(e)
            SET r.startLine = $startLine, r.endLine = $endLine
            `,
            {
              fileId: fileNodeId,
              entityId: entityNodeId,
              startLine: entity.lineStart,
              endLine: entity.lineEnd,
            }
          );
          relationshipsCreated++;
        } catch (error) {
          errors.push({
            type: "node_error",
            filePath,
            nodeId: entity.name,
            message: `Failed to create entity node: ${error instanceof Error ? error.message : String(error)}`,
            originalError: error,
          });
        }
      }
    }

    return { nodesCreated, relationshipsCreated, functionCount, classCount };
  }

  /**
   * Create Module nodes with IMPORTS relationships.
   */
  private async createModuleNodes(
    relationshipResults: Map<string, RelationshipExtractionResult>,
    repositoryName: string,
    options: GraphIngestionOptions,
    errors: GraphIngestionError[]
  ): Promise<{ nodesCreated: number; relationshipsCreated: number }> {
    let nodesCreated = 0;
    let relationshipsCreated = 0;

    // Track created modules to avoid duplicates
    const createdModules = new Set<string>();

    // Collect all imports with their file paths
    const allImports: Array<{ filePath: string; importRel: ImportRelationship }> = [];
    for (const [filePath, result] of relationshipResults) {
      for (const importRel of result.imports) {
        allImports.push({ filePath, importRel });
      }
    }

    // Process in batches
    const batches = this.createBatches(allImports, this.config.relationshipBatchSize);
    let batchIndex = 0;

    for (const batch of batches) {
      batchIndex++;
      const percentage = 70 + Math.round((batchIndex / batches.length) * 20);
      this.reportProgress(options, "creating_module_nodes", percentage, {
        currentBatch: batchIndex,
        totalBatches: batches.length,
        nodesCreated,
        relationshipsCreated,
      });

      for (const { filePath, importRel } of batch) {
        try {
          const moduleNodeId = this.generateModuleNodeId(importRel);

          // Create module node if not already created
          if (!createdModules.has(moduleNodeId)) {
            await this.neo4jClient.runQuery(
              `
              MERGE (m:Module {id: $id})
              SET m.name = $name,
                  m.type = $type
              `,
              {
                id: moduleNodeId,
                name: importRel.targetModule,
                type: importRel.isExternal ? "npm" : "local",
              }
            );
            createdModules.add(moduleNodeId);
            nodesCreated++;
          }

          // Create IMPORTS relationship
          const fileNodeId = this.generateFileNodeId(repositoryName, filePath);
          await this.neo4jClient.runQuery(
            `
            MATCH (f:File {id: $fileId})
            MATCH (m:Module {id: $moduleId})
            MERGE (f)-[r:IMPORTS]->(m)
            SET r.importType = $importType,
                r.importedSymbols = $importedSymbols
            `,
            {
              fileId: fileNodeId,
              moduleId: moduleNodeId,
              importType: this.getImportType(importRel),
              importedSymbols: importRel.importInfo.importedNames,
            }
          );
          relationshipsCreated++;
        } catch (error) {
          errors.push({
            type: "relationship_error",
            filePath,
            relationshipType: "IMPORTS",
            message: `Failed to create import relationship: ${error instanceof Error ? error.message : String(error)}`,
            originalError: error,
          });
        }
      }
    }

    return { nodesCreated, relationshipsCreated };
  }

  // ==========================================================================
  // Node ID Generation
  // ==========================================================================

  private generateRepositoryNodeId(repositoryName: string): string {
    return `Repository:${repositoryName}`;
  }

  private generateFileNodeId(repositoryName: string, filePath: string): string {
    return `File:${repositoryName}:${filePath}`;
  }

  private generateEntityNodeId(
    repositoryName: string,
    filePath: string,
    entity: CodeEntity
  ): string {
    const nodeType = this.getEntityNodeType(entity);
    return `${nodeType}:${repositoryName}:${filePath}:${entity.name}:${entity.lineStart}`;
  }

  private generateModuleNodeId(importRel: ImportRelationship): string {
    const moduleType = importRel.isExternal ? "npm" : "local";
    return `Module:${moduleType}:${importRel.targetModule}`;
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  private getEntityNodeType(entity: CodeEntity): string {
    switch (entity.type) {
      case "function":
      case "method":
        return "Function";
      case "class":
      case "interface":
      case "enum":
      case "type_alias":
        return "Class";
      case "variable":
      case "property":
        return "Variable";
      default:
        return "Entity";
    }
  }

  private buildFunctionSignature(entity: CodeEntity): string {
    const metadata = entity.metadata;
    const params =
      metadata?.parameters?.map((p: ParameterInfo) => `${p.name}: ${p.type || "any"}`).join(", ") ??
      "";
    const returnType = metadata?.returnType ?? "void";
    const asyncPrefix = metadata?.isAsync ? "async " : "";
    return `${asyncPrefix}${entity.name}(${params}): ${returnType}`;
  }

  private getImportType(importRel: ImportRelationship): string {
    if (importRel.importInfo.isTypeOnly) {
      return "type";
    }
    if (importRel.importInfo.namespaceImport) {
      return "namespace";
    }
    if (importRel.importInfo.defaultImport) {
      return "default";
    }
    if (importRel.importInfo.importedNames.length === 0) {
      return "side-effect";
    }
    return "named";
  }

  private getExtension(filePath: string): string {
    const lastDot = filePath.lastIndexOf(".");
    return lastDot >= 0 ? filePath.substring(lastDot + 1) : "";
  }

  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  private countTotalEntities(entityResults: Map<string, ExtractionResult>): number {
    let count = 0;
    for (const result of entityResults.values()) {
      count += result.entities.length;
    }
    return count;
  }

  private determineStatus(
    errors: GraphIngestionError[],
    stats: GraphIngestionStats
  ): "success" | "partial" | "failed" {
    const hasFatalErrors = errors.some((e) => e.type === "fatal_error");
    if (hasFatalErrors || stats.filesProcessed === 0) {
      return "failed";
    }
    if (errors.length > 0) {
      return "partial";
    }
    return "success";
  }

  private createProgress(
    phase: GraphIngestionPhase,
    repository: string,
    percentage: number,
    details: GraphIngestionProgress["details"]
  ): GraphIngestionProgress {
    return {
      phase,
      repository,
      percentage,
      details,
      timestamp: new Date(),
    };
  }

  private reportProgress(
    options: GraphIngestionOptions,
    phase: GraphIngestionPhase,
    percentage: number,
    details: GraphIngestionProgress["details"]
  ): void {
    const progress = this.createProgress(phase, options.repository, percentage, details);

    if (this._currentOperation) {
      this._currentOperation.phase = phase;
      this._currentOperation.progress = progress;
    }

    if (options.onProgress) {
      options.onProgress(progress);
    }
  }
}
