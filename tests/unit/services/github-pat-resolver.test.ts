/**
 * Unit tests for GitHub PAT Resolver
 *
 * Tests multi-source PAT resolution with validation against the GitHub API.
 * Uses mock validation functions to avoid real API calls.
 */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { initializeLogger, resetLogger } from "../../../src/logging/index.js";
import {
  resolveGitHubPAT,
  readPATFromEnvFile,
  validatePAT,
} from "../../../src/services/github-pat-resolver.js";
import { join } from "path";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";

describe("GitHub PAT Resolver", () => {
  let tempDir: string;

  beforeEach(async () => {
    initializeLogger({ level: "silent", format: "json" });
    tempDir = await mkdtemp(join(tmpdir(), "pat-resolver-test-"));
  });

  afterEach(async () => {
    resetLogger();
    await rm(tempDir, { recursive: true, force: true });
  });

  /**
   * Helper to create a .env file with given content
   */
  async function createEnvFile(content: string): Promise<string> {
    const envPath = join(tempDir, ".env");
    await writeFile(envPath, content, "utf-8");
    return envPath;
  }

  describe("readPATFromEnvFile", () => {
    it("should read unquoted GITHUB_PAT from .env file", async () => {
      const envPath = await createEnvFile("GITHUB_PAT=ghp_validtoken123");
      const result = await readPATFromEnvFile(envPath);
      expect(result).toBe("ghp_validtoken123");
    });

    it("should read double-quoted GITHUB_PAT from .env file", async () => {
      const envPath = await createEnvFile('GITHUB_PAT="ghp_quotedtoken"');
      const result = await readPATFromEnvFile(envPath);
      expect(result).toBe("ghp_quotedtoken");
    });

    it("should read single-quoted GITHUB_PAT from .env file", async () => {
      const envPath = await createEnvFile("GITHUB_PAT='ghp_singlequoted'");
      const result = await readPATFromEnvFile(envPath);
      expect(result).toBe("ghp_singlequoted");
    });

    it("should handle GITHUB_PAT with spaces around equals", async () => {
      const envPath = await createEnvFile("GITHUB_PAT = ghp_spacedtoken");
      const result = await readPATFromEnvFile(envPath);
      expect(result).toBe("ghp_spacedtoken");
    });

    it("should handle .env file with other variables", async () => {
      const envPath = await createEnvFile("OTHER_VAR=value\nGITHUB_PAT=ghp_middle\nANOTHER=thing");
      const result = await readPATFromEnvFile(envPath);
      expect(result).toBe("ghp_middle");
    });

    it("should return null for commented out GITHUB_PAT", async () => {
      const envPath = await createEnvFile("# GITHUB_PAT=ghp_commented");
      const result = await readPATFromEnvFile(envPath);
      expect(result).toBeNull();
    });

    it("should return null for empty GITHUB_PAT value", async () => {
      const envPath = await createEnvFile("GITHUB_PAT=");
      const result = await readPATFromEnvFile(envPath);
      expect(result).toBeNull();
    });

    it("should return null when .env file does not exist", async () => {
      const result = await readPATFromEnvFile(join(tempDir, "nonexistent.env"));
      expect(result).toBeNull();
    });

    it("should return null when .env file has no GITHUB_PAT", async () => {
      const envPath = await createEnvFile("OTHER_VAR=value\nSOMETHING_ELSE=123");
      const result = await readPATFromEnvFile(envPath);
      expect(result).toBeNull();
    });

    it("should ignore inline comments after the value", async () => {
      const envPath = await createEnvFile("GITHUB_PAT=ghp_beforecomment # this is a comment");
      const result = await readPATFromEnvFile(envPath);
      expect(result).toBe("ghp_beforecomment");
    });
  });

  describe("resolveGitHubPAT", () => {
    it("should use .env PAT when valid and shell PAT expired", async () => {
      const envPath = await createEnvFile("GITHUB_PAT=ghp_envtoken");

      const validateFn = mock(async (token: string) => {
        return token === "ghp_envtoken";
      });

      const result = await resolveGitHubPAT({
        envFilePath: envPath,
        validateFn,
        shellEnvValue: "github_pat_shelltoken",
      });

      expect(result).not.toBeNull();
      expect(result!.token).toBe("ghp_envtoken");
      expect(result!.source).toBe(".env file");
    });

    it("should use shell PAT when .env PAT expired", async () => {
      const envPath = await createEnvFile("GITHUB_PAT=ghp_expired");

      const validateFn = mock(async (token: string) => {
        return token === "ghp_shellvalid";
      });

      const result = await resolveGitHubPAT({
        envFilePath: envPath,
        validateFn,
        shellEnvValue: "ghp_shellvalid",
      });

      expect(result).not.toBeNull();
      expect(result!.token).toBe("ghp_shellvalid");
      expect(result!.source).toBe("shell environment");
    });

    it("should validate identical PATs only once", async () => {
      const envPath = await createEnvFile("GITHUB_PAT=ghp_sametoken");

      const validateFn = mock(async (_token: string) => true);

      const result = await resolveGitHubPAT({
        envFilePath: envPath,
        validateFn,
        shellEnvValue: "ghp_sametoken",
      });

      expect(result).not.toBeNull();
      expect(result!.token).toBe("ghp_sametoken");
      // Should only validate once since both sources have the same token
      expect(validateFn).toHaveBeenCalledTimes(1);
    });

    it("should return null when both PATs are expired", async () => {
      const envPath = await createEnvFile("GITHUB_PAT=ghp_expired1");

      const validateFn = mock(async (_token: string) => false);

      const result = await resolveGitHubPAT({
        envFilePath: envPath,
        validateFn,
        shellEnvValue: "ghp_expired2",
      });

      expect(result).toBeNull();
      expect(validateFn).toHaveBeenCalledTimes(2);
    });

    it("should return null when no PATs found anywhere", async () => {
      const envPath = await createEnvFile("OTHER_VAR=value");

      const validateFn = mock(async (_token: string) => true);

      const result = await resolveGitHubPAT({
        envFilePath: envPath,
        validateFn,
        shellEnvValue: undefined,
      });

      expect(result).toBeNull();
      // Should never call validate since there are no candidates
      expect(validateFn).toHaveBeenCalledTimes(0);
    });

    it("should fall through to shell env when .env file does not exist", async () => {
      const nonexistentPath = join(tempDir, "no-such.env");

      const validateFn = mock(async (_token: string) => true);

      const result = await resolveGitHubPAT({
        envFilePath: nonexistentPath,
        validateFn,
        shellEnvValue: "ghp_shellfallback",
      });

      expect(result).not.toBeNull();
      expect(result!.token).toBe("ghp_shellfallback");
      expect(result!.source).toBe("shell environment");
    });

    it("should try next source when validation throws a network error", async () => {
      const envPath = await createEnvFile("GITHUB_PAT=ghp_networkerr");

      const validateFn = mock(async (token: string) => {
        if (token === "ghp_networkerr") {
          throw new Error("Network timeout");
        }
        return token === "ghp_works";
      });

      const result = await resolveGitHubPAT({
        envFilePath: envPath,
        validateFn,
        shellEnvValue: "ghp_works",
      });

      expect(result).not.toBeNull();
      expect(result!.token).toBe("ghp_works");
      expect(result!.source).toBe("shell environment");
    });

    it("should use .env PAT when only .env has a PAT (no shell env)", async () => {
      const envPath = await createEnvFile("GITHUB_PAT=ghp_envonly");

      const validateFn = mock(async (_token: string) => true);

      const result = await resolveGitHubPAT({
        envFilePath: envPath,
        validateFn,
        shellEnvValue: undefined,
      });

      expect(result).not.toBeNull();
      expect(result!.token).toBe("ghp_envonly");
      expect(result!.source).toBe(".env file");
    });

    it("should ignore empty shell PAT value", async () => {
      const envPath = await createEnvFile("GITHUB_PAT=ghp_envval");

      const validateFn = mock(async (_token: string) => true);

      const result = await resolveGitHubPAT({
        envFilePath: envPath,
        validateFn,
        shellEnvValue: "   ",
      });

      expect(result).not.toBeNull();
      expect(result!.token).toBe("ghp_envval");
      expect(validateFn).toHaveBeenCalledTimes(1);
    });
  });

  describe("validatePAT", () => {
    it("should be a function that accepts a token and baseUrl", () => {
      // Structural test — actual HTTP calls are tested in integration tests
      expect(typeof validatePAT).toBe("function");
      expect(validatePAT.length).toBe(1); // 1 required param, 1 optional
    });
  });
});
