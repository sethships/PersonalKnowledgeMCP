/**
 * Integration tests for ChromaStorageClientImpl with real ChromaDB
 *
 * These tests require a running ChromaDB instance (Docker container).
 * They verify end-to-end functionality with the actual database.
 *
 * Prerequisites:
 * - ChromaDB container must be running: docker-compose up -d
 * - ChromaDB should be accessible at localhost:8000
 */

import { expect, test, describe, beforeAll, afterAll, beforeEach } from "bun:test";
import { ChromaStorageClientImpl } from "../../../src/storage/chroma-client.js";
import type { ChromaConfig } from "../../../src/storage/types.js";
import {
  sampleDocuments,
  queryEmbeddingSimilarToAuth,
  queryEmbeddingSimilarToRoutes,
  similarityThresholds,
  createTestDocumentBatch,
} from "../../fixtures/sample-embeddings.js";
import { initializeLogger, resetLogger } from "../../../src/logging/index.js";

describe("ChromaDB Integration Tests", () => {
  let client: ChromaStorageClientImpl;
  const testConfig: ChromaConfig = {
    host: process.env["CHROMADB_HOST"] || "localhost",
    port: parseInt(process.env["CHROMADB_PORT"] || "8000"),
  };

  const testCollectionName = "repo_integration_test";
  const testCollectionName2 = "repo_integration_test2";

  beforeAll(async () => {
    // Initialize logger before creating client
    initializeLogger({
      level: "info",
      format: "json",
    });

    // Create and connect client
    client = new ChromaStorageClientImpl(testConfig);

    try {
      await client.connect();
    } catch (error) {
      console.error("Failed to connect to ChromaDB. Ensure Docker container is running:");
      console.error("  docker-compose up -d");
      throw error;
    }

    // Verify ChromaDB is healthy
    const isHealthy = await client.healthCheck();
    if (!isHealthy) {
      throw new Error("ChromaDB is not healthy. Check container status.");
    }
  });

  afterAll(async () => {
    // Clean up test collections
    try {
      await client.deleteCollection(testCollectionName);
    } catch (error) {
      // Collection might not exist, ignore
    }

    try {
      await client.deleteCollection(testCollectionName2);
    } catch (error) {
      // Collection might not exist, ignore
    }

    // Reset logger after all tests
    resetLogger();
  });

  beforeEach(async () => {
    // Clean up before each test
    try {
      await client.deleteCollection(testCollectionName);
    } catch (error) {
      // Collection might not exist, ignore
    }

    try {
      await client.deleteCollection(testCollectionName2);
    } catch (error) {
      // Collection might not exist, ignore
    }
  });

  describe("Connection and Health", () => {
    test("should connect to ChromaDB successfully", async () => {
      const newClient = new ChromaStorageClientImpl(testConfig);
      await newClient.connect();

      const isHealthy = await newClient.healthCheck();
      expect(isHealthy).toBe(true);
    });

    test("should detect unhealthy ChromaDB", async () => {
      const badConfig: ChromaConfig = {
        host: "localhost",
        port: 9999, // Wrong port
        // Disable retries to prevent test timeout on connection errors
        retry: {
          maxRetries: 0,
          initialDelayMs: 0,
          maxDelayMs: 0,
          backoffMultiplier: 1,
        },
      };

      const newClient = new ChromaStorageClientImpl(badConfig);

      // Test async error throwing
      try {
        await newClient.connect();
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  describe("Collection Operations", () => {
    test("should create collection with cosine similarity metric", async () => {
      const collection = await client.getOrCreateCollection(testCollectionName);

      expect(collection).toBeDefined();
      expect(collection.name).toBe(testCollectionName);
      expect(collection.metadata).toMatchObject({ "hnsw:space": "cosine" });
    });

    test("should list collections", async () => {
      await client.getOrCreateCollection(testCollectionName);
      await client.getOrCreateCollection(testCollectionName2);

      const collections = await client.listCollections();

      expect(collections.length).toBeGreaterThanOrEqual(2);

      const collectionNames = collections.map((c) => c.name);
      expect(collectionNames).toContain(testCollectionName);
      expect(collectionNames).toContain(testCollectionName2);
    });

    test("should delete collection", async () => {
      await client.getOrCreateCollection(testCollectionName);

      await client.deleteCollection(testCollectionName);

      const collections = await client.listCollections();
      const collectionNames = collections.map((c) => c.name);

      expect(collectionNames).not.toContain(testCollectionName);
    });

    test("should get collection stats", async () => {
      await client.addDocuments(testCollectionName, sampleDocuments);

      const stats = await client.getCollectionStats(testCollectionName);

      expect(stats.name).toBe(testCollectionName);
      expect(stats.documentCount).toBe(sampleDocuments.length);
      expect(stats.retrievedAt).toBeDefined();
    });
  });

  describe("Document Operations", () => {
    test("should add documents with embeddings", async () => {
      await client.addDocuments(testCollectionName, sampleDocuments);

      const stats = await client.getCollectionStats(testCollectionName);
      expect(stats.documentCount).toBe(sampleDocuments.length);
    });

    test("should persist documents across operations", async () => {
      // Add documents
      await client.addDocuments(testCollectionName, sampleDocuments);

      // Verify persistence by getting stats
      const stats1 = await client.getCollectionStats(testCollectionName);
      expect(stats1.documentCount).toBe(sampleDocuments.length);

      // Query and verify documents are still there
      const stats2 = await client.getCollectionStats(testCollectionName);
      expect(stats2.documentCount).toBe(sampleDocuments.length);
    });

    test("should handle large document batches", async () => {
      const largeBatch = createTestDocumentBatch(100, "large-test-repo");

      await client.addDocuments(testCollectionName, largeBatch);

      const stats = await client.getCollectionStats(testCollectionName);
      expect(stats.documentCount).toBe(100);
    });
  });

  describe("Similarity Search", () => {
    beforeEach(async () => {
      // Add sample documents for search tests
      await client.addDocuments(testCollectionName, sampleDocuments);
    });

    test("should find similar documents", async () => {
      const results = await client.similaritySearch({
        embedding: queryEmbeddingSimilarToAuth,
        collections: [testCollectionName],
        limit: 10,
        threshold: similarityThresholds.low,
      });

      expect(results.length).toBeGreaterThan(0);

      // Should return auth-related documents as most similar
      const topResult = results[0]!;
      expect(topResult.id).toContain("auth");
    });

    test("should respect similarity threshold", async () => {
      const results = await client.similaritySearch({
        embedding: queryEmbeddingSimilarToAuth,
        collections: [testCollectionName],
        limit: 10,
        threshold: similarityThresholds.high,
      });

      // All results must meet the threshold
      results.forEach((result) => {
        expect(result.similarity).toBeGreaterThanOrEqual(similarityThresholds.high);
      });
    });

    test("should return results sorted by similarity", async () => {
      const results = await client.similaritySearch({
        embedding: queryEmbeddingSimilarToAuth,
        collections: [testCollectionName],
        limit: 10,
        threshold: 0,
      });

      // Verify descending order
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1]!.similarity).toBeGreaterThanOrEqual(results[i]!.similarity);
      }
    });

    test("should respect result limit", async () => {
      const results = await client.similaritySearch({
        embedding: queryEmbeddingSimilarToAuth,
        collections: [testCollectionName],
        limit: 2,
        threshold: 0,
      });

      expect(results.length).toBeLessThanOrEqual(2);
    });

    test("should search across multiple collections", async () => {
      // Add documents to second collection
      await client.addDocuments(testCollectionName2, [sampleDocuments[0]!]);

      const results = await client.similaritySearch({
        embedding: queryEmbeddingSimilarToAuth,
        collections: [testCollectionName, testCollectionName2],
        limit: 10,
        threshold: similarityThresholds.low,
      });

      expect(results.length).toBeGreaterThan(0);
    });

    test("should convert distance to similarity correctly", async () => {
      const results = await client.similaritySearch({
        embedding: queryEmbeddingSimilarToAuth,
        collections: [testCollectionName],
        limit: 10,
        threshold: 0,
      });

      // Verify all similarities are in valid range
      results.forEach((result) => {
        expect(result.similarity).toBeGreaterThanOrEqual(0);
        expect(result.similarity).toBeLessThanOrEqual(1);

        // Verify conversion formula
        const expectedSimilarity = 1 - result.distance / 2;
        expect(Math.abs(result.similarity - expectedSimilarity)).toBeLessThan(0.0001);
      });
    });

    test("should find different documents for different queries", async () => {
      const authResults = await client.similaritySearch({
        embedding: queryEmbeddingSimilarToAuth,
        collections: [testCollectionName],
        limit: 1,
        threshold: 0,
      });

      const routesResults = await client.similaritySearch({
        embedding: queryEmbeddingSimilarToRoutes,
        collections: [testCollectionName],
        limit: 1,
        threshold: 0,
      });

      // Different queries should return different top results
      expect(authResults[0]!.id).not.toBe(routesResults[0]!.id);
    });

    test("should include complete document metadata in results", async () => {
      const results = await client.similaritySearch({
        embedding: queryEmbeddingSimilarToAuth,
        collections: [testCollectionName],
        limit: 1,
        threshold: 0,
      });

      expect(results.length).toBeGreaterThan(0);

      const result = results[0]!;
      expect(result.id).toBeDefined();
      expect(result.content).toBeDefined();
      expect(result.metadata).toBeDefined();
      expect(result.metadata.file_path).toBeDefined();
      expect(result.metadata.repository).toBeDefined();
      expect(result.metadata.chunk_index).toBeDefined();
      expect(result.distance).toBeDefined();
      expect(result.similarity).toBeDefined();
    });
  });

  describe("End-to-End Workflow", () => {
    test("should complete full workflow: create → add → search → delete", async () => {
      // 1. Create collection
      const collection = await client.getOrCreateCollection(testCollectionName);
      expect(collection.name).toBe(testCollectionName);

      // 2. Add documents
      await client.addDocuments(testCollectionName, sampleDocuments);

      // 3. Verify documents were added
      const stats = await client.getCollectionStats(testCollectionName);
      expect(stats.documentCount).toBe(sampleDocuments.length);

      // 4. Search for similar documents
      const results = await client.similaritySearch({
        embedding: queryEmbeddingSimilarToAuth,
        collections: [testCollectionName],
        limit: 5,
        threshold: similarityThresholds.low,
      });

      expect(results.length).toBeGreaterThan(0);

      // 5. Delete collection
      await client.deleteCollection(testCollectionName);

      // 6. Verify collection is deleted
      const collections = await client.listCollections();
      const collectionNames = collections.map((c) => c.name);
      expect(collectionNames).not.toContain(testCollectionName);
    });

    test("should handle multiple repositories independently", async () => {
      const repo1Docs = sampleDocuments.slice(0, 2);
      const repo2Docs = [sampleDocuments[2]!];

      // Add documents to separate collections
      await client.addDocuments(testCollectionName, repo1Docs);
      await client.addDocuments(testCollectionName2, repo2Docs);

      // Verify each collection has correct count
      const stats1 = await client.getCollectionStats(testCollectionName);
      const stats2 = await client.getCollectionStats(testCollectionName2);

      expect(stats1.documentCount).toBe(2);
      expect(stats2.documentCount).toBe(1);

      // Search individual collection
      const results1 = await client.similaritySearch({
        embedding: queryEmbeddingSimilarToAuth,
        collections: [testCollectionName],
        limit: 10,
        threshold: 0,
      });

      expect(results1.length).toBe(2);

      // Search across both
      const resultsBoth = await client.similaritySearch({
        embedding: queryEmbeddingSimilarToAuth,
        collections: [testCollectionName, testCollectionName2],
        limit: 10,
        threshold: 0,
      });

      expect(resultsBoth.length).toBe(3);
    });
  });

  describe("Performance", () => {
    test("should handle 1000 documents efficiently", async () => {
      const largeBatch = createTestDocumentBatch(1000, "perf-test-repo");

      const startAdd = Date.now();
      await client.addDocuments(testCollectionName, largeBatch);
      const addDuration = Date.now() - startAdd;

      // eslint-disable-next-line no-console
      console.log(`Added 1000 documents in ${addDuration}ms`);

      // Should complete reasonably fast (under 10 seconds)
      expect(addDuration).toBeLessThan(10000);

      // Verify all documents were added
      const stats = await client.getCollectionStats(testCollectionName);
      expect(stats.documentCount).toBe(1000);

      // Search should also be fast
      const startSearch = Date.now();
      const results = await client.similaritySearch({
        embedding: queryEmbeddingSimilarToAuth,
        collections: [testCollectionName],
        limit: 10,
        threshold: 0,
      });
      const searchDuration = Date.now() - startSearch;

      // eslint-disable-next-line no-console
      console.log(`Searched 1000 documents in ${searchDuration}ms`);

      // Search should be fast (under 1 second)
      expect(searchDuration).toBeLessThan(1000);
      expect(results.length).toBe(10);
    });
  });

  describe("Upsert Operations", () => {
    test("should upsert documents idempotently with real ChromaDB", async () => {
      const testDoc = sampleDocuments[0]!;

      // First upsert
      await client.upsertDocuments(testCollectionName, [testDoc]);

      // Verify document was added
      let stats = await client.getCollectionStats(testCollectionName);
      expect(stats.documentCount).toBe(1);

      // Second upsert with same ID (should update, not duplicate)
      const updatedDoc = {
        ...testDoc,
        content: "Updated content for idempotency test",
      };
      await client.upsertDocuments(testCollectionName, [updatedDoc]);

      // Verify count is still 1 (not 2)
      stats = await client.getCollectionStats(testCollectionName);
      expect(stats.documentCount).toBe(1);
    });

    test("should upsert large batch with performance target", async () => {
      const largeBatch = createTestDocumentBatch(500, "test-repo");

      const startTime = Date.now();
      await client.upsertDocuments(testCollectionName, largeBatch);
      const duration = Date.now() - startTime;

      // eslint-disable-next-line no-console
      console.log(`Upserted 500 documents in ${duration}ms`);

      // Should complete under 10 seconds
      expect(duration).toBeLessThan(10000);

      // Verify all documents were upserted
      const stats = await client.getCollectionStats(testCollectionName);
      expect(stats.documentCount).toBe(500);
    });
  });

  describe("Delete Operations", () => {
    beforeEach(async () => {
      // Add test documents
      await client.addDocuments(testCollectionName, sampleDocuments);
    });

    test("should delete documents by ID with real ChromaDB", async () => {
      const initialStats = await client.getCollectionStats(testCollectionName);
      const initialCount = initialStats.documentCount;

      // Delete one document
      await client.deleteDocuments(testCollectionName, [sampleDocuments[0]!.id]);

      // Verify count decreased
      const afterStats = await client.getCollectionStats(testCollectionName);
      expect(afterStats.documentCount).toBe(initialCount - 1);
    });

    test("should be idempotent - deleting same ID twice", async () => {
      const docId = sampleDocuments[0]!.id;

      // Delete once
      await client.deleteDocuments(testCollectionName, [docId]);

      const afterFirst = await client.getCollectionStats(testCollectionName);

      // Delete again (should not throw error - idempotent)
      await client.deleteDocuments(testCollectionName, [docId]);

      // Count should remain the same
      const afterSecond = await client.getCollectionStats(testCollectionName);
      expect(afterSecond.documentCount).toBe(afterFirst.documentCount);
    });
  });

  describe("Metadata Query Operations", () => {
    beforeEach(async () => {
      // Add test documents with known metadata
      await client.addDocuments(testCollectionName, sampleDocuments);
    });

    test("should query documents by repository", async () => {
      const results = await client.getDocumentsByMetadata(testCollectionName, {
        repository: "test-repo",
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toHaveProperty("id");
      expect(results[0]).toHaveProperty("content");
      expect(results[0]).toHaveProperty("metadata");
      expect(results[0]!.metadata.repository).toBe("test-repo");
    });

    test("should query documents by file_path", async () => {
      const results = await client.getDocumentsByMetadata(testCollectionName, {
        file_path: "src/auth/login.ts",
      });

      expect(results.length).toBe(2); // Two chunks from login.ts
      expect(results[0]!.metadata.file_path).toBe("src/auth/login.ts");
    });

    test("should not include embeddings by default", async () => {
      const results = await client.getDocumentsByMetadata(testCollectionName, {
        repository: "test-repo",
      });

      if (results.length > 0) {
        expect(results[0]!.embedding).toBeUndefined();
      }
    });

    test("should include embeddings when requested", async () => {
      const results = await client.getDocumentsByMetadata(
        testCollectionName,
        { repository: "test-repo" },
        true // includeEmbeddings
      );

      if (results.length > 0) {
        expect(results[0]!.embedding).toBeDefined();
        expect(Array.isArray(results[0]!.embedding)).toBe(true);
        expect(results[0]!.embedding!.length).toBe(384);
      }
    });

    test("should return empty array when no matches", async () => {
      const results = await client.getDocumentsByMetadata(testCollectionName, {
        repository: "non-existent-repo",
      });

      expect(results).toEqual([]);
    });
  });

  describe("File Prefix Delete Helper", () => {
    beforeEach(async () => {
      // Add test documents with multiple chunks for same file
      await client.addDocuments(testCollectionName, sampleDocuments);
    });

    test("should delete all chunks for a file", async () => {
      const initialStats = await client.getCollectionStats(testCollectionName);

      // Delete all chunks for login.ts (2 chunks)
      const deletedCount = await client.deleteDocumentsByFilePrefix(
        testCollectionName,
        "test-repo",
        "src/auth/login.ts"
      );

      expect(deletedCount).toBe(2); // Two chunks should be deleted

      // Verify deletion - query for login.ts should return nothing
      const results = await client.getDocumentsByMetadata(testCollectionName, {
        $and: [{ repository: "test-repo" }, { file_path: "src/auth/login.ts" }],
      });

      expect(results.length).toBe(0);

      // Verify count decreased by deletedCount
      const afterStats = await client.getCollectionStats(testCollectionName);
      expect(afterStats.documentCount).toBe(initialStats.documentCount - deletedCount);
    });

    test("should return 0 when no chunks found", async () => {
      const deletedCount = await client.deleteDocumentsByFilePrefix(
        testCollectionName,
        "test-repo",
        "non-existent-file.ts"
      );

      expect(deletedCount).toBe(0);
    });
  });

  describe("Incremental Update Workflow (End-to-End)", () => {
    test("should handle complete incremental update workflow", async () => {
      const repository = "test-repo";
      const filePath = "src/auth/login.ts";

      // Step 1: Add initial documents
      await client.addDocuments(testCollectionName, sampleDocuments);

      const initialStats = await client.getCollectionStats(testCollectionName);
      const initialCount = initialStats.documentCount;

      // Step 2: Query to find chunks for the file
      const existingChunks = await client.getDocumentsByMetadata(testCollectionName, {
        $and: [{ repository }, { file_path: filePath }],
      });

      expect(existingChunks.length).toBeGreaterThan(0);
      const chunkCount = existingChunks.length;

      // Step 3: Delete old chunks
      const deletedCount = await client.deleteDocumentsByFilePrefix(
        testCollectionName,
        repository,
        filePath
      );

      expect(deletedCount).toBe(chunkCount);

      // Step 4: Create new chunks with updated content
      const newChunks = existingChunks.map((chunk, index) => ({
        id: chunk.id,
        content: `Updated content for chunk ${index}`,
        embedding: queryEmbeddingSimilarToAuth,
        metadata: {
          ...chunk.metadata,
          indexed_at: new Date().toISOString(),
        },
      }));

      // Step 5: Upsert new chunks
      await client.upsertDocuments(testCollectionName, newChunks);

      // Step 6: Verify final state
      const finalStats = await client.getCollectionStats(testCollectionName);
      expect(finalStats.documentCount).toBe(initialCount); // Same count as before

      // Verify updated content
      const updatedChunks = await client.getDocumentsByMetadata(testCollectionName, {
        $and: [{ repository }, { file_path: filePath }],
      });

      expect(updatedChunks.length).toBe(chunkCount);
      expect(updatedChunks[0]!.content).toContain("Updated content");
    });
  });
});
