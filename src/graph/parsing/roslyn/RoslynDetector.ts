/**
 * .NET SDK detection for Roslyn analyzer.
 *
 * Checks if the .NET SDK is available for C# parsing.
 * Results are cached for performance.
 *
 * @module graph/parsing/roslyn/RoslynDetector
 */

import { spawn } from "bun";
import type pino from "pino";
import { getComponentLogger } from "../../../logging/index.js";

// Lazy-initialized logger to avoid requiring logger initialization at module load time
let _logger: pino.Logger | null = null;
function getLogger(): pino.Logger {
  if (!_logger) {
    _logger = getComponentLogger("graph:parsing:roslyn-detector");
  }
  return _logger;
}

/**
 * Result of .NET SDK detection.
 */
export interface DotNetDetectionResult {
  /** Whether .NET SDK is available */
  available: boolean;
  /** .NET SDK version if available */
  version?: string;
  /** Error message if not available */
  error?: string;
}

/**
 * Minimum .NET version required for Roslyn analyzer.
 */
const MINIMUM_DOTNET_VERSION = 6;

/**
 * Cache for detection result.
 */
let detectionCache: DotNetDetectionResult | null = null;

/**
 * Detect if .NET SDK is available.
 *
 * Checks for the `dotnet` command and validates minimum version.
 * Results are cached after first check.
 *
 * @returns Detection result with availability status
 */
export async function detectDotNet(): Promise<DotNetDetectionResult> {
  if (detectionCache !== null) {
    return detectionCache;
  }

  try {
    const proc = spawn({
      cmd: ["dotnet", "--version"],
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    if (exitCode !== 0) {
      const error = stderr.trim() || "dotnet command failed";
      getLogger().debug(`dotnet --version failed: ${error}`);
      detectionCache = { available: false, error };
      return detectionCache;
    }

    const version = stdout.trim();
    const majorVersion = parseInt(version.split(".")[0] ?? "0", 10);

    if (isNaN(majorVersion) || majorVersion < MINIMUM_DOTNET_VERSION) {
      const error = `Requires .NET ${MINIMUM_DOTNET_VERSION}+, found ${version}`;
      getLogger().debug(error);
      detectionCache = { available: false, version, error };
      return detectionCache;
    }

    getLogger().debug(`Detected .NET SDK version ${version}`);
    detectionCache = { available: true, version };
    return detectionCache;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    getLogger().debug(`Failed to detect .NET SDK: ${errorMessage}`);
    detectionCache = {
      available: false,
      error: `dotnet command not found: ${errorMessage}`,
    };
    return detectionCache;
  }
}

/**
 * Check if .NET SDK is available (cached).
 *
 * @returns true if .NET SDK is available
 */
export async function isDotNetAvailable(): Promise<boolean> {
  const result = await detectDotNet();
  return result.available;
}

/**
 * Reset the detection cache.
 * Useful for testing.
 */
export function resetDetectionCache(): void {
  detectionCache = null;
}
