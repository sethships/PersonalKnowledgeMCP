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
import type { ChromaStorageClient, ParsedEmbeddingMetadata } from "../storage/index.js";
import type { FileChunker } from "../ingestion/file-chunker.js";
import type { EmbeddingProvider } from "../providers/index.js";
import type { RepositoryEmbeddingProviderResolver } from "../providers/index.js";
import { UpdateDimensionMismatchError } from "./incremental-update-coordinator-errors.js";
import type { FileInfo, FileChunk } from "../ingestion/types.js";
import type { DocumentInput } from "../storage/index.js";
import type {
  FileChange,
  UpdateOptions,
  UpdateResult,
  UpdateStats,
  FileProcessingError,
  GraphUpdateStats,
  FilterStats,
} from "./incremental-update-types.js";
import type { InternalChunk } from "./ingestion-types.js";
import type { GraphIngestionService } from "../graph/ingestion/GraphIngestionService.js";
import { EntityExtractor } from "../graph/extraction/EntityExtractor.js";
import { DEFAULT_EXTENSIONS } from "../ingestion/default-extensions.js";
import { estimateTokens } from "../ingestion/chunk-utils.js";
import type { DocumentTypeDetector } from "../documents/DocumentTypeDetector.js";
import type { DocumentChunker } from "../documents/DocumentChunker.js";
import type { ExtractionResult } from "../documents/types.js";
import type { DocExtractionResult } from "../graph/extraction/doc-types.js";
import { DocGraphBatcher } from "../graph/extraction/doc-graph-batch.js";

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
   * Maximum estimated tokens for a single chunk sent to the embedding provider.
   *
   * OpenAI's hard input limit is 8,192 tokens per text. `estimateTokens` uses a
   * chars/4 heuristic that can under-estimate for token-dense content (tables,
   * code), so this ceiling is kept below 8,192. Correctly chunked content is at
   * most ~`CHUNK_MAX_TOKENS` estimated tokens; anything above this threshold is
   * pathological (issue #589) and is skipped with an error rather than poisoning
   * its whole embedding batch.
   *
   * Derived from the operator's `CHUNK_MAX_TOKENS` override (the same env var the
   * FileChunker/DocumentChunker honor) so that raising the chunk size does not
   * silently cause every chunk to exceed a hard-coded skip threshold — that
   * would turn a valid config into total data loss. The ceiling is `2x` the
   * configured chunk size to leave headroom for the chars/4 estimator's
   * under-counting, with a floor of 6,000 (the historical default) and a cap of
   * 8,000 to stay below the provider's 8,192 hard limit.
   */
  private readonly MAX_EMBEDDING_INPUT_TOKENS: number;

  /**
   * Doc-graph helper instance — stateless aside from cached extractor objects
   * so we don't re-instantiate `DocEntityExtractor` / `PdfDocxEntityExtractor`
   * for every document file in an update batch.
   */
  private readonly docGraphBatcher = new DocGraphBatcher();

  /**
   * Create an incremental update pipeline.
   *
   * @param fileChunker - Service for splitting files into chunks
   * @param embeddingProvider - Default service for generating embeddings (used
   *   when no per-repository provider can be resolved)
   * @param storageClient - ChromaDB client for vector storage
   * @param logger - Logger instance
   * @param graphIngestionService - Optional graph ingestion service for graph database updates
   * @param documentTypeDetector - Optional detector for routing document files to extractors
   * @param documentChunker - Optional document-aware chunker for PDF, DOCX, Markdown
   * @param providerResolver - Optional per-repository provider resolver (#591).
   *   When present, each update embeds with the provider recorded in the target
   *   collection's metadata (or `options.repoEmbedding`) instead of the default.
   */
  constructor(
    private readonly fileChunker: FileChunker,
    private readonly embeddingProvider: EmbeddingProvider,
    private readonly storageClient: ChromaStorageClient,
    private readonly logger: Logger,
    private readonly graphIngestionService?: GraphIngestionService,
    private readonly documentTypeDetector?: DocumentTypeDetector,
    private readonly documentChunker?: DocumentChunker,
    private readonly providerResolver?: RepositoryEmbeddingProviderResolver
  ) {
    // Derive the per-chunk skip ceiling from the operator's CHUNK_MAX_TOKENS
    // override so a larger configured chunk size doesn't cause every chunk to be
    // skipped against a fixed limit. Floor at 6,000 (historical default), cap at
    // 8,000 to stay under the provider's 8,192 hard input limit.
    const envMax = process.env["CHUNK_MAX_TOKENS"];
    const parsed = envMax ? parseInt(envMax, 10) : NaN;
    const configured = !isNaN(parsed) && parsed > 0 ? parsed : 500;
    this.MAX_EMBEDDING_INPUT_TOKENS = Math.min(8000, Math.max(6000, configured * 2));
  }

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
      chunksSkipped: 0,
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
        filterStats: {
          totalChanges: 0,
          eligibleChanges: 0,
          filteredChanges: 0,
          skippedChanges: 0,
        },
      };
    }

    // Create ignorer instance once for all files in this batch
    const ig = ignore().add(options.excludePatterns);

    // Warn if falling back to default extensions (indicates stale metadata)
    if (options.includeExtensions.length === 0) {
      logger.warn(
        {
          operation: "pipeline_filter_changes",
          repository: options.repository,
          defaultExtensionCount: DEFAULT_EXTENSIONS.length,
        },
        "Repository has empty includeExtensions - falling back to DEFAULT_EXTENSIONS. " +
          "Consider re-indexing to persist extension metadata."
      );
    }

    // Filter changes by extension and exclusion patterns
    const filteredChanges = changes.filter((change) =>
      this.shouldProcessFile(change.path, options.includeExtensions, ig)
    );

    // Calculate filter statistics for observability
    // eligibleChanges: files matching DEFAULT_EXTENSIONS AND not matching excludePatterns
    // This uses DEFAULT_EXTENSIONS (not effectiveExtensions) to detect files that
    // "should" be indexable regardless of the repo's includeExtensions setting
    const defaultExtSet = new Set<string>(DEFAULT_EXTENSIONS);
    const eligibleChanges = changes.filter((change) => {
      // Note: files without a dot (e.g., Makefile, LICENSE) return the full
      // filename from substring(-1), which won't match DEFAULT_EXTENSIONS.
      // This is consistent with shouldProcessFile() behavior.
      const ext = change.path.substring(change.path.lastIndexOf(".")).toLowerCase();
      if (!defaultExtSet.has(ext)) {
        return false;
      }
      return !ig.ignores(change.path);
    }).length;

    const filterStats: FilterStats = {
      totalChanges: changes.length,
      eligibleChanges,
      filteredChanges: filteredChanges.length,
      skippedChanges: changes.length - filteredChanges.length,
    };

    logger.debug(
      {
        operation: "pipeline_filter_changes",
        totalChanges: changes.length,
        filteredChanges: filteredChanges.length,
        eligibleChanges,
        skipped: changes.length - filteredChanges.length,
      },
      "Filtered changes by extension and exclusion patterns"
    );

    // Per-repository embedding provider selection (#591). Updates must embed
    // with the provider the collection was indexed with, not the process-global
    // default — otherwise vectors with the wrong dimensions are rejected
    // wholesale by ChromaDB. Selection order: collection embedding metadata
    // (ground truth) → options.repoEmbedding (repository metadata, for legacy
    // collections) → the pipeline's default provider. Resolved BEFORE the
    // per-file loop so a dimension mismatch fails fast without deleting any
    // existing chunks.
    const hasContentChanges = filteredChanges.some((c) => c.status !== "deleted");
    let embeddingProvider = this.embeddingProvider;
    if (hasContentChanges) {
      let collectionMeta: ParsedEmbeddingMetadata | null = null;
      try {
        collectionMeta = await this.storageClient.getCollectionEmbeddingMetadata(
          options.collectionName
        );
      } catch (error) {
        // Metadata lookup failures must not block the update — fall through to
        // repo metadata / default provider (pre-#591 behavior).
        logger.debug(
          {
            operation: "pipeline_provider_resolution",
            collection: options.collectionName,
            error: error instanceof Error ? error.message : String(error),
          },
          "Could not read collection embedding metadata - using repo metadata or default provider"
        );
      }

      const providerMeta = collectionMeta?.provider
        ? collectionMeta
        : options.repoEmbedding?.provider
          ? options.repoEmbedding
          : null;

      if (providerMeta && this.providerResolver) {
        embeddingProvider = this.providerResolver.resolve(providerMeta);
        if (embeddingProvider !== this.embeddingProvider) {
          logger.info(
            {
              operation: "pipeline_provider_resolution",
              repository: options.repository,
              provider: embeddingProvider.providerId,
              model: embeddingProvider.modelId,
              dimensions: embeddingProvider.dimensions,
              source: collectionMeta?.provider ? "collection_metadata" : "repository_metadata",
            },
            "Using repository-specific embedding provider"
          );
        }
      } else if (providerMeta && !this.providerResolver) {
        // Metadata records a specific provider but no resolver is wired, so we
        // cannot honor it — the default provider is used and may mismatch.
        logger.warn(
          {
            operation: "pipeline_provider_resolution",
            repository: options.repository,
            recordedProvider: providerMeta.provider,
            defaultProvider: this.embeddingProvider.providerId,
          },
          "Repository records an embedding provider but no resolver is wired - " +
            "embedding with the default provider"
        );
      }

      // Fail fast on dimension mismatch BEFORE any chunk deletion. The
      // destructive failure mode this prevents: per-file deletes run first,
      // then every embed batch is rejected, leaving files unindexed (#591).
      // When the collection metadata read fails (collectionMeta stays null),
      // fall back to options.repoEmbedding?.dimensions so a transient ChromaDB
      // error can't silently skip the guard and let the destructive sequence run.
      const guardDimensions = collectionMeta?.dimensions ?? options.repoEmbedding?.dimensions;
      if (guardDimensions !== undefined && embeddingProvider.dimensions !== guardDimensions) {
        throw new UpdateDimensionMismatchError(
          options.repository,
          guardDimensions,
          embeddingProvider.dimensions,
          embeddingProvider.providerId
        );
      }
    }

    // Collect all chunks from added/modified/renamed files for batch embedding.
    // Uses InternalChunk to support both code files (via FileChunker) and
    // document files (via DocumentChunker) in a single accumulator.
    const allChunks: InternalChunk[] = [];

    // Per-update accumulator for doc-graph extractions (issue #580). Populated
    // by `processAddedFile`/`processModifiedFile`/`processRenamedFile` for
    // markdown / pdf / docx / txt files; flushed once after the per-file loop
    // via `graphIngestionService.ingestDocumentGraph`. Skipped entirely when
    // the graph service is not configured.
    const docExtractionResults: DocExtractionResult[] = [];

    // Process each change
    for (const change of filteredChanges) {
      try {
        switch (change.status) {
          case "added":
            await this.processAddedFile(
              change,
              options,
              allChunks,
              stats,
              graphStats,
              docExtractionResults
            );
            break;

          case "modified":
            await this.processModifiedFile(
              change,
              options,
              allChunks,
              stats,
              graphStats,
              docExtractionResults
            );
            break;

          case "deleted":
            await this.processDeletedFile(change, options, stats, graphStats);
            break;

          case "renamed":
            await this.processRenamedFile(
              change,
              options,
              allChunks,
              stats,
              graphStats,
              docExtractionResults
            );
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

    // If we have chunks to embed and store, do it in batches. Per-batch and
    // per-chunk failures are collected into `errors` inside; this catch is a
    // last resort for unexpected failures outside the batch loop.
    if (allChunks.length > 0) {
      try {
        await this.embedAndStoreChunks(
          allChunks,
          options.collectionName,
          stats,
          errors,
          logger,
          embeddingProvider
        );
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

    // Doc-graph batch flush (issue #580). Runs after the per-file
    // `processGraphUpdate("ingest", ...)` calls in the loop above complete,
    // so when `ingestDocumentGraph` queries the graph for code symbols to
    // resolve MENTIONS, any Function/Class nodes added in THIS update are
    // already persisted (the symbol lookup runs against the adapter, not
    // in-process state). Pre-existing symbols from prior ingestions are
    // already there from earlier runs. Non-blocking: errors degrade the run
    // rather than failing it, matching `processGraphUpdate` semantics.
    if (this.graphIngestionService && docExtractionResults.length > 0 && graphStats) {
      try {
        const result = await this.graphIngestionService.ingestDocumentGraph(
          options.repository,
          docExtractionResults
        );
        logger.info(
          {
            operation: "pipeline_doc_graph_batch",
            repository: options.repository,
            documents: result.documentsCreated,
            sections: result.sectionsCreated,
            edges: result.edgesCreated,
          },
          "Document graph batch completed"
        );
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        graphStats.graphErrors.push({
          path: "(doc-graph batch)",
          error: errorMessage,
          operation: "ingest",
        });
        logger.warn(
          {
            operation: "pipeline_doc_graph_batch",
            repository: options.repository,
            error: errorMessage,
          },
          "Document graph batch failed - continuing"
        );
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

    return { stats, errors, filterStats };
  }

  /**
   * Check if a file should be processed based on extension and exclusion patterns.
   *
   * When includeExtensions is empty (common for repositories indexed before
   * extension metadata was persisted), falls back to DEFAULT_EXTENSIONS to
   * ensure files are not incorrectly filtered out.
   *
   * @param filePath - File path to check
   * @param includeExtensions - Extensions to include (empty array falls back to defaults)
   * @param ig - Pre-configured ignore instance for exclusion pattern matching
   * @returns True if file should be processed
   */
  private shouldProcessFile(
    filePath: string,
    includeExtensions: string[],
    ig: ReturnType<typeof ignore>
  ): boolean {
    // Fall back to DEFAULT_EXTENSIONS when includeExtensions is empty.
    // This occurs when repositories store includeExtensions: [] in metadata,
    // which would cause [].includes(anything) to always return false.
    const effectiveExtensions =
      includeExtensions.length > 0 ? includeExtensions : [...DEFAULT_EXTENSIONS];

    // Check extension
    const extension = filePath.substring(filePath.lastIndexOf(".")).toLowerCase();
    if (!effectiveExtensions.includes(extension)) {
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
    allChunks: InternalChunk[],
    stats: UpdateStats,
    graphStats: GraphUpdateStats | undefined,
    docExtractionResults: DocExtractionResult[]
  ): Promise<void> {
    this.logger.debug({ path: change.path }, "Processing added file");

    const absolutePath = this.validateFilePath(options.localPath, change.path);

    // Route document files through the document pipeline
    if (this.isDocumentFile(change.path)) {
      const { chunks: docChunks, docExtraction } = await this.processDocumentFile(
        absolutePath,
        change.path,
        options.repository
      );
      allChunks.push(...docChunks);
      if (docExtraction) {
        docExtractionResults.push(docExtraction);
      }
    } else {
      const content = await Bun.file(absolutePath).text();

      const fileInfo: FileInfo = {
        relativePath: change.path,
        absolutePath,
        extension: change.path.substring(change.path.lastIndexOf(".")).toLowerCase(),
        sizeBytes: Buffer.byteLength(content, "utf8"),
        modifiedAt: new Date(),
      };

      const chunks = this.fileChunker.chunkFile(content, fileInfo, options.repository);
      allChunks.push(...this.convertFileChunksToInternal(chunks));

      // Graph update only for code files (documents are not AST-parsed)
      if (graphStats) {
        await this.processGraphUpdate(
          "ingest",
          { path: change.path, content },
          options.repository,
          graphStats
        );
      }
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
    allChunks: InternalChunk[],
    stats: UpdateStats,
    graphStats: GraphUpdateStats | undefined,
    docExtractionResults: DocExtractionResult[]
  ): Promise<void> {
    this.logger.debug({ path: change.path }, "Processing modified file");

    // Delete old chunks
    const deletedCount = await this.storageClient.deleteDocumentsByFilePrefix(
      options.collectionName,
      options.repository,
      change.path
    );
    stats.chunksDeleted += deletedCount;

    const absolutePath = this.validateFilePath(options.localPath, change.path);

    // Route document files through the document pipeline
    if (this.isDocumentFile(change.path)) {
      // Modified document: delete the prior :Document/:Section/edges before
      // re-ingesting so stale wikilinks/MENTIONS for removed content don't
      // linger. `deleteFileData` already covers both code and doc nodes
      // idempotently — see GraphIngestionService.ts lines 463-569.
      if (graphStats && this.graphIngestionService) {
        try {
          const result = await this.graphIngestionService.deleteFileData(
            options.repository,
            change.path
          );
          graphStats.graphNodesDeleted += result.nodesDeleted;
          graphStats.graphRelationshipsDeleted += result.relationshipsDeleted;
        } catch (error) {
          // Non-blocking: log and continue. The MERGE-based ingest below will
          // still produce the right end state for the document and its edges,
          // even if some stale orphan nodes remain.
          this.logger.warn(
            {
              filePath: change.path,
              error: error instanceof Error ? error.message : String(error),
            },
            "deleteFileData failed for modified doc - continuing"
          );
        }
      }

      const { chunks: docChunks, docExtraction } = await this.processDocumentFile(
        absolutePath,
        change.path,
        options.repository
      );
      allChunks.push(...docChunks);
      if (docExtraction) {
        docExtractionResults.push(docExtraction);
      }
    } else {
      // Graph: delete old data first (non-blocking, code files only)
      if (graphStats) {
        await this.processGraphUpdate(
          "delete",
          { path: change.path },
          options.repository,
          graphStats
        );
      }

      // Read and chunk new content
      const content = await Bun.file(absolutePath).text();

      const fileInfo: FileInfo = {
        relativePath: change.path,
        absolutePath,
        extension: change.path.substring(change.path.lastIndexOf(".")).toLowerCase(),
        sizeBytes: Buffer.byteLength(content, "utf8"),
        modifiedAt: new Date(),
      };

      const chunks = this.fileChunker.chunkFile(content, fileInfo, options.repository);
      allChunks.push(...this.convertFileChunksToInternal(chunks));

      // Graph: ingest new data (non-blocking, code files only)
      if (graphStats) {
        await this.processGraphUpdate(
          "ingest",
          { path: change.path, content },
          options.repository,
          graphStats
        );
      }
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
    allChunks: InternalChunk[],
    stats: UpdateStats,
    graphStats: GraphUpdateStats | undefined,
    docExtractionResults: DocExtractionResult[]
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

    // Read and chunk at new path
    const absolutePath = this.validateFilePath(options.localPath, change.path);

    // Route document files through the document pipeline
    if (this.isDocumentFile(change.path)) {
      // Drop the previous-path :Document and its edges before re-ingesting
      // under the new path so the rename doesn't leave orphan nodes.
      if (graphStats && this.graphIngestionService) {
        try {
          const result = await this.graphIngestionService.deleteFileData(
            options.repository,
            change.previousPath
          );
          graphStats.graphNodesDeleted += result.nodesDeleted;
          graphStats.graphRelationshipsDeleted += result.relationshipsDeleted;
        } catch (error) {
          this.logger.warn(
            {
              filePath: change.previousPath,
              error: error instanceof Error ? error.message : String(error),
            },
            "deleteFileData failed for renamed doc - continuing"
          );
        }
      }

      const { chunks: docChunks, docExtraction } = await this.processDocumentFile(
        absolutePath,
        change.path,
        options.repository
      );
      allChunks.push(...docChunks);
      if (docExtraction) {
        docExtractionResults.push(docExtraction);
      }
    } else {
      // Graph: delete old path data (non-blocking, code files only)
      if (graphStats) {
        await this.processGraphUpdate(
          "delete",
          { path: change.previousPath },
          options.repository,
          graphStats
        );
      }

      const content = await Bun.file(absolutePath).text();

      const fileInfo: FileInfo = {
        relativePath: change.path,
        absolutePath,
        extension: change.path.substring(change.path.lastIndexOf(".")).toLowerCase(),
        sizeBytes: Buffer.byteLength(content, "utf8"),
        modifiedAt: new Date(),
      };

      const chunks = this.fileChunker.chunkFile(content, fileInfo, options.repository);
      allChunks.push(...this.convertFileChunksToInternal(chunks));

      // Graph: ingest new path data (non-blocking, code files only)
      if (graphStats) {
        await this.processGraphUpdate(
          "ingest",
          { path: change.path, content },
          options.repository,
          graphStats
        );
      }
    }

    stats.filesModified++; // Rename counts as modification
  }

  /**
   * Generate embeddings for chunks and store them in ChromaDB.
   *
   * Batches embedding generation in groups of EMBEDDING_BATCH_SIZE to stay
   * within API limits. Each batch is embedded and upserted independently so a
   * failure affects at most EMBEDDING_BATCH_SIZE chunks instead of the whole
   * update (issue #589: a single oversized chunk previously caused every chunk
   * in the update to be lost after their predecessors were already deleted).
   *
   * Chunks whose estimated token count exceeds MAX_EMBEDDING_INPUT_TOKENS are
   * skipped up-front with a per-chunk error so they cannot poison a batch.
   *
   * @param chunks - All chunks to embed and store
   * @param collectionName - Target ChromaDB collection
   * @param stats - Statistics to update
   * @param errors - Error collector for skipped chunks and failed batches
   * @param logger - Correlation-aware logger
   * @param embeddingProvider - Provider selected for this update (#591) — the
   *   repository's recorded provider when resolvable, else the default
   */
  private async embedAndStoreChunks(
    chunks: InternalChunk[],
    collectionName: string,
    stats: UpdateStats,
    errors: FileProcessingError[],
    logger: Logger,
    embeddingProvider: EmbeddingProvider
  ): Promise<void> {
    const startTime = Date.now();

    // Safety net: skip pathologically large chunks instead of letting them
    // fail an entire embedding request. With correct chunking this never
    // trips, but a chunker regression must degrade per-chunk, not per-update.
    const safeChunks: InternalChunk[] = [];
    for (const chunk of chunks) {
      const estimatedTokens = estimateTokens(chunk.content);
      if (estimatedTokens > this.MAX_EMBEDDING_INPUT_TOKENS) {
        stats.chunksSkipped = (stats.chunksSkipped ?? 0) + 1;
        errors.push({
          path: chunk.filePath,
          error:
            `Chunk ${chunk.id} skipped: estimated ${estimatedTokens} tokens exceeds ` +
            `embedding input limit (${this.MAX_EMBEDDING_INPUT_TOKENS})`,
        });
        logger.warn(
          {
            operation: "pipeline_embed_chunks",
            chunkId: chunk.id,
            filePath: chunk.filePath,
            estimatedTokens,
            limit: this.MAX_EMBEDDING_INPUT_TOKENS,
          },
          "Skipping oversized chunk - exceeds embedding input limit"
        );
        continue;
      }
      safeChunks.push(chunk);
    }

    logger.info(
      {
        operation: "pipeline_embed_chunks",
        chunkCount: safeChunks.length,
        skippedOversized: chunks.length - safeChunks.length,
      },
      "Generating embeddings for chunks"
    );

    // Embed and upsert per batch (max 100 texts per request). Batches are
    // independent: a failed batch is recorded as an error and the remaining
    // batches still get stored.
    const batchCount = Math.ceil(safeChunks.length / this.EMBEDDING_BATCH_SIZE);

    for (let i = 0; i < safeChunks.length; i += this.EMBEDDING_BATCH_SIZE) {
      const batch = safeChunks.slice(i, i + this.EMBEDDING_BATCH_SIZE);
      const batchIndex = Math.floor(i / this.EMBEDDING_BATCH_SIZE) + 1;
      const batchStartTime = Date.now();

      logger.debug(
        {
          operation: "pipeline_embed_batch",
          batchIndex,
          batchCount,
          batchSize: batch.length,
        },
        "Generating embeddings for batch"
      );

      try {
        const embeddings = await embeddingProvider.generateEmbeddings(batch.map((c) => c.content));

        // Create DocumentInput objects for this batch
        const documents: DocumentInput[] = batch.map((chunk, index) => {
          const embedding = embeddings[index];
          if (!embedding) {
            throw new Error(`Missing embedding for chunk ${chunk.id} (batch index ${index})`);
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
              file_extension: chunk.extension,
              language: chunk.language,
              file_size_bytes: chunk.fileSizeBytes,
              content_hash: chunk.contentHash,
              indexed_at: new Date().toISOString(),
              file_modified_at: chunk.fileModifiedAt.toISOString(),
              // Document-specific metadata (only present for document chunks)
              ...(chunk.documentMetadata && {
                document_type: chunk.documentMetadata.documentType,
                ...(chunk.documentMetadata.pageNumber !== undefined && {
                  page_number: chunk.documentMetadata.pageNumber,
                }),
                ...(chunk.documentMetadata.sectionHeading && {
                  section_heading: chunk.documentMetadata.sectionHeading,
                }),
                ...(chunk.documentMetadata.documentTitle && {
                  document_title: chunk.documentMetadata.documentTitle,
                }),
                ...(chunk.documentMetadata.documentAuthor && {
                  document_author: chunk.documentMetadata.documentAuthor,
                }),
              }),
            },
          };
        });

        await this.storageClient.upsertDocuments(collectionName, documents);
        stats.chunksUpserted += documents.length;

        logger.debug(
          {
            operation: "pipeline_embed_batch",
            batchIndex,
            upsertedCount: documents.length,
            durationMs: Date.now() - batchStartTime,
          },
          "Batch embedded and upserted"
        );
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const affectedFiles = [...new Set(batch.map((c) => c.filePath))];
        errors.push({
          path: `(embedding batch ${batchIndex}/${batchCount})`,
          error: `${errorMessage} (${batch.length} chunks across ${affectedFiles.length} files lost)`,
        });
        logger.error(
          {
            operation: "pipeline_embed_batch",
            batchIndex,
            batchCount,
            batchSize: batch.length,
            affectedFiles,
            error: errorMessage,
          },
          "Embedding batch failed - continuing with remaining batches"
        );
      }
    }

    logger.info(
      {
        operation: "pipeline_upsert_documents",
        upsertedCount: stats.chunksUpserted,
        skippedOversized: chunks.length - safeChunks.length,
        totalDurationMs: Date.now() - startTime,
      },
      "Embed and store completed"
    );
  }

  /**
   * Check if a file should be processed through the document chunking pipeline.
   *
   * Returns true when both documentTypeDetector and documentChunker are available
   * and the file's extension is recognized as a document type.
   *
   * @param filePath - Relative file path to check
   * @returns true if the file should be processed as a document
   */
  private isDocumentFile(filePath: string): boolean {
    if (!this.documentTypeDetector || !this.documentChunker) {
      return false;
    }
    return this.documentTypeDetector.isDocument(filePath);
  }

  /**
   * Process a document file through the document extraction and chunking pipeline.
   *
   * Uses the DocumentTypeDetector to find the appropriate extractor,
   * extracts content and metadata, then chunks the document using
   * DocumentChunker. The resulting DocumentChunks are converted to
   * InternalChunks with document-specific metadata preserved.
   *
   * @param absolutePath - Absolute path to the document file
   * @param relativePath - Relative path for chunk identification
   * @param repository - Repository or source name
   * @returns Array of InternalChunks with document metadata
   * @throws {Error} If no extractor is found or extraction/chunking fails
   */
  private async processDocumentFile(
    absolutePath: string,
    relativePath: string,
    repository: string
  ): Promise<{ chunks: InternalChunk[]; docExtraction: DocExtractionResult | null }> {
    const extractor = this.documentTypeDetector!.getExtractor(absolutePath);
    if (!extractor) {
      throw new Error(`No extractor found for document: ${relativePath}`);
    }

    const detectedType = this.documentTypeDetector!.detect(absolutePath);
    this.logger.debug(
      { file: relativePath, type: detectedType },
      "Processing document file in incremental pipeline"
    );

    const extractionResult = (await extractor.extract(absolutePath)) as ExtractionResult;
    const documentChunks = this.documentChunker!.chunkDocument(
      extractionResult,
      relativePath,
      repository
    );

    // Reuse the same extraction to build the doc-graph payload (issue #580).
    // For markdown, `MarkdownExtractionResult.tokens` is forwarded so we don't
    // re-lex; PDF/DOCX hand the extraction object straight through.
    // Skipped when the graph service isn't wired since the result would be
    // discarded by `processChanges`.
    const docExtraction = this.graphIngestionService
      ? this.docGraphBatcher.fromExtraction(relativePath, extractionResult)
      : null;

    const chunks = documentChunks.map((chunk) => ({
      content: chunk.content,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      filePath: chunk.filePath,
      id: chunk.id,
      repository: chunk.repository,
      chunkIndex: chunk.chunkIndex,
      totalChunks: chunk.totalChunks,
      extension: chunk.metadata.extension,
      language: chunk.metadata.language,
      fileSizeBytes: chunk.metadata.fileSizeBytes,
      contentHash: chunk.metadata.contentHash,
      fileModifiedAt: chunk.metadata.fileModifiedAt,
      documentMetadata: {
        documentType: chunk.metadata.documentType,
        pageNumber: chunk.metadata.pageNumber,
        sectionHeading: chunk.metadata.sectionHeading,
        documentTitle: chunk.metadata.documentTitle,
        documentAuthor: chunk.metadata.documentAuthor,
      },
    }));

    return { chunks, docExtraction };
  }

  /**
   * Convert FileChunk[] to InternalChunk[] for unified batch processing.
   *
   * Maps FileChunk metadata fields to the flat InternalChunk structure.
   * No documentMetadata is set since these are code/text file chunks.
   *
   * @param chunks - FileChunks from FileChunker
   * @returns InternalChunks without document metadata
   */
  private convertFileChunksToInternal(chunks: FileChunk[]): InternalChunk[] {
    return chunks.map((chunk) => ({
      content: chunk.content,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      filePath: chunk.filePath,
      id: chunk.id,
      repository: chunk.repository,
      chunkIndex: chunk.chunkIndex,
      totalChunks: chunk.totalChunks,
      extension: chunk.metadata.extension,
      language: chunk.metadata.language,
      fileSizeBytes: chunk.metadata.fileSizeBytes,
      contentHash: chunk.metadata.contentHash,
      fileModifiedAt: chunk.metadata.fileModifiedAt,
    }));
  }
}
