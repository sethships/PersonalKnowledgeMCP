/**
 * trigger_incremental_update MCP Tool Implementation
 *
 * This module implements the trigger_incremental_update tool for the MCP server,
 * enabling agents to trigger incremental index updates for already-indexed repositories.
 *
 * Features:
 * - Rate limiting (1 update per repository per 5 minutes)
 * - Concurrent update protection
 * - Synchronous and asynchronous execution modes
 * - 10-minute timeout for operations
 *
 * @module mcp/tools/trigger-incremental-update
 */

import type { Tool, CallToolResult, TextContent } from "@modelcontextprotocol/sdk/types.js";
import type { RepositoryMetadataService } from "../../repositories/types.js";
import type { IncrementalUpdateCoordinator } from "../../services/incremental-update-coordinator.js";
import type { CoordinatorResult } from "../../services/incremental-update-coordinator-types.js";
import { mapToMCPError } from "../errors.js";
import { getComponentLogger } from "../../logging/index.js";
import type { ToolHandler } from "../types.js";
import type { MCPRateLimiter } from "../rate-limiter.js";
import type { JobTracker } from "../job-tracker.js";

/**
 * Timeout for update operations (10 minutes)
 */
const UPDATE_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Error codes for trigger_incremental_update responses
 */
type TriggerErrorCode =
  | "repository_not_found"
  | "rate_limited"
  | "update_in_progress"
  | "update_failed"
  | "timeout"
  | "internal_error";

/**
 * Lazy-initialized logger to avoid initialization at module load time
 */
let logger: ReturnType<typeof getComponentLogger> | null = null;

function getLogger(): ReturnType<typeof getComponentLogger> {
  if (!logger) {
    logger = getComponentLogger("mcp:trigger-incremental-update");
  }
  return logger;
}

/**
 * Validated tool arguments
 */
interface TriggerUpdateArgs {
  repository: string;
  async?: boolean;
}

/**
 * Success response for synchronous updates
 */
interface SyncSuccessResponse {
  success: true;
  repository: string;
  status: "updated" | "no_changes";
  files_added: number;
  files_modified: number;
  files_deleted: number;
  chunks_upserted: number;
  chunks_deleted: number;
  duration_ms: number;
  commit_sha?: string;
  commit_message?: string;
}

/**
 * Success response for async updates
 */
interface AsyncSuccessResponse {
  success: true;
  async: true;
  job_id: string;
  repository: string;
  message: string;
}

/**
 * Error response format
 */
interface ErrorResponse {
  success: false;
  error: TriggerErrorCode;
  message: string;
  retry_after_seconds?: number;
}

/**
 * MCP tool definition for trigger_incremental_update
 */
export const triggerIncrementalUpdateToolDefinition: Tool = {
  name: "trigger_incremental_update",
  description:
    "Triggers incremental indexing for an already-indexed repository. " +
    "Use this to refresh the knowledge base after merging PRs or making changes. " +
    "Rate limited to 1 update per repository per 5 minutes. " +
    "Set async=true to return immediately with a job ID for background processing.",
  inputSchema: {
    type: "object",
    properties: {
      repository: {
        type: "string",
        description:
          "Repository name (must already be indexed). Use list_indexed_repositories to see available repositories.",
        minLength: 1,
      },
      async: {
        type: "boolean",
        description:
          "If true, return immediately with a job ID. Use get_update_status to check progress. " +
          "If false (default), wait for the update to complete before returning.",
        default: false,
      },
    },
    required: ["repository"],
  },
};

/**
 * Validate and extract arguments
 */
function validateArgs(args: unknown): TriggerUpdateArgs {
  if (typeof args !== "object" || args === null) {
    throw new Error("Arguments must be an object");
  }

  const obj = args as Record<string, unknown>;

  if (typeof obj["repository"] !== "string" || obj["repository"].trim() === "") {
    throw new Error("repository must be a non-empty string");
  }

  return {
    repository: obj["repository"].trim(),
    async: typeof obj["async"] === "boolean" ? obj["async"] : false,
  };
}

/**
 * Format error response as TextContent
 */
function formatErrorResponse(
  code: TriggerErrorCode,
  message: string,
  retryAfterSeconds?: number
): TextContent {
  const response: ErrorResponse = {
    success: false,
    error: code,
    message,
  };

  if (retryAfterSeconds !== undefined) {
    response.retry_after_seconds = retryAfterSeconds;
  }

  return {
    type: "text",
    text: JSON.stringify(response, null, 2),
  };
}

/**
 * Format sync success response as TextContent
 */
function formatSyncSuccessResponse(repository: string, result: CoordinatorResult): TextContent {
  const response: SyncSuccessResponse = {
    success: true,
    repository,
    status: result.status === "no_changes" ? "no_changes" : "updated",
    files_added: result.stats.filesAdded,
    files_modified: result.stats.filesModified,
    files_deleted: result.stats.filesDeleted,
    chunks_upserted: result.stats.chunksUpserted,
    chunks_deleted: result.stats.chunksDeleted,
    duration_ms: result.durationMs,
  };

  if (result.commitSha) {
    response.commit_sha = result.commitSha.substring(0, 7);
  }
  if (result.commitMessage) {
    response.commit_message = result.commitMessage;
  }

  return {
    type: "text",
    text: JSON.stringify(response, null, 2),
  };
}

/**
 * Format async success response as TextContent
 */
function formatAsyncSuccessResponse(repository: string, jobId: string): TextContent {
  const response: AsyncSuccessResponse = {
    success: true,
    async: true,
    job_id: jobId,
    repository,
    message: "Update started. Use get_update_status tool with this job_id to check progress.",
  };

  return {
    type: "text",
    text: JSON.stringify(response, null, 2),
  };
}

/**
 * Dependencies required by the trigger_incremental_update handler
 */
export interface TriggerUpdateDependencies {
  repositoryService: RepositoryMetadataService;
  updateCoordinator: IncrementalUpdateCoordinator;
  rateLimiter: MCPRateLimiter;
  jobTracker: JobTracker;
}

/**
 * Execute update with timeout
 */
async function executeWithTimeout(
  coordinator: IncrementalUpdateCoordinator,
  repositoryName: string,
  timeoutMs: number
): Promise<CoordinatorResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Create a race between the update and a timeout rejection
    const result = await Promise.race([
      coordinator.updateRepository(repositoryName),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener("abort", () => {
          reject(new Error("Update timed out after 10 minutes"));
        });
      }),
    ]);

    return result;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Creates the trigger_incremental_update tool handler
 *
 * This factory function enables dependency injection of required services,
 * allowing for easier testing and loose coupling between MCP layer and business logic.
 *
 * @param deps - Injected dependencies
 * @returns Tool handler function that triggers incremental updates
 *
 * @example
 * ```typescript
 * const handler = createTriggerUpdateHandler({
 *   repositoryService,
 *   updateCoordinator,
 *   rateLimiter,
 *   jobTracker,
 * });
 * const result = await handler({ repository: "my-repo" });
 * ```
 */
export function createTriggerUpdateHandler(deps: TriggerUpdateDependencies): ToolHandler {
  const { repositoryService, updateCoordinator, rateLimiter, jobTracker } = deps;

  return async (args: unknown): Promise<CallToolResult> => {
    const startTime = performance.now();
    const log = getLogger();

    // Step 1: Validate arguments (outside try/catch for proper error messages)
    let validatedArgs: TriggerUpdateArgs;
    try {
      validatedArgs = validateArgs(args);
    } catch (validationError) {
      const errorMessage =
        validationError instanceof Error ? validationError.message : String(validationError);
      log.warn({ error: errorMessage }, "Argument validation failed");
      return {
        content: [{ type: "text", text: errorMessage }],
        isError: true,
      };
    }

    const { repository: repositoryName, async: isAsync } = validatedArgs;

    try {
      log.info(
        { repository: repositoryName, async: isAsync },
        "trigger_incremental_update invoked"
      );

      // Step 2: Validate repository exists
      const repo = await repositoryService.getRepository(repositoryName);
      if (!repo) {
        log.warn({ repository: repositoryName }, "Repository not found");
        return {
          content: [
            formatErrorResponse(
              "repository_not_found",
              `Repository '${repositoryName}' is not indexed. Use list_indexed_repositories to see available repositories.`
            ),
          ],
          isError: true,
        };
      }

      // Step 3: Check for existing running job first (for async mode deduplication)
      // This should happen before rate limiting so callers can get the job ID
      const existingJob = jobTracker.getRunningJob(repositoryName);
      if (existingJob) {
        log.info(
          { repository: repositoryName, existingJobId: existingJob.id },
          "Existing job found - returning job ID"
        );
        return {
          content: [formatAsyncSuccessResponse(repositoryName, existingJob.id)],
          isError: false,
        };
      }

      // Step 4: Check rate limiting
      const rateLimitCheck = rateLimiter.canTrigger(repositoryName);
      if (!rateLimitCheck.allowed) {
        if (rateLimitCheck.reason === "in_progress") {
          // This shouldn't happen if job tracker is in sync, but handle gracefully
          log.info({ repository: repositoryName }, "Update already in progress (no job found)");
          return {
            content: [
              formatErrorResponse(
                "update_in_progress",
                `Repository '${repositoryName}' is currently being updated. Please wait for the current update to complete.`
              ),
            ],
            isError: true,
          };
        }

        // Rate limited
        const retryAfterSeconds = Math.ceil((rateLimitCheck.retryAfterMs ?? 0) / 1000);
        log.info({ repository: repositoryName, retryAfterSeconds }, "Rate limit exceeded");
        return {
          content: [
            formatErrorResponse(
              "rate_limited",
              `Repository '${repositoryName}' was updated recently. Try again in ${retryAfterSeconds} seconds.`,
              retryAfterSeconds
            ),
          ],
          isError: true,
        };
      }

      // Step 5: Handle async mode
      if (isAsync) {
        // Create job and start update in background
        const jobId = jobTracker.createJob(repositoryName);
        rateLimiter.markInProgress(repositoryName);

        log.info({ repository: repositoryName, jobId }, "Starting async update");

        // Fire-and-forget: execute update in background
        void (async () => {
          jobTracker.updateStatus(jobId, "running");

          try {
            const result = await executeWithTimeout(
              updateCoordinator,
              repositoryName,
              UPDATE_TIMEOUT_MS
            );

            jobTracker.complete(jobId, result);
            log.info(
              { repository: repositoryName, jobId, status: result.status },
              "Async update completed"
            );
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);

            if (errorMessage.includes("timed out")) {
              jobTracker.timeout(jobId);
              log.warn({ repository: repositoryName, jobId }, "Async update timed out");
            } else {
              jobTracker.fail(jobId, errorMessage);
              log.error(
                { repository: repositoryName, jobId, error: errorMessage },
                "Async update failed"
              );
            }
          } finally {
            rateLimiter.markComplete(repositoryName);
          }
        })();

        return {
          content: [formatAsyncSuccessResponse(repositoryName, jobId)],
          isError: false,
        };
      }

      // Step 6: Handle synchronous mode
      rateLimiter.markInProgress(repositoryName);

      try {
        const result = await executeWithTimeout(
          updateCoordinator,
          repositoryName,
          UPDATE_TIMEOUT_MS
        );

        const duration = performance.now() - startTime;
        log.info(
          {
            repository: repositoryName,
            status: result.status,
            duration_ms: Math.round(duration),
          },
          "Synchronous update completed"
        );

        // Check if update failed
        if (result.status === "failed") {
          return {
            content: [
              formatErrorResponse(
                "update_failed",
                `Update completed with ${result.errors.length} error(s). Some files may not have been indexed.`
              ),
            ],
            isError: true,
          };
        }

        return {
          content: [formatSyncSuccessResponse(repositoryName, result)],
          isError: false,
        };
      } finally {
        rateLimiter.markComplete(repositoryName);
      }
    } catch (error) {
      const duration = performance.now() - startTime;
      log.error({ error, duration_ms: Math.round(duration) }, "trigger_incremental_update failed");

      // Check for timeout
      if (error instanceof Error && error.message.includes("timed out")) {
        return {
          content: [
            formatErrorResponse(
              "timeout",
              "Update operation timed out after 10 minutes. Consider using async mode or triggering a full re-index via CLI."
            ),
          ],
          isError: true,
        };
      }

      const mcpError = mapToMCPError(error);

      return {
        content: [formatErrorResponse("internal_error", mcpError.message)],
        isError: true,
      };
    }
  };
}
