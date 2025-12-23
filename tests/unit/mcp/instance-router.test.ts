/**
 * Instance Router Unit Tests
 *
 * Tests for the multi-instance router that routes MCP requests
 * to the correct ChromaDB instance based on token access.
 *
 * @module tests/unit/mcp/instance-router
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { InstanceRouterImpl, createInstanceRouter } from "../../../src/mcp/instance-router.js";
import type { MultiInstanceConfig } from "../../../src/config/instance-config.js";
import type { TokenMetadata } from "../../../src/auth/types.js";
import { InstanceAccessDeniedError } from "../../../src/auth/errors.js";
import { initializeLogger, resetLogger } from "../../../src/logging/index.js";

/**
 * Create a test multi-instance configuration
 */
function createTestConfig(overrides?: Partial<MultiInstanceConfig>): MultiInstanceConfig {
  return {
    instances: {
      private: {
        name: "private",
        chromadb: { host: "localhost", port: 8000 },
        dataPath: "./data/private",
        enabled: true,
      },
      work: {
        name: "work",
        chromadb: { host: "localhost", port: 8001 },
        dataPath: "./data/work",
        enabled: true,
      },
      public: {
        name: "public",
        chromadb: { host: "localhost", port: 8002 },
        dataPath: "./data/public",
        enabled: true,
      },
    },
    defaultInstance: "public",
    requireAuthForDefaultInstance: false,
    ...overrides,
  };
}

/**
 * Create test token metadata
 */
function createTestTokenMetadata(overrides?: Partial<TokenMetadata>): TokenMetadata {
  return {
    name: "test-token",
    scopes: ["read"],
    instanceAccess: ["public"],
    createdAt: new Date().toISOString(),
    expiresAt: null,
    ...overrides,
  };
}

/**
 * Custom InstanceRouterImpl that uses mock clients
 *
 * We use a factory pattern to inject mock clients rather than
 * trying to override private methods.
 */
class TestableInstanceRouter extends InstanceRouterImpl {
  constructor(config: MultiInstanceConfig) {
    super(config);
  }

  // We'll use mock module injection via the factory pattern
}

// Override the module's client creation by mocking at the module level
// For these tests, we'll test the public interface behavior

describe("InstanceRouter", () => {
  beforeAll(() => {
    initializeLogger({ level: "error", format: "json" });
  });

  afterAll(() => {
    resetLogger();
  });

  describe("createInstanceRouter", () => {
    it("should create an instance router from config", () => {
      const config = createTestConfig();
      const router = createInstanceRouter(config);

      expect(router).toBeDefined();
      expect(router.getDefaultInstance()).toBe("public");
    });
  });

  describe("getDefaultInstance", () => {
    it("should return the configured default instance", () => {
      const router = new TestableInstanceRouter(createTestConfig({ defaultInstance: "work" }));
      expect(router.getDefaultInstance()).toBe("work");
    });

    it("should return public by default", () => {
      const router = new TestableInstanceRouter(createTestConfig());
      expect(router.getDefaultInstance()).toBe("public");
    });
  });

  describe("getAccessibleInstances", () => {
    describe("without token (stdio transport)", () => {
      it("should return default instance when auth not required", () => {
        const router = new TestableInstanceRouter(
          createTestConfig({ requireAuthForDefaultInstance: false })
        );

        const accessible = router.getAccessibleInstances();
        expect(accessible).toEqual(["public"]);
      });

      it("should return empty array when auth is required", () => {
        const router = new TestableInstanceRouter(
          createTestConfig({ requireAuthForDefaultInstance: true })
        );

        const accessible = router.getAccessibleInstances();
        expect(accessible).toEqual([]);
      });
    });

    describe("with token", () => {
      it("should return only instances the token can access", () => {
        const router = new TestableInstanceRouter(createTestConfig());
        const token = createTestTokenMetadata({ instanceAccess: ["work", "public"] });

        const accessible = router.getAccessibleInstances(token);
        expect(accessible).toContain("work");
        expect(accessible).toContain("public");
        expect(accessible).not.toContain("private");
      });

      it("should return all instances for token with full access", () => {
        const router = new TestableInstanceRouter(createTestConfig());
        const token = createTestTokenMetadata({
          instanceAccess: ["private", "work", "public"],
        });

        const accessible = router.getAccessibleInstances(token);
        expect(accessible).toEqual(["private", "work", "public"]);
      });

      it("should filter out disabled instances", () => {
        const config = createTestConfig();
        config.instances.work.enabled = false;

        const router = new TestableInstanceRouter(config);
        const token = createTestTokenMetadata({
          instanceAccess: ["private", "work", "public"],
        });

        const accessible = router.getAccessibleInstances(token);
        expect(accessible).toContain("private");
        expect(accessible).toContain("public");
        expect(accessible).not.toContain("work");
      });
    });
  });

  describe("getStorageClient access validation", () => {
    it("should deny access without token when auth is required", async () => {
      const router = new TestableInstanceRouter(
        createTestConfig({ requireAuthForDefaultInstance: true })
      );

      try {
        await router.getStorageClient("public");
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(InstanceAccessDeniedError);
      }
    });

    it("should deny access to non-default instance without token", async () => {
      const router = new TestableInstanceRouter(createTestConfig());

      try {
        await router.getStorageClient("private");
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(InstanceAccessDeniedError);
      }
    });

    it("should deny access when token lacks instance permission", async () => {
      const router = new TestableInstanceRouter(createTestConfig());
      const token = createTestTokenMetadata({ instanceAccess: ["public"] });

      try {
        await router.getStorageClient("private", token);
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(InstanceAccessDeniedError);
      }
    });

    it("should throw error for disabled instance", async () => {
      const config = createTestConfig();
      config.instances.work.enabled = false;

      const router = new TestableInstanceRouter(config);
      const token = createTestTokenMetadata({ instanceAccess: ["work"] });

      try {
        await router.getStorageClient("work", token);
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toMatch(/not available/);
      }
    });
  });

  describe("shutdown", () => {
    it("should complete gracefully", async () => {
      const router = new TestableInstanceRouter(createTestConfig());

      // Should not throw
      await router.shutdown();
    });
  });

  describe("getInstanceConfig", () => {
    it("should return config for enabled instance", () => {
      const router = new TestableInstanceRouter(createTestConfig());

      const config = router.getInstanceConfig("private");

      expect(config).toBeDefined();
      expect(config?.name).toBe("private");
      expect(config?.chromadb.port).toBe(8000);
    });

    it("should return undefined for disabled instance", () => {
      const config = createTestConfig();
      config.instances.work.enabled = false;

      const router = new TestableInstanceRouter(config);

      expect(router.getInstanceConfig("work")).toBeUndefined();
    });
  });

  describe("InstanceAccessDeniedError details", () => {
    it("should include required and present access in error", async () => {
      const router = new TestableInstanceRouter(createTestConfig());
      const token = createTestTokenMetadata({ instanceAccess: ["public"] });

      try {
        await router.getStorageClient("private", token);
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(InstanceAccessDeniedError);
        const accessError = error as InstanceAccessDeniedError;
        expect(accessError.requiredAccess).toContain("private");
        expect(accessError.presentAccess).toEqual(["public"]);
      }
    });
  });
});
