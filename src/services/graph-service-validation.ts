/**
 * @module services/graph-service-validation
 *
 * Zod validation schemas for GraphService query inputs.
 *
 * This module provides strict validation for all GraphService query types,
 * following the pattern established by SearchQuerySchema in validation.ts.
 */

import { z } from "zod";
import { RelationshipType } from "../graph/types.js";

// =============================================================================
// Shared Schemas
// =============================================================================

/**
 * Entity type enum schema
 */
export const EntityTypeSchema = z.enum(["file", "function", "class"]);

/**
 * Detail level enum schema for architecture queries
 */
export const DetailLevelSchema = z.enum(["packages", "modules", "files", "entities"]);

/**
 * Relationship type schema (validates against RelationshipType enum values)
 */
const relationshipTypeValues = Object.values(RelationshipType) as [string, ...string[]];
export const RelationshipTypeSchema = z.enum(relationshipTypeValues);

/**
 * Non-empty string schema for required string fields
 */
const nonEmptyString = (fieldName: string): z.ZodString =>
  z.string().trim().min(1, `${fieldName} must not be empty`);

/**
 * Depth validation schema (1-5)
 */
const depthSchema = z
  .number()
  .int("Depth must be an integer")
  .min(1, "Depth must be at least 1")
  .max(5, "Depth must not exceed 5")
  .default(1);

/**
 * Max hops validation schema (1-20)
 */
const maxHopsSchema = z
  .number()
  .int("Max hops must be an integer")
  .min(1, "Max hops must be at least 1")
  .max(20, "Max hops must not exceed 20")
  .default(5);

// =============================================================================
// Query Schemas
// =============================================================================

/**
 * Validation schema for DependencyQuery
 *
 * @example
 * ```typescript
 * const validated = DependencyQuerySchema.parse({
 *   entity_type: "file",
 *   entity_path: "src/services/auth.ts",
 *   repository: "my-project",
 * });
 * ```
 */
export const DependencyQuerySchema = z
  .object({
    entity_type: EntityTypeSchema,
    entity_path: nonEmptyString("Entity path"),
    repository: nonEmptyString("Repository"),
    depth: depthSchema,
    relationship_types: z.array(RelationshipTypeSchema).optional(),
    include_transitive: z.boolean().default(false),
  })
  .strict();

/**
 * Validation schema for DependentQuery
 *
 * @example
 * ```typescript
 * const validated = DependentQuerySchema.parse({
 *   entity_type: "function",
 *   entity_path: "validateToken",
 *   depth: 2,
 * });
 * ```
 */
export const DependentQuerySchema = z
  .object({
    entity_type: EntityTypeSchema,
    entity_path: nonEmptyString("Entity path"),
    repository: z.string().trim().min(1).optional(),
    depth: depthSchema,
    include_cross_repo: z.boolean().default(false),
  })
  .strict();

/**
 * Entity reference schema for path queries
 */
export const EntityReferenceSchema = z.object({
  type: EntityTypeSchema,
  path: nonEmptyString("Path"),
  repository: nonEmptyString("Repository"),
});

/**
 * Validation schema for PathQuery
 *
 * @example
 * ```typescript
 * const validated = PathQuerySchema.parse({
 *   from_entity: { type: "function", path: "handleRequest", repository: "api" },
 *   to_entity: { type: "function", path: "queryDatabase", repository: "api" },
 * });
 * ```
 */
export const PathQuerySchema = z
  .object({
    from_entity: EntityReferenceSchema,
    to_entity: EntityReferenceSchema,
    max_hops: maxHopsSchema,
    relationship_types: z.array(RelationshipTypeSchema).optional(),
  })
  .strict();

/**
 * Validation schema for ArchitectureQuery
 *
 * @example
 * ```typescript
 * const validated = ArchitectureQuerySchema.parse({
 *   repository: "my-project",
 *   detail_level: "modules",
 * });
 * ```
 */
export const ArchitectureQuerySchema = z
  .object({
    repository: nonEmptyString("Repository"),
    scope: z.string().trim().min(1).optional(),
    detail_level: DetailLevelSchema,
    include_external: z.boolean().default(false),
  })
  .strict();

// =============================================================================
// Validated Types
// =============================================================================

/**
 * Validated DependencyQuery after schema parsing
 */
export type ValidatedDependencyQuery = z.infer<typeof DependencyQuerySchema>;

/**
 * Validated DependentQuery after schema parsing
 */
export type ValidatedDependentQuery = z.infer<typeof DependentQuerySchema>;

/**
 * Validated PathQuery after schema parsing
 */
export type ValidatedPathQuery = z.infer<typeof PathQuerySchema>;

/**
 * Validated ArchitectureQuery after schema parsing
 */
export type ValidatedArchitectureQuery = z.infer<typeof ArchitectureQuerySchema>;

/**
 * Validated EntityReference after schema parsing
 */
export type ValidatedEntityReference = z.infer<typeof EntityReferenceSchema>;
