/**
 * Sample embedding data for testing
 *
 * Provides known embedding vectors with predictable similarity relationships
 * for testing vector search functionality.
 */

import type { DocumentInput, DocumentMetadata } from "../../src/storage/types.js";

/**
 * Create a simple embedding vector for testing
 *
 * Creates a normalized vector with the given pattern.
 * For simplicity, we use small 384-dimensional vectors (typical for smaller models).
 *
 * @param seed - Seed value to generate different but reproducible vectors
 * @param dimensions - Number of dimensions (default: 384)
 */
export function createTestEmbedding(
  seed: number,
  dimensions: number = 384
): number[] {
  const embedding: number[] = [];
  for (let i = 0; i < dimensions; i++) {
    // Create predictable but varied values
    embedding.push(Math.sin(seed + i) * 0.5 + 0.5);
  }

  // Normalize the vector
  const norm = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
  return embedding.map((val) => val / norm);
}

/**
 * Sample document metadata
 */
export function createTestMetadata(overrides: Partial<DocumentMetadata> = {}): DocumentMetadata {
  return {
    file_path: "src/test/example.ts",
    repository: "test-repo",
    chunk_index: 0,
    total_chunks: 1,
    chunk_start_line: 1,
    chunk_end_line: 50,
    file_extension: ".ts",
    file_size_bytes: 1024,
    content_hash: "abc123def456",
    indexed_at: "2025-12-10T00:00:00Z",
    file_modified_at: "2025-12-09T00:00:00Z",
    ...overrides,
  };
}

/**
 * Sample documents with known similarity relationships
 *
 * Document 1 and Document 2 are similar (same seed base)
 * Document 3 is different (different seed)
 */
export const sampleDocuments: DocumentInput[] = [
  {
    id: "test-repo:src/auth/login.ts:0",
    content: "function login(username: string, password: string) { /* authentication logic */ }",
    embedding: createTestEmbedding(1),
    metadata: createTestMetadata({
      file_path: "src/auth/login.ts",
      repository: "test-repo",
      chunk_index: 0,
      total_chunks: 2,
      chunk_start_line: 1,
      chunk_end_line: 25,
    }),
  },
  {
    id: "test-repo:src/auth/login.ts:1",
    content: "function validateCredentials(username: string, password: string) { /* validation logic */ }",
    embedding: createTestEmbedding(1.1), // Similar to document 1
    metadata: createTestMetadata({
      file_path: "src/auth/login.ts",
      repository: "test-repo",
      chunk_index: 1,
      total_chunks: 2,
      chunk_start_line: 26,
      chunk_end_line: 50,
    }),
  },
  {
    id: "test-repo:src/api/routes.ts:0",
    content: "const routes = { '/api/users': getUsersHandler, '/api/posts': getPostsHandler };",
    embedding: createTestEmbedding(10), // Different from documents 1 and 2
    metadata: createTestMetadata({
      file_path: "src/api/routes.ts",
      repository: "test-repo",
      chunk_index: 0,
      total_chunks: 1,
      chunk_start_line: 1,
      chunk_end_line: 30,
    }),
  },
];

/**
 * Query embedding similar to sampleDocuments[0]
 * This should return documents 0 and 1 as most similar
 */
export const queryEmbeddingSimilarToAuth = createTestEmbedding(1.05);

/**
 * Query embedding similar to sampleDocuments[2]
 * This should return document 2 as most similar
 */
export const queryEmbeddingSimilarToRoutes = createTestEmbedding(10.05);

/**
 * Completely different query embedding
 * This should have low similarity to all sample documents
 */
export const queryEmbeddingDifferent = createTestEmbedding(100);

/**
 * Expected similarity thresholds for testing
 */
export const similarityThresholds = {
  /** High threshold - only very similar documents */
  high: 0.9,
  /** Medium threshold - moderately similar documents */
  medium: 0.7,
  /** Low threshold - loosely similar documents */
  low: 0.5,
};

/**
 * Create a batch of test documents for performance testing
 */
export function createTestDocumentBatch(
  count: number,
  repositoryName: string = "test-repo"
): DocumentInput[] {
  const documents: DocumentInput[] = [];

  for (let i = 0; i < count; i++) {
    documents.push({
      id: `${repositoryName}:file${i}.ts:0`,
      content: `Test content for document ${i}`,
      embedding: createTestEmbedding(i),
      metadata: createTestMetadata({
        file_path: `file${i}.ts`,
        repository: repositoryName,
        chunk_index: 0,
        total_chunks: 1,
      }),
    });
  }

  return documents;
}
