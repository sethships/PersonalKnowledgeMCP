/**
 * Job Tracker for Async MCP Operations
 *
 * Tracks the status of asynchronous update jobs, allowing clients to poll
 * for completion status after triggering an async update.
 *
 * @module mcp/job-tracker
 */

import { randomBytes } from "node:crypto";
import type { CoordinatorResult } from "../services/incremental-update-coordinator-types.js";
import { getComponentLogger } from "../logging/index.js";

/**
 * Status of an update job
 */
export type JobStatus = "pending" | "running" | "completed" | "failed" | "timeout";

/**
 * Complete job record
 */
export interface UpdateJob {
  /** Unique job identifier */
  id: string;
  /** Repository being updated */
  repository: string;
  /** Current job status */
  status: JobStatus;
  /** ISO 8601 timestamp when job was created */
  startedAt: string;
  /** ISO 8601 timestamp when job completed (success, failure, or timeout) */
  completedAt?: string;
  /** Result from the coordinator (when completed successfully or with partial failure) */
  result?: CoordinatorResult;
  /** Error message (when failed or timeout) */
  error?: string;
}

/**
 * Externally-facing job response format
 * Uses snake_case for JSON API convention
 */
export interface JobResponse {
  job_id: string;
  repository: string;
  status: JobStatus;
  started_at: string;
  completed_at?: string;
  result?: {
    status: string;
    commit_sha?: string;
    commit_message?: string;
    files_added: number;
    files_modified: number;
    files_deleted: number;
    chunks_upserted: number;
    chunks_deleted: number;
    duration_ms: number;
    error_count: number;
  };
  error?: string;
}

/**
 * Configuration for the job tracker
 */
export interface JobTrackerConfig {
  /** Maximum age of completed jobs before cleanup (default: 1 hour) */
  maxJobAgeMs?: number;
  /** Maximum number of jobs to keep (default: 100) */
  maxJobs?: number;
}

/**
 * Default configuration values
 */
const DEFAULT_MAX_JOB_AGE_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_MAX_JOBS = 100;

/**
 * Job Tracker
 *
 * Manages the lifecycle of async update jobs with automatic cleanup
 * of old completed jobs.
 *
 * @example
 * ```typescript
 * const tracker = new JobTracker();
 *
 * // Create a new job
 * const jobId = tracker.createJob("my-repo");
 *
 * // Update job status
 * tracker.updateStatus(jobId, "running");
 *
 * // Complete with result
 * tracker.complete(jobId, coordinatorResult);
 *
 * // Or fail with error
 * tracker.fail(jobId, "Connection timeout");
 *
 * // Get job status
 * const job = tracker.getJob(jobId);
 * ```
 */
export class JobTracker {
  private readonly jobs: Map<string, UpdateJob> = new Map();
  private readonly maxJobAgeMs: number;
  private readonly maxJobs: number;
  private readonly logger: ReturnType<typeof getComponentLogger>;

  /**
   * Creates a new job tracker instance
   *
   * @param config - Configuration options
   */
  constructor(config: JobTrackerConfig = {}) {
    this.maxJobAgeMs = config.maxJobAgeMs ?? DEFAULT_MAX_JOB_AGE_MS;
    this.maxJobs = config.maxJobs ?? DEFAULT_MAX_JOBS;
    this.logger = getComponentLogger("mcp:job-tracker");
  }

  /**
   * Generate a unique job ID
   *
   * Format: "update-{timestamp}-{random}"
   */
  private generateJobId(): string {
    const timestamp = Date.now().toString(36);
    const random = randomBytes(4).toString("hex");
    return `update-${timestamp}-${random}`;
  }

  /**
   * Create a new pending job for a repository
   *
   * @param repository - Repository name
   * @returns Unique job ID
   */
  createJob(repository: string): string {
    // Cleanup old jobs before creating new one
    this.cleanup();

    const id = this.generateJobId();
    const job: UpdateJob = {
      id,
      repository,
      status: "pending",
      startedAt: new Date().toISOString(),
    };

    this.jobs.set(id, job);
    this.logger.info({ jobId: id, repository }, "Created new update job");

    return id;
  }

  /**
   * Update the status of a job
   *
   * @param jobId - Job ID to update
   * @param status - New status
   */
  updateStatus(jobId: string, status: JobStatus): void {
    const job = this.jobs.get(jobId);
    if (!job) {
      this.logger.warn({ jobId }, "Attempted to update non-existent job");
      return;
    }

    job.status = status;
    this.logger.debug({ jobId, status }, "Updated job status");
  }

  /**
   * Mark a job as completed with result
   *
   * @param jobId - Job ID to complete
   * @param result - Coordinator result
   */
  complete(jobId: string, result: CoordinatorResult): void {
    const job = this.jobs.get(jobId);
    if (!job) {
      this.logger.warn({ jobId }, "Attempted to complete non-existent job");
      return;
    }

    job.status = "completed";
    job.completedAt = new Date().toISOString();
    job.result = result;

    this.logger.info(
      {
        jobId,
        repository: job.repository,
        resultStatus: result.status,
        durationMs: result.durationMs,
      },
      "Job completed successfully"
    );
  }

  /**
   * Mark a job as failed with error message
   *
   * @param jobId - Job ID to fail
   * @param error - Error message
   */
  fail(jobId: string, error: string): void {
    const job = this.jobs.get(jobId);
    if (!job) {
      this.logger.warn({ jobId }, "Attempted to fail non-existent job");
      return;
    }

    job.status = "failed";
    job.completedAt = new Date().toISOString();
    job.error = error;

    this.logger.error({ jobId, repository: job.repository, error }, "Job failed");
  }

  /**
   * Mark a job as timed out
   *
   * @param jobId - Job ID to timeout
   */
  timeout(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (!job) {
      this.logger.warn({ jobId }, "Attempted to timeout non-existent job");
      return;
    }

    job.status = "timeout";
    job.completedAt = new Date().toISOString();
    job.error = "Update timed out after 10 minutes";

    this.logger.warn({ jobId, repository: job.repository }, "Job timed out");
  }

  /**
   * Get a job by ID
   *
   * @param jobId - Job ID to retrieve
   * @returns Job if found, null otherwise
   */
  getJob(jobId: string): UpdateJob | null {
    return this.jobs.get(jobId) ?? null;
  }

  /**
   * Get a job by ID in external response format
   *
   * @param jobId - Job ID to retrieve
   * @returns Job response if found, null otherwise
   */
  getJobResponse(jobId: string): JobResponse | null {
    const job = this.jobs.get(jobId);
    if (!job) {
      return null;
    }

    return this.formatJobResponse(job);
  }

  /**
   * Format a job for external API response
   *
   * @param job - Internal job record
   * @returns External response format
   */
  private formatJobResponse(job: UpdateJob): JobResponse {
    const response: JobResponse = {
      job_id: job.id,
      repository: job.repository,
      status: job.status,
      started_at: job.startedAt,
    };

    if (job.completedAt) {
      response.completed_at = job.completedAt;
    }

    if (job.result) {
      response.result = {
        status: job.result.status,
        commit_sha: job.result.commitSha,
        commit_message: job.result.commitMessage,
        files_added: job.result.stats.filesAdded,
        files_modified: job.result.stats.filesModified,
        files_deleted: job.result.stats.filesDeleted,
        chunks_upserted: job.result.stats.chunksUpserted,
        chunks_deleted: job.result.stats.chunksDeleted,
        duration_ms: job.result.stats.durationMs,
        error_count: job.result.errors.length,
      };
    }

    if (job.error) {
      response.error = job.error;
    }

    return response;
  }

  /**
   * Check if a repository has a running job
   *
   * @param repository - Repository name
   * @returns True if repository has a running job
   */
  hasRunningJob(repository: string): boolean {
    for (const job of this.jobs.values()) {
      if (job.repository === repository && (job.status === "pending" || job.status === "running")) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get the running job for a repository
   *
   * @param repository - Repository name
   * @returns Running job if exists, null otherwise
   */
  getRunningJob(repository: string): UpdateJob | null {
    for (const job of this.jobs.values()) {
      if (job.repository === repository && (job.status === "pending" || job.status === "running")) {
        return job;
      }
    }
    return null;
  }

  /**
   * Clean up old completed jobs
   *
   * Removes jobs that are:
   * 1. Older than maxJobAgeMs
   * 2. In excess of maxJobs (oldest first)
   */
  cleanup(): void {
    const now = Date.now();
    const toDelete: string[] = [];

    // Find jobs older than max age
    for (const [id, job] of this.jobs) {
      if (job.completedAt) {
        const completedTime = new Date(job.completedAt).getTime();
        if (now - completedTime > this.maxJobAgeMs) {
          toDelete.push(id);
        }
      }
    }

    // Delete old jobs
    for (const id of toDelete) {
      this.jobs.delete(id);
    }

    // If still over max, delete oldest completed jobs
    if (this.jobs.size > this.maxJobs) {
      const completedJobs = Array.from(this.jobs.entries())
        .filter(([, job]) => job.completedAt)
        .sort(([, a], [, b]) => {
          const timeA = new Date(a.completedAt!).getTime();
          const timeB = new Date(b.completedAt!).getTime();
          return timeA - timeB;
        });

      const toRemove = this.jobs.size - this.maxJobs;
      for (let i = 0; i < Math.min(toRemove, completedJobs.length); i++) {
        this.jobs.delete(completedJobs[i]![0]);
      }
    }

    if (toDelete.length > 0 || this.jobs.size > this.maxJobs) {
      this.logger.debug(
        { deletedCount: toDelete.length, remainingJobs: this.jobs.size },
        "Cleaned up old jobs"
      );
    }
  }

  /**
   * Clear all jobs (for testing)
   */
  clear(): void {
    this.jobs.clear();
    this.logger.debug("Cleared all jobs");
  }

  /**
   * Get the number of tracked jobs (for testing/monitoring)
   */
  size(): number {
    return this.jobs.size;
  }
}

/**
 * Singleton instance for shared job tracking
 */
let sharedInstance: JobTracker | null = null;

/**
 * Get the shared job tracker instance
 */
export function getSharedJobTracker(): JobTracker {
  if (!sharedInstance) {
    sharedInstance = new JobTracker();
  }
  return sharedInstance;
}

/**
 * Reset the shared job tracker instance (for testing)
 */
export function resetSharedJobTracker(): void {
  sharedInstance = null;
}
