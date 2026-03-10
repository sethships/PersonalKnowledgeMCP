/**
 * MCP Debug Logger - Shared utility for tool handler debug logging.
 *
 * Provides file-based debug logging for MCP tool handlers when
 * `MCP_DEBUG=true` is set. Writes to `logs/mcp-debug.log` in the
 * project root directory.
 *
 * This is essential for diagnosing issues in stdio transport mode
 * where stderr output is not visible to the user.
 *
 * @module mcp/debug-logger
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/** Whether debug logging is enabled */
const DEBUG_ENABLED = process.env["MCP_DEBUG"] === "true";

/** Path to the debug log file */
const DEBUG_LOG_PATH = join(process.cwd(), "logs", "mcp-debug.log");

// Ensure logs directory exists on module load
if (DEBUG_ENABLED) {
  try {
    mkdirSync(join(process.cwd(), "logs"), { recursive: true });
  } catch {
    // Silently fail
  }
}

/**
 * Write a debug message to the MCP debug log file.
 *
 * No-op when `MCP_DEBUG` is not set to `"true"`.
 *
 * @param message - Message to write
 */
export function debugLog(message: string): void {
  if (!DEBUG_ENABLED) return;
  try {
    appendFileSync(DEBUG_LOG_PATH, `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    // Silently fail - debug logging should never break the server
  }
}

/**
 * Log a caught error from a tool handler with full details.
 *
 * Captures error type, message, stack trace, and cause chain.
 * Designed to be called from tool handler catch blocks to preserve
 * the raw error information before `mapToMCPError()` sanitizes it.
 *
 * @param toolName - Name of the tool that caught the error
 * @param error - The caught error
 */
export function toolDebugLog(toolName: string, error: unknown): void {
  if (!DEBUG_ENABLED) return;

  const errType = (error as { constructor?: { name?: string } })?.constructor?.name ?? typeof error;
  const errMsg = error instanceof Error ? error.message : String(error);
  const errStack = error instanceof Error ? error.stack : "N/A";
  const errCause =
    error instanceof Error && error.cause
      ? `\n  cause: ${error.cause instanceof Error ? error.cause.message : String(error.cause)}`
      : "";

  debugLog(
    `TOOL_HANDLER_ERROR: ${toolName}\n` +
      `  type: ${errType}\n` +
      `  message: ${errMsg}\n` +
      `  stack: ${errStack}${errCause}`
  );
}
