/**
 * Tests for CLI Dependency Initialization
 *
 * Tests provider resolution logic and dependency initialization.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-floating-promises */
/* eslint-disable @typescript-eslint/await-thenable */

import { describe, it, expect, beforeEach, afterEach, vi } from "bun:test";

// Mock all external dependencies before importing the module under test
const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockHealthCheck = vi.fn().mockResolvedValue(true);
const mockChromaClient = {
  connect: mockConnect,
  healthCheck: mockHealthCheck,
};

const mockEmbeddingProvider = {
  providerId: "openai",
  modelId: "text-embedding-3-small",
  dimensions: 1536,
};

// Mock modules
vi.mock("../../../src/storage/chroma-client.js", () => ({
  ChromaStorageClientImpl: vi.fn().mockImplementation(() => mockChromaClient),
}));

vi.mock("../../../src/providers/factory.js", () => ({
  createEmbeddingProvider: vi.fn().mockReturnValue(mockEmbeddingProvider),
}));

vi.mock("../../../src/repositories/metadata-store.js", () => ({
  RepositoryMetadataStoreImpl: {
    getInstance: vi.fn().mockReturnValue({}),
  },
}));

vi.mock("../../../src/services/search-service.js", () => ({
  SearchServiceImpl: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("../../../src/services/ingestion-service.js", () => ({
  IngestionService: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("../../../src/services/github-client.js", () => ({
  GitHubClientImpl: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("../../../src/services/incremental-update-pipeline.js", () => ({
  IncrementalUpdatePipeline: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("../../../src/services/incremental-update-coordinator.js", () => ({
  IncrementalUpdateCoordinator: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("../../../src/ingestion/repository-cloner.js", () => ({
  RepositoryCloner: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("../../../src/ingestion/file-scanner.js", () => ({
  FileScanner: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("../../../src/ingestion/file-chunker.js", () => ({
  FileChunker: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("../../../src/auth/token-store.js", () => ({
  TokenStoreImpl: {
    getInstance: vi.fn().mockReturnValue({}),
  },
}));

vi.mock("../../../src/auth/token-service.js", () => ({
  TokenServiceImpl: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("../../../src/graph/Neo4jClient.js", () => ({
  Neo4jStorageClientImpl: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue(true),
  })),
}));

vi.mock("../../../src/logging/index.js", () => ({
  initializeLogger: vi.fn(),
  getComponentLogger: vi.fn().mockReturnValue({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock the embedding provider factory with controlled behavior
const mockIsProviderAvailable = vi.fn();
const mockGetDefaultProvider = vi.fn();
const mockListAvailableProviders = vi.fn();

vi.mock("../../../src/providers/EmbeddingProviderFactory.js", () => ({
  embeddingProviderFactory: {
    isProviderAvailable: mockIsProviderAvailable,
    getDefaultProvider: mockGetDefaultProvider,
    listAvailableProviders: mockListAvailableProviders,
  },
}));

// Import after mocks are set up
import {
  initializeDependencies,
  type DependencyOptions,
} from "../../../src/cli/utils/dependency-init.js";
import { createEmbeddingProvider } from "../../../src/providers/factory.js";

describe("initializeDependencies", () => {
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    // Save original environment
    originalEnv = {
      EMBEDDING_PROVIDER: Bun.env["EMBEDDING_PROVIDER"],
      OPENAI_API_KEY: Bun.env["OPENAI_API_KEY"],
      CHROMADB_HOST: Bun.env["CHROMADB_HOST"],
      CHROMADB_PORT: Bun.env["CHROMADB_PORT"],
    };

    // Reset mocks
    vi.clearAllMocks();

    // Default mock behaviors
    mockIsProviderAvailable.mockReturnValue(true);
    mockGetDefaultProvider.mockReturnValue("transformersjs");
    mockListAvailableProviders.mockReturnValue([
      { id: "openai", aliases: [], requiredEnvVars: ["OPENAI_API_KEY"] },
      { id: "transformersjs", aliases: ["local", "transformers"], requiredEnvVars: [] },
      { id: "ollama", aliases: [], requiredEnvVars: ["OLLAMA_HOST"] },
    ]);

    // Reset chroma mocks
    mockConnect.mockResolvedValue(undefined);
    mockHealthCheck.mockResolvedValue(true);
  });

  afterEach(() => {
    // Restore original environment
    Object.entries(originalEnv).forEach(([key, value]) => {
      if (value === undefined) {
        delete Bun.env[key];
      } else {
        Bun.env[key] = value;
      }
    });
  });

  describe("provider resolution priority", () => {
    it("should use CLI flag over environment variable", async () => {
      // Set environment variable to openai
      Bun.env["EMBEDDING_PROVIDER"] = "openai";

      // But pass transformersjs via CLI flag
      const options: DependencyOptions = { provider: "transformersjs" };

      await initializeDependencies(options);

      // Should check availability for transformersjs (CLI flag), not openai (env var)
      expect(mockIsProviderAvailable).toHaveBeenCalledWith("transformersjs");
      expect(createEmbeddingProvider).toHaveBeenCalledWith(
        expect.objectContaining({ provider: "transformersjs" })
      );
    });

    it("should use environment variable when no CLI flag provided", async () => {
      Bun.env["EMBEDDING_PROVIDER"] = "ollama";

      await initializeDependencies();

      expect(mockIsProviderAvailable).toHaveBeenCalledWith("ollama");
      expect(createEmbeddingProvider).toHaveBeenCalledWith(
        expect.objectContaining({ provider: "ollama" })
      );
    });

    it("should use factory default when no CLI flag or env var", async () => {
      delete Bun.env["EMBEDDING_PROVIDER"];
      mockGetDefaultProvider.mockReturnValue("transformersjs");

      await initializeDependencies();

      expect(mockGetDefaultProvider).toHaveBeenCalled();
      expect(mockIsProviderAvailable).toHaveBeenCalledWith("transformersjs");
      expect(createEmbeddingProvider).toHaveBeenCalledWith(
        expect.objectContaining({ provider: "transformersjs" })
      );
    });
  });

  describe("provider availability validation", () => {
    it("should throw error when provider is unavailable with required env vars", async () => {
      mockIsProviderAvailable.mockReturnValue(false);

      const options: DependencyOptions = { provider: "openai" };

      await expect(initializeDependencies(options)).rejects.toThrow(
        "Provider 'openai' is not available"
      );
      await expect(initializeDependencies(options)).rejects.toThrow("OPENAI_API_KEY");
    });

    it("should throw error for unknown provider", async () => {
      mockIsProviderAvailable.mockReturnValue(false);
      // Return empty list to simulate unknown provider
      mockListAvailableProviders.mockReturnValue([
        { id: "openai", aliases: [], requiredEnvVars: ["OPENAI_API_KEY"] },
        { id: "transformersjs", aliases: ["local"], requiredEnvVars: [] },
      ]);

      const options: DependencyOptions = { provider: "unknown-provider" };

      await expect(initializeDependencies(options)).rejects.toThrow("Unknown provider");
      await expect(initializeDependencies(options)).rejects.toThrow("Valid providers:");
    });

    it("should handle provider aliases correctly (case-insensitive)", async () => {
      // User passes uppercase "OPENAI"
      const options: DependencyOptions = { provider: "OPENAI" };

      await initializeDependencies(options);

      // Should still work because we lowercase before comparison
      expect(mockIsProviderAvailable).toHaveBeenCalledWith("OPENAI");
      expect(createEmbeddingProvider).toHaveBeenCalledWith(
        expect.objectContaining({ provider: "OPENAI" })
      );
    });

    it("should accept local as alias for transformersjs", async () => {
      const options: DependencyOptions = { provider: "local" };

      await initializeDependencies(options);

      expect(mockIsProviderAvailable).toHaveBeenCalledWith("local");
      expect(createEmbeddingProvider).toHaveBeenCalledWith(
        expect.objectContaining({ provider: "local" })
      );
    });
  });

  describe("ChromaDB connection", () => {
    it("should throw error when ChromaDB connection fails", async () => {
      mockConnect.mockRejectedValue(new Error("Connection refused"));

      await expect(initializeDependencies()).rejects.toThrow("Failed to connect to ChromaDB");
    });

    it("should throw error when ChromaDB health check fails", async () => {
      mockHealthCheck.mockResolvedValue(false);

      await expect(initializeDependencies()).rejects.toThrow("health check failed");
    });
  });

  describe("returned dependencies", () => {
    it("should return all required dependencies", async () => {
      const deps = await initializeDependencies();

      expect(deps).toHaveProperty("embeddingProvider");
      expect(deps).toHaveProperty("chromaClient");
      expect(deps).toHaveProperty("repositoryService");
      expect(deps).toHaveProperty("searchService");
      expect(deps).toHaveProperty("ingestionService");
      expect(deps).toHaveProperty("githubClient");
      expect(deps).toHaveProperty("updatePipeline");
      expect(deps).toHaveProperty("updateCoordinator");
      expect(deps).toHaveProperty("tokenService");
      expect(deps).toHaveProperty("logger");
    });
  });
});
