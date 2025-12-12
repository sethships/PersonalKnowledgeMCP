/**
 * File scanner for repository indexing.
 *
 * Provides recursive directory scanning with extension filtering,
 * .gitignore support, and cross-platform path handling.
 *
 * @module ingestion/file-scanner
 */

import { glob } from "glob";
import ignore from "ignore";
import { stat, access, readFile } from "fs/promises";
import { join, resolve, extname, sep, isAbsolute } from "path";
import { posix } from "path";
import type pino from "pino";
import { getComponentLogger } from "../logging/index.js";
import type { ScanOptions, FileInfo, FileScannerConfig } from "./types.js";
import { ValidationError, FileScanError } from "./errors.js";

/**
 * Scans repository directories to identify files for indexing.
 *
 * Features:
 * - Recursive directory scanning with glob patterns
 * - .gitignore rule application
 * - Configurable file extension filtering
 * - Default exclusion patterns (node_modules, build artifacts)
 * - File size filtering (>1MB excluded)
 * - Cross-platform path handling
 * - Optional progress reporting
 *
 * @example
 * ```typescript
 * const scanner = new FileScanner();
 *
 * // Basic usage with defaults
 * const files = await scanner.scanFiles('./data/repos/my-repo');
 *
 * // With custom options
 * const files = await scanner.scanFiles('./data/repos/my-repo', {
 *   includeExtensions: ['.ts', '.md'],
 *   excludePatterns: ['docs/**'],
 *   onProgress: (scanned, total) => console.log(`${scanned}/${total}`)
 * });
 *
 * console.log(`Found ${files.length} files`);
 * files.forEach(file => {
 *   console.log(`${file.relativePath} (${file.sizeBytes} bytes)`);
 * });
 * ```
 */
export class FileScanner {
  private readonly logger: pino.Logger;
  private readonly config: Required<FileScannerConfig>;

  /**
   * Default file extensions to include in scans.
   *
   * Covers common source code, documentation, and configuration files.
   */
  private readonly DEFAULT_EXTENSIONS = [
    // JavaScript/TypeScript
    ".js",
    ".ts",
    ".jsx",
    ".tsx",
    // C#
    ".cs",
    // Python
    ".py",
    // Other languages
    ".java",
    ".go",
    ".rs",
    // C/C++
    ".cpp",
    ".c",
    ".h",
    // Documentation
    ".md",
    ".txt",
    ".rst",
    // Configuration
    ".json",
    ".yaml",
    ".yml",
    ".toml",
  ] as const;

  /**
   * Default patterns to exclude from scans.
   *
   * Excludes dependency directories, build artifacts, and minified files.
   */
  private readonly DEFAULT_EXCLUSIONS = [
    "node_modules/**",
    ".git/**",
    "dist/**",
    "build/**",
    "bin/**",
    "obj/**",
    "*.min.js",
    "*.min.css",
    "package-lock.json",
    "yarn.lock",
  ] as const;

  /**
   * Maximum file size in bytes (1MB).
   *
   * Files larger than this are excluded from indexing.
   */
  private readonly MAX_FILE_SIZE_BYTES = 1048576; // 1MB

  /**
   * Create a new FileScanner instance.
   *
   * @param config - Optional configuration
   */
  constructor(config: FileScannerConfig = {}) {
    this.logger = getComponentLogger("ingestion:file-scanner");
    this.config = {
      maxFileSizeBytes: config.maxFileSizeBytes ?? this.MAX_FILE_SIZE_BYTES,
    };
  }

  /**
   * Scan a repository directory for indexable files.
   *
   * Algorithm:
   * 1. Validate repository path exists and is accessible
   * 2. Load .gitignore rules if present
   * 3. Build glob patterns from extensions
   * 4. Execute glob with exclusion patterns
   * 5. Apply gitignore filtering
   * 6. Stat each file for metadata
   * 7. Filter by file size
   * 8. Normalize paths to POSIX format
   * 9. Return sorted results
   *
   * @param repoPath - Absolute path to repository root
   * @param options - Scan configuration options
   * @returns Array of file metadata sorted by relative path
   * @throws {ValidationError} If repoPath is invalid or doesn't exist
   * @throws {FileScanError} If scanning fails (permissions, I/O errors)
   *
   * @example
   * ```typescript
   * const scanner = new FileScanner();
   * try {
   *   const files = await scanner.scanFiles('/path/to/repo', {
   *     includeExtensions: ['.ts', '.js'],
   *     onProgress: (scanned, total) => {
   *       console.log(`Progress: ${scanned}/${total}`);
   *     }
   *   });
   *   console.log(`Found ${files.length} files`);
   * } catch (error) {
   *   if (error instanceof ValidationError) {
   *     console.error('Invalid repository path:', error.message);
   *   } else if (error instanceof FileScanError) {
   *     console.error('Scan failed:', error.message);
   *   }
   * }
   * ```
   */
  async scanFiles(repoPath: string, options: ScanOptions = {}): Promise<FileInfo[]> {
    const startTime = Date.now();
    this.logger.info({ repoPath, options }, "Starting file scan");

    try {
      // 1. Validate and normalize repository path
      const normalizedRepoPath = await this.validateRepoPath(repoPath);

      // 2. Load .gitignore rules
      const gitignore = await this.loadGitignore(normalizedRepoPath);

      // 3. Determine extensions and exclusions
      const extensions = options.includeExtensions ?? [...this.DEFAULT_EXTENSIONS];
      const exclusions = [...this.DEFAULT_EXCLUSIONS, ...(options.excludePatterns ?? [])];

      // 4. Execute glob scan
      const matchedPaths = await this.executeGlobScan(normalizedRepoPath, extensions, exclusions);

      this.logger.debug({ count: matchedPaths.length }, "Glob scan complete, applying gitignore");

      // 5. Apply gitignore filtering
      const filteredPaths = this.applyGitignoreFilter(matchedPaths, gitignore);

      this.logger.debug(
        { before: matchedPaths.length, after: filteredPaths.length },
        "Gitignore filtering complete"
      );

      // 6. Collect file metadata with progress reporting
      const fileInfos = await this.collectFileMetadata(
        normalizedRepoPath,
        filteredPaths,
        options.onProgress
      );

      // 7. Sort by relative path for consistent output
      fileInfos.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

      const duration = Date.now() - startTime;
      this.logger.info(
        {
          metric: "file_scan.duration_ms",
          value: duration,
          fileCount: fileInfos.length,
          repoPath,
        },
        "File scan complete"
      );

      return fileInfos;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(
        {
          metric: "file_scan.error",
          duration_ms: duration,
          repoPath,
          err: error,
        },
        "File scan failed"
      );

      if (error instanceof ValidationError || error instanceof FileScanError) {
        throw error;
      }

      throw new FileScanError(
        `Failed to scan repository: ${error instanceof Error ? error.message : "unknown error"}`,
        repoPath,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Validate that the repository path exists and is accessible.
   *
   * @param repoPath - Path to validate
   * @returns Normalized absolute path
   * @throws {ValidationError} If path is invalid or inaccessible
   */
  private async validateRepoPath(repoPath: string): Promise<string> {
    // Check if path is provided
    if (!repoPath || repoPath.trim() === "") {
      throw new ValidationError("Repository path is required", "repoPath");
    }

    // Check if path is absolute
    if (!isAbsolute(repoPath)) {
      throw new ValidationError(`Repository path must be absolute, got: ${repoPath}`, "repoPath");
    }

    // Normalize path
    const normalizedPath = resolve(repoPath);

    // Check if directory exists and is accessible
    try {
      await access(normalizedPath);
      const stats = await stat(normalizedPath);

      if (!stats.isDirectory()) {
        throw new ValidationError(`Path is not a directory: ${normalizedPath}`, "repoPath");
      }

      return normalizedPath;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new ValidationError(
          `Directory does not exist: ${normalizedPath}`,
          "repoPath",
          error as Error
        );
      }

      if ((error as NodeJS.ErrnoException).code === "EACCES") {
        throw new ValidationError(
          `Permission denied accessing directory: ${normalizedPath}`,
          "repoPath",
          error as Error
        );
      }

      throw error;
    }
  }

  /**
   * Load .gitignore rules from repository root.
   *
   * If .gitignore doesn't exist or can't be read, returns an empty
   * ignore instance (no filtering applied).
   *
   * @param repoPath - Repository root path
   * @returns Ignore instance with loaded rules
   */
  private async loadGitignore(repoPath: string): Promise<ReturnType<typeof ignore>> {
    const ig = ignore();
    const gitignorePath = join(repoPath, ".gitignore");

    try {
      await access(gitignorePath);
      const content = await readFile(gitignorePath, "utf-8");
      ig.add(content);

      const ruleCount = content.split("\n").filter((line) => {
        const trimmed = line.trim();
        return trimmed && !trimmed.startsWith("#");
      }).length;

      this.logger.debug({ gitignorePath, ruleCount }, "Loaded .gitignore rules");
    } catch (error) {
      // No .gitignore or unreadable - not an error, just log debug
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.logger.debug({ gitignorePath }, "No .gitignore found, using no rules");
      } else {
        this.logger.debug(
          { gitignorePath, err: error },
          "Could not load .gitignore (using no rules)"
        );
      }
    }

    return ig;
  }

  /**
   * Execute glob scan with extension patterns and exclusions.
   *
   * @param repoPath - Repository root path
   * @param extensions - File extensions to include
   * @param exclusions - Glob patterns to exclude
   * @returns Array of relative file paths
   * @throws {FileScanError} If glob fails
   */
  private async executeGlobScan(
    repoPath: string,
    extensions: readonly string[] | string[],
    exclusions: readonly string[] | string[]
  ): Promise<string[]> {
    // Build patterns: **/*.ts, **/*.js, etc.
    const patterns = extensions.map((ext) => `**/*${ext}`);

    this.logger.debug({ patterns, exclusions, repoPath }, "Executing glob scan");

    try {
      const files = await glob(patterns, {
        cwd: repoPath,
        ignore: [...exclusions],
        nodir: true, // Files only, no directories
        absolute: false, // Return relative paths
        dot: false, // Don't match dotfiles (except .gitignore already handles this)
      });

      return files;
    } catch (error) {
      throw new FileScanError(
        `Glob scan failed: ${error instanceof Error ? error.message : "unknown error"}`,
        repoPath,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Apply .gitignore filtering to file paths.
   *
   * @param paths - File paths to filter
   * @param gitignore - Ignore instance with rules
   * @returns Filtered paths (not ignored)
   */
  private applyGitignoreFilter(paths: string[], gitignore: ReturnType<typeof ignore>): string[] {
    // The ignore library's filter() method returns paths NOT ignored
    return gitignore.filter(paths);
  }

  /**
   * Collect file metadata for all paths.
   *
   * Individual file errors are logged but don't fail the entire scan.
   * Files larger than maxFileSizeBytes are excluded.
   *
   * @param repoPath - Repository root path
   * @param relativePaths - Relative file paths
   * @param onProgress - Optional progress callback
   * @returns Array of file metadata
   */
  private async collectFileMetadata(
    repoPath: string,
    relativePaths: string[],
    onProgress?: (scanned: number, total: number) => void
  ): Promise<FileInfo[]> {
    const results: FileInfo[] = [];
    const total = relativePaths.length;

    for (let i = 0; i < relativePaths.length; i++) {
      const relativePath = relativePaths[i];
      if (!relativePath) continue; // Skip undefined entries

      const absolutePath = resolve(repoPath, relativePath);

      try {
        const stats = await stat(absolutePath);

        // Skip files exceeding size limit
        if (stats.size > this.config.maxFileSizeBytes) {
          this.logger.debug(
            {
              relativePath,
              sizeBytes: stats.size,
              limit: this.config.maxFileSizeBytes,
            },
            "Skipping oversized file"
          );
          continue;
        }

        // Skip non-files (defensive, glob should handle this)
        if (!stats.isFile()) {
          this.logger.debug({ relativePath }, "Skipping non-file");
          continue;
        }

        const extension = extname(relativePath).toLowerCase();

        results.push({
          relativePath: this.normalizeToPosix(relativePath),
          absolutePath,
          extension,
          sizeBytes: stats.size,
          modifiedAt: stats.mtime,
        });

        // Report progress every 100 files
        if (onProgress && i % 100 === 0) {
          onProgress(i + 1, total);
        }
      } catch (error) {
        // Log individual file errors but continue scanning
        this.logger.warn({ relativePath, err: error }, "Failed to stat file, skipping");
      }
    }

    // Final progress callback
    if (onProgress) {
      onProgress(results.length, total);
    }

    return results;
  }

  /**
   * Normalize Windows paths to POSIX format.
   *
   * Converts backslashes to forward slashes for cross-platform
   * consistency when storing paths in databases.
   *
   * @param windowsPath - Path with platform-native separators
   * @returns Path with POSIX separators (forward slashes)
   *
   * @example
   * ```typescript
   * normalizeToPosix('src\\components\\Button.tsx')
   * // Returns: 'src/components/Button.tsx'
   * ```
   */
  private normalizeToPosix(windowsPath: string): string {
    // Convert Windows backslashes to POSIX forward slashes
    // Ensures consistent paths in database regardless of platform
    return windowsPath.split(sep).join(posix.sep);
  }
}
