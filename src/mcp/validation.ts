/**
 * MCP input validation
 *
 * This module provides Zod schemas and validation functions for MCP tool arguments.
 * Validation happens at the MCP layer before calling the SearchService to enforce
 * MCP-specific constraints (e.g., character limits, parameter ranges).
 */

import { z } from "zod";
import { createValidationError } from "./errors.js";
import type {
  SemanticSearchArgs,
  GetDependenciesArgs,
  GetDependentsArgs,
  GetArchitectureArgs,
  FindPathArgs,
} from "./types.js";

/**
 * Zod schema for semantic_search tool arguments
 *
 * This schema:
 * - Enforces MCP tool contract (char limits, ranges)
 * - Provides default values for optional parameters
 * - Generates type-safe validation errors
 *
 * Aligns with the inputSchema in semantic_search tool definition.
 */
export const SemanticSearchArgsSchema = z
  .object({
    query: z
      .string()
      .trim()
      .min(1, "Query cannot be empty")
      .max(1000, "Query exceeds maximum length of 1000 characters"),

    limit: z
      .number()
      .int("Limit must be an integer")
      .min(1, "Limit must be at least 1")
      .max(50, "Limit cannot exceed 50")
      .optional()
      .default(10),

    threshold: z
      .number()
      .min(0.0, "Threshold must be between 0.0 and 1.0")
      .max(1.0, "Threshold must be between 0.0 and 1.0")
      .optional()
      .default(0.7),

    repository: z.string().trim().min(1, "Repository name cannot be empty").optional(),
  })
  .strict();

/**
 * Validates and parses semantic_search tool arguments
 *
 * This function:
 * - Validates arguments against SemanticSearchArgsSchema
 * - Applies default values for optional parameters
 * - Throws MCP InvalidParams error if validation fails
 *
 * @param args - Raw arguments from MCP CallTool request
 * @returns Validated and normalized arguments with defaults applied
 * @throws {McpError} If validation fails (ErrorCode.InvalidParams)
 *
 * @example
 * ```typescript
 * const args = validateSemanticSearchArgs({
 *   query: "find authentication code",
 *   limit: 20
 * });
 * // args.limit === 20
 * // args.threshold === 0.7 (default)
 * ```
 */
export function validateSemanticSearchArgs(args: unknown): SemanticSearchArgs {
  const result = SemanticSearchArgsSchema.safeParse(args);

  if (!result.success) {
    // Format Zod errors into human-readable message
    const errorMessage = result.error.issues
      .map((e) => {
        const path = e.path.length > 0 ? `${e.path.join(".")}: ` : "";
        return `${path}${e.message}`;
      })
      .join("; ");

    throw createValidationError(`Invalid semantic_search arguments: ${errorMessage}`);
  }

  return result.data;
}

/**
 * Valid relationship type strings for get_dependencies
 *
 * Maps from MCP tool schema strings to internal RelationshipType values.
 * The MCP tool uses lowercase strings while internal types use UPPER_CASE.
 */
export const DEPENDENCY_RELATIONSHIP_TYPES = [
  "imports",
  "calls",
  "extends",
  "implements",
  "references",
] as const;

/**
 * Zod schema for get_dependencies tool arguments
 *
 * This schema:
 * - Enforces MCP tool contract from PRD Section 6.1
 * - Validates entity_type enum values
 * - Validates depth range (1-5)
 * - Validates relationship_types array if provided
 * - Provides default values for optional parameters
 *
 * Aligns with the inputSchema in get_dependencies tool definition.
 */
export const GetDependenciesArgsSchema = z
  .object({
    entity_type: z.enum(["file", "function", "class"], {
      message: "entity_type must be one of: file, function, class",
    }),

    entity_path: z
      .string()
      .trim()
      .min(1, "Entity path cannot be empty")
      .max(500, "Entity path exceeds maximum length of 500 characters"),

    repository: z
      .string()
      .trim()
      .min(1, "Repository name cannot be empty")
      .max(200, "Repository name exceeds maximum length of 200 characters"),

    depth: z
      .number()
      .int("Depth must be an integer")
      .min(1, "Depth must be at least 1")
      .max(5, "Depth cannot exceed 5")
      .optional()
      .default(1),

    relationship_types: z
      .array(
        z.enum(DEPENDENCY_RELATIONSHIP_TYPES, {
          message: `relationship_types must be one of: ${DEPENDENCY_RELATIONSHIP_TYPES.join(", ")}`,
        })
      )
      .optional(),
  })
  .strict();

/**
 * Validates and parses get_dependencies tool arguments
 *
 * This function:
 * - Validates arguments against GetDependenciesArgsSchema
 * - Applies default values for optional parameters
 * - Throws MCP InvalidParams error if validation fails
 *
 * @param args - Raw arguments from MCP CallTool request
 * @returns Validated and normalized arguments with defaults applied
 * @throws {McpError} If validation fails (ErrorCode.InvalidParams)
 *
 * @example
 * ```typescript
 * const args = validateGetDependenciesArgs({
 *   entity_type: "file",
 *   entity_path: "src/services/auth.ts",
 *   repository: "my-project",
 *   depth: 2
 * });
 * // args.depth === 2
 * // args.relationship_types === undefined (all types)
 * ```
 */
export function validateGetDependenciesArgs(args: unknown): GetDependenciesArgs {
  const result = GetDependenciesArgsSchema.safeParse(args);

  if (!result.success) {
    // Format Zod errors into human-readable message
    const errorMessage = result.error.issues
      .map((e) => {
        const path = e.path.length > 0 ? `${e.path.join(".")}: ` : "";
        return `${path}${e.message}`;
      })
      .join("; ");

    throw createValidationError(`Invalid get_dependencies arguments: ${errorMessage}`);
  }

  return result.data;
}

/**
 * Valid entity type strings for get_dependents
 *
 * Includes "package" in addition to the standard entity types,
 * enabling impact analysis across package boundaries.
 */
export const DEPENDENT_ENTITY_TYPES = ["file", "function", "class", "package"] as const;

/**
 * Zod schema for get_dependents tool arguments
 *
 * This schema:
 * - Enforces MCP tool contract from PRD Section 6.1 (Tool 2)
 * - Validates entity_type enum values (includes "package")
 * - Makes repository OPTIONAL (search all if omitted)
 * - Validates depth range (1-5)
 * - Provides default values for optional parameters
 *
 * Key differences from get_dependencies:
 * - repository is optional (enables cross-repo search)
 * - entity_type includes "package"
 * - include_cross_repo parameter for multi-repo impact analysis
 *
 * Aligns with the inputSchema in get_dependents tool definition.
 */
export const GetDependentsArgsSchema = z
  .object({
    entity_type: z.enum(DEPENDENT_ENTITY_TYPES, {
      message: "entity_type must be one of: file, function, class, package",
    }),

    entity_path: z
      .string()
      .trim()
      .min(1, "Entity path cannot be empty")
      .max(500, "Entity path exceeds maximum length of 500 characters"),

    repository: z
      .string()
      .trim()
      .min(1, "Repository name cannot be empty")
      .max(200, "Repository name exceeds maximum length of 200 characters")
      .optional(),

    depth: z
      .number()
      .int("Depth must be an integer")
      .min(1, "Depth must be at least 1")
      .max(5, "Depth cannot exceed 5")
      .optional()
      .default(1),

    include_cross_repo: z.boolean().optional().default(false),
  })
  .strict();

/**
 * Validates and parses get_dependents tool arguments
 *
 * This function:
 * - Validates arguments against GetDependentsArgsSchema
 * - Applies default values for optional parameters
 * - Throws MCP InvalidParams error if validation fails
 *
 * @param args - Raw arguments from MCP CallTool request
 * @returns Validated and normalized arguments with defaults applied
 * @throws {McpError} If validation fails (ErrorCode.InvalidParams)
 *
 * @example
 * ```typescript
 * const args = validateGetDependentsArgs({
 *   entity_type: "function",
 *   entity_path: "validateToken",
 *   depth: 2,
 *   include_cross_repo: true
 * });
 * // args.repository === undefined (search all repos)
 * // args.depth === 2
 * // args.include_cross_repo === true
 * ```
 */
export function validateGetDependentsArgs(args: unknown): GetDependentsArgs {
  const result = GetDependentsArgsSchema.safeParse(args);

  if (!result.success) {
    // Format Zod errors into human-readable message
    const errorMessage = result.error.issues
      .map((e) => {
        const path = e.path.length > 0 ? `${e.path.join(".")}: ` : "";
        return `${path}${e.message}`;
      })
      .join("; ");

    throw createValidationError(`Invalid get_dependents arguments: ${errorMessage}`);
  }

  return result.data;
}

/**
 * Valid detail level strings for get_architecture
 *
 * Controls the granularity of the architectural overview returned.
 * - packages: High-level package/module structure only
 * - modules: Packages and their internal modules (default)
 * - files: Full file listing within modules
 * - entities: Individual functions, classes, and definitions within files
 */
export const ARCHITECTURE_DETAIL_LEVELS = ["packages", "modules", "files", "entities"] as const;

/**
 * Zod schema for get_architecture tool arguments
 *
 * This schema:
 * - Enforces MCP tool contract from PRD Section 6.1 (Tool 3)
 * - Validates detail_level enum values
 * - Validates repository and scope strings
 * - Provides default values for optional parameters
 *
 * Aligns with the inputSchema in get_architecture tool definition.
 */
export const GetArchitectureArgsSchema = z
  .object({
    repository: z
      .string()
      .trim()
      .min(1, "Repository name cannot be empty")
      .max(200, "Repository name exceeds maximum length of 200 characters"),

    scope: z
      .string()
      .trim()
      .min(1, "Scope cannot be empty")
      .max(500, "Scope exceeds maximum length of 500 characters")
      .optional(),

    detail_level: z.enum(ARCHITECTURE_DETAIL_LEVELS, {
      message: `detail_level must be one of: ${ARCHITECTURE_DETAIL_LEVELS.join(", ")}`,
    }),

    include_external: z.boolean().optional().default(false),
  })
  .strict();

/**
 * Validates and parses get_architecture tool arguments
 *
 * This function:
 * - Validates arguments against GetArchitectureArgsSchema
 * - Applies default values for optional parameters
 * - Throws MCP InvalidParams error if validation fails
 *
 * @param args - Raw arguments from MCP CallTool request
 * @returns Validated and normalized arguments with defaults applied
 * @throws {McpError} If validation fails (ErrorCode.InvalidParams)
 *
 * @example
 * ```typescript
 * const args = validateGetArchitectureArgs({
 *   repository: "my-project",
 *   detail_level: "modules"
 * });
 * // args.scope === undefined (full repository)
 * // args.include_external === false (default)
 * ```
 */
export function validateGetArchitectureArgs(args: unknown): GetArchitectureArgs {
  const result = GetArchitectureArgsSchema.safeParse(args);

  if (!result.success) {
    // Format Zod errors into human-readable message
    const errorMessage = result.error.issues
      .map((e) => {
        const path = e.path.length > 0 ? `${e.path.join(".")}: ` : "";
        return `${path}${e.message}`;
      })
      .join("; ");

    throw createValidationError(`Invalid get_architecture arguments: ${errorMessage}`);
  }

  return result.data;
}

/**
 * Zod schema for find_path tool arguments
 *
 * This schema:
 * - Enforces MCP tool contract from PRD Section 6.1 (Tool 4)
 * - Validates from_entity and to_entity strings
 * - Validates max_hops range (1-20)
 * - Validates relationship_types array if provided
 * - Provides default values for optional parameters
 *
 * Aligns with the inputSchema in find_path tool definition.
 */
export const FindPathArgsSchema = z
  .object({
    from_entity: z
      .string()
      .trim()
      .min(1, "from_entity cannot be empty")
      .max(500, "from_entity exceeds maximum length of 500 characters"),

    to_entity: z
      .string()
      .trim()
      .min(1, "to_entity cannot be empty")
      .max(500, "to_entity exceeds maximum length of 500 characters"),

    repository: z
      .string()
      .trim()
      .min(1, "Repository name cannot be empty")
      .max(200, "Repository name exceeds maximum length of 200 characters"),

    max_hops: z
      .number()
      .int("max_hops must be an integer")
      .min(1, "max_hops must be at least 1")
      .max(20, "max_hops cannot exceed 20")
      .optional()
      .default(10),

    relationship_types: z
      .array(
        z.enum(DEPENDENCY_RELATIONSHIP_TYPES, {
          message: `relationship_types must be one of: ${DEPENDENCY_RELATIONSHIP_TYPES.join(", ")}`,
        })
      )
      .optional(),
  })
  .strict();

/**
 * Validates and parses find_path tool arguments
 *
 * This function:
 * - Validates arguments against FindPathArgsSchema
 * - Applies default values for optional parameters
 * - Throws MCP InvalidParams error if validation fails
 *
 * @param args - Raw arguments from MCP CallTool request
 * @returns Validated and normalized arguments with defaults applied
 * @throws {McpError} If validation fails (ErrorCode.InvalidParams)
 *
 * @example
 * ```typescript
 * const args = validateFindPathArgs({
 *   from_entity: "src/routes/api.ts::handleLogin",
 *   to_entity: "src/db/users.ts::findUser",
 *   repository: "my-api",
 *   max_hops: 5
 * });
 * // args.max_hops === 5
 * // args.relationship_types === undefined (all types)
 * ```
 */
export function validateFindPathArgs(args: unknown): FindPathArgs {
  const result = FindPathArgsSchema.safeParse(args);

  if (!result.success) {
    // Format Zod errors into human-readable message
    const errorMessage = result.error.issues
      .map((e) => {
        const path = e.path.length > 0 ? `${e.path.join(".")}: ` : "";
        return `${path}${e.message}`;
      })
      .join("; ");

    throw createValidationError(`Invalid find_path arguments: ${errorMessage}`);
  }

  return result.data;
}
