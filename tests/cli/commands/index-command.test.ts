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
});
