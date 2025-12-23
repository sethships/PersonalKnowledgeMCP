/**
 * HTTP Transport Module
 *
 * Provides HTTP/SSE transport for MCP clients like Cursor, VS Code, etc.
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

// Routes
export {
  createHealthRouter,
  createSseRouter,
  getActiveSessionCount,
  closeAllSessions,
  type HealthCheckDependencies,
  type SseRouteDependencies,
} from "./routes/index.js";

// Middleware
export {
  requestLogging,
  errorHandler,
  notFoundHandler,
  HttpError,
  badRequest,
  notFound,
  internalError,
} from "./middleware/index.js";
