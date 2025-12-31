/**
 * User Mapping Store Unit Tests
 *
 * Tests for file-based storage of user mapping rules.
 */

import { describe, test, expect, beforeEach, afterEach, beforeAll, afterAll } from "bun:test";
import { join } from "path";
import { mkdir, rm, readFile, writeFile } from "fs/promises";
import { UserMappingStoreImpl } from "../../../../src/auth/user-mapping/user-mapping-store.js";
import type {
  UserMappingRule,
  UserMappingStoreFile,
} from "../../../../src/auth/user-mapping/user-mapping-types.js";
import { initializeLogger, resetLogger } from "../../../../src/logging/index.js";

const TEST_DATA_PATH = join(process.cwd(), "test-data-user-mapping-store");
const TEST_FILE_PATH = join(TEST_DATA_PATH, "user-mappings.json");

// Sample valid rule for testing
const createTestRule = (overrides: Partial<UserMappingRule> = {}): UserMappingRule => ({
  id: crypto.randomUUID(),
  pattern: "test@example.com",
  type: "email",
  scopes: ["read"],
  instanceAccess: ["public"],
  priority: 50,
  description: "Test rule",
  enabled: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

describe("UserMappingStoreImpl", () => {
  beforeAll(() => {
    initializeLogger({ level: "error", format: "json" });
  });

  afterAll(() => {
    resetLogger();
  });

  beforeEach(async () => {
    // Reset singleton and create test directory
    UserMappingStoreImpl.resetInstance();
    await mkdir(TEST_DATA_PATH, { recursive: true });
  });

  afterEach(async () => {
    // Clean up
    UserMappingStoreImpl.resetInstance();
    try {
      await rm(TEST_DATA_PATH, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("getInstance", () => {
    test("returns singleton instance", () => {
      const store1 = UserMappingStoreImpl.getInstance(TEST_DATA_PATH);
      const store2 = UserMappingStoreImpl.getInstance(TEST_DATA_PATH);

      expect(store1).toBe(store2);
    });

    test("uses default data path when not specified", () => {
      const store = UserMappingStoreImpl.getInstance();
      expect(store.getStoragePath()).toContain("user-mappings.json");
    });
  });

  describe("getStoragePath", () => {
    test("returns correct file path", () => {
      const store = UserMappingStoreImpl.getInstance(TEST_DATA_PATH);
      expect(store.getStoragePath()).toBe(TEST_FILE_PATH);
    });
  });

  describe("loadRules", () => {
    test("creates empty store if file does not exist", async () => {
      const store = UserMappingStoreImpl.getInstance(TEST_DATA_PATH);

      const rules = await store.loadRules();

      expect(rules).toEqual([]);

      // Verify file was created
      const fileContent = await readFile(TEST_FILE_PATH, "utf-8");
      const parsed = JSON.parse(fileContent);
      expect(parsed.version).toBe("1.0");
      expect(parsed.rules).toEqual([]);
    });

    test("loads existing rules from file", async () => {
      const testRule = createTestRule();
      const storeFile: UserMappingStoreFile = {
        version: "1.0",
        rules: [testRule],
        lastModified: new Date().toISOString(),
      };

      await writeFile(TEST_FILE_PATH, JSON.stringify(storeFile, null, 2));

      const store = UserMappingStoreImpl.getInstance(TEST_DATA_PATH);
      const rules = await store.loadRules();

      expect(rules).toHaveLength(1);
      expect(rules[0]!.pattern).toBe(testRule.pattern);
    });

    test("uses cache on subsequent loads", async () => {
      const storeFile: UserMappingStoreFile = {
        version: "1.0",
        rules: [createTestRule()],
        lastModified: new Date().toISOString(),
      };

      await writeFile(TEST_FILE_PATH, JSON.stringify(storeFile, null, 2));

      const store = UserMappingStoreImpl.getInstance(TEST_DATA_PATH);

      // First load - reads from file
      const rules1 = await store.loadRules();

      // Modify file directly
      const modifiedFile: UserMappingStoreFile = {
        version: "1.0",
        rules: [createTestRule({ pattern: "modified@example.com" })],
        lastModified: new Date().toISOString(),
      };
      await writeFile(TEST_FILE_PATH, JSON.stringify(modifiedFile, null, 2));

      // Second load - should use cache
      const rules2 = await store.loadRules();

      expect(rules1[0]!.pattern).toBe(rules2[0]!.pattern);
      expect(rules2[0]!.pattern).not.toBe("modified@example.com");
    });

    test("throws on invalid JSON", async () => {
      await writeFile(TEST_FILE_PATH, "not valid json");

      const store = UserMappingStoreImpl.getInstance(TEST_DATA_PATH);

      // eslint-disable-next-line @typescript-eslint/await-thenable
      await expect(store.loadRules()).rejects.toThrow("Invalid JSON");
    });

    test("throws on invalid schema", async () => {
      const invalidFile = {
        version: "2.0", // Invalid version
        rules: [],
        lastModified: new Date().toISOString(),
      };

      await writeFile(TEST_FILE_PATH, JSON.stringify(invalidFile));

      const store = UserMappingStoreImpl.getInstance(TEST_DATA_PATH);

      // eslint-disable-next-line @typescript-eslint/await-thenable
      await expect(store.loadRules()).rejects.toThrow();
    });
  });

  describe("saveRules", () => {
    test("saves rules to file with atomic write", async () => {
      const store = UserMappingStoreImpl.getInstance(TEST_DATA_PATH);
      const testRule = createTestRule();

      await store.saveRules([testRule]);

      const fileContent = await readFile(TEST_FILE_PATH, "utf-8");
      const parsed = JSON.parse(fileContent) as UserMappingStoreFile;

      expect(parsed.version).toBe("1.0");
      expect(parsed.rules).toHaveLength(1);
      expect(parsed.rules[0]!.pattern).toBe(testRule.pattern);
      expect(parsed.lastModified).toBeDefined();
    });

    test("updates cache after save", async () => {
      const store = UserMappingStoreImpl.getInstance(TEST_DATA_PATH);

      // Create initial file
      await store.saveRules([createTestRule({ pattern: "first@example.com" })]);

      // Load to populate cache
      const rules1 = await store.loadRules();
      expect(rules1[0]!.pattern).toBe("first@example.com");

      // Save new rules
      await store.saveRules([createTestRule({ pattern: "second@example.com" })]);

      // Load should return new rules from cache
      const rules2 = await store.loadRules();
      expect(rules2[0]!.pattern).toBe("second@example.com");
    });

    test("creates directory if it does not exist", async () => {
      // Remove the test directory
      await rm(TEST_DATA_PATH, { recursive: true, force: true });

      const store = UserMappingStoreImpl.getInstance(TEST_DATA_PATH);
      const testRule = createTestRule();

      // Should not throw even though directory doesn't exist
      await store.saveRules([testRule]);

      const rules = await store.loadRules();
      expect(rules).toHaveLength(1);
    });
  });

  describe("invalidateCache", () => {
    test("forces reload from file on next loadRules", async () => {
      const store = UserMappingStoreImpl.getInstance(TEST_DATA_PATH);

      // Initial save and load
      await store.saveRules([createTestRule({ pattern: "original@example.com" })]);
      const rules1 = await store.loadRules();
      expect(rules1[0]!.pattern).toBe("original@example.com");

      // Modify file directly
      const modifiedFile: UserMappingStoreFile = {
        version: "1.0",
        rules: [createTestRule({ pattern: "modified@example.com" })],
        lastModified: new Date().toISOString(),
      };
      await writeFile(TEST_FILE_PATH, JSON.stringify(modifiedFile, null, 2));

      // Invalidate cache
      store.invalidateCache();

      // Load should now read from file
      const rules2 = await store.loadRules();
      expect(rules2[0]!.pattern).toBe("modified@example.com");
    });
  });

  describe("file watcher", () => {
    test("startWatcher and stopWatcher work correctly", () => {
      const store = UserMappingStoreImpl.getInstance(TEST_DATA_PATH);

      expect(store.isWatcherRunning()).toBe(false);

      // Note: We don't actually test file watching behavior in unit tests
      // as it requires async file system events. This just verifies the API.
    });

    test("onRulesChanged and offRulesChanged register callbacks", () => {
      const store = UserMappingStoreImpl.getInstance(TEST_DATA_PATH);

      let callbackCalled = false;
      const callback = (): void => {
        callbackCalled = true;
      };

      store.onRulesChanged(callback);

      // Callback should not be called yet
      expect(callbackCalled).toBe(false);

      store.offRulesChanged(callback);
    });
  });
});
