/**
 * User Mapping Validation Schemas
 *
 * Zod schemas for validating mapping rules and configuration.
 *
 * @module auth/user-mapping/validation
 */

import { z } from "zod";
import { TokenScopeSchema, InstanceAccessSchema } from "../validation.js";

/**
 * Identity provider type validation
 */
export const IdpTypeSchema = z.enum(["azure-ad", "auth0", "generic"]);

/**
 * Mapping rule type validation
 */
export const MappingRuleTypeSchema = z.enum([
  "email",
  "email_wildcard",
  "group",
  "role",
  "default",
]);

/**
 * Email pattern validation
 *
 * Validates standard email format.
 */
export const EmailPatternSchema = z.string().email("Invalid email format");

/**
 * Email wildcard pattern validation
 *
 * Format: *@domain.tld
 *
 * @example "*@company.com"
 */
export const WildcardPatternSchema = z
  .string()
  .regex(
    /^\*@[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}$/,
    "Wildcard pattern must be *@domain.tld format"
  );

/**
 * Group pattern validation
 *
 * Format: group:name
 *
 * @example "group:developers"
 */
export const GroupPatternSchema = z
  .string()
  .regex(/^group:[a-zA-Z0-9_\-. ]+$/, "Group pattern must be group:name format");

/**
 * Role pattern validation
 *
 * Format: role:name
 *
 * @example "role:admin"
 */
export const RolePatternSchema = z
  .string()
  .regex(/^role:[a-zA-Z0-9_\-. ]+$/, "Role pattern must be role:name format");

/**
 * Default pattern validation
 *
 * Must be exactly "*"
 */
export const DefaultPatternSchema = z.literal("*");

/**
 * User mapping rule validation schema
 */
export const UserMappingRuleSchema = z
  .object({
    id: z.string().uuid("Rule ID must be a valid UUID"),

    pattern: z.string().min(1, "Pattern must not be empty").max(256, "Pattern too long"),

    type: MappingRuleTypeSchema,

    scopes: z.array(TokenScopeSchema).min(1, "At least one scope is required"),

    instanceAccess: z
      .array(InstanceAccessSchema)
      .min(1, "At least one instance access level is required"),

    priority: z
      .number()
      .int("Priority must be an integer")
      .min(0, "Priority must be non-negative")
      .max(1000, "Priority cannot exceed 1000"),

    description: z.string().max(500, "Description too long").optional(),

    enabled: z.boolean(),

    createdAt: z.string().datetime({ message: "createdAt must be ISO 8601 format" }),

    updatedAt: z.string().datetime({ message: "updatedAt must be ISO 8601 format" }),
  })
  .strict();

/**
 * User mapping store file format validation
 */
export const UserMappingStoreFileSchema = z.object({
  version: z.literal("1.0"),
  rules: z.array(UserMappingRuleSchema),
  lastModified: z.string().datetime({ message: "lastModified must be ISO 8601 format" }),
});

/**
 * User mapping configuration validation
 */
export const UserMappingConfigSchema = z.object({
  enabled: z.boolean(),
  idpType: IdpTypeSchema,
  groupClaimName: z.string().min(1).max(100),
  roleClaimName: z.string().min(1).max(100),
  enableFileWatcher: z.boolean(),
  fileWatcherDebounceMs: z.number().int().min(100).max(10000),
});

/**
 * Validate pattern matches its declared type
 *
 * @param pattern - The pattern to validate
 * @param type - The declared rule type
 * @returns Validation result with success flag and optional error
 */
export function validatePatternForType(
  pattern: string,
  type: string
): { success: boolean; error?: string } {
  switch (type) {
    case "email": {
      const result = EmailPatternSchema.safeParse(pattern);
      return result.success ? { success: true } : { success: false, error: result.error.message };
    }

    case "email_wildcard": {
      const result = WildcardPatternSchema.safeParse(pattern);
      return result.success ? { success: true } : { success: false, error: result.error.message };
    }

    case "group": {
      const result = GroupPatternSchema.safeParse(pattern);
      return result.success ? { success: true } : { success: false, error: result.error.message };
    }

    case "role": {
      const result = RolePatternSchema.safeParse(pattern);
      return result.success ? { success: true } : { success: false, error: result.error.message };
    }

    case "default": {
      const result = DefaultPatternSchema.safeParse(pattern);
      return result.success
        ? { success: true }
        : { success: false, error: "Default pattern must be '*'" };
    }

    default:
      return { success: false, error: `Unknown rule type: ${type}` };
  }
}

/**
 * Validation result for mapping rules
 */
export type MappingRuleValidationResult =
  | { success: true; data: ValidatedUserMappingRule }
  | { success: false; error: z.ZodError };

/**
 * Validate a complete mapping rule including pattern-type consistency
 *
 * @param rule - The rule to validate
 * @returns Validation result
 */
export function validateMappingRule(rule: unknown): MappingRuleValidationResult {
  // First validate the basic structure
  const baseResult = UserMappingRuleSchema.safeParse(rule);
  if (!baseResult.success) {
    return { success: false, error: baseResult.error };
  }

  // Then validate pattern matches type
  const patternValidation = validatePatternForType(baseResult.data.pattern, baseResult.data.type);
  if (!patternValidation.success) {
    return {
      success: false,
      error: new z.ZodError([
        {
          code: z.ZodIssueCode.custom,
          message: patternValidation.error || "Pattern does not match rule type",
          path: ["pattern"],
        },
      ]),
    };
  }

  return { success: true, data: baseResult.data };
}

// Inferred types
export type ValidatedUserMappingRule = z.infer<typeof UserMappingRuleSchema>;
export type ValidatedUserMappingStoreFile = z.infer<typeof UserMappingStoreFileSchema>;
export type ValidatedUserMappingConfig = z.infer<typeof UserMappingConfigSchema>;
