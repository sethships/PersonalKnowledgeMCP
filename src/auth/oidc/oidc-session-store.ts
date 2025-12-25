/**
 * OIDC Session Store Implementation
 *
 * Provides a singleton file-based storage implementation for OIDC sessions.
 * Uses atomic writes to prevent data corruption and in-memory caching for
 * fast session lookups.
 *
 * @module auth/oidc/session-store
 */

import { join } from "path";
import { randomUUID } from "crypto";
import type { Logger } from "pino";
import type { OidcSession, OidcSessionStore, OidcSessionStoreFile } from "./oidc-types.js";
import { OidcSessionStorageError, OidcSessionVersionConflictError } from "./oidc-errors.js";
import { OidcSessionStoreFileSchema } from "./oidc-validation.js";
import { getComponentLogger } from "../../logging/index.js";

/**
 * Singleton implementation of OIDC session storage
 *
 * Manages session persistence in a JSON file with atomic writes for data safety.
 * Implements the OidcSessionStore interface with a singleton pattern.
 *
 * **File Location:** `{DATA_PATH}/oidc-sessions.json`
 *
 * **Features:**
 * - Singleton pattern for global access
 * - In-memory cache for fast session lookups
 * - Atomic writes using temp file + rename pattern
 * - Automatic file creation if missing
 * - Session expiry checking on read
 * - Automatic expired session cleanup
 *
 * @example
 * ```typescript
 * // Get singleton instance
 * const store = OidcSessionStoreImpl.getInstance();
 *
 * // Create a new session
 * const session = await store.createSession();
 *
 * // Get session by ID
 * const session = await store.getSession(sessionId);
 *
 * // Update session (e.g., after auth callback)
 * await store.updateSession(session);
 * ```
 */
export class OidcSessionStoreImpl implements OidcSessionStore {
  /**
   * Singleton instance
   */
  private static instance: OidcSessionStoreImpl | null = null;

  /**
   * Absolute path to the sessions JSON file
   */
  private readonly filePath: string;

  /**
   * Lazy-initialized logger
   */
  private _logger: Logger | null = null;

  /**
   * In-memory cache for fast session lookups
   */
  private sessionCache: Map<string, OidcSession> | null = null;

  /**
   * Default session TTL in seconds (used when creating new sessions)
   */
  private readonly defaultSessionTtl: number;

  /**
   * Automatic cleanup interval handle
   */
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Private constructor enforces singleton pattern
   *
   * @param dataPath - Base directory for data storage
   * @param sessionTtlSeconds - Default session TTL in seconds
   */
  private constructor(dataPath: string, sessionTtlSeconds: number) {
    this.filePath = join(dataPath, "oidc-sessions.json");
    this.defaultSessionTtl = sessionTtlSeconds;
  }

  /**
   * Lazy-initialized component logger
   */
  private get logger(): Logger {
    if (!this._logger) {
      this._logger = getComponentLogger("auth:oidc-session-store");
    }
    return this._logger;
  }

  /**
   * Get the singleton instance of the session store
   *
   * **Important**: Once initialized, the `dataPath` and `sessionTtlSeconds` parameters
   * are ignored on subsequent calls. The first call to `getInstance()` determines the
   * configuration for the lifetime of the application. Use `resetInstance()` (testing only)
   * to reinitialize with different parameters.
   *
   * @param dataPath - Optional data directory path (default: process.env.DATA_PATH || "./data")
   * @param sessionTtlSeconds - Default session TTL in seconds (default: 3600)
   * @returns The singleton session store instance
   */
  public static getInstance(
    dataPath?: string,
    sessionTtlSeconds: number = 3600
  ): OidcSessionStoreImpl {
    if (!OidcSessionStoreImpl.instance) {
      const path = dataPath || process.env["DATA_PATH"] || "./data";
      OidcSessionStoreImpl.instance = new OidcSessionStoreImpl(path, sessionTtlSeconds);
    } else if (dataPath !== undefined || sessionTtlSeconds !== 3600) {
      // Warn if caller provided custom params after singleton already exists
      // This helps catch potential misuse during development
      const logger = getComponentLogger("auth:oidc-session-store");
      logger.warn(
        { providedDataPath: dataPath, providedTtl: sessionTtlSeconds },
        "getInstance() called with custom parameters after singleton already initialized - parameters ignored"
      );
    }
    return OidcSessionStoreImpl.instance;
  }

  /**
   * Reset the singleton instance
   *
   * **FOR TESTING ONLY**
   *
   * @internal
   */
  public static resetInstance(): void {
    // Stop auto cleanup before resetting
    if (OidcSessionStoreImpl.instance) {
      OidcSessionStoreImpl.instance.stopAutoCleanup();
    }
    OidcSessionStoreImpl.instance = null;
  }

  /**
   * Get the singleton instance with auto-cleanup enabled
   *
   * Convenience method that returns the singleton and starts automatic
   * session cleanup if not already running.
   *
   * @param dataPath - Optional data directory path
   * @param sessionTtlSeconds - Default session TTL in seconds
   * @param cleanupIntervalMs - Cleanup interval in milliseconds (default: 300000 = 5 minutes)
   * @returns The singleton session store instance with auto-cleanup running
   */
  public static getInstanceWithAutoCleanup(
    dataPath?: string,
    sessionTtlSeconds: number = 3600,
    cleanupIntervalMs: number = 300000
  ): OidcSessionStoreImpl {
    const instance = OidcSessionStoreImpl.getInstance(dataPath, sessionTtlSeconds);
    if (!instance.isAutoCleanupRunning()) {
      instance.startAutoCleanup(cleanupIntervalMs);
    }
    return instance;
  }

  /**
   * Get the storage file path
   */
  getStoragePath(): string {
    return this.filePath;
  }

  /**
   * Invalidate the in-memory cache
   *
   * Forces next read to load from disk.
   */
  invalidateCache(): void {
    this.sessionCache = null;
  }

  /**
   * Create a new empty session for starting an auth flow
   *
   * The session is created with:
   * - A random UUID as session ID
   * - Current timestamp as createdAt
   * - Expiry based on default TTL
   * - Empty scopes and instance access (will be populated after auth)
   *
   * @returns New session with generated ID
   */
  async createSession(): Promise<OidcSession> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.defaultSessionTtl * 1000);

    const session: OidcSession = {
      sessionId: randomUUID(),
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      mappedScopes: [],
      mappedInstanceAccess: [],
      version: 1, // Initial version for optimistic locking
    };

    // Load existing sessions and add new one
    const sessions = await this.loadSessions();
    sessions.set(session.sessionId, session);
    await this.saveSessions(sessions);

    this.logger.debug(
      { sessionId: session.sessionId, expiresAt: session.expiresAt, version: session.version },
      "Created new OIDC session"
    );

    return session;
  }

  /**
   * Retrieve a session by ID
   *
   * Returns null if:
   * - Session doesn't exist
   * - Session has expired
   *
   * @param sessionId - Session ID to look up
   * @returns Session if found and not expired, null otherwise
   */
  async getSession(sessionId: string): Promise<OidcSession | null> {
    const sessions = await this.loadSessions();
    const session = sessions.get(sessionId);

    if (!session) {
      this.logger.debug({ sessionId }, "OIDC session not found");
      return null;
    }

    // Check expiry
    const now = new Date();
    const expiresAt = new Date(session.expiresAt);

    if (now > expiresAt) {
      this.logger.debug({ sessionId, expiresAt: session.expiresAt }, "OIDC session has expired");
      // Optionally clean up expired session
      sessions.delete(sessionId);
      await this.saveSessions(sessions);
      return null;
    }

    return session;
  }

  /**
   * Update an existing session
   *
   * Uses optimistic locking to detect concurrent modifications.
   * If the session version doesn't match, throws OidcSessionVersionConflictError.
   *
   * @param session - Session to update (must have valid sessionId)
   * @throws OidcSessionVersionConflictError if version mismatch detected
   */
  async updateSession(session: OidcSession): Promise<void> {
    const sessions = await this.loadSessions();
    const existingSession = sessions.get(session.sessionId);

    if (!existingSession) {
      throw new OidcSessionStorageError(
        "write",
        `Session not found: ${session.sessionId}`,
        undefined,
        false
      );
    }

    // Check optimistic locking version
    const existingVersion = existingSession.version ?? 0;
    const incomingVersion = session.version ?? 0;

    if (incomingVersion !== existingVersion) {
      this.logger.warn(
        {
          sessionId: session.sessionId,
          expectedVersion: incomingVersion,
          actualVersion: existingVersion,
        },
        "Session version conflict detected"
      );
      throw new OidcSessionVersionConflictError(
        session.sessionId,
        incomingVersion,
        existingVersion
      );
    }

    // Increment version for next update
    const updatedSession: OidcSession = {
      ...session,
      version: existingVersion + 1,
    };

    sessions.set(session.sessionId, updatedSession);
    await this.saveSessions(sessions);

    this.logger.debug(
      { sessionId: session.sessionId, version: updatedSession.version },
      "Updated OIDC session"
    );
  }

  /**
   * Delete a session (for logout)
   *
   * @param sessionId - Session ID to delete
   */
  async deleteSession(sessionId: string): Promise<void> {
    const sessions = await this.loadSessions();

    if (sessions.has(sessionId)) {
      sessions.delete(sessionId);
      await this.saveSessions(sessions);
      this.logger.debug({ sessionId }, "Deleted OIDC session");
    } else {
      this.logger.debug({ sessionId }, "OIDC session not found for deletion");
    }
  }

  /**
   * Clean up expired sessions
   *
   * Removes all sessions that have passed their expiration time.
   *
   * @returns Number of sessions cleaned up
   */
  async cleanExpiredSessions(): Promise<number> {
    const sessions = await this.loadSessions();
    const now = new Date();
    let cleanedCount = 0;

    for (const [sessionId, session] of sessions) {
      const expiresAt = new Date(session.expiresAt);
      if (now > expiresAt) {
        sessions.delete(sessionId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      await this.saveSessions(sessions);
      this.logger.info({ cleanedCount }, "Cleaned up expired OIDC sessions");
    }

    return cleanedCount;
  }

  /**
   * Start automatic session cleanup
   *
   * Schedules periodic cleanup of expired sessions.
   * Default interval is 5 minutes (300000ms).
   *
   * @param intervalMs - Cleanup interval in milliseconds (default: 300000 = 5 minutes)
   */
  startAutoCleanup(intervalMs: number = 300000): void {
    if (this.cleanupInterval) {
      this.logger.debug("Automatic session cleanup already running");
      return;
    }

    this.cleanupInterval = setInterval(() => {
      void this.cleanExpiredSessions().catch((error: unknown) => {
        this.logger.error({ err: error }, "Automatic session cleanup failed");
      });
    }, intervalMs);

    // Prevent interval from keeping process alive if it's the only thing running
    this.cleanupInterval.unref();

    this.logger.info(
      { intervalMs, intervalMinutes: Math.round(intervalMs / 60000) },
      "Started automatic session cleanup"
    );
  }

  /**
   * Stop automatic session cleanup
   *
   * Cancels the periodic cleanup interval.
   */
  stopAutoCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      this.logger.info("Stopped automatic session cleanup");
    }
  }

  /**
   * Check if automatic cleanup is running
   *
   * @returns True if cleanup interval is active
   */
  isAutoCleanupRunning(): boolean {
    return this.cleanupInterval !== null;
  }

  /**
   * Load all sessions from storage
   *
   * Uses in-memory cache for subsequent calls.
   * Creates an empty session store if the file doesn't exist.
   *
   * @returns Map of session ID to session
   */
  private async loadSessions(): Promise<Map<string, OidcSession>> {
    // Return cached sessions if available
    if (this.sessionCache !== null) {
      return new Map(this.sessionCache);
    }

    const startTime = performance.now();

    try {
      const file = Bun.file(this.filePath);
      const exists = await file.exists();

      if (!exists) {
        this.logger.info(
          { filePath: this.filePath },
          "OIDC session store not found - creating empty store"
        );
        this.sessionCache = new Map();
        await this.saveSessions(this.sessionCache);
        return new Map(this.sessionCache);
      }

      const content = await file.text();
      const parsed: unknown = JSON.parse(content);

      // Validate file format
      const validated = OidcSessionStoreFileSchema.parse(parsed);

      // Convert to Map
      this.sessionCache = new Map(Object.entries(validated.sessions));

      const durationMs = Math.round(performance.now() - startTime);
      this.logger.debug(
        {
          metric: "oidc_session_store.load_ms",
          value: durationMs,
          sessionCount: this.sessionCache.size,
        },
        "OIDC session store loaded"
      );

      return new Map(this.sessionCache);
    } catch (error) {
      const durationMs = Math.round(performance.now() - startTime);

      if (error instanceof SyntaxError) {
        this.logger.error(
          {
            metric: "oidc_session_store.load_ms",
            value: durationMs,
            filePath: this.filePath,
            err: error,
          },
          "OIDC session store file contains invalid JSON"
        );
        throw new OidcSessionStorageError(
          "read",
          `Invalid JSON in session store: ${error.message}`,
          error,
          false
        );
      }

      this.logger.error(
        {
          metric: "oidc_session_store.load_ms",
          value: durationMs,
          filePath: this.filePath,
          err: error,
        },
        "Failed to load OIDC session store"
      );

      throw new OidcSessionStorageError(
        "read",
        error instanceof Error ? error.message : String(error),
        error instanceof Error ? error : undefined,
        false
      );
    }
  }

  /**
   * Save all sessions to storage
   *
   * Uses atomic write pattern (temp file + rename) to prevent data corruption.
   *
   * @param sessions - Map of session ID to session
   */
  private async saveSessions(sessions: Map<string, OidcSession>): Promise<void> {
    const tempPath = `${this.filePath}.tmp`;
    const startTime = performance.now();

    try {
      // Prepare file content
      const storeFile: OidcSessionStoreFile = {
        version: "1.0",
        sessions: Object.fromEntries(sessions),
      };

      const content = JSON.stringify(storeFile, null, 2);

      // Write to temporary file
      await Bun.write(tempPath, content);

      // Restrict file permissions (owner read/write only) - important for security
      // OIDC sessions contain sensitive tokens that should not be readable by other users
      const fs = await import("fs/promises");
      try {
        await fs.chmod(tempPath, 0o600);
      } catch (chmodError) {
        // chmod may fail on Windows or other platforms, log warning but continue
        this.logger.warn(
          { err: chmodError, filePath: tempPath },
          "Could not set file permissions on session store (may be expected on Windows)"
        );
      }

      // Atomic rename
      await fs.rename(tempPath, this.filePath);

      // Update cache
      this.sessionCache = new Map(sessions);

      const durationMs = Math.round(performance.now() - startTime);
      this.logger.debug(
        {
          metric: "oidc_session_store.save_ms",
          value: durationMs,
          sessionCount: sessions.size,
        },
        "OIDC session store saved"
      );
    } catch (error) {
      const durationMs = Math.round(performance.now() - startTime);

      // Attempt to clean up temp file
      try {
        const fs = await import("fs/promises");
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }

      this.logger.error(
        {
          metric: "oidc_session_store.save_ms",
          value: durationMs,
          filePath: this.filePath,
          err: error,
        },
        "Failed to save OIDC session store"
      );

      throw new OidcSessionStorageError(
        "write",
        error instanceof Error ? error.message : String(error),
        error instanceof Error ? error : undefined,
        false
      );
    }
  }
}
