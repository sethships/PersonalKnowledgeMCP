/**
 * Unit tests for logger factory
 *
 * Tests logger initialization, configuration, and component-scoped loggers.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  initializeLogger,
  getComponentLogger,
  getRootLogger,
  resetLogger,
  type LogLevel,
} from "../../../src/logging/index.js";

describe("Logger Factory", () => {
  // Clean up after each test to ensure isolation
  afterEach(() => {
    resetLogger();
  });

  describe("initializeLogger", () => {
    test("should initialize logger with JSON format", () => {
      expect(() => {
        initializeLogger({
          level: "info",
          format: "json",
        });
      }).not.toThrow();

      // Verify logger is initialized
      const logger = getRootLogger();
      expect(logger).toBeDefined();
    });

    test("should initialize logger with pretty format", () => {
      expect(() => {
        initializeLogger({
          level: "debug",
          format: "pretty",
        });
      }).not.toThrow();

      // Verify logger is initialized
      const logger = getRootLogger();
      expect(logger).toBeDefined();
    });

    test("should throw error if initialized twice", () => {
      initializeLogger({
        level: "info",
        format: "json",
      });

      expect(() => {
        initializeLogger({
          level: "debug",
          format: "json",
        });
      }).toThrow("Logger already initialized");
    });

    test("should accept all valid log levels", () => {
      const logLevels: LogLevel[] = ["fatal", "error", "warn", "info", "debug", "trace"];

      for (const level of logLevels) {
        resetLogger();
        expect(() => {
          initializeLogger({
            level,
            format: "json",
          });
        }).not.toThrow();
      }
    });
  });

  describe("getRootLogger", () => {
    test("should throw error if logger not initialized", () => {
      expect(() => {
        getRootLogger();
      }).toThrow("Logger not initialized");
    });

    test("should return logger after initialization", () => {
      initializeLogger({
        level: "info",
        format: "json",
      });

      const logger = getRootLogger();
      expect(logger).toBeDefined();
      expect(logger.info).toBeDefined();
      expect(logger.error).toBeDefined();
      expect(logger.warn).toBeDefined();
      expect(logger.debug).toBeDefined();
    });
  });

  describe("getComponentLogger", () => {
    beforeEach(() => {
      initializeLogger({
        level: "info",
        format: "json",
      });
    });

    test("should create component logger with component name", () => {
      const logger = getComponentLogger("test-component");
      expect(logger).toBeDefined();

      // Component loggers are Pino child loggers
      // They should have the same methods as the root logger
      expect(logger.info).toBeDefined();
      expect(logger.error).toBeDefined();
    });

    test("should create component logger with requestId", () => {
      const logger = getComponentLogger("test-component", "req-123");
      expect(logger).toBeDefined();
    });

    test("should create multiple component loggers independently", () => {
      const logger1 = getComponentLogger("component1");
      const logger2 = getComponentLogger("component2");
      const logger3 = getComponentLogger("component3", "req-456");

      expect(logger1).toBeDefined();
      expect(logger2).toBeDefined();
      expect(logger3).toBeDefined();
    });

    test("should throw if called before initialization", () => {
      resetLogger();

      expect(() => {
        getComponentLogger("test");
      }).toThrow("Logger not initialized");
    });
  });

  describe("resetLogger", () => {
    test("should allow re-initialization after reset", () => {
      initializeLogger({
        level: "info",
        format: "json",
      });

      resetLogger();

      expect(() => {
        initializeLogger({
          level: "debug",
          format: "pretty",
        });
      }).not.toThrow();
    });

    test("should make getRootLogger throw after reset", () => {
      initializeLogger({
        level: "info",
        format: "json",
      });

      resetLogger();

      expect(() => {
        getRootLogger();
      }).toThrow("Logger not initialized");
    });
  });

  describe("Silent log level", () => {
    test("should support silent level for tests", () => {
      expect(() => {
        initializeLogger({
          level: "silent",
          format: "json",
        });
      }).not.toThrow();

      const rootLogger = getRootLogger();
      expect(rootLogger.level).toBe("silent");
    });
  });

  describe("Log level configuration", () => {
    test("should respect configured log level", () => {
      // Initialize with info level
      initializeLogger({
        level: "info",
        format: "json",
      });

      const logger = getComponentLogger("test");
      const rootLogger = getRootLogger();

      // Verify logger has correct level
      expect(rootLogger.level).toBe("info");

      // Logger methods should exist
      expect(logger.info).toBeDefined();
      expect(logger.debug).toBeDefined();
      expect(logger.error).toBeDefined();
    });

    test("should configure logger with error level", () => {
      initializeLogger({
        level: "error",
        format: "json",
      });

      const rootLogger = getRootLogger();

      // Verify logger has error level
      expect(rootLogger.level).toBe("error");
    });

    test("should configure logger with debug level", () => {
      initializeLogger({
        level: "debug",
        format: "json",
      });

      const rootLogger = getRootLogger();

      // Verify logger has debug level
      expect(rootLogger.level).toBe("debug");
    });
  });
});
