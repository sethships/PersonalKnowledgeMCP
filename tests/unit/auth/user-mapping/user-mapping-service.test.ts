/**
 * User Mapping Service Unit Tests
 *
 * Tests for rule resolution and mapping logic.
 */

import { describe, test, expect, beforeAll, afterAll, mock } from "bun:test";
import { UserMappingServiceImpl } from "../../../../src/auth/user-mapping/user-mapping-service.js";
import type {
  UserMappingStore,
  UserMappingRule,
  NormalizedClaims,
  UserMappingConfig,
} from "../../../../src/auth/user-mapping/user-mapping-types.js";
import { UserMappingNotConfiguredError } from "../../../../src/auth/user-mapping/user-mapping-errors.js";
import { initializeLogger, resetLogger } from "../../../../src/logging/index.js";

// Mock store implementation
function createMockStore(rules: UserMappingRule[] = []): UserMappingStore {
  const callbacks = new Set<() => void>();

  return {
    loadRules: mock(async () => rules),
    saveRules: mock(async () => {}),
    getStoragePath: () => "/mock/path",
    invalidateCache: mock(() => {}),
    startWatcher: mock(() => {}),
    stopWatcher: mock(() => {}),
    isWatcherRunning: () => false,
    onRulesChanged: (callback: () => void) => callbacks.add(callback),
    offRulesChanged: (callback: () => void) => callbacks.delete(callback),
  };
}

// Helper to create test rules
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

// Default config
const defaultConfig: UserMappingConfig = {
  enabled: true,
  idpType: "generic",
  groupClaimName: "groups",
  roleClaimName: "roles",
  enableFileWatcher: false,
  fileWatcherDebounceMs: 500,
};

describe("UserMappingServiceImpl", () => {
  beforeAll(() => {
    initializeLogger({ level: "error", format: "json" });
  });

  afterAll(() => {
    resetLogger();
  });

  describe("resolveMapping", () => {
    test("throws when mapping is disabled", async () => {
      const store = createMockStore([]);
      const config = { ...defaultConfig, enabled: false };
      const service = new UserMappingServiceImpl(store, config);

      const claims: NormalizedClaims = {
        sub: "user123",
        email: "test@example.com",
        groups: [],
        roles: [],
      };

      // eslint-disable-next-line @typescript-eslint/await-thenable
      await expect(service.resolveMapping(claims)).rejects.toThrow(UserMappingNotConfiguredError);
    });

    test("returns defaults when no rules match", async () => {
      const store = createMockStore([]);
      const service = new UserMappingServiceImpl(store, defaultConfig, ["read"], ["public"]);

      const claims: NormalizedClaims = {
        sub: "user123",
        email: "unknown@example.com",
        groups: [],
        roles: [],
      };

      const result = await service.resolveMapping(claims);

      expect(result.isDefault).toBe(true);
      expect(result.scopes).toEqual(["read"]);
      expect(result.instanceAccess).toEqual(["public"]);
      expect(result.matchedRule).toBeNull();
      expect(result.matchedPattern).toBeNull();
    });

    test("matches exact email pattern", async () => {
      const rule = createTestRule({
        pattern: "admin@company.com",
        type: "email",
        scopes: ["read", "write", "admin"],
        instanceAccess: ["private", "work", "public"],
        priority: 100,
      });

      const store = createMockStore([rule]);
      const service = new UserMappingServiceImpl(store, defaultConfig);

      const claims: NormalizedClaims = {
        sub: "user123",
        email: "admin@company.com",
        groups: [],
        roles: [],
      };

      const result = await service.resolveMapping(claims);

      expect(result.isDefault).toBe(false);
      expect(result.scopes).toEqual(["read", "write", "admin"]);
      expect(result.instanceAccess).toEqual(["private", "work", "public"]);
      expect(result.matchedPattern).toBe("admin@company.com");
    });

    test("email matching is case-insensitive", async () => {
      const rule = createTestRule({
        pattern: "Admin@Company.Com",
        type: "email",
        scopes: ["admin"],
        priority: 100,
      });

      const store = createMockStore([rule]);
      const service = new UserMappingServiceImpl(store, defaultConfig);

      const claims: NormalizedClaims = {
        sub: "user123",
        email: "admin@company.com", // lowercase
        groups: [],
        roles: [],
      };

      const result = await service.resolveMapping(claims);
      expect(result.isDefault).toBe(false);
    });

    test("matches email wildcard pattern", async () => {
      const rule = createTestRule({
        pattern: "*@company.com",
        type: "email_wildcard",
        scopes: ["read", "write"],
        instanceAccess: ["work", "public"],
        priority: 50,
      });

      const store = createMockStore([rule]);
      const service = new UserMappingServiceImpl(store, defaultConfig);

      const claims: NormalizedClaims = {
        sub: "user123",
        email: "anyone@company.com",
        groups: [],
        roles: [],
      };

      const result = await service.resolveMapping(claims);

      expect(result.isDefault).toBe(false);
      expect(result.scopes).toEqual(["read", "write"]);
      expect(result.matchedPattern).toBe("*@company.com");
    });

    test("matches group pattern", async () => {
      const rule = createTestRule({
        pattern: "group:developers",
        type: "group",
        scopes: ["read", "write"],
        instanceAccess: ["work"],
        priority: 40,
      });

      const store = createMockStore([rule]);
      const service = new UserMappingServiceImpl(store, defaultConfig);

      const claims: NormalizedClaims = {
        sub: "user123",
        email: "user@example.com",
        groups: ["developers", "testers"],
        roles: [],
      };

      const result = await service.resolveMapping(claims);

      expect(result.isDefault).toBe(false);
      expect(result.matchedPattern).toBe("group:developers");
    });

    test("group matching is case-insensitive", async () => {
      const rule = createTestRule({
        pattern: "group:Developers",
        type: "group",
        scopes: ["write"],
        priority: 40,
      });

      const store = createMockStore([rule]);
      const service = new UserMappingServiceImpl(store, defaultConfig);

      const claims: NormalizedClaims = {
        sub: "user123",
        groups: ["developers"], // lowercase
        roles: [],
      };

      const result = await service.resolveMapping(claims);
      expect(result.isDefault).toBe(false);
    });

    test("matches role pattern", async () => {
      const rule = createTestRule({
        pattern: "role:admin",
        type: "role",
        scopes: ["read", "write", "admin"],
        instanceAccess: ["private", "work", "public"],
        priority: 60,
      });

      const store = createMockStore([rule]);
      const service = new UserMappingServiceImpl(store, defaultConfig);

      const claims: NormalizedClaims = {
        sub: "user123",
        groups: [],
        roles: ["admin", "user"],
      };

      const result = await service.resolveMapping(claims);

      expect(result.isDefault).toBe(false);
      expect(result.matchedPattern).toBe("role:admin");
    });

    test("matches default pattern", async () => {
      const rule = createTestRule({
        pattern: "*",
        type: "default",
        scopes: ["read"],
        instanceAccess: ["public"],
        priority: 0,
      });

      const store = createMockStore([rule]);
      const service = new UserMappingServiceImpl(store, defaultConfig);

      const claims: NormalizedClaims = {
        sub: "user123",
        groups: [],
        roles: [],
      };

      const result = await service.resolveMapping(claims);

      expect(result.isDefault).toBe(false); // Matched a rule, even if it's the default rule
      expect(result.matchedPattern).toBe("*");
    });

    test("respects priority order - highest priority wins", async () => {
      const lowPriorityRule = createTestRule({
        pattern: "*@company.com",
        type: "email_wildcard",
        scopes: ["read"],
        priority: 10,
      });

      const highPriorityRule = createTestRule({
        pattern: "vip@company.com",
        type: "email",
        scopes: ["read", "write", "admin"],
        priority: 100,
      });

      // Order in array doesn't matter - priority does
      const store = createMockStore([lowPriorityRule, highPriorityRule]);
      const service = new UserMappingServiceImpl(store, defaultConfig);

      const claims: NormalizedClaims = {
        sub: "user123",
        email: "vip@company.com",
        groups: [],
        roles: [],
      };

      const result = await service.resolveMapping(claims);

      expect(result.matchedPattern).toBe("vip@company.com");
      expect(result.scopes).toEqual(["read", "write", "admin"]);
    });

    test("skips disabled rules", async () => {
      const disabledRule = createTestRule({
        pattern: "admin@company.com",
        type: "email",
        scopes: ["admin"],
        priority: 100,
        enabled: false, // Disabled
      });

      const enabledRule = createTestRule({
        pattern: "*@company.com",
        type: "email_wildcard",
        scopes: ["read"],
        priority: 50,
        enabled: true,
      });

      const store = createMockStore([disabledRule, enabledRule]);
      const service = new UserMappingServiceImpl(store, defaultConfig);

      const claims: NormalizedClaims = {
        sub: "user123",
        email: "admin@company.com",
        groups: [],
        roles: [],
      };

      const result = await service.resolveMapping(claims);

      // Should match the wildcard, not the disabled exact match
      expect(result.matchedPattern).toBe("*@company.com");
    });

    test("returns default when email is not provided", async () => {
      const rule = createTestRule({
        pattern: "admin@company.com",
        type: "email",
        priority: 100,
      });

      const store = createMockStore([rule]);
      const service = new UserMappingServiceImpl(store, defaultConfig, ["read"], ["public"]);

      const claims: NormalizedClaims = {
        sub: "user123",
        // No email
        groups: [],
        roles: [],
      };

      const result = await service.resolveMapping(claims);

      expect(result.isDefault).toBe(true);
    });
  });

  describe("getAllRules", () => {
    test("returns all rules from store", async () => {
      const rules = [createTestRule(), createTestRule()];
      const store = createMockStore(rules);
      const service = new UserMappingServiceImpl(store, defaultConfig);

      const result = await service.getAllRules();

      expect(result).toHaveLength(2);
    });
  });

  describe("isReady", () => {
    test("returns false before first resolution", () => {
      const store = createMockStore([]);
      const service = new UserMappingServiceImpl(store, defaultConfig);

      expect(service.isReady()).toBe(false);
    });

    test("returns true after successful resolution", async () => {
      const store = createMockStore([]);
      const service = new UserMappingServiceImpl(store, defaultConfig);

      await service.resolveMapping({
        sub: "user123",
        groups: [],
        roles: [],
      });

      expect(service.isReady()).toBe(true);
    });
  });

  describe("reloadRules", () => {
    test("clears cache and reloads", async () => {
      const store = createMockStore([]);
      const service = new UserMappingServiceImpl(store, defaultConfig);

      await service.reloadRules();

      expect(store.loadRules).toHaveBeenCalled();
    });
  });
});
