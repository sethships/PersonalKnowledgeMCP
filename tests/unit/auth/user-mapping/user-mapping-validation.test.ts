/**
 * User Mapping Validation Unit Tests
 *
 * Tests for Zod schemas and validation functions.
 */

import { describe, test, expect } from "bun:test";
import {
  IdpTypeSchema,
  MappingRuleTypeSchema,
  EmailPatternSchema,
  WildcardPatternSchema,
  GroupPatternSchema,
  RolePatternSchema,
  DefaultPatternSchema,
  UserMappingRuleSchema,
  UserMappingStoreFileSchema,
  validatePatternForType,
  validateMappingRule,
} from "../../../../src/auth/user-mapping/user-mapping-validation.js";

describe("IdpTypeSchema", () => {
  test("accepts valid IdP types", () => {
    expect(IdpTypeSchema.parse("azure-ad")).toBe("azure-ad");
    expect(IdpTypeSchema.parse("auth0")).toBe("auth0");
    expect(IdpTypeSchema.parse("generic")).toBe("generic");
  });

  test("rejects invalid IdP types", () => {
    expect(() => IdpTypeSchema.parse("okta")).toThrow();
    expect(() => IdpTypeSchema.parse("")).toThrow();
    expect(() => IdpTypeSchema.parse("AZURE-AD")).toThrow(); // Case sensitive
  });
});

describe("MappingRuleTypeSchema", () => {
  test("accepts valid rule types", () => {
    expect(MappingRuleTypeSchema.parse("email")).toBe("email");
    expect(MappingRuleTypeSchema.parse("email_wildcard")).toBe("email_wildcard");
    expect(MappingRuleTypeSchema.parse("group")).toBe("group");
    expect(MappingRuleTypeSchema.parse("role")).toBe("role");
    expect(MappingRuleTypeSchema.parse("default")).toBe("default");
  });

  test("rejects invalid rule types", () => {
    expect(() => MappingRuleTypeSchema.parse("unknown")).toThrow();
    expect(() => MappingRuleTypeSchema.parse("")).toThrow();
  });
});

describe("EmailPatternSchema", () => {
  test("accepts valid emails", () => {
    expect(EmailPatternSchema.parse("user@example.com")).toBe("user@example.com");
    expect(EmailPatternSchema.parse("admin@company.org")).toBe("admin@company.org");
    expect(EmailPatternSchema.parse("test.user@sub.domain.com")).toBe("test.user@sub.domain.com");
  });

  test("rejects invalid emails", () => {
    expect(() => EmailPatternSchema.parse("not-an-email")).toThrow();
    expect(() => EmailPatternSchema.parse("@example.com")).toThrow();
    expect(() => EmailPatternSchema.parse("user@")).toThrow();
    expect(() => EmailPatternSchema.parse("")).toThrow();
  });
});

describe("WildcardPatternSchema", () => {
  test("accepts valid wildcard patterns", () => {
    expect(WildcardPatternSchema.parse("*@example.com")).toBe("*@example.com");
    expect(WildcardPatternSchema.parse("*@sub.domain.org")).toBe("*@sub.domain.org");
    expect(WildcardPatternSchema.parse("*@company-name.co")).toBe("*@company-name.co");
  });

  test("rejects invalid wildcard patterns", () => {
    expect(() => WildcardPatternSchema.parse("user@example.com")).toThrow(); // Not a wildcard
    expect(() => WildcardPatternSchema.parse("*example.com")).toThrow(); // Missing @
    expect(() => WildcardPatternSchema.parse("*@")).toThrow(); // No domain
    expect(() => WildcardPatternSchema.parse("*@com")).toThrow(); // Too short TLD
    expect(() => WildcardPatternSchema.parse("")).toThrow();
  });
});

describe("GroupPatternSchema", () => {
  test("accepts valid group patterns", () => {
    expect(GroupPatternSchema.parse("group:developers")).toBe("group:developers");
    expect(GroupPatternSchema.parse("group:Team-Alpha")).toBe("group:Team-Alpha");
    expect(GroupPatternSchema.parse("group:admin_users")).toBe("group:admin_users");
    expect(GroupPatternSchema.parse("group:Group 1")).toBe("group:Group 1"); // Space allowed
  });

  test("rejects invalid group patterns", () => {
    expect(() => GroupPatternSchema.parse("developers")).toThrow(); // Missing prefix
    expect(() => GroupPatternSchema.parse("role:developers")).toThrow(); // Wrong prefix
    expect(() => GroupPatternSchema.parse("group:")).toThrow(); // Empty name
    expect(() => GroupPatternSchema.parse("")).toThrow();
  });
});

describe("RolePatternSchema", () => {
  test("accepts valid role patterns", () => {
    expect(RolePatternSchema.parse("role:admin")).toBe("role:admin");
    expect(RolePatternSchema.parse("role:Super-User")).toBe("role:Super-User");
    expect(RolePatternSchema.parse("role:power_user")).toBe("role:power_user");
  });

  test("rejects invalid role patterns", () => {
    expect(() => RolePatternSchema.parse("admin")).toThrow(); // Missing prefix
    expect(() => RolePatternSchema.parse("group:admin")).toThrow(); // Wrong prefix
    expect(() => RolePatternSchema.parse("role:")).toThrow(); // Empty name
    expect(() => RolePatternSchema.parse("")).toThrow();
  });
});

describe("DefaultPatternSchema", () => {
  test("accepts only '*'", () => {
    expect(DefaultPatternSchema.parse("*")).toBe("*");
  });

  test("rejects anything else", () => {
    expect(() => DefaultPatternSchema.parse("**")).toThrow();
    expect(() => DefaultPatternSchema.parse("any")).toThrow();
    expect(() => DefaultPatternSchema.parse("")).toThrow();
  });
});

describe("UserMappingRuleSchema", () => {
  const validRule = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    pattern: "user@example.com",
    type: "email",
    scopes: ["read"],
    instanceAccess: ["public"],
    priority: 50,
    description: "Test rule",
    enabled: true,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
  };

  test("accepts valid rules", () => {
    const result = UserMappingRuleSchema.safeParse(validRule);
    expect(result.success).toBe(true);
  });

  test("requires valid UUID for id", () => {
    const result = UserMappingRuleSchema.safeParse({
      ...validRule,
      id: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });

  test("requires at least one scope", () => {
    const result = UserMappingRuleSchema.safeParse({
      ...validRule,
      scopes: [],
    });
    expect(result.success).toBe(false);
  });

  test("requires at least one instance access", () => {
    const result = UserMappingRuleSchema.safeParse({
      ...validRule,
      instanceAccess: [],
    });
    expect(result.success).toBe(false);
  });

  test("validates priority bounds", () => {
    // Too low
    expect(
      UserMappingRuleSchema.safeParse({
        ...validRule,
        priority: -1,
      }).success
    ).toBe(false);

    // Too high
    expect(
      UserMappingRuleSchema.safeParse({
        ...validRule,
        priority: 1001,
      }).success
    ).toBe(false);

    // At bounds
    expect(
      UserMappingRuleSchema.safeParse({
        ...validRule,
        priority: 0,
      }).success
    ).toBe(true);

    expect(
      UserMappingRuleSchema.safeParse({
        ...validRule,
        priority: 1000,
      }).success
    ).toBe(true);
  });

  test("requires ISO 8601 dates", () => {
    expect(
      UserMappingRuleSchema.safeParse({
        ...validRule,
        createdAt: "not-a-date",
      }).success
    ).toBe(false);
  });

  test("description is optional", () => {
    const ruleWithoutDesc = { ...validRule };
    delete (ruleWithoutDesc as Record<string, unknown>)["description"];

    expect(UserMappingRuleSchema.safeParse(ruleWithoutDesc).success).toBe(true);
  });
});

describe("UserMappingStoreFileSchema", () => {
  test("accepts valid store file", () => {
    const storeFile = {
      version: "1.0",
      rules: [],
      lastModified: "2025-01-01T00:00:00.000Z",
    };

    expect(UserMappingStoreFileSchema.safeParse(storeFile).success).toBe(true);
  });

  test("requires version 1.0", () => {
    const storeFile = {
      version: "2.0",
      rules: [],
      lastModified: "2025-01-01T00:00:00.000Z",
    };

    expect(UserMappingStoreFileSchema.safeParse(storeFile).success).toBe(false);
  });
});

describe("validatePatternForType", () => {
  test("validates email patterns", () => {
    expect(validatePatternForType("user@example.com", "email").success).toBe(true);
    expect(validatePatternForType("not-email", "email").success).toBe(false);
  });

  test("validates email_wildcard patterns", () => {
    expect(validatePatternForType("*@example.com", "email_wildcard").success).toBe(true);
    expect(validatePatternForType("user@example.com", "email_wildcard").success).toBe(false);
  });

  test("validates group patterns", () => {
    expect(validatePatternForType("group:developers", "group").success).toBe(true);
    expect(validatePatternForType("developers", "group").success).toBe(false);
  });

  test("validates role patterns", () => {
    expect(validatePatternForType("role:admin", "role").success).toBe(true);
    expect(validatePatternForType("admin", "role").success).toBe(false);
  });

  test("validates default patterns", () => {
    expect(validatePatternForType("*", "default").success).toBe(true);
    expect(validatePatternForType("**", "default").success).toBe(false);
  });

  test("returns error for unknown type", () => {
    const result = validatePatternForType("something", "unknown");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown rule type");
  });
});

describe("validateMappingRule", () => {
  const validRule = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    pattern: "user@example.com",
    type: "email",
    scopes: ["read"],
    instanceAccess: ["public"],
    priority: 50,
    enabled: true,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
  };

  test("accepts valid rule with matching pattern", () => {
    const result = validateMappingRule(validRule);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.pattern).toBe("user@example.com");
    }
  });

  test("rejects rule with mismatched pattern and type", () => {
    const result = validateMappingRule({
      ...validRule,
      pattern: "not-an-email", // Invalid for email type
    });

    expect(result.success).toBe(false);
  });

  test("validates email_wildcard pattern matches type", () => {
    const wildcardRule = {
      ...validRule,
      pattern: "*@example.com",
      type: "email_wildcard",
    };

    expect(validateMappingRule(wildcardRule).success).toBe(true);
  });

  test("validates group pattern matches type", () => {
    const groupRule = {
      ...validRule,
      pattern: "group:developers",
      type: "group",
    };

    expect(validateMappingRule(groupRule).success).toBe(true);
  });

  test("validates role pattern matches type", () => {
    const roleRule = {
      ...validRule,
      pattern: "role:admin",
      type: "role",
    };

    expect(validateMappingRule(roleRule).success).toBe(true);
  });

  test("validates default pattern matches type", () => {
    const defaultRule = {
      ...validRule,
      pattern: "*",
      type: "default",
    };

    expect(validateMappingRule(defaultRule).success).toBe(true);
  });
});
