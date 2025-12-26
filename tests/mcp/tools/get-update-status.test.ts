/**
 * Tests for get_update_status MCP Tool
 *
 * Comprehensive test coverage for the tool handler and response formatter.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import type { TextContent } from "@modelcontextprotocol/sdk/types.js";
import {
  createGetUpdateStatusHandler,
  getUpdateStatusToolDefinition,
} from "../../../src/mcp/tools/get-update-status.js";
import { JobTracker } from "../../../src/mcp/job-tracker.js";
import type { CoordinatorResult } from "../../../src/services/incremental-update-coordinator-types.js";
import { initializeLogger, resetLogger } from "../../../src/logging/index.js";

/**
 * Type guard to check if value is TextContent
 */
function isTextContent(value: unknown): value is TextContent {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "text" &&
    "text" in value
  );
}

/**
 * Helper to safely extract text from MCP response content
 */
function getTextContent(content: unknown): string {
  if (Array.isArray(content) && content.length > 0 && isTextContent(content[0])) {
    return content[0].text;
  }
  throw new Error("Expected text content");
}

/**
 * Create mock CoordinatorResult
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

describe("getUpdateStatusToolDefinition", () => {
  it("should have correct tool name", () => {
    expect(getUpdateStatusToolDefinition.name).toBe("get_update_status");
  });

  it("should have a description", () => {
    expect(getUpdateStatusToolDefinition.description).toBeTruthy();
    expect(getUpdateStatusToolDefinition.description!.length).toBeGreaterThan(0);
  });

  it("should require job_id parameter", () => {
    expect(getUpdateStatusToolDefinition.inputSchema.required).toContain("job_id");
  });
});

describe("createGetUpdateStatusHandler", () => {
  let jobTracker: JobTracker;
  let handler: ReturnType<typeof createGetUpdateStatusHandler>;

  beforeEach(() => {
    try {
      initializeLogger({ level: "silent", format: "json" });
    } catch {
      // Logger already initialized
    }

    jobTracker = new JobTracker({ maxJobAgeMs: 60000 });
    handler = createGetUpdateStatusHandler({ jobTracker });
  });

  afterEach(() => {
    jobTracker.clear();
    resetLogger();
  });

  describe("argument validation", () => {
    it("should reject null arguments", async () => {
      const result = await handler(null);
      expect(result.isError).toBe(true);
      const response = JSON.parse(getTextContent(result.content));
      expect(response.error).toBe("invalid_arguments");
    });

    it("should reject missing job_id", async () => {
      const result = await handler({});
      expect(result.isError).toBe(true);
      const response = JSON.parse(getTextContent(result.content));
      expect(response.error).toBe("invalid_arguments");
    });

    it("should reject empty job_id", async () => {
      const result = await handler({ job_id: "" });
      expect(result.isError).toBe(true);
      const response = JSON.parse(getTextContent(result.content));
      expect(response.error).toBe("invalid_arguments");
    });

    it("should reject whitespace-only job_id", async () => {
      const result = await handler({ job_id: "   " });
      expect(result.isError).toBe(true);
      const response = JSON.parse(getTextContent(result.content));
      expect(response.error).toBe("invalid_arguments");
    });

    it("should trim job_id whitespace", async () => {
      const jobId = jobTracker.createJob("test-repo");

      const result = await handler({ job_id: `  ${jobId}  ` });

      expect(result.isError).toBe(false);
      const response = JSON.parse(getTextContent(result.content));
      expect(response.job_id).toBe(jobId);
    });
  });

  describe("job not found", () => {
    it("should return error for non-existent job", async () => {
      const result = await handler({ job_id: "non-existent-job" });

      expect(result.isError).toBe(true);
      const response = JSON.parse(getTextContent(result.content));
      expect(response.success).toBe(false);
      expect(response.error).toBe("job_not_found");
      expect(response.message).toContain("not found");
    });
  });

  describe("pending job", () => {
    it("should return pending status", async () => {
      const jobId = jobTracker.createJob("test-repo");

      const result = await handler({ job_id: jobId });

      expect(result.isError).toBe(false);
      const response = JSON.parse(getTextContent(result.content));
      expect(response.success).toBe(true);
      expect(response.job_id).toBe(jobId);
      expect(response.repository).toBe("test-repo");
      expect(response.status).toBe("pending");
      expect(response.started_at).toBeDefined();
    });
  });

  describe("running job", () => {
    it("should return running status", async () => {
      const jobId = jobTracker.createJob("test-repo");
      jobTracker.updateStatus(jobId, "running");

      const result = await handler({ job_id: jobId });

      expect(result.isError).toBe(false);
      const response = JSON.parse(getTextContent(result.content));
      expect(response.success).toBe(true);
      expect(response.status).toBe("running");
    });
  });

  describe("completed job", () => {
    it("should return completed status with result", async () => {
      const jobId = jobTracker.createJob("test-repo");
      jobTracker.complete(jobId, createMockResult());

      const result = await handler({ job_id: jobId });

      expect(result.isError).toBe(false);
      const response = JSON.parse(getTextContent(result.content));
      expect(response.success).toBe(true);
      expect(response.status).toBe("completed");
      expect(response.completed_at).toBeDefined();
      expect(response.result).toBeDefined();
      expect(response.result.status).toBe("updated");
      expect(response.result.files_added).toBe(5);
      expect(response.result.chunks_upserted).toBe(20);
      expect(response.result.duration_ms).toBe(1500);
    });

    it("should include commit info in result", async () => {
      const jobId = jobTracker.createJob("test-repo");
      jobTracker.complete(jobId, createMockResult());

      const result = await handler({ job_id: jobId });

      const response = JSON.parse(getTextContent(result.content));
      expect(response.result.commit_sha).toBe("abc1234567890");
      expect(response.result.commit_message).toBe("feat: test commit");
    });

    it("should include error count in result", async () => {
      const jobId = jobTracker.createJob("test-repo");
      jobTracker.complete(
        jobId,
        createMockResult({
          errors: [
            { path: "test1.ts", error: "Error 1" },
            { path: "test2.ts", error: "Error 2" },
          ],
        })
      );

      const result = await handler({ job_id: jobId });

      const response = JSON.parse(getTextContent(result.content));
      expect(response.result.error_count).toBe(2);
    });
  });

  describe("failed job", () => {
    it("should return failed status with error", async () => {
      const jobId = jobTracker.createJob("test-repo");
      jobTracker.fail(jobId, "Connection timeout");

      const result = await handler({ job_id: jobId });

      expect(result.isError).toBe(false);
      const response = JSON.parse(getTextContent(result.content));
      expect(response.success).toBe(true);
      expect(response.status).toBe("failed");
      expect(response.error).toBe("Connection timeout");
      expect(response.completed_at).toBeDefined();
    });
  });

  describe("timeout job", () => {
    it("should return timeout status with error", async () => {
      const jobId = jobTracker.createJob("test-repo");
      jobTracker.timeout(jobId);

      const result = await handler({ job_id: jobId });

      expect(result.isError).toBe(false);
      const response = JSON.parse(getTextContent(result.content));
      expect(response.success).toBe(true);
      expect(response.status).toBe("timeout");
      expect(response.error).toContain("timed out");
    });
  });

  describe("response format", () => {
    it("should return properly formatted JSON", async () => {
      const jobId = jobTracker.createJob("test-repo");

      const result = await handler({ job_id: jobId });

      expect(result.isError).toBe(false);
      const text = getTextContent(result.content);

      // Should be valid JSON
      const parsed = JSON.parse(text);
      expect(parsed).toBeDefined();

      // Should have snake_case fields
      expect(parsed.job_id).toBeDefined();
      expect(parsed.started_at).toBeDefined();
    });

    it("should format JSON with pretty printing", async () => {
      const jobId = jobTracker.createJob("test-repo");

      const result = await handler({ job_id: jobId });

      const text = getTextContent(result.content);
      expect(text).toContain("\n");
      expect(text).toContain("  ");
    });
  });
});
