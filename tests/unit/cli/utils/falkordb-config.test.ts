/**
 * Unit tests for FalkorDB configuration utility
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { getFalkorDBConfig } from "../../../../src/cli/utils/falkordb-config.js";

describe("getFalkorDBConfig", () => {
  // Store original env vars
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Save original values
    originalEnv["FALKORDB_HOST"] = process.env["FALKORDB_HOST"];
    originalEnv["FALKORDB_PORT"] = process.env["FALKORDB_PORT"];
    originalEnv["FALKORDB_USER"] = process.env["FALKORDB_USER"];
    originalEnv["FALKORDB_PASSWORD"] = process.env["FALKORDB_PASSWORD"];
    originalEnv["FALKORDB_GRAPH_NAME"] = process.env["FALKORDB_GRAPH_NAME"];

    // Clear env vars for tests
    delete process.env["FALKORDB_HOST"];
    delete process.env["FALKORDB_PORT"];
    delete process.env["FALKORDB_USER"];
    delete process.env["FALKORDB_PASSWORD"];
    delete process.env["FALKORDB_GRAPH_NAME"];
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

  test("should return default values when env vars are not set", () => {
    const config = getFalkorDBConfig();

    expect(config.host).toBe("localhost");
    expect(config.port).toBe(6379);
    expect(config.username).toBe("default");
    expect(config.password).toBe("");
    expect(config.database).toBe("knowledge_graph");
  });

  test("should use custom host from environment", () => {
    process.env["FALKORDB_HOST"] = "custom-host";

    const config = getFalkorDBConfig();

    expect(config.host).toBe("custom-host");
  });

  test("should use custom port from environment", () => {
    process.env["FALKORDB_PORT"] = "7379";

    const config = getFalkorDBConfig();

    expect(config.port).toBe(7379);
  });

  test("should use custom username from environment", () => {
    process.env["FALKORDB_USER"] = "admin";

    const config = getFalkorDBConfig();

    expect(config.username).toBe("admin");
  });

  test("should use password from environment", () => {
    process.env["FALKORDB_PASSWORD"] = "secret123";

    const config = getFalkorDBConfig();

    expect(config.password).toBe("secret123");
  });

  test("should use custom graph name from environment", () => {
    process.env["FALKORDB_GRAPH_NAME"] = "my_graph";

    const config = getFalkorDBConfig();

    expect(config.database).toBe("my_graph");
  });

  test("should throw error for invalid port", () => {
    process.env["FALKORDB_PORT"] = "invalid";

    expect(() => getFalkorDBConfig()).toThrow(/Invalid FALKORDB_PORT value/);
  });

  test("should throw error for port out of range", () => {
    process.env["FALKORDB_PORT"] = "99999";

    expect(() => getFalkorDBConfig()).toThrow(/must be a valid integer between 1 and 65535/);
  });

  test("should throw error for negative port", () => {
    process.env["FALKORDB_PORT"] = "-1";

    expect(() => getFalkorDBConfig()).toThrow(/Invalid FALKORDB_PORT value/);
  });

  test("should throw error for port with text suffix", () => {
    process.env["FALKORDB_PORT"] = "6379abc";

    expect(() => getFalkorDBConfig()).toThrow(/Invalid FALKORDB_PORT value/);
  });

  test("should use all custom values together", () => {
    process.env["FALKORDB_HOST"] = "falkordb.example.com";
    process.env["FALKORDB_PORT"] = "7379";
    process.env["FALKORDB_USER"] = "admin";
    process.env["FALKORDB_PASSWORD"] = "super-secret";
    process.env["FALKORDB_GRAPH_NAME"] = "production_graph";

    const config = getFalkorDBConfig();

    expect(config.host).toBe("falkordb.example.com");
    expect(config.port).toBe(7379);
    expect(config.username).toBe("admin");
    expect(config.password).toBe("super-secret");
    expect(config.database).toBe("production_graph");
  });
});
