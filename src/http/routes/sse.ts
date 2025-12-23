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
import { badRequest } from "../middleware/error-handler.js";

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
 * Active SSE transport sessions
 * Maps session ID to transport instance
 */
const sessions: Map<string, SSEServerTransport> = new Map();

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

    try {
      // Create SSE transport
      // The endpoint path tells the client where to POST messages
      const transport = new SSEServerTransport("/api/v1/sse", res);

      // Store session for POST request routing
      const sessionId = transport.sessionId;
      sessions.set(sessionId, transport);

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
      throw badRequest("Missing mcp-session-id header", "MISSING_SESSION_ID");
    }

    const transport = sessions.get(sessionId);

    if (!transport) {
      getLogger().warn({ requestId, sessionId }, "POST for unknown session");
      throw badRequest("Invalid or expired session", "INVALID_SESSION");
    }

    getLogger().debug({ requestId, sessionId, bodyType: typeof req.body }, "Handling POST message");

    try {
      // Handle the incoming message
      // The transport expects the parsed JSON body
      await transport.handlePostMessage(req, res, req.body);

      getLogger().debug({ requestId, sessionId }, "POST message handled");
    } catch (error) {
      getLogger().error({ requestId, sessionId, error }, "Failed to handle POST message");
      throw error;
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
  getLogger().info({ count: sessions.size }, "Closing all SSE sessions");

  const closePromises: Promise<void>[] = [];

  for (const [sessionId, transport] of sessions) {
    getLogger().debug({ sessionId }, "Closing SSE session");
    closePromises.push(
      transport.close().catch((error: unknown) => {
        getLogger().warn({ sessionId, error }, "Error closing SSE session");
      })
    );
  }

  await Promise.all(closePromises);
  sessions.clear();

  getLogger().info("All SSE sessions closed");
}
