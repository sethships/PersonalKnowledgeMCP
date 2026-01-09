/**
 * Unit tests for RelationshipExtractor.
 *
 * Tests the high-level relationship extraction API for extracting imports
 * and exports from TypeScript and JavaScript files.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import path from "node:path";
import { RelationshipExtractor } from "../../../../src/graph/extraction/RelationshipExtractor.js";
import { LanguageLoader } from "../../../../src/graph/parsing/LanguageLoader.js";
import {
  LanguageNotSupportedError,
  FileTooLargeError,
} from "../../../../src/graph/parsing/errors.js";
import { initializeLogger, resetLogger } from "../../../../src/logging/index.js";

// Path to test fixtures
const FIXTURES_DIR = path.join(process.cwd(), "tests/fixtures/parsing");

describe("RelationshipExtractor", () => {
  let extractor: RelationshipExtractor;

  beforeAll(async () => {
    // Initialize logger for tests
    initializeLogger({ level: "error", format: "json" });

    // Create extractor instance
    extractor = new RelationshipExtractor();
  });

  afterAll(() => {
    LanguageLoader.resetInstance();
    resetLogger();
  });

  describe("static methods", () => {
    it("should correctly identify supported files", () => {
      expect(RelationshipExtractor.isSupported("file.ts")).toBe(true);
      expect(RelationshipExtractor.isSupported("file.tsx")).toBe(true);
      expect(RelationshipExtractor.isSupported("file.js")).toBe(true);
      expect(RelationshipExtractor.isSupported("file.jsx")).toBe(true);
      expect(RelationshipExtractor.isSupported("file.mjs")).toBe(true);
      expect(RelationshipExtractor.isSupported("file.mts")).toBe(true);

      expect(RelationshipExtractor.isSupported("file.py")).toBe(false);
      expect(RelationshipExtractor.isSupported("file.css")).toBe(false);
      expect(RelationshipExtractor.isSupported("file.md")).toBe(false);
    });

    it("should handle file paths with directories", () => {
      expect(RelationshipExtractor.isSupported("src/utils/helper.ts")).toBe(true);
      expect(RelationshipExtractor.isSupported("/absolute/path/file.tsx")).toBe(true);
      expect(RelationshipExtractor.isSupported("./relative/file.js")).toBe(true);
    });
  });

  describe("extractFromContent", () => {
    it("should extract all relationships from content", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "imports-exports.ts")).text();
      const result = await extractor.extractFromContent(content, "imports-exports.ts");

      expect(result.success).toBe(true);
      expect(result.filePath).toBe("imports-exports.ts");
      expect(result.language).toBe("typescript");
      expect(result.imports.length).toBeGreaterThan(0);
      expect(result.exports.length).toBeGreaterThan(0);
      expect(result.errors).toHaveLength(0);
    });

    it("should extract default imports", async () => {
      const content = `import React from "react";`;
      const result = await extractor.extractFromContent(content, "file.ts");

      expect(result.success).toBe(true);
      expect(result.imports).toHaveLength(1);
      const imp = result.imports[0]!;
      expect(imp.targetModule).toBe("react");
      expect(imp.isExternal).toBe(true);
      expect(imp.importInfo.defaultImport).toBe("React");
    });

    it("should extract named imports", async () => {
      const content = `import { useState, useEffect } from "react";`;
      const result = await extractor.extractFromContent(content, "file.ts");

      expect(result.success).toBe(true);
      expect(result.imports).toHaveLength(1);
      const imp = result.imports[0]!;
      expect(imp.importInfo.importedNames).toContain("useState");
      expect(imp.importInfo.importedNames).toContain("useEffect");
    });

    it("should extract aliased imports", async () => {
      const content = `import { Component as ReactComponent } from "react";`;
      const result = await extractor.extractFromContent(content, "file.ts");

      expect(result.success).toBe(true);
      expect(result.imports).toHaveLength(1);
      const imp = result.imports[0]!;
      expect(imp.importInfo.importedNames).toContain("Component");
      expect(imp.importInfo.aliases?.["Component"]).toBe("ReactComponent");
    });

    it("should extract namespace imports", async () => {
      const content = `import * as path from "node:path";`;
      const result = await extractor.extractFromContent(content, "file.ts");

      expect(result.success).toBe(true);
      expect(result.imports).toHaveLength(1);
      const imp = result.imports[0]!;
      expect(imp.importInfo.namespaceImport).toBe("path");
      expect(imp.targetModule).toBe("node:path");
      expect(imp.isExternal).toBe(true);
    });

    it("should extract side-effect imports", async () => {
      const content = `import "./styles.css";`;
      const result = await extractor.extractFromContent(content, "file.ts");

      expect(result.success).toBe(true);
      expect(result.imports).toHaveLength(1);
      const imp = result.imports[0]!;
      expect(imp.importInfo.isSideEffect).toBe(true);
      expect(imp.isExternal).toBe(false);
    });

    it("should extract type-only imports", async () => {
      const content = `import type { FC, PropsWithChildren } from "react";`;
      const result = await extractor.extractFromContent(content, "file.ts");

      expect(result.success).toBe(true);
      expect(result.imports).toHaveLength(1);
      const imp = result.imports[0]!;
      expect(imp.importInfo.isTypeOnly).toBe(true);
      expect(imp.importInfo.importedNames).toContain("FC");
    });

    it("should identify relative imports", async () => {
      const content = `
        import { helper } from "./utils";
        import { Config } from "../config";
      `;
      const result = await extractor.extractFromContent(content, "src/services/auth.ts");

      expect(result.success).toBe(true);
      expect(result.imports).toHaveLength(2);

      const utilsImport = result.imports.find((i) => i.targetModule === "./utils");
      expect(utilsImport).toBeDefined();
      expect(utilsImport?.isExternal).toBe(false);
      expect(utilsImport?.importInfo.isRelative).toBe(true);
      expect(utilsImport?.resolvedPath).toBeDefined();

      const configImport = result.imports.find((i) => i.targetModule === "../config");
      expect(configImport).toBeDefined();
      expect(configImport?.isExternal).toBe(false);
    });

    it("should resolve relative import paths", async () => {
      const content = `import { helper } from "./utils";`;
      const result = await extractor.extractFromContent(content, "src/services/auth.ts");

      expect(result.imports).toHaveLength(1);
      const imp = result.imports[0]!;
      expect(imp.resolvedPath).toContain("src/services/utils");
    });

    it("should extract re-exports", async () => {
      const content = `export { helper } from "./utils";`;
      const result = await extractor.extractFromContent(content, "src/index.ts");

      expect(result.success).toBe(true);
      expect(result.exports).toHaveLength(1);
      const exp = result.exports[0]!;
      expect(exp.isReExport).toBe(true);
      expect(exp.targetModule).toBe("./utils");
      expect(exp.exportInfo.exportedNames).toContain("helper");
    });

    it("should extract aliased re-exports", async () => {
      const content = `export { Config as AppConfig } from "../config";`;
      const result = await extractor.extractFromContent(content, "src/index.ts");

      expect(result.success).toBe(true);
      expect(result.exports).toHaveLength(1);
      const exp = result.exports[0]!;
      expect(exp.isReExport).toBe(true);
      expect(exp.exportInfo.aliases?.["Config"]).toBe("AppConfig");
    });

    it("should extract namespace re-exports", async () => {
      const content = `export * from "./types";`;
      const result = await extractor.extractFromContent(content, "src/index.ts");

      expect(result.success).toBe(true);
      expect(result.exports).toHaveLength(1);
      const exp = result.exports[0]!;
      expect(exp.isReExport).toBe(true);
      expect(exp.exportInfo.isNamespaceExport).toBe(true);
    });

    it("should extract type-only exports", async () => {
      const content = `export type { SomeType } from "./internal-types";`;
      const result = await extractor.extractFromContent(content, "src/index.ts");

      expect(result.success).toBe(true);
      expect(result.exports).toHaveLength(1);
      const exp = result.exports[0]!;
      expect(exp.exportInfo.isTypeOnly).toBe(true);
    });

    it("should extract named exports (non re-export)", async () => {
      const content = `
        const foo = 1;
        const bar = 2;
        export { foo, bar };
      `;
      const result = await extractor.extractFromContent(content, "file.ts");

      expect(result.success).toBe(true);
      const namedExport = result.exports.find(
        (e) => !e.isReExport && e.exportInfo.exportedNames.includes("foo")
      );
      expect(namedExport).toBeDefined();
    });
  });

  describe("filtering options", () => {
    it("should filter out external packages when includeExternalPackages is false", async () => {
      const content = `
        import React from "react";
        import { helper } from "./utils";
      `;
      const result = await extractor.extractFromContent(content, "file.ts", {
        includeExternalPackages: false,
      });

      expect(result.imports).toHaveLength(1);
      const imp = result.imports[0]!;
      expect(imp.targetModule).toBe("./utils");
    });

    it("should filter out type-only imports when includeTypeOnlyImports is false", async () => {
      const content = `
        import type { FC } from "react";
        import { useState } from "react";
      `;
      const result = await extractor.extractFromContent(content, "file.ts", {
        includeTypeOnlyImports: false,
      });

      expect(result.imports).toHaveLength(1);
      const imp = result.imports[0]!;
      expect(imp.importInfo.isTypeOnly).toBe(false);
    });

    it("should filter out side-effect imports when includeSideEffectImports is false", async () => {
      const content = `
        import "./styles.css";
        import { helper } from "./utils";
      `;
      const result = await extractor.extractFromContent(content, "file.ts", {
        includeSideEffectImports: false,
      });

      expect(result.imports).toHaveLength(1);
      const imp = result.imports[0]!;
      expect(imp.importInfo.isSideEffect).toBe(false);
    });

    it("should filter out re-exports when includeReExports is false", async () => {
      const content = `
        export { helper } from "./utils";
        export const myConst = 1;
      `;
      const result = await extractor.extractFromContent(content, "file.ts", {
        includeReExports: false,
      });

      // Should only have non-re-export exports
      const reExports = result.exports.filter((e) => e.isReExport);
      expect(reExports).toHaveLength(0);
    });

    it("should combine multiple filter options", async () => {
      const content = `
        import React from "react";
        import type { FC } from "react";
        import { helper } from "./utils";
        import "./styles.css";
      `;
      const result = await extractor.extractFromContent(content, "file.ts", {
        includeExternalPackages: false,
        includeTypeOnlyImports: false,
        includeSideEffectImports: false,
      });

      // Only the relative, non-type, non-side-effect import should remain
      expect(result.imports).toHaveLength(1);
      const imp = result.imports[0]!;
      expect(imp.targetModule).toBe("./utils");
    });
  });

  describe("convenience methods", () => {
    it("extractImports should return only imports", async () => {
      const content = `
        import { foo } from "./utils";
        export { bar } from "./other";
      `;
      const imports = await extractor.extractImports(content, "file.ts");

      expect(imports).toHaveLength(1);
      const imp = imports[0]!;
      expect(imp.targetModule).toBe("./utils");
    });

    it("extractExports should return only exports", async () => {
      const content = `
        import { foo } from "./utils";
        export { bar } from "./other";
      `;
      const exports = await extractor.extractExports(content, "file.ts");

      expect(exports).toHaveLength(1);
      const exp = exports[0]!;
      expect(exp.targetModule).toBe("./other");
    });

    it("extractInternalImports should exclude external packages", async () => {
      const content = `
        import React from "react";
        import { helper } from "./utils";
        import { Config } from "../config";
      `;
      const internalImports = await extractor.extractInternalImports(content, "file.ts");

      expect(internalImports).toHaveLength(2);
      expect(internalImports.every((i) => !i.isExternal)).toBe(true);
    });

    it("extractExternalImports should only return external packages", async () => {
      const content = `
        import React from "react";
        import { helper } from "./utils";
        import * as lodash from "lodash";
      `;
      const externalImports = await extractor.extractExternalImports(content, "file.ts");

      expect(externalImports).toHaveLength(2);
      expect(externalImports.every((i) => i.isExternal)).toBe(true);
    });
  });

  describe("extractFromFile", () => {
    it("should read and extract from file path", async () => {
      const filePath = path.join(FIXTURES_DIR, "imports-exports.ts");
      const result = await extractor.extractFromFile(filePath);

      expect(result.success).toBe(true);
      expect(result.imports.length).toBeGreaterThan(0);
      expect(result.exports.length).toBeGreaterThan(0);
    });

    it("should throw for non-existent files", async () => {
      const filePath = path.join(FIXTURES_DIR, "non-existent.ts");

      try {
        await extractor.extractFromFile(filePath);
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }
    });
  });

  describe("extractFromFiles - batch processing", () => {
    it("should extract from multiple files", async () => {
      const files = [
        path.join(FIXTURES_DIR, "imports-exports.ts"),
        path.join(FIXTURES_DIR, "simple-function.ts"),
      ];

      const { results, summary } = await extractor.extractFromFiles(files);

      expect(results).toHaveLength(2);
      expect(summary.totalFiles).toBe(2);
      expect(summary.successfulFiles).toBe(2);
      expect(summary.failedFiles).toBe(0);
      expect(summary.totalImports).toBeGreaterThan(0);
    });

    it("should continue processing on failure", async () => {
      const files = [
        path.join(FIXTURES_DIR, "imports-exports.ts"),
        path.join(FIXTURES_DIR, "non-existent.ts"),
        path.join(FIXTURES_DIR, "simple-function.ts"),
      ];

      const { results, summary } = await extractor.extractFromFiles(files);

      expect(results).toHaveLength(3);
      expect(summary.successfulFiles).toBe(2);
      expect(summary.failedFiles).toBe(1);
    });

    it("should apply options to all files in batch", async () => {
      const files = [
        path.join(FIXTURES_DIR, "imports-exports.ts"),
        path.join(FIXTURES_DIR, "simple-function.ts"),
      ];

      const { results } = await extractor.extractFromFiles(files, {
        includeExternalPackages: false,
      });

      for (const result of results) {
        if (result.success) {
          expect(result.imports.every((i) => !i.isExternal)).toBe(true);
        }
      }
    });
  });

  describe("language support", () => {
    it("should extract from TypeScript files", async () => {
      const content = `import { foo } from "./bar";`;
      const result = await extractor.extractFromContent(content, "file.ts");

      expect(result.success).toBe(true);
      expect(result.language).toBe("typescript");
    });

    it("should extract from TSX files", async () => {
      const content = `import React from "react";`;
      const result = await extractor.extractFromContent(content, "component.tsx");

      expect(result.success).toBe(true);
      expect(result.language).toBe("tsx");
    });

    it("should extract from JavaScript files", async () => {
      const content = `import { foo } from "./bar";`;
      const result = await extractor.extractFromContent(content, "file.js");

      expect(result.success).toBe(true);
      expect(result.language).toBe("javascript");
    });

    it("should throw for unsupported file types", async () => {
      const content = "body { color: red; }";

      try {
        await extractor.extractFromContent(content, "styles.css");
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(LanguageNotSupportedError);
      }
    });
  });

  describe("error handling", () => {
    it("should handle malformed files gracefully", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "malformed.ts")).text();
      const result = await extractor.extractFromContent(content, "malformed.ts");

      // Tree-sitter is error-tolerant, so it should still succeed
      expect(result.success).toBe(true);
    });

    it("should handle empty files", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "empty.ts")).text();
      const result = await extractor.extractFromContent(content, "empty.ts");

      expect(result.success).toBe(true);
      expect(result.imports).toHaveLength(0);
      expect(result.exports).toHaveLength(0);
    });

    it("should throw for files exceeding max size", async () => {
      const smallExtractor = new RelationshipExtractor({
        maxFileSizeBytes: 100,
      });

      const content = "x".repeat(200);

      try {
        await smallExtractor.extractFromContent(content, "large.ts");
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(FileTooLargeError);
      }
    });
  });

  describe("path resolution", () => {
    it("should resolve ./relative paths correctly", async () => {
      const content = `import { foo } from "./utils";`;
      const result = await extractor.extractFromContent(content, "src/services/auth.ts");

      const imp = result.imports[0]!;
      expect(imp.resolvedPath).toMatch(/src\/services\/utils$/);
    });

    it("should resolve ../parent paths correctly", async () => {
      const content = `import { foo } from "../config";`;
      const result = await extractor.extractFromContent(content, "src/services/auth.ts");

      const imp = result.imports[0]!;
      expect(imp.resolvedPath).toMatch(/src\/config$/);
    });

    it("should not resolve external package paths", async () => {
      const content = `import React from "react";`;
      const result = await extractor.extractFromContent(content, "src/app.ts");

      const imp = result.imports[0]!;
      expect(imp.resolvedPath).toBeUndefined();
    });

    it("should use forward slashes in resolved paths", async () => {
      const content = `import { foo } from "./utils";`;
      const result = await extractor.extractFromContent(content, "src\\services\\auth.ts");

      // Resolved path should use forward slashes regardless of input
      const imp = result.imports[0]!;
      expect(imp.resolvedPath).not.toContain("\\");
    });
  });

  describe("full fixture test", () => {
    it("should extract all import types from imports-exports.ts fixture", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "imports-exports.ts")).text();
      const result = await extractor.extractFromContent(content, "imports-exports.ts");

      // Verify we have imports from the fixture
      expect(result.imports.length).toBeGreaterThanOrEqual(7);

      // Check for specific import types
      const defaultImport = result.imports.find((i) => i.importInfo.defaultImport === "React");
      expect(defaultImport).toBeDefined();

      const namespaceImport = result.imports.find((i) => i.importInfo.namespaceImport === "path");
      expect(namespaceImport).toBeDefined();

      const sideEffectImport = result.imports.find((i) => i.importInfo.isSideEffect);
      expect(sideEffectImport).toBeDefined();

      const typeOnlyImport = result.imports.find(
        (i) => i.importInfo.isTypeOnly && i.importInfo.importedNames.includes("FC")
      );
      expect(typeOnlyImport).toBeDefined();

      const relativeImport = result.imports.find((i) => i.targetModule === "./utils");
      expect(relativeImport).toBeDefined();
      expect(relativeImport?.isExternal).toBe(false);
    });

    it("should extract all export types from imports-exports.ts fixture", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "imports-exports.ts")).text();
      const result = await extractor.extractFromContent(content, "imports-exports.ts");

      // Verify we have exports from the fixture
      expect(result.exports.length).toBeGreaterThanOrEqual(4);

      // Check for re-exports
      const reExport = result.exports.find((e) => e.isReExport && e.targetModule === "./utils");
      expect(reExport).toBeDefined();

      // Check for namespace export
      const namespaceExport = result.exports.find((e) => e.exportInfo.isNamespaceExport);
      expect(namespaceExport).toBeDefined();

      // Check for type-only export
      const typeExport = result.exports.find((e) => e.exportInfo.isTypeOnly);
      expect(typeExport).toBeDefined();
    });
  });
});
