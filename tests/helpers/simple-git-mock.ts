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

  // Fetch/reset tracking for fetchLatest tests
  private shouldFailFetch: boolean = false;
  private fetchError?: Error;
  private fetchCallCount: number = 0;
  private lastFetchArgs?: string[];
  private resetCallCount: number = 0;
  private lastResetArgs?: string[];
  private remoteCallCount: number = 0;
  private lastRemoteArgs?: string[];

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
   * Configure the mock to fail on fetch operation.
   *
   * @param error - Error to throw
   */
  setShouldFailFetch(error: Error): void {
    this.shouldFailFetch = true;
    this.fetchError = error;
  }

  /**
   * Mock fetch implementation.
   *
   * @param args - Fetch arguments
   */
  async fetch(args: string[]): Promise<void> {
    this.fetchCallCount++;
    this.lastFetchArgs = args;

    if (this.shouldFailFetch && this.fetchError) {
      throw this.fetchError;
    }
  }

  /**
   * Mock reset implementation.
   *
   * @param args - Reset arguments
   */
  async reset(args: string[]): Promise<void> {
    this.resetCallCount++;
    this.lastResetArgs = args;
  }

  /**
   * Mock remote implementation.
   *
   * @param args - Remote arguments
   */
  async remote(args: string[]): Promise<void> {
    this.remoteCallCount++;
    this.lastRemoteArgs = args;
  }

  /**
   * Mock revparse implementation.
   *
   * @param _args - Args (unused in mock)
   * @returns Mock branch name
   */
  async revparse(_args: string[]): Promise<string> {
    return "main";
  }

  /**
   * Get the number of times fetch was called.
   */
  getFetchCallCount(): number {
    return this.fetchCallCount;
  }

  /**
   * Get the last args passed to fetch.
   */
  getLastFetchArgs(): string[] | undefined {
    return this.lastFetchArgs;
  }

  /**
   * Get the number of times reset was called.
   */
  getResetCallCount(): number {
    return this.resetCallCount;
  }

  /**
   * Get the last args passed to reset.
   */
  getLastResetArgs(): string[] | undefined {
    return this.lastResetArgs;
  }

  /**
   * Get the number of times remote was called.
   */
  getRemoteCallCount(): number {
    return this.remoteCallCount;
  }

  /**
   * Get the last args passed to remote.
   */
  getLastRemoteArgs(): string[] | undefined {
    return this.lastRemoteArgs;
  }

  /**
   * Reset all tracking state.
   */
  resetState(): void {
    this.cloneCallCount = 0;
    this.lastCloneUrl = undefined;
    this.lastClonePath = undefined;
    this.lastCloneOptions = undefined;
    this.shouldFailClone = false;
    this.failureError = undefined;
    this.cloneDelay = 0;
    // Reset fetch/reset tracking
    this.shouldFailFetch = false;
    this.fetchError = undefined;
    this.fetchCallCount = 0;
    this.lastFetchArgs = undefined;
    this.resetCallCount = 0;
    this.lastResetArgs = undefined;
    this.remoteCallCount = 0;
    this.lastRemoteArgs = undefined;
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
  FETCH_FAILED: new MockGitError("fatal: couldn't find remote ref main"),
} as const;
