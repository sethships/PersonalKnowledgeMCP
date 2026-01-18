/**
 * Unit tests for neo4j-config utility.
 *
 * These tests are isolated from integration tests to avoid vi.mock() pollution.
 * The getNeo4jConfig function is mocked in graph-populate-all-command.test.ts,
 * which would cause dynamic imports to return the mocked version when running
 * the full test suite.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";

describe("getNeo4jConfig", () => {
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };
    // Set baseline valid env for most tests
    process.env["NEO4J_PASSWORD"] = "testpassword";
    process.env["NEO4J_HOST"] = "localhost";
    process.env["NEO4J_BOLT_PORT"] = "7687";
    process.env["NEO4J_USER"] = "neo4j";
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe("export and basic functionality", () => {
    it("should export getNeo4jConfig function", async () => {
      const { getNeo4jConfig } = await import("../../../src/cli/utils/neo4j-config.js");
      expect(getNeo4jConfig).toBeDefined();
      expect(typeof getNeo4jConfig).toBe("function");
    });

    it("should return valid config with all env vars set", async () => {
      const { getNeo4jConfig } = await import("../../../src/cli/utils/neo4j-config.js");

      const config = getNeo4jConfig();
      expect(config.host).toBe("localhost");
      expect(config.port).toBe(7687);
      expect(config.username).toBe("neo4j");
      expect(config.password).toBe("testpassword");
    });
  });

  describe("required password validation", () => {
    it("should throw when NEO4J_PASSWORD is missing", async () => {
      delete process.env["NEO4J_PASSWORD"];
      const { getNeo4jConfig } = await import("../../../src/cli/utils/neo4j-config.js");

      expect(() => getNeo4jConfig()).toThrow("NEO4J_PASSWORD");
    });

    it("should throw when NEO4J_PASSWORD is empty string", async () => {
      process.env["NEO4J_PASSWORD"] = "";
      const { getNeo4jConfig } = await import("../../../src/cli/utils/neo4j-config.js");

      expect(() => getNeo4jConfig()).toThrow("NEO4J_PASSWORD");
    });
  });

  describe("port validation", () => {
    it("should throw for invalid port (not-a-number)", async () => {
      process.env["NEO4J_BOLT_PORT"] = "not-a-number";
      const { getNeo4jConfig } = await import("../../../src/cli/utils/neo4j-config.js");

      expect(() => getNeo4jConfig()).toThrow("Invalid NEO4J_BOLT_PORT");
    });

    it("should throw for port out of range (99999)", async () => {
      process.env["NEO4J_BOLT_PORT"] = "99999";
      const { getNeo4jConfig } = await import("../../../src/cli/utils/neo4j-config.js");

      expect(() => getNeo4jConfig()).toThrow("Invalid NEO4J_BOLT_PORT");
    });

    it("should throw for port with non-numeric suffix", async () => {
      process.env["NEO4J_BOLT_PORT"] = "7687abc";
      const { getNeo4jConfig } = await import("../../../src/cli/utils/neo4j-config.js");

      expect(() => getNeo4jConfig()).toThrow("Invalid NEO4J_BOLT_PORT");
    });

    it("should throw for negative port", async () => {
      process.env["NEO4J_BOLT_PORT"] = "-1";
      const { getNeo4jConfig } = await import("../../../src/cli/utils/neo4j-config.js");

      expect(() => getNeo4jConfig()).toThrow("Invalid NEO4J_BOLT_PORT");
    });

    it("should throw for port 0", async () => {
      process.env["NEO4J_BOLT_PORT"] = "0";
      const { getNeo4jConfig } = await import("../../../src/cli/utils/neo4j-config.js");

      expect(() => getNeo4jConfig()).toThrow("Invalid NEO4J_BOLT_PORT");
    });

    it("should accept valid custom port", async () => {
      process.env["NEO4J_BOLT_PORT"] = "17687";
      const { getNeo4jConfig } = await import("../../../src/cli/utils/neo4j-config.js");

      const config = getNeo4jConfig();
      expect(config.port).toBe(17687);
    });
  });

  describe("default values", () => {
    it("should use default values when optional env vars are missing", async () => {
      delete process.env["NEO4J_HOST"];
      delete process.env["NEO4J_BOLT_PORT"];
      delete process.env["NEO4J_USER"];
      const { getNeo4jConfig } = await import("../../../src/cli/utils/neo4j-config.js");

      const config = getNeo4jConfig();
      expect(config.host).toBe("localhost");
      expect(config.port).toBe(7687);
      expect(config.username).toBe("neo4j");
    });
  });

  describe("custom configuration", () => {
    it("should handle custom host", async () => {
      process.env["NEO4J_HOST"] = "custom-host.example.com";
      const { getNeo4jConfig } = await import("../../../src/cli/utils/neo4j-config.js");

      const config = getNeo4jConfig();
      expect(config.host).toBe("custom-host.example.com");
    });

    it("should handle custom username", async () => {
      process.env["NEO4J_USER"] = "custom-user";
      const { getNeo4jConfig } = await import("../../../src/cli/utils/neo4j-config.js");

      const config = getNeo4jConfig();
      expect(config.username).toBe("custom-user");
    });
  });
});
