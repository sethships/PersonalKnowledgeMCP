/**
 * Incremental Update Pipeline Service
 *
 * Processes file changes and updates the vector index incrementally without
 * requiring full repository re-indexing. Handles added, modified, deleted,
 * and renamed files with proper chunk management and embedding generation.
 *
 * @module services/incremental-update-pipeline
 */

import { join, resolve } from "node:path";
import ignore from "ignore";
import type { Logger } from "pino";
import type { ChromaStorageClient } from "../storage/index.js";
import type { FileChunker } from "../ingestion/file-chunker.js";
import type { EmbeddingProvider } from "../providers/index.js";
import type { FileInfo, FileChunk } from "../ingestion/types.js";
import type { DocumentInput } from "../storage/index.js";
import type {
  FileChange,
  UpdateOptions,
  UpdateResult,
  UpdateStats,
  FileProcessingError,
  GraphUpdateStats,
} from "./incremental-update-types.js";
import type { GraphIngestionService } from "../graph/ingestion/GraphIngestionService.js";
import { EntityExtractor } from "../graph/extraction/EntityExtractor.js";

/**
 * Pipeline service for processing incremental repository updates.
 *
 * Handles file changes detected between commits and updates the vector
 * index accordingly. Reuses existing ingestion components (FileChunker,
 * EmbeddingProvider, ChromaStorageClient) for consistency with initial
 * indexing.
 *
 * @example
 * ```typescript
 * const pipeline = new IncrementalUpdatePipeline(
 *   fileChunker,
 *   embeddingProvider,
 *   storageClient,
 *   logger
 * );
 *
 * const changes: FileChange[] = [
 *   { path: "src/new.ts", status: "added" },
 *   { path: "src/old.ts", status: "deleted" }
 * ];
 *
 * const result = await pipeline.processChanges(changes, {
 *   repository: "my-api",
 *   localPath: "/repos/my-api",
 *   collectionName: "repo_my_api",
 *   includeExtensions: [".ts", ".js"],
 *   excludePatterns: ["node_modules/**"]
 * });
 *
 * console.log(`Processed ${result.stats.filesAdded} added files`);
 * ```
 */
export class IncrementalUpdatePipeline {
  /**
   * Maximum number of texts to send to embedding provider per batch.
   *
   * OpenAI API limit is 100 texts per request. This prevents rate limit errors
   * and ensures efficient batching.
   */
  private readonly EMBEDDING_BATCH_SIZE = 100;

  /**
   * Create an incremental update pipeline.
   *
   * @param fileChunker - Service for splitting files into chunks
   * @param embeddingProvider - Service for generating embeddings
   * @param storageClient - ChromaDB client for vector storage
   * @param logger - Logger instance
   * @param graphIngestionService - Optional graph ingestion service for graph database updates
   */
  constructor(
    private readonly fileChunker: FileChunker,
    private readonly embeddingProvider: EmbeddingProvider,
    private readonly storageClient: ChromaStorageClient,
    private readonly logger: Logger,
    private readonly graphIngestionService?: GraphIngestionService
  ) {}

  /**
   * Validate file path to prevent path traversal attacks.
   *
   * Ensures that the absolute file path stays within the repository root
   * by checking that the normalized absolute path starts with the normalized
   * local path. This provides defense-in-depth even though the caller is
   * expected to provide sanitized input.
   *
   * @param localPath - Repository root directory path
   * @param relativePath - Relative file path from repository root
   * @returns Validated absolute file path
   * @throws Error if path traversal is detected
   *
   * @example
   * ```typescript
   * // Valid path
   * validateFilePath("/repos/my-api", "src/auth.ts")
   * // Returns: "/repos/my-api/src/auth.ts"
   *
   * // Invalid path (traversal)
   * validateFilePath("/repos/my-api", "../../../etc/passwd")
   * // Throws: Error("Path traversal detected: ../../../etc/passwd")
   * ```
   */
  private validateFilePath(localPath: string, relativePath: string): string {
    const absolutePath = join(localPath, relativePath);
    const normalizedLocal = resolve(localPath);
    const normalizedAbsolute = resolve(absolutePath);

    if (!normalizedAbsolute.startsWith(normalizedLocal)) {
      throw new Error(`Path traversal detected: ${relativePath}`);
    }
    return absolutePath;
  }

  /**
   * Process file changes and update the vector index incrementally.
   *
   * Processes each change type appropriately:
   * - Added files: chunk, embed, and store
   * - Modified files: delete old chunks, chunk new content, embed, and store
   * - Deleted files: delete all chunks
   * - Renamed files: delete old path chunks, chunk new content, embed, and store
   *
   * Files are filtered by extension and exclusion patterns before processing.
   * Individual file errors are collected but don't stop the overall process.
   *
   * @param changes - List of file changes to process
   * @param options - Update configuration and filtering rules
   * @returns Result with statistics and any errors encountered
   *
   * @example
   * ```typescript
   * const result = await pipeline.processChanges(changes, {
   *   repository: "my-api",
   *   localPath: "/repos/my-api",
   *   collectionName: "repo_my_api",
   *   includeExtensions: [".ts", ".js", ".md"],
   *   excludePatterns: ["node_modules/**", "dist/**"]
   * });
   * ```
   */
  async processChanges(changes: FileChange[], options: UpdateOptions): Promise<UpdateResult> {
    const startTime = Date.now();

    // Create correlation-aware logger if correlation ID provided
    const logger = options.correlationId
      ? this.logger.child({ correlationId: options.correlationId })
      : this.logger;

    logger.info(
      {
        operation: "pipeline_process_changes",
        repository: options.repository,
        totalChanges: changes.length,
        collection: options.collectionName,
      },
      "Starting incremental update"
    );

    const stats: UpdateStats = {
      filesAdded: 0,
      filesModified: 0,
      filesDeleted: 0,
      chunksUpserted: 0,
      chunksDeleted: 0,
      durationMs: 0,
    };

    // Initialize graph stats only if graph service is configured
    const graphStats = this.graphIngestionService ? this.initializeGraphStats() : undefined;

    const errors: FileProcessingError[] = [];

    // Handle empty change list gracefully
    if (changes.length === 0) {
      logger.info({ operation: "pipeline_process_changes" }, "No changes to process");
      return {
        stats: { ...stats, durationMs: Date.now() - startTime },
        errors,
      };
    }

    // Create ignorer instance once for all files in this batch
    const ig = ignore().add(options.excludePatterns);

    // Filter changes by extension and exclusion patterns
    const filteredChanges = changes.filter((change) =>
      this.shouldProcessFile(change.path, options.includeExtensions, ig)
    );

    logger.debug(
      {
        operation: "pipeline_filter_changes",
        totalChanges: changes.length,
        filteredChanges: filteredChanges.length,
        skipped: changes.length - filteredChanges.length,
      },
      "Filtered changes by extension and exclusion patterns"
    );

    // Collect all chunks from added/modified/renamed files for batch embedding
    const allChunks: FileChunk[] = [];

    // Process each change
    for (const change of filteredChanges) {
      try {
        switch (change.status) {
          case "added":
            await this.processAddedFile(change, options, allChunks, stats, graphStats);
            break;

          case "modified":
            await this.processModifiedFile(change, options, allChunks, stats, graphStats);
            break;

          case "deleted":
            await this.processDeletedFile(change, options, stats, graphStats);
            break;

          case "renamed":
            await this.processRenamedFile(change, options, allChunks, stats, graphStats);
            break;

          default:
            // TypeScript should catch this, but handle unknown status
            this.logger.warn({ change }, "Unknown change status, skipping");
        }
      } catch (error) {
        // Collect error and continue processing other files
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorType = error instanceof Error ? error.constructor.name : "Unknown";
        errors.push({
          path: change.path,
          error: errorMessage,
        });
        logger.warn(
          {
            operation: "pipeline_file_error",
            path: change.path,
            status: change.status,
            error: errorMessage,
            errorType,
          },
          "Failed to process file change"
        );
      }
    }

    // If we have chunks to embed and store, do it in batches
    if (allChunks.length > 0) {
      try {
        await this.embedAndStoreChunks(allChunks, options.collectionName, stats, logger);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorType = error instanceof Error ? error.constructor.name : "Unknown";
        logger.error(
          {
            operation: "pipeline_embed_and_store",
            error: errorMessage,
            errorType,
            chunkCount: allChunks.length,
          },
          "Failed to embed and store chunks"
        );
        // Add error for the batch operation
        errors.push({
          path: "(batch embedding/storage)",
          error: errorMessage,
        });
      }
    }

    stats.durationMs = Date.now() - startTime;

    // Include graph stats in final stats if graph service is configured
    if (graphStats) {
      stats.graph = graphStats;
    }

    const status = errors.length > 0 ? "completed_with_errors" : "completed";

    logger.info(
      {
        operation: "pipeline_process_changes",
        status,
        stats: {
          filesAdded: stats.filesAdded,
          filesModified: stats.filesModified,
          filesDeleted: stats.filesDeleted,
          chunksUpserted: stats.chunksUpserted,
          chunksDeleted: stats.chunksDeleted,
          durationMs: stats.durationMs,
          ...(graphStats && {
            graphFilesProcessed: graphStats.graphFilesProcessed,
            graphFilesSkipped: graphStats.graphFilesSkipped,
            graphErrors: graphStats.graphErrors.length,
          }),
        },
        errorCount: errors.length,
      },
      "Incremental update completed"
    );

    return { stats, errors };
  }

  /**
   * Check if a file should be processed based on extension and exclusion patterns.
   *
   * @param filePath - File path to check
   * @param includeExtensions - Extensions to include
   * @param ig - Pre-configured ignore instance for exclusion pattern matching
   * @returns True if file should be processed
   */
  private shouldProcessFile(
    filePath: string,
    includeExtensions: string[],
    ig: ReturnType<typeof ignore>
  ): boolean {
    // Check extension
    const extension = filePath.substring(filePath.lastIndexOf(".")).toLowerCase();
    if (!includeExtensions.includes(extension)) {
      return false;
    }

    // Check exclusion patterns using ignore library (same as FileScanner)
    if (ig.ignores(filePath)) {
      return false;
    }

    return true;
  }

  /**
   * Initialize empty graph stats.
   *
   * @returns Fresh GraphUpdateStats object with all counters at zero
   */
  private initializeGraphStats(): GraphUpdateStats {
    return {
      graphNodesCreated: 0,
      graphNodesDeleted: 0,
      graphRelationshipsCreated: 0,
      graphRelationshipsDeleted: 0,
      graphFilesProcessed: 0,
      graphFilesSkipped: 0,
      graphErrors: [],
    };
  }

  /**
   * Process graph update for a file (non-blocking).
   *
   * Handles both ingest and delete operations for the knowledge graph.
   * Graph failures are logged but don't block ChromaDB updates (degraded mode).
   * Only TypeScript/JavaScript files are processed for graph extraction.
   *
   * @param operation - Type of graph operation: 'ingest' or 'delete'
   * @param file - File information with path and optional content
   * @param repositoryName - Repository name for graph node IDs
   * @param graphStats - Statistics to update
   */
  private async processGraphUpdate(
    operation: "ingest" | "delete",
    file: { path: string; content?: string },
    repositoryName: string,
    graphStats: GraphUpdateStats
  ): Promise<void> {
    // Skip if no graph service configured
    if (!this.graphIngestionService) {
      return;
    }

    // Skip files that aren't supported for entity extraction
    if (!EntityExtractor.isSupported(file.path)) {
      graphStats.graphFilesSkipped++;
      return;
    }

    try {
      const startTime = performance.now();

      if (operation === "delete") {
        const result = await this.graphIngestionService.deleteFileData(repositoryName, file.path);
        graphStats.graphNodesDeleted += result.nodesDeleted;
        graphStats.graphRelationshipsDeleted += result.relationshipsDeleted;
        if (!result.success) {
          graphStats.graphErrors.push({
            path: file.path,
            error: "Graph deletion failed - check service logs for details",
            operation: "delete",
          });
          return;
        }
      } else {
        // Ingest requires content
        if (!file.content) {
          this.logger.warn({ filePath: file.path }, "Missing content for graph ingest, skipping");
          graphStats.graphFilesSkipped++;
          return;
        }

        const result = await this.graphIngestionService.ingestFile(
          { path: file.path, content: file.content },
          repositoryName
        );
        graphStats.graphNodesCreated += result.nodesCreated;
        graphStats.graphRelationshipsCreated += result.relationshipsCreated;

        if (!result.success) {
          graphStats.graphErrors.push({
            path: file.path,
            error: result.errors[0]?.message ?? "Unknown ingest error",
            operation: "ingest",
          });
          return;
        }
      }

      graphStats.graphFilesProcessed++;

      const durationMs = performance.now() - startTime;
      if (durationMs > 100) {
        this.logger.warn(
          { filePath: file.path, durationMs: Math.round(durationMs), operation },
          "Graph update exceeded 100ms target"
        );
      }
    } catch (error) {
      // Non-blocking: log error and continue
      const errorMessage = error instanceof Error ? error.message : String(error);
      graphStats.graphErrors.push({
        path: file.path,
        error: errorMessage,
        operation,
      });
      this.logger.warn(
        { filePath: file.path, error: errorMessage, operation },
        "Graph update failed - continuing with ChromaDB updates"
      );
    }
  }

  /**
   * Process an added file.
   *
   * Reads file content, chunks it, and collects chunks for embedding.
   * Also ingests into knowledge graph if graph service is configured.
   *
   * @param change - File change details
   * @param options - Update options
   * @param allChunks - Accumulator for chunks to embed
   * @param stats - Statistics to update
   * @param graphStats - Optional graph statistics to update
   */
  private async processAddedFile(
    change: FileChange,
    options: UpdateOptions,
    allChunks: FileChunk[],
    stats: UpdateStats,
    graphStats?: GraphUpdateStats
  ): Promise<void> {
    this.logger.debug({ path: change.path }, "Processing added file");

    const absolutePath = this.validateFilePath(options.localPath, change.path);
    const content = await Bun.file(absolutePath).text();

    const fileInfo: FileInfo = {
      relativePath: change.path,
      absolutePath,
      extension: change.path.substring(change.path.lastIndexOf(".")).toLowerCase(),
      sizeBytes: Buffer.byteLength(content, "utf8"),
      modifiedAt: new Date(), // Use current time for newly added files
    };

    const chunks = this.fileChunker.chunkFile(content, fileInfo, options.repository);
    allChunks.push(...chunks);

    // Graph update (errors captured in graphStats, don't block pipeline)
    if (graphStats) {
      await this.processGraphUpdate(
        "ingest",
        { path: change.path, content },
        options.repository,
        graphStats
      );
    }

    stats.filesAdded++;
  }

  /**
   * Process a modified file.
   *
   * Deletes old chunks, reads new content, chunks it, and collects for embedding.
   * Also updates knowledge graph if graph service is configured.
   *
   * @param change - File change details
   * @param options - Update options
   * @param allChunks - Accumulator for chunks to embed
   * @param stats - Statistics to update
   * @param graphStats - Optional graph statistics to update
   */
  private async processModifiedFile(
    change: FileChange,
    options: UpdateOptions,
    allChunks: FileChunk[],
    stats: UpdateStats,
    graphStats?: GraphUpdateStats
  ): Promise<void> {
    this.logger.debug({ path: change.path }, "Processing modified file");

    // Delete old chunks
    const deletedCount = await this.storageClient.deleteDocumentsByFilePrefix(
      options.collectionName,
      options.repository,
      change.path
    );
    stats.chunksDeleted += deletedCount;

    // Graph: delete old data first (non-blocking)
    if (graphStats) {
      await this.processGraphUpdate(
        "delete",
        { path: change.path },
        options.repository,
        graphStats
      );
    }

    // Read and chunk new content
    const absolutePath = this.validateFilePath(options.localPath, change.path);
    const content = await Bun.file(absolutePath).text();

    const fileInfo: FileInfo = {
      relativePath: change.path,
      absolutePath,
      extension: change.path.substring(change.path.lastIndexOf(".")).toLowerCase(),
      sizeBytes: Buffer.byteLength(content, "utf8"),
      modifiedAt: new Date(),
    };

    const chunks = this.fileChunker.chunkFile(content, fileInfo, options.repository);
    allChunks.push(...chunks);

    // Graph: ingest new data (non-blocking)
    if (graphStats) {
      await this.processGraphUpdate(
        "ingest",
        { path: change.path, content },
        options.repository,
        graphStats
      );
    }

    stats.filesModified++;
  }

  /**
   * Process a deleted file.
   *
   * Deletes all chunks for the file from ChromaDB.
   * Also deletes graph data if graph service is configured.
   *
   * @param change - File change details
   * @param options - Update options
   * @param stats - Statistics to update
   * @param graphStats - Optional graph statistics to update
   */
  private async processDeletedFile(
    change: FileChange,
    options: UpdateOptions,
    stats: UpdateStats,
    graphStats?: GraphUpdateStats
  ): Promise<void> {
    this.logger.debug({ path: change.path }, "Processing deleted file");

    const deletedCount = await this.storageClient.deleteDocumentsByFilePrefix(
      options.collectionName,
      options.repository,
      change.path
    );
    stats.chunksDeleted += deletedCount;

    // Graph: delete file data (non-blocking)
    if (graphStats) {
      await this.processGraphUpdate(
        "delete",
        { path: change.path },
        options.repository,
        graphStats
      );
    }

    stats.filesDeleted++;
  }

  /**
   * Process a renamed file.
   *
   * Deletes chunks for old path, reads content at new path, chunks it,
   * and collects for embedding. Also updates graph data if graph service is configured.
   *
   * @param change - File change details
   * @param options - Update options
   * @param allChunks - Accumulator for chunks to embed
   * @param stats - Statistics to update
   * @param graphStats - Optional graph statistics to update
   */
  private async processRenamedFile(
    change: FileChange,
    options: UpdateOptions,
    allChunks: FileChunk[],
    stats: UpdateStats,
    graphStats?: GraphUpdateStats
  ): Promise<void> {
    this.logger.debug(
      { path: change.path, previousPath: change.previousPath },
      "Processing renamed file"
    );

    // Validate previousPath exists
    if (!change.previousPath) {
      throw new Error("Renamed file missing previousPath");
    }

    // Delete old path chunks
    const deletedCount = await this.storageClient.deleteDocumentsByFilePrefix(
      options.collectionName,
      options.repository,
      change.previousPath
    );
    stats.chunksDeleted += deletedCount;

    // Graph: delete old path data (non-blocking)
    if (graphStats) {
      await this.processGraphUpdate(
        "delete",
        { path: change.previousPath },
        options.repository,
        graphStats
      );
    }

    // Read and chunk at new path
    const absolutePath = this.validateFilePath(options.localPath, change.path);
    const content = await Bun.file(absolutePath).text();

    const fileInfo: FileInfo = {
      relativePath: change.path,
      absolutePath,
      extension: change.path.substring(change.path.lastIndexOf(".")).toLowerCase(),
      sizeBytes: Buffer.byteLength(content, "utf8"),
      modifiedAt: new Date(),
    };

    const chunks = this.fileChunker.chunkFile(content, fileInfo, options.repository);
    allChunks.push(...chunks);

    // Graph: ingest new path data (non-blocking)
    if (graphStats) {
      await this.processGraphUpdate(
        "ingest",
        { path: change.path, content },
        options.repository,
        graphStats
      );
    }

    stats.filesModified++; // Rename counts as modification
  }

  /**
   * Generate embeddings for chunks and store them in ChromaDB.
   *
   * Batches embedding generation in groups of EMBEDDING_BATCH_SIZE to stay
   * within API limits. Creates DocumentInput objects and upserts to ChromaDB.
   *
   * @param chunks - All chunks to embed and store
   * @param collectionName - Target ChromaDB collection
   * @param stats - Statistics to update
   */
  private async embedAndStoreChunks(
    chunks: FileChunk[],
    collectionName: string,
    stats: UpdateStats,
    logger: Logger
  ): Promise<void> {
    const startTime = Date.now();

    logger.info(
      { operation: "pipeline_embed_chunks", chunkCount: chunks.length },
      "Generating embeddings for chunks"
    );

    // Batch embedding generation (max 100 texts per request)
    const allEmbeddings: number[][] = [];
    const batchCount = Math.ceil(chunks.length / this.EMBEDDING_BATCH_SIZE);

    for (let i = 0; i < chunks.length; i += this.EMBEDDING_BATCH_SIZE) {
      const batch = chunks.slice(i, i + this.EMBEDDING_BATCH_SIZE);
      const batchTexts = batch.map((c) => c.content);
      const batchIndex = Math.floor(i / this.EMBEDDING_BATCH_SIZE) + 1;
      const batchStartTime = Date.now();

      logger.debug(
        {
          operation: "pipeline_embed_batch",
          batchIndex,
          batchCount,
          batchSize: batchTexts.length,
        },
        "Generating embeddings for batch"
      );

      const embeddings = await this.embeddingProvider.generateEmbeddings(batchTexts);
      allEmbeddings.push(...embeddings);

      logger.debug(
        {
          operation: "pipeline_embed_batch",
          batchIndex,
          durationMs: Date.now() - batchStartTime,
        },
        "Batch embedding completed"
      );
    }

    // Create DocumentInput objects
    const documents: DocumentInput[] = chunks.map((chunk, index) => {
      const embedding = allEmbeddings[index];
      if (!embedding) {
        throw new Error(`Missing embedding for chunk ${index}`);
      }

      return {
        id: chunk.id,
        content: chunk.content,
        embedding,
        metadata: {
          file_path: chunk.filePath,
          repository: chunk.repository,
          chunk_index: chunk.chunkIndex,
          total_chunks: chunk.totalChunks,
          chunk_start_line: chunk.startLine,
          chunk_end_line: chunk.endLine,
          file_extension: chunk.metadata.extension,
          language: chunk.metadata.language,
          file_size_bytes: chunk.metadata.fileSizeBytes,
          content_hash: chunk.metadata.contentHash,
          indexed_at: new Date().toISOString(),
          file_modified_at: chunk.metadata.fileModifiedAt.toISOString(),
        },
      };
    });

    // Upsert to ChromaDB
    const upsertStartTime = Date.now();

    logger.info(
      {
        operation: "pipeline_upsert_documents",
        documentCount: documents.length,
        collection: collectionName,
      },
      "Upserting documents to ChromaDB"
    );

    await this.storageClient.upsertDocuments(collectionName, documents);
    stats.chunksUpserted += documents.length;

    logger.info(
      {
        operation: "pipeline_upsert_documents",
        upsertedCount: documents.length,
        durationMs: Date.now() - upsertStartTime,
        totalDurationMs: Date.now() - startTime,
      },
      "Successfully upserted chunks to ChromaDB"
    );
  }
}
