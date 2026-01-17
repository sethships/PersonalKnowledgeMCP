/**
 * Unified code parser that routes to language-specific implementations.
 *
 * Routes C# files to Roslyn parser, all other supported languages to tree-sitter.
 * Provides a consistent interface for parsing any supported language.
 *
 * @module graph/parsing/CodeParser
 */

import * as path from "path";
import type pino from "pino";
import { getComponentLogger } from "../../logging/index.js";
import { TreeSitterParser } from "./TreeSitterParser.js";
import { RoslynParser } from "./roslyn/index.js";
import type { ParseResult, ParserConfig, SupportedLanguage } from "./types.js";
import { EXTENSION_TO_LANGUAGE, isSupportedExtension } from "./types.js";

// Lazy-initialized logger to avoid requiring logger initialization at module load time
let _logger: pino.Logger | null = null;
function getLogger(): pino.Logger {
  if (!_logger) {
    _logger = getComponentLogger("graph:parsing:code-parser");
  }
  return _logger;
}

/**
 * Unified parser that routes to language-specific implementations.
 *
 * - C# files (.cs) → Roslyn parser (requires .NET SDK)
 * - All other supported languages → tree-sitter parser
 *
 * @example
 * ```typescript
 * const parser = new CodeParser();
 *
 * // Parse TypeScript (uses tree-sitter)
 * const tsResult = await parser.parseFile(tsContent, 'src/app.ts');
 *
 * // Parse C# (uses Roslyn)
 * const csResult = await parser.parseFile(csContent, 'src/App.cs');
 * ```
 */
export class CodeParser {
  private readonly treeSitterParser: TreeSitterParser;
  private readonly roslynParser: RoslynParser;

  /**
   * Create a new CodeParser instance.
   *
   * @param config - Optional parser configuration
   */
  constructor(config?: ParserConfig) {
    this.treeSitterParser = new TreeSitterParser(undefined, config);
    this.roslynParser = new RoslynParser(config);
  }

  /**
   * Check if Roslyn is available for C# parsing.
   *
   * @returns true if .NET SDK is installed and available
   */
  async isRoslynAvailable(): Promise<boolean> {
    return this.roslynParser.isAvailable();
  }

  /**
   * Parse a source file, routing to the appropriate parser.
   *
   * @param content - File content to parse
   * @param filePath - Path to the file
   * @returns Parse result with entities, imports, exports, and calls
   * @throws RoslynNotAvailableError if parsing a C# file without .NET SDK
   * @throws LanguageNotSupportedError if file extension is not supported
   */
  async parseFile(content: string, filePath: string): Promise<ParseResult> {
    const ext = path.extname(filePath).toLowerCase();

    if (ext === ".cs") {
      getLogger().debug(`Routing ${filePath} to Roslyn parser`);
      return this.roslynParser.parseFile(content, filePath);
    }

    getLogger().debug(`Routing ${filePath} to tree-sitter parser`);
    return this.treeSitterParser.parseFile(content, filePath);
  }

  /**
   * Parse multiple files, routing each to the appropriate parser.
   *
   * Automatically batches C# files for Roslyn and handles other files
   * with tree-sitter for optimal performance.
   *
   * @param files - Array of file content and path pairs
   * @returns Array of parse results
   */
  async parseFiles(files: Array<{ content: string; filePath: string }>): Promise<ParseResult[]> {
    if (files.length === 0) return [];

    // Separate C# files from others
    const csharpFiles: Array<{ content: string; filePath: string }> = [];
    const otherFiles: Array<{ content: string; filePath: string }> = [];

    for (const file of files) {
      const ext = path.extname(file.filePath).toLowerCase();
      if (ext === ".cs") {
        csharpFiles.push(file);
      } else {
        otherFiles.push(file);
      }
    }

    // Parse in parallel
    const promises: Promise<ParseResult[]>[] = [];

    if (csharpFiles.length > 0) {
      promises.push(this.roslynParser.parseFiles(csharpFiles));
    }

    if (otherFiles.length > 0) {
      promises.push(
        Promise.all(otherFiles.map((f) => this.treeSitterParser.parseFile(f.content, f.filePath)))
      );
    }

    const results = await Promise.all(promises);
    return results.flat();
  }

  /**
   * Check if a file extension is supported by any parser.
   *
   * @param extension - File extension (with or without dot)
   * @returns true if the extension is supported
   */
  static isSupported(extension: string): boolean {
    const ext = extension.startsWith(".") ? extension : `.${extension}`;
    return isSupportedExtension(ext.toLowerCase());
  }

  /**
   * Get the language for a file extension.
   *
   * @param extension - File extension (with or without dot)
   * @returns The supported language, or null if not supported
   */
  static getLanguageFromExtension(extension: string): SupportedLanguage | null {
    const ext = extension.startsWith(".") ? extension : `.${extension}`;
    return EXTENSION_TO_LANGUAGE[ext.toLowerCase()] ?? null;
  }

  /**
   * Check if a language uses Roslyn (requires .NET SDK).
   *
   * @param language - Language to check
   * @returns true if the language requires Roslyn
   */
  static usesRoslyn(language: SupportedLanguage): boolean {
    return language === "csharp";
  }

  /**
   * Get all supported file extensions.
   *
   * @returns Array of supported extensions (with dots)
   */
  static getSupportedExtensions(): string[] {
    return Object.keys(EXTENSION_TO_LANGUAGE);
  }

  /**
   * Get the underlying tree-sitter parser instance.
   * Useful for accessing tree-sitter specific functionality.
   */
  getTreeSitterParser(): TreeSitterParser {
    return this.treeSitterParser;
  }

  /**
   * Get the underlying Roslyn parser instance.
   * Useful for accessing Roslyn specific functionality.
   */
  getRoslynParser(): RoslynParser {
    return this.roslynParser;
  }
}
