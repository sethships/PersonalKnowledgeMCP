/**
 * Tests for Providers Command
 *
 * Comprehensive tests for embedding provider management CLI commands:
 * - status: Show available providers and their configuration status
 * - setup: Download and prepare local embedding models
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "bun:test";
import {
  providersStatusCommand,
  type ProvidersStatusOptions,
} from "../../../src/cli/commands/providers-command.js";
import type { CliDependencies } from "../../../src/cli/utils/dependency-init.js";
import type { RepositoryMetadataService, RepositoryInfo } from "../../../src/repositories/types.js";
import {
  ProvidersStatusCommandOptionsSchema,
  ProvidersSetupCommandOptionsSchema,
} from "../../../src/cli/utils/validation.js";
import {
  extractRepositoryProviderUsage,
  formatProvidersJson,
  createProvidersTable,
  createRepositoryProviderTable,
  type ProviderDisplayInfo,
  type RepositoryProviderUsage,
} from "../../../src/cli/output/providers-formatters.js";

/**
 * Create a mock RepositoryMetadataService
 */
function createMockRepositoryService(
  repositories: RepositoryInfo[] = []
): RepositoryMetadataService {
  return {
    listRepositories: vi.fn().mockResolvedValue(repositories),
    getRepository: vi.fn(),
    updateRepository: vi.fn(),
    removeRepository: vi.fn(),
  };
}

/**
 * Create test repository metadata
 */
function createTestRepository(overrides: Partial<RepositoryInfo> = {}): RepositoryInfo {
  return {
    name: "test-repo",
    url: "https://github.com/user/test-repo.git",
    localPath: "./data/repos/test-repo",
    collectionName: "repo_test_repo",
    fileCount: 100,
    chunkCount: 500,
    lastIndexedAt: "2024-12-01T00:00:00Z",
    indexDurationMs: 5000,
    status: "ready",
    branch: "main",
    includeExtensions: [".ts", ".js"],
    excludePatterns: ["node_modules/**"],
    embeddingProvider: "openai",
    embeddingModel: "text-embedding-3-small",
    embeddingDimensions: 1536,
    ...overrides,
  };
}

/**
 * Create a mock CliDependencies object
 */
function createMockDeps(repositoryService: RepositoryMetadataService): CliDependencies {
  return {
    repositoryService,
  } as unknown as CliDependencies;
}

interface ParsedJsonOutput {
  providers: Array<{ id: string; status: string }>;
  repositories: Array<{ name: string; provider: string; model: string; chunkCount: number }>;
  summary: { totalProviders: number; readyProviders: number; totalRepositories: number };
}

describe("Providers Commands", () => {
  let capturedLogs: string[];
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    capturedLogs = [];
    // Store original env values
    originalEnv = {
      OPENAI_API_KEY: Bun.env["OPENAI_API_KEY"],
    };
    // Use fresh spy for each test
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      capturedLogs.push(args.map((a) => String(a)).join(" "));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Restore original env values
    if (originalEnv["OPENAI_API_KEY"] !== undefined) {
      Bun.env["OPENAI_API_KEY"] = originalEnv["OPENAI_API_KEY"];
    }
  });

  describe("providersStatusCommand", () => {
    it("should display providers table when no --json flag", async () => {
      const mockRepoService = createMockRepositoryService([]);
      const deps = createMockDeps(mockRepoService);
      const options: ProvidersStatusOptions = { json: false };

      await providersStatusCommand(options, deps);

      // Should have called listRepositories
      expect(mockRepoService.listRepositories).toHaveBeenCalled();

      // Should have output with "Embedding Providers" header
      const output = capturedLogs.join("\n");
      expect(output).toContain("Embedding Providers");
    });

    it("should display JSON output with --json flag", async () => {
      const mockRepoService = createMockRepositoryService([]);
      const deps = createMockDeps(mockRepoService);
      const options: ProvidersStatusOptions = { json: true };

      await providersStatusCommand(options, deps);

      // Should output valid JSON
      const output = capturedLogs.join("\n");
      let parseSucceeded = false;
      try {
        JSON.parse(output) as unknown;
        parseSucceeded = true;
      } catch {
        parseSucceeded = false;
      }
      expect(parseSucceeded).toBe(true);

      const parsed = JSON.parse(output) as ParsedJsonOutput;
      expect(parsed).toHaveProperty("providers");
      expect(parsed).toHaveProperty("repositories");
      expect(parsed).toHaveProperty("summary");
    });

    it("should show OpenAI as ready when OPENAI_API_KEY is set", async () => {
      Bun.env["OPENAI_API_KEY"] = "test-key";
      const mockRepoService = createMockRepositoryService([]);
      const deps = createMockDeps(mockRepoService);
      const options: ProvidersStatusOptions = { json: true };

      await providersStatusCommand(options, deps);

      const output = capturedLogs.join("\n");
      const parsed = JSON.parse(output) as ParsedJsonOutput;
      const openaiProvider = parsed.providers.find((p) => p.id === "openai");
      expect(openaiProvider).toBeDefined();
      expect(openaiProvider?.status).toBe("ready");
    });

    it("should show OpenAI as not-configured when OPENAI_API_KEY is missing", async () => {
      delete Bun.env["OPENAI_API_KEY"];
      const mockRepoService = createMockRepositoryService([]);
      const deps = createMockDeps(mockRepoService);
      const options: ProvidersStatusOptions = { json: true };

      await providersStatusCommand(options, deps);

      const output = capturedLogs.join("\n");
      const parsed = JSON.parse(output) as ParsedJsonOutput;
      const openaiProvider = parsed.providers.find((p) => p.id === "openai");
      expect(openaiProvider).toBeDefined();
      expect(openaiProvider?.status).toBe("not-configured");
    });

    it("should show transformersjs provider as ready", async () => {
      const mockRepoService = createMockRepositoryService([]);
      const deps = createMockDeps(mockRepoService);
      const options: ProvidersStatusOptions = { json: true };

      await providersStatusCommand(options, deps);

      const output = capturedLogs.join("\n");
      const parsed = JSON.parse(output) as ParsedJsonOutput;
      const transformersProvider = parsed.providers.find((p) => p.id === "transformersjs");
      expect(transformersProvider).toBeDefined();
      expect(transformersProvider?.status).toBe("ready");
    });

    it("should include repository provider usage in output", async () => {
      const testRepo = createTestRepository({
        name: "my-project",
        embeddingProvider: "openai",
        embeddingModel: "text-embedding-3-small",
        chunkCount: 1000,
      });
      const mockRepoService = createMockRepositoryService([testRepo]);
      const deps = createMockDeps(mockRepoService);
      const options: ProvidersStatusOptions = { json: true };

      await providersStatusCommand(options, deps);

      const output = capturedLogs.join("\n");
      const parsed = JSON.parse(output) as ParsedJsonOutput;
      expect(parsed.repositories).toHaveLength(1);
      const repo = parsed.repositories[0];
      if (!repo) throw new Error("Repository not found");
      expect(repo.name).toBe("my-project");
      expect(repo.provider).toBe("openai");
      expect(repo.model).toBe("text-embedding-3-small");
      expect(repo.chunkCount).toBe(1000);
    });

    it("should handle multiple repositories with different providers", async () => {
      const repos = [
        createTestRepository({
          name: "openai-project",
          embeddingProvider: "openai",
          embeddingModel: "text-embedding-3-small",
        }),
        createTestRepository({
          name: "local-project",
          embeddingProvider: "transformersjs",
          embeddingModel: "all-MiniLM-L6-v2",
          embeddingDimensions: 384,
        }),
      ];
      const mockRepoService = createMockRepositoryService(repos);
      const deps = createMockDeps(mockRepoService);
      const options: ProvidersStatusOptions = { json: true };

      await providersStatusCommand(options, deps);

      const output = capturedLogs.join("\n");
      const parsed = JSON.parse(output) as ParsedJsonOutput;
      expect(parsed.repositories).toHaveLength(2);
      expect(parsed.summary.totalRepositories).toBe(2);
    });

    it("should include summary statistics", async () => {
      Bun.env["OPENAI_API_KEY"] = "test-key";
      const mockRepoService = createMockRepositoryService([createTestRepository()]);
      const deps = createMockDeps(mockRepoService);
      const options: ProvidersStatusOptions = { json: true };

      await providersStatusCommand(options, deps);

      const output = capturedLogs.join("\n");
      const parsed = JSON.parse(output) as ParsedJsonOutput;
      expect(parsed.summary.totalProviders).toBe(3); // openai, transformersjs, ollama
      expect(parsed.summary.readyProviders).toBeGreaterThanOrEqual(1);
      expect(parsed.summary.totalRepositories).toBe(1);
    });

    it("should default provider to openai when not specified in repository", async () => {
      const testRepo = createTestRepository({
        embeddingProvider: undefined,
        embeddingModel: undefined,
      });
      const mockRepoService = createMockRepositoryService([testRepo]);
      const deps = createMockDeps(mockRepoService);
      const options: ProvidersStatusOptions = { json: true };

      await providersStatusCommand(options, deps);

      const output = capturedLogs.join("\n");
      const parsed = JSON.parse(output) as ParsedJsonOutput;
      const repo = parsed.repositories[0];
      if (!repo) throw new Error("Repository not found");
      expect(repo.provider).toBe("openai");
    });
  });

  describe("ProvidersStatusCommandOptionsSchema", () => {
    it("should accept valid options", () => {
      const result = ProvidersStatusCommandOptionsSchema.parse({ json: true });
      expect(result.json).toBe(true);
    });

    it("should accept empty options", () => {
      const result = ProvidersStatusCommandOptionsSchema.parse({});
      expect(result.json).toBeUndefined();
    });
  });

  describe("ProvidersSetupCommandOptionsSchema", () => {
    it("should accept valid local providers", () => {
      expect(() =>
        ProvidersSetupCommandOptionsSchema.parse({ provider: "transformersjs" })
      ).not.toThrow();
      expect(() => ProvidersSetupCommandOptionsSchema.parse({ provider: "local" })).not.toThrow();
      expect(() => ProvidersSetupCommandOptionsSchema.parse({ provider: "ollama" })).not.toThrow();
    });

    it("should normalize provider to lowercase", () => {
      const result = ProvidersSetupCommandOptionsSchema.parse({ provider: "TRANSFORMERSJS" });
      expect(result.provider).toBe("transformersjs");
    });

    it("should accept optional model parameter", () => {
      const result = ProvidersSetupCommandOptionsSchema.parse({
        provider: "transformersjs",
        model: "Xenova/bge-small-en-v1.5",
      });
      expect(result.model).toBe("Xenova/bge-small-en-v1.5");
    });

    it("should accept optional force parameter", () => {
      const result = ProvidersSetupCommandOptionsSchema.parse({
        provider: "transformersjs",
        force: true,
      });
      expect(result.force).toBe(true);
    });

    it("should reject openai as it does not need setup", () => {
      expect(() => ProvidersSetupCommandOptionsSchema.parse({ provider: "openai" })).toThrow();
    });

    it("should reject unknown providers", () => {
      expect(() => ProvidersSetupCommandOptionsSchema.parse({ provider: "unknown" })).toThrow();
    });
  });
});

describe("Providers Formatters", () => {
  describe("extractRepositoryProviderUsage", () => {
    it("should extract provider info from repositories", () => {
      const repos: RepositoryInfo[] = [
        {
          name: "test-1",
          url: "https://github.com/user/test-1.git",
          localPath: "./data/repos/test-1",
          collectionName: "repo_test_1",
          fileCount: 50,
          chunkCount: 100,
          lastIndexedAt: "2024-12-01T00:00:00Z",
          indexDurationMs: 3000,
          status: "ready",
          branch: "main",
          includeExtensions: [".ts"],
          excludePatterns: [],
          embeddingProvider: "openai",
          embeddingModel: "text-embedding-3-small",
          embeddingDimensions: 1536,
        },
      ];

      const result = extractRepositoryProviderUsage(repos);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        name: "test-1",
        provider: "openai",
        model: "text-embedding-3-small",
        dimensions: 1536,
        chunkCount: 100,
      });
    });

    it("should default to openai when provider not specified", () => {
      const repos: RepositoryInfo[] = [
        {
          name: "test-repo",
          url: "https://github.com/user/test-repo.git",
          localPath: "./data/repos/test-repo",
          collectionName: "repo_test_repo",
          fileCount: 50,
          chunkCount: 100,
          lastIndexedAt: "2024-12-01T00:00:00Z",
          indexDurationMs: 3000,
          status: "ready",
          branch: "main",
          includeExtensions: [".ts"],
          excludePatterns: [],
          embeddingProvider: undefined,
        },
      ];

      const result = extractRepositoryProviderUsage(repos);
      const first = result[0];
      if (!first) throw new Error("Result not found");
      expect(first.provider).toBe("openai");
    });
  });

  describe("formatProvidersJson", () => {
    it("should format providers and repositories as JSON", () => {
      const providers: ProviderDisplayInfo[] = [
        {
          id: "openai",
          name: "OpenAI",
          description: "OpenAI Embeddings API",
          status: "ready",
          model: "text-embedding-3-small",
          dimensions: 1536,
          isDefault: true,
        },
      ];
      const repositories: RepositoryProviderUsage[] = [
        {
          name: "test-repo",
          provider: "openai",
          model: "text-embedding-3-small",
          dimensions: 1536,
          chunkCount: 100,
        },
      ];

      const result = formatProvidersJson(providers, repositories);
      const parsed = JSON.parse(result) as ParsedJsonOutput;

      expect(parsed.providers).toHaveLength(1);
      expect(parsed.repositories).toHaveLength(1);
      expect(parsed.summary.totalProviders).toBe(1);
      expect(parsed.summary.readyProviders).toBe(1);
      expect(parsed.summary.totalRepositories).toBe(1);
    });
  });

  describe("createProvidersTable", () => {
    it("should create a formatted table string", () => {
      const providers: ProviderDisplayInfo[] = [
        {
          id: "openai",
          name: "OpenAI",
          description: "OpenAI Embeddings API",
          status: "ready",
          model: "text-embedding-3-small",
          dimensions: 1536,
          isDefault: true,
        },
      ];

      const result = createProvidersTable(providers);
      expect(result).toContain("Embedding Providers");
      expect(result).toContain("OpenAI");
    });

    it("should handle empty providers list", () => {
      const result = createProvidersTable([]);
      expect(result).toContain("No providers configured");
    });
  });

  describe("createRepositoryProviderTable", () => {
    it("should create a formatted table of repository provider usage", () => {
      const repositories: RepositoryProviderUsage[] = [
        {
          name: "test-repo",
          provider: "openai",
          model: "text-embedding-3-small",
          dimensions: 1536,
          chunkCount: 100,
        },
      ];

      const result = createRepositoryProviderTable(repositories);
      expect(result).toContain("Repository Provider Usage");
      expect(result).toContain("test-repo");
    });

    it("should handle empty repositories list", () => {
      const result = createRepositoryProviderTable([]);
      expect(result).toContain("No repositories indexed");
    });
  });
});
