/**
 * MCP error mapping utilities
 *
 * This module provides functions to convert SearchService errors into MCP protocol
 * errors while ensuring no sensitive information (stack traces, internal paths,
 * credentials) is leaked to MCP clients.
 */

import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import {
  SearchError,
  SearchValidationError,
  RepositoryNotFoundError,
  RepositoryNotReadyError,
  NoRepositoriesAvailableError,
  SearchOperationError,
} from "../services/errors.js";
import { getComponentLogger } from "../logging/index.js";

/**
 * Lazy-initialized logger to avoid initialization at module load time
 */
let logger: ReturnType<typeof getComponentLogger> | null = null;

function getLogger(): ReturnType<typeof getComponentLogger> {
  if (!logger) {
    logger = getComponentLogger("mcp:errors");
  }
  return logger;
}

/**
 * Maps SearchService errors to MCP protocol errors
 *
 * This function ensures:
 * - Validation errors → InvalidParams
 * - Service/storage errors → InternalError
 * - Unknown errors are sanitized to prevent information leakage
 * - All errors are logged for debugging
 *
 * @param error - Error from SearchService or unknown source
 * @returns MCP-compliant error object
 */
export function mapToMCPError(error: unknown): McpError {
  const log = getLogger();

  // Handle SearchService errors
  if (error instanceof SearchValidationError) {
    log.warn({ error: error.message }, "Validation error in MCP tool");
    return new McpError(ErrorCode.InvalidParams, error.message);
  }

  if (error instanceof RepositoryNotFoundError) {
    log.warn({ repository: error.repositoryName }, "Repository not found");
    return new McpError(
      ErrorCode.InvalidParams,
      `Repository '${error.repositoryName}' not found. Please index it first.`
    );
  }

  if (error instanceof RepositoryNotReadyError) {
    log.warn(
      { repository: error.repositoryName, status: error.currentStatus },
      "Repository not ready for search"
    );
    return new McpError(
      ErrorCode.InvalidParams,
      `Repository '${error.repositoryName}' is not ready (status: ${error.currentStatus}). ${
        error.currentStatus === "indexing" ? "Please wait for indexing to complete." : ""
      }`
    );
  }

  if (error instanceof NoRepositoriesAvailableError) {
    log.warn("No repositories available for search");
    return new McpError(
      ErrorCode.InvalidParams,
      "No repositories available to search. Please index a repository first."
    );
  }

  if (error instanceof SearchOperationError) {
    log.error({ error: error.message, retryable: error.retryable }, "Search operation failed");
    // Don't leak internal error details - return generic message
    return new McpError(ErrorCode.InternalError, "Search operation failed. Please try again.");
  }

  if (error instanceof SearchError) {
    // Catch-all for any other SearchError subclasses
    log.error({ error: error.message }, "Unknown SearchError type");
    return new McpError(ErrorCode.InternalError, "An error occurred during search.");
  }

  // Handle standard Error objects
  if (error instanceof Error) {
    log.error({ error: error.message, stack: error.stack }, "Unexpected error in MCP handler");
    // Sanitize error message - never expose stack traces or internal details
    return new McpError(ErrorCode.InternalError, "An unexpected error occurred.");
  }

  // Handle non-Error thrown values
  log.error({ error: String(error) }, "Non-Error value thrown in MCP handler");
  return new McpError(ErrorCode.InternalError, "An unexpected error occurred.");
}

/**
 * Creates a validation error for invalid MCP tool arguments
 *
 * Use this when MCP-layer validation fails (e.g., Zod schema validation).
 *
 * @param message - Human-readable validation error message
 * @returns MCP InvalidParams error
 */
export function createValidationError(message: string): McpError {
  getLogger().warn({ message }, "MCP validation error");
  return new McpError(ErrorCode.InvalidParams, message);
}

/**
 * Creates an error for unknown/unsupported tools
 *
 * @param toolName - Name of the tool that was requested
 * @returns MCP MethodNotFound error
 */
export function createMethodNotFoundError(toolName: string): McpError {
  getLogger().warn({ toolName }, "Unknown tool requested");
  return new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${toolName}`);
}
