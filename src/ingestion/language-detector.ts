/**
 * Language detector for file extension to programming language mapping.
 *
 * This module provides utilities to detect programming languages from file paths,
 * enabling language-filtered semantic search for TypeScript/JavaScript codebases.
 *
 * @module ingestion/language-detector
 */

import * as path from "path";

/**
 * Supported programming languages for filtering.
 *
 * These values are stored in ChromaDB metadata and used for language-filtered
 * semantic search queries.
 *
 * @example
 * ```typescript
 * const lang: ProgrammingLanguage = "typescript";
 * // Use in semantic search: { language: "typescript" }
 * ```
 */
export type ProgrammingLanguage =
  | "typescript"
  | "tsx"
  | "javascript"
  | "jsx"
  | "java"
  | "go"
  | "python"
  | "rust"
  | "csharp"
  | "c"
  | "cpp"
  | "ruby"
  | "unknown";

/**
 * Valid language values for MCP tool enum.
 *
 * This array defines the supported language values that can be passed to the
 * semantic_search MCP tool's language filter parameter. The "unknown" value
 * is excluded as it's not useful for filtering.
 *
 * @example
 * ```typescript
 * // Used in MCP tool schema validation
 * enum: SUPPORTED_LANGUAGES
 * ```
 */
export const SUPPORTED_LANGUAGES: readonly Exclude<ProgrammingLanguage, "unknown">[] = [
  "typescript",
  "tsx",
  "javascript",
  "jsx",
  "java",
  "go",
  "python",
  "rust",
  "csharp",
  "c",
  "cpp",
  "ruby",
] as const;

/**
 * Detect programming language from file path extension.
 *
 * Maps file extensions to programming language identifiers suitable for
 * semantic search filtering. Returns "unknown" for unrecognized extensions.
 *
 * @param filePath - File path with extension (can be absolute or relative)
 * @returns Programming language identifier
 *
 * @example
 * ```typescript
 * detectLanguage("src/utils/auth.ts");      // "typescript"
 * detectLanguage("components/Button.tsx");   // "tsx"
 * detectLanguage("lib/helpers.js");          // "javascript"
 * detectLanguage("app/page.jsx");            // "jsx"
 * detectLanguage("config.json");             // "unknown"
 * ```
 */
export function detectLanguage(filePath: string): ProgrammingLanguage {
  const extension = path.extname(filePath).toLowerCase();

  switch (extension) {
    case ".ts":
    case ".mts":
    case ".cts":
      return "typescript";
    case ".tsx":
      return "tsx";
    case ".js":
    case ".mjs":
    case ".cjs":
      return "javascript";
    case ".jsx":
      return "jsx";
    case ".java":
      return "java";
    case ".go":
      return "go";
    case ".py":
    case ".pyw":
    case ".pyi":
      return "python";
    case ".rs":
      return "rust";
    case ".cs":
      return "csharp";
    case ".c":
    case ".h":
      return "c";
    case ".cpp":
    case ".cc":
    case ".cxx":
    case ".hpp":
    case ".hxx":
      return "cpp";
    case ".rb":
    case ".rake":
    case ".gemspec":
      return "ruby";
    default:
      return "unknown";
  }
}
