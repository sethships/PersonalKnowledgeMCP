/**
 * Validation schemas for GitHub Client
 *
 * This module defines Zod schemas for validating GitHub API inputs.
 */

import { z } from "zod";

/**
 * GitHub username/organization name validation
 *
 * Rules:
 * - 1-39 characters
 * - Alphanumeric or hyphen
 * - Cannot start or end with hyphen
 * - Cannot have consecutive hyphens
 */
export const GitHubOwnerSchema = z
  .string()
  .min(1, "Owner is required")
  .max(39, "Owner must be at most 39 characters")
  .regex(
    /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/,
    "Invalid GitHub username or organization name"
  );

/**
 * GitHub repository name validation
 *
 * Rules:
 * - 1-100 characters
 * - Alphanumeric, hyphen, underscore, or period
 */
export const GitHubRepoSchema = z
  .string()
  .min(1, "Repository name is required")
  .max(100, "Repository name must be at most 100 characters")
  .regex(/^[\w.-]+$/, "Invalid repository name");

/**
 * Git ref (branch name or SHA) validation
 *
 * Rules:
 * - 1-255 characters
 * - Cannot be empty
 */
export const GitRefSchema = z
  .string()
  .min(1, "Git reference is required")
  .max(255, "Git reference must be at most 255 characters");

/**
 * Schema for owner/repo pair
 */
export const OwnerRepoSchema = z.object({
  owner: GitHubOwnerSchema,
  repo: GitHubRepoSchema,
});

/**
 * Schema for getHeadCommit parameters
 */
export const GetHeadCommitSchema = OwnerRepoSchema.extend({
  branch: GitRefSchema.optional(),
});

/**
 * Schema for compareCommits parameters
 */
export const CompareCommitsSchema = OwnerRepoSchema.extend({
  base: GitRefSchema,
  head: GitRefSchema,
});

/**
 * Schema for GitHub client configuration
 */
export const GitHubClientConfigSchema = z.object({
  token: z.string().optional(),
  baseUrl: z.string().url("Invalid base URL").optional().default("https://api.github.com"),
  timeoutMs: z
    .number()
    .int()
    .min(1000, "Timeout must be at least 1000ms")
    .max(300000, "Timeout must be at most 300000ms")
    .optional()
    .default(30000),
  maxRetries: z
    .number()
    .int()
    .min(0, "Max retries must be non-negative")
    .max(10, "Max retries must be at most 10")
    .optional()
    .default(3),
});

/**
 * Inferred types from schemas
 */
export type ValidatedOwnerRepo = z.infer<typeof OwnerRepoSchema>;
export type ValidatedGetHeadCommit = z.infer<typeof GetHeadCommitSchema>;
export type ValidatedCompareCommits = z.infer<typeof CompareCommitsSchema>;
export type ValidatedGitHubClientConfig = z.infer<typeof GitHubClientConfigSchema>;
