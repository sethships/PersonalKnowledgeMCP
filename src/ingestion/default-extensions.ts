/**
 * Default file extensions for repository indexing.
 *
 * Shared constant used by FileScanner (initial indexing) and
 * IncrementalUpdatePipeline (incremental updates) to ensure
 * consistent file filtering across both code paths.
 *
 * @module ingestion/default-extensions
 */

/**
 * Default file extensions to include in scans.
 *
 * Covers common source code, documentation, and configuration files.
 * Used as fallback when no custom extensions are specified or when
 * repository metadata has an empty includeExtensions array.
 */
export const DEFAULT_EXTENSIONS = [
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
