/**
 * Streamable HTTP Transport Route
 *
 * Implements MCP Streamable HTTP transport (2025-03-26 specification).
 * Single endpoint handling POST (messages), GET (SSE stream), DELETE (session termination).
 *
 * This is the modern transport recommended for clients like Cursor and VS Code.
 * The existing SSE transport is maintained for backward compatibility.
 */

import { Router } from "express";
import type { Request, Response } from "express";
import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { randomUUID } from "crypto";
import { getComponentLogger } from "../../logging/index.js";

/**
 * Lazy-initialized logger to avoid initialization at module load time
 */
let logger: ReturnType<typeof getComponentLogger> | null = null;

function getLogger(): ReturnType<typeof getComponentLogger> {
  if (!logger) {
    logger = getComponentLogger("http:streamable");
  }
  return logger;
}

/**
 * Maximum concurrent Streamable HTTP sessions (prevent resource exhaustion)
 * Configurable via HTTP_MAX_STREAMABLE_SESSIONS environment variable
 */
const MAX_SESSIONS = parseInt(Bun.env["HTTP_MAX_STREAMABLE_SESSIONS"] || "100", 10);

/**
 * Session TTL in milliseconds (default 30 minutes)
 * Sessions with no activity beyond this time are considered stale
 */
const SESSION_TTL_MS = parseInt(
  Bun.env["HTTP_STREAMABLE_SESSION_TTL_MS"] || String(30 * 60 * 1000),
  10
);

/**
 * Stale session cleanup interval in milliseconds (default 5 minutes)
 */
const CLEANUP_INTERVAL_MS = parseInt(
  Bun.env["HTTP_STREAMABLE_CLEANUP_INTERVAL_MS"] || String(5 * 60 * 1000),
  10
);

/**
 * Session metadata for tracking and cleanup
 */
interface StreamableSessionEntry {
  transport: StreamableHTTPServerTransport;
  server: Server;
  createdAt: number;
  lastActivity: number;
}

/**
 * Active Streamable HTTP transport sessions
 * Maps session ID to session entry with metadata
 */
const sessions: Map<string, StreamableSessionEntry> = new Map();

/**
 * Cleanup interval timer reference
 */
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Check if server can accept a new Streamable HTTP session
 */
function canAcceptNewSession(): boolean {
  return sessions.size < MAX_SESSIONS;
}

/**
 * Clean up stale sessions that have exceeded TTL
 * Sessions are considered stale if no activity for SESSION_TTL_MS
 */
async function cleanupStaleSessions(): Promise<number> {
  const now = Date.now();
  const staleSessionIds: string[] = [];

  for (const [sessionId, entry] of sessions) {
    const idleTime = now - entry.lastActivity;
    if (idleTime > SESSION_TTL_MS) {
      staleSessionIds.push(sessionId);
    }
  }

  if (staleSessionIds.length === 0) {
    return 0;
  }

  getLogger().info(
    { staleCount: staleSessionIds.length, activeSessions: sessions.size },
    "Cleaning up stale Streamable HTTP sessions"
  );

  const closePromises: Promise<void>[] = [];

  for (const sessionId of staleSessionIds) {
    const entry = sessions.get(sessionId);
    if (entry) {
      getLogger().debug(
        { sessionId, idleMs: now - entry.lastActivity },
        "Closing stale Streamable HTTP session"
      );
      closePromises.push(
        entry.transport.close().catch((error: unknown) => {
          getLogger().warn({ sessionId, error }, "Error closing stale Streamable HTTP session");
        })
      );
      sessions.delete(sessionId);
    }
  }

  await Promise.all(closePromises);

  getLogger().info(
    { closedCount: staleSessionIds.length, remainingSessions: sessions.size },
    "Stale Streamable HTTP session cleanup complete"
  );

  return staleSessionIds.length;
}

/**
 * Start the periodic stale session cleanup timer
 */
export function startStreamableSessionCleanup(): void {
  if (cleanupTimer) {
    return; // Already running
  }

  getLogger().info(
    { intervalMs: CLEANUP_INTERVAL_MS, ttlMs: SESSION_TTL_MS },
    "Starting Streamable HTTP session cleanup timer"
  );

  cleanupTimer = setInterval(() => {
    cleanupStaleSessions().catch((error: unknown) => {
      getLogger().error({ error }, "Error during stale Streamable HTTP session cleanup");
    });
  }, CLEANUP_INTERVAL_MS);
}

/**
 * Stop the periodic stale session cleanup timer
 */
export function stopStreamableSessionCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
    getLogger().info("Stopped Streamable HTTP session cleanup timer");
  }
}

/**
 * Streamable HTTP route dependencies
 */
export interface StreamableHttpRouteDependencies {
  /**
   * Create MCP server instance for a new Streamable HTTP session
   * Each session gets its own server instance connected to the transport
   */
  createServerForStreamableHttp: () => Server;
}

/**
 * Create Streamable HTTP transport router
 *
 * Implements the MCP Streamable HTTP transport protocol (2025-03-26 spec):
 * - POST /mcp: Send JSON-RPC messages (initialization, tool calls, etc.)
 * - GET /mcp: Establish SSE stream for server-to-client notifications
 * - DELETE /mcp: Terminate session
 *
 * All requests after initialization must include Mcp-Session-Id header.
 *
 * @param deps - Dependencies for Streamable HTTP handling
 * @returns Express router with Streamable HTTP endpoint
 */
export function createStreamableHttpRouter(deps: StreamableHttpRouteDependencies): Router {
  const router = Router();

  /**
   * Handle all HTTP methods at /mcp endpoint
   * The StreamableHTTPServerTransport handles method routing internally
   */
  router.all("/mcp", async (req: Request, res: Response): Promise<void> => {
    const requestId = req.headers["x-request-id"] as string | undefined;
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    getLogger().debug(
      { requestId, sessionId, method: req.method },
      "Streamable HTTP request received"
    );

    // For existing sessions, route to the appropriate transport
    if (sessionId) {
      const sessionEntry = sessions.get(sessionId);

      if (!sessionEntry) {
        getLogger().warn({ requestId, sessionId }, "Request for unknown session");
        res.status(404).json({
          jsonrpc: "2.0",
          error: {
            code: -32001,
            message: "Session not found",
          },
          id: null,
        });
        return;
      }

      // Update last activity timestamp
      sessionEntry.lastActivity = Date.now();

      try {
        // Delegate to the transport's request handler
        await sessionEntry.transport.handleRequest(
          req as unknown as IncomingMessage,
          res as unknown as ServerResponse,
          req.body
        );
      } catch (error) {
        getLogger().error(
          { requestId, sessionId, error },
          "Error handling Streamable HTTP request"
        );
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: "2.0",
            error: {
              code: -32603,
              message: "Internal error",
            },
            id: null,
          });
        }
      }
      return;
    }

    // No session ID - this must be an initialization request (POST only)
    if (req.method !== "POST") {
      getLogger().warn({ requestId, method: req.method }, "Non-POST request without session ID");
      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Bad Request: Mcp-Session-Id header is required for non-initialization requests",
        },
        id: null,
      });
      return;
    }

    // Check session limit before accepting new connections
    if (!canAcceptNewSession()) {
      getLogger().warn(
        { requestId, activeSessions: sessions.size, maxSessions: MAX_SESSIONS },
        "Streamable HTTP session limit reached, rejecting connection"
      );
      res.status(503).json({
        error: {
          message: "Server at capacity, try again later",
          code: "TOO_MANY_SESSIONS",
        },
      });
      return;
    }

    // Create new transport for initialization
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: async (newSessionId: string) => {
          // Create MCP server and connect to transport
          const server = deps.createServerForStreamableHttp();

          // Store session with metadata
          const now = Date.now();
          sessions.set(newSessionId, {
            transport,
            server,
            createdAt: now,
            lastActivity: now,
          });

          await server.connect(transport);

          getLogger().info(
            { requestId, sessionId: newSessionId, activeSessions: sessions.size },
            "Streamable HTTP session initialized"
          );
        },
        onsessionclosed: (closedSessionId: string) => {
          const entry = sessions.get(closedSessionId);
          if (entry) {
            sessions.delete(closedSessionId);
            getLogger().info(
              { sessionId: closedSessionId, activeSessions: sessions.size },
              "Streamable HTTP session closed"
            );
          }
        },
        enableJsonResponse: false, // Prefer SSE for streaming responses
        retryInterval: 5000, // 5 second retry hint for SSE reconnection
      });

      // Set up error handler
      transport.onerror = (error: Error): void => {
        getLogger().error({ error }, "Streamable HTTP transport error");
      };

      transport.onclose = (): void => {
        // Transport closed - session cleanup handled by onsessionclosed callback
        getLogger().debug("Streamable HTTP transport closed");
      };

      // Start the transport
      await transport.start();

      // Handle the initialization request
      await transport.handleRequest(
        req as unknown as IncomingMessage,
        res as unknown as ServerResponse,
        req.body
      );
    } catch (error) {
      getLogger().error({ requestId, error }, "Failed to initialize Streamable HTTP session");

      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Failed to initialize session",
          },
          id: null,
        });
      }
    }
  });

  return router;
}

/**
 * Get count of active Streamable HTTP sessions
 */
export function getActiveStreamableSessionCount(): number {
  return sessions.size;
}

/**
 * Get the maximum allowed Streamable HTTP sessions
 */
export function getMaxStreamableSessions(): number {
  return MAX_SESSIONS;
}

/**
 * Close all active Streamable HTTP sessions
 * Used during graceful shutdown
 */
export async function closeAllStreamableSessions(): Promise<void> {
  // Stop the cleanup timer first
  stopStreamableSessionCleanup();

  getLogger().info({ count: sessions.size }, "Closing all Streamable HTTP sessions");

  const closePromises: Promise<void>[] = [];

  for (const [sessionId, sessionEntry] of sessions) {
    getLogger().debug({ sessionId }, "Closing Streamable HTTP session");
    closePromises.push(
      sessionEntry.transport.close().catch((error: unknown) => {
        getLogger().warn({ sessionId, error }, "Error closing Streamable HTTP session");
      })
    );
  }

  await Promise.all(closePromises);
  sessions.clear();

  getLogger().info("All Streamable HTTP sessions closed");
}
