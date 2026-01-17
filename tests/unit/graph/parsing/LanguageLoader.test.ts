/**
 * Unit tests for LanguageLoader.
 *
 * Tests tree-sitter WASM language loading and caching.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { LanguageLoader } from "../../../../src/graph/parsing/LanguageLoader.js";
import { LanguageLoadError } from "../../../../src/graph/parsing/errors.js";
import { initializeLogger, resetLogger } from "../../../../src/logging/index.js";

describe("LanguageLoader", () => {
  beforeAll(() => {
    initializeLogger({ level: "error", format: "json" });
  });

  afterAll(() => {
    resetLogger();
  });

  afterEach(() => {
    // Reset singleton for test isolation
    LanguageLoader.resetInstance();
  });

  describe("singleton pattern", () => {
    it("should return the same instance", () => {
      const loader1 = LanguageLoader.getInstance();
      const loader2 = LanguageLoader.getInstance();

      expect(loader1).toBe(loader2);
    });

    it("should reset instance correctly", () => {
      const loader1 = LanguageLoader.getInstance();
      LanguageLoader.resetInstance();
      const loader2 = LanguageLoader.getInstance();

      expect(loader1).not.toBe(loader2);
    });
  });

  describe("initialization", () => {
    it("should initialize successfully", async () => {
      const loader = new LanguageLoader();

      await loader.initialize();

      const status = loader.getStatus();
      expect(status.initialized).toBe(true);
    });

    it("should handle multiple initialization calls", async () => {
      const loader = new LanguageLoader();

      // Call initialize multiple times concurrently
      await Promise.all([loader.initialize(), loader.initialize(), loader.initialize()]);

      const status = loader.getStatus();
      expect(status.initialized).toBe(true);
    });

    it("should provide parser after initialization", async () => {
      const loader = new LanguageLoader();
      await loader.initialize();

      const parser = await loader.getParser();
      expect(parser).toBeDefined();
      expect(typeof parser.parse).toBe("function");
    });
  });

  describe("language loading", () => {
    it("should load TypeScript language", async () => {
      const loader = new LanguageLoader();

      const lang = await loader.getLanguage("typescript");

      expect(lang).toBeDefined();
      expect(loader.isLanguageLoaded("typescript")).toBe(true);
    });

    it("should load TSX language", async () => {
      const loader = new LanguageLoader();

      const lang = await loader.getLanguage("tsx");

      expect(lang).toBeDefined();
      expect(loader.isLanguageLoaded("tsx")).toBe(true);
    });

    it("should load JavaScript language", async () => {
      const loader = new LanguageLoader();

      const lang = await loader.getLanguage("javascript");

      expect(lang).toBeDefined();
      expect(loader.isLanguageLoaded("javascript")).toBe(true);
    });

    it("should load JSX language", async () => {
      const loader = new LanguageLoader();

      const lang = await loader.getLanguage("jsx");

      expect(lang).toBeDefined();
      expect(loader.isLanguageLoaded("jsx")).toBe(true);
    });

    it("should cache loaded languages", async () => {
      const loader = new LanguageLoader();

      // First load
      const lang1 = await loader.getLanguage("typescript");

      // Second load should be cached
      const lang2 = await loader.getLanguage("typescript");

      expect(lang1).toBe(lang2);
    });

    it("should initialize automatically when getting language", async () => {
      const loader = new LanguageLoader();

      // Don't call initialize() explicitly
      const lang = await loader.getLanguage("typescript");

      expect(lang).toBeDefined();
      expect(loader.getStatus().initialized).toBe(true);
    });
  });

  describe("preloadAllLanguages", () => {
    it("should preload all supported languages", async () => {
      const loader = new LanguageLoader();

      const results = await loader.preloadAllLanguages();

      expect(results.get("typescript")).toBe(true);
      expect(results.get("tsx")).toBe(true);
      expect(results.get("javascript")).toBe(true);
      expect(results.get("jsx")).toBe(true);

      // All should be loaded now
      expect(loader.isLanguageLoaded("typescript")).toBe(true);
      expect(loader.isLanguageLoaded("tsx")).toBe(true);
      expect(loader.isLanguageLoaded("javascript")).toBe(true);
      expect(loader.isLanguageLoaded("jsx")).toBe(true);
    });
  });

  describe("getStatus", () => {
    it("should report correct status before initialization", () => {
      const loader = new LanguageLoader();

      const status = loader.getStatus();

      expect(status.initialized).toBe(false);
      expect(status.loadedLanguages).toHaveLength(0);
    });

    it("should report correct status after initialization and loading", async () => {
      const loader = new LanguageLoader();

      await loader.getLanguage("typescript");
      await loader.getLanguage("javascript");

      const status = loader.getStatus();

      expect(status.initialized).toBe(true);
      expect(status.loadedLanguages).toContain("typescript");
      expect(status.loadedLanguages).toContain("javascript");
      expect(status.wasmPaths).toBeDefined();
    });
  });

  describe("cleanup", () => {
    it("should clean up resources", async () => {
      const loader = new LanguageLoader();
      await loader.getLanguage("typescript");

      expect(loader.getStatus().initialized).toBe(true);
      expect(loader.isLanguageLoaded("typescript")).toBe(true);

      loader.cleanup();

      expect(loader.getStatus().initialized).toBe(false);
      expect(loader.isLanguageLoaded("typescript")).toBe(false);
    });

    it("should allow reinitialization after cleanup", async () => {
      const loader = new LanguageLoader();
      await loader.getLanguage("typescript");

      loader.cleanup();

      // Should be able to reinitialize
      await loader.getLanguage("javascript");

      expect(loader.getStatus().initialized).toBe(true);
      expect(loader.isLanguageLoaded("javascript")).toBe(true);
    });

    it("should load Python language grammar", async () => {
      const loader = new LanguageLoader();
      const lang = await loader.getLanguage("python");

      expect(lang).toBeDefined();
      expect(loader.isLanguageLoaded("python")).toBe(true);
    });
  });

  describe("error handling", () => {
    it("should throw LanguageLoadError for invalid WASM path", async () => {
      const loader = new LanguageLoader({
        languages: {
          typescript: "/nonexistent/path.wasm",
          tsx: "/nonexistent/path.wasm",
          javascript: "/nonexistent/path.wasm",
          jsx: "/nonexistent/path.wasm",
          python: "/nonexistent/path.wasm",
          go: "/nonexistent/path.wasm",
        },
      });

      try {
        await loader.getLanguage("typescript");
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(LanguageLoadError);
      }
    });

    // Note: This test is removed because web-tree-sitter.Parser.init() is a global
    // operation that only runs once per process. Once successfully initialized,
    // subsequent calls with different paths will still succeed because the WASM
    // module is already loaded in memory. This is expected behavior.
  });

  describe("custom WASM paths", () => {
    it("should accept custom WASM paths", () => {
      const customPaths = {
        treeSitterWasm: "/custom/tree-sitter.wasm",
        languages: {
          typescript: "/custom/typescript.wasm",
          tsx: "/custom/tsx.wasm",
          javascript: "/custom/javascript.wasm",
          jsx: "/custom/jsx.wasm",
          python: "/custom/python.wasm",
          go: "/custom/go.wasm",
        },
      };

      const loader = new LanguageLoader(customPaths);
      const status = loader.getStatus();

      expect(status.wasmPaths.treeSitterWasm).toBe("/custom/tree-sitter.wasm");
      expect(status.wasmPaths.languages.typescript).toBe("/custom/typescript.wasm");
    });
  });

  describe("Go language support", () => {
    it("should load Go language grammar", async () => {
      const loader = new LanguageLoader();
      const lang = await loader.getLanguage("go");

      expect(lang).toBeDefined();
      expect(loader.isLanguageLoaded("go")).toBe(true);
    });
  });
});
