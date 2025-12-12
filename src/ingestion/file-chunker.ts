/**
 * File chunker for preparing documents for embedding.
 *
 * Divides large files into semantically meaningful chunks with overlap.
 * Respects token limits for embedding API constraints while preserving
 * line boundaries for code readability.
 *
 * @module ingestion/file-chunker
 */

import crypto from "crypto";
import type pino from "pino";
import { getComponentLogger } from "../logging/index.js";
import type { FileInfo, FileChunk, ChunkerConfig } from "./types.js";
import { ValidationError, ChunkingError } from "./errors.js";

/**
 * Internal representation of chunk boundaries within a file.
 */
interface ChunkBoundary {
  /** Lines of text for this chunk */
  lines: string[];
  /** Starting line number (1-based) */
  startLine: number;
  /** Ending line number (1-based, inclusive) */
  endLine: number;
}

/**
 * Estimate token count for text using character-based heuristic.
 *
 * Uses conservative 4:1 character-to-token ratio, which slightly
 * overestimates to prevent embedding API limit violations.
 * This is adequate for Phase 1; can be replaced with tiktoken later.
 *
 * @param text - Text to estimate tokens for
 * @returns Estimated token count
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Compute SHA-256 hash of chunk content for deduplication.
 *
 * @param content - Chunk content to hash
 * @returns Hex-encoded SHA-256 hash
 */
function computeContentHash(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Create unique chunk identifier.
 *
 * Format: {repository}:{filePath}:{chunkIndex}
 *
 * @param repository - Repository name
 * @param filePath - Relative file path
 * @param chunkIndex - Zero-based chunk index
 * @returns Unique chunk ID
 * @example "my-api:src/auth/middleware.ts:0"
 */
function createChunkId(repository: string, filePath: string, chunkIndex: number): string {
  return `${repository}:${filePath}:${chunkIndex}`;
}

/**
 * Extract overlap lines from end of previous chunk.
 *
 * Takes lines from the end of the chunk until the overlap token
 * limit is reached, preserving line boundaries. Ensures semantic
 * context continuity between consecutive chunks.
 *
 * @param lines - Lines from previous chunk
 * @param overlapTokens - Token budget for overlap
 * @returns Lines to include at start of next chunk
 */
function getOverlapLines(lines: string[], overlapTokens: number): string[] {
  if (lines.length === 0) {
    return [];
  }

  const overlap: string[] = [];
  let tokens = 0;

  // Take lines from end, moving backwards
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    const lineTokens = estimateTokens(line);

    // Stop if adding this line would exceed overlap limit
    // (but include at least one line if possible)
    if (tokens + lineTokens > overlapTokens && overlap.length > 0) {
      break;
    }

    overlap.unshift(line); // Add to front
    tokens += lineTokens;
  }

  return overlap;
}

/**
 * File chunker for preparing documents for embedding.
 *
 * Splits large files into embedding-appropriate chunks with configurable
 * overlap. Preserves line boundaries for code readability and maintains
 * semantic context continuity across chunk boundaries.
 *
 * @example
 * ```typescript
 * const chunker = new FileChunker({ maxChunkTokens: 500, overlapTokens: 50 });
 * const content = await readFile(fileInfo.absolutePath, 'utf-8');
 * const chunks = await chunker.chunkFile(content, fileInfo, 'my-repo');
 * console.log(`Created ${chunks.length} chunks`);
 * ```
 */
export class FileChunker {
  private readonly logger: pino.Logger;
  private readonly config: Required<ChunkerConfig>;
  private readonly MAX_CHUNKS_PER_FILE = 100;

  /**
   * Create a new FileChunker instance.
   *
   * Configuration priority: defaults → constructor params → environment variables
   *
   * @param config - Optional chunker configuration
   * @throws {ValidationError} If overlap >= maxChunkTokens
   */
  constructor(config?: ChunkerConfig) {
    this.logger = getComponentLogger("ingestion:file-chunker");

    // Default configuration
    const defaults = {
      maxChunkTokens: 500,
      overlapTokens: 50,
    };

    // Merge with provided config
    const mergedConfig = {
      maxChunkTokens: config?.maxChunkTokens ?? defaults.maxChunkTokens,
      overlapTokens: config?.overlapTokens ?? defaults.overlapTokens,
    };

    // Override with environment variables if present
    if (process.env["CHUNK_MAX_TOKENS"]) {
      const envValue = parseInt(process.env["CHUNK_MAX_TOKENS"], 10);
      if (!isNaN(envValue) && envValue > 0) {
        mergedConfig.maxChunkTokens = envValue;
      }
    }

    if (process.env["CHUNK_OVERLAP_TOKENS"]) {
      const envValue = parseInt(process.env["CHUNK_OVERLAP_TOKENS"], 10);
      if (!isNaN(envValue) && envValue >= 0) {
        mergedConfig.overlapTokens = envValue;
      }
    }

    // Validate configuration
    if (mergedConfig.overlapTokens >= mergedConfig.maxChunkTokens) {
      throw new ValidationError(
        `Overlap tokens (${mergedConfig.overlapTokens}) must be less than max chunk tokens (${mergedConfig.maxChunkTokens})`,
        "overlapTokens"
      );
    }

    this.config = mergedConfig;

    this.logger.debug({ config: this.config }, "FileChunker initialized");
  }

  /**
   * Split lines into chunk boundaries based on token limits.
   *
   * Preserves line boundaries and includes overlap from previous chunks.
   * This is the core chunking algorithm.
   *
   * @param lines - All lines from the file
   * @param maxChunkTokens - Maximum tokens per chunk
   * @param overlapTokens - Tokens to overlap between chunks
   * @returns Array of chunk boundaries with line ranges
   */
  private splitIntoChunkBoundaries(
    lines: string[],
    maxChunkTokens: number,
    overlapTokens: number
  ): ChunkBoundary[] {
    const boundaries: ChunkBoundary[] = [];

    let currentLines: string[] = [];
    let currentTokens = 0;
    let chunkStartLine = 1; // 1-based line numbers

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineTokens = estimateTokens(line);

      // Check if adding this line would exceed limit
      if (currentTokens + lineTokens > maxChunkTokens && currentLines.length > 0) {
        // Save current chunk
        boundaries.push({
          lines: [...currentLines],
          startLine: chunkStartLine,
          endLine: i, // This will be adjusted to 1-based when creating FileChunk
        });

        // Start new chunk with overlap from previous
        const overlapLines = getOverlapLines(currentLines, overlapTokens);
        currentLines = [...overlapLines, line];
        currentTokens = estimateTokens(currentLines.join("\n"));

        // Adjust startLine to account for overlap
        chunkStartLine = i + 1 - overlapLines.length;
      } else {
        // Accumulate line
        currentLines.push(line);
        currentTokens += lineTokens;
      }
    }

    // Save final chunk if non-empty
    if (currentLines.length > 0) {
      boundaries.push({
        lines: currentLines,
        startLine: chunkStartLine,
        endLine: lines.length, // 1-based (length equals last line number)
      });
    }

    return boundaries;
  }

  /**
   * Chunk a file's content into embedding-appropriate chunks.
   *
   * Splits the file while preserving line boundaries and maintaining
   * overlap for semantic context continuity. Returns empty array for
   * empty files.
   *
   * @param content - File content to chunk
   * @param fileInfo - File metadata from scanner
   * @param repository - Repository name (slugified)
   * @returns Array of file chunks ready for embedding
   * @throws {ChunkingError} If chunking fails
   *
   * @example
   * ```typescript
   * const chunker = new FileChunker();
   * const content = await readFile(fileInfo.absolutePath, 'utf-8');
   * const chunks = chunker.chunkFile(content, fileInfo, 'my-api');
   * console.log(`Created ${chunks.length} chunks`);
   * ```
   */
  chunkFile(content: string, fileInfo: FileInfo, repository: string): FileChunk[] {
    const startTime = Date.now();

    this.logger.debug(
      {
        repository,
        filePath: fileInfo.relativePath,
        sizeBytes: fileInfo.sizeBytes,
      },
      "Starting file chunking"
    );

    try {
      // Handle empty file
      if (!content || content.trim().length === 0) {
        this.logger.debug({ filePath: fileInfo.relativePath }, "Empty file, returning no chunks");
        return [];
      }

      // Split into lines
      const lines = content.split("\n");

      // Generate chunk boundaries
      const boundaries = this.splitIntoChunkBoundaries(
        lines,
        this.config.maxChunkTokens,
        this.config.overlapTokens
      );

      // Check chunk limit
      if (boundaries.length > this.MAX_CHUNKS_PER_FILE) {
        this.logger.warn(
          {
            filePath: fileInfo.relativePath,
            chunkCount: boundaries.length,
            limit: this.MAX_CHUNKS_PER_FILE,
          },
          `File exceeds chunk limit, truncating to ${this.MAX_CHUNKS_PER_FILE} chunks`
        );

        // Truncate to limit
        boundaries.splice(this.MAX_CHUNKS_PER_FILE);
      }

      const totalChunks = boundaries.length;

      // Build FileChunk objects
      const chunks: FileChunk[] = boundaries.map((boundary, index) => {
        const chunkContent = boundary.lines.join("\n");

        return {
          id: createChunkId(repository, fileInfo.relativePath, index),
          repository,
          filePath: fileInfo.relativePath,
          content: chunkContent,
          chunkIndex: index,
          totalChunks,
          startLine: boundary.startLine,
          endLine: boundary.endLine,
          metadata: {
            extension: fileInfo.extension,
            fileSizeBytes: fileInfo.sizeBytes,
            contentHash: computeContentHash(chunkContent),
            fileModifiedAt: fileInfo.modifiedAt,
          },
        };
      });

      const duration = Date.now() - startTime;

      this.logger.info(
        {
          metric: "file_chunker.duration_ms",
          value: duration,
          repository,
          filePath: fileInfo.relativePath,
          chunkCount: chunks.length,
          sizeBytes: fileInfo.sizeBytes,
        },
        "File chunking complete"
      );

      return chunks;
    } catch (error) {
      const duration = Date.now() - startTime;

      this.logger.error(
        {
          metric: "file_chunker.error",
          duration_ms: duration,
          repository,
          filePath: fileInfo.relativePath,
          err: error,
        },
        "File chunking failed"
      );

      throw new ChunkingError(
        `Failed to chunk file ${fileInfo.relativePath}: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
        fileInfo.relativePath,
        error instanceof Error ? error : undefined
      );
    }
  }
}
