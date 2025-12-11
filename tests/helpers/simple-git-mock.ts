/**
 * Mock implementation of simple-git for testing.
 *
 * @module tests/helpers/simple-git-mock
 */

/**
 * Mock SimpleGit client for testing repository cloner.
 *
 * Provides configurable success/failure modes and call tracking.
 *
 * Note: Does not fully implement SimpleGit interface - only provides
 * the methods needed for testing RepositoryCloner.
 */
export class MockSimpleGit {
  private shouldFailClone: boolean = false;
  private failureError?: Error;
  private cloneCallCount: number = 0;
  private lastCloneUrl?: string;
  private lastClonePath?: string;
  private lastCloneOptions?: string[];
  private cloneDelay: number = 0;

  /**
   * Configure the mock to fail on next clone operation.
   *
   * @param error - Error to throw
   */
  setShouldFailClone(error: Error): void {
    this.shouldFailClone = true;
    this.failureError = error;
  }

  /**
   * Configure the mock to succeed on clone operations.
   */
  setShouldSucceedClone(): void {
    this.shouldFailClone = false;
    this.failureError = undefined;
  }

  /**
   * Set a delay (in ms) for clone operations to simulate network latency.
   *
   * @param delayMs - Delay in milliseconds
   */
  setCloneDelay(delayMs: number): void {
    this.cloneDelay = delayMs;
  }

  /**
   * Mock clone implementation.
   *
   * @param url - Repository URL
   * @param path - Target path
   * @param options - Clone options
   */
  async clone(url: string, path: string, options?: string[]): Promise<void> {
    this.cloneCallCount++;
    this.lastCloneUrl = url;
    this.lastClonePath = path;
    this.lastCloneOptions = options;

    if (this.cloneDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.cloneDelay));
    }

    if (this.shouldFailClone && this.failureError) {
      throw this.failureError;
    }

    // Success - create the directory to simulate real git behavior
    const { mkdir } = await import("node:fs/promises");
    await mkdir(path, { recursive: true });
  }

  /**
   * Get the number of times clone was called.
   */
  getCloneCallCount(): number {
    return this.cloneCallCount;
  }

  /**
   * Get the last URL passed to clone.
   */
  getLastCloneUrl(): string | undefined {
    return this.lastCloneUrl;
  }

  /**
   * Get the last path passed to clone.
   */
  getLastClonePath(): string | undefined {
    return this.lastClonePath;
  }

  /**
   * Get the last options passed to clone.
   */
  getLastCloneOptions(): string[] | undefined {
    return this.lastCloneOptions;
  }

  /**
   * Reset all tracking state.
   */
  reset(): void {
    this.cloneCallCount = 0;
    this.lastCloneUrl = undefined;
    this.lastClonePath = undefined;
    this.lastCloneOptions = undefined;
    this.shouldFailClone = false;
    this.failureError = undefined;
    this.cloneDelay = 0;
  }
}

/**
 * Create a mock error for testing specific failure scenarios.
 */
export class MockGitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MockGitError";
  }
}

/**
 * Common error scenarios for testing.
 */
export const MOCK_GIT_ERRORS = {
  AUTHENTICATION_FAILED: new MockGitError(
    "fatal: Authentication failed for 'https://github.com/user/private-repo.git/'"
  ),
  REPOSITORY_NOT_FOUND: new MockGitError(
    "fatal: repository 'https://github.com/user/nonexistent.git/' not found"
  ),
  NETWORK_ERROR: new MockGitError(
    "fatal: unable to access 'https://github.com/': Failed to connect to github.com"
  ),
  HOST_RESOLUTION_ERROR: new MockGitError(
    "fatal: unable to access 'https://github.com/': Could not resolve host: github.com"
  ),
  PERMISSION_DENIED: new MockGitError(
    "fatal: could not create work tree dir 'repo': Permission denied"
  ),
} as const;
