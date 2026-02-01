/**
 * Unit tests for graph adapter configuration utility
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  getAdapterConfig,
  getDefaultAdapterType,
  getAdapterDisplayName,
  getAdapterConfigHint,
  getAdapterDockerCommand,
} from "../../../../src/cli/utils/graph-config.js";

describe("getAdapterConfig", () => {
  // Store original env vars for both adapters
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Save original values for FalkorDB
    originalEnv["FALKORDB_HOST"] = process.env["FALKORDB_HOST"];
    originalEnv["FALKORDB_PORT"] = process.env["FALKORDB_PORT"];
    originalEnv["FALKORDB_USER"] = process.env["FALKORDB_USER"];
    originalEnv["FALKORDB_PASSWORD"] = process.env["FALKORDB_PASSWORD"];
    originalEnv["FALKORDB_GRAPH_NAME"] = process.env["FALKORDB_GRAPH_NAME"];

    // Save original values for Neo4j
    originalEnv["NEO4J_HOST"] = process.env["NEO4J_HOST"];
    originalEnv["NEO4J_BOLT_PORT"] = process.env["NEO4J_BOLT_PORT"];
    originalEnv["NEO4J_USER"] = process.env["NEO4J_USER"];
    originalEnv["NEO4J_PASSWORD"] = process.env["NEO4J_PASSWORD"];

    // Clear env vars for tests
    delete process.env["FALKORDB_HOST"];
    delete process.env["FALKORDB_PORT"];
    delete process.env["FALKORDB_USER"];
    delete process.env["FALKORDB_PASSWORD"];
    delete process.env["FALKORDB_GRAPH_NAME"];
    delete process.env["NEO4J_HOST"];
    delete process.env["NEO4J_BOLT_PORT"];
    delete process.env["NEO4J_USER"];
    delete process.env["NEO4J_PASSWORD"];
  });

  afterEach(() => {
    // Restore original values
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  describe("falkordb adapter", () => {
    test("should return FalkorDB config with defaults", () => {
      const config = getAdapterConfig("falkordb");

      expect(config.host).toBe("localhost");
      expect(config.port).toBe(6379);
      expect(config.username).toBe("default");
      expect(config.password).toBe("");
      expect(config.database).toBe("knowledge_graph");
    });

    test("should use custom FalkorDB environment variables", () => {
      process.env["FALKORDB_HOST"] = "falkordb.example.com";
      process.env["FALKORDB_PORT"] = "7379";
      process.env["FALKORDB_USER"] = "admin";
      process.env["FALKORDB_PASSWORD"] = "secret";
      process.env["FALKORDB_GRAPH_NAME"] = "my_graph";

      const config = getAdapterConfig("falkordb");

      expect(config.host).toBe("falkordb.example.com");
      expect(config.port).toBe(7379);
      expect(config.username).toBe("admin");
      expect(config.password).toBe("secret");
      expect(config.database).toBe("my_graph");
    });
  });

  describe("neo4j adapter", () => {
    test("should throw error when NEO4J_PASSWORD is not set", () => {
      expect(() => getAdapterConfig("neo4j")).toThrow(
        /NEO4J_PASSWORD environment variable is required/
      );
    });

    test("should return Neo4j config when password is set", () => {
      process.env["NEO4J_PASSWORD"] = "neo4j-secret";

      const config = getAdapterConfig("neo4j");

      expect(config.host).toBe("localhost");
      expect(config.port).toBe(7687);
      expect(config.username).toBe("neo4j");
      expect(config.password).toBe("neo4j-secret");
    });

    test("should use custom Neo4j environment variables", () => {
      process.env["NEO4J_HOST"] = "neo4j.example.com";
      process.env["NEO4J_BOLT_PORT"] = "7688";
      process.env["NEO4J_USER"] = "admin";
      process.env["NEO4J_PASSWORD"] = "secret123";

      const config = getAdapterConfig("neo4j");

      expect(config.host).toBe("neo4j.example.com");
      expect(config.port).toBe(7688);
      expect(config.username).toBe("admin");
      expect(config.password).toBe("secret123");
    });
  });

  describe("invalid adapter", () => {
    test("should throw error for unsupported adapter type", () => {
      // @ts-expect-error - Testing invalid input
      expect(() => getAdapterConfig("invalid")).toThrow(/Unsupported adapter type/);
    });
  });
});

describe("getDefaultAdapterType", () => {
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    originalEnv["GRAPH_ADAPTER"] = process.env["GRAPH_ADAPTER"];
    delete process.env["GRAPH_ADAPTER"];
  });

  afterEach(() => {
    if (originalEnv["GRAPH_ADAPTER"] === undefined) {
      delete process.env["GRAPH_ADAPTER"];
    } else {
      process.env["GRAPH_ADAPTER"] = originalEnv["GRAPH_ADAPTER"];
    }
  });

  test("should return falkordb by default when GRAPH_ADAPTER is not set", () => {
    expect(getDefaultAdapterType()).toBe("falkordb");
  });

  test("should return neo4j when GRAPH_ADAPTER is set to neo4j", () => {
    process.env["GRAPH_ADAPTER"] = "neo4j";

    expect(getDefaultAdapterType()).toBe("neo4j");
  });

  test("should return neo4j when GRAPH_ADAPTER is set to NEO4J (case insensitive)", () => {
    process.env["GRAPH_ADAPTER"] = "NEO4J";

    expect(getDefaultAdapterType()).toBe("neo4j");
  });

  test("should return falkordb when GRAPH_ADAPTER is set to falkordb", () => {
    process.env["GRAPH_ADAPTER"] = "falkordb";

    expect(getDefaultAdapterType()).toBe("falkordb");
  });

  test("should return falkordb for any value other than neo4j", () => {
    process.env["GRAPH_ADAPTER"] = "other";

    expect(getDefaultAdapterType()).toBe("falkordb");
  });
});

describe("getAdapterDisplayName", () => {
  test("should return 'Neo4j' for neo4j adapter", () => {
    expect(getAdapterDisplayName("neo4j")).toBe("Neo4j");
  });

  test("should return 'FalkorDB' for falkordb adapter", () => {
    expect(getAdapterDisplayName("falkordb")).toBe("FalkorDB");
  });
});

describe("getAdapterConfigHint", () => {
  test("should return NEO4J_PASSWORD hint for neo4j adapter", () => {
    expect(getAdapterConfigHint("neo4j")).toBe("Set NEO4J_PASSWORD in your .env file");
  });

  test("should return FALKORDB_PASSWORD hint for falkordb adapter", () => {
    expect(getAdapterConfigHint("falkordb")).toContain("FALKORDB_PASSWORD");
  });
});

describe("getAdapterDockerCommand", () => {
  test("should return neo4j docker command for neo4j adapter", () => {
    expect(getAdapterDockerCommand("neo4j")).toBe("docker compose up neo4j -d");
  });

  test("should return default profile docker command for falkordb adapter", () => {
    expect(getAdapterDockerCommand("falkordb")).toBe("docker compose --profile default up -d");
  });
});
