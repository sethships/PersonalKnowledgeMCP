/**
 * IngestionService - Orchestrates repository indexing workflow
 *
 * Coordinates the complete pipeline from cloning repositories to storing
 * embeddings in ChromaDB. Provides progress reporting, error handling,
 * and support for reindexing and removal operations.
 *
 * @module services/ingestion-service
 */

import type { Logger } from "pino";
import type { RepositoryCloner } from "../ingestion/repository-cloner.js";
import type { CloneResult, FileInfo, FileChunk } from "../ingestion/types.js";
import type { FileScanner } from "../ingestion/file-scanner.js";
import type { FileChunker } from "../ingestion/file-chunker.js";
import type { EmbeddingProvider } from "../providers/types.js";
import type { ChromaStorageClient, DocumentInput } from "../storage/types.js";
import type { RepositoryMetadataService, RepositoryInfo } from "../repositories/types.js";
import { getComponentLogger } from "../logging/index.js";
import type {
  IndexOptions,
  IndexProgress,
  IndexResult,
  IndexError,
  IngestionStatus,
  BatchResult,
} from "./ingestion-types.js";
import {
  IngestionError,
  RepositoryAlreadyExistsError,
  IndexingInProgressError,
  CollectionCreationError,
} from "./ingestion-errors.js";

/**
 * Service for orchestrating repository indexing operations
 *
 * Coordinates the complete indexing pipeline:
 * 1. Clone repository
 * 2. Scan files
 * 3. Create ChromaDB collection
 * 4. Batch process (chunk → embed → store)
 * 5. Update metadata
 *
 * Features:
 * - Progress reporting via callbacks
 * - Graceful error handling with partial success
 * - Concurrency control (single indexing operation at a time)
 * - Batch processing to manage memory
 * - Reindexing support with force flag
 */
export class IngestionService {
  /**
   * Lazy-initialized logger
   * Pattern from SearchServiceImpl
   */
  private _logger: Logger | null = null;

  /**
   * Flag indicating if an indexing operation is in progress
   * Used to prevent concurrent indexing operations
   */
  private _isIndexing: boolean = false;

  /**
   * Current operation details (null if not indexing)
   */
  private _currentOperation: IngestionStatus["currentOperation"] = null;

  /**
   * Number of files to process in each batch
   * Balances memory usage vs. throughput
   */
  private readonly FILE_BATCH_SIZE = 50;

  /**
   * Number of texts to send to embedding API per batch
   * Respects OpenAI's 100 text limit per request
   */
  private readonly EMBEDDING_BATCH_SIZE = 100;

  constructor(
    private readonly repositoryCloner: RepositoryCloner,
    private readonly fileScanner: FileScanner,
    private readonly fileChunker: FileChunker,
    private readonly embeddingProvider: EmbeddingProvider,
    private readonly storageClient: ChromaStorageClient,
    private readonly repositoryService: RepositoryMetadataService
  ) {}

  /**
   * Get logger instance (lazy initialization)
   */
  private get logger(): Logger {
    if (!this._logger) {
      this._logger = getComponentLogger("services:ingestion");
    }
    return this._logger;
  }

  /**
   * Index a repository by URL
   *
   * Performs the complete indexing workflow:
   * 1. Clone repository to local disk
   * 2. Scan files with extension filtering
   * 3. Create ChromaDB collection
   * 4. Process files in batches (chunk, embed, store)
   * 5. Update repository metadata
   *
   * @param url - Git repository URL (e.g., https://github.com/user/repo.git)
   * @param options - Indexing options (branch, extensions, progress callback, force)
   * @returns IndexResult with status, stats, and any errors
   *
   * @throws {RepositoryAlreadyExistsError} If repository exists and force is false
   * @throws {IndexingInProgressError} If another indexing operation is in progress
   *
   * @example
   * ```typescript
   * const result = await ingestionService.indexRepository(
   *   'https://github.com/user/my-repo.git',
   *   {
   *     branch: 'main',
   *     onProgress: (progress) => console.log(`${progress.phase}: ${progress.percentage}%`)
   *   }
   * );
   * console.log(`Indexed ${result.stats.filesProcessed} files`);
   * ```
   */
  async indexRepository(url: string, options: IndexOptions = {}): Promise<IndexResult> {
    const startTime = performance.now();
    const errors: IndexError[] = [];
    const stats = {
      filesScanned: 0,
      filesProcessed: 0,
      filesFailed: 0,
      chunksCreated: 0,
      embeddingsGenerated: 0,
      documentsStored: 0,
      durationMs: 0,
    };

    let repositoryName = "";
    let collectionName = "";

    try {
      // Pre-flight checks
      this.validateUrl(url);
      repositoryName = this.extractRepositoryName(url);
      collectionName = this.sanitizeCollectionName(repositoryName);

      this.logger.info("Starting indexing operation", {
        repository: repositoryName,
        url,
        force: options.force,
      });

      // Prevent concurrent indexing
      if (this._isIndexing && this._currentOperation) {
        throw new IndexingInProgressError(this._currentOperation.repository);
      } else if (this._isIndexing) {
        // Shouldn't happen, but handle gracefully
        throw new IndexingInProgressError("unknown");
      }

      // Check if repository already exists (unless force flag set)
      if (!options.force) {
        const existing = await this.repositoryService.getRepository(repositoryName);
        if (existing) {
          throw new RepositoryAlreadyExistsError(repositoryName);
        }
      }

      // Set indexing state
      this._isIndexing = true;
      this._currentOperation = {
        repository: repositoryName,
        phase: "cloning",
        startedAt: new Date(),
        progress: {
          phase: "cloning",
          repository: repositoryName,
          percentage: 0,
          details: {},
          timestamp: new Date(),
        },
      };

      // Phase 1: Clone repository
      this.updateProgress(
        {
          phase: "cloning",
          repository: repositoryName,
          percentage: 5,
          details: {},
          timestamp: new Date(),
        },
        options
      );

      const cloneResult = await this.repositoryCloner.clone(url, {
        branch: options.branch,
      });

      this.logger.info("Repository cloned", {
        repository: repositoryName,
        path: cloneResult.path,
        branch: cloneResult.branch,
      });

      // Phase 2: Scan files
      this.updateProgress(
        {
          phase: "scanning",
          repository: repositoryName,
          percentage: 15,
          details: {},
          timestamp: new Date(),
        },
        options
      );

      const fileInfos = await this.fileScanner.scanFiles(cloneResult.path, {
        includeExtensions: options.includeExtensions,
        excludePatterns: options.excludePatterns,
        onProgress: (scanned) => {
          this.updateProgress(
            {
              phase: "scanning",
              repository: repositoryName,
              percentage: 15 + Math.min(10, (scanned / 1000) * 10),
              details: { filesScanned: scanned },
              timestamp: new Date(),
            },
            options
          );
        },
      });

      stats.filesScanned = fileInfos.length;

      this.logger.info("Files scanned", {
        repository: repositoryName,
        fileCount: fileInfos.length,
      });

      // Phase 3: Create collection (delete if reindexing)
      if (options.force) {
        try {
          await this.storageClient.deleteCollection(collectionName);
          this.logger.info("Deleted existing collection for reindexing", {
            collectionName,
          });
        } catch (err) {
          // Collection might not exist, that's fine
          this.logger.debug("Collection deletion skipped", { error: err });
        }
      }

      try {
        await this.storageClient.getOrCreateCollection(collectionName);
      } catch (err) {
        throw new CollectionCreationError(collectionName, err);
      }

      this.logger.info("ChromaDB collection ready", { collectionName });

      // Phase 4: Batch process files
      const fileBatches = this.createBatches(fileInfos, this.FILE_BATCH_SIZE);
      const totalBatches = fileBatches.length;

      this.logger.info("Starting batch processing", {
        repository: repositoryName,
        totalFiles: fileInfos.length,
        totalBatches,
        batchSize: this.FILE_BATCH_SIZE,
      });

      for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
        const batch = fileBatches[batchIndex];
        if (!batch) continue; // Skip if batch is undefined (shouldn't happen)

        try {
          const batchResult = await this.processFileBatch(
            batch,
            cloneResult.path,
            repositoryName,
            collectionName,
            {
              batchIndex,
              totalBatches,
              onProgress: (phase, details) => {
                const basePercentage = 25 + (batchIndex / totalBatches) * 70;
                this.updateProgress(
                  {
                    phase,
                    repository: repositoryName,
                    percentage: Math.round(basePercentage),
                    details: {
                      ...details,
                      currentBatch: batchIndex + 1,
                      totalBatches,
                    },
                    timestamp: new Date(),
                  },
                  options
                );
              },
            }
          );

          // Accumulate stats
          stats.filesProcessed += batchResult.filesProcessed;
          stats.filesFailed += batchResult.filesFailed;
          stats.chunksCreated += batchResult.chunksCreated;
          stats.embeddingsGenerated += batchResult.embeddingsGenerated;
          stats.documentsStored += batchResult.documentsStored;
          errors.push(...batchResult.errors);
        } catch (batchError) {
          // Log batch error but continue with next batch
          this.logger.error(`Batch ${batchIndex + 1}/${totalBatches} failed, continuing...`, {
            error: batchError,
            batchIndex,
          });
          errors.push({
            type: "batch_error",
            batchNumber: batchIndex,
            message: batchError instanceof Error ? batchError.message : String(batchError),
            originalError: batchError,
          });
          stats.filesFailed += batch.length;
        }
      }

      this.logger.info("Batch processing completed", {
        repository: repositoryName,
        filesProcessed: stats.filesProcessed,
        filesFailed: stats.filesFailed,
        chunksCreated: stats.chunksCreated,
      });

      // Phase 5: Update repository metadata
      this.updateProgress(
        {
          phase: "updating_metadata",
          repository: repositoryName,
          percentage: 95,
          details: {
            filesProcessed: stats.filesProcessed,
            chunksCreated: stats.chunksCreated,
          },
          timestamp: new Date(),
        },
        options
      );

      const errorMessage =
        errors.length > 0
          ? `Indexed with ${errors.length} error(s): ${errors
              .slice(0, 3)
              .map((e) => e.message)
              .join("; ")}`
          : undefined;

      const metadata = this.buildRepositoryMetadata({
        name: repositoryName,
        url,
        cloneResult,
        stats,
        collectionName,
        options,
        errorMessage,
      });

      await this.repositoryService.updateRepository(metadata);

      this.logger.info("Repository metadata updated", {
        repository: repositoryName,
      });

      // Determine final status
      const status: "success" | "partial" | "failed" =
        errors.length === 0 ? "success" : stats.filesProcessed > 0 ? "partial" : "failed";

      stats.durationMs = performance.now() - startTime;

      this.logger.info("Indexing completed", {
        metric: "indexing_duration_ms",
        value: stats.durationMs,
        repository: repositoryName,
        status,
        filesProcessed: stats.filesProcessed,
        chunksCreated: stats.chunksCreated,
        errorCount: errors.length,
      });

      return {
        status,
        repository: repositoryName,
        collectionName,
        stats,
        errors,
        completedAt: new Date(),
      };
    } catch (error) {
      // Fatal error - return failed result instead of throwing
      const durationMs = performance.now() - startTime;
      this.logger.error("Fatal error during indexing", {
        error,
        repository: repositoryName,
        durationMs,
      });

      // Record fatal error
      const fatalError: IndexError = {
        type: "fatal_error",
        message: error instanceof Error ? error.message : String(error),
        originalError: error,
      };

      // If error is one of our custom errors, rethrow it
      if (
        error instanceof RepositoryAlreadyExistsError ||
        error instanceof IndexingInProgressError
      ) {
        throw error;
      }

      // Otherwise return failed result
      return {
        status: "failed",
        repository: repositoryName || "unknown",
        collectionName: collectionName || "",
        stats: { ...stats, durationMs },
        errors: [...errors, fatalError],
        completedAt: new Date(),
      };
    } finally {
      // Always clear indexing state
      this._isIndexing = false;
      this._currentOperation = null;
    }
  }

  /**
   * Reindex an existing repository
   *
   * Convenience method that calls indexRepository with force: true
   *
   * @param url - Git repository URL
   * @param options - Indexing options (force flag is automatically set)
   * @returns IndexResult with status, stats, and any errors
   */
  async reindexRepository(url: string, options: IndexOptions = {}): Promise<IndexResult> {
    return this.indexRepository(url, { ...options, force: true });
  }

  /**
   * Remove a repository and its indexed data
   *
   * Deletes the ChromaDB collection and removes repository metadata.
   * Does not delete cloned files from disk.
   *
   * @param name - Repository name to remove
   *
   * @throws {IngestionError} If repository not found
   * @throws {IngestionError} If removal attempted during active indexing
   */
  async removeRepository(name: string): Promise<void> {
    this.logger.info("Removing repository", { repository: name });

    // Check if currently indexing this repository
    if (this._isIndexing && this._currentOperation?.repository === name) {
      throw new IngestionError(
        `Cannot remove repository '${name}': indexing in progress`,
        true // Retryable - can retry after indexing completes
      );
    }

    try {
      // Get repository metadata
      const repo = await this.repositoryService.getRepository(name);
      if (!repo) {
        throw new IngestionError(`Repository '${name}' not found`, false);
      }

      // Delete ChromaDB collection
      const collectionName = this.sanitizeCollectionName(name);
      try {
        await this.storageClient.deleteCollection(collectionName);
        this.logger.info("ChromaDB collection deleted", { collectionName });
      } catch (err) {
        // Collection might not exist, log but continue
        this.logger.warn("Collection deletion failed", {
          collectionName,
          error: err,
        });
      }

      // Remove metadata
      await this.repositoryService.removeRepository(name);

      this.logger.info("Repository removed successfully", { repository: name });
    } catch (error) {
      this.logger.error("Failed to remove repository", {
        repository: name,
        error,
      });

      // If it's already an IngestionError, rethrow
      if (error instanceof IngestionError) {
        throw error;
      }

      // Otherwise wrap it
      throw new IngestionError(`Failed to remove repository '${name}'`, false, error);
    }
  }

  /**
   * Get current ingestion status
   *
   * Returns information about any ongoing indexing operation
   *
   * @returns Current status including operation details if indexing
   */
  getStatus(): IngestionStatus {
    return {
      isIndexing: this._isIndexing,
      currentOperation: this._currentOperation ? { ...this._currentOperation } : null,
    };
  }

  /**
   * Process a batch of files through the complete pipeline
   *
   * For each file:
   * 1. Read file contents
   * 2. Chunk file with FileChunker
   * 3. Generate embeddings (in sub-batches of 100)
   * 4. Store documents in ChromaDB
   *
   * Continues processing on individual file errors
   *
   * @param files - Array of FileInfo to process
   * @param _repoPath - Local repository path (unused, kept for future use)
   * @param repositoryName - Repository name
   * @param collectionName - ChromaDB collection name
   * @param context - Batch context (index, total, progress callback)
   * @returns BatchResult with stats and errors
   */
  private async processFileBatch(
    files: FileInfo[],
    _repoPath: string,
    repositoryName: string,
    collectionName: string,
    context: {
      batchIndex: number;
      totalBatches: number;
      onProgress: (
        phase: "chunking" | "embedding" | "storing",
        details: Record<string, number>
      ) => void;
    }
  ): Promise<BatchResult> {
    const result: BatchResult = {
      filesProcessed: 0,
      filesFailed: 0,
      chunksCreated: 0,
      embeddingsGenerated: 0,
      documentsStored: 0,
      errors: [],
    };

    const allChunks: FileChunk[] = [];

    // Phase 1: Chunk files
    context.onProgress("chunking", {
      filesProcessed: 0,
      totalFiles: files.length,
    });

    for (const fileInfo of files) {
      try {
        const content = await Bun.file(fileInfo.absolutePath).text();
        const chunks = this.fileChunker.chunkFile(content, fileInfo, repositoryName);
        allChunks.push(...chunks);
        result.filesProcessed++;
        result.chunksCreated += chunks.length;
      } catch (error) {
        // Individual file error - log and continue
        this.logger.warn("Failed to chunk file", {
          file: fileInfo.relativePath,
          error,
        });
        result.filesFailed++;
        result.errors.push({
          type: "file_error",
          filePath: fileInfo.relativePath,
          message:
            error instanceof Error
              ? `Chunking failed: ${error.message}`
              : `Chunking failed: ${String(error)}`,
          originalError: error,
        });
      }
    }

    if (allChunks.length === 0) {
      // No chunks to process - return early
      this.logger.debug("No chunks created in batch", {
        batchIndex: context.batchIndex,
        filesAttempted: files.length,
        filesFailed: result.filesFailed,
      });
      return result;
    }

    // Phase 2: Generate embeddings (in batches of EMBEDDING_BATCH_SIZE)
    context.onProgress("embedding", { chunksCreated: allChunks.length });

    const embeddingBatches = this.createBatches(
      allChunks.map((c) => c.content),
      this.EMBEDDING_BATCH_SIZE
    );

    const allEmbeddings: number[][] = [];

    for (const embeddingBatch of embeddingBatches) {
      const embeddings = await this.embeddingProvider.generateEmbeddings(embeddingBatch);
      allEmbeddings.push(...embeddings);
      result.embeddingsGenerated += embeddings.length;
    }

    // Phase 3: Store in ChromaDB
    context.onProgress("storing", {
      embeddingsGenerated: allEmbeddings.length,
    });

    const documents: DocumentInput[] = allChunks.map((chunk, index) => {
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
          file_size_bytes: chunk.metadata.fileSizeBytes,
          content_hash: chunk.metadata.contentHash,
          indexed_at: new Date().toISOString(),
          file_modified_at: chunk.metadata.fileModifiedAt.toISOString(),
        },
      };
    });

    await this.storageClient.addDocuments(collectionName, documents);
    result.documentsStored = documents.length;

    this.logger.debug("Batch processed successfully", {
      batchIndex: context.batchIndex,
      filesProcessed: result.filesProcessed,
      chunksCreated: result.chunksCreated,
      documentsStored: result.documentsStored,
    });

    return result;
  }

  /**
   * Validate repository URL
   *
   * Checks for valid Git URL patterns (https or git@)
   *
   * @param url - URL to validate
   * @throws {IngestionError} If URL is invalid
   */
  private validateUrl(url: string): void {
    if (!url || typeof url !== "string") {
      throw new IngestionError("Invalid repository URL: must be a non-empty string", false);
    }

    // Check for common Git URL patterns
    // Matches either:
    // 1. URLs ending with .git (https://... or git@...)
    // 2. URLs containing github/gitlab/bitbucket (https://... or git@...)
    const gitUrlPattern =
      /^(https?:\/\/|git@).+\.git$|^(https?:\/\/|git@).*(github|gitlab|bitbucket)/i;
    if (!gitUrlPattern.test(url)) {
      throw new IngestionError(
        `Invalid repository URL format: ${url}. Expected Git URL (https or git@).`,
        false
      );
    }
  }

  /**
   * Extract repository name from URL
   *
   * Examples:
   * - https://github.com/owner/repo.git → repo
   * - git@github.com:owner/repo.git → repo
   *
   * @param url - Repository URL
   * @returns Repository name
   * @throws {IngestionError} If name cannot be extracted
   */
  private extractRepositoryName(url: string): string {
    const match = url.match(/\/([^/]+?)(\.git)?$/);
    if (!match || !match[1]) {
      throw new IngestionError(`Cannot extract repository name from URL: ${url}`, false);
    }

    return match[1].replace(".git", "");
  }

  /**
   * Sanitize repository name for ChromaDB collection name
   *
   * ChromaDB requirements:
   * - 3-63 characters
   * - Start/end with alphanumeric
   * - Can contain alphanumeric, underscores, hyphens, dots
   *
   * @param name - Repository name
   * @returns Sanitized collection name
   */
  private sanitizeCollectionName(name: string): string {
    let sanitized = name
      .toLowerCase()
      .replace(/[^a-z0-9_.-]/g, "_")
      .replace(/^[^a-z0-9]+/, "")
      .replace(/[^a-z0-9]+$/, "");

    // Ensure minimum length
    if (sanitized.length < 3) {
      sanitized = sanitized.padEnd(3, "_");
    }

    // Ensure maximum length
    if (sanitized.length > 63) {
      sanitized = sanitized.substring(0, 63);
    }

    return sanitized;
  }

  /**
   * Update progress and invoke callback if provided
   *
   * Updates internal state and invokes optional progress callback.
   * Catches and logs callback errors to prevent breaking the pipeline.
   *
   * @param progress - Progress information
   * @param options - Index options (containing callback)
   */
  private updateProgress(progress: IndexProgress, options: IndexOptions): void {
    // Update internal state
    if (this._currentOperation) {
      this._currentOperation.phase = progress.phase;
      this._currentOperation.progress = progress;
    }

    // Invoke callback if provided
    if (options.onProgress) {
      try {
        options.onProgress(progress);
      } catch (error) {
        // Don't let callback errors break the pipeline
        this.logger.warn("Progress callback error", { error });
      }
    }
  }

  /**
   * Create batches from an array
   *
   * @param items - Array to batch
   * @param batchSize - Size of each batch
   * @returns Array of batches
   */
  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * Build repository metadata object
   *
   * @param params - Parameters for building metadata
   * @returns RepositoryInfo object for storage
   */
  private buildRepositoryMetadata(params: {
    name: string;
    url: string;
    cloneResult: CloneResult;
    stats: IndexResult["stats"];
    collectionName: string;
    options: IndexOptions;
    errorMessage?: string;
  }): RepositoryInfo {
    return {
      name: params.name,
      url: params.url,
      branch: params.cloneResult.branch,
      localPath: params.cloneResult.path,
      collectionName: params.collectionName,
      fileCount: params.stats.filesProcessed,
      chunkCount: params.stats.chunksCreated,
      lastIndexedAt: new Date().toISOString(),
      indexDurationMs: params.stats.durationMs,
      status: params.stats.filesFailed > 0 ? "error" : "ready",
      errorMessage: params.errorMessage,
      includeExtensions: params.options.includeExtensions || [],
      excludePatterns: params.options.excludePatterns || [],
    };
  }
}
