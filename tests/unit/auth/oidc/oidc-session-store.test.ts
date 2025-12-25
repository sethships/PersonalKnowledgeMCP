/**
 * OIDC Session Store Unit Tests
 *
 * Tests for the OIDC session storage implementation.
 *
 * @module tests/unit/auth/oidc/oidc-session-store
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { OidcSessionStoreImpl } from "../../../../src/auth/oidc/oidc-session-store.js";
import { initializeLogger, resetLogger } from "../../../../src/logging/index.js";
import { join } from "path";
import { mkdtemp, rm, readFile, writeFile } from "fs/promises";
import { tmpdir } from "os";
import type { OidcSession } from "../../../../src/auth/oidc/oidc-types.js";

describe("OIDC Session Store", () => {
  let tempDir: string;

  beforeAll(async () => {
    initializeLogger({ level: "error", format: "json" });
    // Create a unique temp directory for each test run
    tempDir = await mkdtemp(join(tmpdir(), "oidc-session-test-"));
  });

  afterAll(async () => {
    resetLogger();
    // Clean up temp directory
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  beforeEach(() => {
    // Reset singleton for each test
    OidcSessionStoreImpl.resetInstance();
  });

  afterEach(() => {
    OidcSessionStoreImpl.resetInstance();
  });

  describe("getInstance", () => {
    it("should return the same instance on subsequent calls", () => {
      const store1 = OidcSessionStoreImpl.getInstance(tempDir);
      const store2 = OidcSessionStoreImpl.getInstance(tempDir);

      expect(store1).toBe(store2);
    });

    it("should use provided data path", () => {
      const store = OidcSessionStoreImpl.getInstance(tempDir);
      const storagePath = store.getStoragePath();

      expect(storagePath).toBe(join(tempDir, "oidc-sessions.json"));
    });
  });

  describe("createSession", () => {
    it("should create a new session with UUID", async () => {
      const store = OidcSessionStoreImpl.getInstance(tempDir);
      const session = await store.createSession();

      expect(session.sessionId).toBeDefined();
      expect(session.sessionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    });

    it("should set createdAt to current time", async () => {
      const store = OidcSessionStoreImpl.getInstance(tempDir);
      const before = new Date();
      const session = await store.createSession();
      const after = new Date();

      const createdAt = new Date(session.createdAt);
      expect(createdAt >= before).toBe(true);
      expect(createdAt <= after).toBe(true);
    });

    it("should set expiresAt based on TTL", async () => {
      const ttl = 7200; // 2 hours
      const store = OidcSessionStoreImpl.getInstance(tempDir, ttl);
      const session = await store.createSession();

      const createdAt = new Date(session.createdAt);
      const expiresAt = new Date(session.expiresAt);
      const expectedExpiry = new Date(createdAt.getTime() + ttl * 1000);

      // Allow 1 second tolerance
      expect(Math.abs(expiresAt.getTime() - expectedExpiry.getTime())).toBeLessThan(1000);
    });

    it("should initialize with empty scopes and instance access", async () => {
      const store = OidcSessionStoreImpl.getInstance(tempDir);
      const session = await store.createSession();

      expect(session.mappedScopes).toEqual([]);
      expect(session.mappedInstanceAccess).toEqual([]);
    });

    it("should persist the session to disk", async () => {
      const store = OidcSessionStoreImpl.getInstance(tempDir);
      const session = await store.createSession();

      // Read the file directly
      const content = await readFile(store.getStoragePath(), "utf-8");
      const parsed = JSON.parse(content) as { sessions: Record<string, { sessionId: string }> };

      expect(parsed.sessions[session.sessionId]).toBeDefined();
      expect(parsed.sessions[session.sessionId].sessionId).toBe(session.sessionId);
    });
  });

  describe("getSession", () => {
    it("should retrieve an existing session", async () => {
      const store = OidcSessionStoreImpl.getInstance(tempDir);
      const created = await store.createSession();

      const retrieved = await store.getSession(created.sessionId);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.sessionId).toBe(created.sessionId);
      expect(retrieved?.createdAt).toBe(created.createdAt);
    });

    it("should return null for non-existent session", async () => {
      const store = OidcSessionStoreImpl.getInstance(tempDir);

      const retrieved = await store.getSession("non-existent-session-id");

      expect(retrieved).toBeNull();
    });

    it("should return null for expired session", async () => {
      const store = OidcSessionStoreImpl.getInstance(tempDir, 1); // 1 second TTL
      const session = await store.createSession();

      // Wait for expiry
      await new Promise((resolve) => setTimeout(resolve, 1100));

      const retrieved = await store.getSession(session.sessionId);

      expect(retrieved).toBeNull();
    });

    it("should delete expired session when retrieved", async () => {
      const store = OidcSessionStoreImpl.getInstance(tempDir, 1); // 1 second TTL
      const session = await store.createSession();

      // Wait for expiry
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // This should delete the expired session
      await store.getSession(session.sessionId);

      // Verify it's deleted from storage
      store.invalidateCache();
      const retrieved = await store.getSession(session.sessionId);
      expect(retrieved).toBeNull();
    });
  });

  describe("updateSession", () => {
    it("should update an existing session", async () => {
      const store = OidcSessionStoreImpl.getInstance(tempDir);
      const session = await store.createSession();

      // Update the session
      session.mappedScopes = ["read", "write"];
      session.mappedInstanceAccess = ["work"];
      session.user = {
        sub: "user-123",
        email: "test@example.com",
        name: "Test User",
      };

      await store.updateSession(session);

      // Retrieve and verify
      const retrieved = await store.getSession(session.sessionId);
      expect(retrieved?.mappedScopes).toEqual(["read", "write"]);
      expect(retrieved?.mappedInstanceAccess).toEqual(["work"]);
      expect(retrieved?.user?.sub).toBe("user-123");
      expect(retrieved?.user?.email).toBe("test@example.com");
    });

    it("should throw error for non-existent session", async () => {
      const store = OidcSessionStoreImpl.getInstance(tempDir);

      const fakeSession: OidcSession = {
        sessionId: "non-existent-session",
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        mappedScopes: [],
        mappedInstanceAccess: [],
      };

      expect(store.updateSession(fakeSession)).rejects.toThrow(/Session not found/);
    });

    it("should persist updates to disk", async () => {
      const store = OidcSessionStoreImpl.getInstance(tempDir);
      const session = await store.createSession();

      session.mappedScopes = ["admin"];
      await store.updateSession(session);

      // Force reload from disk
      store.invalidateCache();
      const retrieved = await store.getSession(session.sessionId);

      expect(retrieved?.mappedScopes).toEqual(["admin"]);
    });
  });

  describe("deleteSession", () => {
    it("should delete an existing session", async () => {
      const store = OidcSessionStoreImpl.getInstance(tempDir);
      const session = await store.createSession();

      await store.deleteSession(session.sessionId);

      const retrieved = await store.getSession(session.sessionId);
      expect(retrieved).toBeNull();
    });

    it("should not throw for non-existent session", async () => {
      const store = OidcSessionStoreImpl.getInstance(tempDir);

      // Should not throw
      await store.deleteSession("non-existent-session-id");
    });

    it("should persist deletion to disk", async () => {
      const store = OidcSessionStoreImpl.getInstance(tempDir);
      const session = await store.createSession();

      await store.deleteSession(session.sessionId);

      // Force reload from disk
      store.invalidateCache();
      const retrieved = await store.getSession(session.sessionId);

      expect(retrieved).toBeNull();
    });
  });

  describe("cleanExpiredSessions", () => {
    it("should remove expired sessions", async () => {
      const store = OidcSessionStoreImpl.getInstance(tempDir, 1); // 1 second TTL
      // Create sessions (they'll expire after 1 second)
      await store.createSession();
      await store.createSession();

      // Wait for expiry
      await new Promise((resolve) => setTimeout(resolve, 1100));

      const cleanedCount = await store.cleanExpiredSessions();

      expect(cleanedCount).toBe(2);
    });

    it("should not remove valid sessions", async () => {
      const store = OidcSessionStoreImpl.getInstance(tempDir, 3600); // 1 hour TTL
      const session = await store.createSession();

      const cleanedCount = await store.cleanExpiredSessions();

      expect(cleanedCount).toBe(0);

      // Session should still exist
      const retrieved = await store.getSession(session.sessionId);
      expect(retrieved).not.toBeNull();
    });

    it("should return 0 when no expired sessions", async () => {
      const store = OidcSessionStoreImpl.getInstance(tempDir, 3600);
      await store.createSession();

      const cleanedCount = await store.cleanExpiredSessions();

      expect(cleanedCount).toBe(0);
    });
  });

  describe("invalidateCache", () => {
    it("should force reload from disk on next access", async () => {
      const store = OidcSessionStoreImpl.getInstance(tempDir);
      const session = await store.createSession();

      // Manually modify the file
      const content = await readFile(store.getStoragePath(), "utf-8");
      const parsed = JSON.parse(content) as {
        sessions: Record<string, { mappedScopes: string[] }>;
      };
      parsed.sessions[session.sessionId].mappedScopes = ["admin"];
      await writeFile(store.getStoragePath(), JSON.stringify(parsed, null, 2));

      // Without invalidation, cache would return old value
      store.invalidateCache();

      const retrieved = await store.getSession(session.sessionId);
      expect(retrieved?.mappedScopes).toEqual(["admin"]);
    });
  });

  describe("file format", () => {
    it("should use version 1.0 format", async () => {
      const store = OidcSessionStoreImpl.getInstance(tempDir);
      await store.createSession();

      const content = await readFile(store.getStoragePath(), "utf-8");
      const parsed = JSON.parse(content) as { version: string };

      expect(parsed.version).toBe("1.0");
    });

    it("should store sessions as object with session ID keys", async () => {
      const store = OidcSessionStoreImpl.getInstance(tempDir);
      const session = await store.createSession();

      const content = await readFile(store.getStoragePath(), "utf-8");
      const parsed = JSON.parse(content) as { sessions: Record<string, unknown> };

      expect(typeof parsed.sessions).toBe("object");
      expect(parsed.sessions[session.sessionId]).toBeDefined();
    });
  });

  describe("error handling", () => {
    it("should handle invalid JSON in storage file", async () => {
      const store = OidcSessionStoreImpl.getInstance(tempDir);

      // Write invalid JSON
      await writeFile(store.getStoragePath(), "not valid json");
      store.invalidateCache();

      expect(store.createSession()).rejects.toThrow(/Invalid JSON/);
    });

    it("should create new file if it does not exist", async () => {
      // Use a new temp directory
      const newTempDir = await mkdtemp(join(tmpdir(), "oidc-session-new-"));

      try {
        OidcSessionStoreImpl.getInstance(newTempDir);
        OidcSessionStoreImpl.resetInstance();

        const newStore = OidcSessionStoreImpl.getInstance(newTempDir);
        const session = await newStore.createSession();

        expect(session).toBeDefined();
        expect(session.sessionId).toBeDefined();
      } finally {
        await rm(newTempDir, { recursive: true, force: true });
      }
    });
  });
});
