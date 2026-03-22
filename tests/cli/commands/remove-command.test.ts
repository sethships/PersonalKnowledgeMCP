/**
 * Tests for Remove Command
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/await-thenable */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import { describe, it, expect, beforeEach, vi, type Mock } from "bun:test";
import { removeCommand } from "../../../src/cli/commands/remove-command.js";
import type { CliDependencies } from "../../../src/cli/utils/dependency-init.js";
import * as prompts from "../../../src/cli/utils/prompts.js";

describe("Remove Command", () => {
  let mockDeps: CliDependencies;
  let mockGetRepository: Mock<(name: string) => Promise<any>>;
  let mockRemoveRepository: Mock<(name: string) => Promise<void>>;

  beforeEach(() => {
    mockGetRepository = vi.fn();
    mockRemoveRepository = vi.fn().mockResolvedValue(undefined);

    mockDeps = {
      repositoryService: {
        getRepository: mockGetRepository,
      },
      ingestionService: {
        removeRepository: mockRemoveRepository,
      },
    } as unknown as CliDependencies;
  });

  describe("repository not found", () => {
    it("should throw an error when repository does not exist", async () => {
      mockGetRepository.mockResolvedValue(null);

      await expect(removeCommand("nonexistent-repo", { force: true }, mockDeps)).rejects.toThrow(
        "Repository 'nonexistent-repo' not found."
      );

      expect(mockRemoveRepository).not.toHaveBeenCalled();
    });
  });

  describe("confirmation prompt", () => {
    it("should log 'Operation cancelled' and not remove when user declines", async () => {
      mockGetRepository.mockResolvedValue({ name: "test-repo", localPath: null });

      const confirmSpy = vi.spyOn(prompts, "confirm").mockResolvedValue(false);
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      try {
        await removeCommand("test-repo", { force: false }, mockDeps);

        expect(mockRemoveRepository).not.toHaveBeenCalled();
        // Check that Operation cancelled was logged
        const calls = consoleSpy.mock.calls.map((c) => String(c[0]));
        expect(calls.some((msg) => msg.includes("Operation cancelled"))).toBe(true);
      } finally {
        confirmSpy.mockRestore();
        consoleSpy.mockRestore();
      }
    });

    it("should proceed when user confirms", async () => {
      mockGetRepository.mockResolvedValue({ name: "test-repo", localPath: null });

      const confirmSpy = vi.spyOn(prompts, "confirm").mockResolvedValue(true);

      try {
        await removeCommand("test-repo", { force: false }, mockDeps);

        expect(confirmSpy).toHaveBeenCalledWith("Type 'yes' to confirm:");
        expect(mockRemoveRepository).toHaveBeenCalledWith("test-repo");
      } finally {
        confirmSpy.mockRestore();
      }
    });

    it("should mention graph data in prompt when graphIngestionService is available", async () => {
      mockGetRepository.mockResolvedValue({ name: "test-repo", localPath: null });

      const mockGraphIngestionService = {
        deleteRepositoryData: vi.fn().mockResolvedValue(undefined),
      };

      const depsWithGraph = {
        ...mockDeps,
        graphIngestionService: mockGraphIngestionService,
      } as unknown as CliDependencies;

      const confirmSpy = vi.spyOn(prompts, "confirm").mockResolvedValue(false);
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      try {
        await removeCommand("test-repo", { force: false }, depsWithGraph);

        const loggedMessages = consoleSpy.mock.calls.map((c) => String(c[0]));
        expect(loggedMessages.some((msg) => msg.includes("Graph data from FalkorDB"))).toBe(true);
      } finally {
        confirmSpy.mockRestore();
        consoleSpy.mockRestore();
      }
    });

    it("should not mention graph data in prompt when graphIngestionService is not available", async () => {
      mockGetRepository.mockResolvedValue({ name: "test-repo", localPath: null });

      const confirmSpy = vi.spyOn(prompts, "confirm").mockResolvedValue(false);
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      try {
        await removeCommand("test-repo", { force: false }, mockDeps);

        const loggedMessages = consoleSpy.mock.calls.map((c) => String(c[0]));
        expect(loggedMessages.some((msg) => msg.includes("Graph data from FalkorDB"))).toBe(false);
      } finally {
        confirmSpy.mockRestore();
        consoleSpy.mockRestore();
      }
    });
  });

  describe("remove without graph adapter", () => {
    it("should succeed without calling graph service", async () => {
      mockGetRepository.mockResolvedValue({ name: "test-repo", localPath: null });

      await removeCommand("test-repo", { force: true }, mockDeps);

      expect(mockRemoveRepository).toHaveBeenCalledWith("test-repo");
    });
  });

  describe("remove with graph adapter (success)", () => {
    it("should call deleteRepositoryData and succeed", async () => {
      mockGetRepository.mockResolvedValue({ name: "test-repo", localPath: null });

      const mockDeleteRepositoryData = vi.fn().mockResolvedValue(undefined);
      const depsWithGraph = {
        ...mockDeps,
        graphIngestionService: {
          deleteRepositoryData: mockDeleteRepositoryData,
        },
      } as unknown as CliDependencies;

      await removeCommand("test-repo", { force: true }, depsWithGraph);

      expect(mockRemoveRepository).toHaveBeenCalledWith("test-repo");
      expect(mockDeleteRepositoryData).toHaveBeenCalledWith("test-repo");
    });
  });

  describe("remove with graph adapter (failure)", () => {
    it("should warn but not throw when graph deletion fails", async () => {
      mockGetRepository.mockResolvedValue({ name: "test-repo", localPath: null });

      const mockDeleteRepositoryData = vi
        .fn()
        .mockRejectedValue(new Error("FalkorDB connection refused"));

      const depsWithGraph = {
        ...mockDeps,
        graphIngestionService: {
          deleteRepositoryData: mockDeleteRepositoryData,
        },
      } as unknown as CliDependencies;

      // Should not throw
      await expect(
        removeCommand("test-repo", { force: true }, depsWithGraph)
      ).resolves.toBeUndefined();

      expect(mockRemoveRepository).toHaveBeenCalledWith("test-repo");
      expect(mockDeleteRepositoryData).toHaveBeenCalledWith("test-repo");
    });
  });

  describe("remove with --force flag", () => {
    it("should skip confirmation prompt when --force is set", async () => {
      mockGetRepository.mockResolvedValue({ name: "test-repo", localPath: null });

      const confirmSpy = vi.spyOn(prompts, "confirm");

      try {
        await removeCommand("test-repo", { force: true }, mockDeps);

        expect(confirmSpy).not.toHaveBeenCalled();
        expect(mockRemoveRepository).toHaveBeenCalledWith("test-repo");
      } finally {
        confirmSpy.mockRestore();
      }
    });
  });

  describe("propagates removal errors", () => {
    it("should re-throw errors from ingestionService.removeRepository", async () => {
      mockGetRepository.mockResolvedValue({ name: "test-repo", localPath: null });
      mockRemoveRepository.mockRejectedValue(new Error("ChromaDB unavailable"));

      await expect(removeCommand("test-repo", { force: true }, mockDeps)).rejects.toThrow(
        "ChromaDB unavailable"
      );
    });
  });
});
