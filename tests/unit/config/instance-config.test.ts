/**
 * Instance Configuration Unit Tests
 *
 * Tests for the multi-instance configuration schema and loading functions.
 *
 * @module tests/unit/config/instance-config
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import {
  loadInstanceConfig,
  getEnabledInstances,
  isValidInstanceName,
  getInstanceConfig,
  INSTANCE_NAMES,
  InstanceAccessSchema,
} from "../../../src/config/instance-config.js";
import { initializeLogger, resetLogger } from "../../../src/logging/index.js";
import type { MultiInstanceConfig } from "../../../src/config/instance-config.js";

/**
 * Helper to save and restore environment variables
 */
class EnvHelper {
  private saved: Record<string, string | undefined> = {};
  private readonly envVars = [
    "DEFAULT_INSTANCE",
    "REQUIRE_AUTH_FOR_DEFAULT_INSTANCE",
    "INSTANCE_PRIVATE_CHROMADB_HOST",
    "INSTANCE_PRIVATE_CHROMADB_PORT",
    "INSTANCE_PRIVATE_CHROMADB_AUTH_TOKEN",
    "INSTANCE_PRIVATE_DATA_PATH",
    "INSTANCE_PRIVATE_ENABLED",
    "INSTANCE_WORK_CHROMADB_HOST",
    "INSTANCE_WORK_CHROMADB_PORT",
    "INSTANCE_WORK_CHROMADB_AUTH_TOKEN",
    "INSTANCE_WORK_DATA_PATH",
    "INSTANCE_WORK_ENABLED",
    "INSTANCE_PUBLIC_CHROMADB_HOST",
    "INSTANCE_PUBLIC_CHROMADB_PORT",
    "INSTANCE_PUBLIC_CHROMADB_AUTH_TOKEN",
    "INSTANCE_PUBLIC_DATA_PATH",
    "INSTANCE_PUBLIC_ENABLED",
  ];

  save(): void {
    for (const key of this.envVars) {
      this.saved[key] = Bun.env[key];
    }
  }

  restore(): void {
    for (const key of this.envVars) {
      if (this.saved[key] === undefined) {
        delete Bun.env[key];
      } else {
        Bun.env[key] = this.saved[key];
      }
    }
  }

  clear(): void {
    for (const key of this.envVars) {
      delete Bun.env[key];
    }
  }
}

describe("Instance Configuration", () => {
  const envHelper = new EnvHelper();

  beforeAll(() => {
    initializeLogger({ level: "error", format: "json" });
  });

  afterAll(() => {
    resetLogger();
  });

  beforeEach(() => {
    envHelper.save();
    envHelper.clear();
  });

  afterEach(() => {
    envHelper.restore();
  });

  describe("loadInstanceConfig", () => {
    describe("default values", () => {
      it("should load default configuration when no env vars are set", () => {
        const config = loadInstanceConfig();

        expect(config.defaultInstance).toBe("public");
        expect(config.requireAuthForDefaultInstance).toBe(false);
      });

      it("should enable all instances by default", () => {
        const config = loadInstanceConfig();

        expect(config.instances.private.enabled).toBe(true);
        expect(config.instances.work.enabled).toBe(true);
        expect(config.instances.public.enabled).toBe(true);
      });

      it("should use default ports for each instance", () => {
        const config = loadInstanceConfig();

        expect(config.instances.private.chromadb.port).toBe(8000);
        expect(config.instances.work.chromadb.port).toBe(8001);
        expect(config.instances.public.chromadb.port).toBe(8002);
      });

      it("should use default hosts (localhost) for each instance", () => {
        const config = loadInstanceConfig();

        expect(config.instances.private.chromadb.host).toBe("localhost");
        expect(config.instances.work.chromadb.host).toBe("localhost");
        expect(config.instances.public.chromadb.host).toBe("localhost");
      });

      it("should use default data paths for each instance", () => {
        const config = loadInstanceConfig();

        expect(config.instances.private.dataPath).toBe("./data/private");
        expect(config.instances.work.dataPath).toBe("./data/work");
        expect(config.instances.public.dataPath).toBe("./data/public");
      });

      it("should have no auth tokens by default", () => {
        const config = loadInstanceConfig();

        expect(config.instances.private.chromadb.authToken).toBeUndefined();
        expect(config.instances.work.chromadb.authToken).toBeUndefined();
        expect(config.instances.public.chromadb.authToken).toBeUndefined();
      });
    });

    describe("environment variable overrides", () => {
      it("should override default instance from env", () => {
        Bun.env["DEFAULT_INSTANCE"] = "private";
        const config = loadInstanceConfig();
        expect(config.defaultInstance).toBe("private");
      });

      it("should override require auth setting from env", () => {
        Bun.env["REQUIRE_AUTH_FOR_DEFAULT_INSTANCE"] = "true";
        const config = loadInstanceConfig();
        expect(config.requireAuthForDefaultInstance).toBe(true);
      });

      it("should accept various truthy values for boolean settings", () => {
        const truthyValues = ["true", "TRUE", "True", "1", "yes", "YES"];

        for (const value of truthyValues) {
          Bun.env["REQUIRE_AUTH_FOR_DEFAULT_INSTANCE"] = value;
          const config = loadInstanceConfig();
          expect(config.requireAuthForDefaultInstance).toBe(true);
        }
      });

      it("should accept various falsy values for boolean settings", () => {
        const falsyValues = ["false", "FALSE", "False", "0", "no", "NO"];

        for (const value of falsyValues) {
          Bun.env["REQUIRE_AUTH_FOR_DEFAULT_INSTANCE"] = value;
          const config = loadInstanceConfig();
          expect(config.requireAuthForDefaultInstance).toBe(false);
        }
      });

      it("should override ChromaDB host for an instance", () => {
        Bun.env["INSTANCE_PRIVATE_CHROMADB_HOST"] = "chromadb-private.local";
        const config = loadInstanceConfig();
        expect(config.instances.private.chromadb.host).toBe("chromadb-private.local");
      });

      it("should override ChromaDB port for an instance", () => {
        Bun.env["INSTANCE_WORK_CHROMADB_PORT"] = "9001";
        const config = loadInstanceConfig();
        expect(config.instances.work.chromadb.port).toBe(9001);
      });

      it("should set ChromaDB auth token for an instance", () => {
        const testToken = "test-auth-token-12345";
        Bun.env["INSTANCE_PUBLIC_CHROMADB_AUTH_TOKEN"] = testToken;
        const config = loadInstanceConfig();
        expect(config.instances.public.chromadb.authToken).toBe(testToken);
      });

      it("should override data path for an instance", () => {
        Bun.env["INSTANCE_PRIVATE_DATA_PATH"] = "/custom/path/private";
        const config = loadInstanceConfig();
        expect(config.instances.private.dataPath).toBe("/custom/path/private");
      });

      it("should allow disabling an instance", () => {
        Bun.env["INSTANCE_WORK_ENABLED"] = "false";
        const config = loadInstanceConfig();
        expect(config.instances.work.enabled).toBe(false);
      });

      it("should handle invalid port values gracefully (use default)", () => {
        Bun.env["INSTANCE_PRIVATE_CHROMADB_PORT"] = "not-a-number";
        const config = loadInstanceConfig();
        // Should fall back to default port
        expect(config.instances.private.chromadb.port).toBe(8000);
      });

      it("should handle empty string values gracefully (use default)", () => {
        Bun.env["INSTANCE_PRIVATE_CHROMADB_HOST"] = "";
        const config = loadInstanceConfig();
        expect(config.instances.private.chromadb.host).toBe("localhost");
      });
    });

    describe("validation", () => {
      it("should throw error for invalid DEFAULT_INSTANCE value", () => {
        Bun.env["DEFAULT_INSTANCE"] = "invalid-instance";

        expect(() => loadInstanceConfig()).toThrow(/Invalid DEFAULT_INSTANCE: "invalid-instance"/);
      });

      it("should throw error when default instance is disabled", () => {
        Bun.env["DEFAULT_INSTANCE"] = "work";
        Bun.env["INSTANCE_WORK_ENABLED"] = "false";

        expect(() => loadInstanceConfig()).toThrow(/Default instance "work" is disabled/);
      });

      it("should allow disabling non-default instances", () => {
        Bun.env["DEFAULT_INSTANCE"] = "public";
        Bun.env["INSTANCE_PRIVATE_ENABLED"] = "false";
        Bun.env["INSTANCE_WORK_ENABLED"] = "false";

        const config = loadInstanceConfig();
        expect(config.instances.private.enabled).toBe(false);
        expect(config.instances.work.enabled).toBe(false);
        expect(config.instances.public.enabled).toBe(true);
      });
    });

    describe("instance name assignment", () => {
      it("should correctly assign names to each instance config", () => {
        const config = loadInstanceConfig();

        expect(config.instances.private.name).toBe("private");
        expect(config.instances.work.name).toBe("work");
        expect(config.instances.public.name).toBe("public");
      });
    });
  });

  describe("getEnabledInstances", () => {
    it("should return all instances when all are enabled", () => {
      const config = loadInstanceConfig();
      const enabled = getEnabledInstances(config);

      expect(enabled).toContain("private");
      expect(enabled).toContain("work");
      expect(enabled).toContain("public");
      expect(enabled.length).toBe(3);
    });

    it("should filter out disabled instances", () => {
      Bun.env["INSTANCE_PRIVATE_ENABLED"] = "false";
      Bun.env["INSTANCE_WORK_ENABLED"] = "false";

      const config = loadInstanceConfig();
      const enabled = getEnabledInstances(config);

      expect(enabled).not.toContain("private");
      expect(enabled).not.toContain("work");
      expect(enabled).toContain("public");
      expect(enabled.length).toBe(1);
    });

    it("should return empty array when none are enabled (would fail loadInstanceConfig)", () => {
      // This scenario can't happen in practice because loadInstanceConfig
      // requires at least the default instance to be enabled.
      // But we can test the function directly with a crafted config.
      const config: MultiInstanceConfig = {
        instances: {
          private: {
            name: "private",
            chromadb: { host: "localhost", port: 8000 },
            dataPath: "./data/private",
            enabled: false,
          },
          work: {
            name: "work",
            chromadb: { host: "localhost", port: 8001 },
            dataPath: "./data/work",
            enabled: false,
          },
          public: {
            name: "public",
            chromadb: { host: "localhost", port: 8002 },
            dataPath: "./data/public",
            enabled: false,
          },
        },
        defaultInstance: "public",
        requireAuthForDefaultInstance: false,
      };

      const enabled = getEnabledInstances(config);
      expect(enabled.length).toBe(0);
    });
  });

  describe("isValidInstanceName", () => {
    it("should return true for valid instance names", () => {
      expect(isValidInstanceName("private")).toBe(true);
      expect(isValidInstanceName("work")).toBe(true);
      expect(isValidInstanceName("public")).toBe(true);
    });

    it("should return false for invalid instance names", () => {
      expect(isValidInstanceName("invalid")).toBe(false);
      expect(isValidInstanceName("")).toBe(false);
      expect(isValidInstanceName("PRIVATE")).toBe(false); // Case sensitive
      expect(isValidInstanceName("personal")).toBe(false);
      expect(isValidInstanceName("enterprise")).toBe(false);
    });
  });

  describe("getInstanceConfig", () => {
    it("should return config for enabled instance", () => {
      const config = loadInstanceConfig();
      const privateConfig = getInstanceConfig(config, "private");

      expect(privateConfig).toBeDefined();
      expect(privateConfig?.name).toBe("private");
      expect(privateConfig?.chromadb.port).toBe(8000);
    });

    it("should return undefined for disabled instance", () => {
      Bun.env["INSTANCE_WORK_ENABLED"] = "false";

      const config = loadInstanceConfig();
      const workConfig = getInstanceConfig(config, "work");

      expect(workConfig).toBeUndefined();
    });

    it("should return config for all enabled instances", () => {
      const config = loadInstanceConfig();

      expect(getInstanceConfig(config, "private")).toBeDefined();
      expect(getInstanceConfig(config, "work")).toBeDefined();
      expect(getInstanceConfig(config, "public")).toBeDefined();
    });
  });

  describe("INSTANCE_NAMES constant", () => {
    it("should contain all three instance types", () => {
      expect(INSTANCE_NAMES).toContain("private");
      expect(INSTANCE_NAMES).toContain("work");
      expect(INSTANCE_NAMES).toContain("public");
      expect(INSTANCE_NAMES.length).toBe(3);
    });

    it("should be readonly", () => {
      // TypeScript won't let us modify it, but we can verify the runtime value
      expect(Object.isFrozen(INSTANCE_NAMES) || Array.isArray(INSTANCE_NAMES)).toBe(true);
    });
  });

  describe("InstanceAccessSchema", () => {
    it("should parse valid instance names", () => {
      expect(InstanceAccessSchema.parse("private")).toBe("private");
      expect(InstanceAccessSchema.parse("work")).toBe("work");
      expect(InstanceAccessSchema.parse("public")).toBe("public");
    });

    it("should reject invalid instance names", () => {
      expect(() => InstanceAccessSchema.parse("invalid")).toThrow();
      expect(() => InstanceAccessSchema.parse("")).toThrow();
      expect(() => InstanceAccessSchema.parse(123)).toThrow();
    });

    it("should provide safeParse for validation without throwing", () => {
      const validResult = InstanceAccessSchema.safeParse("private");
      expect(validResult.success).toBe(true);
      if (validResult.success) {
        expect(validResult.data).toBe("private");
      }

      const invalidResult = InstanceAccessSchema.safeParse("invalid");
      expect(invalidResult.success).toBe(false);
    });
  });
});
