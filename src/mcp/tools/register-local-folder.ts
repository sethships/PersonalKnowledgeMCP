/**
 * register_local_folder MCP Tool Implementation (Phase C / issue #566 / T4.3-T4.4)
 *
 * Registers an absolute or relative filesystem path as a `local-folder`
 * repository: scans, embeds, persists `RepositoryInfo` with `source =
 * "local-folder"`, and (when `watch === true`) starts the chokidar watcher.
 *
 * Sync mode (`async: false`, default): runs registration to completion and
 * returns the resulting repository name + status. Suitable for small folders.
 *
 * Async mode (`async: true`): returns immediately with a job ID created via
 * the shared `JobTracker` so the caller can poll `get_update_status`. The
 * background worker maps the `IndexResult` to a synthetic `CoordinatorResult`
 * compatible with the existing JobTracker job-completion machinery.
 *
 * @module mcp/tools/register-local-folder
 */

import { basename, normalize, resolve } from "node:path";
import type { Tool, CallToolResult, TextContent } from "@modelcontextprotocol/sdk/types.js";
import type { IngestionService } from "../../services/ingestion-service.js";
import type { LocalFolderUpdateCoordinator } from "../../services/local-folder-update-coordinator.js";
import type { RepositoryMetadataService } from "../../repositories/types.js";
import type { CoordinatorResult } from "../../services/incremental-update-coordinator-types.js";
import type { IndexResult } from "../../services/ingestion-types.js";
import { mapToMCPError } from "../errors.js";
import { getComponentLogger } from "../../logging/index.js";
import type { ToolHandler } from "../types.js";
import type { JobTracker } from "../job-tracker.js";

let logger: ReturnType<typeof getComponentLogger> | null = null;
function getLogger(): ReturnType<typeof getComponentLogger> {
  if (!logger) logger = getComponentLogger("mcp:register-local-folder");
  return logger;
}

type RegisterErrorCode =
  | "invalid_argument"
  | "registration_failed"
  | "internal_error"
  | "service_unavailable";

interface RegisterArgs {
  path: string;
  name?: string;
  tier?: "private" | "work" | "public";
  force?: boolean;
  watch?: boolean;
  followSymlinks?: boolean;
  async?: boolean;
}

interface SyncSuccessResponse {
  success: true;
  repository: string;
  status: "registered" | "partial" | "failed";
  files_processed: number;
  chunks_created: number;
  duration_ms: number;
  watch_enabled: boolean;
  follow_symlinks: boolean;
}

interface AsyncSuccessResponse {
  success: true;
  async: true;
  job_id: string;
  repository: string;
  message: string;
}

interface ErrorResponse {
  success: false;
  error: RegisterErrorCode;
  message: string;
}

export const registerLocalFolderToolDefinition: Tool = {
  name: "register_local_folder",
  description:
    "Registers a local filesystem folder as a `local-folder` repository in the knowledge base. " +
    "Scans the folder, generates embeddings, and (by default) starts a filesystem watcher " +
    "that re-indexes the folder when its files change. The path may be absolute or relative; " +
    "for `local-folder` sources `tier='public'` is refused. Use `async: true` to return a job " +
    "ID immediately and poll `get_update_status` for completion.",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Absolute or relative path to the folder to register.",
        minLength: 1,
      },
      name: {
        type: "string",
        description:
          "Optional repository name. Defaults to the basename of the resolved path.",
      },
      tier: {
        type: "string",
        enum: ["private", "work"],
        description:
          "Security tier. Defaults to 'private'. 'public' is refused for local folders.",
      },
      force: {
        type: "boolean",
        description:
          "Force re-registration even if a repo with this name (or absolute path) is already registered.",
        default: false,
      },
      watch: {
        type: "boolean",
        description:
          "Start the filesystem watcher after the initial scan. Defaults to true.",
        default: true,
      },
      followSymlinks: {
        type: "boolean",
        description:
          "Follow filesystem symlinks inside the folder (out-of-folder targets are still rejected).",
        default: false,
      },
      async: {
        type: "boolean",
        description:
          "If true, return a job ID immediately and run registration in the background. " +
          "Use get_update_status with the job_id to poll for completion. Defaults to false.",
        default: false,
      },
    },
    required: ["path"],
  },
};

function validateArgs(args: unknown): RegisterArgs {
  if (typeof args !== "object" || args === null) {
    throw new Error("Arguments must be an object");
  }
  const obj = args as Record<string, unknown>;
  const path = obj["path"];
  if (typeof path !== "string" || path.trim() === "") {
    throw new Error("path must be a non-empty string");
  }
  const tier = obj["tier"];
  if (
    tier !== undefined &&
    tier !== "private" &&
    tier !== "work" &&
    tier !== "public" // accept then refuse downstream so error matches IngestionService
  ) {
    throw new Error("tier must be one of 'private', 'work'");
  }
  return {
    path: path.trim(),
    name: typeof obj["name"] === "string" ? obj["name"].trim() : undefined,
    tier: tier as RegisterArgs["tier"],
    force: typeof obj["force"] === "boolean" ? obj["force"] : false,
    watch: typeof obj["watch"] === "boolean" ? obj["watch"] : true,
    followSymlinks:
      typeof obj["followSymlinks"] === "boolean" ? obj["followSymlinks"] : false,
    async: typeof obj["async"] === "boolean" ? obj["async"] : false,
  };
}

function formatErrorResponse(code: RegisterErrorCode, message: string): TextContent {
  const response: ErrorResponse = { success: false, error: code, message };
  return { type: "text", text: JSON.stringify(response, null, 2) };
}

function formatSyncSuccessResponse(
  repository: string,
  result: IndexResult,
  watchEnabled: boolean,
  followSymlinks: boolean
): TextContent {
  // IndexResult.status is "success" | "partial" | "failed"; we surface the same
  // shape but rename "success" → "registered" so the tool's response semantics
  // are unambiguous to downstream callers.
  const statusMap: Record<string, SyncSuccessResponse["status"]> = {
    success: "registered",
    partial: "partial",
    failed: "failed",
  };
  const response: SyncSuccessResponse = {
    success: true,
    repository,
    status: statusMap[result.status] ?? "registered",
    files_processed: result.stats.filesProcessed,
    chunks_created: result.stats.chunksCreated,
    duration_ms: Math.round(result.stats.durationMs),
    watch_enabled: watchEnabled,
    follow_symlinks: followSymlinks,
  };
  return { type: "text", text: JSON.stringify(response, null, 2) };
}

function formatAsyncSuccessResponse(repository: string, jobId: string): TextContent {
  const response: AsyncSuccessResponse = {
    success: true,
    async: true,
    job_id: jobId,
    repository,
    message:
      "Registration started. Use get_update_status with this job_id to poll for completion.",
  };
  return { type: "text", text: JSON.stringify(response, null, 2) };
}

/**
 * Map an `IndexResult` to the `CoordinatorResult` shape the JobTracker expects
 * for `complete()`. Registration doesn't have a meaningful diff (every file is
 * "added"), so we set `filesAdded = filesProcessed` and the rest to zero.
 */
function indexResultToCoordinatorResult(result: IndexResult): CoordinatorResult {
  return {
    status: result.status === "failed" ? "failed" : "updated",
    stats: {
      filesAdded: result.stats.filesProcessed,
      filesModified: 0,
      filesDeleted: 0,
      chunksUpserted: result.stats.chunksCreated,
      chunksDeleted: 0,
      durationMs: result.stats.durationMs,
    },
    errors: result.errors.map((e) => ({
      path: "",
      error: e.message ?? String(e),
    })),
    durationMs: result.stats.durationMs,
    commitSha: `local-${new Date().toISOString()}`,
    commitMessage: `Initial registration of local folder`,
  };
}

export interface RegisterLocalFolderDependencies {
  ingestionService: IngestionService;
  /**
   * Optional. When provided, registrations with `watch: true` will start the
   * filesystem watcher after the initial scan completes. When absent, the
   * `watch` flag is honored in metadata but no live watcher is attached
   * (acceptable for environments that disable watchers, e.g. CI smoke tests).
   */
  localFolderCoordinator?: LocalFolderUpdateCoordinator;
  repositoryService: RepositoryMetadataService;
  /**
   * Optional. Required for `async: true`; when absent, async requests fall
   * back to sync so we never silently lose registration progress.
   */
  jobTracker?: JobTracker;
}

export function createRegisterLocalFolderHandler(
  deps: RegisterLocalFolderDependencies
): ToolHandler {
  const { ingestionService, localFolderCoordinator, repositoryService, jobTracker } = deps;

  return async (args: unknown): Promise<CallToolResult> => {
    const log = getLogger();
    const startTime = performance.now();

    let validated: RegisterArgs;
    try {
      validated = validateArgs(args);
    } catch (validationError) {
      const message =
        validationError instanceof Error ? validationError.message : String(validationError);
      log.warn({ error: message }, "Argument validation failed");
      return {
        content: [formatErrorResponse("invalid_argument", message)],
        isError: true,
      };
    }

    const requestedAsync = validated.async === true && jobTracker !== undefined;

    // Pre-resolve the eventual repository name so async-mode callers can poll
    // `get_update_status` and see the real name on the JobTracker record (review
    // H-2 / H-3). Mirrors `IngestionService.extractRepositoryName` for local
    // paths: explicit `--name` wins; otherwise basename of the resolved path.
    // If the basename is unrecoverable (e.g. ".." / "."), fall back to
    // "pending" — the IngestionService call will throw a descriptive error and
    // the tool surfaces it via formatErrorResponse below.
    const predictedRepositoryName = (() => {
      const explicit = validated.name?.trim();
      if (explicit) return explicit;
      try {
        const candidate = basename(normalize(resolve(validated.path)));
        if (candidate && candidate !== "." && candidate !== "..") return candidate;
      } catch {
        // basename/resolve don't typically throw, but be defensive on bad input
      }
      return "pending";
    })();

    const runRegistration = async (): Promise<{
      repositoryName: string;
      result: IndexResult;
      watcherActuallyAttached: boolean;
    }> => {
      const result = await ingestionService.indexRepository(validated.path, {
        name: validated.name,
        tier: validated.tier,
        force: validated.force,
        watch: validated.watch ?? true,
        followSymlinks: validated.followSymlinks ?? false,
      });
      const repositoryName = result.repository;

      // Start the watcher only when the caller asked for it AND a coordinator
      // is wired AND the registration succeeded enough to leave a usable
      // metadata entry. We re-resolve the RepositoryInfo because the
      // coordinator owns watcher lifecycle (it'll persist watchEnabled).
      // Track ACTUAL attachment so the response can't lie when chokidar
      // fails to attach (review C-1).
      let watcherActuallyAttached = false;
      if ((validated.watch ?? true) && localFolderCoordinator && result.status !== "failed") {
        const repo = await repositoryService.getRepository(repositoryName);
        if (repo && repo.source === "local-folder") {
          try {
            await localFolderCoordinator.startWatching(repo);
            watcherActuallyAttached = true;
          } catch (watchError) {
            log.warn(
              { repository: repositoryName, error: watchError },
              "Failed to start watcher after registration; metadata is persisted, watch must be re-enabled manually"
            );
          }
        }
      }

      return { repositoryName, result, watcherActuallyAttached };
    };

    if (requestedAsync && jobTracker) {
      // Use the predicted name for the job ID so polling via `get_update_status`
      // returns the real registered name even before the worker completes
      // (review H-2 / H-3).
      const jobId = jobTracker.createJob(predictedRepositoryName);

      void (async () => {
        jobTracker.updateStatus(jobId, "running");
        try {
          const { result } = await runRegistration();
          jobTracker.complete(jobId, indexResultToCoordinatorResult(result));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          jobTracker.fail(jobId, message);
          log.error({ error: message, jobId }, "Async registration failed");
        }
      })();

      return {
        content: [formatAsyncSuccessResponse(predictedRepositoryName, jobId)],
        isError: false,
      };
    }

    try {
      const { repositoryName, result, watcherActuallyAttached } = await runRegistration();
      const duration = performance.now() - startTime;
      log.info(
        {
          repository: repositoryName,
          status: result.status,
          duration_ms: Math.round(duration),
        },
        "Synchronous registration completed"
      );

      if (result.status === "failed") {
        const errMessage = result.errors[0]?.message ?? "Registration failed without details";
        return {
          content: [formatErrorResponse("registration_failed", errMessage)],
          isError: true,
        };
      }

      return {
        content: [
          formatSyncSuccessResponse(
            repositoryName,
            result,
            watcherActuallyAttached,
            validated.followSymlinks ?? false
          ),
        ],
        isError: false,
      };
    } catch (error) {
      log.error({ error }, "Synchronous registration threw");
      const mcpError = mapToMCPError(error);
      return {
        content: [formatErrorResponse("internal_error", mcpError.message)],
        isError: true,
      };
    }
  };
}
