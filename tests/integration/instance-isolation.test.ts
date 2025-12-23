/**
 * Instance Isolation Integration Tests
 *
 * Tests that verify proper isolation between multi-instance deployments.
 * These tests ensure that tokens with specific instance access cannot
 * access other instances, and that data is properly isolated.
 *
 * @module tests/integration/instance-isolation
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { InstanceRouterImpl, createInstanceRouter } from "../../src/mcp/instance-router.js";
import type { MultiInstanceConfig } from "../../src/config/instance-config.js";
import type { TokenMetadata } from "../../src/auth/types.js";
import { InstanceAccessDeniedError } from "../../src/auth/errors.js";
import { initializeLogger, resetLogger } from "../../src/logging/index.js";

/**
 * Create test token metadata with specific instance access
 */
function createTestToken(
  instanceAccess: ("private" | "work" | "public")[],
  overrides?: Partial<TokenMetadata>
): TokenMetadata {
  return {
    name: "test-token",
    scopes: ["read"],
    instanceAccess,
    createdAt: new Date().toISOString(),
    expiresAt: null,
    ...overrides,
  };
}

/**
 * Create test configuration for multi-instance setup
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

describe("Instance Isolation", () => {
  beforeAll(() => {
    initializeLogger({ level: "error", format: "json" });
  });

  afterAll(() => {
    resetLogger();
  });

  describe("Token-Based Instance Access Control", () => {
    it("should deny access to private instance with work-only token", async () => {
      const router = new InstanceRouterImpl(createTestConfig());
      const workToken = createTestToken(["work"]);

      try {
        await router.getStorageClient("private", workToken);
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(InstanceAccessDeniedError);
      }
    });

    it("should deny access to work instance with public-only token", async () => {
      const router = new InstanceRouterImpl(createTestConfig());
      const publicToken = createTestToken(["public"]);

      try {
        await router.getStorageClient("work", publicToken);
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(InstanceAccessDeniedError);
      }
    });

    it("should deny access to private instance with public-only token", async () => {
      const router = new InstanceRouterImpl(createTestConfig());
      const publicToken = createTestToken(["public"]);

      try {
        await router.getStorageClient("private", publicToken);
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(InstanceAccessDeniedError);
      }
    });

    it("should allow access to work and private with multi-instance token", async () => {
      const router = new InstanceRouterImpl(createTestConfig());
      const multiToken = createTestToken(["private", "work"]);

      // Should not throw for either instance
      const accessible = router.getAccessibleInstances(multiToken);
      expect(accessible).toContain("private");
      expect(accessible).toContain("work");
      expect(accessible).not.toContain("public");
    });

    it("should allow access to all instances with full-access token", async () => {
      const router = new InstanceRouterImpl(createTestConfig());
      const fullToken = createTestToken(["private", "work", "public"]);

      const accessible = router.getAccessibleInstances(fullToken);
      expect(accessible).toContain("private");
      expect(accessible).toContain("work");
      expect(accessible).toContain("public");
      expect(accessible.length).toBe(3);
    });
  });

  describe("Unauthenticated Access (stdio Transport)", () => {
    it("should allow access to default public instance without token when auth not required", () => {
      const router = new InstanceRouterImpl(
        createTestConfig({
          defaultInstance: "public",
          requireAuthForDefaultInstance: false,
        })
      );

      const accessible = router.getAccessibleInstances();
      expect(accessible).toEqual(["public"]);
    });

    it("should deny access to any instance without token when auth is required", () => {
      const router = new InstanceRouterImpl(
        createTestConfig({ requireAuthForDefaultInstance: true })
      );

      const accessible = router.getAccessibleInstances();
      expect(accessible).toEqual([]);
    });

    it("should deny access to non-default instance without token", async () => {
      const router = new InstanceRouterImpl(
        createTestConfig({
          defaultInstance: "public",
          requireAuthForDefaultInstance: false,
        })
      );

      // Private should be denied
      try {
        await router.getStorageClient("private");
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(InstanceAccessDeniedError);
      }

      // Work should also be denied
      try {
        await router.getStorageClient("work");
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(InstanceAccessDeniedError);
      }
    });

    it("should use work as default when configured", () => {
      const router = new InstanceRouterImpl(createTestConfig({ defaultInstance: "work" }));

      expect(router.getDefaultInstance()).toBe("work");

      const accessible = router.getAccessibleInstances();
      expect(accessible).toEqual(["work"]);
    });
  });

  describe("Disabled Instance Handling", () => {
    it("should not allow access to disabled instance even with valid token", async () => {
      const config = createTestConfig();
      config.instances.work.enabled = false;

      const router = new InstanceRouterImpl(config);
      const workToken = createTestToken(["work"]);

      // getAccessibleInstances should filter out disabled instances
      const accessible = router.getAccessibleInstances(workToken);
      expect(accessible).not.toContain("work");

      // getStorageClient should throw for disabled instance
      try {
        await router.getStorageClient("work", workToken);
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toMatch(/not available/);
      }
    });

    it("should allow access to enabled instances when some are disabled", async () => {
      const config = createTestConfig();
      config.instances.private.enabled = false;

      const router = new InstanceRouterImpl(config);
      const multiToken = createTestToken(["private", "work", "public"]);

      const accessible = router.getAccessibleInstances(multiToken);
      expect(accessible).not.toContain("private");
      expect(accessible).toContain("work");
      expect(accessible).toContain("public");
    });
  });

  describe("Instance Configuration Retrieval", () => {
    it("should return config for enabled instances", () => {
      const router = new InstanceRouterImpl(createTestConfig());

      const privateConfig = router.getInstanceConfig("private");
      expect(privateConfig).toBeDefined();
      expect(privateConfig?.name).toBe("private");
      expect(privateConfig?.chromadb.port).toBe(8000);

      const workConfig = router.getInstanceConfig("work");
      expect(workConfig).toBeDefined();
      expect(workConfig?.name).toBe("work");
      expect(workConfig?.chromadb.port).toBe(8001);

      const publicConfig = router.getInstanceConfig("public");
      expect(publicConfig).toBeDefined();
      expect(publicConfig?.name).toBe("public");
      expect(publicConfig?.chromadb.port).toBe(8002);
    });

    it("should return undefined for disabled instances", () => {
      const config = createTestConfig();
      config.instances.work.enabled = false;

      const router = new InstanceRouterImpl(config);

      expect(router.getInstanceConfig("work")).toBeUndefined();
      expect(router.getInstanceConfig("private")).toBeDefined();
      expect(router.getInstanceConfig("public")).toBeDefined();
    });
  });

  describe("Error Details", () => {
    it("should include required and present access in InstanceAccessDeniedError", async () => {
      const router = new InstanceRouterImpl(createTestConfig());
      const publicOnlyToken = createTestToken(["public"]);

      try {
        await router.getStorageClient("private", publicOnlyToken);
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(InstanceAccessDeniedError);
        const accessError = error as InstanceAccessDeniedError;
        expect(accessError.requiredAccess).toContain("private");
        expect(accessError.presentAccess).toEqual(["public"]);
        expect(accessError.message).toContain("private");
      }
    });

    it("should indicate no access when token has empty instanceAccess", async () => {
      const router = new InstanceRouterImpl(
        createTestConfig({ requireAuthForDefaultInstance: true })
      );
      const noAccessToken = createTestToken([]);

      try {
        await router.getStorageClient("public", noAccessToken);
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(InstanceAccessDeniedError);
        const accessError = error as InstanceAccessDeniedError;
        expect(accessError.presentAccess).toEqual([]);
      }
    });
  });

  describe("Instance Router Factory", () => {
    it("should create router from config with createInstanceRouter", () => {
      const config = createTestConfig();
      const router = createInstanceRouter(config);

      expect(router).toBeDefined();
      expect(router.getDefaultInstance()).toBe("public");
    });

    it("should respect custom default instance in factory", () => {
      const config = createTestConfig({ defaultInstance: "private" });
      const router = createInstanceRouter(config);

      expect(router.getDefaultInstance()).toBe("private");
    });
  });

  describe("Graceful Shutdown", () => {
    it("should shutdown without errors", async () => {
      const router = new InstanceRouterImpl(createTestConfig());

      // Should not throw
      await router.shutdown();
    });

    it("should allow multiple shutdown calls", async () => {
      const router = new InstanceRouterImpl(createTestConfig());

      // Should not throw on multiple calls
      await router.shutdown();
      await router.shutdown();
    });
  });
});
