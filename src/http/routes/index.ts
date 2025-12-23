/**
 * HTTP Routes Exports
 *
 * Re-exports all route handlers for the HTTP transport layer.
 */

export { createHealthRouter, type HealthCheckDependencies } from "./health.js";
export {
  createSseRouter,
  getActiveSessionCount,
  getMaxSessions,
  closeAllSessions,
  startSessionCleanup,
  stopSessionCleanup,
  type SseRouteDependencies,
} from "./sse.js";
