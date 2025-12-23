/**
 * Authentication Module Validation Schemas
 *
 * Zod schemas for validating token operations and persistence.
 *
 * @module auth/validation
 */

import { z } from "zod";

/**
 * Token prefix constant
 *
 * Format inspired by GitHub/Stripe patterns for easy identification.
 */
export const TOKEN_PREFIX = "pk_mcp_";

/**
 * Token scope validation
 */
export const TokenScopeSchema = z.enum(["read", "write", "admin"]);

/**
 * Instance access validation
 */
export const InstanceAccessSchema = z.enum(["private", "work", "public"]);

/**
 * Raw token format validation
 *
 * Format: pk_mcp_<32 hex characters>
 *
 * @example "pk_mcp_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"
 */
export const RawTokenSchema = z
  .string()
  .regex(/^pk_mcp_[a-f0-9]{32}$/, "Invalid token format. Expected: pk_mcp_<32 hex chars>");

/**
 * Token hash format validation (SHA-256 hex string)
 */
export const TokenHashSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Invalid token hash format. Expected: 64 hex chars");

/**
 * Token name validation
 *
 * - 1-100 characters
 * - Alphanumeric with spaces, hyphens, underscores, and periods
 */
export const TokenNameSchema = z
  .string()
  .trim()
  .min(1, "Token name must not be empty")
  .max(100, "Token name must not exceed 100 characters")
  .regex(
    /^[\w\s\-_.]+$/,
    "Token name can only contain letters, numbers, spaces, hyphens, underscores, and periods"
  );

/**
 * Token generation parameters validation
 */
export const GenerateTokenParamsSchema = z
  .object({
    name: TokenNameSchema,

    scopes: z.array(TokenScopeSchema).min(1, "At least one scope is required").default(["read"]),

    instanceAccess: z
      .array(InstanceAccessSchema)
      .min(1, "At least one instance access level is required")
      .default(["public"]),

    expiresInSeconds: z
      .number()
      .int("Expiration must be a whole number of seconds")
      .positive("Expiration must be positive")
      .max(31536000, "Expiration cannot exceed 1 year (31536000 seconds)")
      .nullable()
      .optional()
      .default(null),
  })
  .strict();

/**
 * Token metadata validation (for storage)
 */
export const TokenMetadataSchema = z.object({
  name: TokenNameSchema,
  createdAt: z.string().datetime({ message: "createdAt must be ISO 8601 format" }),
  expiresAt: z.string().datetime({ message: "expiresAt must be ISO 8601 format" }).nullable(),
  scopes: z.array(TokenScopeSchema).min(1),
  instanceAccess: z.array(InstanceAccessSchema).min(1),
  lastUsedAt: z.string().datetime({ message: "lastUsedAt must be ISO 8601 format" }).optional(),
  useCount: z.number().int().min(0).optional(),
});

/**
 * Stored token validation (for persistence)
 */
export const StoredTokenSchema = z.object({
  tokenHash: TokenHashSchema,
  metadata: TokenMetadataSchema,
  revoked: z.boolean(),
  revokedAt: z.string().datetime({ message: "revokedAt must be ISO 8601 format" }).optional(),
});

/**
 * Token store file format validation
 */
export const TokenStoreFileSchema = z.object({
  version: z.literal("1.0"),
  tokens: z.record(z.string(), StoredTokenSchema),
});

// Inferred types for use with validated data
export type ValidatedGenerateTokenParams = z.infer<typeof GenerateTokenParamsSchema>;
export type ValidatedTokenMetadata = z.infer<typeof TokenMetadataSchema>;
export type ValidatedStoredToken = z.infer<typeof StoredTokenSchema>;
export type ValidatedTokenStoreFile = z.infer<typeof TokenStoreFileSchema>;
