/**
 * HTTP Transport Module
 *
 * Provides HTTP transports for MCP clients like Cursor, VS Code, etc.
 * Supports both SSE (legacy) and Streamable HTTP (modern) transports.
 * Enables network-accessible MCP endpoints while maintaining stdio for Claude Code.
 */

// Server setup
export {
  createHttpApp,
  startHttpServer,
  loadHttpConfig,
  type HttpServerDependencies,
} from "./server.js";

// Types
export type {
  HealthResponse,
  ExpressMiddleware,
  ExpressErrorMiddleware,
  HttpServerInstance,
  SseConnectionState,
} from "./types.js";

// Routes - SSE Transport (legacy)
export {
  createHealthRouter,
  createSseRouter,
  getActiveSessionCount,
  getMaxSessions,
  closeAllSessions,
  startSessionCleanup,
  stopSessionCleanup,
  type HealthCheckDependencies,
  type SseRouteDependencies,
} from "./routes/index.js";

// Routes - Streamable HTTP Transport (modern)
export {
  createStreamableHttpRouter,
  getActiveStreamableSessionCount,
  getMaxStreamableSessions,
  closeAllStreamableSessions,
  startStreamableSessionCleanup,
  stopStreamableSessionCleanup,
  type StreamableHttpRouteDependencies,
} from "./routes/index.js";

// Middleware
export {
  requestLogging,
  errorHandler,
  notFoundHandler,
  HttpError,
  badRequest,
  notFound,
  unauthorized,
  forbidden,
  internalError,
} from "./middleware/index.js";
