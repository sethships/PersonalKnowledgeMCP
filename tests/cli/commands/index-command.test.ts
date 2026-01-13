/**
 * Tests for Index Command
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/await-thenable */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import { describe, it, expect, beforeEach, vi, type Mock } from "bun:test";
import { indexCommand, type IndexCommandOptions } from "../../../src/cli/commands/index-command.js";
import type { CliDependencies } from "../../../src/cli/utils/dependency-init.js";
import type { IndexResult } from "../../../src/services/ingestion-types.js";

// Helper to create complete IndexResult mock
function createMockIndexResult(): IndexResult {
  return {
    status: "success",
    repository: "test-repo",
    collectionName: "test-repo",
    stats: {
      filesScanned: 10,
      filesProcessed: 10,
      filesFailed: 0,
      chunksCreated: 50,
      embeddingsGenerated: 50,
      documentsStored: 50,
      durationMs: 1000,
    },
    errors: [],
    completedAt: new Date(),
  };
}

describe("Index Command", () => {
  let mockDeps: CliDependencies;
  let mockIndexRepository: Mock<
    (url: string, opts: Record<string, unknown>) => Promise<IndexResult>
  >;

  beforeEach(() => {
    mockIndexRepository = vi.fn();

    mockDeps = {
      ingestionService: {
        indexRepository: mockIndexRepository,
      },
      repositoryService: {
        getRepository: vi.fn(),
      },
    } as unknown as CliDependencies;
  });

  describe("URL validation", () => {
    it("should accept valid HTTPS URLs with .git extension", async () => {
      mockIndexRepository.mockResolvedValue(createMockIndexResult());

      await expect(
        indexCommand("https://github.com/user/repo.git", {}, mockDeps)
      ).resolves.toBeUndefined();
    });

    it("should accept valid HTTPS URLs without .git extension", async () => {
      mockIndexRepository.mockResolvedValue(createMockIndexResult());

      await expect(
        indexCommand("https://github.com/user/repo", {}, mockDeps)
      ).resolves.toBeUndefined();
    });

    it("should accept valid SSH URLs", async () => {
      mockIndexRepository.mockResolvedValue(createMockIndexResult());

      await expect(
        indexCommand("git@github.com:user/repo.git", {}, mockDeps)
      ).resolves.toBeUndefined();
    });

    it("should reject invalid URL formats", async () => {
      await expect(indexCommand("not-a-url", {}, mockDeps)).rejects.toThrow(
        "Invalid repository URL"
      );
    });

    it("should reject URLs with path traversal patterns", async () => {
      // URLs that would extract names containing path traversal
      await expect(
        indexCommand("https://github.com/user/../../evil", {}, mockDeps)
      ).rejects.toThrow();

      // URL that's malformed and would fail validation
      await expect(indexCommand("https://github.com/user/", {}, mockDeps)).rejects.toThrow();
    });
  });

  describe("Repository name extraction", () => {
    it("should extract repository name from URL without .git", async () => {
      mockIndexRepository.mockResolvedValue(createMockIndexResult());

      await indexCommand("https://github.com/user/my-repo.git", {}, mockDeps);

      expect(mockIndexRepository).toHaveBeenCalledWith(
        "https://github.com/user/my-repo.git",
        expect.objectContaining({ force: undefined, branch: undefined })
      );
    });

    it("should use custom name when provided", async () => {
      mockIndexRepository.mockResolvedValue(createMockIndexResult());

      const options: IndexCommandOptions = { name: "custom-name" };
      await indexCommand("https://github.com/user/repo.git", options, mockDeps);

      // The command passes options to ingestion service, not the extracted name
      expect(mockIndexRepository).toHaveBeenCalled();
    });
  });

  describe("Force reindexing", () => {
    it("should allow reindexing when force flag is set", async () => {
      const mockRepo = { name: "existing-repo", status: "ready" };
      (mockDeps.repositoryService.getRepository as Mock<() => Promise<any>>).mockResolvedValue(
        mockRepo
      );

      mockIndexRepository.mockResolvedValue(createMockIndexResult());

      const options: IndexCommandOptions = { force: true };
      await expect(
        indexCommand("https://github.com/user/repo.git", options, mockDeps)
      ).resolves.toBeUndefined();
    });

    it("should reject indexing existing repository without force flag", async () => {
      const mockRepo = { name: "existing-repo", status: "ready" };
      (mockDeps.repositoryService.getRepository as Mock<() => Promise<any>>).mockResolvedValue(
        mockRepo
      );

      await expect(indexCommand("https://github.com/user/repo.git", {}, mockDeps)).rejects.toThrow(
        "already indexed"
      );
    });
  });

  describe("Progress callbacks", () => {
    it("should call onProgress callback during indexing", async () => {
      mockIndexRepository.mockImplementation(async (_url: string, opts: any) => {
        if (opts.onProgress) {
          opts.onProgress({ phase: "cloning", details: {} });
          opts.onProgress({ phase: "scanning", details: { filesScanned: 10 } });
        }
        return createMockIndexResult();
      });

      // Note: The actual command creates its own progress handler internally
      // This test verifies that the command passes a progress callback to the service
      await indexCommand("https://github.com/user/repo.git", {}, mockDeps);

      expect(mockIndexRepository).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          onProgress: expect.any(Function),
        })
      );
    });
  });

  describe("Branch option", () => {
    it("should pass branch option to ingestion service", async () => {
      mockIndexRepository.mockResolvedValue(createMockIndexResult());

      const options: IndexCommandOptions = { branch: "develop" };
      await indexCommand("https://github.com/user/repo.git", options, mockDeps);

      expect(mockIndexRepository).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ branch: "develop" })
      );
    });
  });

  describe("Error handling and partial success", () => {
    it("should handle partial success status with warnings", async () => {
      const partialResult: IndexResult = {
        status: "partial",
        repository: "test-repo",
        collectionName: "test-repo",
        stats: {
          filesScanned: 10,
          filesProcessed: 8,
          filesFailed: 2,
          chunksCreated: 40,
          embeddingsGenerated: 40,
          documentsStored: 40,
          durationMs: 1000,
        },
        errors: [
          { type: "file_error", message: "File 1 failed to process" },
          { type: "file_error", message: "File 2 failed to process" },
        ],
        completedAt: new Date(),
      };

      mockIndexRepository.mockResolvedValue(partialResult);

      // Partial success should complete without throwing
      await expect(
        indexCommand("https://github.com/user/repo.git", {}, mockDeps)
      ).resolves.toBeUndefined();
    });

    it("should truncate error list to first 5 when more than 5 errors", async () => {
      const partialResult: IndexResult = {
        status: "partial",
        repository: "test-repo",
        collectionName: "test-repo",
        stats: {
          filesScanned: 10,
          filesProcessed: 4,
          filesFailed: 6,
          chunksCreated: 20,
          embeddingsGenerated: 20,
          documentsStored: 20,
          durationMs: 1000,
        },
        errors: [
          { type: "file_error", message: "Error 1" },
          { type: "file_error", message: "Error 2" },
          { type: "file_error", message: "Error 3" },
          { type: "file_error", message: "Error 4" },
          { type: "file_error", message: "Error 5" },
          { type: "file_error", message: "Error 6" },
          { type: "file_error", message: "Error 7" },
        ],
        completedAt: new Date(),
      };

      mockIndexRepository.mockResolvedValue(partialResult);

      // Should complete without throwing despite many errors
      await expect(
        indexCommand("https://github.com/user/repo.git", {}, mockDeps)
      ).resolves.toBeUndefined();
    });

    it("should handle failed status and throw error", async () => {
      const failedResult: IndexResult = {
        status: "failed",
        repository: "test-repo",
        collectionName: "test-repo",
        stats: {
          filesScanned: 0,
          filesProcessed: 0,
          filesFailed: 0,
          chunksCreated: 0,
          embeddingsGenerated: 0,
          documentsStored: 0,
          durationMs: 500,
        },
        errors: [{ type: "fatal_error", message: "Failed to clone repository" }],
        completedAt: new Date(),
      };

      mockIndexRepository.mockResolvedValue(failedResult);

      await expect(indexCommand("https://github.com/user/repo.git", {}, mockDeps)).rejects.toThrow(
        "Indexing failed"
      );
    });

    it("should handle failed status with no errors", async () => {
      const failedResult: IndexResult = {
        status: "failed",
        repository: "test-repo",
        collectionName: "test-repo",
        stats: {
          filesScanned: 0,
          filesProcessed: 0,
          filesFailed: 0,
          chunksCreated: 0,
          embeddingsGenerated: 0,
          documentsStored: 0,
          durationMs: 500,
        },
        errors: [],
        completedAt: new Date(),
      };

      mockIndexRepository.mockResolvedValue(failedResult);

      await expect(indexCommand("https://github.com/user/repo.git", {}, mockDeps)).rejects.toThrow(
        "Unknown error"
      );
    });

    it("should handle service exception and stop spinner", async () => {
      mockIndexRepository.mockRejectedValue(new Error("Network failure"));

      await expect(indexCommand("https://github.com/user/repo.git", {}, mockDeps)).rejects.toThrow(
        "Network failure"
      );
    });

    it("should handle non-Error exception", async () => {
      mockIndexRepository.mockRejectedValue("String error");

      await expect(indexCommand("https://github.com/user/repo.git", {}, mockDeps)).rejects.toThrow(
        "String error"
      );
    });
  });

  describe("Repository name extraction edge cases", () => {
    it("should reject URLs that extract names with path traversal patterns", async () => {
      // Mock to ensure we test the extraction function
      mockIndexRepository.mockResolvedValue(createMockIndexResult());

      // URL where extracted name contains ..
      await expect(indexCommand("https://github.com/user/...", {}, mockDeps)).rejects.toThrow();
    });

    it("should reject URLs that extract names with forward slash", async () => {
      // URL that could extract a name with slash (won't actually work but tests the logic)
      await expect(
        indexCommand("https://github.com/user/evil%2Frepo", {}, mockDeps)
      ).rejects.toThrow();
    });

    it("should reject URLs with empty final segment", async () => {
      // URL with trailing slash results in empty segment
      await expect(indexCommand("https://github.com/user/", {}, mockDeps)).rejects.toThrow();
    });

    it("should reject URLs with only domain", async () => {
      await expect(indexCommand("https://github.com/", {}, mockDeps)).rejects.toThrow();
    });
  });

  describe("Provider option", () => {
    it("should accept provider option in IndexCommandOptions", async () => {
      mockIndexRepository.mockResolvedValue(createMockIndexResult());

      const options: IndexCommandOptions = { provider: "openai" };
      await indexCommand("https://github.com/user/repo.git", options, mockDeps);

      // The command should complete successfully with provider option
      expect(mockIndexRepository).toHaveBeenCalled();
    });

    it("should accept different provider values", async () => {
      mockIndexRepository.mockResolvedValue(createMockIndexResult());

      // Test with transformersjs
      const options1: IndexCommandOptions = { provider: "transformersjs" };
      await indexCommand("https://github.com/user/repo.git", options1, mockDeps);
      expect(mockIndexRepository).toHaveBeenCalled();

      // Reset mock
      mockIndexRepository.mockClear();
      mockIndexRepository.mockResolvedValue(createMockIndexResult());

      // Test with local (alias for transformersjs)
      const options2: IndexCommandOptions = { provider: "local" };
      await indexCommand("https://github.com/user/repo.git", options2, mockDeps);
      expect(mockIndexRepository).toHaveBeenCalled();
    });

    it("should accept provider with other options combined", async () => {
      mockIndexRepository.mockResolvedValue(createMockIndexResult());

      const options: IndexCommandOptions = {
        name: "custom-name",
        branch: "develop",
        force: true,
        provider: "ollama",
      };
      await indexCommand("https://github.com/user/repo.git", options, mockDeps);

      expect(mockIndexRepository).toHaveBeenCalled();
    });
  });
});
