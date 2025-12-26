/**
 * get_update_status MCP Tool Implementation
 *
 * This module implements the get_update_status tool for the MCP server,
 * enabling agents to check the status of async incremental update jobs.
 *
 * @module mcp/tools/get-update-status
 */

import type { Tool, CallToolResult, TextContent } from "@modelcontextprotocol/sdk/types.js";
import { getComponentLogger } from "../../logging/index.js";
import type { ToolHandler } from "../types.js";
import type { JobTracker, JobResponse } from "../job-tracker.js";

/**
 * Lazy-initialized logger to avoid initialization at module load time
 */
let logger: ReturnType<typeof getComponentLogger> | null = null;

function getLogger(): ReturnType<typeof getComponentLogger> {
  if (!logger) {
    logger = getComponentLogger("mcp:get-update-status");
  }
  return logger;
}

/**
 * Validated tool arguments
 */
interface GetStatusArgs {
  job_id: string;
}

/**
 * Error response format
 */
interface ErrorResponse {
  success: false;
  error: "job_not_found" | "invalid_arguments";
  message: string;
}

/**
 * Success response is the JobResponse with success flag
 */
interface SuccessResponse extends JobResponse {
  success: true;
}

/**
 * MCP tool definition for get_update_status
 */
export const getUpdateStatusToolDefinition: Tool = {
  name: "get_update_status",
  description:
    "Check the status of an async incremental update job. " +
    "Use the job_id returned from trigger_incremental_update (with async=true) to check progress.",
  inputSchema: {
    type: "object",
    properties: {
      job_id: {
        type: "string",
        description: "Job ID returned from trigger_incremental_update when async=true.",
        minLength: 1,
      },
    },
    required: ["job_id"],
  },
};

/**
 * Validate and extract arguments
 */
function validateArgs(args: unknown): GetStatusArgs {
  if (typeof args !== "object" || args === null) {
    throw new Error("Arguments must be an object");
  }

  const obj = args as Record<string, unknown>;

  if (typeof obj["job_id"] !== "string" || obj["job_id"].trim() === "") {
    throw new Error("job_id must be a non-empty string");
  }

  return {
    job_id: obj["job_id"].trim(),
  };
}

/**
 * Format error response as TextContent
 */
function formatErrorResponse(
  code: "job_not_found" | "invalid_arguments",
  message: string
): TextContent {
  const response: ErrorResponse = {
    success: false,
    error: code,
    message,
  };

  return {
    type: "text",
    text: JSON.stringify(response, null, 2),
  };
}

/**
 * Format success response as TextContent
 */
function formatSuccessResponse(jobResponse: JobResponse): TextContent {
  const response: SuccessResponse = {
    success: true,
    ...jobResponse,
  };

  return {
    type: "text",
    text: JSON.stringify(response, null, 2),
  };
}

/**
 * Dependencies required by the get_update_status handler
 */
export interface GetStatusDependencies {
  jobTracker: JobTracker;
}

/**
 * Creates the get_update_status tool handler
 *
 * This factory function enables dependency injection of the JobTracker,
 * allowing for easier testing and loose coupling between MCP layer and business logic.
 *
 * @param deps - Injected dependencies
 * @returns Tool handler function that checks update job status
 *
 * @example
 * ```typescript
 * const handler = createGetUpdateStatusHandler({ jobTracker });
 * const result = await handler({ job_id: "update-abc123" });
 * ```
 */
export function createGetUpdateStatusHandler(deps: GetStatusDependencies): ToolHandler {
  const { jobTracker } = deps;

  // Note: This handler is synchronous but ToolHandler requires Promise<CallToolResult>
  return (args: unknown): Promise<CallToolResult> => {
    const log = getLogger();

    try {
      // Step 1: Validate arguments
      const validatedArgs = validateArgs(args);
      const { job_id: jobId } = validatedArgs;

      log.debug({ jobId }, "get_update_status invoked");

      // Step 2: Get job from tracker
      const jobResponse = jobTracker.getJobResponse(jobId);

      if (!jobResponse) {
        log.warn({ jobId }, "Job not found");
        return Promise.resolve({
          content: [
            formatErrorResponse(
              "job_not_found",
              `Job '${jobId}' not found. Jobs are automatically cleaned up after 1 hour.`
            ),
          ],
          isError: true,
        });
      }

      log.debug(
        { jobId, status: jobResponse.status, repository: jobResponse.repository },
        "Job status retrieved"
      );

      return Promise.resolve({
        content: [formatSuccessResponse(jobResponse)],
        isError: false,
      });
    } catch (error) {
      log.error({ error }, "get_update_status failed");

      if (error instanceof Error && error.message.includes("must be")) {
        return Promise.resolve({
          content: [formatErrorResponse("invalid_arguments", error.message)],
          isError: true,
        });
      }

      return Promise.resolve({
        content: [
          formatErrorResponse(
            "invalid_arguments",
            error instanceof Error ? error.message : "Unknown error"
          ),
        ],
        isError: true,
      });
    }
  };
}
