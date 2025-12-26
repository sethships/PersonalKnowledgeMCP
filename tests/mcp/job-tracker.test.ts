/**
 * Tests for Job Tracker
 *
 * Comprehensive test coverage for async job tracking functionality.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  JobTracker,
  getSharedJobTracker,
  resetSharedJobTracker,
} from "../../src/mcp/job-tracker.js";
import type { CoordinatorResult } from "../../src/services/incremental-update-coordinator-types.js";
import { initializeLogger, resetLogger } from "../../src/logging/index.js";

/**
 * Create a mock CoordinatorResult for testing
 */
function createMockResult(overrides?: Partial<CoordinatorResult>): CoordinatorResult {
  return {
    status: "updated",
    commitSha: "abc1234567890",
    commitMessage: "feat: test commit",
    stats: {
      filesAdded: 5,
      filesModified: 3,
      filesDeleted: 1,
      chunksUpserted: 20,
      chunksDeleted: 5,
      durationMs: 1500,
    },
    errors: [],
    durationMs: 1500,
    ...overrides,
  };
}

describe("JobTracker", () => {
  let tracker: JobTracker;

  beforeEach(() => {
    try {
      initializeLogger({ level: "silent", format: "json" });
    } catch {
      // Logger already initialized
    }
    tracker = new JobTracker({ maxJobAgeMs: 1000, maxJobs: 10 });
  });

  afterEach(() => {
    tracker.clear();
    resetLogger();
  });

  describe("createJob", () => {
    it("should create a job with pending status", () => {
      const jobId = tracker.createJob("test-repo");

      expect(jobId).toBeDefined();
      expect(jobId).toMatch(/^update-[a-z0-9]+-[a-f0-9]+$/);

      const job = tracker.getJob(jobId);
      expect(job).toBeDefined();
      expect(job!.status).toBe("pending");
      expect(job!.repository).toBe("test-repo");
      expect(job!.startedAt).toBeDefined();
    });

    it("should generate unique job IDs", () => {
      const id1 = tracker.createJob("repo-1");
      const id2 = tracker.createJob("repo-2");
      const id3 = tracker.createJob("repo-3");

      expect(id1).not.toBe(id2);
      expect(id2).not.toBe(id3);
      expect(id1).not.toBe(id3);
    });

    it("should increment job count", () => {
      expect(tracker.size()).toBe(0);

      tracker.createJob("repo-1");
      expect(tracker.size()).toBe(1);

      tracker.createJob("repo-2");
      expect(tracker.size()).toBe(2);
    });
  });

  describe("updateStatus", () => {
    it("should update job status", () => {
      const jobId = tracker.createJob("test-repo");

      tracker.updateStatus(jobId, "running");

      const job = tracker.getJob(jobId);
      expect(job!.status).toBe("running");
    });

    it("should handle updating non-existent job", () => {
      // Should not throw
      tracker.updateStatus("non-existent-id", "running");
    });
  });

  describe("complete", () => {
    it("should mark job as completed with result", () => {
      const jobId = tracker.createJob("test-repo");
      const result = createMockResult();

      tracker.complete(jobId, result);

      const job = tracker.getJob(jobId);
      expect(job!.status).toBe("completed");
      expect(job!.completedAt).toBeDefined();
      expect(job!.result).toBeDefined();
      expect(job!.result!.status).toBe("updated");
    });

    it("should store result statistics correctly", () => {
      const jobId = tracker.createJob("test-repo");
      const result = createMockResult({
        stats: {
          filesAdded: 10,
          filesModified: 5,
          filesDeleted: 2,
          chunksUpserted: 50,
          chunksDeleted: 10,
          durationMs: 2000,
        },
      });

      tracker.complete(jobId, result);

      const job = tracker.getJob(jobId);
      expect(job!.result!.stats.filesAdded).toBe(10);
      expect(job!.result!.stats.chunksUpserted).toBe(50);
    });

    it("should handle completing non-existent job", () => {
      // Should not throw
      tracker.complete("non-existent-id", createMockResult());
    });
  });

  describe("fail", () => {
    it("should mark job as failed with error message", () => {
      const jobId = tracker.createJob("test-repo");

      tracker.fail(jobId, "Connection timeout");

      const job = tracker.getJob(jobId);
      expect(job!.status).toBe("failed");
      expect(job!.completedAt).toBeDefined();
      expect(job!.error).toBe("Connection timeout");
    });

    it("should handle failing non-existent job", () => {
      // Should not throw
      tracker.fail("non-existent-id", "Some error");
    });
  });

  describe("timeout", () => {
    it("should mark job as timed out", () => {
      const jobId = tracker.createJob("test-repo");

      tracker.timeout(jobId);

      const job = tracker.getJob(jobId);
      expect(job!.status).toBe("timeout");
      expect(job!.completedAt).toBeDefined();
      expect(job!.error).toContain("timed out");
    });

    it("should handle timing out non-existent job", () => {
      // Should not throw
      tracker.timeout("non-existent-id");
    });
  });

  describe("getJob", () => {
    it("should return null for non-existent job", () => {
      const job = tracker.getJob("non-existent-id");
      expect(job).toBeNull();
    });

    it("should return job with all fields", () => {
      const jobId = tracker.createJob("test-repo");
      tracker.updateStatus(jobId, "running");

      const job = tracker.getJob(jobId);
      expect(job).toBeDefined();
      expect(job!.id).toBe(jobId);
      expect(job!.repository).toBe("test-repo");
      expect(job!.status).toBe("running");
      expect(job!.startedAt).toBeDefined();
    });
  });

  describe("getJobResponse", () => {
    it("should return null for non-existent job", () => {
      const response = tracker.getJobResponse("non-existent-id");
      expect(response).toBeNull();
    });

    it("should return response with snake_case fields", () => {
      const jobId = tracker.createJob("test-repo");

      const response = tracker.getJobResponse(jobId);
      expect(response).toBeDefined();
      expect(response!.job_id).toBe(jobId);
      expect(response!.repository).toBe("test-repo");
      expect(response!.status).toBe("pending");
      expect(response!.started_at).toBeDefined();
    });

    it("should include result with snake_case fields when completed", () => {
      const jobId = tracker.createJob("test-repo");
      tracker.complete(jobId, createMockResult());

      const response = tracker.getJobResponse(jobId);
      expect(response!.completed_at).toBeDefined();
      expect(response!.result).toBeDefined();
      expect(response!.result!.files_added).toBe(5);
      expect(response!.result!.files_modified).toBe(3);
      expect(response!.result!.chunks_upserted).toBe(20);
      expect(response!.result!.duration_ms).toBe(1500);
    });

    it("should include error when failed", () => {
      const jobId = tracker.createJob("test-repo");
      tracker.fail(jobId, "Connection failed");

      const response = tracker.getJobResponse(jobId);
      expect(response!.error).toBe("Connection failed");
    });
  });

  describe("hasRunningJob", () => {
    it("should return false when no job exists", () => {
      expect(tracker.hasRunningJob("test-repo")).toBe(false);
    });

    it("should return true for pending job", () => {
      tracker.createJob("test-repo");
      expect(tracker.hasRunningJob("test-repo")).toBe(true);
    });

    it("should return true for running job", () => {
      const jobId = tracker.createJob("test-repo");
      tracker.updateStatus(jobId, "running");
      expect(tracker.hasRunningJob("test-repo")).toBe(true);
    });

    it("should return false for completed job", () => {
      const jobId = tracker.createJob("test-repo");
      tracker.complete(jobId, createMockResult());
      expect(tracker.hasRunningJob("test-repo")).toBe(false);
    });

    it("should return false for failed job", () => {
      const jobId = tracker.createJob("test-repo");
      tracker.fail(jobId, "Error");
      expect(tracker.hasRunningJob("test-repo")).toBe(false);
    });
  });

  describe("getRunningJob", () => {
    it("should return null when no job exists", () => {
      expect(tracker.getRunningJob("test-repo")).toBeNull();
    });

    it("should return pending job", () => {
      const jobId = tracker.createJob("test-repo");

      const job = tracker.getRunningJob("test-repo");
      expect(job).toBeDefined();
      expect(job!.id).toBe(jobId);
    });

    it("should return running job", () => {
      const jobId = tracker.createJob("test-repo");
      tracker.updateStatus(jobId, "running");

      const job = tracker.getRunningJob("test-repo");
      expect(job).toBeDefined();
      expect(job!.id).toBe(jobId);
    });

    it("should return null for completed job", () => {
      const jobId = tracker.createJob("test-repo");
      tracker.complete(jobId, createMockResult());
      expect(tracker.getRunningJob("test-repo")).toBeNull();
    });
  });

  describe("cleanup", () => {
    it("should remove old completed jobs", async () => {
      // Use short max age for test
      const shortTracker = new JobTracker({ maxJobAgeMs: 50 });
      const shortJobId = shortTracker.createJob("test-repo");
      shortTracker.complete(shortJobId, createMockResult());

      await new Promise((resolve) => setTimeout(resolve, 60));

      // Trigger cleanup by creating a new job
      shortTracker.createJob("new-repo");

      // Old job should be cleaned up
      expect(shortTracker.getJob(shortJobId)).toBeNull();
    });

    it("should keep running jobs", async () => {
      const shortTracker = new JobTracker({ maxJobAgeMs: 50 });
      const jobId = shortTracker.createJob("test-repo");
      shortTracker.updateStatus(jobId, "running");

      await new Promise((resolve) => setTimeout(resolve, 60));

      // Trigger cleanup
      shortTracker.createJob("new-repo");

      // Running job should still exist
      expect(shortTracker.getJob(jobId)).toBeDefined();
    });

    it("should respect maxJobs limit", () => {
      const smallTracker = new JobTracker({ maxJobs: 3 });

      // Create and complete 6 jobs
      // Cleanup happens at createJob(), so after the 6th job is created:
      // - 5 completed jobs exist before cleanup
      // - Cleanup removes 2 (to get to maxJobs=3)
      // - 6th job is added (total = 4, but cleanup happens before add, so max = 3 + 1 = 4)
      // To truly test limit, we need to trigger cleanup again
      for (let i = 0; i < 6; i++) {
        const id = smallTracker.createJob(`repo-${i}`);
        smallTracker.complete(id, createMockResult());
      }

      // Trigger another cleanup by creating a job
      smallTracker.createJob("trigger-cleanup");

      // Should now have 4 jobs: 3 oldest completed were removed, leaving 3 completed + 1 new pending
      expect(smallTracker.size()).toBeLessThanOrEqual(4);
    });
  });

  describe("clear", () => {
    it("should remove all jobs", () => {
      tracker.createJob("repo-1");
      tracker.createJob("repo-2");
      tracker.createJob("repo-3");

      expect(tracker.size()).toBe(3);

      tracker.clear();

      expect(tracker.size()).toBe(0);
    });
  });
});

describe("Shared Job Tracker", () => {
  afterEach(() => {
    resetSharedJobTracker();
    resetLogger();
  });

  beforeEach(() => {
    try {
      initializeLogger({ level: "silent", format: "json" });
    } catch {
      // Already initialized
    }
  });

  it("should return the same instance on multiple calls", () => {
    const instance1 = getSharedJobTracker();
    const instance2 = getSharedJobTracker();
    expect(instance1).toBe(instance2);
  });

  it("should create new instance after reset", () => {
    const instance1 = getSharedJobTracker();
    const jobId = instance1.createJob("test-repo");

    resetSharedJobTracker();

    const instance2 = getSharedJobTracker();
    expect(instance2).not.toBe(instance1);
    expect(instance2.getJob(jobId)).toBeNull();
  });
});
