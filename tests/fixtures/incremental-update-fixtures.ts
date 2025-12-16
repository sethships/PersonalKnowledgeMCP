/**
 * Test fixtures for incremental update tests
 *
 * Provides reusable mock data for incremental update components:
 * - GitHub commit comparisons
 * - File changes (added, modified, deleted, renamed)
 * - Coordinator results
 * - Update statistics
 */

import type {
  FileChange,
  UpdateStats,
  FileProcessingError,
} from "../../src/services/incremental-update-types.js";
import type { CoordinatorResult } from "../../src/services/incremental-update-coordinator-types.js";

/**
 * Sample commit SHAs for testing incremental updates
 */
export const TEST_COMMIT_SHAS = {
  base: "abc1234567890def1234567890abcdef12345678",
  head: "def7890123456abc7890123456abcdef78901234",
  forcePushed: "999aaabbbcccddd111222333444555666777888",
  ancestor: "111222333444555666777888999000aaabbbccc",
};

/**
 * Sample commit information
 */
export const SAMPLE_BASE_COMMIT = {
  sha: TEST_COMMIT_SHAS.base,
  message: "feat: add authentication middleware",
  author: "Test Author",
  date: "2024-01-15T10:00:00Z",
};

export const SAMPLE_HEAD_COMMIT = {
  sha: TEST_COMMIT_SHAS.head,
  message: "feat: add user profile endpoint",
  author: "Test Author",
  date: "2024-01-15T11:30:00Z",
};

export const SAMPLE_FORCE_PUSHED_COMMIT = {
  sha: TEST_COMMIT_SHAS.forcePushed,
  message: "fix: rewritten history after force push",
  author: "Test Author",
  date: "2024-01-15T12:00:00Z",
};

/**
 * Sample file changes - Added files
 */
export const SAMPLE_ADDED_FILES: FileChange[] = [
  {
    path: "src/auth/middleware.ts",
    status: "added",
  },
  {
    path: "src/api/users/profile.ts",
    status: "added",
  },
  {
    path: "docs/api/endpoints.md",
    status: "added",
  },
];

/**
 * Sample file changes - Modified files
 */
export const SAMPLE_MODIFIED_FILES: FileChange[] = [
  {
    path: "src/api/users/index.ts",
    status: "modified",
  },
  {
    path: "README.md",
    status: "modified",
  },
];

/**
 * Sample file changes - Deleted files
 */
export const SAMPLE_DELETED_FILES: FileChange[] = [
  {
    path: "src/deprecated/old-auth.ts",
    status: "deleted",
  },
];

/**
 * Sample file change - Renamed file
 */
export const SAMPLE_RENAMED_FILE: FileChange = {
  path: "src/utils/validation.ts",
  status: "renamed",
  previousPath: "src/utils/validate.ts",
};

/**
 * Sample file changes with special characters in paths
 */
export const SAMPLE_SPECIAL_CHARS_FILES: FileChange[] = [
  {
    path: "src/components/[id]/page.tsx",
    status: "added",
  },
  {
    path: "docs/guide (copy).md",
    status: "added",
  },
  {
    path: "test/fixtures/data with spaces.json",
    status: "added",
  },
];

/**
 * Large batch of file changes (exceeds 500 threshold)
 */
export function createLargeFileBatch(count: number = 1001): FileChange[] {
  const files: FileChange[] = [];
  for (let i = 0; i < count; i++) {
    files.push({
      path: `src/generated/file-${i}.ts`,
      status: "added",
    });
  }
  return files;
}

/**
 * Mixed batch of file changes (all statuses)
 */
export const SAMPLE_MIXED_CHANGES: FileChange[] = [
  ...SAMPLE_ADDED_FILES,
  ...SAMPLE_MODIFIED_FILES,
  ...SAMPLE_DELETED_FILES,
  SAMPLE_RENAMED_FILE,
];

/**
 * Sample update statistics - No changes
 */
export const SAMPLE_NO_CHANGES_STATS: UpdateStats = {
  filesAdded: 0,
  filesModified: 0,
  filesDeleted: 0,
  chunksUpserted: 0,
  chunksDeleted: 0,
  durationMs: 150,
};

/**
 * Sample update statistics - Successful update
 */
export const SAMPLE_UPDATED_STATS: UpdateStats = {
  filesAdded: 3,
  filesModified: 2,
  filesDeleted: 1,
  chunksUpserted: 47,
  chunksDeleted: 12,
  durationMs: 2340,
};

/**
 * Sample update statistics - Large update
 */
export const SAMPLE_LARGE_UPDATE_STATS: UpdateStats = {
  filesAdded: 150,
  filesModified: 87,
  filesDeleted: 23,
  chunksUpserted: 1542,
  chunksDeleted: 389,
  durationMs: 45200,
};

/**
 * Sample file processing errors
 */
export const SAMPLE_FILE_ERRORS: FileProcessingError[] = [
  {
    path: "src/broken.ts",
    error: "Failed to read file: ENOENT: no such file or directory",
  },
  {
    path: "src/invalid-syntax.ts",
    error: "Failed to chunk file: Unexpected token",
  },
  {
    path: "src/large-binary.png",
    error: "File too large: exceeds 10MB limit",
  },
];

/**
 * Sample coordinator result - No changes
 */
export const SAMPLE_NO_CHANGES_RESULT: CoordinatorResult = {
  status: "no_changes",
  commitSha: TEST_COMMIT_SHAS.head,
  commitMessage: SAMPLE_HEAD_COMMIT.message,
  stats: SAMPLE_NO_CHANGES_STATS,
  errors: [],
  durationMs: 250,
};

/**
 * Sample coordinator result - Successful update
 */
export const SAMPLE_UPDATED_RESULT: CoordinatorResult = {
  status: "updated",
  commitSha: TEST_COMMIT_SHAS.head,
  commitMessage: SAMPLE_HEAD_COMMIT.message,
  stats: SAMPLE_UPDATED_STATS,
  errors: [],
  durationMs: 5230,
};

/**
 * Sample coordinator result - Update with partial failures
 */
export const SAMPLE_UPDATED_WITH_ERRORS_RESULT: CoordinatorResult = {
  status: "updated",
  commitSha: TEST_COMMIT_SHAS.head,
  commitMessage: SAMPLE_HEAD_COMMIT.message,
  stats: {
    filesAdded: 3,
    filesModified: 2,
    filesDeleted: 1,
    chunksUpserted: 35, // Lower than expected due to errors
    chunksDeleted: 12,
    durationMs: 3100,
  },
  errors: SAMPLE_FILE_ERRORS.slice(0, 2), // First 2 errors
  durationMs: 4500,
};

/**
 * Sample coordinator result - Failed update
 */
export const SAMPLE_FAILED_RESULT: CoordinatorResult = {
  status: "failed",
  commitSha: TEST_COMMIT_SHAS.head,
  stats: {
    filesAdded: 0,
    filesModified: 0,
    filesDeleted: 0,
    chunksUpserted: 0,
    chunksDeleted: 0,
    durationMs: 120,
  },
  errors: SAMPLE_FILE_ERRORS,
  durationMs: 850,
};

/**
 * Helper: Create mock GitHub commit comparison response
 *
 * @param base - Base commit SHA
 * @param head - Head commit SHA
 * @param files - Array of file changes
 * @returns Mock GitHub API comparison response
 */
export function createMockCommitComparison(
  base: string,
  head: string,
  files: FileChange[]
): object {
  return {
    base_commit: {
      sha: base,
      commit: {
        message: SAMPLE_BASE_COMMIT.message,
        author: {
          name: SAMPLE_BASE_COMMIT.author,
          date: SAMPLE_BASE_COMMIT.date,
        },
      },
    },
    commits: [
      {
        sha: head,
        commit: {
          message: SAMPLE_HEAD_COMMIT.message,
          author: {
            name: SAMPLE_HEAD_COMMIT.author,
            date: SAMPLE_HEAD_COMMIT.date,
          },
        },
      },
    ],
    files: files.map((file) => ({
      filename: file.path,
      status: file.status,
      previous_filename: file.previousPath,
      additions: file.status === "deleted" ? 0 : 10,
      deletions: file.status === "added" ? 0 : 5,
      changes: file.status === "deleted" ? 5 : 15,
      patch: "@@ -1,5 +1,15 @@\n+added lines\n-removed lines",
    })),
  };
}

/**
 * Helper: Create mock coordinator result
 *
 * @param status - Result status
 * @param stats - Update statistics (optional)
 * @param errors - File processing errors (optional)
 * @returns Mock coordinator result
 */
export function createMockCoordinatorResult(
  status: "no_changes" | "updated" | "failed",
  stats?: Partial<UpdateStats>,
  errors?: FileProcessingError[]
): CoordinatorResult {
  const defaultStats: UpdateStats = {
    filesAdded: 0,
    filesModified: 0,
    filesDeleted: 0,
    chunksUpserted: 0,
    chunksDeleted: 0,
    durationMs: 100,
    ...stats,
  };

  return {
    status,
    commitSha: TEST_COMMIT_SHAS.head,
    commitMessage: status !== "failed" ? SAMPLE_HEAD_COMMIT.message : undefined,
    stats: defaultStats,
    errors: errors || [],
    durationMs: 500,
  };
}

/**
 * Helper: Create file change object
 *
 * @param status - Change status
 * @param path - File path
 * @param previousPath - Previous path (for renames)
 * @returns File change object
 */
export function createFileChange(
  status: "added" | "modified" | "deleted" | "renamed",
  path: string,
  previousPath?: string
): FileChange {
  const change: FileChange = { path, status };
  if (previousPath) {
    change.previousPath = previousPath;
  }
  return change;
}

/**
 * Helper: Create file processing error
 *
 * @param path - File path
 * @param error - Error message
 * @returns File processing error
 */
export function createFileError(path: string, error: string): FileProcessingError {
  return { path, error };
}
