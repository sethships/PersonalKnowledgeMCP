/**
 * SSE Transport Route
 *
 * Implements Server-Sent Events (SSE) transport for MCP clients.
 * Provides GET /api/v1/sse for SSE stream and POST for message handling.
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { getComponentLogger } from "../../logging/index.js";

/**
 * Lazy-initialized logger to avoid initialization at module load time
 */
let logger: ReturnType<typeof getComponentLogger> | null = null;

function getLogger(): ReturnType<typeof getComponentLogger> {
  if (!logger) {
    logger = getComponentLogger("http:sse");
  }
  return logger;
}

/**
 * Maximum concurrent SSE sessions (prevent resource exhaustion)
 * Configurable via HTTP_MAX_SSE_SESSIONS environment variable
 */
const MAX_SESSIONS = parseInt(Bun.env["HTTP_MAX_SSE_SESSIONS"] || "100", 10);

/**
 * Session TTL in milliseconds (default 30 minutes)
 * Sessions with no activity beyond this time are considered stale
 */
const SESSION_TTL_MS = parseInt(Bun.env["HTTP_SSE_SESSION_TTL_MS"] || String(30 * 60 * 1000), 10);

/**
 * Stale session cleanup interval in milliseconds (default 5 minutes)
 */
const CLEANUP_INTERVAL_MS = parseInt(
  Bun.env["HTTP_SSE_CLEANUP_INTERVAL_MS"] || String(5 * 60 * 1000),
  10
);

/**
 * Session metadata for tracking and cleanup
 */
interface SessionEntry {
  transport: SSEServerTransport;
  createdAt: number;
  lastActivity: number;
}

/**
 * Active SSE transport sessions
 * Maps session ID to session entry with metadata
 */
const sessions: Map<string, SessionEntry> = new Map();

/**
 * Cleanup interval timer reference
 */
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Check if server can accept a new SSE session
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
    "Cleaning up stale SSE sessions"
  );

  const closePromises: Promise<void>[] = [];

  for (const sessionId of staleSessionIds) {
    const entry = sessions.get(sessionId);
    if (entry) {
      getLogger().debug(
        { sessionId, idleMs: now - entry.lastActivity },
        "Closing stale SSE session"
      );
      closePromises.push(
        entry.transport.close().catch((error: unknown) => {
          getLogger().warn({ sessionId, error }, "Error closing stale SSE session");
        })
      );
      sessions.delete(sessionId);
    }
  }

  await Promise.all(closePromises);

  getLogger().info(
    { closedCount: staleSessionIds.length, remainingSessions: sessions.size },
    "Stale session cleanup complete"
  );

  return staleSessionIds.length;
}

/**
 * Start the periodic stale session cleanup timer
 */
export function startSessionCleanup(): void {
  if (cleanupTimer) {
    return; // Already running
  }

  getLogger().info(
    { intervalMs: CLEANUP_INTERVAL_MS, ttlMs: SESSION_TTL_MS },
    "Starting SSE session cleanup timer"
  );

  cleanupTimer = setInterval(() => {
    cleanupStaleSessions().catch((error: unknown) => {
      getLogger().error({ error }, "Error during stale session cleanup");
    });
  }, CLEANUP_INTERVAL_MS);
}

/**
 * Stop the periodic stale session cleanup timer
 */
export function stopSessionCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
    getLogger().info("Stopped SSE session cleanup timer");
  }
}

/**
 * SSE route dependencies
 */
export interface SseRouteDependencies {
  /**
   * Create MCP server instance for a new SSE session
   * Each SSE session gets its own server instance connected to the transport
   */
  createServerForSse: () => Server;
}

/**
 * Create SSE transport router
 *
 * Implements the MCP SSE transport protocol:
 * - GET /sse: Establish SSE connection, returns session ID via header
 * - POST /sse: Send messages to server for existing session
 *
 * @param deps - Dependencies for SSE handling
 * @returns Express router with SSE endpoints
 */
export function createSseRouter(deps: SseRouteDependencies): Router {
  const router = Router();

  /**
   * GET /sse
   *
   * Establishes SSE connection for MCP protocol.
   * Returns session ID in 'mcp-session-id' response header.
   * Clients should include this header in subsequent POST requests.
   */
  router.get("/sse", async (req: Request, res: Response): Promise<void> => {
    const requestId = req.headers["x-request-id"] as string | undefined;

    getLogger().info({ requestId }, "New SSE connection request");

    // Check session limit before accepting new connections
    if (!canAcceptNewSession()) {
      getLogger().warn(
        { requestId, activeSessions: sessions.size, maxSessions: MAX_SESSIONS },
        "SSE session limit reached, rejecting connection"
      );
      res.status(503).json({
        error: {
          message: "Server at capacity, try again later",
          code: "TOO_MANY_SESSIONS",
        },
      });
      return;
    }

    try {
      // Create SSE transport
      // The endpoint path tells the client where to POST messages
      const transport = new SSEServerTransport("/api/v1/sse", res);

      // Store session with metadata for tracking and cleanup
      const sessionId = transport.sessionId;
      const now = Date.now();
      sessions.set(sessionId, {
        transport,
        createdAt: now,
        lastActivity: now,
      });

      getLogger().info(
        { requestId, sessionId, activeSessions: sessions.size },
        "SSE session created"
      );

      // Clean up on connection close
      transport.onclose = (): void => {
        sessions.delete(sessionId);
        getLogger().info({ sessionId, activeSessions: sessions.size }, "SSE session closed");
      };

      transport.onerror = (error: Error): void => {
        getLogger().error({ sessionId, error }, "SSE transport error");
        // Also clean up session on error to prevent orphaned sessions
        sessions.delete(sessionId);
      };

      // Create and connect MCP server for this session
      const mcpServer = deps.createServerForSse();
      await mcpServer.connect(transport);

      getLogger().debug({ sessionId }, "MCP server connected to SSE transport");

      // Start the SSE stream (sets headers and begins event streaming)
      await transport.start();
    } catch (error) {
      getLogger().error({ requestId, error }, "Failed to establish SSE connection");

      // If headers haven't been sent, send error response
      if (!res.headersSent) {
        res.status(500).json({
          error: {
            message: "Failed to establish SSE connection",
            code: "SSE_CONNECTION_FAILED",
          },
        });
      }
    }
  });

  /**
   * POST /sse
   *
   * Receives messages from MCP clients for existing sessions.
   * Requires 'mcp-session-id' header to identify the session.
   */
  router.post("/sse", async (req: Request, res: Response): Promise<void> => {
    const requestId = req.headers["x-request-id"] as string | undefined;
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (!sessionId) {
      getLogger().warn({ requestId }, "POST without session ID");
      // Use direct response instead of throw for async handler compatibility
      res.status(400).json({
        error: {
          message: "Missing mcp-session-id header",
          code: "MISSING_SESSION_ID",
          statusCode: 400,
        },
      });
      return;
    }

    const sessionEntry = sessions.get(sessionId);

    if (!sessionEntry) {
      getLogger().warn({ requestId, sessionId }, "POST for unknown session");
      // Use direct response instead of throw for async handler compatibility
      res.status(400).json({
        error: {
          message: "Invalid or expired session",
          code: "INVALID_SESSION",
          statusCode: 400,
        },
      });
      return;
    }

    // Update last activity timestamp
    sessionEntry.lastActivity = Date.now();

    getLogger().debug({ requestId, sessionId, bodyType: typeof req.body }, "Handling POST message");

    try {
      // Handle the incoming message
      // The transport expects the parsed JSON body
      await sessionEntry.transport.handlePostMessage(req, res, req.body);

      getLogger().debug({ requestId, sessionId }, "POST message handled");
    } catch (error) {
      getLogger().error({ requestId, sessionId, error }, "Failed to handle POST message");
      // Handle error directly instead of re-throwing
      if (!res.headersSent) {
        res.status(500).json({
          error: {
            message: "Failed to handle message",
            code: "MESSAGE_HANDLING_FAILED",
            statusCode: 500,
          },
        });
      }
    }
  });

  return router;
}

/**
 * Get count of active SSE sessions
 */
export function getActiveSessionCount(): number {
  return sessions.size;
}

/**
 * Close all active SSE sessions
 * Used during graceful shutdown
 */
export async function closeAllSessions(): Promise<void> {
  // Stop the cleanup timer first
  stopSessionCleanup();

  getLogger().info({ count: sessions.size }, "Closing all SSE sessions");

  const closePromises: Promise<void>[] = [];

  for (const [sessionId, sessionEntry] of sessions) {
    getLogger().debug({ sessionId }, "Closing SSE session");
    closePromises.push(
      sessionEntry.transport.close().catch((error: unknown) => {
        getLogger().warn({ sessionId, error }, "Error closing SSE session");
      })
    );
  }

  await Promise.all(closePromises);
  sessions.clear();

  getLogger().info("All SSE sessions closed");
}

/**
 * Get the maximum allowed SSE sessions
 */
export function getMaxSessions(): number {
  return MAX_SESSIONS;
}
