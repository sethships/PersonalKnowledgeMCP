/**
 * HTTP Request Utility Functions
 *
 * Shared utilities for extracting information from Express requests.
 *
 * @module http/request-utils
 */

import type { Request } from "express";

/**
 * Extract source IP from request, supporting reverse proxy environments
 *
 * Handles X-Forwarded-For header parsing for requests behind proxies
 * (Docker, nginx, load balancers, etc.).
 *
 * @param req - Express request
 * @returns Client IP address or undefined if not available
 *
 * @example
 * ```typescript
 * import { extractSourceIp } from './request-utils.js';
 *
 * const clientIp = extractSourceIp(req);
 * console.log(`Request from: ${clientIp}`);
 * ```
 */
export function extractSourceIp(req: Request): string | undefined {
  // Trust X-Forwarded-For for reverse proxy environments (Docker, nginx)
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    // X-Forwarded-For can be comma-separated list; take first (client) IP
    const firstIp = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(",")[0]?.trim();
    return firstIp;
  }
  // Fall back to direct IP
  return req.ip;
}
