/**
 * Shared utility functions for file and document chunking.
 *
 * Provides common operations used by both FileChunker and DocumentChunker:
 * token estimation, content hashing, and chunk ID generation.
 *
 * @module ingestion/chunk-utils
 */

import crypto from "crypto";

/**
 * Estimate token count for text using character-based heuristic.
 *
 * Uses conservative 4:1 character-to-token ratio, which slightly
 * overestimates to prevent embedding API limit violations.
 * This is adequate for Phase 1; can be replaced with tiktoken later.
 *
 * Note: Uses spread operator to count actual Unicode code points,
 * correctly handling surrogate pairs (emojis, some CJK characters).
 *
 * @param text - Text to estimate tokens for
 * @returns Estimated token count
 */
export function estimateTokens(text: string): number {
  // Use spread operator to count actual Unicode code points
  // This handles surrogate pairs (emojis, some CJK) correctly
  const charCount = [...text].length;
  return Math.ceil(charCount / 4);
}

/**
 * Compute SHA-256 hash of chunk content for deduplication.
 *
 * @param content - Chunk content to hash
 * @returns Hex-encoded SHA-256 hash
 */
export function computeContentHash(content: string): string {
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
export function createChunkId(repository: string, filePath: string, chunkIndex: number): string {
  return `${repository}:${filePath}:${chunkIndex}`;
}
