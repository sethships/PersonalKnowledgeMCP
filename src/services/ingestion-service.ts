/**
 * IngestionService - Orchestrates repository indexing workflow
 *
 * Coordinates the complete pipeline from cloning repositories to storing
 * embeddings in ChromaDB. Provides progress reporting, error handling,
 * and support for reindexing and removal operations.
 *
 * @module services/ingestion-service
 */

import { resolve, basename, normalize, join, sep, relative, posix } from "node:path";
import { stat, readdir } from "node:fs/promises";
import { isLocalPath, canonicalizePathForComparison } from "../utils/path-utils.js";
import simpleGit from "simple-git";
import { GitignoreFilter } from "../ingestion/gitignore-filter.js";
import {
  shouldDescendDir,
  shouldIncludeFile,
  DEFAULT_MAX_FILE_SIZE_BYTES,
  type DirEntryLike,
} from "../ingestion/file-eligibility.js";
import { streamSha256 } from "../ingestion/sha256-stream.js";
import {
  FileManifestStoreImpl,
  type FileManifest,
  type FileManifestEntry,
  FILE_MANIFEST_VERSION,
} from "./file-manifest-store.js";
import type { Logger } from "pino";
import type { RepositoryCloner } from "../ingestion/repository-cloner.js";
import type { CloneResult, FileInfo, FileChunk } from "../ingestion/types.js";
import type { FileScanner } from "../ingestion/file-scanner.js";
import type { FileChunker } from "../ingestion/file-chunker.js";
import type { EmbeddingProvider } from "../providers/types.js";
import type {
  ChromaStorageClient,
  DocumentInput,
  CollectionEmbeddingMetadata,
} from "../storage/types.js";
import type { RepositoryMetadataService, RepositoryInfo } from "../repositories/types.js";
import { getComponentLogger } from "../logging/index.js";
import { DEFAULT_EXTENSIONS } from "../ingestion/default-extensions.js";
import type {
  IndexOptions,
  IndexProgress,
  IndexResult,
  IndexError,
  IngestionStatus,
  BatchResult,
  InternalChunk,
} from "./ingestion-types.js";
import {
  IngestionError,
  RepositoryAlreadyExistsError,
  IndexingInProgressError,
  CollectionCreationError,
  LocalFolderPublicTierRefusedError,
  LocalFolderPathAlreadyRegisteredError,
  LocalFolderSizeRefusedError,
} from "./ingestion-errors.js";
import type { DocumentChunker } from "../documents/DocumentChunker.js";
import type { DocumentTypeDetector } from "../documents/DocumentTypeDetector.js";
import type { ExtractionResult } from "../documents/types.js";
import type { GraphIngestionService } from "../graph/ingestion/GraphIngestionService.js";
import type { DocExtractionResult } from "../graph/extraction/doc-types.js";
import type { FileInput } from "../graph/ingestion/types.js";
import { DocGraphBatcher } from "../graph/extraction/doc-graph-batch.js";

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

  /**
   * Timeout for embedding API calls in milliseconds (2 minutes)
   * Prevents hanging on slow or unresponsive API calls
   */
  private readonly EMBEDDING_TIMEOUT_MS = 120000;

  /**
   * Optional document chunker for document-aware chunking.
   * When provided alongside documentTypeDetector, document files
   * (PDF, DOCX, MD, TXT) are routed through the document chunking pipeline.
   */
  private readonly documentChunker?: DocumentChunker;

  /**
   * Optional document type detector for identifying document files.
   * Works in tandem with documentChunker to route files appropriately.
   */
  private readonly documentTypeDetector?: DocumentTypeDetector;

  /**
   * Optional graph ingestion service. When provided, `indexRepository`
   * also populates the code graph (`ingestFiles`) and document graph
   * (`ingestDocumentGraph`) after batch chunking + embedding completes.
   * When unset, indexing remains ChromaDB-only and the operator is expected
   * to populate the graph separately via `cli graph populate`.
   */
  private readonly graphIngestionService?: GraphIngestionService;

  /** Lazily created on first use during `processFileBatch`. */
  private readonly docGraphBatcher = new DocGraphBatcher();

  constructor(
    private readonly repositoryCloner: RepositoryCloner,
    private readonly fileScanner: FileScanner,
    private readonly fileChunker: FileChunker,
    private readonly embeddingProvider: EmbeddingProvider,
    private readonly storageClient: ChromaStorageClient,
    private readonly repositoryService: RepositoryMetadataService,
    options?: {
      documentChunker?: DocumentChunker;
      documentTypeDetector?: DocumentTypeDetector;
      graphIngestionService?: GraphIngestionService;
    }
  ) {
    this.documentChunker = options?.documentChunker;
    this.documentTypeDetector = options?.documentTypeDetector;
    this.graphIngestionService = options?.graphIngestionService;
  }

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
    let clonePath: string | null = null; // Track cloned directory for cleanup
    let indexingSucceeded = false; // Track if indexing completed successfully

    try {
      // Pre-flight checks
      this.validateUrl(url);
      repositoryName = options.name || this.extractRepositoryName(url);
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

      // Set indexing state immediately to prevent race conditions
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

      // Check if repository already exists (unless force flag set)
      if (!options.force) {
        const existing = await this.repositoryService.getRepository(repositoryName);
        if (existing) {
          throw new RepositoryAlreadyExistsError(repositoryName);
        }
      }

      // Phase 1: Clone repository (or resolve local path)
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

      let cloneResult: CloneResult;
      // Source discriminator threaded through to buildRepositoryMetadata. The
      // remote-clone branch always produces "git-remote"; the local-path branch
      // distinguishes "local-git" (has a `.git` directory) from "local-folder"
      // (no git history — change detection happens via FileManifest instead).
      let effectiveSource: "git-remote" | "local-git" | "local-folder" = "git-remote";

      if (isLocalPath(url)) {
        const resolvedPath = normalize(resolve(url));

        try {
          const pathStat = await stat(resolvedPath);
          if (!pathStat.isDirectory()) {
            throw new IngestionError(`Local path is not a directory: ${resolvedPath}`, false);
          }
        } catch (err) {
          if (err instanceof IngestionError) throw err;
          throw new IngestionError(
            `Local path does not exist or is not accessible: ${resolvedPath}`,
            false
          );
        }

        const hasGitDir = await this.directoryHasGitFolder(resolvedPath);
        effectiveSource = hasGitDir ? "local-git" : "local-folder";

        // Tier refusal: local folders may not register at the public tier. We
        // check before any heavy work so a misconfigured request fails fast.
        const requestedTier = options.tier ?? "private";
        if (effectiveSource === "local-folder" && requestedTier === "public") {
          throw new LocalFolderPublicTierRefusedError(repositoryName);
        }

        // Duplicate-path detection (Phase C, T4.2): reject when this absolute
        // path is already registered under a different name. The name-based
        // collision check above (line ~239) catches re-registrations with the
        // same name; this catches the user pointing two distinct names at the
        // same on-disk folder, which would have two coordinators racing on the
        // same FileManifest. Skipped under `force: true` because the user is
        // explicitly asking to reindex the existing entry. Comparison is
        // canonicalised so different separator/case representations of the
        // same path collide on Windows (NTFS is case-insensitive).
        if (effectiveSource === "local-folder" && !options.force) {
          const canonical = canonicalizePathForComparison(resolvedPath);
          const allRepos = await this.repositoryService.listRepositories();
          for (const existing of allRepos) {
            if (existing.source !== "local-folder") continue;
            if (existing.name === repositoryName) continue;
            if (canonicalizePathForComparison(existing.localPath) === canonical) {
              throw new LocalFolderPathAlreadyRegisteredError(resolvedPath, existing.name);
            }
          }
        }

        let branch = options.branch ?? "unknown";
        let commitSha: string | undefined;

        if (hasGitDir) {
          // Existing local-git behavior: read git metadata in place.
          const git = simpleGit(resolvedPath);
          try {
            branch = options.branch ?? (await git.revparse(["--abbrev-ref", "HEAD"])).trim();
            commitSha = (await git.revparse(["HEAD"])).trim();
          } catch {
            this.logger.warn({ resolvedPath }, "Could not read git metadata from local path");
          }
        } else {
          // local-folder: skip every simple-git call (no .git to read). The
          // display branch is a fixed sentinel; real change detection runs
          // through LocalFolderChangeDetector + FileManifest.
          branch = options.branch ?? "(local-folder)";
          commitSha = undefined;

          // Size pre-scan and hard-refusal happen before we sink time into
          // FileScanner / chunking / embeddings. Soft-warn thresholds are
          // logged; hard-refuse throws unless options.force is set.
          await this.enforceLocalFolderSizeGuardrails(repositoryName, resolvedPath, options);
        }

        cloneResult = { path: resolvedPath, name: repositoryName, branch, commitSha };
        // Do not set clonePath — we must not clean up a local directory on failure

        this.logger.info("Using local repository path", {
          repository: repositoryName,
          path: resolvedPath,
          source: effectiveSource,
          branch,
          commitSha,
        });
      } else {
        effectiveSource = "git-remote";
        const remote = await this.repositoryCloner.clone(url, {
          branch: options.branch,
          fetchLatest: options.force, // Fetch latest when force reindexing
        });
        clonePath = remote.path; // Store for cleanup if needed
        cloneResult = remote;

        this.logger.info("Repository cloned", {
          repository: repositoryName,
          path: cloneResult.path,
          branch: cloneResult.branch,
        });
      }

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
        // Walk every nested .gitignore for local sources — users routinely have
        // them in monorepos and vendored docs. Git-remote shallow clones already
        // exclude ignored files at clone time, so the cheap root-only path is
        // preserved there.
        respectNestedGitignore:
          effectiveSource === "local-folder" || effectiveSource === "local-git",
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
        // Build embedding metadata for provider-aware search
        const embeddingMetadata: CollectionEmbeddingMetadata = {
          "app:embedding_provider": this.embeddingProvider.providerId,
          "app:embedding_model": this.embeddingProvider.modelId,
          "app:embedding_dimensions": this.embeddingProvider.dimensions,
        };

        await this.storageClient.getOrCreateCollection(collectionName, embeddingMetadata);
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

      // Accumulator for files that completed the full chunk → embed → store
      // pipeline (PR #573 review M-3). Only these get fingerprinted in the
      // initial FileManifest for `local-folder` repos; files that errored out
      // are deliberately omitted so the next incremental update treats them
      // as "added" and retries.
      const processedRelativePaths: string[] = [];

      // Accumulators for the graph step that runs after the batch loop.
      // Populated only when `graphIngestionService` is configured — see
      // `processFileBatch` for the gating.
      const codeFilesForGraph: FileInput[] = [];
      const docExtractionResults: DocExtractionResult[] = [];

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
          processedRelativePaths.push(...batchResult.processedRelativePaths);
          codeFilesForGraph.push(...batchResult.codeFilesForGraph);
          docExtractionResults.push(...batchResult.docExtractionResults);
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

      // Phase 5: Knowledge-graph ingestion (issue #580). Populates the code
      // graph first, then the document graph — the ordering is required by
      // `ingestDocumentGraph` so the two-pass MENTIONS resolution sees the
      // freshly-inserted Function/Class/Module nodes.
      //
      // Both calls are best-effort: graph failures surface as non-fatal
      // `IndexError`s on the result, mirroring the per-file resilience used
      // throughout the rest of the indexing pipeline so that ChromaDB stays
      // populated even if FalkorDB is unhealthy.
      if (this.graphIngestionService) {
        await this.runGraphIngestion(
          repositoryName,
          url,
          codeFilesForGraph,
          docExtractionResults,
          options,
          errors
        );
      }

      // Phase 6: Update repository metadata
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

      // For local-folder sources, write the initial FileManifest before
      // persisting metadata so a crash between manifest-write and metadata-write
      // leaves a recoverable state (next registration sees no metadata, next
      // local-folder update sees a manifest with `generatedAt = epoch sentinel`
      // and treats the repo as new).
      let lastManifestId: string | undefined;
      if (effectiveSource === "local-folder") {
        lastManifestId = await this.writeInitialFileManifest(
          repositoryName,
          cloneResult.path,
          fileInfos,
          new Set(processedRelativePaths)
        );
      }

      const metadata = this.buildRepositoryMetadata({
        name: repositoryName,
        url,
        cloneResult,
        stats,
        collectionName,
        options,
        errorMessage,
        source: effectiveSource,
        tier: options.tier ?? "private",
        lastManifestId,
        // Phase C: persist watcher prefs only for local-folder sources so the
        // MCP server bootstrap can restore active watchers across restarts.
        watchEnabled: effectiveSource === "local-folder" ? (options.watch ?? false) : undefined,
        followSymlinks:
          effectiveSource === "local-folder" ? (options.followSymlinks ?? false) : undefined,
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

      // Mark indexing as successful (prevents cleanup of cloned directory)
      indexingSucceeded = true;

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

      // If error is one of our custom errors, rethrow it. The path-collision
      // error (Phase C) joins this list because the user-corrective fix —
      // unregister or pass `force` on the existing entry — is identical in
      // shape to a name collision; both want the typed error surfaced to the
      // CLI/MCP wrapper rather than the generic `failed` IndexResult.
      if (
        error instanceof RepositoryAlreadyExistsError ||
        error instanceof IndexingInProgressError ||
        error instanceof LocalFolderPathAlreadyRegisteredError
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
      // Clean up cloned repository if indexing failed
      if (clonePath && !indexingSucceeded) {
        try {
          await this.repositoryCloner.cleanup(clonePath);
          this.logger.info("Cleaned up failed indexing", {
            repository: repositoryName,
            path: clonePath,
          });
        } catch (cleanupError) {
          this.logger.warn("Failed to cleanup cloned repository", {
            path: clonePath,
            error: cleanupError,
          });
        }
      }

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

      // Delete the FileManifest, if any. Idempotent — succeeds with no error
      // when the manifest file does not exist (e.g. git-remote / local-git
      // repos that never had one). Without this, re-registering the same name
      // later would load a stale manifest and skip already-changed files.
      try {
        await FileManifestStoreImpl.getInstance().deleteManifest(name);
      } catch (err) {
        this.logger.warn("FileManifest deletion failed (continuing)", {
          repository: name,
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
      processedRelativePaths: [],
      codeFilesForGraph: [],
      docExtractionResults: [],
    };

    const allChunks: InternalChunk[] = [];

    // Track relative paths whose chunks made it into `allChunks`. We only
    // promote these to `processedRelativePaths` after the embed + store phases
    // succeed for the whole batch — partial pipeline success is reported as
    // "no files indexed" so the manifest writer doesn't fingerprint files
    // whose chunks never reached ChromaDB (PR #573 review M-3).
    const chunkedRelativePaths: string[] = [];

    // Phase 1: Chunk files
    context.onProgress("chunking", {
      filesProcessed: 0,
      totalFiles: files.length,
    });

    for (const fileInfo of files) {
      try {
        // Check if file is a document type and we have document processing capabilities
        if (this.isDocumentFile(fileInfo)) {
          const { chunks: docChunks, docExtraction } = await this.processDocumentFile(
            fileInfo.absolutePath,
            fileInfo.relativePath,
            repositoryName
          );
          allChunks.push(...docChunks);
          result.filesProcessed++;
          result.chunksCreated += docChunks.length;
          chunkedRelativePaths.push(fileInfo.relativePath);
          if (docExtraction) {
            result.docExtractionResults.push(docExtraction);
          }
        } else {
          // Existing code path: read as text → FileChunker
          const content = await Bun.file(fileInfo.absolutePath).text();
          const chunks = this.fileChunker.chunkFile(content, fileInfo, repositoryName);
          allChunks.push(...this.convertFileChunksToInternal(chunks));
          result.filesProcessed++;
          result.chunksCreated += chunks.length;
          chunkedRelativePaths.push(fileInfo.relativePath);
          // Capture for the post-batch graph step so it doesn't re-read disk.
          // Only retained when the graph service is configured — otherwise the
          // memory cost of holding every code file's content is wasted.
          if (this.graphIngestionService) {
            result.codeFilesForGraph.push({
              path: fileInfo.relativePath,
              content,
            });
          }
        }
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
      const embeddings = await this.withTimeout(
        this.embeddingProvider.generateEmbeddings(embeddingBatch),
        this.EMBEDDING_TIMEOUT_MS,
        `Embedding generation (batch of ${embeddingBatch.length} texts)`
      );
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

      const metadata: DocumentInput["metadata"] = {
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
      };

      // Enrich with document-specific metadata when available
      if (chunk.documentMetadata) {
        metadata.document_type = chunk.documentMetadata.documentType;
        if (chunk.documentMetadata.pageNumber !== undefined) {
          metadata.page_number = chunk.documentMetadata.pageNumber;
        }
        if (chunk.documentMetadata.sectionHeading !== undefined) {
          metadata.section_heading = chunk.documentMetadata.sectionHeading;
        }
        if (chunk.documentMetadata.documentTitle !== undefined) {
          metadata.document_title = chunk.documentMetadata.documentTitle;
        }
        if (chunk.documentMetadata.documentAuthor !== undefined) {
          metadata.document_author = chunk.documentMetadata.documentAuthor;
        }
      }

      return {
        id: chunk.id,
        content: chunk.content,
        embedding,
        metadata,
      };
    });

    await this.storageClient.addDocuments(collectionName, documents);
    result.documentsStored = documents.length;

    // Storage succeeded — every file whose chunks landed in `allChunks` is
    // now durably persisted. Promote them to `processedRelativePaths` so the
    // initial-manifest writer fingerprints only what's actually indexed.
    result.processedRelativePaths = [...chunkedRelativePaths];

    this.logger.debug("Batch processed successfully", {
      batchIndex: context.batchIndex,
      filesProcessed: result.filesProcessed,
      chunksCreated: result.chunksCreated,
      documentsStored: result.documentsStored,
    });

    return result;
  }

  /**
   * Check if a file should be processed through the document chunking pipeline.
   *
   * Returns true when both documentTypeDetector and documentChunker are available
   * and the file's extension is recognized as a document type.
   *
   * @param fileInfo - File information from the scanner
   * @returns true if the file should be processed as a document
   */
  private isDocumentFile(fileInfo: FileInfo): boolean {
    if (!this.documentTypeDetector || !this.documentChunker) {
      return false;
    }
    return this.documentTypeDetector.isDocument(fileInfo.relativePath);
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
   * @param repositoryName - Repository or source name
   * @returns Array of InternalChunks with document metadata
   * @throws {Error} If no extractor is found or extraction/chunking fails
   */
  private async processDocumentFile(
    absolutePath: string,
    relativePath: string,
    repositoryName: string
  ): Promise<{ chunks: InternalChunk[]; docExtraction: DocExtractionResult | null }> {
    const extractor = this.documentTypeDetector!.getExtractor(absolutePath);
    if (!extractor) {
      throw new Error(`No extractor found for document: ${relativePath}`);
    }

    this.logger.debug("Processing document file", {
      file: relativePath,
      type: this.documentTypeDetector!.detect(absolutePath),
    });

    const extractionResult = (await extractor.extract(absolutePath)) as ExtractionResult;
    const documentChunks = this.documentChunker!.chunkDocument(
      extractionResult,
      relativePath,
      repositoryName
    );

    // Reuse the same extraction to produce the doc-graph payload — markdown
    // file tokens are surfaced on `MarkdownExtractionResult` precisely so we
    // don't re-lex; PDF/DOCX share the parsed `ExtractionResult` directly.
    // Skip when the graph service isn't wired since the result would be
    // discarded anyway.
    const docExtraction = this.graphIngestionService
      ? this.docGraphBatcher.fromExtraction(relativePath, extractionResult)
      : null;

    // Note: Table-related fields (isTable, tableIndex, tableCaption) from
    // DocumentChunkMetadata are intentionally omitted. Table support will be
    // added when the storage schema supports table metadata fields.
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
   * Populate the knowledge graph for a repository after the chunk → embed →
   * store pipeline has completed (issue #580).
   *
   * Order is load-bearing: `ingestFiles` runs first so the in-memory symbol
   * index built inside `ingestDocumentGraph` sees Function/Class/Module nodes,
   * which is the precondition for two-pass MENTIONS resolution.
   *
   * Errors are collected onto the indexing run's error list rather than
   * thrown — graph problems must not invalidate a successful ChromaDB index.
   *
   * @param repository - Repository name (already validated upstream).
   * @param url - Repository URL or local path; required by `ingestFiles` for
   *              the Repository node. Empty strings are tolerated by the
   *              graph layer for local-folder sources.
   * @param codeFiles - Code-file `FileInput`s captured during chunking.
   * @param docResults - Per-doc-file `DocExtractionResult`s captured during
   *                     chunking.
   * @param options - Indexing options (used to forward the progress callback
   *                  through to the graph progress events).
   * @param errors - Indexing error accumulator; mutated on graph failure.
   */
  private async runGraphIngestion(
    repository: string,
    url: string,
    codeFiles: readonly FileInput[],
    docResults: readonly DocExtractionResult[],
    options: IndexOptions,
    errors: IndexError[]
  ): Promise<void> {
    if (!this.graphIngestionService) return;

    if (codeFiles.length > 0) {
      try {
        await this.graphIngestionService.ingestFiles([...codeFiles], {
          repository,
          repositoryUrl: url,
          force: options.force ?? false,
        });
        this.logger.info("Code graph ingestion completed", {
          repository,
          fileCount: codeFiles.length,
        });
      } catch (error) {
        this.logger.error("Code graph ingestion failed", { repository, error });
        errors.push({
          type: "batch_error",
          message: `Code graph ingestion failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
          originalError: error,
        });
      }
    }

    if (docResults.length > 0) {
      try {
        const result = await this.graphIngestionService.ingestDocumentGraph(repository, docResults);
        this.logger.info("Document graph ingestion completed", {
          repository,
          documentsCreated: result.documentsCreated,
          sectionsCreated: result.sectionsCreated,
          edgesCreated: result.edgesCreated,
        });
      } catch (error) {
        this.logger.error("Document graph ingestion failed", { repository, error });
        errors.push({
          type: "batch_error",
          message: `Document graph ingestion failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
          originalError: error,
        });
      }
    }
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

    // Local paths are valid — validated later when we check the directory exists
    if (isLocalPath(url)) return;

    // Structural validation: require owner/repo path segments
    // HTTPS: https://<host>/<owner>/<repo>[.git]
    const httpsPattern = /^https:\/\/[\w.-]+\/[\w][\w.-]*\/[\w][\w.-]*(?:\.git)?$/i;
    // SSH: git@<host>:<owner>/<repo>[.git]
    const sshPattern = /^git@[\w.-]+:[\w][\w.-]*\/[\w][\w.-]*(?:\.git)?$/i;
    if (!httpsPattern.test(url) && !sshPattern.test(url)) {
      throw new IngestionError(
        `Invalid repository URL format: ${url}. Expected a Git URL (https:// or git@) or a local path.`,
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
    if (isLocalPath(url)) {
      // Use the directory name of the resolved path
      const name = basename(normalize(resolve(url)));
      if (!name || name === "." || name === "..") {
        throw new IngestionError(
          `Cannot extract repository name from local path: ${url}. Use --name to specify explicitly.`,
          false
        );
      }
      return name;
    }

    const match = url.match(/[/:]([^/:]+?)(\.git)?$/);
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
   * Wrap a promise with a timeout
   *
   * Returns a promise that rejects if the operation takes longer than the timeout.
   *
   * @param promise - Promise to wrap
   * @param timeoutMs - Timeout in milliseconds
   * @param operationName - Name of the operation for error messages
   * @returns Promise that resolves/rejects with timeout handling
   */
  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    operationName: string
  ): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`${operationName} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]);
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
    /**
     * Pre-computed source discriminator from the indexer's clone/resolve fork.
     * Required so the metadata reflects whether `.git` was actually present at
     * the local path; deriving it from `params.url` alone would conflate
     * `local-git` and `local-folder`.
     */
    source: "git-remote" | "local-git" | "local-folder";
    /** Security tier (defaults to "private"; "public" already refused for local-folder). */
    tier: "private" | "work" | "public";
    /** Manifest pointer set only for `local-folder` sources. */
    lastManifestId?: string;
    /** Watcher enable flag — only meaningful for `local-folder` sources. */
    watchEnabled?: boolean;
    /** Whether the watcher should follow symlinks — only meaningful for `local-folder`. */
    followSymlinks?: boolean;
  }): RepositoryInfo {
    return {
      name: params.name,
      source: params.source,
      // local-folder repos have no clone URL — persist null per the type contract.
      url: params.source === "local-folder" ? null : params.url,
      branch: params.cloneResult.branch,
      localPath: params.cloneResult.path,
      collectionName: params.collectionName,
      fileCount: params.stats.filesProcessed,
      chunkCount: params.stats.chunksCreated,
      lastIndexedAt: new Date().toISOString(),
      lastIndexedCommitSha: params.cloneResult.commitSha,
      indexDurationMs: params.stats.durationMs,
      // Only set "error" when ALL files failed (filesProcessed === 0).
      // Partial success and empty repos (no files matched) are set to "ready".
      status: params.stats.filesProcessed === 0 && params.stats.filesFailed > 0 ? "error" : "ready",
      errorMessage: params.errorMessage,
      includeExtensions: params.options.includeExtensions?.length
        ? params.options.includeExtensions
        : [...DEFAULT_EXTENSIONS],
      excludePatterns: params.options.excludePatterns || [],
      // Embedding provider metadata
      embeddingProvider: this.embeddingProvider.providerId,
      embeddingModel: this.embeddingProvider.modelId,
      embeddingDimensions: this.embeddingProvider.dimensions,
      // Local-folder + multi-tier fields
      tier: params.tier,
      lastManifestId: params.lastManifestId,
      // Phase C watcher fields — undefined for non-local-folder sources so we
      // don't lie about watch capability for git repos.
      watchEnabled: params.watchEnabled,
      followSymlinks: params.followSymlinks,
    };
  }

  /**
   * Test whether `absolutePath` contains a `.git` entry (file or directory).
   *
   * A `.git` *directory* is the normal case. A `.git` *file* is what `git
   * worktree` creates inside a linked worktree — we accept both because both
   * indicate the path is inside a git working tree and the existing
   * `simple-git` revparse calls will succeed.
   */
  private async directoryHasGitFolder(absolutePath: string): Promise<boolean> {
    try {
      await stat(join(absolutePath, ".git"));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Default soft / hard guardrail thresholds for `local-folder` registration.
   *
   * Soft thresholds (`>10K` files OR `>1 GiB`) only log a warning. Hard
   * thresholds (`>100K` files OR `>10 GiB`) throw `LocalFolderSizeRefusedError`
   * unless `options.force === true`.
   *
   * Exposed as a static field so unit tests can construct an `IngestionService`
   * and pass tiny limits via {@link enforceLocalFolderSizeGuardrails}'s
   * `thresholds` argument without fixturing 100K files (PR #573 review TEST-1).
   */
  static readonly LOCAL_FOLDER_SIZE_THRESHOLDS = {
    softFileLimit: 10_000,
    softByteLimit: 1_073_741_824, // 1 GiB
    hardFileLimit: 100_000,
    hardByteLimit: 10_737_418_240, // 10 GiB
  } as const;

  /**
   * Pre-scan a `local-folder` candidate, counting files and bytes after
   * applying the same eligibility predicate `FileScanner` will use during the
   * actual scan, and enforce soft-warn / hard-refuse thresholds.
   *
   * Eligibility (gitignore, extension whitelist, default exclusions, dotfile
   * skip, VCS metadata skip, size cap, symlink skip) is delegated to
   * `shouldDescendDir` / `shouldIncludeFile` so the guardrail counts the same
   * files the scanner would index — fixing the H-2 divergence in PR #573.
   *
   * `thresholds` is overridable for tests; production callers should leave it
   * undefined to pick up {@link LOCAL_FOLDER_SIZE_THRESHOLDS}. Soft warn is
   * also returned via `softWarn: true` in the result so callers can assert
   * without log inspection.
   */
  async enforceLocalFolderSizeGuardrails(
    repositoryName: string,
    rootPath: string,
    options: IndexOptions,
    thresholds: {
      softFileLimit: number;
      softByteLimit: number;
      hardFileLimit: number;
      hardByteLimit: number;
    } = IngestionService.LOCAL_FOLDER_SIZE_THRESHOLDS
  ): Promise<{ fileCount: number; totalBytes: number; softWarn: boolean }> {
    const { softFileLimit, softByteLimit, hardFileLimit, hardByteLimit } = thresholds;

    const filter = await GitignoreFilter.load(rootPath);
    const extensions: Set<string> =
      options.includeExtensions && options.includeExtensions.length > 0
        ? new Set(options.includeExtensions.map((e) => e.toLowerCase()))
        : new Set(DEFAULT_EXTENSIONS.map((e) => e.toLowerCase()));

    let fileCount = 0;
    let totalBytes = 0;
    let aborted = false;

    const walk = async (dir: string): Promise<void> => {
      if (aborted) return;
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (aborted) return;
        const abs = join(dir, entry.name);
        // Symlinks are never followed (cycle / out-of-tree escape).
        if (entry.isSymbolicLink()) continue;

        if (entry.isDirectory()) {
          if (!shouldDescendDir(abs, entry.name, filter)) continue;
          await walk(abs);
          continue;
        }

        if (!entry.isFile()) continue;

        const ent: DirEntryLike = { name: entry.name, isDir: false, isSymlink: false };
        const verdict = await shouldIncludeFile(abs, ent, {
          gitignore: filter,
          extensions,
          maxSizeBytes: DEFAULT_MAX_FILE_SIZE_BYTES,
        });
        if (!verdict.eligible || !verdict.stats) continue;

        fileCount++;
        totalBytes += verdict.stats.size;

        // Early exit on hard refusal (avoids walking the rest of a huge folder).
        if (!options.force && (fileCount > hardFileLimit || totalBytes > hardByteLimit)) {
          aborted = true;
          return;
        }
      }
    };

    await walk(rootPath);

    if (!options.force && (fileCount > hardFileLimit || totalBytes > hardByteLimit)) {
      throw new LocalFolderSizeRefusedError(
        repositoryName,
        fileCount,
        totalBytes,
        hardFileLimit,
        hardByteLimit
      );
    }
    const softWarn = fileCount > softFileLimit || totalBytes > softByteLimit;
    if (softWarn) {
      this.logger.warn(
        {
          repository: repositoryName,
          rootPath,
          fileCount,
          totalBytes,
          softFileLimit,
          softByteLimit,
        },
        "Local folder exceeds soft size guardrail; proceeding because under the hard refusal threshold or force=true was set"
      );
    }
    return { fileCount, totalBytes, softWarn };
  }

  /**
   * Compute per-file fingerprints for a freshly-scanned local-folder repo and
   * persist a `FileManifest` so a future incremental update has a baseline to
   * diff against.
   *
   * Only files in `processedPaths` (POSIX-relative) are fingerprinted. Files
   * whose chunks failed to embed/store are omitted so the NEXT incremental
   * update sees them as `added` and retries — without this, a partial-success
   * first index would silently lose those files from the index forever
   * (PR #573 review M-3). Pass `undefined` to fingerprint all `fileInfos`
   * (used by tests / call paths that have no per-file outcome to filter on).
   *
   * SHA-256 is computed via streaming so files larger than the chunker's
   * normal cap (which they shouldn't be, but a manifest is a different
   * pipeline) don't blow up memory.
   *
   * Returns the manifest pointer (`computeManifestId(name)`) to store on the
   * `RepositoryInfo`.
   */
  private async writeInitialFileManifest(
    repositoryName: string,
    rootPath: string,
    fileInfos: FileInfo[],
    processedPaths?: ReadonlySet<string>
  ): Promise<string> {
    const store = FileManifestStoreImpl.getInstance();
    const files: Record<string, FileManifestEntry> = {};

    for (const info of fileInfos) {
      // Skip files that didn't make it through the full pipeline. `info.relativePath`
      // is already POSIX-normalized (FileScanner.normalizeToPosix), matching the
      // form `processFileBatch` records into `processedRelativePaths`.
      if (processedPaths && !processedPaths.has(info.relativePath)) {
        continue;
      }
      try {
        const sha256 = await streamSha256(info.absolutePath);
        const st = await stat(info.absolutePath);
        // Manifest keys are POSIX-normalized relative paths so cross-platform
        // diffs stay deterministic. fileInfos already uses POSIX separators
        // for relativePath but normalize defensively.
        const relPath = posix.normalize(
          relative(rootPath, info.absolutePath).split(sep).join(posix.sep)
        );
        files[relPath] = {
          sha256,
          sizeBytes: st.size,
          mtimeMs: st.mtimeMs,
        };
      } catch (err) {
        this.logger.warn(
          { absolutePath: info.absolutePath, err },
          "Could not fingerprint file for manifest; skipping"
        );
      }
    }

    const manifest: FileManifest = {
      version: FILE_MANIFEST_VERSION,
      repository: repositoryName,
      generatedAt: new Date().toISOString(),
      files,
    };
    await store.saveManifest(repositoryName, manifest);
    return store.computeManifestId(repositoryName);
  }
}
