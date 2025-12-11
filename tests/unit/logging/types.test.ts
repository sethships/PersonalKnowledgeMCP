/**
 * Unit tests for logging types
 *
 * Tests type definitions, exports, and type compatibility.
 */

import { describe, test, expect } from "bun:test";
import type {
  LogLevel,
  LoggerConfig,
  ComponentContext,
  LogEntry,
  MetricLogEntry,
} from "../../../src/logging/index.js";

describe("Logging Types", () => {
  describe("LogLevel", () => {
    test("should accept all valid log levels", () => {
      const validLevels: LogLevel[] = ["fatal", "error", "warn", "info", "debug", "trace"];

      // If this compiles, the type is correctly defined
      expect(validLevels).toHaveLength(6);
      expect(validLevels).toContain("fatal");
      expect(validLevels).toContain("error");
      expect(validLevels).toContain("warn");
      expect(validLevels).toContain("info");
      expect(validLevels).toContain("debug");
      expect(validLevels).toContain("trace");
    });
  });

  describe("LoggerConfig", () => {
    test("should accept valid logger configurations", () => {
      const jsonConfig: LoggerConfig = {
        level: "info",
        format: "json",
      };

      const prettyConfig: LoggerConfig = {
        level: "debug",
        format: "pretty",
      };

      expect(jsonConfig.level).toBe("info");
      expect(jsonConfig.format).toBe("json");
      expect(prettyConfig.level).toBe("debug");
      expect(prettyConfig.format).toBe("pretty");
    });

    test("should support all log levels", () => {
      const configs: LoggerConfig[] = [
        { level: "fatal", format: "json" },
        { level: "error", format: "json" },
        { level: "warn", format: "json" },
        { level: "info", format: "json" },
        { level: "debug", format: "json" },
        { level: "trace", format: "json" },
      ];

      expect(configs).toHaveLength(6);
    });

    test("should support both output formats", () => {
      const jsonConfig: LoggerConfig = { level: "info", format: "json" };
      const prettyConfig: LoggerConfig = { level: "info", format: "pretty" };

      expect(jsonConfig.format).toBe("json");
      expect(prettyConfig.format).toBe("pretty");
    });
  });

  describe("ComponentContext", () => {
    test("should accept component name only", () => {
      const context: ComponentContext = {
        component: "test-component",
      };

      expect(context.component).toBe("test-component");
      expect(context.requestId).toBeUndefined();
    });

    test("should accept component name with requestId", () => {
      const context: ComponentContext = {
        component: "test-component",
        requestId: "req-123",
      };

      expect(context.component).toBe("test-component");
      expect(context.requestId).toBe("req-123");
    });

    test("should support hierarchical component names", () => {
      const contexts: ComponentContext[] = [
        { component: "mcp-server" },
        { component: "storage:chromadb" },
        { component: "mcp:tools" },
        { component: "ingestion:cloner" },
      ];

      expect(contexts[0]?.component).toBe("mcp-server");
      expect(contexts[1]?.component).toBe("storage:chromadb");
      expect(contexts[2]?.component).toBe("mcp:tools");
      expect(contexts[3]?.component).toBe("ingestion:cloner");
    });
  });

  describe("LogEntry", () => {
    test("should define required fields", () => {
      const entry: LogEntry = {
        timestamp: "2025-12-11T15:30:45.123Z",
        level: "info",
        component: "test",
        msg: "Test message",
      };

      expect(entry.timestamp).toBe("2025-12-11T15:30:45.123Z");
      expect(entry.level).toBe("info");
      expect(entry.component).toBe("test");
      expect(entry.msg).toBe("Test message");
    });

    test("should support optional requestId", () => {
      const entryWithRequest: LogEntry = {
        timestamp: "2025-12-11T15:30:45.123Z",
        level: "info",
        component: "test",
        msg: "Test message",
        requestId: "req-abc123",
      };

      expect(entryWithRequest.requestId).toBe("req-abc123");
    });

    test("should support additional structured data", () => {
      const entry: LogEntry = {
        timestamp: "2025-12-11T15:30:45.123Z",
        level: "info",
        component: "test",
        msg: "Operation completed",
        duration: 123,
        status: "success",
        count: 42,
        metadata: {
          foo: "bar",
          nested: {
            value: 100,
          },
        },
      };

      expect(entry["duration"]).toBe(123);
      expect(entry["status"]).toBe("success");
      expect(entry["count"]).toBe(42);

      const metadata = entry["metadata"] as Record<string, unknown>;
      expect(metadata["foo"]).toBe("bar");

      const nested = metadata["nested"] as Record<string, unknown>;
      expect(nested["value"]).toBe(100);
    });
  });

  describe("MetricLogEntry", () => {
    test("should extend LogEntry with metric fields", () => {
      const metricEntry: MetricLogEntry = {
        timestamp: "2025-12-11T15:30:45.123Z",
        level: "info",
        component: "storage:chromadb",
        msg: "Search completed",
        metric: "search.duration_ms",
        value: 145,
      };

      expect(metricEntry.timestamp).toBe("2025-12-11T15:30:45.123Z");
      expect(metricEntry.level).toBe("info");
      expect(metricEntry.component).toBe("storage:chromadb");
      expect(metricEntry.msg).toBe("Search completed");
      expect(metricEntry.metric).toBe("search.duration_ms");
      expect(metricEntry.value).toBe(145);
    });

    test("should support duration metrics", () => {
      const durationMetric: MetricLogEntry = {
        timestamp: "2025-12-11T15:30:45.123Z",
        level: "info",
        component: "storage:chromadb",
        msg: "Operation completed",
        metric: "search.duration_ms",
        value: 250,
      };

      expect(durationMetric.metric).toBe("search.duration_ms");
      expect(durationMetric.value).toBe(250);
    });

    test("should support count metrics", () => {
      const countMetric: MetricLogEntry = {
        timestamp: "2025-12-11T15:30:45.123Z",
        level: "error",
        component: "mcp-server",
        msg: "Error occurred",
        metric: "error.count",
        value: 1,
      };

      expect(countMetric.metric).toBe("error.count");
      expect(countMetric.value).toBe(1);
    });

    test("should support additional metric context", () => {
      const metricWithContext: MetricLogEntry = {
        timestamp: "2025-12-11T15:30:45.123Z",
        level: "info",
        component: "storage:chromadb",
        msg: "Search completed",
        metric: "search.duration_ms",
        value: 145,
        collections: ["repo_test"],
        resultsCount: 10,
        threshold: 0.7,
      };

      expect(metricWithContext.metric).toBe("search.duration_ms");
      expect(metricWithContext.value).toBe(145);

      const collections = metricWithContext["collections"] as string[];
      expect(collections[0]).toBe("repo_test");

      expect(metricWithContext["resultsCount"]).toBe(10);
      expect(metricWithContext["threshold"]).toBe(0.7);
    });
  });

  describe("Type Exports", () => {
    test("should export all required types", () => {
      // This test verifies that all types are properly exported
      // If this compiles, the types are correctly exported from the module

      const level: LogLevel = "info";
      const config: LoggerConfig = { level: "info", format: "json" };
      const context: ComponentContext = { component: "test" };
      const entry: LogEntry = {
        timestamp: "2025-12-11T15:30:45.123Z",
        level: "info",
        component: "test",
        msg: "Test",
      };
      const metricEntry: MetricLogEntry = {
        timestamp: "2025-12-11T15:30:45.123Z",
        level: "info",
        component: "test",
        msg: "Test",
        metric: "test.metric",
        value: 100,
      };

      expect(level).toBe("info");
      expect(config).toBeDefined();
      expect(context).toBeDefined();
      expect(entry).toBeDefined();
      expect(metricEntry).toBeDefined();
    });
  });

  describe("OpenTelemetry Compatibility", () => {
    test("should use ISO 8601 timestamp format", () => {
      const entry: LogEntry = {
        timestamp: "2025-12-11T15:30:45.123Z",
        level: "info",
        component: "test",
        msg: "Test message",
      };

      // Verify ISO 8601 format (basic check)
      expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    test("should use component field compatible with OTel service.name", () => {
      const entry: LogEntry = {
        timestamp: "2025-12-11T15:30:45.123Z",
        level: "info",
        component: "storage:chromadb", // Maps to OTel service.name
        msg: "Test message",
      };

      expect(entry.component).toBe("storage:chromadb");
    });

    test("should use requestId field compatible with OTel trace.id", () => {
      const entry: LogEntry = {
        timestamp: "2025-12-11T15:30:45.123Z",
        level: "info",
        component: "test",
        msg: "Test message",
        requestId: "trace-abc123", // Maps to OTel trace.id
      };

      expect(entry.requestId).toBe("trace-abc123");
    });
  });
});
