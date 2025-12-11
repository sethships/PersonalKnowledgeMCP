/**
 * Integration tests for RepositoryCloner.
 *
 * These tests perform real Git clone operations.
 * They use a small public repository for testing.
 *
 * @module tests/integration/ingestion/repository-cloner
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { rm, access, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import simpleGit from "simple-git";
import { RepositoryCloner } from "../../../src/ingestion/repository-cloner.js";
import type { RepositoryClonerConfig } from "../../../src/ingestion/types.js";
import { initializeLogger, resetLogger } from "../../../src/logging/index.js";

// Use a small, stable public repository for testing
// This is a minimal test repository with just a README
const TEST_REPO_URL = "https://github.com/octocat/Hello-World";
const TEST_REPO_NAME = "Hello-World";

describe("RepositoryCloner Integration Tests", () => {
  let testDir: string;
  let config: RepositoryClonerConfig;
  let cloner: RepositoryCloner;

  beforeAll(() => {
    // Initialize logger for integration tests
    initializeLogger({ level: "info", format: "json" });
  });

  afterAll(() => {
    resetLogger();
  });

  beforeEach(async () => {
    // Create a unique temporary directory for each test
    testDir = join(tmpdir(), `repo-cloner-integration-${Date.now()}`);

    config = {
      clonePath: testDir,
    };

    cloner = new RepositoryCloner(config);
  });

  afterAll(async () => {
    // Clean up all test directories
    try {
      const testDirs = await readdir(tmpdir());
      for (const dir of testDirs) {
        if (dir.startsWith("repo-cloner-integration-")) {
          await rm(join(tmpdir(), dir), { recursive: true, force: true });
        }
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("Public Repository Cloning", () => {
    test("should successfully clone a public repository", async () => {
      const result = await cloner.clone(TEST_REPO_URL);

      // Verify result structure
      expect(result).toBeDefined();
      expect(result.name).toBe(TEST_REPO_NAME);
      expect(result.path).toContain(TEST_REPO_NAME);
      // The octocat/Hello-World repository's default branch is "master"
      expect(result.branch).toBe("master");

      // Verify directory exists (access should not throw)
      await access(result.path); // Throws if doesn't exist

      // Verify repository was cloned (check for .git directory)
      const gitDir = join(result.path, ".git");
      await access(gitDir); // Throws if doesn't exist

      // Verify at least one file exists (README.md)
      const files = await readdir(result.path);
      expect(files.length).toBeGreaterThan(0);
    }, 30000); // 30 second timeout for network operation

    test("should perform shallow clone by default", async () => {
      const result = await cloner.clone(TEST_REPO_URL);

      // Use simple-git to check if it's a shallow clone
      const git = simpleGit(result.path);
      const isShallow = await git.raw("rev-parse", "--is-shallow-repository");

      expect(isShallow.trim()).toBe("true");
    }, 30000);
  });

  describe("Existing Clone Handling", () => {
    test("should skip clone if directory already exists", async () => {
      // First clone
      const result1 = await cloner.clone(TEST_REPO_URL);

      // Wait a bit to ensure time difference
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Second clone should be very fast (skipped)
      const startTime = Date.now();
      const result2 = await cloner.clone(TEST_REPO_URL);
      const secondCloneDuration = Date.now() - startTime;

      // Second clone should return same path
      expect(result2.path).toBe(result1.path);

      // Second clone should be much faster (< 1 second) since it's skipped
      expect(secondCloneDuration).toBeLessThan(1000);
    }, 30000);

    test("should re-clone when fresh=true", async () => {
      // First clone
      const result1 = await cloner.clone(TEST_REPO_URL);

      // Get initial file count
      const files1 = await readdir(result1.path);
      const initialFileCount = files1.length;

      // Fresh clone
      const result2 = await cloner.clone(TEST_REPO_URL, { fresh: true });

      // Should return same path
      expect(result2.path).toBe(result1.path);

      // Directory should still exist with files
      const files2 = await readdir(result2.path);
      expect(files2.length).toBeGreaterThan(0);

      // Should have similar file count (it's the same repo)
      expect(files2.length).toBe(initialFileCount);
    }, 60000); // 60 second timeout for two clone operations
  });

  describe("Branch Specification", () => {
    test("should clone specific branch", async () => {
      // Clone a specific branch (master branch exists in Hello-World repo)
      const result = await cloner.clone(TEST_REPO_URL, { branch: "master" });

      expect(result.branch).toBe("master");

      // Verify the correct branch was checked out
      const git = simpleGit(result.path);
      const currentBranch = await git.revparse(["--abbrev-ref", "HEAD"]);

      expect(currentBranch.trim()).toBe("master");
    }, 30000);
  });

  describe("Clone Options Combinations", () => {
    test("should support custom name", async () => {
      const customName = "my-custom-repo-name";
      const result = await cloner.clone(TEST_REPO_URL, { name: customName });

      expect(result.name).toBe(customName);
      expect(result.path).toContain(customName);

      // Verify directory with custom name exists
      await access(result.path); // Throws if doesn't exist
    }, 30000);

    test("should support full clone (not shallow)", async () => {
      const result = await cloner.clone(TEST_REPO_URL, { shallow: false });

      // Check if it's NOT a shallow repository
      const git = simpleGit(result.path);
      const isShallow = await git.raw("rev-parse", "--is-shallow-repository");

      expect(isShallow.trim()).toBe("false");
    }, 30000);
  });

  describe("Error Handling", () => {
    test("should throw error for non-existent repository", async () => {
      const invalidUrl = "https://github.com/nonexistent-user-12345/nonexistent-repo-67890";

      try {
        await cloner.clone(invalidUrl);
        expect(false).toBe(true); // Should not reach here
      } catch (error) {
        expect(error).toBeDefined();
        // Should be authentication error (GitHub returns 404 as auth failure for security)
        expect(error).toHaveProperty("code");
      }
    }, 30000);
  });

  describe("Path Handling", () => {
    test("should handle nested clone paths", async () => {
      const nestedPath = join(testDir, "level1", "level2", "repos");
      const nestedConfig: RepositoryClonerConfig = {
        clonePath: nestedPath,
      };

      const nestedCloner = new RepositoryCloner(nestedConfig);
      const result = await nestedCloner.clone(TEST_REPO_URL);

      // Verify the nested path was created and repository cloned
      expect(result.path).toContain("level1");
      expect(result.path).toContain("level2");
      expect(result.path).toContain("repos");

      await access(result.path); // Throws if doesn't exist

      // Cleanup nested directories
      await rm(join(testDir, "level1"), { recursive: true, force: true });
    }, 30000);
  });
});
