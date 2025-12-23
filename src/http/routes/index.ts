/**
 * HTTP Routes Exports
 *
 * Re-exports all route handlers for the HTTP transport layer.
 */

export { createHealthRouter, type HealthCheckDependencies } from "./health.js";
export {
  createSseRouter,
  getActiveSessionCount,
  closeAllSessions,
  type SseRouteDependencies,
} from "./sse.js";
