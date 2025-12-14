/**
 * Validation schemas for GitHub Client
 *
 * This module defines Zod schemas for validating GitHub API inputs.
 */

import { z } from "zod";

/**
 * Validation constants matching GitHub's actual limits
 */
const GITHUB_OWNER_MAX_LENGTH = 39;
const GITHUB_REPO_MAX_LENGTH = 100;
const GIT_REF_MAX_LENGTH = 255;
const TIMEOUT_MIN_MS = 1000;
const TIMEOUT_MAX_MS = 300000;
const TIMEOUT_DEFAULT_MS = 30000;
const MAX_RETRIES_LIMIT = 10;
const MAX_RETRIES_DEFAULT = 3;

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
  .max(GITHUB_OWNER_MAX_LENGTH, `Owner must be at most ${GITHUB_OWNER_MAX_LENGTH} characters`)
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
  .max(
    GITHUB_REPO_MAX_LENGTH,
    `Repository name must be at most ${GITHUB_REPO_MAX_LENGTH} characters`
  )
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
  .max(GIT_REF_MAX_LENGTH, `Git reference must be at most ${GIT_REF_MAX_LENGTH} characters`);

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
    .min(TIMEOUT_MIN_MS, `Timeout must be at least ${TIMEOUT_MIN_MS}ms`)
    .max(TIMEOUT_MAX_MS, `Timeout must be at most ${TIMEOUT_MAX_MS}ms`)
    .optional()
    .default(TIMEOUT_DEFAULT_MS),
  maxRetries: z
    .number()
    .int()
    .min(0, "Max retries must be non-negative")
    .max(MAX_RETRIES_LIMIT, `Max retries must be at most ${MAX_RETRIES_LIMIT}`)
    .optional()
    .default(MAX_RETRIES_DEFAULT),
});

/**
 * Inferred types from schemas
 */
export type ValidatedOwnerRepo = z.infer<typeof OwnerRepoSchema>;
export type ValidatedGetHeadCommit = z.infer<typeof GetHeadCommitSchema>;
export type ValidatedCompareCommits = z.infer<typeof CompareCommitsSchema>;
export type ValidatedGitHubClientConfig = z.infer<typeof GitHubClientConfigSchema>;
