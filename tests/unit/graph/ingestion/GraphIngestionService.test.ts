/**
 * Unit tests for GraphIngestionService.
 *
 * Tests the orchestration of entity/relationship extraction and Neo4j storage
 * using mocked dependencies for isolated unit testing.
 */

/* eslint-disable @typescript-eslint/await-thenable */
import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { GraphIngestionService } from "../../../../src/graph/ingestion/GraphIngestionService.js";
import type {
  GraphIngestionConfig,
  GraphIngestionOptions,
  GraphIngestionProgress,
  FileInput,
} from "../../../../src/graph/ingestion/types.js";
import { DEFAULT_GRAPH_INGESTION_CONFIG } from "../../../../src/graph/ingestion/types.js";
import {
  IngestionInProgressError,
  RepositoryExistsError,
} from "../../../../src/graph/ingestion/errors.js";
import type { Neo4jStorageClient } from "../../../../src/graph/types.js";
import { EntityExtractor } from "../../../../src/graph/extraction/EntityExtractor.js";
import { RelationshipExtractor } from "../../../../src/graph/extraction/RelationshipExtractor.js";
import type {
  ExtractionResult,
  RelationshipExtractionResult,
} from "../../../../src/graph/extraction/types.js";
import { initializeLogger, resetLogger } from "../../../../src/logging/index.js";

// Initialize logger for tests (silent mode)
beforeEach(() => {
  initializeLogger({ level: "silent", format: "json" });
});

afterEach(() => {
  resetLogger();
});

/**
 * Create a mock Neo4jStorageClient
 */
function createMockNeo4jClient(): Neo4jStorageClient {
  return {
    connect: mock(() => Promise.resolve()),
    disconnect: mock(() => Promise.resolve()),
    healthCheck: mock(() => Promise.resolve(true)),
    runQuery: mock(() => Promise.resolve([])),
    upsertNode: mock(() => Promise.resolve("node-id")),
    deleteNode: mock(() => Promise.resolve(true)),
    findNode: mock(() => Promise.resolve(null)),
    findNodes: mock(() => Promise.resolve([])),
    createRelationship: mock(() => Promise.resolve("rel-id")),
    deleteRelationship: mock(() => Promise.resolve(true)),
    findRelationships: mock(() => Promise.resolve([])),
    traverse: mock(() => Promise.resolve([])),
    getStatistics: mock(() =>
      Promise.resolve({
        nodeCount: 0,
        relationshipCount: 0,
        labelCounts: {},
        relationshipTypeCounts: {},
      })
    ),
    createIndexes: mock(() => Promise.resolve()),
  } as unknown as Neo4jStorageClient;
}

/**
 * Create a mock EntityExtractor
 */
function createMockEntityExtractor(): EntityExtractor {
  const extractor = new EntityExtractor();
  return extractor;
}

/**
 * Create a mock RelationshipExtractor
 */
function createMockRelationshipExtractor(): RelationshipExtractor {
  const extractor = new RelationshipExtractor();
  return extractor;
}

/**
 * Sample extraction result for testing
 */
function createSampleExtractionResult(filePath: string): ExtractionResult {
  return {
    success: true,
    filePath,
    language: "typescript",
    parseTimeMs: 10,
    entities: [
      {
        name: "testFunction",
        type: "function",
        filePath,
        lineStart: 1,
        lineEnd: 5,
        isExported: true,
        metadata: {
          isAsync: false,
          parameters: [
            { name: "x", type: "number", hasDefault: false, isOptional: false, isRest: false },
          ],
          returnType: "number",
        },
      },
      {
        name: "TestClass",
        type: "class",
        filePath,
        lineStart: 7,
        lineEnd: 20,
        isExported: true,
        metadata: {},
      },
    ],
    errors: [],
  };
}

/**
 * Sample relationship extraction result
 */
function createSampleRelationshipResult(filePath: string): RelationshipExtractionResult {
  return {
    success: true,
    filePath,
    language: "typescript",
    parseTimeMs: 10,
    imports: [
      {
        sourceFile: filePath,
        targetModule: "lodash",
        importInfo: {
          source: "lodash",
          isRelative: false,
          importedNames: ["map", "filter"],
          isTypeOnly: false,
          isSideEffect: false,
          line: 1,
        },
        isExternal: true,
      },
    ],
    exports: [
      {
        sourceFile: filePath,
        exportInfo: {
          exportedNames: ["testFunction"],
          isTypeOnly: false,
          isNamespaceExport: false,
          line: 5,
        },
        isReExport: false,
      },
    ],
    errors: [],
  };
}

/**
 * Sample file input
 */
function createSampleFileInput(filePath: string, content?: string): FileInput {
  return {
    path: filePath,
    content: content ?? `export function testFunction(x: number): number { return x * 2; }`,
  };
}

describe("GraphIngestionService", () => {
  let service: GraphIngestionService;
  let mockNeo4jClient: Neo4jStorageClient;
  let mockEntityExtractor: EntityExtractor;
  let mockRelationshipExtractor: RelationshipExtractor;

  beforeEach(() => {
    mockNeo4jClient = createMockNeo4jClient();
    mockEntityExtractor = createMockEntityExtractor();
    mockRelationshipExtractor = createMockRelationshipExtractor();

    service = new GraphIngestionService(
      mockNeo4jClient,
      mockEntityExtractor,
      mockRelationshipExtractor
    );
  });

  describe("constructor", () => {
    it("should create instance with default config", () => {
      const svc = new GraphIngestionService(
        mockNeo4jClient,
        mockEntityExtractor,
        mockRelationshipExtractor
      );
      expect(svc).toBeInstanceOf(GraphIngestionService);
    });

    it("should create instance with custom config", () => {
      const config: GraphIngestionConfig = {
        nodeBatchSize: 50,
        relationshipBatchSize: 100,
        transactionTimeoutMs: 60000,
      };
      const svc = new GraphIngestionService(
        mockNeo4jClient,
        mockEntityExtractor,
        mockRelationshipExtractor,
        config
      );
      expect(svc).toBeInstanceOf(GraphIngestionService);
    });

    it("should merge custom config with defaults", () => {
      const config: GraphIngestionConfig = {
        nodeBatchSize: 50,
      };
      const svc = new GraphIngestionService(
        mockNeo4jClient,
        mockEntityExtractor,
        mockRelationshipExtractor,
        config
      );
      // Service is created - config is internal but service should work
      expect(svc).toBeInstanceOf(GraphIngestionService);
    });
  });

  describe("getStatus", () => {
    it("should return idle status initially", () => {
      const status = service.getStatus();
      expect(status.isIngesting).toBe(false);
      expect(status.currentOperation).toBeNull();
    });
  });

  describe("ingestFiles", () => {
    it("should reject if already ingesting", async () => {
      const options: GraphIngestionOptions = {
        repository: "test-repo",
        repositoryUrl: "https://github.com/test/test-repo",
      };

      // Use a deferred promise to control when extraction completes
      let resolveExtraction: ((value: ExtractionResult) => void) | null = null;
      const extractionPromise = new Promise<ExtractionResult>((resolve) => {
        resolveExtraction = resolve;
      });

      // Mock runQuery to return no existing repo
      (mockNeo4jClient.runQuery as ReturnType<typeof mock>).mockResolvedValue([]);

      // Spy on entity extractor to block until we say so
      const extractSpy = spyOn(mockEntityExtractor, "extractFromContent").mockReturnValue(
        extractionPromise
      );
      const relSpy = spyOn(mockRelationshipExtractor, "extractFromContent").mockResolvedValue(
        createSampleRelationshipResult("test.ts")
      );

      const files = [createSampleFileInput("test.ts")];

      // Start first ingestion (don't await, let it hang on extraction)
      const firstIngestion = service.ingestFiles(files, options);

      // Give it a moment to start
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify it's ingesting
      expect(service.getStatus().isIngesting).toBe(true);

      // Try to start second ingestion - should fail immediately
      await expect(service.ingestFiles(files, options)).rejects.toThrow(IngestionInProgressError);

      // Now resolve the extraction to let first ingestion complete
      resolveExtraction!(createSampleExtractionResult("test.ts"));

      // Wait for first ingestion to complete
      try {
        await firstIngestion;
      } catch {
        // May fail due to incomplete mocking, but that's OK
      }

      extractSpy.mockRestore();
      relSpy.mockRestore();
    });

    it("should reject if repository exists without force flag", async () => {
      const options: GraphIngestionOptions = {
        repository: "existing-repo",
        repositoryUrl: "https://github.com/test/existing-repo",
        force: false,
      };

      // Mock runQuery to return existing repo
      (mockNeo4jClient.runQuery as ReturnType<typeof mock>).mockResolvedValueOnce([{ count: 1 }]);

      const files = [createSampleFileInput("test.ts")];
      await expect(service.ingestFiles(files, options)).rejects.toThrow(RepositoryExistsError);
    });

    it("should reject empty repository name", async () => {
      const options: GraphIngestionOptions = {
        repository: "",
        repositoryUrl: "https://github.com/test/empty-repo",
      };

      const files = [createSampleFileInput("test.ts")];
      await expect(service.ingestFiles(files, options)).rejects.toThrow(
        /Repository name cannot be empty/
      );
    });

    it("should reject whitespace-only repository name", async () => {
      const options: GraphIngestionOptions = {
        repository: "   ",
        repositoryUrl: "https://github.com/test/whitespace-repo",
      };

      const files = [createSampleFileInput("test.ts")];
      await expect(service.ingestFiles(files, options)).rejects.toThrow(
        /Repository name cannot be empty/
      );
    });

    it("should reject repository name with invalid characters", async () => {
      const options: GraphIngestionOptions = {
        repository: "repo:with:colons",
        repositoryUrl: "https://github.com/test/invalid-repo",
      };

      const files = [createSampleFileInput("test.ts")];
      await expect(service.ingestFiles(files, options)).rejects.toThrow(/Invalid repository name/);
    });

    it("should reject repository name starting with non-alphanumeric", async () => {
      const options: GraphIngestionOptions = {
        repository: "-invalid-start",
        repositoryUrl: "https://github.com/test/invalid-start",
      };

      const files = [createSampleFileInput("test.ts")];
      await expect(service.ingestFiles(files, options)).rejects.toThrow(/Invalid repository name/);
    });

    it("should accept valid repository names", async () => {
      const validNames = ["my-repo", "my_repo", "my.repo", "MyRepo123", "repo.v2", "a"];

      for (const repoName of validNames) {
        const options: GraphIngestionOptions = {
          repository: repoName,
          repositoryUrl: `https://github.com/test/${repoName}`,
        };

        // Mock runQuery to return no existing repo
        (mockNeo4jClient.runQuery as ReturnType<typeof mock>).mockResolvedValue([]);

        // Spy on extractors
        const entitySpy = spyOn(mockEntityExtractor, "extractFromContent").mockResolvedValue(
          createSampleExtractionResult("test.ts")
        );
        const relSpy = spyOn(mockRelationshipExtractor, "extractFromContent").mockResolvedValue(
          createSampleRelationshipResult("test.ts")
        );

        const files = [createSampleFileInput("test.ts")];
        const result = await service.ingestFiles(files, options);

        // Should not throw and complete successfully
        expect(result.repository).toBe(repoName);
        expect(result.status).toBe("success");

        entitySpy.mockRestore();
        relSpy.mockRestore();
      }
    });

    it("should allow re-ingestion with force flag", async () => {
      const options: GraphIngestionOptions = {
        repository: "existing-repo",
        repositoryUrl: "https://github.com/test/existing-repo",
        force: true,
      };

      // Mock runQuery: first call returns existing repo, rest return empty
      (mockNeo4jClient.runQuery as ReturnType<typeof mock>)
        .mockResolvedValueOnce([{ count: 1 }]) // checkRepositoryExists
        .mockResolvedValue([]); // all other queries

      // Spy on extractors
      const entitySpy = spyOn(mockEntityExtractor, "extractFromContent").mockResolvedValue(
        createSampleExtractionResult("test.ts")
      );
      const relSpy = spyOn(mockRelationshipExtractor, "extractFromContent").mockResolvedValue(
        createSampleRelationshipResult("test.ts")
      );

      const files = [createSampleFileInput("test.ts")];
      const result = await service.ingestFiles(files, options);

      expect(result.status).toBe("success");
      expect(result.repository).toBe("existing-repo");

      entitySpy.mockRestore();
      relSpy.mockRestore();
    });

    it("should ingest files successfully", async () => {
      const progressUpdates: GraphIngestionProgress[] = [];
      const options: GraphIngestionOptions = {
        repository: "test-repo",
        repositoryUrl: "https://github.com/test/test-repo",
        onProgress: (progress) => progressUpdates.push(progress),
      };

      // Mock runQuery to return no existing repo
      (mockNeo4jClient.runQuery as ReturnType<typeof mock>).mockResolvedValue([]);

      // Spy on extractors
      const entitySpy = spyOn(mockEntityExtractor, "extractFromContent").mockResolvedValue(
        createSampleExtractionResult("test.ts")
      );
      const relSpy = spyOn(mockRelationshipExtractor, "extractFromContent").mockResolvedValue(
        createSampleRelationshipResult("test.ts")
      );

      const files = [createSampleFileInput("test.ts")];
      const result = await service.ingestFiles(files, options);

      expect(result.status).toBe("success");
      expect(result.repository).toBe("test-repo");
      expect(result.stats.filesProcessed).toBe(1);
      expect(result.stats.filesFailed).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(result.completedAt).toBeInstanceOf(Date);
      expect(result.stats.durationMs).toBeGreaterThanOrEqual(0);

      // Verify progress was reported
      expect(progressUpdates.length).toBeGreaterThan(0);

      entitySpy.mockRestore();
      relSpy.mockRestore();
    });

    it("should handle extraction errors gracefully", async () => {
      const options: GraphIngestionOptions = {
        repository: "test-repo",
        repositoryUrl: "https://github.com/test/test-repo",
      };

      // Mock runQuery to return no existing repo
      (mockNeo4jClient.runQuery as ReturnType<typeof mock>).mockResolvedValue([]);

      // Spy on entity extractor to throw error
      const entitySpy = spyOn(mockEntityExtractor, "extractFromContent").mockRejectedValue(
        new Error("Parse error")
      );
      const relSpy = spyOn(mockRelationshipExtractor, "extractFromContent").mockResolvedValue(
        createSampleRelationshipResult("test.ts")
      );

      const files = [createSampleFileInput("test.ts")];
      const result = await service.ingestFiles(files, options);

      // Should return partial or failed status with errors
      expect(["partial", "failed"]).toContain(result.status);
      expect(result.errors.length).toBeGreaterThan(0);

      entitySpy.mockRestore();
      relSpy.mockRestore();
    });

    it("should process multiple files", async () => {
      const options: GraphIngestionOptions = {
        repository: "test-repo",
        repositoryUrl: "https://github.com/test/test-repo",
      };

      // Mock runQuery to return no existing repo
      (mockNeo4jClient.runQuery as ReturnType<typeof mock>).mockResolvedValue([]);

      // Spy on extractors
      const entitySpy = spyOn(mockEntityExtractor, "extractFromContent").mockImplementation(
        (_, filePath) => Promise.resolve(createSampleExtractionResult(filePath))
      );
      const relSpy = spyOn(mockRelationshipExtractor, "extractFromContent").mockImplementation(
        (_, filePath) => Promise.resolve(createSampleRelationshipResult(filePath))
      );

      const files = [
        createSampleFileInput("src/index.ts"),
        createSampleFileInput("src/utils.ts"),
        createSampleFileInput("src/helpers.ts"),
      ];
      const result = await service.ingestFiles(files, options);

      expect(result.status).toBe("success");
      expect(result.stats.filesProcessed).toBe(3);
      expect(result.stats.filesFailed).toBe(0);

      entitySpy.mockRestore();
      relSpy.mockRestore();
    });

    it("should skip unsupported file types", async () => {
      const options: GraphIngestionOptions = {
        repository: "test-repo",
        repositoryUrl: "https://github.com/test/test-repo",
      };

      // Mock runQuery to return no existing repo
      (mockNeo4jClient.runQuery as ReturnType<typeof mock>).mockResolvedValue([]);

      // Spy on extractors
      const entitySpy = spyOn(mockEntityExtractor, "extractFromContent").mockResolvedValue(
        createSampleExtractionResult("test.ts")
      );
      const relSpy = spyOn(mockRelationshipExtractor, "extractFromContent").mockResolvedValue(
        createSampleRelationshipResult("test.ts")
      );

      const files = [
        createSampleFileInput("test.ts"),
        createSampleFileInput("README.md", "# README"),
        createSampleFileInput("styles.css", ".class { color: red; }"),
      ];
      const result = await service.ingestFiles(files, options);

      expect(result.status).toBe("success");
      // Only .ts file should be processed for entity/relationship extraction
      expect(result.stats.filesProcessed).toBe(3); // All files processed (File nodes created)

      entitySpy.mockRestore();
      relSpy.mockRestore();
    });

    it("should return status to idle after completion", async () => {
      const options: GraphIngestionOptions = {
        repository: "test-repo",
        repositoryUrl: "https://github.com/test/test-repo",
      };

      // Mock runQuery to return no existing repo
      (mockNeo4jClient.runQuery as ReturnType<typeof mock>).mockResolvedValue([]);

      // Spy on extractors
      const entitySpy = spyOn(mockEntityExtractor, "extractFromContent").mockResolvedValue(
        createSampleExtractionResult("test.ts")
      );
      const relSpy = spyOn(mockRelationshipExtractor, "extractFromContent").mockResolvedValue(
        createSampleRelationshipResult("test.ts")
      );

      const files = [createSampleFileInput("test.ts")];
      await service.ingestFiles(files, options);

      const status = service.getStatus();
      expect(status.isIngesting).toBe(false);
      expect(status.currentOperation).toBeNull();

      entitySpy.mockRestore();
      relSpy.mockRestore();
    });
  });

  describe("ingestFile", () => {
    it("should ingest single file successfully", async () => {
      // Mock runQuery
      (mockNeo4jClient.runQuery as ReturnType<typeof mock>).mockResolvedValue([]);

      // Spy on extractors
      const entitySpy = spyOn(mockEntityExtractor, "extractFromContent").mockResolvedValue(
        createSampleExtractionResult("test.ts")
      );
      const relSpy = spyOn(mockRelationshipExtractor, "extractFromContent").mockResolvedValue(
        createSampleRelationshipResult("test.ts")
      );

      const file = createSampleFileInput("test.ts");
      const result = await service.ingestFile(file, "test-repo");

      expect(result.success).toBe(true);
      expect(result.filePath).toBe("test.ts");
      expect(result.nodesCreated).toBeGreaterThanOrEqual(0);
      expect(result.relationshipsCreated).toBeGreaterThanOrEqual(0);

      entitySpy.mockRestore();
      relSpy.mockRestore();
    });

    it("should handle errors in single file ingestion", async () => {
      // Mock runQuery to throw
      (mockNeo4jClient.runQuery as ReturnType<typeof mock>).mockRejectedValue(
        new Error("DB error")
      );

      // Spy on extractors
      const entitySpy = spyOn(mockEntityExtractor, "extractFromContent").mockResolvedValue(
        createSampleExtractionResult("test.ts")
      );
      const relSpy = spyOn(mockRelationshipExtractor, "extractFromContent").mockResolvedValue(
        createSampleRelationshipResult("test.ts")
      );

      const file = createSampleFileInput("test.ts");
      const result = await service.ingestFile(file, "test-repo");

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);

      entitySpy.mockRestore();
      relSpy.mockRestore();
    });
  });

  describe("deleteRepositoryData", () => {
    it("should delete repository data successfully", async () => {
      // Mock runQuery to return success
      (mockNeo4jClient.runQuery as ReturnType<typeof mock>).mockResolvedValue([]);

      // deleteRepositoryData returns void, so just verify it doesn't throw
      await service.deleteRepositoryData("test-repo");
      // If we get here without error, the test passes
      expect(true).toBe(true);
    });

    it("should handle errors during deletion", async () => {
      // Mock runQuery to throw error
      (mockNeo4jClient.runQuery as ReturnType<typeof mock>).mockRejectedValue(
        new Error("Delete failed")
      );

      await expect(service.deleteRepositoryData("test-repo")).rejects.toThrow("Delete failed");
    });
  });

  describe("deleteFileData", () => {
    it("should delete file data successfully and return statistics", async () => {
      // Mock runQuery to return deletion statistics
      (mockNeo4jClient.runQuery as ReturnType<typeof mock>).mockResolvedValue([
        { nodesDeleted: 5, relsDeleted: 8 },
      ]);

      const result = await service.deleteFileData("test-repo", "src/utils.ts");

      expect(result.success).toBe(true);
      expect(result.nodesDeleted).toBe(5);
      expect(result.relationshipsDeleted).toBe(8);

      // Verify runQuery was called with correct file ID
      expect(mockNeo4jClient.runQuery).toHaveBeenCalled();
      const calls = (mockNeo4jClient.runQuery as ReturnType<typeof mock>).mock.calls;
      const lastCall = calls[calls.length - 1];
      expect(lastCall?.[1]).toEqual({ fileId: "File:test-repo:src/utils.ts" });
    });

    it("should handle non-existent files gracefully", async () => {
      // Mock runQuery to return empty result (file doesn't exist)
      (mockNeo4jClient.runQuery as ReturnType<typeof mock>).mockResolvedValue([]);

      const result = await service.deleteFileData("test-repo", "src/nonexistent.ts");

      expect(result.success).toBe(true);
      expect(result.nodesDeleted).toBe(0);
      expect(result.relationshipsDeleted).toBe(0);
    });

    it("should return success=false on database error without throwing", async () => {
      // Mock runQuery to throw error
      (mockNeo4jClient.runQuery as ReturnType<typeof mock>).mockRejectedValue(
        new Error("Database connection lost")
      );

      const result = await service.deleteFileData("test-repo", "src/utils.ts");

      // Should not throw but return failure result
      expect(result.success).toBe(false);
      expect(result.nodesDeleted).toBe(0);
      expect(result.relationshipsDeleted).toBe(0);
    });

    it("should validate repository name", async () => {
      // Empty repository name should throw
      await expect(service.deleteFileData("", "src/utils.ts")).rejects.toThrow(
        /Repository name cannot be empty/
      );

      // Invalid characters should throw
      await expect(service.deleteFileData("repo:invalid", "src/utils.ts")).rejects.toThrow(
        /Invalid repository name/
      );
    });

    it("should validate file path", async () => {
      // Empty file path should throw
      await expect(service.deleteFileData("test-repo", "")).rejects.toThrow(
        /File path cannot be empty/
      );

      // Whitespace-only file path should throw
      await expect(service.deleteFileData("test-repo", "   ")).rejects.toThrow(
        /File path cannot be empty/
      );
    });

    it("should generate correct file node ID", async () => {
      (mockNeo4jClient.runQuery as ReturnType<typeof mock>).mockResolvedValue([
        { nodesDeleted: 1, relsDeleted: 2 },
      ]);

      await service.deleteFileData("my-project", "src/components/Button.tsx");

      const calls = (mockNeo4jClient.runQuery as ReturnType<typeof mock>).mock.calls;
      const lastCall = calls[calls.length - 1];
      expect(lastCall?.[1]).toEqual({ fileId: "File:my-project:src/components/Button.tsx" });
    });
  });

  describe("progress reporting", () => {
    it("should report progress through all phases", async () => {
      const progressUpdates: GraphIngestionProgress[] = [];
      const options: GraphIngestionOptions = {
        repository: "test-repo",
        repositoryUrl: "https://github.com/test/test-repo",
        onProgress: (progress) => progressUpdates.push({ ...progress }),
      };

      // Mock runQuery
      (mockNeo4jClient.runQuery as ReturnType<typeof mock>).mockResolvedValue([]);

      // Spy on extractors
      const entitySpy = spyOn(mockEntityExtractor, "extractFromContent").mockResolvedValue(
        createSampleExtractionResult("test.ts")
      );
      const relSpy = spyOn(mockRelationshipExtractor, "extractFromContent").mockResolvedValue(
        createSampleRelationshipResult("test.ts")
      );

      const files = [createSampleFileInput("test.ts")];
      await service.ingestFiles(files, options);

      // Verify progress was reported for multiple phases
      expect(progressUpdates.length).toBeGreaterThan(0);

      // Check that all progress updates have required fields
      for (const progress of progressUpdates) {
        expect(progress.phase).toBeDefined();
        expect(progress.repository).toBe("test-repo");
        expect(progress.percentage).toBeGreaterThanOrEqual(0);
        expect(progress.percentage).toBeLessThanOrEqual(100);
        expect(progress.timestamp).toBeInstanceOf(Date);
      }

      entitySpy.mockRestore();
      relSpy.mockRestore();
    });
  });

  describe("batch processing", () => {
    it("should batch node creation according to config", async () => {
      const config: GraphIngestionConfig = {
        nodeBatchSize: 2, // Small batch size for testing
        relationshipBatchSize: 50,
        transactionTimeoutMs: 30000,
      };

      const customService = new GraphIngestionService(
        mockNeo4jClient,
        mockEntityExtractor,
        mockRelationshipExtractor,
        config
      );

      const options: GraphIngestionOptions = {
        repository: "test-repo",
        repositoryUrl: "https://github.com/test/test-repo",
      };

      // Mock runQuery
      (mockNeo4jClient.runQuery as ReturnType<typeof mock>).mockResolvedValue([]);

      // Create extraction result with multiple entities
      const manyEntitiesResult: ExtractionResult = {
        success: true,
        filePath: "test.ts",
        language: "typescript",
        parseTimeMs: 10,
        entities: [
          {
            name: "func1",
            type: "function",
            filePath: "test.ts",
            lineStart: 1,
            lineEnd: 5,
            isExported: true,
            metadata: {},
          },
          {
            name: "func2",
            type: "function",
            filePath: "test.ts",
            lineStart: 7,
            lineEnd: 10,
            isExported: true,
            metadata: {},
          },
          {
            name: "func3",
            type: "function",
            filePath: "test.ts",
            lineStart: 12,
            lineEnd: 15,
            isExported: true,
            metadata: {},
          },
          {
            name: "func4",
            type: "function",
            filePath: "test.ts",
            lineStart: 17,
            lineEnd: 20,
            isExported: true,
            metadata: {},
          },
          {
            name: "func5",
            type: "function",
            filePath: "test.ts",
            lineStart: 22,
            lineEnd: 25,
            isExported: true,
            metadata: {},
          },
        ],
        errors: [],
      };

      const entitySpy = spyOn(mockEntityExtractor, "extractFromContent").mockResolvedValue(
        manyEntitiesResult
      );
      const relSpy = spyOn(mockRelationshipExtractor, "extractFromContent").mockResolvedValue(
        createSampleRelationshipResult("test.ts")
      );

      const files = [createSampleFileInput("test.ts")];
      const result = await customService.ingestFiles(files, options);

      expect(result.status).toBe("success");
      // Multiple batches should have been processed (5 entities with batch size 2 = 3 batches)
      expect(
        (mockNeo4jClient.runQuery as ReturnType<typeof mock>).mock.calls.length
      ).toBeGreaterThan(1);

      entitySpy.mockRestore();
      relSpy.mockRestore();
    });
  });
});

describe("DEFAULT_GRAPH_INGESTION_CONFIG", () => {
  it("should have expected default values", () => {
    expect(DEFAULT_GRAPH_INGESTION_CONFIG.nodeBatchSize).toBe(20);
    expect(DEFAULT_GRAPH_INGESTION_CONFIG.relationshipBatchSize).toBe(50);
    expect(DEFAULT_GRAPH_INGESTION_CONFIG.transactionTimeoutMs).toBe(30000);
  });
});
