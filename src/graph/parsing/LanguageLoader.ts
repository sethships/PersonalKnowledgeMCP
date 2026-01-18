/**
 * Tree-sitter language loader.
 *
 * Handles lazy loading and caching of tree-sitter WASM language grammars.
 * Uses singleton pattern to ensure parser is initialized only once.
 *
 * @module graph/parsing/LanguageLoader
 */

import { Parser, Language } from "web-tree-sitter";
import path from "node:path";
import { existsSync as fsExistsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type pino from "pino";
import { getComponentLogger } from "../../logging/index.js";
import type { TreeSitterLanguage } from "./types.js";
import { LanguageLoadError, ParserInitializationError } from "./errors.js";

/**
 * Maps supported languages to their WASM file paths.
 *
 * Note: Only tree-sitter languages are included here.
 * C# (csharp) uses Roslyn instead of tree-sitter and is
 * handled by the RoslynParser class.
 */
interface WasmPathConfig {
  /** Path to the main tree-sitter WASM module */
  treeSitterWasm: string;
  /** Paths to language-specific WASM files (tree-sitter only) */
  languages: Record<TreeSitterLanguage, string>;
}

/**
 * Get the directory containing this module.
 * Used to resolve relative paths to WASM files.
 */
function getModuleDir(): string {
  // Handle ESM module context
  try {
    const __filename = fileURLToPath(import.meta.url);
    return path.dirname(__filename);
  } catch {
    // Fallback for environments where import.meta.url isn't available
    return process.cwd();
  }
}

/**
 * Resolve the path to a WASM file in node_modules.
 *
 * Searches for WASM files relative to the project root.
 *
 * @param packagePath - Path within node_modules
 * @returns Absolute path to the WASM file
 */
function resolveWasmPath(packagePath: string): string {
  // Try to resolve from current working directory first (project root)
  const cwdPath = path.join(process.cwd(), "node_modules", packagePath);
  if (fsExistsSync(cwdPath)) {
    return cwdPath;
  }

  // Find the project root by looking for node_modules
  let currentDir = getModuleDir();
  let attempts = 0;
  const maxAttempts = 10;

  while (attempts < maxAttempts) {
    const candidatePath = path.join(currentDir, "node_modules", packagePath);
    // Use fsExistsSync for reliable file existence check
    if (fsExistsSync(candidatePath)) {
      return candidatePath;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      // Reached filesystem root
      break;
    }
    currentDir = parentDir;
    attempts++;
  }

  // Fallback: return the path relative to cwd
  return path.join(process.cwd(), "node_modules", packagePath);
}

/**
 * Get the default WASM path configuration.
 *
 * @returns Configuration with paths to all required WASM files
 */
function getDefaultWasmPaths(): WasmPathConfig {
  return {
    treeSitterWasm: resolveWasmPath("web-tree-sitter/web-tree-sitter.wasm"),
    languages: {
      typescript: resolveWasmPath("tree-sitter-typescript/tree-sitter-typescript.wasm"),
      tsx: resolveWasmPath("tree-sitter-typescript/tree-sitter-tsx.wasm"),
      javascript: resolveWasmPath("tree-sitter-javascript/tree-sitter-javascript.wasm"),
      jsx: resolveWasmPath("tree-sitter-javascript/tree-sitter-javascript.wasm"),
      python: resolveWasmPath("tree-sitter-python/tree-sitter-python.wasm"),
      java: resolveWasmPath("tree-sitter-java/tree-sitter-java.wasm"),
      go: resolveWasmPath("tree-sitter-go/tree-sitter-go.wasm"),
      rust: resolveWasmPath("tree-sitter-rust/tree-sitter-rust.wasm"),
      c: resolveWasmPath("tree-sitter-c/tree-sitter-c.wasm"),
      cpp: resolveWasmPath("tree-sitter-cpp/tree-sitter-cpp.wasm"),
      ruby: resolveWasmPath("tree-sitter-ruby/tree-sitter-ruby.wasm"),
    },
  };
}

/**
 * Loader for tree-sitter language grammars.
 *
 * Uses singleton pattern to ensure the parser is initialized only once
 * and languages are cached after first load. Thread-safe for async
 * initialization.
 *
 * @example
 * ```typescript
 * const loader = LanguageLoader.getInstance();
 * await loader.initialize();
 *
 * const parser = await loader.getParser();
 * const tsLang = await loader.getLanguage('typescript');
 * parser.setLanguage(tsLang);
 *
 * const tree = parser.parse('const x = 1;');
 * ```
 */
export class LanguageLoader {
  private static instance: LanguageLoader | null = null;

  private parser: Parser | null = null;
  /**
   * Cache of loaded language grammars.
   *
   * Design Decision: Languages are cached indefinitely without an eviction policy.
   * This is acceptable because:
   * 1. The current supported language set is small (8 languages)
   * 2. Each WASM language grammar is relatively small (~100-200KB)
   * 3. Languages are typically loaded once and reused throughout the application lifecycle
   *
   * If language support is expanded significantly in the future, consider implementing
   * an LRU cache with configurable max size to bound memory usage.
   *
   * Note: Only tree-sitter languages are cached here. C# uses Roslyn (see RoslynParser).
   */
  private languages: Map<TreeSitterLanguage, Language> = new Map();
  private initPromise: Promise<void> | null = null;
  private readonly wasmPaths: WasmPathConfig;
  private _logger: pino.Logger | null = null;

  /**
   * Create a new LanguageLoader instance.
   *
   * @param wasmPaths - Optional custom WASM path configuration
   */
  constructor(wasmPaths?: Partial<WasmPathConfig>) {
    const defaults = getDefaultWasmPaths();
    this.wasmPaths = {
      treeSitterWasm: wasmPaths?.treeSitterWasm ?? defaults.treeSitterWasm,
      languages: {
        ...defaults.languages,
        ...wasmPaths?.languages,
      },
    };
  }

  /**
   * Get the component logger (lazy initialization).
   */
  private get logger(): pino.Logger {
    if (!this._logger) {
      this._logger = getComponentLogger("graph:parsing:loader");
    }
    return this._logger;
  }

  /**
   * Get the singleton instance of LanguageLoader.
   *
   * @returns The shared LanguageLoader instance
   */
  static getInstance(): LanguageLoader {
    if (!LanguageLoader.instance) {
      LanguageLoader.instance = new LanguageLoader();
    }
    return LanguageLoader.instance;
  }

  /**
   * Reset the singleton instance.
   *
   * Primarily used for testing to ensure clean state.
   */
  static resetInstance(): void {
    if (LanguageLoader.instance?.parser) {
      LanguageLoader.instance.parser.delete();
    }
    LanguageLoader.instance = null;
  }

  /**
   * Initialize the tree-sitter parser.
   *
   * This must be called before using getParser() or getLanguage().
   * Safe to call multiple times - subsequent calls are no-ops.
   *
   * @throws {ParserInitializationError} If initialization fails
   */
  async initialize(): Promise<void> {
    // Return existing promise if initialization is in progress
    if (this.initPromise) {
      return this.initPromise;
    }

    // Already initialized
    if (this.parser) {
      return;
    }

    this.initPromise = this.doInitialize();
    return this.initPromise;
  }

  /**
   * Internal initialization logic.
   */
  private async doInitialize(): Promise<void> {
    const startTime = performance.now();

    try {
      this.logger.debug(
        { wasmPath: this.wasmPaths.treeSitterWasm },
        "Initializing tree-sitter parser"
      );

      // Initialize the tree-sitter WASM module.
      // NOTE: Parser.init() is a global operation in web-tree-sitter. It initializes the
      // WASM module once per process. Subsequent calls with different configurations will
      // still succeed but will use the already-loaded WASM module. This is expected behavior
      // and why we use the singleton pattern - to ensure consistent initialization.
      await Parser.init({
        locateFile: (scriptName: string) => {
          if (scriptName === "web-tree-sitter.wasm" || scriptName === "tree-sitter.wasm") {
            return this.wasmPaths.treeSitterWasm;
          }
          return scriptName;
        },
      });

      this.parser = new Parser();

      const duration = performance.now() - startTime;
      this.logger.info(
        {
          metric: "language_loader.init_ms",
          value: Math.round(duration),
        },
        "Tree-sitter parser initialized"
      );
    } catch (error) {
      this.initPromise = null; // Allow retry
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        { err, wasmPath: this.wasmPaths.treeSitterWasm },
        "Failed to initialize tree-sitter parser"
      );
      throw new ParserInitializationError(err.message, err);
    }
  }

  /**
   * Get the initialized parser instance.
   *
   * @returns The tree-sitter parser
   * @throws {ParserInitializationError} If parser is not initialized
   */
  async getParser(): Promise<Parser> {
    if (!this.parser) {
      await this.initialize();
    }
    if (!this.parser) {
      throw new ParserInitializationError("Parser initialization failed");
    }
    return this.parser;
  }

  /**
   * Check if a language is already loaded.
   *
   * @param language - The tree-sitter language to check
   * @returns true if the language is cached
   */
  isLanguageLoaded(language: TreeSitterLanguage): boolean {
    return this.languages.has(language);
  }

  /**
   * Get a loaded language grammar.
   *
   * Loads the language WASM file if not already cached.
   * Only supports tree-sitter languages. For C#, use RoslynParser instead.
   *
   * @param language - The tree-sitter language to load
   * @returns The loaded language grammar
   * @throws {LanguageLoadError} If the language fails to load
   */
  async getLanguage(language: TreeSitterLanguage): Promise<Language> {
    // Return cached language
    const cached = this.languages.get(language);
    if (cached) {
      return cached;
    }

    // Ensure parser is initialized
    await this.initialize();

    const startTime = performance.now();
    const wasmPath = this.wasmPaths.languages[language];

    try {
      this.logger.debug({ language, wasmPath }, "Loading language grammar");

      // Read WASM file as Uint8Array to work around Bun compatibility issues
      // Bun's Buffer on Linux may not have subarray() method expected by web-tree-sitter
      // By reading as Buffer and converting to Uint8Array, we ensure compatibility
      const wasmBuffer = readFileSync(wasmPath);
      const wasmBytes = new Uint8Array(
        wasmBuffer.buffer,
        wasmBuffer.byteOffset,
        wasmBuffer.byteLength
      );

      const lang = await Language.load(wasmBytes);
      this.languages.set(language, lang);

      const duration = performance.now() - startTime;
      this.logger.info(
        {
          metric: "language_loader.load_language_ms",
          value: Math.round(duration),
          language,
        },
        "Language grammar loaded"
      );

      return lang;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error({ err, language, wasmPath }, "Failed to load language grammar");
      throw new LanguageLoadError(language, err);
    }
  }

  /**
   * Preload all tree-sitter languages.
   *
   * Useful for warming up the cache during application startup.
   * Note: C# uses Roslyn and is not preloaded here.
   *
   * @returns Map of languages to their load status (true = success)
   */
  async preloadAllLanguages(): Promise<Map<TreeSitterLanguage, boolean>> {
    const results = new Map<TreeSitterLanguage, boolean>();
    const languages: TreeSitterLanguage[] = [
      "typescript",
      "tsx",
      "javascript",
      "jsx",
      "python",
      "java",
      "go",
      "rust",
      "c",
      "cpp",
      "ruby",
    ];

    await Promise.all(
      languages.map(async (lang) => {
        try {
          await this.getLanguage(lang);
          results.set(lang, true);
        } catch {
          results.set(lang, false);
        }
      })
    );

    return results;
  }

  /**
   * Get information about loaded languages.
   *
   * @returns Object with initialization status and loaded tree-sitter languages
   */
  getStatus(): {
    initialized: boolean;
    loadedLanguages: TreeSitterLanguage[];
    wasmPaths: WasmPathConfig;
  } {
    return {
      initialized: this.parser !== null,
      loadedLanguages: Array.from(this.languages.keys()),
      wasmPaths: this.wasmPaths,
    };
  }

  /**
   * Clean up resources.
   *
   * Deletes the parser instance and clears the language cache.
   * The loader can be reinitialized after cleanup.
   */
  cleanup(): void {
    if (this.parser) {
      this.parser.delete();
      this.parser = null;
    }
    this.languages.clear();
    this.initPromise = null;
    this.logger.debug("LanguageLoader cleaned up");
  }
}
