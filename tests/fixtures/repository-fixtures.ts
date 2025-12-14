/**
 * Test fixtures for repository metadata
 *
 * Provides factory functions for creating test repository metadata objects
 * with sensible defaults and customizable fields.
 *
 * @module tests/fixtures/repository-fixtures
 */

import type { RepositoryInfo, RepositoryStatus } from "../../src/repositories/types.js";
import { sanitizeCollectionName } from "../../src/repositories/metadata-store.js";

/**
 * Create a test repository metadata object with sensible defaults
 *
 * Generates a complete RepositoryInfo object with realistic test data.
 * All fields can be overridden via the overrides parameter.
 *
 * @param name - Repository identifier (used as base for URL, path, etc.)
 * @param overrides - Partial RepositoryInfo to override defaults
 * @returns Complete RepositoryInfo object for testing
 *
 * @example
 * ```typescript
 * // Basic usage with defaults
 * const repo = createTestRepositoryInfo("my-api");
 *
 * // With custom fields
 * const repo = createTestRepositoryInfo("frontend", {
 *   status: "indexing",
 *   fileCount: 200,
 *   branch: "develop"
 * });
 * ```
 */
export function createTestRepositoryInfo(
  name: string,
  overrides?: Partial<RepositoryInfo>
): RepositoryInfo {
  const defaultUrl = `https://github.com/test-user/${name}.git`;
  const defaultLocalPath = `./data/repos/${name}`;
  const defaultCollectionName = sanitizeCollectionName(name);

  return {
    name,
    url: defaultUrl,
    localPath: defaultLocalPath,
    collectionName: defaultCollectionName,
    fileCount: 100,
    chunkCount: 300,
    lastIndexedAt: new Date("2024-12-11T10:00:00.000Z").toISOString(),
    indexDurationMs: 5000,
    status: "ready" as RepositoryStatus,
    branch: "main",
    includeExtensions: [".ts", ".js", ".md"],
    excludePatterns: ["node_modules/**", "dist/**", ".git/**"],
    ...overrides,
  };
}

/**
 * Create a batch of test repository metadata objects
 *
 * Generates multiple repository objects with unique names and varied characteristics.
 * Useful for testing pagination, listing, and bulk operations.
 *
 * @param count - Number of repository objects to create
 * @param namePrefix - Prefix for generated repository names (default: "test-repo")
 * @returns Array of RepositoryInfo objects
 *
 * @example
 * ```typescript
 * // Create 10 test repositories
 * const repos = createTestRepositoryBatch(10);
 *
 * // Create with custom prefix
 * const repos = createTestRepositoryBatch(5, "project");
 * // Creates: project-0, project-1, ..., project-4
 * ```
 */
export function createTestRepositoryBatch(
  count: number,
  namePrefix: string = "test-repo"
): RepositoryInfo[] {
  const repos: RepositoryInfo[] = [];

  for (let i = 0; i < count; i++) {
    const name = `${namePrefix}-${i}`;

    // Vary status and other properties to make data more realistic
    const status: RepositoryStatus = i % 3 === 0 ? "ready" : i % 3 === 1 ? "indexing" : "error";
    const errorMessage = status === "error" ? `Test error for ${name}` : undefined;
    const fileCount = 50 + i * 10; // Increasing file counts
    const chunkCount = fileCount * 3; // Roughly 3 chunks per file

    repos.push(
      createTestRepositoryInfo(name, {
        status,
        errorMessage,
        fileCount,
        chunkCount,
      })
    );
  }

  return repos;
}

/**
 * Sample repository metadata objects for common test scenarios
 *
 * Pre-defined repository objects representing typical use cases:
 * - Ready repository with typical statistics
 * - Repository currently being indexed
 * - Repository that failed indexing
 * - Large repository with many files
 * - Small repository with few files
 */
export const sampleRepositories = {
  /**
   * Typical ready repository
   */
  ready: createTestRepositoryInfo("my-api", {
    status: "ready",
    fileCount: 150,
    chunkCount: 450,
    branch: "main",
  }),

  /**
   * Repository currently being indexed
   */
  indexing: createTestRepositoryInfo("frontend-app", {
    status: "indexing",
    fileCount: 0,
    chunkCount: 0,
    lastIndexedAt: new Date().toISOString(),
  }),

  /**
   * Repository that failed indexing
   */
  error: createTestRepositoryInfo("failed-repo", {
    status: "error",
    errorMessage: "Failed to clone repository: authentication required",
    fileCount: 0,
    chunkCount: 0,
  }),

  /**
   * Large repository
   */
  large: createTestRepositoryInfo("monorepo", {
    status: "ready",
    fileCount: 2500,
    chunkCount: 7500,
    indexDurationMs: 45000,
    includeExtensions: [".ts", ".tsx", ".js", ".jsx", ".md", ".json"],
  }),

  /**
   * Small repository
   */
  small: createTestRepositoryInfo("config-lib", {
    status: "ready",
    fileCount: 25,
    chunkCount: 75,
    indexDurationMs: 1200,
    includeExtensions: [".ts", ".md"],
  }),

  /**
   * Repository with custom configuration
   */
  customConfig: createTestRepositoryInfo("specialized-lib", {
    status: "ready",
    branch: "develop",
    includeExtensions: [".py", ".md", ".rst"],
    excludePatterns: ["tests/**", "docs/**", "*.pyc"],
    fileCount: 80,
    chunkCount: 240,
  }),

  /**
   * Repository with incremental update history
   *
   * Demonstrates a repository that has been incrementally updated
   * multiple times since its initial full indexing.
   */
  incrementallyUpdated: createTestRepositoryInfo("active-project", {
    status: "ready",
    fileCount: 200,
    chunkCount: 600,
    lastIndexedCommitSha: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
    lastIncrementalUpdateAt: new Date("2024-12-12T14:00:00.000Z").toISOString(),
    incrementalUpdateCount: 5,
  }),

  /**
   * Repository with only initial full index (no incremental updates yet)
   *
   * Has commit SHA from indexing but no incremental update history.
   */
  freshlyIndexed: createTestRepositoryInfo("new-project", {
    status: "ready",
    fileCount: 75,
    chunkCount: 225,
    lastIndexedCommitSha: "fedcba9876543210fedcba9876543210fedcba98",
    // No lastIncrementalUpdateAt or incrementalUpdateCount - first index only
  }),
};

/**
 * Test repository names with various edge cases
 *
 * Useful for testing collection name sanitization and validation.
 */
export const edgeCaseRepositoryNames = {
  /** Name with special characters */
  specialChars: "My-API_v2.0",

  /** Name with spaces */
  withSpaces: "My Project Name",

  /** Very long name (exceeds ChromaDB 63 char limit when prefixed) */
  veryLong: "this-is-a-very-long-repository-name-that-exceeds-the-chromadb-collection-limit",

  /** Name with multiple consecutive special characters */
  consecutiveSpecialChars: "test___repo---name...final",

  /** Name starting/ending with special characters */
  leadingTrailingSpecialChars: "_-test-repo-_",

  /** All uppercase (should be lowercased) */
  uppercase: "UPPERCASE-REPO",

  /** Mixed case with numbers */
  mixedCase: "MyApp123-v2.0-Final",
};

/**
 * Create a repository with a specific status
 *
 * Helper function for creating repositories in different states.
 *
 * @param name - Repository name
 * @param status - Status to set
 * @returns RepositoryInfo with the specified status
 */
export function createRepositoryWithStatus(name: string, status: RepositoryStatus): RepositoryInfo {
  return createTestRepositoryInfo(name, {
    status,
    errorMessage: status === "error" ? `Test error for ${name}` : undefined,
    fileCount: status === "ready" ? 100 : 0,
    chunkCount: status === "ready" ? 300 : 0,
  });
}
