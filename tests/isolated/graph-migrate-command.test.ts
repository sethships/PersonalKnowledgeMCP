/**
 * Tests for Graph Migrate Command Schema Validation
 *
 * Tests schema validation for the graph migrate command options.
 * Command execution tests are in a separate integration test file.
 */

import { describe, it, expect } from "bun:test";

describe("GraphMigrateCommandOptionsSchema validation", () => {
  it("should import validation schema correctly", async () => {
    const { GraphMigrateCommandOptionsSchema } = await import("../../src/cli/utils/validation.js");

    expect(GraphMigrateCommandOptionsSchema).toBeDefined();
  });

  it("should validate empty options with default adapter", async () => {
    const { GraphMigrateCommandOptionsSchema } = await import("../../src/cli/utils/validation.js");

    const result = GraphMigrateCommandOptionsSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      // Default adapter should be falkordb
      expect(result.data.adapter).toBe("falkordb");
    }
  });

  it("should validate adapter option with neo4j", async () => {
    const { GraphMigrateCommandOptionsSchema } = await import("../../src/cli/utils/validation.js");

    const result = GraphMigrateCommandOptionsSchema.safeParse({ adapter: "neo4j" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.adapter).toBe("neo4j");
    }
  });

  it("should validate adapter option with falkordb", async () => {
    const { GraphMigrateCommandOptionsSchema } = await import("../../src/cli/utils/validation.js");

    const result = GraphMigrateCommandOptionsSchema.safeParse({ adapter: "falkordb" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.adapter).toBe("falkordb");
    }
  });

  it("should reject invalid adapter option", async () => {
    const { GraphMigrateCommandOptionsSchema } = await import("../../src/cli/utils/validation.js");

    const result = GraphMigrateCommandOptionsSchema.safeParse({ adapter: "invalid" });
    expect(result.success).toBe(false);
  });

  it("should handle adapter option case-insensitively", async () => {
    const { GraphMigrateCommandOptionsSchema } = await import("../../src/cli/utils/validation.js");

    const result = GraphMigrateCommandOptionsSchema.safeParse({ adapter: "NEO4J" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.adapter).toBe("neo4j");
    }
  });

  it("should validate dryRun option", async () => {
    const { GraphMigrateCommandOptionsSchema } = await import("../../src/cli/utils/validation.js");

    const result = GraphMigrateCommandOptionsSchema.safeParse({ dryRun: true });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dryRun).toBe(true);
    }
  });

  it("should validate force option", async () => {
    const { GraphMigrateCommandOptionsSchema } = await import("../../src/cli/utils/validation.js");

    const result = GraphMigrateCommandOptionsSchema.safeParse({ force: true });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.force).toBe(true);
    }
  });

  it("should validate status option", async () => {
    const { GraphMigrateCommandOptionsSchema } = await import("../../src/cli/utils/validation.js");

    const result = GraphMigrateCommandOptionsSchema.safeParse({ status: true });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe(true);
    }
  });

  it("should validate json option", async () => {
    const { GraphMigrateCommandOptionsSchema } = await import("../../src/cli/utils/validation.js");

    const result = GraphMigrateCommandOptionsSchema.safeParse({ json: true });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.json).toBe(true);
    }
  });

  it("should validate all options together", async () => {
    const { GraphMigrateCommandOptionsSchema } = await import("../../src/cli/utils/validation.js");

    const result = GraphMigrateCommandOptionsSchema.safeParse({
      adapter: "neo4j",
      dryRun: true,
      force: true,
      status: false,
      json: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.adapter).toBe("neo4j");
      expect(result.data.dryRun).toBe(true);
      expect(result.data.force).toBe(true);
      expect(result.data.status).toBe(false);
      expect(result.data.json).toBe(true);
    }
  });
});
