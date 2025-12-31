/**
 * Claims Extractors Unit Tests
 *
 * Tests for IdP-specific claims extraction adapters.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import {
  AzureAdExtractor,
  Auth0Extractor,
  GenericExtractor,
  createClaimsExtractor,
} from "../../../../src/auth/user-mapping/extractors/index.js";
import type { UserMappingConfig } from "../../../../src/auth/user-mapping/user-mapping-types.js";
import { initializeLogger, resetLogger } from "../../../../src/logging/index.js";

const defaultConfig: UserMappingConfig = {
  enabled: true,
  idpType: "generic",
  groupClaimName: "groups",
  roleClaimName: "roles",
  enableFileWatcher: false,
  fileWatcherDebounceMs: 500,
};

// Initialize logger for all tests in this file
beforeAll(() => {
  initializeLogger({ level: "error", format: "json" });
});

afterAll(() => {
  resetLogger();
});

describe("AzureAdExtractor", () => {
  const extractor = new AzureAdExtractor();

  describe("extractGroups", () => {
    test("extracts groups from groups claim", () => {
      const claims = {
        sub: "user123",
        groups: ["group-guid-1", "group-guid-2"],
      };

      const groups = extractor.extractGroups(claims);
      expect(groups).toEqual(["group-guid-1", "group-guid-2"]);
    });

    test("extracts directory roles from wids claim", () => {
      const claims = {
        sub: "user123",
        wids: ["dir-role-1", "dir-role-2"],
      };

      const groups = extractor.extractGroups(claims);
      expect(groups).toEqual(["dir-role-1", "dir-role-2"]);
    });

    test("combines groups and wids claims", () => {
      const claims = {
        sub: "user123",
        groups: ["group-1"],
        wids: ["wid-1"],
      };

      const groups = extractor.extractGroups(claims);
      expect(groups).toHaveLength(2);
      expect(groups).toContain("group-1");
      expect(groups).toContain("wid-1");
    });

    test("deduplicates combined claims", () => {
      const claims = {
        sub: "user123",
        groups: ["same-id"],
        wids: ["same-id"],
      };

      const groups = extractor.extractGroups(claims);
      expect(groups).toEqual(["same-id"]);
    });

    test("returns empty array when no groups present", () => {
      const claims = { sub: "user123" };
      expect(extractor.extractGroups(claims)).toEqual([]);
    });
  });

  describe("extractRoles", () => {
    test("extracts roles from roles claim", () => {
      const claims = {
        sub: "user123",
        roles: ["Admin", "User"],
      };

      const roles = extractor.extractRoles(claims);
      expect(roles).toEqual(["Admin", "User"]);
    });

    test("returns empty array when no roles present", () => {
      const claims = { sub: "user123" };
      expect(extractor.extractRoles(claims)).toEqual([]);
    });
  });

  describe("extractEmail", () => {
    test("extracts from email claim", () => {
      const claims = {
        sub: "user123",
        email: "user@example.com",
      };

      expect(extractor.extractEmail(claims)).toBe("user@example.com");
    });

    test("falls back to preferred_username", () => {
      const claims = {
        sub: "user123",
        preferred_username: "user@company.com",
      };

      expect(extractor.extractEmail(claims)).toBe("user@company.com");
    });

    test("falls back to upn", () => {
      const claims = {
        sub: "user123",
        upn: "user@onmicrosoft.com",
      };

      expect(extractor.extractEmail(claims)).toBe("user@onmicrosoft.com");
    });

    test("normalizes email to lowercase", () => {
      const claims = {
        sub: "user123",
        email: "User@EXAMPLE.com",
      };

      expect(extractor.extractEmail(claims)).toBe("user@example.com");
    });

    test("returns undefined for invalid email format", () => {
      const claims = {
        sub: "user123",
        email: "not-an-email",
      };

      expect(extractor.extractEmail(claims)).toBeUndefined();
    });
  });

  describe("normalize", () => {
    test("normalizes all claims", () => {
      const claims = {
        sub: "user123",
        email: "User@Example.com",
        groups: ["group-1"],
        roles: ["role-1"],
      };

      const normalized = extractor.normalize(claims);

      expect(normalized.sub).toBe("user123");
      expect(normalized.email).toBe("user@example.com");
      expect(normalized.groups).toEqual(["group-1"]);
      expect(normalized.roles).toEqual(["role-1"]);
    });

    test("uses oid as fallback for sub", () => {
      const claims = {
        oid: "object-id-123",
        email: "user@example.com",
      };

      const normalized = extractor.normalize(claims);
      expect(normalized.sub).toBe("object-id-123");
    });

    test("throws when sub and oid are missing", () => {
      const claims = {
        email: "user@example.com",
      };

      expect(() => extractor.normalize(claims)).toThrow("Missing required 'sub' claim");
    });
  });
});

describe("Auth0Extractor", () => {
  const extractor = new Auth0Extractor();

  describe("extractGroups", () => {
    test("extracts from standard groups claim", () => {
      const claims = {
        sub: "auth0|user123",
        groups: ["admin", "users"],
      };

      expect(extractor.extractGroups(claims)).toEqual(["admin", "users"]);
    });

    test("extracts from namespaced groups claim", () => {
      const claims = {
        sub: "auth0|user123",
        "https://myapp.com/groups": ["group1", "group2"],
      };

      const groups = extractor.extractGroups(claims);
      expect(groups).toEqual(["group1", "group2"]);
    });

    test("returns empty array when no groups found", () => {
      const claims = { sub: "auth0|user123" };
      expect(extractor.extractGroups(claims)).toEqual([]);
    });
  });

  describe("extractRoles", () => {
    test("extracts from standard roles claim", () => {
      const claims = {
        sub: "auth0|user123",
        roles: ["admin"],
      };

      expect(extractor.extractRoles(claims)).toEqual(["admin"]);
    });

    test("extracts from namespaced roles claim", () => {
      const claims = {
        sub: "auth0|user123",
        "https://myapp.com/roles": ["editor"],
      };

      expect(extractor.extractRoles(claims)).toEqual(["editor"]);
    });

    test("falls back to permissions claim", () => {
      const claims = {
        sub: "auth0|user123",
        permissions: ["read:users", "write:users"],
      };

      expect(extractor.extractRoles(claims)).toEqual(["read:users", "write:users"]);
    });
  });

  describe("extractEmail", () => {
    test("extracts from email claim", () => {
      const claims = {
        sub: "auth0|user123",
        email: "User@Example.com",
      };

      expect(extractor.extractEmail(claims)).toBe("user@example.com");
    });

    test("returns undefined when email not present", () => {
      const claims = { sub: "auth0|user123" };
      expect(extractor.extractEmail(claims)).toBeUndefined();
    });
  });

  describe("normalize", () => {
    test("normalizes Auth0 claims", () => {
      const claims = {
        sub: "auth0|user123",
        email: "user@example.com",
        "https://myapp.com/groups": ["admins"],
        roles: ["editor"],
      };

      const normalized = extractor.normalize(claims);

      expect(normalized.sub).toBe("auth0|user123");
      expect(normalized.email).toBe("user@example.com");
      expect(normalized.groups).toEqual(["admins"]);
      expect(normalized.roles).toEqual(["editor"]);
    });
  });
});

describe("GenericExtractor", () => {
  describe("with default claim names", () => {
    const extractor = new GenericExtractor();

    test("extracts groups from groups claim", () => {
      const claims = {
        sub: "user123",
        groups: ["group1", "group2"],
      };

      expect(extractor.extractGroups(claims)).toEqual(["group1", "group2"]);
    });

    test("extracts roles from roles claim", () => {
      const claims = {
        sub: "user123",
        roles: ["admin"],
      };

      expect(extractor.extractRoles(claims)).toEqual(["admin"]);
    });

    test("returns configured claim names", () => {
      expect(extractor.getGroupClaimName()).toBe("groups");
      expect(extractor.getRoleClaimName()).toBe("roles");
    });
  });

  describe("with custom claim names", () => {
    const extractor = new GenericExtractor("team_memberships", "user_roles");

    test("extracts from custom group claim", () => {
      const claims = {
        sub: "user123",
        team_memberships: ["team-a", "team-b"],
      };

      expect(extractor.extractGroups(claims)).toEqual(["team-a", "team-b"]);
    });

    test("extracts from custom role claim", () => {
      const claims = {
        sub: "user123",
        user_roles: ["power_user"],
      };

      expect(extractor.extractRoles(claims)).toEqual(["power_user"]);
    });

    test("returns custom claim names", () => {
      expect(extractor.getGroupClaimName()).toBe("team_memberships");
      expect(extractor.getRoleClaimName()).toBe("user_roles");
    });
  });

  describe("extractEmail", () => {
    const extractor = new GenericExtractor();

    test("extracts from email claim", () => {
      const claims = {
        sub: "user123",
        email: "USER@Example.COM",
      };

      expect(extractor.extractEmail(claims)).toBe("user@example.com");
    });
  });

  describe("string array extraction", () => {
    const extractor = new GenericExtractor();

    test("handles array of strings", () => {
      const claims = {
        sub: "user123",
        groups: ["a", "b", "c"],
      };

      expect(extractor.extractGroups(claims)).toEqual(["a", "b", "c"]);
    });

    test("handles single string value", () => {
      const claims = {
        sub: "user123",
        groups: "single-group",
      };

      expect(extractor.extractGroups(claims)).toEqual(["single-group"]);
    });

    test("handles comma-separated string", () => {
      const claims = {
        sub: "user123",
        groups: "group1, group2, group3",
      };

      expect(extractor.extractGroups(claims)).toEqual(["group1", "group2", "group3"]);
    });

    test("trims whitespace from values", () => {
      const claims = {
        sub: "user123",
        groups: ["  spacy  ", "trimmed"],
      };

      expect(extractor.extractGroups(claims)).toEqual(["spacy", "trimmed"]);
    });

    test("handles empty string", () => {
      const claims = {
        sub: "user123",
        groups: "",
      };

      expect(extractor.extractGroups(claims)).toEqual([]);
    });

    test("handles null value", () => {
      const claims = {
        sub: "user123",
        groups: null,
      };

      expect(extractor.extractGroups(claims)).toEqual([]);
    });

    test("handles undefined value", () => {
      const claims = { sub: "user123" };
      expect(extractor.extractGroups(claims)).toEqual([]);
    });
  });
});

describe("createClaimsExtractor factory", () => {
  test("creates AzureAdExtractor for azure-ad type", () => {
    const config = { ...defaultConfig, idpType: "azure-ad" as const };
    const extractor = createClaimsExtractor("azure-ad", config);

    expect(extractor).toBeInstanceOf(AzureAdExtractor);
  });

  test("creates Auth0Extractor for auth0 type", () => {
    const config = { ...defaultConfig, idpType: "auth0" as const };
    const extractor = createClaimsExtractor("auth0", config);

    expect(extractor).toBeInstanceOf(Auth0Extractor);
  });

  test("creates GenericExtractor for generic type", () => {
    const config = { ...defaultConfig, idpType: "generic" as const };
    const extractor = createClaimsExtractor("generic", config);

    expect(extractor).toBeInstanceOf(GenericExtractor);
  });

  test("passes claim names to GenericExtractor", () => {
    const config = {
      ...defaultConfig,
      idpType: "generic" as const,
      groupClaimName: "custom_groups",
      roleClaimName: "custom_roles",
    };

    const extractor = createClaimsExtractor("generic", config) as GenericExtractor;

    expect(extractor.getGroupClaimName()).toBe("custom_groups");
    expect(extractor.getRoleClaimName()).toBe("custom_roles");
  });

  test("defaults to GenericExtractor for unknown type", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const extractor = createClaimsExtractor("unknown" as unknown as any, defaultConfig);
    expect(extractor).toBeInstanceOf(GenericExtractor);
  });
});
