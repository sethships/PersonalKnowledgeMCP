/**
 * Unit tests for EntityExtractor.
 *
 * Tests the high-level entity extraction API for extracting functions,
 * classes, interfaces, and other code entities from TypeScript and JavaScript files.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import path from "node:path";
import { EntityExtractor } from "../../../../src/graph/extraction/EntityExtractor.js";
import { LanguageLoader } from "../../../../src/graph/parsing/LanguageLoader.js";
import {
  LanguageNotSupportedError,
  FileTooLargeError,
} from "../../../../src/graph/parsing/errors.js";
import { initializeLogger, resetLogger } from "../../../../src/logging/index.js";

// Path to test fixtures
const FIXTURES_DIR = path.join(process.cwd(), "tests/fixtures/parsing");

describe("EntityExtractor", () => {
  let extractor: EntityExtractor;

  beforeAll(async () => {
    // Initialize logger for tests
    initializeLogger({ level: "error", format: "json" });

    // Create extractor instance
    extractor = new EntityExtractor();
  });

  afterAll(() => {
    LanguageLoader.resetInstance();
    resetLogger();
  });

  describe("static methods", () => {
    it("should correctly identify supported files", () => {
      expect(EntityExtractor.isSupported("file.ts")).toBe(true);
      expect(EntityExtractor.isSupported("file.tsx")).toBe(true);
      expect(EntityExtractor.isSupported("file.js")).toBe(true);
      expect(EntityExtractor.isSupported("file.jsx")).toBe(true);
      expect(EntityExtractor.isSupported("file.mjs")).toBe(true);
      expect(EntityExtractor.isSupported("file.mts")).toBe(true);

      expect(EntityExtractor.isSupported("file.py")).toBe(false);
      expect(EntityExtractor.isSupported("file.css")).toBe(false);
      expect(EntityExtractor.isSupported("file.md")).toBe(false);
    });

    it("should handle file paths with directories", () => {
      expect(EntityExtractor.isSupported("src/utils/helper.ts")).toBe(true);
      expect(EntityExtractor.isSupported("/absolute/path/file.tsx")).toBe(true);
      expect(EntityExtractor.isSupported("./relative/file.js")).toBe(true);
    });
  });

  describe("extractFromContent", () => {
    it("should extract all entities from content", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-function.ts")).text();
      const result = await extractor.extractFromContent(content, "simple-function.ts");

      expect(result.success).toBe(true);
      expect(result.filePath).toBe("simple-function.ts");
      expect(result.language).toBe("typescript");
      expect(result.entities.length).toBeGreaterThan(0);
      expect(result.errors).toHaveLength(0);
    });

    it("should extract entities with full metadata", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-function.ts")).text();
      const result = await extractor.extractFromContent(content, "simple-function.ts");

      const doubleNumber = result.entities.find((e) => e.name === "doubleNumber");
      expect(doubleNumber).toBeDefined();
      expect(doubleNumber?.type).toBe("function");
      expect(doubleNumber?.isExported).toBe(true);
      expect(doubleNumber?.lineStart).toBeGreaterThan(0);
      expect(doubleNumber?.lineEnd).toBeGreaterThan(0);
      expect(doubleNumber?.metadata?.parameters).toBeDefined();
      expect(doubleNumber?.metadata?.returnType).toBe("number");
    });

    it("should filter by entity types", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "complex-class.ts")).text();
      const result = await extractor.extractFromContent(content, "complex-class.ts", {
        entityTypes: ["class"],
      });

      expect(result.success).toBe(true);
      expect(result.entities.length).toBeGreaterThan(0);
      expect(result.entities.every((e) => e.type === "class")).toBe(true);
    });

    it("should filter for exported entities only", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-function.ts")).text();
      const result = await extractor.extractFromContent(content, "simple-function.ts", {
        exportedOnly: true,
      });

      expect(result.success).toBe(true);
      expect(result.entities.every((e) => e.isExported)).toBe(true);

      // privateHelper should not be included
      const privateHelper = result.entities.find((e) => e.name === "privateHelper");
      expect(privateHelper).toBeUndefined();
    });

    it("should combine entity type and export filters", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "complex-class.ts")).text();
      const result = await extractor.extractFromContent(content, "complex-class.ts", {
        entityTypes: ["interface"],
        exportedOnly: true,
      });

      expect(result.success).toBe(true);
      expect(result.entities.every((e) => e.type === "interface" && e.isExported)).toBe(true);
    });
  });

  describe("extractFunctions", () => {
    it("should extract only functions and methods", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-function.ts")).text();
      const functions = await extractor.extractFunctions(content, "simple-function.ts");

      expect(functions.length).toBeGreaterThan(0);
      expect(functions.every((e) => e.type === "function" || e.type === "method")).toBe(true);

      // Check specific functions
      const doubleNumber = functions.find((e) => e.name === "doubleNumber");
      expect(doubleNumber).toBeDefined();

      const fetchData = functions.find((e) => e.name === "fetchData");
      expect(fetchData).toBeDefined();
      expect(fetchData?.metadata?.isAsync).toBe(true);
    });

    it("should extract generator functions", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-function.ts")).text();
      const functions = await extractor.extractFunctions(content, "simple-function.ts");

      const generator = functions.find((e) => e.name === "generateSequence");
      expect(generator).toBeDefined();
      expect(generator?.metadata?.isGenerator).toBe(true);
    });

    it("should extract methods from classes", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "complex-class.ts")).text();
      const functions = await extractor.extractFunctions(content, "complex-class.ts");

      const makeSound = functions.find((e) => e.name === "makeSound");
      expect(makeSound).toBeDefined();
      expect(makeSound?.type).toBe("method");
    });
  });

  describe("extractClasses", () => {
    it("should extract only class entities", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "complex-class.ts")).text();
      const classes = await extractor.extractClasses(content, "complex-class.ts");

      expect(classes.length).toBeGreaterThan(0);
      expect(classes.every((e) => e.type === "class")).toBe(true);
    });

    it("should extract abstract classes with metadata", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "complex-class.ts")).text();
      const classes = await extractor.extractClasses(content, "complex-class.ts");

      const animal = classes.find((e) => e.name === "Animal");
      expect(animal).toBeDefined();
      expect(animal?.metadata?.isAbstract).toBe(true);
    });

    it("should extract class inheritance information", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "complex-class.ts")).text();
      const classes = await extractor.extractClasses(content, "complex-class.ts");

      const bird = classes.find((e) => e.name === "Bird");
      expect(bird).toBeDefined();
      expect(bird?.metadata?.extends).toBe("Animal");
      expect(bird?.metadata?.implements).toContain("Flyable");

      const duck = classes.find((e) => e.name === "Duck");
      expect(duck).toBeDefined();
      expect(duck?.metadata?.extends).toBe("Bird");
      expect(duck?.metadata?.implements).toContain("Swimmable");
    });

    it("should extract generic classes with type parameters", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "complex-class.ts")).text();
      const classes = await extractor.extractClasses(content, "complex-class.ts");

      const container = classes.find((e) => e.name === "Container");
      expect(container).toBeDefined();
      expect(container?.metadata?.typeParameters).toContain("T");
    });
  });

  describe("extractInterfaces", () => {
    it("should extract only interface entities", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "complex-class.ts")).text();
      const interfaces = await extractor.extractInterfaces(content, "complex-class.ts");

      expect(interfaces.length).toBeGreaterThan(0);
      expect(interfaces.every((e) => e.type === "interface")).toBe(true);
    });

    it("should extract interface definitions", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "complex-class.ts")).text();
      const interfaces = await extractor.extractInterfaces(content, "complex-class.ts");

      const flyable = interfaces.find((e) => e.name === "Flyable");
      expect(flyable).toBeDefined();
      expect(flyable?.isExported).toBe(true);

      const swimmable = interfaces.find((e) => e.name === "Swimmable");
      expect(swimmable).toBeDefined();
    });
  });

  describe("extractTypes", () => {
    it("should extract type aliases and enums", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "complex-class.ts")).text();
      const types = await extractor.extractTypes(content, "complex-class.ts");

      expect(types.length).toBeGreaterThan(0);
      expect(types.every((e) => e.type === "type_alias" || e.type === "enum")).toBe(true);

      const callback = types.find((e) => e.name === "Callback");
      expect(callback).toBeDefined();
      expect(callback?.type).toBe("type_alias");

      const dayOfWeek = types.find((e) => e.name === "DayOfWeek");
      expect(dayOfWeek).toBeDefined();
      expect(dayOfWeek?.type).toBe("enum");
    });
  });

  describe("extractExported", () => {
    it("should extract only exported entities", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-function.ts")).text();
      const exported = await extractor.extractExported(content, "simple-function.ts");

      expect(exported.length).toBeGreaterThan(0);
      expect(exported.every((e) => e.isExported)).toBe(true);
    });

    it("should not include non-exported entities", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-function.ts")).text();
      const exported = await extractor.extractExported(content, "simple-function.ts");

      const privateHelper = exported.find((e) => e.name === "privateHelper");
      expect(privateHelper).toBeUndefined();
    });
  });

  describe("extractFromFile", () => {
    it("should read and extract from file path", async () => {
      const filePath = path.join(FIXTURES_DIR, "simple-function.ts");
      const result = await extractor.extractFromFile(filePath);

      expect(result.success).toBe(true);
      expect(result.entities.length).toBeGreaterThan(0);
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
        path.join(FIXTURES_DIR, "simple-function.ts"),
        path.join(FIXTURES_DIR, "complex-class.ts"),
      ];

      const { results, summary } = await extractor.extractFromFiles(files);

      expect(results).toHaveLength(2);
      expect(summary.totalFiles).toBe(2);
      expect(summary.successfulFiles).toBe(2);
      expect(summary.failedFiles).toBe(0);
      expect(summary.totalEntities).toBeGreaterThan(0);
    });

    it("should continue processing on failure", async () => {
      const files = [
        path.join(FIXTURES_DIR, "simple-function.ts"),
        path.join(FIXTURES_DIR, "non-existent.ts"),
        path.join(FIXTURES_DIR, "complex-class.ts"),
      ];

      const { results, summary } = await extractor.extractFromFiles(files);

      expect(results).toHaveLength(3);
      expect(summary.successfulFiles).toBe(2);
      expect(summary.failedFiles).toBe(1);
    });

    it("should apply options to all files in batch", async () => {
      const files = [
        path.join(FIXTURES_DIR, "simple-function.ts"),
        path.join(FIXTURES_DIR, "complex-class.ts"),
      ];

      const { results } = await extractor.extractFromFiles(files, {
        entityTypes: ["function", "method"],
      });

      for (const result of results) {
        if (result.success) {
          expect(result.entities.every((e) => e.type === "function" || e.type === "method")).toBe(
            true
          );
        }
      }
    });
  });

  describe("language support", () => {
    it("should extract from TypeScript files", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-function.ts")).text();
      const result = await extractor.extractFromContent(content, "file.ts");

      expect(result.success).toBe(true);
      expect(result.language).toBe("typescript");
    });

    it("should extract from TSX files", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "jsx-component.tsx")).text();
      const result = await extractor.extractFromContent(content, "component.tsx");

      expect(result.success).toBe(true);
      expect(result.language).toBe("tsx");
    });

    it("should extract from JavaScript files", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple.js")).text();
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
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("should handle empty files", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "empty.ts")).text();
      const result = await extractor.extractFromContent(content, "empty.ts");

      expect(result.success).toBe(true);
      expect(result.entities).toHaveLength(0);
    });

    it("should throw for files exceeding max size", async () => {
      const smallExtractor = new EntityExtractor({
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

  describe("configuration options", () => {
    it("should respect extractDocumentation option", async () => {
      const content = `
/**
 * Documented function.
 */
export function documented(): void {}
`;

      const withDocs = new EntityExtractor({ extractDocumentation: true });
      const withDocsResult = await withDocs.extractFromContent(content, "file.ts");
      const withDocsEntity = withDocsResult.entities.find((e) => e.name === "documented");
      expect(withDocsEntity?.metadata?.documentation).toBeDefined();

      const withoutDocs = new EntityExtractor({ extractDocumentation: false });
      const withoutDocsResult = await withoutDocs.extractFromContent(content, "file.ts");
      const withoutDocsEntity = withoutDocsResult.entities.find((e) => e.name === "documented");
      expect(withoutDocsEntity?.metadata?.documentation).toBeUndefined();
    });

    it("should respect includeAnonymous option", async () => {
      const content = `
const handler = function() {
  return "anonymous";
};
`;

      const withAnonymous = new EntityExtractor({ includeAnonymous: true });
      const withAnonymousResult = await withAnonymous.extractFromContent(content, "file.ts");
      const anonymous = withAnonymousResult.entities.filter((e) => e.name === "<anonymous>");
      expect(anonymous.length).toBeGreaterThan(0);

      const withoutAnonymous = new EntityExtractor({ includeAnonymous: false });
      const withoutAnonymousResult = await withoutAnonymous.extractFromContent(content, "file.ts");
      const noAnonymous = withoutAnonymousResult.entities.filter((e) => e.name === "<anonymous>");
      expect(noAnonymous).toHaveLength(0);
    });
  });

  describe("metadata extraction", () => {
    it("should extract async function metadata", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-function.ts")).text();
      const functions = await extractor.extractFunctions(content, "simple-function.ts");

      const fetchData = functions.find((e) => e.name === "fetchData");
      expect(fetchData?.metadata?.isAsync).toBe(true);
    });

    it("should extract static method metadata", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "complex-class.ts")).text();
      const functions = await extractor.extractFunctions(content, "complex-class.ts");

      const createSparrow = functions.find((e) => e.name === "createSparrow");
      expect(createSparrow).toBeDefined();
      expect(createSparrow?.metadata?.isStatic).toBe(true);
    });

    it("should extract parameter information", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-function.ts")).text();
      const functions = await extractor.extractFunctions(content, "simple-function.ts");

      const fetchData = functions.find((e) => e.name === "fetchData");
      expect(fetchData?.metadata?.parameters).toBeDefined();
      expect(fetchData?.metadata?.parameters?.length).toBe(2);

      const urlParam = fetchData?.metadata?.parameters?.find((p) => p.name === "url");
      expect(urlParam?.type).toBe("string");

      const timeoutParam = fetchData?.metadata?.parameters?.find((p) => p.name === "timeout");
      expect(timeoutParam?.isOptional).toBe(true);
    });

    it("should extract JSDoc documentation", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-function.ts")).text();
      const result = await extractor.extractFromContent(content, "simple-function.ts");

      const doubleNumber = result.entities.find((e) => e.name === "doubleNumber");
      expect(doubleNumber?.metadata?.documentation).toBeDefined();
      expect(doubleNumber?.metadata?.documentation).toContain("simple exported function");
    });
  });

  describe("React component extraction (TSX)", () => {
    it("should extract React functional components", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "jsx-component.tsx")).text();
      const result = await extractor.extractFromContent(content, "jsx-component.tsx");

      expect(result.success).toBe(true);

      // Button is an arrow function component
      const button = result.entities.find((e) => e.name === "Button");
      expect(button).toBeDefined();

      // Counter is a function declaration component
      const counter = result.entities.find((e) => e.name === "Counter");
      expect(counter).toBeDefined();
    });

    it("should extract prop interfaces", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "jsx-component.tsx")).text();
      const interfaces = await extractor.extractInterfaces(content, "jsx-component.tsx");

      const buttonProps = interfaces.find((e) => e.name === "ButtonProps");
      expect(buttonProps).toBeDefined();
    });
  });
});
