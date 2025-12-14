/**
 * Test fixtures for GitHub Client tests
 *
 * Provides mock data for GitHub API responses, error scenarios,
 * and test configurations.
 */

/**
 * Sample owner and repository names for testing
 */
export const TEST_REPOS = {
  valid: {
    owner: "octocat",
    repo: "Hello-World",
    branch: "main",
  },
  private: {
    owner: "private-org",
    repo: "secret-repo",
    branch: "develop",
  },
  withDots: {
    owner: "user123",
    repo: "my.project.name",
    branch: "feature/test",
  },
};

/**
 * Sample commit SHAs for testing
 */
export const TEST_SHAS = {
  base: "abc1234567890def1234567890abcdef12345678",
  head: "def7890123456abc7890123456abcdef78901234",
  ancestor: "111222333444555666777888999000aaabbbccc",
};

/**
 * Test configurations for GitHub client
 */
export const TEST_CONFIGS = {
  default: {
    token: "ghp_test1234567890abcdefghijklmnopqrstuv",
    baseUrl: "https://api.github.com",
    timeoutMs: 30000,
    maxRetries: 3,
  },
  noToken: {
    baseUrl: "https://api.github.com",
    timeoutMs: 30000,
    maxRetries: 3,
  },
  shortTimeout: {
    token: "ghp_test1234567890abcdefghijklmnopqrstuv",
    timeoutMs: 1000,
    maxRetries: 1,
  },
  noRetries: {
    token: "ghp_test1234567890abcdefghijklmnopqrstuv",
    maxRetries: 0,
  },
  enterprise: {
    token: "ghp_test1234567890abcdefghijklmnopqrstuv",
    baseUrl: "https://github.mycompany.com/api/v3",
    timeoutMs: 30000,
    maxRetries: 3,
  },
};

/**
 * Mock GitHub API commit response
 */
export function createMockCommitResponse(
  overrides: Partial<{
    sha: string;
    message: string;
    author: string;
    date: string;
  }> = {}
): MockCommitResponse {
  return {
    sha: overrides.sha || TEST_SHAS.head,
    node_id: "C_kwDOTest",
    commit: {
      message: overrides.message || "feat: add new feature\n\nDetailed description here",
      author: {
        name: overrides.author || "Test Author",
        email: "test@example.com",
        date: overrides.date || "2024-01-15T10:30:00Z",
      },
      committer: {
        name: "Test Committer",
        email: "committer@example.com",
        date: overrides.date || "2024-01-15T10:30:00Z",
      },
      tree: {
        sha: "tree123",
        url: "https://api.github.com/repos/octocat/Hello-World/git/trees/tree123",
      },
      url:
        "https://api.github.com/repos/octocat/Hello-World/git/commits/" +
        (overrides.sha || TEST_SHAS.head),
      verification: {
        verified: false,
        reason: "unsigned",
        signature: null,
        payload: null,
      },
    },
    url:
      "https://api.github.com/repos/octocat/Hello-World/commits/" +
      (overrides.sha || TEST_SHAS.head),
    html_url: "https://github.com/octocat/Hello-World/commit/" + (overrides.sha || TEST_SHAS.head),
    author: {
      login: "testauthor",
      id: 1,
      type: "User",
    },
    committer: {
      login: "testcommitter",
      id: 2,
      type: "User",
    },
    parents: [],
  };
}

/**
 * Mock GitHub API compare response
 */
export function createMockCompareResponse(
  overrides: Partial<{
    baseSha: string;
    headSha: string;
    totalCommits: number;
    files: MockFileChange[];
  }> = {}
): MockCompareResponse {
  const files = overrides.files || [
    { filename: "src/index.ts", status: "modified" },
    { filename: "README.md", status: "modified" },
    { filename: "src/new-file.ts", status: "added" },
    { filename: "old-file.ts", status: "removed" },
    { filename: "renamed-file.ts", status: "renamed", previous_filename: "old-name.ts" },
  ];

  return {
    url: "https://api.github.com/repos/octocat/Hello-World/compare/base...head",
    html_url: "https://github.com/octocat/Hello-World/compare/base...head",
    permalink_url: "https://github.com/octocat/Hello-World/compare/base...head",
    diff_url: "https://github.com/octocat/Hello-World/compare/base...head.diff",
    patch_url: "https://github.com/octocat/Hello-World/compare/base...head.patch",
    base_commit: {
      sha: overrides.baseSha || TEST_SHAS.base,
      commit: { message: "base commit" },
    },
    merge_base_commit: {
      sha: overrides.baseSha || TEST_SHAS.base,
      commit: { message: "merge base commit" },
    },
    status: "ahead",
    ahead_by: overrides.totalCommits || 5,
    behind_by: 0,
    total_commits: overrides.totalCommits || 5,
    commits: Array.from({ length: overrides.totalCommits || 5 }, (_, i) => ({
      sha: `commit${i}sha`,
      commit: { message: `Commit ${i}` },
    })),
    files,
  };
}

/**
 * Mock rate limit response
 */
export function createMockRateLimitResponse(remaining = 4999, limit = 5000): MockRateLimitResponse {
  const resetTime = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
  return {
    resources: {
      core: {
        limit,
        remaining,
        reset: resetTime,
        used: limit - remaining,
      },
      search: {
        limit: 30,
        remaining: 30,
        reset: resetTime,
        used: 0,
      },
      graphql: {
        limit: 5000,
        remaining: 5000,
        reset: resetTime,
        used: 0,
      },
    },
    rate: {
      limit,
      remaining,
      reset: resetTime,
      used: limit - remaining,
    },
  };
}

/**
 * Mock error responses
 */
export const MOCK_ERROR_RESPONSES = {
  unauthorized: {
    status: 401,
    statusText: "Unauthorized",
    body: {
      message: "Bad credentials",
      documentation_url: "https://docs.github.com/rest",
    },
    headers: new Headers({
      "content-type": "application/json",
    }),
  },
  forbidden: {
    status: 403,
    statusText: "Forbidden",
    body: {
      message: "Resource not accessible by integration",
      documentation_url: "https://docs.github.com/rest",
    },
    headers: new Headers({
      "content-type": "application/json",
    }),
  },
  rateLimited: {
    status: 403,
    statusText: "Forbidden",
    body: {
      message: "API rate limit exceeded for user",
      documentation_url:
        "https://docs.github.com/rest/overview/resources-in-the-rest-api#rate-limiting",
    },
    headers: new Headers({
      "content-type": "application/json",
      "x-ratelimit-limit": "5000",
      "x-ratelimit-remaining": "0",
      "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600),
    }),
  },
  notFound: {
    status: 404,
    statusText: "Not Found",
    body: {
      message: "Not Found",
      documentation_url: "https://docs.github.com/rest",
    },
    headers: new Headers({
      "content-type": "application/json",
    }),
  },
  validationFailed: {
    status: 422,
    statusText: "Unprocessable Entity",
    body: {
      message: "Validation Failed",
      errors: [{ resource: "Commit", code: "custom", message: "No common ancestor" }],
      documentation_url: "https://docs.github.com/rest",
    },
    headers: new Headers({
      "content-type": "application/json",
    }),
  },
  internalError: {
    status: 500,
    statusText: "Internal Server Error",
    body: {
      message: "Internal Server Error",
    },
    headers: new Headers({
      "content-type": "application/json",
    }),
  },
  serviceUnavailable: {
    status: 503,
    statusText: "Service Unavailable",
    body: {
      message: "Service Unavailable",
    },
    headers: new Headers({
      "content-type": "application/json",
    }),
  },
};

/**
 * Invalid input test cases
 */
export const INVALID_INPUTS = {
  owners: [
    "", // empty
    "a".repeat(40), // too long
    "-invalid", // starts with hyphen
    "invalid-", // ends with hyphen
    "in--valid", // consecutive hyphens
    "user@name", // invalid character
  ],
  repos: [
    "", // empty
    "a".repeat(101), // too long
    "repo/name", // invalid character
    "repo:name", // invalid character
  ],
  refs: [
    "", // empty
    "a".repeat(256), // too long
  ],
};

/**
 * Valid edge case inputs
 */
export const VALID_EDGE_CASES = {
  owners: [
    "a", // single character
    "a-b", // with hyphen
    "a".repeat(39), // max length
    "user123", // with numbers
    "A-B-C", // uppercase with hyphens
  ],
  repos: [
    "a", // single character
    "my.repo", // with dot
    "my-repo", // with hyphen
    "my_repo", // with underscore
    "a".repeat(100), // max length
  ],
};

// Type definitions for mock responses
export interface MockCommitResponse {
  sha: string;
  node_id: string;
  commit: {
    message: string;
    author: {
      name: string;
      email: string;
      date: string;
    };
    committer: {
      name: string;
      email: string;
      date: string;
    };
    tree: {
      sha: string;
      url: string;
    };
    url: string;
    verification: {
      verified: boolean;
      reason: string;
      signature: string | null;
      payload: string | null;
    };
  };
  url: string;
  html_url: string;
  author: {
    login: string;
    id: number;
    type: string;
  };
  committer: {
    login: string;
    id: number;
    type: string;
  };
  parents: Array<{ sha: string; url: string }>;
}

export interface MockFileChange {
  filename: string;
  status: string;
  previous_filename?: string;
  additions?: number;
  deletions?: number;
  changes?: number;
  patch?: string;
}

export interface MockCompareResponse {
  url: string;
  html_url: string;
  permalink_url: string;
  diff_url: string;
  patch_url: string;
  base_commit: {
    sha: string;
    commit: { message: string };
  };
  merge_base_commit: {
    sha: string;
    commit: { message: string };
  };
  status: string;
  ahead_by: number;
  behind_by: number;
  total_commits: number;
  commits: Array<{
    sha: string;
    commit: { message: string };
  }>;
  files: MockFileChange[];
}

export interface MockRateLimitResponse {
  resources: {
    core: {
      limit: number;
      remaining: number;
      reset: number;
      used: number;
    };
    search: {
      limit: number;
      remaining: number;
      reset: number;
      used: number;
    };
    graphql: {
      limit: number;
      remaining: number;
      reset: number;
      used: number;
    };
  };
  rate: {
    limit: number;
    remaining: number;
    reset: number;
    used: number;
  };
}
