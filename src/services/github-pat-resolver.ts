/**
 * GitHub PAT (Personal Access Token) Resolver
 *
 * Resolves a valid GitHub PAT from multiple sources, validating each against
 * the GitHub API before use. This addresses a common issue where the shell
 * environment has an expired fine-grained PAT that overrides the valid classic
 * PAT in .env (because dotenv doesn't override existing env vars).
 *
 * Resolution order:
 *   1. .env file (parsed directly, bypassing dotenv's no-override behavior)
 *   2. System/shell environment variable (Bun.env["GITHUB_PAT"])
 *
 * @module services/github-pat-resolver
 */

import { getComponentLogger } from "../logging/index.js";

/**
 * Result of a successful PAT resolution
 */
export interface ResolvedPAT {
  /** The validated GitHub PAT token */
  token: string;
  /** Human-readable description of where the token was found */
  source: string;
}

/**
 * A candidate PAT with its source for logging/debugging
 */
interface PATCandidate {
  token: string;
  source: string;
}

/**
 * Lazy-initialized logger
 */
let logger: ReturnType<typeof getComponentLogger> | null = null;

function getLogger(): ReturnType<typeof getComponentLogger> {
  if (!logger) {
    logger = getComponentLogger("services:github-pat-resolver");
  }
  return logger;
}

/**
 * Reads GITHUB_PAT directly from the .env file, bypassing dotenv's
 * no-override behavior. This ensures we get the .env value even when
 * a different value exists in the shell environment.
 *
 * @param envFilePath - Path to the .env file (defaults to .env in cwd)
 * @returns The GITHUB_PAT value from .env, or null if not found
 */
export async function readPATFromEnvFile(envFilePath?: string): Promise<string | null> {
  const filePath = envFilePath ?? `${process.cwd()}/.env`;
  try {
    const file = Bun.file(filePath);
    const exists = await file.exists();
    if (!exists) {
      return null;
    }

    const content = await file.text();
    // Match GITHUB_PAT=value, handling quotes and inline comments
    // Supports: GITHUB_PAT=token, GITHUB_PAT="token", GITHUB_PAT='token'
    const match = content.match(/^GITHUB_PAT\s*=\s*(?:["']([^"']*)["']|([^\s#]*))/m);
    if (!match) {
      return null;
    }

    const value = (match[1] ?? match[2] ?? "").trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/**
 * Validates a GitHub PAT by calling the GitHub API /user endpoint.
 *
 * @param token - The PAT to validate
 * @param baseUrl - GitHub API base URL (defaults to https://api.github.com)
 * @returns true if the token is valid (HTTP 200), false otherwise
 */
export async function validatePAT(
  token: string,
  baseUrl: string = "https://api.github.com"
): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/user`, {
      method: "GET",
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "PersonalKnowledgeMCP",
      },
      signal: AbortSignal.timeout(10000),
    });
    return response.status === 200;
  } catch {
    return false;
  }
}

/**
 * Options for resolveGitHubPAT, primarily for testing
 */
export interface ResolveGitHubPATOptions {
  /** Path to .env file (defaults to .env in cwd) */
  envFilePath?: string;
  /** Validation function (defaults to validatePAT which calls GitHub API) */
  validateFn?: (token: string) => Promise<boolean>;
  /** Override for shell environment value (defaults to Bun.env["GITHUB_PAT"]) */
  shellEnvValue?: string | undefined;
}

/**
 * Resolves a valid GitHub PAT from multiple sources.
 *
 * Checks .env file first (direct parse), then shell/system environment.
 * Deduplicates identical tokens across sources. Validates each unique
 * token against the GitHub API and returns the first valid one.
 *
 * @param options - Configuration options (all optional, for testing)
 * @returns ResolvedPAT with the token and its source, or null if no valid PAT found
 */
export async function resolveGitHubPAT(
  options: ResolveGitHubPATOptions = {}
): Promise<ResolvedPAT | null> {
  const { envFilePath, validateFn = validatePAT, shellEnvValue } = options;
  // Use explicit shellEnvValue if provided (even if undefined), otherwise read from Bun.env
  const shellPat = "shellEnvValue" in options ? shellEnvValue : Bun.env["GITHUB_PAT"];

  const log = getLogger();

  // Collect candidates from all sources
  const candidates: PATCandidate[] = [];

  // Source 1: .env file (parsed directly)
  const envFilePat = await readPATFromEnvFile(envFilePath);
  if (envFilePat) {
    candidates.push({ token: envFilePat, source: ".env file" });
  }

  // Source 2: Shell/system environment
  if (shellPat && shellPat.trim().length > 0) {
    candidates.push({ token: shellPat.trim(), source: "shell environment" });
  }

  if (candidates.length === 0) {
    log.warn("No GITHUB_PAT found in .env file or shell environment");
    return null;
  }

  // Deduplicate: if both sources have the same token, only validate once
  const seen = new Map<string, PATCandidate>();
  for (const candidate of candidates) {
    if (!seen.has(candidate.token)) {
      seen.set(candidate.token, candidate);
    } else {
      // Same token from multiple sources — keep the first source name
      const existing = seen.get(candidate.token)!;
      log.debug(
        { source1: existing.source, source2: candidate.source },
        "Same GITHUB_PAT found in multiple sources"
      );
    }
  }

  const uniqueCandidates = Array.from(seen.values());
  log.debug(
    { totalSources: candidates.length, uniqueTokens: uniqueCandidates.length },
    "Collected GITHUB_PAT candidates"
  );

  // Validate each unique candidate in order
  const triedSources: string[] = [];
  for (const candidate of uniqueCandidates) {
    const maskedToken = `${candidate.token.substring(0, 8)}...`;
    log.debug({ source: candidate.source, token: maskedToken }, "Validating GITHUB_PAT");

    try {
      const isValid = await validateFn(candidate.token);
      if (isValid) {
        log.info(
          { source: candidate.source, token: maskedToken },
          "GITHUB_PAT validated successfully"
        );
        return { token: candidate.token, source: candidate.source };
      }

      log.warn(
        { source: candidate.source, token: maskedToken },
        "GITHUB_PAT validation failed (invalid or expired)"
      );
      triedSources.push(`${candidate.source} (${maskedToken})`);
    } catch (err) {
      log.warn(
        { source: candidate.source, error: err instanceof Error ? err.message : String(err) },
        "GITHUB_PAT validation encountered an error"
      );
      triedSources.push(`${candidate.source} (network error)`);
    }
  }

  log.error(
    { triedSources },
    "No valid GITHUB_PAT found. Tried sources: " +
      triedSources.join(", ") +
      ". Incremental update tools will not be available."
  );
  return null;
}
