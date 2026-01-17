/**
 * Roslyn parser wrapper for C# files.
 *
 * Delegates C# parsing to the Roslyn analyzer CLI and converts
 * the output to the standard ParseResult format.
 *
 * @module graph/parsing/roslyn/RoslynParser
 */

import { spawn } from "bun";
import * as path from "path";
import type pino from "pino";
import { getComponentLogger } from "../../../logging/index.js";
import { RoslynNotAvailableError } from "../errors.js";
import type { ParseResult, ParserConfig } from "../types.js";
import { isDotNetAvailable, detectDotNet } from "./RoslynDetector.js";

// Lazy-initialized logger to avoid requiring logger initialization at module load time
let _logger: pino.Logger | null = null;
function getLogger(): pino.Logger {
  if (!_logger) {
    _logger = getComponentLogger("graph:parsing:roslyn-parser");
  }
  return _logger;
}

/**
 * Parser implementation that delegates C# parsing to Roslyn CLI.
 */
export class RoslynParser {
  private readonly config: Required<ParserConfig>;
  private analyzerPath: string | null = null;

  constructor(config?: ParserConfig) {
    const defaults: Required<ParserConfig> = {
      extractDocumentation: true,
      includeAnonymous: false,
      maxFileSizeBytes: 1048576,
      parseTimeoutMs: 30000, // Higher timeout for Roslyn startup
    };
    this.config = { ...defaults, ...config };
  }

  /**
   * Check if Roslyn is available for C# parsing.
   *
   * @returns true if .NET SDK is available
   */
  async isAvailable(): Promise<boolean> {
    return isDotNetAvailable();
  }

  /**
   * Get detailed availability information.
   *
   * @returns Detection result with version and error details
   */
  async getAvailability(): ReturnType<typeof detectDotNet> {
    return detectDotNet();
  }

  /**
   * Parse a C# file using Roslyn analyzer CLI.
   *
   * @param content - File content to parse
   * @param filePath - Path to the file (for error messages and metadata)
   * @returns Parse result with entities, imports, and calls
   * @throws RoslynNotAvailableError if .NET SDK is not installed
   */
  async parseFile(content: string, filePath: string): Promise<ParseResult> {
    const startTime = performance.now();

    // Check if Roslyn is available
    if (!(await this.isAvailable())) {
      throw new RoslynNotAvailableError(filePath);
    }

    try {
      const result = await this.invokeRoslyn(content, filePath);
      result.parseTimeMs = performance.now() - startTime;
      return result;
    } catch (error) {
      // If it's already a RoslynNotAvailableError, rethrow
      if (error instanceof RoslynNotAvailableError) {
        throw error;
      }

      // Return error result rather than throwing for other errors
      const parseTimeMs = performance.now() - startTime;
      getLogger().error(`Roslyn parsing failed for ${filePath}:`, error);

      return {
        filePath,
        language: "csharp",
        entities: [],
        imports: [],
        exports: [],
        calls: [],
        parseTimeMs,
        errors: [
          {
            message: error instanceof Error ? error.message : String(error),
            recoverable: false,
          },
        ],
        success: false,
      };
    }
  }

  /**
   * Parse multiple C# files in batch mode for better performance.
   *
   * @param files - Array of file content and path pairs
   * @returns Array of parse results
   * @throws RoslynNotAvailableError if .NET SDK is not installed
   */
  async parseFiles(files: Array<{ content: string; filePath: string }>): Promise<ParseResult[]> {
    if (files.length === 0) return [];

    // Check if Roslyn is available
    if (!(await this.isAvailable())) {
      throw new RoslynNotAvailableError(files[0]?.filePath ?? "<unknown>");
    }

    // For small batches, individual processing is fine
    if (files.length <= 3) {
      return Promise.all(files.map((f) => this.parseFile(f.content, f.filePath)));
    }

    // For larger batches, use batch mode
    const startTime = performance.now();

    try {
      const results = await this.invokeRoslynBatch(files);
      const totalTime = performance.now() - startTime;
      getLogger().debug(`Batch parsed ${files.length} files in ${totalTime.toFixed(1)}ms`);
      return results;
    } catch (error) {
      getLogger().error("Batch parsing failed, falling back to individual parsing:", error);
      // Fallback to individual parsing
      return Promise.all(files.map((f) => this.parseFile(f.content, f.filePath)));
    }
  }

  /**
   * Resolve the path to the Roslyn analyzer project.
   */
  private async resolveAnalyzerPath(): Promise<string> {
    if (this.analyzerPath) {
      return this.analyzerPath;
    }

    // Find the tools/roslyn-analyzer directory relative to the project root
    // This works whether we're running from src/, dist/, or the project root
    const possiblePaths = [
      path.join(process.cwd(), "tools", "roslyn-analyzer"),
      path.join(process.cwd(), "..", "tools", "roslyn-analyzer"),
      path.join(__dirname, "..", "..", "..", "..", "tools", "roslyn-analyzer"),
    ];

    for (const p of possiblePaths) {
      try {
        const projectFile = path.join(p, "RoslynAnalyzer.csproj");
        // Use exists() for safe async file detection (Bun.file().size may be a Promise)
        if (await Bun.file(projectFile).exists()) {
          this.analyzerPath = p;
          return p;
        }
      } catch {
        // Continue to next path
      }
    }

    // Default to cwd-relative path
    this.analyzerPath = path.join(process.cwd(), "tools", "roslyn-analyzer");
    return this.analyzerPath;
  }

  /**
   * Invoke Roslyn analyzer for a single file.
   */
  private async invokeRoslyn(content: string, filePath: string): Promise<ParseResult> {
    const analyzerPath = await this.resolveAnalyzerPath();

    const proc = spawn({
      cmd: ["dotnet", "run", "--project", analyzerPath, "--", filePath],
      stdin: new Blob([content]),
      stdout: "pipe",
      stderr: "pipe",
    });

    // Set up timeout with proper cleanup to prevent memory leaks
    let timeoutId: Timer | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        proc.kill();
        reject(new Error(`Roslyn parsing timed out after ${this.config.parseTimeoutMs}ms`));
      }, this.config.parseTimeoutMs);
    });

    try {
      const exitCode = await Promise.race([proc.exited, timeoutPromise]);
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();

      if (exitCode !== 0) {
        throw new Error(`Roslyn analyzer failed (exit ${exitCode}): ${stderr.trim()}`);
      }

      const result = JSON.parse(stdout) as ParseResult;

      // Ensure language is set correctly
      return {
        ...result,
        language: "csharp",
      };
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Failed to parse Roslyn output: ${error.message}`);
      }
      throw error;
    } finally {
      // Clear timeout to prevent memory leak
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  /**
   * Invoke Roslyn analyzer in batch mode.
   */
  private async invokeRoslynBatch(
    files: Array<{ content: string; filePath: string }>
  ): Promise<ParseResult[]> {
    const analyzerPath = await this.resolveAnalyzerPath();

    const input = JSON.stringify(
      files.map((f) => ({
        path: f.filePath,
        content: f.content,
      }))
    );

    const proc = spawn({
      cmd: ["dotnet", "run", "--project", analyzerPath, "--", "--batch"],
      stdin: new Blob([input]),
      stdout: "pipe",
      stderr: "pipe",
    });

    // Longer timeout for batch processing with proper cleanup to prevent memory leaks
    const batchTimeout = this.config.parseTimeoutMs * Math.min(files.length, 10);
    let timeoutId: Timer | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        proc.kill();
        reject(new Error(`Batch parsing timed out after ${batchTimeout}ms`));
      }, batchTimeout);
    });

    try {
      const exitCode = await Promise.race([proc.exited, timeoutPromise]);
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();

      if (exitCode !== 0) {
        throw new Error(`Roslyn batch analyzer failed (exit ${exitCode}): ${stderr.trim()}`);
      }

      const results = JSON.parse(stdout) as ParseResult[];

      // Ensure language is set correctly for all results
      return results.map((r) => ({
        ...r,
        language: "csharp" as const,
      }));
    } finally {
      // Clear timeout to prevent memory leak
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }
}
