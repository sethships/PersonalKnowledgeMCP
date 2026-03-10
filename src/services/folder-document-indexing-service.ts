/**
 * @module services/folder-document-indexing-service
 *
 * Integration service that wires ChangeDetectionService → ProcessingQueue →
 * IncrementalUpdatePipeline for watched folder document indexing.
 *
 * This service bridges the gap between file change detection and the incremental
 * update pipeline by:
 * 1. Registering watched folders as repository contexts
 * 2. Converting DetectedChange events to FileChange format
 * 3. Performing content hash pre-checks to skip unchanged files
 * 4. Batching changes through a ProcessingQueue
 * 5. Forwarding batches to IncrementalUpdatePipeline per folder
 *
 * Pipeline flow:
 *   FolderWatcherService
 *     → ChangeDetectionService (categorizes: add/modify/delete/rename)
 *       → FolderDocumentIndexingService.handleDetectedChange() [enqueues]
 *         → ProcessingQueue (batches with debounce/retry)
 *           → BatchProcessor callback → IncrementalUpdatePipeline.processChanges()
 */

import { createHash } from "node:crypto";
import type { Logger } from "pino";
import { getComponentLogger } from "../logging/index.js";
import type { ChromaStorageClient } from "../storage/types.js";
import type { DetectedChange } from "./change-detection-types.js";
import type { FileChange, UpdateOptions } from "./incremental-update-types.js";
import type { IncrementalUpdatePipeline } from "./incremental-update-pipeline.js";
import type { BatchProcessorResult } from "./processing-queue-types.js";
import { ProcessingQueue } from "./processing-queue.js";
import type { WatchedFolder } from "./folder-watcher-types.js";
import type {
  FolderIndexingConfig,
  FolderContext,
  ContentHashCheckResult,
  FolderIndexingResult,
} from "./folder-document-indexing-types.js";
import { DEFAULT_FOLDER_INDEXING_CONFIG } from "./folder-document-indexing-types.js";
import {
  FolderNotRegisteredError,
  ContentHashCheckError,
} from "./folder-document-indexing-errors.js";

// =============================================================================
// FolderDocumentIndexingService
// =============================================================================

/**
 * Service that integrates folder change detection with the incremental update pipeline.
 *
 * Manages the flow from detected file changes to ChromaDB indexing updates,
 * including content hash optimization to skip re-indexing unchanged files.
 *
 * @example
 * ```typescript
 * const service = new FolderDocumentIndexingService(
 *   pipeline,
 *   chromaClient,
 *   { defaultIncludeExtensions: [".md", ".txt", ".pdf", ".docx"] }
 * );
 *
 * // Register a watched folder
 * service.registerFolder(watchedFolder);
 *
 * // Connect to change detection
 * changeDetectionService.onDetectedChange((change) => {
 *   service.handleDetectedChange(change);
 * });
 *
 * // On shutdown
 * await service.shutdown();
 * ```
 */
export class FolderDocumentIndexingService {
  /** Maximum file size to read for content hash checking (100 MB) */
  private static readonly MAX_HASH_FILE_SIZE = 100 * 1024 * 1024;

  /** Lazy-initialized logger */
  private _logger: Logger | null = null;

  /** Registered folder contexts keyed by folder ID */
  private readonly folderContexts: Map<string, FolderContext> = new Map();

  /** Internal processing queue for batching changes */
  private readonly queue: ProcessingQueue;

  /** Incremental update pipeline for processing file changes */
  private readonly pipeline: IncrementalUpdatePipeline;

  /** ChromaDB client for content hash lookups */
  private readonly storageClient: ChromaStorageClient;

  /** Service configuration with defaults applied */
  private readonly config: Required<
    Pick<FolderIndexingConfig, "defaultIncludeExtensions" | "defaultExcludePatterns">
  > & { queueConfig?: FolderIndexingConfig["queueConfig"] };

  /** Tracks skipped unchanged count across batches for metrics */
  private totalSkippedUnchanged = 0;

  /**
   * Create a new FolderDocumentIndexingService.
   *
   * @param pipeline - IncrementalUpdatePipeline for processing file changes into ChromaDB
   * @param storageClient - ChromaDB client for content hash lookups
   * @param config - Optional configuration overrides
   */
  constructor(
    pipeline: IncrementalUpdatePipeline,
    storageClient: ChromaStorageClient,
    config?: FolderIndexingConfig
  ) {
    this.pipeline = pipeline;
    this.storageClient = storageClient;
    this.config = {
      ...DEFAULT_FOLDER_INDEXING_CONFIG,
      ...config,
    };

    this.queue = new ProcessingQueue(this.createBatchProcessor(), config?.queueConfig);
  }

  // ===========================================================================
  // Logger (lazy initialization)
  // ===========================================================================

  private get logger(): Logger {
    if (!this._logger) {
      this._logger = getComponentLogger("services:folder-document-indexing");
    }
    return this._logger;
  }

  // ===========================================================================
  // Folder Registration
  // ===========================================================================

  /**
   * Register a watched folder for indexing.
   *
   * Sets up the folder-to-repository context mapping so that changes from this
   * folder can be routed to the correct ChromaDB collection.
   *
   * @param folder - The watched folder to register
   */
  registerFolder(folder: WatchedFolder): void {
    const context: FolderContext = {
      folderId: folder.id,
      folderPath: folder.path,
      repositoryName: `folder-${folder.id}`,
      collectionName: `folder_${folder.id}`,
      includeExtensions: this.resolveIncludeExtensions(folder),
      excludePatterns: folder.excludePatterns ?? [...this.config.defaultExcludePatterns],
    };

    this.folderContexts.set(folder.id, context);
    this.logger.info(
      {
        folderId: folder.id,
        folderPath: folder.path,
        repositoryName: context.repositoryName,
        collectionName: context.collectionName,
        extensionCount: context.includeExtensions.length,
      },
      "Folder registered for indexing"
    );
  }

  /**
   * Unregister a watched folder from indexing.
   *
   * Removes the folder context mapping. Any in-flight changes for this folder
   * will fail with FolderNotRegisteredError when processed.
   *
   * @param folderId - The ID of the folder to unregister
   */
  unregisterFolder(folderId: string): void {
    const removed = this.folderContexts.delete(folderId);
    if (removed) {
      this.logger.info({ folderId }, "Folder unregistered from indexing");
    } else {
      this.logger.debug({ folderId }, "Attempted to unregister unknown folder");
    }
  }

  /**
   * Get the folder context for a registered folder.
   *
   * @param folderId - The folder ID to look up
   * @returns FolderContext or undefined if not registered
   */
  getFolderContext(folderId: string): FolderContext | undefined {
    return this.folderContexts.get(folderId);
  }

  /**
   * Get all registered folder contexts.
   *
   * @returns Map of folderId to FolderContext
   */
  getRegisteredFolders(): ReadonlyMap<string, FolderContext> {
    return this.folderContexts;
  }

  // ===========================================================================
  // Change Handling
  // ===========================================================================

  /**
   * Handle a detected change by enqueuing it for batch processing.
   *
   * This is the entry point for the ChangeDetectionService → ProcessingQueue flow.
   * The change is added to the internal queue and will be processed when the
   * batch timer fires.
   *
   * @param change - The detected change from ChangeDetectionService
   * @throws FolderNotRegisteredError if the change's folder is not registered
   */
  handleDetectedChange(change: DetectedChange): void {
    // Validate that the folder is registered
    const context = this.folderContexts.get(change.folderId);
    if (!context) {
      throw new FolderNotRegisteredError(change.folderId);
    }

    this.logger.debug(
      {
        category: change.category,
        path: change.relativePath,
        folderId: change.folderId,
      },
      "Enqueueing detected change for indexing"
    );

    this.queue.enqueue(change);
  }

  // ===========================================================================
  // Queue Access
  // ===========================================================================

  /**
   * Get the internal processing queue for status/metrics inspection.
   *
   * @returns The ProcessingQueue instance
   */
  getQueue(): ProcessingQueue {
    return this.queue;
  }

  /**
   * Get the total number of files skipped due to unchanged content hash.
   *
   * @returns Count of skipped unchanged files
   */
  getTotalSkippedUnchanged(): number {
    return this.totalSkippedUnchanged;
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Gracefully shut down the service.
   *
   * Drains the processing queue, processing all remaining items before stopping.
   */
  async shutdown(): Promise<void> {
    this.logger.info(
      { registeredFolders: this.folderContexts.size },
      "Shutting down FolderDocumentIndexingService"
    );
    await this.queue.shutdown();
    this.logger.info("FolderDocumentIndexingService shut down");
  }

  // ===========================================================================
  // Batch Processing
  // ===========================================================================

  /**
   * Create the batch processor callback for the ProcessingQueue.
   *
   * Groups changes by folderId, converts them to FileChange format,
   * performs content hash checks for modified files, and forwards
   * each group to the IncrementalUpdatePipeline.
   *
   * @returns BatchProcessor callback function
   */
  private createBatchProcessor(): (changes: DetectedChange[]) => Promise<BatchProcessorResult> {
    return async (changes: DetectedChange[]): Promise<BatchProcessorResult> => {
      const startTime = Date.now();
      let totalProcessed = 0;
      let totalErrors = 0;
      let totalSkipped = 0;
      const allErrors: Array<{ change: DetectedChange; error: string }> = [];

      // Group changes by folderId
      const grouped = this.groupChangesByFolder(changes);

      for (const [folderId, folderChanges] of grouped) {
        const context = this.folderContexts.get(folderId);
        if (!context) {
          // Folder was unregistered between enqueue and processing
          for (const change of folderChanges) {
            allErrors.push({
              change,
              error: `Folder '${folderId}' is no longer registered`,
            });
          }
          totalErrors += folderChanges.length;
          continue;
        }

        try {
          const result = await this.processFolderBatch(context, folderChanges);
          totalProcessed += result.processedCount;
          totalErrors += result.errorCount;
          totalSkipped += result.skippedUnchanged;

          for (const err of result.errors) {
            // Find the original DetectedChange for this error
            const matchingChange = folderChanges.find((c) => c.relativePath === err.path);
            if (matchingChange) {
              allErrors.push({ change: matchingChange, error: err.error });
            }
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          this.logger.error(
            { folderId, error: errorMsg, changeCount: folderChanges.length },
            "Failed to process folder batch"
          );
          for (const change of folderChanges) {
            allErrors.push({ change, error: errorMsg });
          }
          totalErrors += folderChanges.length;
        }
      }

      this.totalSkippedUnchanged += totalSkipped;

      const durationMs = Date.now() - startTime;
      this.logger.info(
        {
          processedCount: totalProcessed,
          errorCount: totalErrors,
          skippedUnchanged: totalSkipped,
          durationMs,
        },
        "Batch processing complete"
      );

      return {
        processedCount: totalProcessed,
        errorCount: totalErrors,
        errors: allErrors,
      };
    };
  }

  // ===========================================================================
  // Internal Processing
  // ===========================================================================

  /**
   * Process a batch of changes for a single folder.
   *
   * Converts DetectedChange[] to FileChange[], performs content hash checks
   * for modified files, and calls IncrementalUpdatePipeline.processChanges().
   *
   * @param context - The folder context with repository/collection info
   * @param changes - Array of detected changes for this folder
   * @returns Processing result with content hash optimization stats
   */
  private async processFolderBatch(
    context: FolderContext,
    changes: DetectedChange[]
  ): Promise<FolderIndexingResult> {
    let skippedUnchanged = 0;
    const errors: Array<{ path: string; error: string }> = [];

    // Convert and filter changes
    const fileChanges: FileChange[] = [];

    for (const change of changes) {
      // For modified files, check content hash before processing
      if (change.category === "modified") {
        try {
          const hashResult = await this.checkContentHash(
            change.absolutePath,
            context.repositoryName,
            context.collectionName,
            change.relativePath
          );

          if (hashResult.unchanged) {
            skippedUnchanged++;
            this.logger.debug(
              { path: change.relativePath, hash: hashResult.computedHash.substring(0, 8) },
              "Skipping unchanged file (content hash match)"
            );
            continue;
          }
        } catch (error) {
          // Hash check failed — proceed with re-indexing (safe fallback)
          const errorMsg = error instanceof Error ? error.message : String(error);
          this.logger.warn(
            { path: change.relativePath, error: errorMsg },
            "Content hash check failed, proceeding with re-index"
          );
        }
      }

      fileChanges.push(this.convertChange(change));
    }

    // If all changes were skipped, return early
    if (fileChanges.length === 0) {
      return {
        processedCount: 0,
        errorCount: 0,
        skippedUnchanged,
        errors: [],
      };
    }

    // Build update options for the pipeline
    const updateOptions: UpdateOptions = {
      repository: context.repositoryName,
      localPath: context.folderPath,
      collectionName: context.collectionName,
      includeExtensions: context.includeExtensions,
      excludePatterns: context.excludePatterns,
      correlationId: `folder-${context.folderId}-${Date.now()}`,
    };

    // Process through the incremental update pipeline
    const result = await this.pipeline.processChanges(fileChanges, updateOptions);

    // Collect any pipeline errors
    for (const pipelineError of result.errors) {
      errors.push({ path: pipelineError.path, error: pipelineError.error });
    }

    const processedCount =
      result.stats.filesAdded + result.stats.filesModified + result.stats.filesDeleted;

    return {
      processedCount,
      errorCount: result.errors.length,
      skippedUnchanged,
      errors,
    };
  }

  // ===========================================================================
  // Change Conversion
  // ===========================================================================

  /**
   * Convert a DetectedChange to a FileChange for the incremental update pipeline.
   *
   * Type mapping:
   * - DetectedChange.category → FileChange.status (same values)
   * - DetectedChange.relativePath → FileChange.path
   * - DetectedChange.previousRelativePath → FileChange.previousPath
   *
   * @param change - The detected change to convert
   * @returns FileChange compatible with IncrementalUpdatePipeline
   */
  convertChange(change: DetectedChange): FileChange {
    const fileChange: FileChange = {
      path: change.relativePath,
      status: change.category,
    };

    if (change.category === "renamed" && change.previousRelativePath) {
      fileChange.previousPath = change.previousRelativePath;
    }

    return fileChange;
  }

  /**
   * Convert an array of DetectedChanges to FileChanges.
   *
   * @param changes - Array of detected changes
   * @returns Array of FileChanges
   */
  convertChanges(changes: DetectedChange[]): FileChange[] {
    return changes.map((change) => this.convertChange(change));
  }

  // ===========================================================================
  // Content Hash Check
  // ===========================================================================

  /**
   * Check if a file's content has changed by comparing SHA-256 hashes.
   *
   * 1. Reads file content and computes SHA-256 hash
   * 2. Queries ChromaDB for existing chunks with matching file path and repository
   * 3. Compares stored content_hash with computed hash
   * 4. Returns whether the content is unchanged
   *
   * @param absolutePath - Absolute path to the file on disk
   * @param repository - Repository name for ChromaDB query
   * @param collectionName - ChromaDB collection name
   * @param relativePath - Relative path for ChromaDB metadata query
   * @returns ContentHashCheckResult with comparison details
   * @throws ContentHashCheckError if file read or ChromaDB query fails
   */
  async checkContentHash(
    absolutePath: string,
    repository: string,
    collectionName: string,
    relativePath: string
  ): Promise<ContentHashCheckResult> {
    try {
      // Step 1: Check file size before reading (guard against OOM for large files)
      const file = Bun.file(absolutePath);
      const fileSize = file.size;
      if (fileSize > FolderDocumentIndexingService.MAX_HASH_FILE_SIZE) {
        this.logger.warn(
          {
            path: relativePath,
            sizeBytes: fileSize,
            maxBytes: FolderDocumentIndexingService.MAX_HASH_FILE_SIZE,
          },
          "File exceeds maximum size for content hash check, skipping hash comparison"
        );
        return { unchanged: false, computedHash: "", storedHash: null };
      }

      // Step 2: Read file as raw bytes and compute hash (binary-safe for PDF/DOCX)
      const buffer = Buffer.from(await file.arrayBuffer());
      const computedHash = createHash("sha256").update(buffer).digest("hex");

      // Step 3: Query ChromaDB for existing chunks
      let storedHash: string | null = null;
      try {
        const existingDocs = await this.storageClient.getDocumentsByMetadata(collectionName, {
          $and: [{ file_path: relativePath }, { repository }],
        });

        // Get content_hash from the first chunk (all chunks of the same file share the same hash)
        if (existingDocs.length > 0 && existingDocs[0]) {
          storedHash = existingDocs[0].metadata.content_hash ?? null;
        }
      } catch {
        // Collection may not exist yet (first index) — treat as no stored hash
        this.logger.debug(
          { collectionName, relativePath },
          "Could not query existing chunks (collection may not exist yet)"
        );
      }

      // Step 4: Compare hashes
      const unchanged = storedHash !== null && storedHash === computedHash;

      return { unchanged, computedHash, storedHash };
    } catch (error) {
      if (error instanceof ContentHashCheckError) {
        throw error;
      }
      throw new ContentHashCheckError(
        relativePath,
        error instanceof Error ? error.message : String(error),
        true,
        error instanceof Error ? error : undefined
      );
    }
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  /**
   * Group changes by their folder ID.
   *
   * @param changes - Array of detected changes
   * @returns Map of folderId to array of changes
   */
  private groupChangesByFolder(changes: DetectedChange[]): Map<string, DetectedChange[]> {
    const grouped = new Map<string, DetectedChange[]>();
    for (const change of changes) {
      const existing = grouped.get(change.folderId);
      if (existing) {
        existing.push(change);
      } else {
        grouped.set(change.folderId, [change]);
      }
    }
    return grouped;
  }

  /**
   * Resolve include extensions for a folder.
   *
   * Converts WatchedFolder.includePatterns (glob patterns like "*.md") to
   * extension format (like ".md") and falls back to defaults if none specified.
   *
   * @param folder - The watched folder
   * @returns Array of file extensions with leading dots
   */
  private resolveIncludeExtensions(folder: WatchedFolder): string[] {
    if (folder.includePatterns && folder.includePatterns.length > 0) {
      // Convert glob patterns like "*.md", "**/*.md" to extensions like ".md"
      const extensions: string[] = [];
      for (const pattern of folder.includePatterns) {
        // Match patterns ending in *.ext (covers *.md, **/*.md, src/**/*.txt, etc.)
        const match = pattern.match(/\*(\.\w+)$/);
        if (match?.[1]) {
          extensions.push(match[1]);
        } else {
          this.logger.warn(
            { pattern },
            "Could not extract file extension from include pattern; pattern will be ignored for extension filtering"
          );
        }
      }
      // Fall back to defaults if no valid extensions extracted
      return extensions.length > 0 ? extensions : [...this.config.defaultIncludeExtensions];
    }
    return [...this.config.defaultIncludeExtensions];
  }
}
