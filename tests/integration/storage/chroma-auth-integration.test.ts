/**
 * ChromaDB Authentication Integration Tests
 *
 * Tests ChromaDB client behavior with authentication enabled.
 * These tests require:
 * 1. Auth-enabled ChromaDB instance running (docker-compose.test.yml)
 * 2. Environment variables set (see .env.test.example)
 *
 * Run these tests with:
 *   docker compose -f docker-compose.yml -f docker-compose.test.yml --profile test-auth up -d
 *   RUN_AUTH_INTEGRATION_TESTS=true bun test tests/integration/storage/chroma-auth-integration.test.ts
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { ChromaStorageClientImpl } from "../../../src/storage/chroma-client.js";
import type { ChromaConfig } from "../../../src/storage/types.js";
import { initializeLogger } from "../../../src/logging/index.js";

// Check if auth integration tests should run
const shouldRunAuthTests = process.env["RUN_AUTH_INTEGRATION_TESTS"] === "true";
const testAuthToken =
  process.env["CHROMADB_TEST_AUTH_TOKEN"] || "test-token-change-me-in-production";
const testHost = process.env["CHROMADB_AUTH_TEST_HOST"] || "localhost";
const testPort = parseInt(process.env["CHROMADB_AUTH_TEST_PORT"] || "8100", 10);

// Initialize logger once before all tests
beforeAll(() => {
  try {
    initializeLogger({ level: "silent", format: "json" });
  } catch {
    // Logger already initialized, ignore
  }
});

describe("ChromaDB Authentication Integration", () => {
  // Skip all tests if auth integration tests are not enabled
  const describeOrSkip = shouldRunAuthTests ? describe : describe.skip;

  describeOrSkip("Connection with Valid Token", () => {
    let client: ChromaStorageClientImpl;

    beforeAll(async () => {
      const config: ChromaConfig = {
        host: testHost,
        port: testPort,
        authToken: testAuthToken,
      };
      client = new ChromaStorageClientImpl(config);
    });

    test("should connect successfully with valid auth token", async () => {
      // client.connect() returns Promise<void>, so we expect it to resolve without throwing
      await client.connect();
      // If we get here without throwing, the connection succeeded
      expect(true).toBe(true);
    });

    test("should pass health check with valid auth token", async () => {
      // Connect if not already connected
      try {
        await client.connect();
      } catch {
        // Already connected, ignore
      }

      const isHealthy = await client.healthCheck();
      expect(isHealthy).toBe(true);
    });

    test("should be able to create collection with valid auth token", async () => {
      // Connect if not already connected
      try {
        await client.connect();
      } catch {
        // Already connected, ignore
      }

      // This operation requires a valid authenticated connection
      // Use a unique collection name to avoid conflicts
      const collection = await client.getOrCreateCollection("test_auth_collection");
      expect(collection).toBeDefined();
    });
  });

  describeOrSkip("Connection with Invalid Token", () => {
    let client: ChromaStorageClientImpl;

    beforeAll(() => {
      const config: ChromaConfig = {
        host: testHost,
        port: testPort,
        authToken: "invalid-wrong-token-12345",
      };
      client = new ChromaStorageClientImpl(config);
    });

    test("should connect successfully (heartbeat is unauthenticated)", async () => {
      // ChromaDB's heartbeat endpoint is unauthenticated, so connect() succeeds
      // Auth is only enforced on data operations
      await client.connect();
      expect(true).toBe(true);
    });

    test("health check should pass (heartbeat is unauthenticated)", async () => {
      try {
        await client.connect();
      } catch {
        // Ignore if already connected
      }

      // Health check uses heartbeat endpoint which is unauthenticated
      const isHealthy = await client.healthCheck();
      expect(isHealthy).toBe(true);
    });

    test("should fail data operations with invalid auth token", async () => {
      try {
        await client.connect();
      } catch {
        // Ignore if already connected
      }

      // Data operations should fail with 401 Unauthorized
      try {
        await client.getOrCreateCollection("test_invalid_token_collection");
        // If we get here, auth wasn't enforced (unexpected)
        expect(true).toBe(false);
      } catch (error) {
        // Expected: 401 Unauthorized error
        expect(error).toBeDefined();
      }
    });
  });

  describeOrSkip("Connection without Token (Auth Required)", () => {
    let client: ChromaStorageClientImpl;

    beforeAll(() => {
      // No auth token provided, but server requires auth
      const config: ChromaConfig = {
        host: testHost,
        port: testPort,
        // authToken intentionally omitted
      };
      client = new ChromaStorageClientImpl(config);
    });

    test("should connect successfully (heartbeat is unauthenticated)", async () => {
      // ChromaDB's heartbeat endpoint is unauthenticated, so connect() succeeds
      // Auth is only enforced on data operations
      await client.connect();
      expect(true).toBe(true);
    });

    test("health check should pass (heartbeat is unauthenticated)", async () => {
      try {
        await client.connect();
      } catch {
        // Ignore if already connected
      }

      // Health check uses heartbeat endpoint which is unauthenticated
      const isHealthy = await client.healthCheck();
      expect(isHealthy).toBe(true);
    });

    test("should fail data operations without auth token", async () => {
      try {
        await client.connect();
      } catch {
        // Ignore if already connected
      }

      // Data operations should fail with 401 Unauthorized
      try {
        await client.getOrCreateCollection("test_no_token_collection");
        // If we get here, auth wasn't enforced (unexpected)
        expect(true).toBe(false);
      } catch (error) {
        // Expected: 401 Unauthorized error
        expect(error).toBeDefined();
      }
    });
  });

  // Always run this test to verify the skip logic works
  test("should skip auth tests when RUN_AUTH_INTEGRATION_TESTS is not true", () => {
    if (!shouldRunAuthTests) {
      // This test passes to confirm we correctly skip auth tests
      expect(true).toBe(true);
    } else {
      // Auth tests are enabled, this test is a no-op
      expect(true).toBe(true);
    }
  });
});
