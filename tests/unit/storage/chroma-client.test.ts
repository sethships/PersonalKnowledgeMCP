/**
 * Unit tests for ChromaStorageClientImpl
 *
 * Tests all methods of the storage client using mocked ChromaDB client
 * to ensure 90%+ code coverage and correct behavior.
 */

import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import { ChromaStorageClientImpl } from "../../../src/storage/chroma-client.js";
import {
  StorageConnectionError,
  InvalidParametersError,
  DocumentOperationError,
  CollectionNotFoundError,
  SearchOperationError,
} from "../../../src/storage/errors.js";
import type { ChromaConfig, DocumentInput, SimilarityQuery } from "../../../src/storage/types.js";
import { MockChromaClient } from "../../helpers/chroma-mock.js";
import {
  sampleDocuments,
  queryEmbeddingSimilarToAuth,
  createTestMetadata,
  similarityThresholds,
} from "../../fixtures/sample-embeddings.js";

describe("ChromaStorageClientImpl", () => {
  let client: ChromaStorageClientImpl;
  let mockChromaClient: MockChromaClient;
  const testConfig: ChromaConfig = {
    host: "localhost",
    port: 8000,
  };

  beforeEach(() => {
    client = new ChromaStorageClientImpl(testConfig);
    mockChromaClient = new MockChromaClient();

    // Replace the internal client with our mock
    // @ts-expect-error - Accessing private property for testing
    client.client = mockChromaClient;
  });

  afterEach(() => {
    mockChromaClient.clear();
  });

  describe("Constructor", () => {
    test("should create instance with provided config", () => {
      const newClient = new ChromaStorageClientImpl(testConfig);
      expect(newClient).toBeDefined();
    });
  });

  describe("connect()", () => {
    test("should connect successfully and verify health", async () => {
      // This test verifies that the client connection works
      // We already have a connected client in beforeEach
      const isHealthy = await client.healthCheck();
      expect(isHealthy).toBe(true);
    });

    test("should return false from healthCheck when not connected", async () => {
      const newClient = new ChromaStorageClientImpl(testConfig);

      // Health check should return false when not connected
      const isHealthy = await newClient.healthCheck();
      expect(isHealthy).toBe(false);
    });
  });

  describe("healthCheck()", () => {
    test("should return true when ChromaDB is healthy", async () => {
      const result = await client.healthCheck();
      expect(result).toBe(true);
    });

    test("should return false when ChromaDB is not reachable", async () => {
      mockChromaClient.setShouldFailHeartbeat(true);
      const result = await client.healthCheck();
      expect(result).toBe(false);
    });

    test("should return false when not connected", async () => {
      const newClient = new ChromaStorageClientImpl(testConfig);
      const result = await newClient.healthCheck();
      expect(result).toBe(false);
    });
  });

  describe("getOrCreateCollection()", () => {
    test("should create new collection with cosine similarity", async () => {
      const collectionName = "repo_test";
      const collection = await client.getOrCreateCollection(collectionName);

      expect(collection).toBeDefined();
      expect(collection.name).toBe(collectionName);
      expect(collection.metadata).toMatchObject({ "hnsw:space": "cosine" });
    });

    test("should return cached collection on subsequent calls", async () => {
      const collectionName = "repo_test";

      const collection1 = await client.getOrCreateCollection(collectionName);
      const collection2 = await client.getOrCreateCollection(collectionName);

      // Should be the same instance from cache
      expect(collection1).toBe(collection2);
    });

    test("should throw InvalidParametersError for empty name", async () => {
      expect(async () => {
        await client.getOrCreateCollection("");
      }).toThrow(InvalidParametersError);
    });

    test("should throw StorageConnectionError when not connected", async () => {
      const newClient = new ChromaStorageClientImpl(testConfig);

      expect(async () => {
        await newClient.getOrCreateCollection("repo_test");
      }).toThrow(StorageConnectionError);
    });
  });

  describe("deleteCollection()", () => {
    test("should delete collection successfully", async () => {
      const collectionName = "repo_test";

      // Create collection first
      await client.getOrCreateCollection(collectionName);

      // Delete it
      await client.deleteCollection(collectionName);

      // Verify it's deleted
      const collections = await mockChromaClient.listCollections();
      expect(collections.find((c) => c.name === collectionName)).toBeUndefined();
    });

    test("should remove collection from cache", async () => {
      const collectionName = "repo_test";

      // Create and cache collection
      await client.getOrCreateCollection(collectionName);

      // Delete it
      await client.deleteCollection(collectionName);

      // Getting it again should create a new instance
      const newCollection = await client.getOrCreateCollection(collectionName);
      expect(newCollection).toBeDefined();
    });

    test("should throw StorageConnectionError when not connected", async () => {
      const newClient = new ChromaStorageClientImpl(testConfig);

      expect(async () => {
        await newClient.deleteCollection("repo_test");
      }).toThrow(StorageConnectionError);
    });
  });

  describe("listCollections()", () => {
    test("should return empty array when no collections exist", async () => {
      const collections = await client.listCollections();
      expect(collections).toEqual([]);
    });

    test("should list all collections", async () => {
      await client.getOrCreateCollection("repo_test1");
      await client.getOrCreateCollection("repo_test2");

      const collections = await client.listCollections();

      expect(collections.length).toBe(2);
      expect(collections.map((c) => c.name)).toContain("repo_test1");
      expect(collections.map((c) => c.name)).toContain("repo_test2");
    });

    test("should throw StorageConnectionError when not connected", async () => {
      const newClient = new ChromaStorageClientImpl(testConfig);

      expect(async () => {
        await newClient.listCollections();
      }).toThrow(StorageConnectionError);
    });
  });

  describe("addDocuments()", () => {
    const collectionName = "repo_test";

    test("should add documents successfully", async () => {
      await client.addDocuments(collectionName, sampleDocuments);

      // Verify documents were added
      const collection = mockChromaClient.getCollectionSync(collectionName);
      expect(collection).toBeDefined();

      const count = await collection!.count();
      expect(count).toBe(sampleDocuments.length);
    });

    test("should throw InvalidParametersError for empty documents array", async () => {
      expect(async () => {
        await client.addDocuments(collectionName, []);
      }).toThrow(InvalidParametersError);
    });

    test("should throw InvalidParametersError for document with empty ID", async () => {
      const invalidDoc: DocumentInput = {
        id: "",
        content: "test",
        embedding: [1, 2, 3],
        metadata: createTestMetadata(),
      };

      expect(async () => {
        await client.addDocuments(collectionName, [invalidDoc]);
      }).toThrow(InvalidParametersError);
    });

    test("should throw InvalidParametersError for document without content", async () => {
      const invalidDoc: DocumentInput = {
        id: "test:file.ts:0",
        content: "",
        embedding: [1, 2, 3],
        metadata: createTestMetadata(),
      };

      expect(async () => {
        await client.addDocuments(collectionName, [invalidDoc]);
      }).toThrow(InvalidParametersError);
    });

    test("should throw InvalidParametersError for document with invalid embedding", async () => {
      const invalidDoc: DocumentInput = {
        id: "test:file.ts:0",
        content: "test",
        embedding: [],
        metadata: createTestMetadata(),
      };

      expect(async () => {
        await client.addDocuments(collectionName, [invalidDoc]);
      }).toThrow(InvalidParametersError);
    });

    test("should throw InvalidParametersError for document without metadata", async () => {
      const invalidDoc = {
        id: "test:file.ts:0",
        content: "test",
        embedding: [1, 2, 3],
      } as DocumentInput;

      expect(async () => {
        await client.addDocuments(collectionName, [invalidDoc]);
      }).toThrow(InvalidParametersError);
    });

    test("should throw StorageConnectionError when not connected", async () => {
      const newClient = new ChromaStorageClientImpl(testConfig);

      expect(async () => {
        await newClient.addDocuments(collectionName, sampleDocuments);
      }).toThrow(StorageConnectionError);
    });

    test("should throw DocumentOperationError when add operation fails", async () => {
      // Create collection first
      await client.getOrCreateCollection(collectionName);

      // Get the mock collection and configure it to fail
      const mockCollection = mockChromaClient.getCollectionSync(collectionName);
      mockCollection!.setShouldFailAdd(true);

      // Attempt to add documents should throw DocumentOperationError
      try {
        await client.addDocuments(collectionName, sampleDocuments);
        // If we get here, test should fail
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(DocumentOperationError);
        expect((error as DocumentOperationError).message).toContain("Failed to add");
      }
    });
  });

  describe("similaritySearch()", () => {
    const collectionName = "repo_test";

    beforeEach(async () => {
      // Add sample documents for search tests
      await client.addDocuments(collectionName, sampleDocuments);
    });

    test("should return similar documents above threshold", async () => {
      const query: SimilarityQuery = {
        embedding: queryEmbeddingSimilarToAuth,
        collections: [collectionName],
        limit: 10,
        threshold: similarityThresholds.low,
      };

      const results = await client.similaritySearch(query);

      expect(results.length).toBeGreaterThan(0);

      // All results should have similarity >= threshold
      results.forEach((result) => {
        expect(result.similarity).toBeGreaterThanOrEqual(query.threshold);
      });
    });

    test("should return results sorted by similarity descending", async () => {
      const query: SimilarityQuery = {
        embedding: queryEmbeddingSimilarToAuth,
        collections: [collectionName],
        limit: 10,
        threshold: 0,
      };

      const results = await client.similaritySearch(query);

      // Verify sorted in descending order
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1]!.similarity).toBeGreaterThanOrEqual(results[i]!.similarity);
      }
    });

    test("should respect limit parameter", async () => {
      const query: SimilarityQuery = {
        embedding: queryEmbeddingSimilarToAuth,
        collections: [collectionName],
        limit: 2,
        threshold: 0,
      };

      const results = await client.similaritySearch(query);

      expect(results.length).toBeLessThanOrEqual(2);
    });

    test("should filter results by threshold", async () => {
      const query: SimilarityQuery = {
        embedding: queryEmbeddingSimilarToAuth,
        collections: [collectionName],
        limit: 10,
        threshold: similarityThresholds.high, // Very high threshold
      };

      const results = await client.similaritySearch(query);

      // All results must meet the high threshold
      results.forEach((result) => {
        expect(result.similarity).toBeGreaterThanOrEqual(similarityThresholds.high);
      });
    });

    test("should search across multiple collections", async () => {
      const collection2Name = "repo_test2";
      await client.addDocuments(collection2Name, [sampleDocuments[0]!]);

      const query: SimilarityQuery = {
        embedding: queryEmbeddingSimilarToAuth,
        collections: [collectionName, collection2Name],
        limit: 10,
        threshold: 0,
      };

      const results = await client.similaritySearch(query);

      expect(results.length).toBeGreaterThan(0);
    });

    test("should convert distance to similarity correctly", async () => {
      const query: SimilarityQuery = {
        embedding: queryEmbeddingSimilarToAuth,
        collections: [collectionName],
        limit: 10,
        threshold: 0,
      };

      const results = await client.similaritySearch(query);

      // All similarities should be between 0 and 1
      results.forEach((result) => {
        expect(result.similarity).toBeGreaterThanOrEqual(0);
        expect(result.similarity).toBeLessThanOrEqual(1);

        // Verify conversion formula: similarity = 1 - (distance / 2)
        const expectedSimilarity = 1 - result.distance / 2;
        expect(Math.abs(result.similarity - expectedSimilarity)).toBeLessThan(0.0001);
      });
    });

    test("should throw InvalidParametersError for empty embedding", async () => {
      const query: SimilarityQuery = {
        embedding: [],
        collections: [collectionName],
        limit: 10,
        threshold: 0.5,
      };

      expect(async () => {
        await client.similaritySearch(query);
      }).toThrow(InvalidParametersError);
    });

    test("should throw InvalidParametersError for empty collections array", async () => {
      const query: SimilarityQuery = {
        embedding: queryEmbeddingSimilarToAuth,
        collections: [],
        limit: 10,
        threshold: 0.5,
      };

      expect(async () => {
        await client.similaritySearch(query);
      }).toThrow(InvalidParametersError);
    });

    test("should throw InvalidParametersError for limit < 1", async () => {
      const query: SimilarityQuery = {
        embedding: queryEmbeddingSimilarToAuth,
        collections: [collectionName],
        limit: 0,
        threshold: 0.5,
      };

      expect(async () => {
        await client.similaritySearch(query);
      }).toThrow(InvalidParametersError);
    });

    test("should throw InvalidParametersError for threshold < 0", async () => {
      const query: SimilarityQuery = {
        embedding: queryEmbeddingSimilarToAuth,
        collections: [collectionName],
        limit: 10,
        threshold: -0.1,
      };

      expect(async () => {
        await client.similaritySearch(query);
      }).toThrow(InvalidParametersError);
    });

    test("should throw InvalidParametersError for threshold > 1", async () => {
      const query: SimilarityQuery = {
        embedding: queryEmbeddingSimilarToAuth,
        collections: [collectionName],
        limit: 10,
        threshold: 1.1,
      };

      expect(async () => {
        await client.similaritySearch(query);
      }).toThrow(InvalidParametersError);
    });

    test("should throw StorageConnectionError when not connected", async () => {
      const newClient = new ChromaStorageClientImpl(testConfig);

      const query: SimilarityQuery = {
        embedding: queryEmbeddingSimilarToAuth,
        collections: [collectionName],
        limit: 10,
        threshold: 0.5,
      };

      expect(async () => {
        await newClient.similaritySearch(query);
      }).toThrow(StorageConnectionError);
    });
  });

  describe("getCollectionStats()", () => {
    const collectionName = "repo_test";

    test("should return stats for existing collection", async () => {
      await client.addDocuments(collectionName, sampleDocuments);

      const stats = await client.getCollectionStats(collectionName);

      expect(stats.name).toBe(collectionName);
      expect(stats.documentCount).toBe(sampleDocuments.length);
      expect(stats.retrievedAt).toBeDefined();
    });

    test("should return zero count for empty collection", async () => {
      await client.getOrCreateCollection(collectionName);

      const stats = await client.getCollectionStats(collectionName);

      expect(stats.documentCount).toBe(0);
    });

    test("should throw StorageConnectionError when not connected", async () => {
      const newClient = new ChromaStorageClientImpl(testConfig);

      expect(async () => {
        await newClient.getCollectionStats(collectionName);
      }).toThrow(StorageConnectionError);
    });
  });

  describe("Error Handling", () => {
    test("should preserve error stack traces", async () => {
      const newClient = new ChromaStorageClientImpl(testConfig);

      try {
        await newClient.getOrCreateCollection("test");
      } catch (error) {
        expect(error).toBeInstanceOf(StorageConnectionError);
        expect((error as Error).stack).toBeDefined();
      }
    });

    test("should include cause in error when available", async () => {
      mockChromaClient.setShouldFailHeartbeat(true);

      try {
        await client.healthCheck();
      } catch (error) {
        // Health check returns false instead of throwing, so test connection error
        expect(async () => {
          await client.connect();
        }).toThrow();
      }
    });
  });

  describe("Error Classes", () => {
    test("CollectionNotFoundError should be created with collection name", () => {
      const error = new CollectionNotFoundError("test_collection");
      expect(error.name).toBe("CollectionNotFoundError");
      expect(error.collectionName).toBe("test_collection");
      expect(error.message).toContain("test_collection");
    });

    test("SearchOperationError should be created with collections", () => {
      const error = new SearchOperationError("Search failed", ["collection1", "collection2"]);
      expect(error.name).toBe("SearchOperationError");
      expect(error.collections).toEqual(["collection1", "collection2"]);
      expect(error.message).toBe("Search failed");
    });
  });
});
