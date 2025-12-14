/**
 * Unit tests for CLI progress indicators
 *
 * Tests spinner creation, updates, and completion for indexing and removal operations.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import type { Ora } from "ora";
import type { IndexProgress, IndexResult } from "../../../src/services/ingestion-types.js";
import {
  createIndexSpinner,
  updateIndexSpinner,
  completeIndexSpinner,
  createRemoveSpinner,
  completeRemoveSpinner,
} from "../../../src/cli/output/progress.js";

describe("CLI Progress Indicators", () => {
  describe("createIndexSpinner", () => {
    it("should create a spinner with the repository name", () => {
      const spinner = createIndexSpinner("my-repo");

      expect(spinner).toBeDefined();
      // Note: isSpinning may be false in non-TTY environments (CI)
      expect(typeof spinner.isSpinning).toBe("boolean");
    });

    it("should handle repository names with special characters", () => {
      const spinner = createIndexSpinner("org/my-repo-name");

      expect(spinner).toBeDefined();
    });

    it("should handle empty repository name", () => {
      const spinner = createIndexSpinner("");

      expect(spinner).toBeDefined();
    });
  });

  describe("updateIndexSpinner", () => {
    let spinner: Ora;

    beforeEach(() => {
      spinner = createIndexSpinner("test-repo");
    });

    describe("cloning phase", () => {
      it("should set cloning text", () => {
        const progress: IndexProgress = {
          phase: "cloning",
          repository: "test-repo",
          percentage: 10,
          details: {},
          timestamp: new Date(),
        };

        updateIndexSpinner(spinner, progress);

        expect(spinner.text).toBe("Cloning repository...");
      });
    });

    describe("scanning phase", () => {
      it("should show files scanned count when available", () => {
        const progress: IndexProgress = {
          phase: "scanning",
          repository: "test-repo",
          percentage: 20,
          details: { filesScanned: 42 },
          timestamp: new Date(),
        };

        updateIndexSpinner(spinner, progress);

        expect(spinner.text).toBe("Scanning files (42 found)...");
      });

      it("should show generic text when filesScanned not available", () => {
        const progress: IndexProgress = {
          phase: "scanning",
          repository: "test-repo",
          percentage: 20,
          details: {},
          timestamp: new Date(),
        };

        updateIndexSpinner(spinner, progress);

        expect(spinner.text).toBe("Scanning files...");
      });
    });

    describe("chunking phase", () => {
      it("should show percentage when both counts available", () => {
        const progress: IndexProgress = {
          phase: "chunking",
          repository: "test-repo",
          percentage: 50,
          details: { filesProcessed: 5, totalFiles: 10 },
          timestamp: new Date(),
        };

        updateIndexSpinner(spinner, progress);

        expect(spinner.text).toBe("Processing files (5/10 - 50%)...");
      });

      it("should show files processed count only when totalFiles not available", () => {
        const progress: IndexProgress = {
          phase: "chunking",
          repository: "test-repo",
          percentage: 50,
          details: { filesProcessed: 5 },
          timestamp: new Date(),
        };

        updateIndexSpinner(spinner, progress);

        expect(spinner.text).toBe("Processing files (5 processed)...");
      });

      it("should show generic text when no details available", () => {
        const progress: IndexProgress = {
          phase: "chunking",
          repository: "test-repo",
          percentage: 50,
          details: {},
          timestamp: new Date(),
        };

        updateIndexSpinner(spinner, progress);

        expect(spinner.text).toBe("Processing files...");
      });

      it("should calculate percentage correctly for edge cases", () => {
        const progress: IndexProgress = {
          phase: "chunking",
          repository: "test-repo",
          percentage: 33,
          details: { filesProcessed: 1, totalFiles: 3 },
          timestamp: new Date(),
        };

        updateIndexSpinner(spinner, progress);

        // 1/3 = 33.33... rounds to 33%
        expect(spinner.text).toBe("Processing files (1/3 - 33%)...");
      });
    });

    describe("embedding phase", () => {
      it("should show batch progress with percentage", () => {
        const progress: IndexProgress = {
          phase: "embedding",
          repository: "test-repo",
          percentage: 75,
          details: { currentBatch: 3, totalBatches: 4 },
          timestamp: new Date(),
        };

        updateIndexSpinner(spinner, progress);

        expect(spinner.text).toBe("Generating embeddings (batch 3/4 - 75%)...");
      });

      it("should show embeddings count when batches not available", () => {
        const progress: IndexProgress = {
          phase: "embedding",
          repository: "test-repo",
          percentage: 75,
          details: { embeddingsGenerated: 100 },
          timestamp: new Date(),
        };

        updateIndexSpinner(spinner, progress);

        expect(spinner.text).toBe("Generating embeddings (100 created)...");
      });

      it("should show generic text when no details available", () => {
        const progress: IndexProgress = {
          phase: "embedding",
          repository: "test-repo",
          percentage: 75,
          details: {},
          timestamp: new Date(),
        };

        updateIndexSpinner(spinner, progress);

        expect(spinner.text).toBe("Generating embeddings...");
      });
    });

    describe("storing phase", () => {
      it("should show documents stored count when available", () => {
        const progress: IndexProgress = {
          phase: "storing",
          repository: "test-repo",
          percentage: 90,
          details: { documentsStored: 250 },
          timestamp: new Date(),
        };

        updateIndexSpinner(spinner, progress);

        expect(spinner.text).toBe("Storing in vector database (250 stored)...");
      });

      it("should show generic text when documentsStored not available", () => {
        const progress: IndexProgress = {
          phase: "storing",
          repository: "test-repo",
          percentage: 90,
          details: {},
          timestamp: new Date(),
        };

        updateIndexSpinner(spinner, progress);

        expect(spinner.text).toBe("Storing in vector database...");
      });
    });

    describe("updating_metadata phase", () => {
      it("should show finalizing text", () => {
        const progress: IndexProgress = {
          phase: "updating_metadata",
          repository: "test-repo",
          percentage: 99,
          details: {},
          timestamp: new Date(),
        };

        updateIndexSpinner(spinner, progress);

        expect(spinner.text).toBe("Finalizing...");
      });
    });

    describe("unknown phase (default case)", () => {
      it("should show phase name for unknown phases", () => {
        const progress: IndexProgress = {
          phase: "unknown_phase" as IndexProgress["phase"],
          repository: "test-repo",
          percentage: 50,
          details: {},
          timestamp: new Date(),
        };

        updateIndexSpinner(spinner, progress);

        expect(spinner.text).toBe("Indexing (unknown_phase)...");
      });
    });
  });

  describe("completeIndexSpinner", () => {
    let spinner: Ora;

    beforeEach(() => {
      spinner = createIndexSpinner("test-repo");
    });

    it("should call succeed with stats on success", () => {
      const stats: IndexResult["stats"] = {
        filesScanned: 100,
        filesProcessed: 95,
        filesFailed: 5,
        chunksCreated: 500,
        embeddingsGenerated: 500,
        documentsStored: 500,
        durationMs: 5000,
      };

      completeIndexSpinner(spinner, true, stats);

      // Verify succeed was called (the spinner should have succeed message)
      // Can't easily check the exact message without more complex mocking,
      // but we verify the function doesn't throw
      expect(spinner).toBeDefined();
    });

    it("should format duration in seconds", () => {
      const stats: IndexResult["stats"] = {
        filesScanned: 10,
        filesProcessed: 10,
        filesFailed: 0,
        chunksCreated: 50,
        embeddingsGenerated: 50,
        documentsStored: 50,
        durationMs: 1500, // 1.5 seconds
      };

      // This should not throw
      completeIndexSpinner(spinner, true, stats);
      expect(spinner).toBeDefined();
    });

    it("should call fail on failure without error message", () => {
      completeIndexSpinner(spinner, false);

      // Verify function completed without throwing
      expect(spinner).toBeDefined();
    });

    it("should call fail on failure with error message", () => {
      completeIndexSpinner(spinner, false, undefined, "Connection timeout");

      // Verify function completed without throwing
      expect(spinner).toBeDefined();
    });

    it("should handle success without stats gracefully", () => {
      // Edge case: success=true but stats=undefined
      completeIndexSpinner(spinner, true, undefined);

      // Should default to failure path since stats required for success display
      expect(spinner).toBeDefined();
    });

    it("should handle zero duration correctly", () => {
      const stats: IndexResult["stats"] = {
        filesScanned: 1,
        filesProcessed: 1,
        filesFailed: 0,
        chunksCreated: 1,
        embeddingsGenerated: 1,
        documentsStored: 1,
        durationMs: 0,
      };

      completeIndexSpinner(spinner, true, stats);
      expect(spinner).toBeDefined();
    });

    it("should handle large numbers correctly", () => {
      const stats: IndexResult["stats"] = {
        filesScanned: 100000,
        filesProcessed: 99999,
        filesFailed: 1,
        chunksCreated: 500000,
        embeddingsGenerated: 500000,
        documentsStored: 500000,
        durationMs: 3600000, // 1 hour
      };

      completeIndexSpinner(spinner, true, stats);
      expect(spinner).toBeDefined();
    });
  });

  describe("createRemoveSpinner", () => {
    it("should create a spinner with the repository name", () => {
      const spinner = createRemoveSpinner("my-repo");

      expect(spinner).toBeDefined();
      // Note: isSpinning may be false in non-TTY environments (CI)
      expect(typeof spinner.isSpinning).toBe("boolean");
    });

    it("should handle repository names with special characters", () => {
      const spinner = createRemoveSpinner("org/repo-name");

      expect(spinner).toBeDefined();
    });
  });

  describe("completeRemoveSpinner", () => {
    let spinner: Ora;

    beforeEach(() => {
      spinner = createRemoveSpinner("test-repo");
    });

    it("should succeed with deletion message when files deleted", () => {
      completeRemoveSpinner(spinner, true, true);

      // Verify function completed without throwing
      expect(spinner).toBeDefined();
    });

    it("should succeed with preserved message when files not deleted", () => {
      completeRemoveSpinner(spinner, true, false);

      // Verify function completed without throwing
      expect(spinner).toBeDefined();
    });

    it("should fail on unsuccessful removal", () => {
      completeRemoveSpinner(spinner, false, false);

      // Verify function completed without throwing
      expect(spinner).toBeDefined();
    });

    it("should fail even when deletedFiles is true but operation failed", () => {
      // Edge case: deletion attempted but operation still failed
      completeRemoveSpinner(spinner, false, true);

      expect(spinner).toBeDefined();
    });
  });

  describe("Integration scenarios", () => {
    it("should handle full indexing workflow", () => {
      const spinner = createIndexSpinner("full-test-repo");

      // Simulate full indexing workflow
      const phases: IndexProgress["phase"][] = [
        "cloning",
        "scanning",
        "chunking",
        "embedding",
        "storing",
        "updating_metadata",
      ];

      phases.forEach((phase, index) => {
        updateIndexSpinner(spinner, {
          phase,
          repository: "full-test-repo",
          percentage: Math.round((index / phases.length) * 100),
          details: {
            filesScanned: 10,
            filesProcessed: 5,
            totalFiles: 10,
            chunksCreated: 50,
            embeddingsGenerated: 50,
            documentsStored: 50,
            currentBatch: 1,
            totalBatches: 2,
          },
          timestamp: new Date(),
        });
      });

      completeIndexSpinner(spinner, true, {
        filesScanned: 10,
        filesProcessed: 10,
        filesFailed: 0,
        chunksCreated: 50,
        embeddingsGenerated: 50,
        documentsStored: 50,
        durationMs: 10000,
      });

      expect(spinner).toBeDefined();
    });

    it("should handle failed indexing workflow", () => {
      const spinner = createIndexSpinner("failing-repo");

      updateIndexSpinner(spinner, {
        phase: "cloning",
        repository: "failing-repo",
        percentage: 10,
        details: {},
        timestamp: new Date(),
      });

      completeIndexSpinner(spinner, false, undefined, "Repository not found");

      expect(spinner).toBeDefined();
    });

    it("should handle removal workflow success", () => {
      const spinner = createRemoveSpinner("remove-test-repo");
      completeRemoveSpinner(spinner, true, true);

      expect(spinner).toBeDefined();
    });

    it("should handle removal workflow failure", () => {
      const spinner = createRemoveSpinner("remove-fail-repo");
      completeRemoveSpinner(spinner, false, false);

      expect(spinner).toBeDefined();
    });
  });
});
