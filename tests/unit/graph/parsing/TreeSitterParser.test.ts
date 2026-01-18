/**
 * Unit tests for TreeSitterParser.
 *
 * Tests AST parsing and entity extraction for TypeScript, JavaScript, and Python files.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import path from "node:path";
import { TreeSitterParser } from "../../../../src/graph/parsing/TreeSitterParser.js";
import { LanguageLoader } from "../../../../src/graph/parsing/LanguageLoader.js";
import {
  LanguageNotSupportedError,
  FileTooLargeError,
} from "../../../../src/graph/parsing/errors.js";
import { initializeLogger, resetLogger } from "../../../../src/logging/index.js";

// Path to test fixtures
const FIXTURES_DIR = path.join(process.cwd(), "tests/fixtures/parsing");

describe("TreeSitterParser", () => {
  let parser: TreeSitterParser;

  beforeAll(async () => {
    // Initialize logger for tests
    initializeLogger({ level: "error", format: "json" });

    // Create parser instance
    parser = new TreeSitterParser();
  });

  afterAll(() => {
    LanguageLoader.resetInstance();
    resetLogger();
  });

  describe("static methods", () => {
    it("should correctly identify supported extensions", () => {
      // TypeScript/JavaScript extensions
      expect(TreeSitterParser.isSupported(".ts")).toBe(true);
      expect(TreeSitterParser.isSupported(".tsx")).toBe(true);
      expect(TreeSitterParser.isSupported(".js")).toBe(true);
      expect(TreeSitterParser.isSupported(".jsx")).toBe(true);
      expect(TreeSitterParser.isSupported(".mjs")).toBe(true);
      expect(TreeSitterParser.isSupported(".cjs")).toBe(true);
      expect(TreeSitterParser.isSupported(".mts")).toBe(true);
      expect(TreeSitterParser.isSupported(".cts")).toBe(true);

      // Python extensions
      expect(TreeSitterParser.isSupported(".py")).toBe(true);
      expect(TreeSitterParser.isSupported(".pyw")).toBe(true);
      expect(TreeSitterParser.isSupported(".pyi")).toBe(true);

      // Case insensitive
      expect(TreeSitterParser.isSupported(".TS")).toBe(true);
      expect(TreeSitterParser.isSupported(".TSX")).toBe(true);
      expect(TreeSitterParser.isSupported(".PY")).toBe(true);

      // Unsupported
      expect(TreeSitterParser.isSupported(".css")).toBe(false);
      expect(TreeSitterParser.isSupported(".md")).toBe(false);
      expect(TreeSitterParser.isSupported("")).toBe(false);
    });

    it("should get language from extension", () => {
      // TypeScript/JavaScript
      expect(TreeSitterParser.getLanguageFromExtension(".ts")).toBe("typescript");
      expect(TreeSitterParser.getLanguageFromExtension(".tsx")).toBe("tsx");
      expect(TreeSitterParser.getLanguageFromExtension(".js")).toBe("javascript");
      expect(TreeSitterParser.getLanguageFromExtension(".jsx")).toBe("jsx");
      expect(TreeSitterParser.getLanguageFromExtension(".mjs")).toBe("javascript");
      expect(TreeSitterParser.getLanguageFromExtension(".mts")).toBe("typescript");

      // Python
      expect(TreeSitterParser.getLanguageFromExtension(".py")).toBe("python");
      expect(TreeSitterParser.getLanguageFromExtension(".pyw")).toBe("python");
      expect(TreeSitterParser.getLanguageFromExtension(".pyi")).toBe("python");

      // Unsupported
      expect(TreeSitterParser.getLanguageFromExtension(".css")).toBeNull();
    });
  });

  describe("parseFile - Simple Functions", () => {
    it("should parse simple TypeScript functions", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-function.ts")).text();
      const result = await parser.parseFile(content, "simple-function.ts");

      expect(result.success).toBe(true);
      expect(result.language).toBe("typescript");
      expect(result.errors).toHaveLength(0);

      // Check entities were extracted
      expect(result.entities.length).toBeGreaterThan(0);

      // Find the doubleNumber function
      const doubleNumber = result.entities.find((e) => e.name === "doubleNumber");
      expect(doubleNumber).toBeDefined();
      expect(doubleNumber?.type).toBe("function");
      expect(doubleNumber?.isExported).toBe(true);
      expect(doubleNumber?.metadata?.parameters).toBeDefined();
      expect(doubleNumber?.metadata?.parameters?.length).toBe(1);
      expect(doubleNumber?.metadata?.parameters?.[0]?.name).toBe("x");
      expect(doubleNumber?.metadata?.parameters?.[0]?.type).toBe("number");
      expect(doubleNumber?.metadata?.returnType).toBe("number");

      // Find the async function
      const fetchData = result.entities.find((e) => e.name === "fetchData");
      expect(fetchData).toBeDefined();
      expect(fetchData?.metadata?.isAsync).toBe(true);
      expect(fetchData?.metadata?.parameters?.length).toBe(2);

      // Find the private helper (non-exported)
      const privateHelper = result.entities.find((e) => e.name === "privateHelper");
      expect(privateHelper).toBeDefined();
      expect(privateHelper?.isExported).toBe(false);

      // Find generator function
      const generator = result.entities.find((e) => e.name === "generateSequence");
      expect(generator).toBeDefined();
      expect(generator?.metadata?.isGenerator).toBe(true);
    });

    it("should extract JSDoc documentation", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-function.ts")).text();
      const result = await parser.parseFile(content, "simple-function.ts");

      const doubleNumber = result.entities.find((e) => e.name === "doubleNumber");
      expect(doubleNumber?.metadata?.documentation).toBeDefined();
      expect(doubleNumber?.metadata?.documentation).toContain("simple exported function");
    });
  });

  describe("parseFile - Classes and Interfaces", () => {
    it("should parse classes with inheritance", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "complex-class.ts")).text();
      const result = await parser.parseFile(content, "complex-class.ts");

      expect(result.success).toBe(true);

      // Find abstract Animal class
      const animal = result.entities.find((e) => e.name === "Animal");
      expect(animal).toBeDefined();
      expect(animal?.type).toBe("class");
      expect(animal?.isExported).toBe(true);
      expect(animal?.metadata?.isAbstract).toBe(true);

      // Find Bird class that extends Animal
      const bird = result.entities.find((e) => e.name === "Bird");
      expect(bird).toBeDefined();
      expect(bird?.metadata?.extends).toBe("Animal");
      expect(bird?.metadata?.implements).toContain("Flyable");

      // Find Duck class that extends Bird and implements Swimmable
      const duck = result.entities.find((e) => e.name === "Duck");
      expect(duck).toBeDefined();
      expect(duck?.metadata?.extends).toBe("Bird");
      expect(duck?.metadata?.implements).toContain("Swimmable");
    });

    it("should parse interfaces", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "complex-class.ts")).text();
      const result = await parser.parseFile(content, "complex-class.ts");

      const flyable = result.entities.find((e) => e.name === "Flyable");
      expect(flyable).toBeDefined();
      expect(flyable?.type).toBe("interface");
      expect(flyable?.isExported).toBe(true);

      const swimmable = result.entities.find((e) => e.name === "Swimmable");
      expect(swimmable).toBeDefined();
      expect(swimmable?.type).toBe("interface");
    });

    it("should parse generic classes", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "complex-class.ts")).text();
      const result = await parser.parseFile(content, "complex-class.ts");

      const container = result.entities.find((e) => e.name === "Container");
      expect(container).toBeDefined();
      expect(container?.metadata?.typeParameters).toContain("T");
    });

    it("should parse type aliases", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "complex-class.ts")).text();
      const result = await parser.parseFile(content, "complex-class.ts");

      const callback = result.entities.find((e) => e.name === "Callback");
      expect(callback).toBeDefined();
      expect(callback?.type).toBe("type_alias");
    });

    it("should parse enums", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "complex-class.ts")).text();
      const result = await parser.parseFile(content, "complex-class.ts");

      const dayOfWeek = result.entities.find((e) => e.name === "DayOfWeek");
      expect(dayOfWeek).toBeDefined();
      expect(dayOfWeek?.type).toBe("enum");
      expect(dayOfWeek?.isExported).toBe(true);
    });

    it("should parse static methods", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "complex-class.ts")).text();
      const result = await parser.parseFile(content, "complex-class.ts");

      const createSparrow = result.entities.find((e) => e.name === "createSparrow");
      expect(createSparrow).toBeDefined();
      expect(createSparrow?.type).toBe("method");
      expect(createSparrow?.metadata?.isStatic).toBe(true);
    });
  });

  describe("parseFile - Imports and Exports", () => {
    it("should extract various import types", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "imports-exports.ts")).text();
      const result = await parser.parseFile(content, "imports-exports.ts");

      expect(result.success).toBe(true);
      expect(result.imports.length).toBeGreaterThan(0);

      // Default import
      const reactDefault = result.imports.find(
        (i) => i.source === "react" && i.defaultImport === "React"
      );
      expect(reactDefault).toBeDefined();

      // Named imports
      const namedReact = result.imports.find(
        (i) => i.source === "react" && i.importedNames.includes("useState")
      );
      expect(namedReact).toBeDefined();
      expect(namedReact?.importedNames).toContain("useEffect");

      // Namespace import
      const pathNs = result.imports.find((i) => i.namespaceImport === "path");
      expect(pathNs).toBeDefined();
      expect(pathNs?.source).toBe("node:path");

      // Side-effect import
      const sideEffect = result.imports.find((i) => i.source === "./styles.css");
      expect(sideEffect).toBeDefined();
      expect(sideEffect?.isSideEffect).toBe(true);

      // Type-only import
      const typeOnly = result.imports.find(
        (i) => i.source === "react" && i.isTypeOnly && i.importedNames.includes("FC")
      );
      expect(typeOnly).toBeDefined();

      // Relative imports
      const helperImport = result.imports.find((i) => i.source === "./utils");
      expect(helperImport).toBeDefined();
      expect(helperImport?.isRelative).toBe(true);

      const configImport = result.imports.find((i) => i.source === "../config");
      expect(configImport).toBeDefined();
      expect(configImport?.isRelative).toBe(true);
    });

    it("should extract aliased imports", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "imports-exports.ts")).text();
      const result = await parser.parseFile(content, "imports-exports.ts");

      const aliased = result.imports.find(
        (i) => i.source === "react" && i.aliases?.["Component"] === "ReactComponent"
      );
      expect(aliased).toBeDefined();
    });

    it("should extract exports", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "imports-exports.ts")).text();
      const result = await parser.parseFile(content, "imports-exports.ts");

      expect(result.exports.length).toBeGreaterThan(0);

      // Re-export
      const helperReexport = result.exports.find((e) => e.source === "./utils");
      expect(helperReexport).toBeDefined();

      // Export all
      const exportAll = result.exports.find((e) => e.isNamespaceExport);
      expect(exportAll).toBeDefined();

      // Named exports
      const namedExport = result.exports.find(
        (e) => e.exportedNames.includes("useState") || e.exportedNames.includes("useEffect")
      );
      expect(namedExport).toBeDefined();

      // Default export
      const defaultExport = result.exports.find((e) => e.exportedNames.includes("default"));
      expect(defaultExport).toBeDefined();
    });
  });

  describe("parseFile - JSX/TSX", () => {
    it("should parse TSX files with React components", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "jsx-component.tsx")).text();
      const result = await parser.parseFile(content, "jsx-component.tsx");

      expect(result.success).toBe(true);
      expect(result.language).toBe("tsx");

      // Find Button component (arrow function)
      const button = result.entities.find((e) => e.name === "Button");
      expect(button).toBeDefined();
      expect(button?.isExported).toBe(true);

      // Find Counter component (function declaration)
      const counter = result.entities.find((e) => e.name === "Counter");
      expect(counter).toBeDefined();
      expect(counter?.type).toBe("function");

      // Find ButtonProps interface
      const buttonProps = result.entities.find((e) => e.name === "ButtonProps");
      expect(buttonProps).toBeDefined();
      expect(buttonProps?.type).toBe("interface");

      // Find default App component
      const app = result.entities.find((e) => e.name === "App");
      expect(app).toBeDefined();
    });
  });

  describe("parseFile - JavaScript", () => {
    it("should parse plain JavaScript files", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple.js")).text();
      const result = await parser.parseFile(content, "simple.js");

      expect(result.success).toBe(true);
      expect(result.language).toBe("javascript");

      // Find greet function
      const greet = result.entities.find((e) => e.name === "greet");
      expect(greet).toBeDefined();
      expect(greet?.type).toBe("function");

      // Find async function
      const fetchUser = result.entities.find((e) => e.name === "fetchUser");
      expect(fetchUser).toBeDefined();
      expect(fetchUser?.metadata?.isAsync).toBe(true);

      // Find class
      const calculator = result.entities.find((e) => e.name === "Calculator");
      expect(calculator).toBeDefined();
      expect(calculator?.type).toBe("class");
    });
  });

  describe("parseFile - Error Handling", () => {
    it("should handle malformed files gracefully", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "malformed.ts")).text();
      const result = await parser.parseFile(content, "malformed.ts");

      // Should still parse successfully (tree-sitter is error-tolerant)
      expect(result.success).toBe(true);

      // But should report errors
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.recoverable)).toBe(true);

      // Should still extract valid entities after error recovery
      const validFunction = result.entities.find((e) => e.name === "validAfterErrors");
      expect(validFunction).toBeDefined();
    });

    it("should handle empty files", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "empty.ts")).text();
      const result = await parser.parseFile(content, "empty.ts");

      expect(result.success).toBe(true);
      expect(result.entities).toHaveLength(0);
      expect(result.imports).toHaveLength(0);
      expect(result.exports).toHaveLength(0);
    });

    it("should throw for unsupported file types", async () => {
      const content = "body { color: red; }";

      try {
        await parser.parseFile(content, "styles.css");
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(LanguageNotSupportedError);
      }
    });

    it("should throw for files exceeding max size", async () => {
      // Create parser with small max size
      const smallParser = new TreeSitterParser(undefined, {
        maxFileSizeBytes: 100,
      });

      const content = "x".repeat(200);

      try {
        await smallParser.parseFile(content, "large.ts");
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(FileTooLargeError);
      }
    });
  });

  describe("parseFile - Performance", () => {
    it("should parse files within reasonable time", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "complex-class.ts")).text();

      // Parse multiple times to get average
      const times: number[] = [];
      for (let i = 0; i < 5; i++) {
        const result = await parser.parseFile(content, "complex-class.ts");
        times.push(result.parseTimeMs);
      }

      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;

      // Should parse within 100ms for typical files
      expect(avgTime).toBeLessThan(100);
    });
  });

  describe("parseFile - Line Numbers", () => {
    it("should report correct line numbers", async () => {
      const content = `
// Line 1 (comment)
// Line 2 (comment)
export function foo(): void {
  // Line 4
}

export class Bar {
  // Line 8
}
`;

      const result = await parser.parseFile(content, "lines.ts");

      const foo = result.entities.find((e) => e.name === "foo");
      expect(foo?.lineStart).toBe(4);

      const bar = result.entities.find((e) => e.name === "Bar");
      expect(bar?.lineStart).toBe(8);
    });
  });

  describe("parseFile - Function Calls", () => {
    it("should extract basic function calls", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "function-calls.ts")).text();
      const result = await parser.parseFile(content, "function-calls.ts");

      expect(result.success).toBe(true);
      expect(result.calls.length).toBeGreaterThan(0);

      // Find console.log call
      const consoleLog = result.calls.find(
        (c) => c.calledName === "log" && c.calledExpression === "console.log"
      );
      expect(consoleLog).toBeDefined();
      expect(consoleLog?.callerName).toBe("simpleCall");
    });

    it("should extract method calls on objects", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "function-calls.ts")).text();
      const result = await parser.parseFile(content, "function-calls.ts");

      // obj.method() call
      const methodCall = result.calls.find(
        (c) => c.calledExpression === "obj.method" && c.callerName === "methodCalls"
      );
      expect(methodCall).toBeDefined();
      expect(methodCall?.calledName).toBe("method");

      // obj.anotherMethod() call
      const anotherMethodCall = result.calls.find(
        (c) => c.calledExpression === "obj.anotherMethod" && c.callerName === "methodCalls"
      );
      expect(anotherMethodCall).toBeDefined();
    });

    it("should detect async calls (await expressions)", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "function-calls.ts")).text();
      const result = await parser.parseFile(content, "function-calls.ts");

      // await fetchData() call
      const fetchDataCall = result.calls.find(
        (c) => c.calledName === "fetchData" && c.callerName === "asyncFunction"
      );
      expect(fetchDataCall).toBeDefined();
      expect(fetchDataCall?.isAsync).toBe(true);

      // await processResult() call
      const processResultCall = result.calls.find(
        (c) => c.calledName === "processResult" && c.callerName === "asyncFunction"
      );
      expect(processResultCall).toBeDefined();
      expect(processResultCall?.isAsync).toBe(true);
    });

    it("should track caller context for function declarations", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "function-calls.ts")).text();
      const result = await parser.parseFile(content, "function-calls.ts");

      // Calls within simpleCall function
      const callsInSimpleCall = result.calls.filter((c) => c.callerName === "simpleCall");
      expect(callsInSimpleCall.length).toBeGreaterThan(0);

      // Calls within nestedCalls function
      const callsInNestedCalls = result.calls.filter((c) => c.callerName === "nestedCalls");
      expect(callsInNestedCalls.length).toBe(2); // outer() and inner()
    });

    it("should track caller context for class methods", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "function-calls.ts")).text();
      const result = await parser.parseFile(content, "function-calls.ts");

      // Calls within constructor
      const constructorCalls = result.calls.filter((c) => c.callerName === "constructor");
      expect(constructorCalls.length).toBeGreaterThan(0);

      // initialize() call in constructor
      const initializeCall = result.calls.find(
        (c) => c.calledExpression === "this.initialize" && c.callerName === "constructor"
      );
      expect(initializeCall).toBeDefined();

      // Calls within doWork method
      const doWorkCalls = result.calls.filter((c) => c.callerName === "doWork");
      expect(doWorkCalls.length).toBe(2); // this.helper.process() and externalHelper()

      // Calls within static method
      const staticMethodCalls = result.calls.filter((c) => c.callerName === "staticMethod");
      expect(staticMethodCalls.length).toBe(1);
      expect(staticMethodCalls[0]?.calledName).toBe("staticHelper");
    });

    it("should extract multiple calls to the same function", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "function-calls.ts")).text();
      const result = await parser.parseFile(content, "function-calls.ts");

      // validate() is called 3 times in multipleCallsSameFunction
      const validateCalls = result.calls.filter(
        (c) => c.calledName === "validate" && c.callerName === "multipleCallsSameFunction"
      );
      expect(validateCalls.length).toBe(3);
    });

    it("should extract chained method calls", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "function-calls.ts")).text();
      const result = await parser.parseFile(content, "function-calls.ts");

      // builder.setName("test").setAge(25).build() - should extract each call
      const chainedCalls = result.calls.filter((c) => c.callerName === "chainedMethodCalls");
      expect(chainedCalls.length).toBeGreaterThanOrEqual(3);

      // Should have setName, setAge, and build calls
      const callNames = chainedCalls.map((c) => c.calledName);
      expect(callNames).toContain("setName");
      expect(callNames).toContain("setAge");
      expect(callNames).toContain("build");
    });

    it("should include correct line numbers", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "function-calls.ts")).text();
      const result = await parser.parseFile(content, "function-calls.ts");

      // console.log is on line 11 in the fixture
      const consoleLog = result.calls.find(
        (c) => c.calledName === "log" && c.calledExpression === "console.log"
      );
      expect(consoleLog).toBeDefined();
      expect(consoleLog?.line).toBe(11);

      // All calls should have valid line numbers
      for (const call of result.calls) {
        expect(call.line).toBeGreaterThan(0);
      }
    });

    it("should handle nested function calls", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "function-calls.ts")).text();
      const result = await parser.parseFile(content, "function-calls.ts");

      // outer(inner()) - should extract both calls
      const outerCall = result.calls.find(
        (c) => c.calledName === "outer" && c.callerName === "nestedCalls"
      );
      expect(outerCall).toBeDefined();

      const innerCall = result.calls.find(
        (c) => c.calledName === "inner" && c.callerName === "nestedCalls"
      );
      expect(innerCall).toBeDefined();
    });

    it("should extract calls from arrow functions", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "function-calls.ts")).text();
      const result = await parser.parseFile(content, "function-calls.ts");

      // callFromArrow() in arrowFunction
      const arrowCall = result.calls.find(
        (c) => c.calledName === "callFromArrow" && c.callerName === "arrowFunction"
      );
      expect(arrowCall).toBeDefined();

      // processNumber(x) in arrowWithParams
      const arrowWithParamsCall = result.calls.find(
        (c) => c.calledName === "processNumber" && c.callerName === "arrowWithParams"
      );
      expect(arrowWithParamsCall).toBeDefined();
    });

    it("should handle optional chaining calls", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "function-calls.ts")).text();
      const result = await parser.parseFile(content, "function-calls.ts");

      // obj?.method() call
      const optionalCall = result.calls.find(
        (c) => c.callerName === "optionalChaining" && c.calledName === "method"
      );
      expect(optionalCall).toBeDefined();

      // deeply?.nested?.call() call
      const deepOptionalCall = result.calls.find(
        (c) => c.callerName === "optionalChaining" && c.calledName === "call"
      );
      expect(deepOptionalCall).toBeDefined();
    });

    it("should extract calls from higher-order function callbacks", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "function-calls.ts")).text();
      const result = await parser.parseFile(content, "function-calls.ts");

      // Higher order function calls: map, filter, forEach
      const higherOrderCalls = result.calls.filter((c) => c.callerName === "higherOrder");
      expect(higherOrderCalls.length).toBeGreaterThanOrEqual(3);

      const callNames = higherOrderCalls.map((c) => c.calledName);
      expect(callNames).toContain("map");
      expect(callNames).toContain("filter");
      expect(callNames).toContain("forEach");

      // Also check for transform, validate, process calls inside callbacks
      expect(callNames).toContain("transform");
      expect(callNames).toContain("process");
    });

    it("should extract calls from exported functions", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "function-calls.ts")).text();
      const result = await parser.parseFile(content, "function-calls.ts");

      // internalCall() in exportedWithCalls
      const exportedCall = result.calls.find(
        (c) => c.calledName === "internalCall" && c.callerName === "exportedWithCalls"
      );
      expect(exportedCall).toBeDefined();

      // await asyncInternalCall() in exportedAsync
      const asyncExportedCall = result.calls.find(
        (c) => c.calledName === "asyncInternalCall" && c.callerName === "exportedAsync"
      );
      expect(asyncExportedCall).toBeDefined();
      expect(asyncExportedCall?.isAsync).toBe(true);
    });

    it("should handle deep property access calls", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "function-calls.ts")).text();
      const result = await parser.parseFile(content, "function-calls.ts");

      // this.service.repository.find()
      const deepAccessCall = result.calls.find(
        (c) => c.callerName === "deepPropertyAccess" && c.calledName === "find"
      );
      expect(deepAccessCall).toBeDefined();
      expect(deepAccessCall?.calledExpression).toBe("this.service.repository.find");
    });

    it("should extract calls from callbacks", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "function-calls.ts")).text();
      const result = await parser.parseFile(content, "function-calls.ts");

      // setTimeout call
      const setTimeoutCall = result.calls.find(
        (c) => c.calledName === "setTimeout" && c.callerName === "withCallback"
      );
      expect(setTimeoutCall).toBeDefined();

      // callbackAction() inside setTimeout callback
      const callbackActionCall = result.calls.find((c) => c.calledName === "callbackAction");
      expect(callbackActionCall).toBeDefined();

      // promise.then call
      const thenCall = result.calls.find(
        (c) => c.calledName === "then" && c.callerName === "withCallback"
      );
      expect(thenCall).toBeDefined();
    });

    it("should handle tagged template literals", async () => {
      // Tagged template literals are a form of function call in JavaScript/TypeScript
      // This test documents current behavior: they ARE captured as calls
      const content = `
function withTaggedTemplate() {
  const query = sql\`SELECT * FROM users\`;
  const styled = css\`color: red\`;
}
`;
      const result = await parser.parseFile(content, "tagged-template.ts");

      expect(result.success).toBe(true);

      // Tagged template literals are captured as call expressions by tree-sitter
      // The "function" being called is the tag (sql, css, etc.)
      const taggedCalls = result.calls.filter((c) => c.callerName === "withTaggedTemplate");

      // Document that tagged templates ARE captured
      // sql\`...\` is parsed as a call to "sql"
      const sqlCall = taggedCalls.find((c) => c.calledName === "sql");
      expect(sqlCall).toBeDefined();

      const cssCall = taggedCalls.find((c) => c.calledName === "css");
      expect(cssCall).toBeDefined();
    });
  });

  describe("parseFile - Configuration Options", () => {
    it("should include anonymous functions when includeAnonymous is true", async () => {
      const content = `
const handler = function() {
  return "anonymous";
};

const arrowFn = () => {
  return "arrow";
};
`;

      const parserWithAnonymous = new TreeSitterParser(undefined, {
        includeAnonymous: true,
      });

      const result = await parserWithAnonymous.parseFile(content, "anonymous.ts");

      expect(result.success).toBe(true);
      // Should include the anonymous function entities
      const anonymousEntities = result.entities.filter((e) => e.name === "<anonymous>");
      expect(anonymousEntities.length).toBeGreaterThan(0);
    });

    it("should exclude anonymous functions by default (includeAnonymous: false)", async () => {
      const content = `
const handler = function() {
  return "anonymous";
};
`;

      // Default parser (includeAnonymous: false)
      const result = await parser.parseFile(content, "anonymous.ts");

      expect(result.success).toBe(true);
      // Should NOT include anonymous function entities
      const anonymousEntities = result.entities.filter((e) => e.name === "<anonymous>");
      expect(anonymousEntities.length).toBe(0);
    });

    it("should skip documentation extraction when extractDocumentation is false", async () => {
      const content = `
/**
 * This is a documented function.
 * @param x The input number
 * @returns The doubled number
 */
export function documented(x: number): number {
  return x * 2;
}
`;

      const parserWithoutDocs = new TreeSitterParser(undefined, {
        extractDocumentation: false,
      });

      const result = await parserWithoutDocs.parseFile(content, "documented.ts");

      expect(result.success).toBe(true);
      const fn = result.entities.find((e) => e.name === "documented");
      expect(fn).toBeDefined();
      // Documentation should NOT be extracted
      expect(fn?.metadata?.documentation).toBeUndefined();
    });

    it("should extract documentation by default (extractDocumentation: true)", async () => {
      const content = `
/**
 * This is a documented function.
 */
export function documented(): void {}
`;

      // Default parser (extractDocumentation: true)
      const result = await parser.parseFile(content, "documented.ts");

      expect(result.success).toBe(true);
      const fn = result.entities.find((e) => e.name === "documented");
      expect(fn).toBeDefined();
      // Documentation should be extracted
      expect(fn?.metadata?.documentation).toBeDefined();
      expect(fn?.metadata?.documentation).toContain("documented function");
    });
  });

  // ==================== Python Parsing Tests ====================

  describe("parseFile - Python Functions", () => {
    it("should parse simple Python functions", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-python.py")).text();
      const result = await parser.parseFile(content, "simple-python.py");

      expect(result.success).toBe(true);
      expect(result.language).toBe("python");
      expect(result.errors).toHaveLength(0);

      // Check entities were extracted
      expect(result.entities.length).toBeGreaterThan(0);

      // Find the simple_function
      const simpleFunc = result.entities.find((e) => e.name === "simple_function");
      expect(simpleFunc).toBeDefined();
      expect(simpleFunc?.type).toBe("function");

      // Find function with typed parameters
      const paramFunc = result.entities.find((e) => e.name === "function_with_params");
      expect(paramFunc).toBeDefined();
      expect(paramFunc?.type).toBe("function");
      expect(paramFunc?.metadata?.parameters).toBeDefined();
      expect(paramFunc?.metadata?.parameters?.length).toBe(2);
      // Check first parameter (name: str)
      expect(paramFunc?.metadata?.parameters?.[0]?.name).toBe("name");
      expect(paramFunc?.metadata?.parameters?.[0]?.type).toBe("str");
      // Check second parameter (count: int = 5)
      expect(paramFunc?.metadata?.parameters?.[1]?.name).toBe("count");
      expect(paramFunc?.metadata?.parameters?.[1]?.hasDefault).toBe(true);
    });

    it("should parse async Python functions", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-python.py")).text();
      const result = await parser.parseFile(content, "simple-python.py");

      const asyncFunc = result.entities.find((e) => e.name === "async_fetch_data");
      expect(asyncFunc).toBeDefined();
      expect(asyncFunc?.metadata?.isAsync).toBe(true);
      expect(asyncFunc?.metadata?.returnType).toBe("Dict[str, str]");
    });

    it("should parse functions with *args and **kwargs", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-python.py")).text();
      const result = await parser.parseFile(content, "simple-python.py");

      const argsFunc = result.entities.find((e) => e.name === "function_with_args_kwargs");
      expect(argsFunc).toBeDefined();
      expect(argsFunc?.metadata?.parameters).toBeDefined();
      // Should have *args and **kwargs parameters
      const params = argsFunc?.metadata?.parameters ?? [];
      expect(params.some((p) => p.isRest)).toBe(true);
    });

    it("should extract Python docstrings as documentation", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-python.py")).text();
      const result = await parser.parseFile(content, "simple-python.py");

      const docFunc = result.entities.find((e) => e.name === "function_with_params");
      expect(docFunc?.metadata?.documentation).toBeDefined();
      expect(docFunc?.metadata?.documentation).toContain("typed parameters");
    });
  });

  describe("parseFile - Python Classes", () => {
    it("should parse Python classes", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-python.py")).text();
      const result = await parser.parseFile(content, "simple-python.py");

      // Find base Animal class
      const animal = result.entities.find((e) => e.name === "Animal");
      expect(animal).toBeDefined();
      expect(animal?.type).toBe("class");

      // Find Dog class that extends Animal
      const dog = result.entities.find((e) => e.name === "Dog");
      expect(dog).toBeDefined();
      expect(dog?.type).toBe("class");
      expect(dog?.metadata?.extends).toBe("Animal");
    });

    it("should parse decorated Python classes", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-python.py")).text();
      const result = await parser.parseFile(content, "simple-python.py");

      // Find dataclass DataPoint
      const dataPoint = result.entities.find((e) => e.name === "DataPoint");
      expect(dataPoint).toBeDefined();
      expect(dataPoint?.type).toBe("class");
    });

    it("should extract class docstrings", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-python.py")).text();
      const result = await parser.parseFile(content, "simple-python.py");

      const animal = result.entities.find((e) => e.name === "Animal");
      expect(animal?.metadata?.documentation).toBeDefined();
      expect(animal?.metadata?.documentation).toContain("Base class");
    });
  });

  describe("parseFile - Python Imports", () => {
    it("should extract various Python import types", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-python.py")).text();
      const result = await parser.parseFile(content, "simple-python.py");

      expect(result.success).toBe(true);
      expect(result.imports.length).toBeGreaterThan(0);

      // Standard import: import os
      const osImport = result.imports.find((i) => i.source === "os");
      expect(osImport).toBeDefined();

      // From import: from typing import Optional, List
      const typingImport = result.imports.find((i) => i.source === "typing");
      expect(typingImport).toBeDefined();
      expect(typingImport?.importedNames).toContain("Optional");
      expect(typingImport?.importedNames).toContain("List");

      // Aliased import: import json as json_module
      const jsonImport = result.imports.find(
        (i) => i.source === "json" && i.aliases?.["json"] === "json_module"
      );
      expect(jsonImport).toBeDefined();

      // From aliased import: from pathlib import Path as PathAlias
      const pathImport = result.imports.find(
        (i) => i.source === "pathlib" && i.aliases?.["Path"] === "PathAlias"
      );
      expect(pathImport).toBeDefined();
    });
  });

  describe("parseFile - Python Function Calls", () => {
    it("should extract Python function calls", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-python.py")).text();
      const result = await parser.parseFile(content, "simple-python.py");

      expect(result.success).toBe(true);
      expect(result.calls.length).toBeGreaterThan(0);

      // Find call to simple_function
      const simpleCall = result.calls.find((c) => c.calledName === "simple_function");
      expect(simpleCall).toBeDefined();

      // Find call to private_helper within function_with_calls
      const helperCall = result.calls.find(
        (c) => c.calledName === "private_helper" && c.callerName === "function_with_calls"
      );
      expect(helperCall).toBeDefined();
    });

    it("should detect async calls (await expressions)", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-python.py")).text();
      const result = await parser.parseFile(content, "simple-python.py");

      // Find awaited call to async_fetch_data
      const asyncCall = result.calls.find(
        (c) => c.calledName === "async_fetch_data" && c.callerName === "async_caller"
      );
      expect(asyncCall).toBeDefined();
      expect(asyncCall?.isAsync).toBe(true);
    });

    it("should extract method calls", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-python.py")).text();
      const result = await parser.parseFile(content, "simple-python.py");

      // Find call to Calculator.add (static method)
      const addCall = result.calls.find((c) => c.calledName === "add");
      expect(addCall).toBeDefined();
    });
  });

  describe("parseFile - Python Exports", () => {
    it("should return empty exports for Python (no explicit exports)", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-python.py")).text();
      const result = await parser.parseFile(content, "simple-python.py");

      // Python doesn't have explicit export statements like JS/TS
      // All module-level definitions are implicitly exported
      expect(result.exports).toHaveLength(0);
    });
  });

  // ==================== Java Tests ====================

  describe("parseFile - Java Classes and Methods", () => {
    it("should parse simple Java class", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-class.java")).text();
      const result = await parser.parseFile(content, "simple-class.java");

      expect(result.success).toBe(true);
      expect(result.language).toBe("java");
      expect(result.errors).toHaveLength(0);

      // Find SimpleClass
      const simpleClass = result.entities.find((e) => e.name === "SimpleClass");
      expect(simpleClass).toBeDefined();
      expect(simpleClass?.type).toBe("class");

      // Find methods
      const getName = result.entities.find((e) => e.name === "getName");
      expect(getName).toBeDefined();
      expect(getName?.type).toBe("method");
      expect(getName?.metadata?.returnType).toBe("String");

      const setName = result.entities.find((e) => e.name === "setName");
      expect(setName).toBeDefined();
      expect(setName?.metadata?.parameters).toBeDefined();
      expect(setName?.metadata?.parameters?.length).toBe(1);
      expect(setName?.metadata?.parameters?.[0]?.name).toBe("name");
      expect(setName?.metadata?.parameters?.[0]?.type).toBe("String");

      const calculate = result.entities.find((e) => e.name === "calculate");
      expect(calculate).toBeDefined();
      expect(calculate?.metadata?.parameters?.[0]?.type).toBe("int");

      // Find static method
      const staticMethod = result.entities.find((e) => e.name === "staticMethod");
      expect(staticMethod).toBeDefined();
      expect(staticMethod?.metadata?.isStatic).toBe(true);

      // Find fields (properties)
      const nameField = result.entities.find((e) => e.name === "name" && e.type === "property");
      expect(nameField).toBeDefined();
    });

    it("should extract Javadoc documentation", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-class.java")).text();
      const result = await parser.parseFile(content, "simple-class.java");

      const simpleClass = result.entities.find((e) => e.name === "SimpleClass");
      expect(simpleClass?.metadata?.documentation).toBeDefined();
      expect(simpleClass?.metadata?.documentation).toContain("Simple class");
    });
  });

  describe("parseFile - Java Inheritance", () => {
    it("should parse interfaces and abstract classes", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "complex-inheritance.java")).text();
      const result = await parser.parseFile(content, "complex-inheritance.java");

      expect(result.success).toBe(true);

      // Find interface
      const dataProcessor = result.entities.find((e) => e.name === "DataProcessor");
      expect(dataProcessor).toBeDefined();
      expect(dataProcessor?.type).toBe("interface");

      // Find abstract class with generics
      const baseHandler = result.entities.find((e) => e.name === "BaseHandler");
      expect(baseHandler).toBeDefined();
      expect(baseHandler?.type).toBe("class");
      expect(baseHandler?.metadata?.isAbstract).toBe(true);
      expect(baseHandler?.metadata?.typeParameters).toContain("T");

      // Find concrete class with extends and implements
      const concreteHandler = result.entities.find((e) => e.name === "ConcreteHandler");
      expect(concreteHandler).toBeDefined();
      expect(concreteHandler?.metadata?.extends).toContain("BaseHandler");
      expect(concreteHandler?.metadata?.implements).toBeDefined();
      // Check that ConcreteHandler implements DataProcessor
      expect(concreteHandler?.metadata?.implements).toContain("DataProcessor");

      // Find enum
      const processingStatus = result.entities.find((e) => e.name === "ProcessingStatus");
      expect(processingStatus).toBeDefined();
      expect(processingStatus?.type).toBe("enum");
    });

    it("should parse varargs parameters", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "complex-inheritance.java")).text();
      const result = await parser.parseFile(content, "complex-inheritance.java");

      const processMultiple = result.entities.find((e) => e.name === "processMultiple");
      expect(processMultiple).toBeDefined();
      expect(processMultiple?.metadata?.parameters).toBeDefined();
      // Varargs parameter should be marked as isRest
      const itemsParam = processMultiple?.metadata?.parameters?.find((p) => p.name === "items");
      expect(itemsParam).toBeDefined();
      expect(itemsParam?.isRest).toBe(true);
    });
  });

  describe("parseFile - Java Imports", () => {
    it("should parse Java import statements", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "java-imports.java")).text();
      const result = await parser.parseFile(content, "java-imports.java");

      expect(result.success).toBe(true);
      expect(result.imports.length).toBeGreaterThan(0);

      // Check for standard import
      const listImport = result.imports.find((i) => i.source.includes("java.util.List"));
      expect(listImport).toBeDefined();
      expect(listImport?.isRelative).toBe(false);

      // Check for wildcard import
      const ioImport = result.imports.find(
        (i) => i.source.includes("java.io") && i.importedNames.includes("*")
      );
      expect(ioImport).toBeDefined();

      // Check for static import
      const staticImport = result.imports.find((i) => i.source.includes("Math.PI"));
      expect(staticImport).toBeDefined();
    });
  });

  describe("parseFile - Java Function Calls", () => {
    it("should parse Java method invocations", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-class.java")).text();
      const result = await parser.parseFile(content, "simple-class.java");

      expect(result.success).toBe(true);
      expect(result.calls.length).toBeGreaterThan(0);

      // Find System.out.println call
      const printCall = result.calls.find((c) => c.calledName === "println");
      expect(printCall).toBeDefined();
      expect(printCall?.calledExpression).toContain("println");
    });

    it("should track caller context for Java methods", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-class.java")).text();
      const result = await parser.parseFile(content, "simple-class.java");

      // Find a call inside the calculate method
      const callsInCalculate = result.calls.filter((c) => c.callerName === "calculate");
      expect(callsInCalculate.length).toBeGreaterThan(0);
    });
  });

  describe("parseFile - Java Exports", () => {
    it("should return empty exports for Java (no explicit exports)", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-class.java")).text();
      const result = await parser.parseFile(content, "simple-class.java");

      // Java doesn't have explicit export statements like JS/TS
      // Visibility is controlled by access modifiers (public/private/protected)
      expect(result.exports).toHaveLength(0);
    });
  });

  describe("static methods - Java support", () => {
    it("should correctly identify Java extensions", () => {
      expect(TreeSitterParser.isSupported(".java")).toBe(true);
      expect(TreeSitterParser.isSupported(".JAVA")).toBe(true);
    });

    it("should get language from Java extension", () => {
      expect(TreeSitterParser.getLanguageFromExtension(".java")).toBe("java");
    });
  });

  // ==================== Go Parsing Tests ====================

  describe("parseFile - Go Functions", () => {
    it("should parse simple Go functions", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-go.go")).text();
      const result = await parser.parseFile(content, "simple-go.go");

      expect(result.success).toBe(true);
      expect(result.language).toBe("go");
      expect(result.errors).toHaveLength(0);

      // Check entities were extracted
      expect(result.entities.length).toBeGreaterThan(0);

      // Find SimpleFunction (exported - starts with uppercase)
      const simpleFunc = result.entities.find((e) => e.name === "SimpleFunction");
      expect(simpleFunc).toBeDefined();
      expect(simpleFunc?.type).toBe("function");
      expect(simpleFunc?.isExported).toBe(true);

      // Find privateHelper (not exported - starts with lowercase)
      const privateFunc = result.entities.find((e) => e.name === "privateHelper");
      expect(privateFunc).toBeDefined();
      expect(privateFunc?.type).toBe("function");
      expect(privateFunc?.isExported).toBe(false);
    });

    it("should parse Go functions with parameters", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-go.go")).text();
      const result = await parser.parseFile(content, "simple-go.go");

      // Find FunctionWithParams
      const paramFunc = result.entities.find((e) => e.name === "FunctionWithParams");
      expect(paramFunc).toBeDefined();
      expect(paramFunc?.metadata?.parameters).toBeDefined();
      expect(paramFunc?.metadata?.parameters?.length).toBe(2);
      // Check parameters
      expect(paramFunc?.metadata?.parameters?.[0]?.name).toBe("name");
      expect(paramFunc?.metadata?.parameters?.[0]?.type).toBe("string");
      expect(paramFunc?.metadata?.parameters?.[1]?.name).toBe("count");
      expect(paramFunc?.metadata?.parameters?.[1]?.type).toBe("int");
    });

    it("should parse Go functions with multiple return values", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-go.go")).text();
      const result = await parser.parseFile(content, "simple-go.go");

      const multiReturnFunc = result.entities.find((e) => e.name === "FunctionWithMultipleReturns");
      expect(multiReturnFunc).toBeDefined();
      // Return type includes both types
      expect(multiReturnFunc?.metadata?.returnType).toContain("int");
      expect(multiReturnFunc?.metadata?.returnType).toContain("error");
    });

    it("should parse Go functions with variadic parameters", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-go.go")).text();
      const result = await parser.parseFile(content, "simple-go.go");

      const variadicFunc = result.entities.find((e) => e.name === "FunctionWithVariadic");
      expect(variadicFunc).toBeDefined();
      expect(variadicFunc?.metadata?.parameters).toBeDefined();
      const params = variadicFunc?.metadata?.parameters ?? [];
      // Should have prefix (string) and values (...int)
      expect(params.some((p) => p.isRest)).toBe(true);
    });
  });

  describe("parseFile - Go Methods", () => {
    it("should parse Go methods with receivers", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-go.go")).text();
      const result = await parser.parseFile(content, "simple-go.go");

      // Find Distance method on Point
      const distanceMethod = result.entities.find((e) => e.name === "Distance");
      expect(distanceMethod).toBeDefined();
      expect(distanceMethod?.type).toBe("method");
      // Receiver type stored in extends field
      expect(distanceMethod?.metadata?.extends).toBe("*Point");

      // Find Scale method on Point
      const scaleMethod = result.entities.find((e) => e.name === "Scale");
      expect(scaleMethod).toBeDefined();
      expect(scaleMethod?.type).toBe("method");
      expect(scaleMethod?.metadata?.extends).toBe("*Point");
    });

    it("should parse methods with parameters and return types", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-go.go")).text();
      const result = await parser.parseFile(content, "simple-go.go");

      // Find Fetch method on Dog
      const fetchMethod = result.entities.find((e) => e.name === "Fetch" && e.type === "method");
      expect(fetchMethod).toBeDefined();
      expect(fetchMethod?.metadata?.parameters?.length).toBe(1);
      expect(fetchMethod?.metadata?.parameters?.[0]?.name).toBe("item");
      expect(fetchMethod?.metadata?.parameters?.[0]?.type).toBe("string");
      expect(fetchMethod?.metadata?.returnType).toBe("string");
    });
  });

  describe("parseFile - Go Types (Structs and Interfaces)", () => {
    it("should parse Go structs as class type", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-go.go")).text();
      const result = await parser.parseFile(content, "simple-go.go");

      // Find Point struct
      const point = result.entities.find((e) => e.name === "Point");
      expect(point).toBeDefined();
      expect(point?.type).toBe("class");
      expect(point?.isExported).toBe(true);

      // Find Dog struct
      const dog = result.entities.find((e) => e.name === "Dog" && e.type === "class");
      expect(dog).toBeDefined();
    });

    it("should parse Go interfaces as class type", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-go.go")).text();
      const result = await parser.parseFile(content, "simple-go.go");

      // Find Animal interface
      const animal = result.entities.find((e) => e.name === "Animal");
      expect(animal).toBeDefined();
      expect(animal?.type).toBe("class");
      expect(animal?.isExported).toBe(true);
    });

    it("should parse Go generics (type parameters)", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-go.go")).text();
      const result = await parser.parseFile(content, "simple-go.go");

      // Find Pair generic struct
      const pair = result.entities.find((e) => e.name === "Pair");
      expect(pair).toBeDefined();
      expect(pair?.type).toBe("class");

      // Find GenericFunction
      const genericFunc = result.entities.find((e) => e.name === "GenericFunction");
      expect(genericFunc).toBeDefined();
    });
  });

  describe("parseFile - Go Imports", () => {
    it("should extract various Go import types", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-go.go")).text();
      const result = await parser.parseFile(content, "simple-go.go");

      expect(result.success).toBe(true);
      expect(result.imports.length).toBeGreaterThan(0);

      // Standard library import: "fmt"
      const fmtImport = result.imports.find((i) => i.source === "fmt");
      expect(fmtImport).toBeDefined();

      // Aliased import: customalias "path/filepath"
      const aliasedImport = result.imports.find((i) => i.source === "path/filepath");
      expect(aliasedImport).toBeDefined();
      expect(aliasedImport?.aliases?.["filepath"]).toBe("customalias");

      // Blank import: _ "database/sql"
      const blankImport = result.imports.find((i) => i.source === "database/sql");
      expect(blankImport).toBeDefined();
      expect(blankImport?.isSideEffect).toBe(true);
    });
  });

  describe("parseFile - Go Function Calls", () => {
    it("should extract Go function calls", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-go.go")).text();
      const result = await parser.parseFile(content, "simple-go.go");

      expect(result.success).toBe(true);
      expect(result.calls.length).toBeGreaterThan(0);

      // Find call to SimpleFunction within FunctionWithCalls
      const simpleCall = result.calls.find(
        (c) => c.calledName === "SimpleFunction" && c.callerName === "FunctionWithCalls"
      );
      expect(simpleCall).toBeDefined();

      // Find call to fmt.Println
      const printlnCall = result.calls.find((c) => c.calledName === "Println");
      expect(printlnCall).toBeDefined();
      expect(printlnCall?.calledExpression).toBe("fmt.Println");
    });

    it("should extract method calls", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-go.go")).text();
      const result = await parser.parseFile(content, "simple-go.go");

      // Find calc.Add() call
      const addCall = result.calls.find(
        (c) => c.calledName === "Add" && c.callerName === "FunctionWithCalls"
      );
      expect(addCall).toBeDefined();
      expect(addCall?.calledExpression).toBe("calc.Add");

      // Find point.Scale() call
      const scaleCall = result.calls.find(
        (c) => c.calledName === "Scale" && c.callerName === "FunctionWithCalls"
      );
      expect(scaleCall).toBeDefined();
    });

    it("should track caller context correctly", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-go.go")).text();
      const result = await parser.parseFile(content, "simple-go.go");

      // Calls within FunctionWithCalls
      const callsInFunc = result.calls.filter((c) => c.callerName === "FunctionWithCalls");
      expect(callsInFunc.length).toBeGreaterThan(0);

      // Calls within HTTPHandler
      const callsInHandler = result.calls.filter((c) => c.callerName === "HTTPHandler");
      expect(callsInHandler.length).toBeGreaterThan(0);
    });

    it("should not mark Go calls as async (Go has goroutines, not async/await)", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-go.go")).text();
      const result = await parser.parseFile(content, "simple-go.go");

      // All Go calls should have isAsync = false since Go doesn't use async/await
      for (const call of result.calls) {
        expect(call.isAsync).toBe(false);
      }
    });
  });

  describe("parseFile - Go Exports", () => {
    it("should return empty exports for Go (visibility by naming convention)", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-go.go")).text();
      const result = await parser.parseFile(content, "simple-go.go");

      // Go doesn't have explicit export statements like JS/TS
      // Visibility is determined by identifier case (uppercase = exported)
      expect(result.exports).toHaveLength(0);
    });
  });

  describe("parseFile - Go Documentation", () => {
    it("should extract Go documentation comments", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-go.go")).text();
      const result = await parser.parseFile(content, "simple-go.go");

      // Find SimpleFunction and check documentation
      const simpleFunc = result.entities.find((e) => e.name === "SimpleFunction");
      expect(simpleFunc?.metadata?.documentation).toBeDefined();
      expect(simpleFunc?.metadata?.documentation).toContain("simple function");
    });
  });

  describe("parseFile - Go Extension Support", () => {
    it("should correctly identify .go extension as supported", () => {
      expect(TreeSitterParser.isSupported(".go")).toBe(true);
      expect(TreeSitterParser.isSupported(".GO")).toBe(true);
    });

    it("should get language from .go extension", () => {
      expect(TreeSitterParser.getLanguageFromExtension(".go")).toBe("go");
    });
  });

  // =====================================================
  // Rust Language Support Tests
  // =====================================================

  describe("parseFile - Rust Functions", () => {
    it("should parse simple Rust functions", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-rust.rs")).text();
      const result = await parser.parseFile(content, "simple-rust.rs");

      expect(result.success).toBe(true);
      expect(result.language).toBe("rust");
      expect(result.errors).toHaveLength(0);

      // Check entities were extracted
      expect(result.entities.length).toBeGreaterThan(0);

      // Find simple_function (exported - has pub)
      const simpleFunc = result.entities.find((e) => e.name === "simple_function");
      expect(simpleFunc).toBeDefined();
      expect(simpleFunc?.type).toBe("function");
      expect(simpleFunc?.isExported).toBe(true);

      // Find private_helper (not exported - no pub)
      const privateFunc = result.entities.find((e) => e.name === "private_helper");
      expect(privateFunc).toBeDefined();
      expect(privateFunc?.type).toBe("function");
      expect(privateFunc?.isExported).toBe(false);
    });

    it("should parse Rust functions with parameters", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-rust.rs")).text();
      const result = await parser.parseFile(content, "simple-rust.rs");

      // Find function_with_params
      const paramFunc = result.entities.find((e) => e.name === "function_with_params");
      expect(paramFunc).toBeDefined();
      expect(paramFunc?.metadata?.parameters).toBeDefined();
      expect(paramFunc?.metadata?.parameters?.length).toBe(2);
      // Check parameters
      expect(paramFunc?.metadata?.parameters?.[0]?.name).toBe("name");
      expect(paramFunc?.metadata?.parameters?.[0]?.type).toBe("&str");
      expect(paramFunc?.metadata?.parameters?.[1]?.name).toBe("count");
      expect(paramFunc?.metadata?.parameters?.[1]?.type).toBe("i32");
    });

    it("should parse async functions", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-rust.rs")).text();
      const result = await parser.parseFile(content, "simple-rust.rs");

      // Find async_function
      const asyncFunc = result.entities.find((e) => e.name === "async_function");
      expect(asyncFunc).toBeDefined();
      expect(asyncFunc?.metadata?.isAsync).toBe(true);
    });

    it("should parse const functions", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-rust.rs")).text();
      const result = await parser.parseFile(content, "simple-rust.rs");

      // Find const_function
      const constFunc = result.entities.find((e) => e.name === "const_function");
      expect(constFunc).toBeDefined();
      expect(constFunc?.type).toBe("function");
    });

    it("should extract Rust doc comments", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-rust.rs")).text();
      const result = await parser.parseFile(content, "simple-rust.rs");

      // Find simple_function and check documentation
      const simpleFunc = result.entities.find((e) => e.name === "simple_function");
      expect(simpleFunc?.metadata?.documentation).toBeDefined();
      expect(simpleFunc?.metadata?.documentation).toContain("simple public function");
    });
  });

  describe("parseFile - Rust Types (Structs, Traits, Enums)", () => {
    it("should parse Rust structs as class type", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-rust.rs")).text();
      const result = await parser.parseFile(content, "simple-rust.rs");

      // Find Point struct
      const point = result.entities.find((e) => e.name === "Point" && e.type === "class");
      expect(point).toBeDefined();
      expect(point?.isExported).toBe(true);

      // Find Dog struct
      const dog = result.entities.find((e) => e.name === "Dog" && e.type === "class");
      expect(dog).toBeDefined();
    });

    it("should parse Rust traits as interface type", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-rust.rs")).text();
      const result = await parser.parseFile(content, "simple-rust.rs");

      // Find Animal trait
      const animal = result.entities.find((e) => e.name === "Animal");
      expect(animal).toBeDefined();
      expect(animal?.type).toBe("interface");
      expect(animal?.isExported).toBe(true);
    });

    it("should parse Rust enums", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-rust.rs")).text();
      const result = await parser.parseFile(content, "simple-rust.rs");

      // Find Color enum
      const color = result.entities.find((e) => e.name === "Color");
      expect(color).toBeDefined();
      expect(color?.type).toBe("enum");
      expect(color?.isExported).toBe(true);
    });

    it("should parse Rust type aliases", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-rust.rs")).text();
      const result = await parser.parseFile(content, "simple-rust.rs");

      // Find Result type alias
      const resultType = result.entities.find(
        (e) => e.name === "Result" && e.type === "type_alias"
      );
      expect(resultType).toBeDefined();
      expect(resultType?.isExported).toBe(true);
    });

    it("should parse generic structs with type parameters", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-rust.rs")).text();
      const result = await parser.parseFile(content, "simple-rust.rs");

      // Find Pair generic struct
      const pair = result.entities.find((e) => e.name === "Pair" && e.type === "class");
      expect(pair).toBeDefined();
      expect(pair?.metadata?.typeParameters).toBeDefined();
      expect(pair?.metadata?.typeParameters?.length).toBeGreaterThan(0);
    });
  });

  describe("parseFile - Rust Variables (const/static)", () => {
    it("should parse const items as variables", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-rust.rs")).text();
      const result = await parser.parseFile(content, "simple-rust.rs");

      // Find MAX_SIZE const
      const maxSize = result.entities.find((e) => e.name === "MAX_SIZE");
      expect(maxSize).toBeDefined();
      expect(maxSize?.type).toBe("variable");
      expect(maxSize?.isExported).toBe(true);

      // Find INTERNAL_BUFFER_SIZE (private const)
      const internalBuffer = result.entities.find((e) => e.name === "INTERNAL_BUFFER_SIZE");
      expect(internalBuffer).toBeDefined();
      expect(internalBuffer?.type).toBe("variable");
      expect(internalBuffer?.isExported).toBe(false);
    });

    it("should parse static items as variables", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-rust.rs")).text();
      const result = await parser.parseFile(content, "simple-rust.rs");

      // Find GLOBAL_COUNTER static
      const globalCounter = result.entities.find((e) => e.name === "GLOBAL_COUNTER");
      expect(globalCounter).toBeDefined();
      expect(globalCounter?.type).toBe("variable");
      expect(globalCounter?.isExported).toBe(true);
    });
  });

  describe("parseFile - Rust Imports", () => {
    it("should extract various Rust use declarations", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-rust.rs")).text();
      const result = await parser.parseFile(content, "simple-rust.rs");

      expect(result.success).toBe(true);
      expect(result.imports.length).toBeGreaterThan(0);

      // Standard library import: std::collections::HashMap
      const hashMapImport = result.imports.find((i) => i.source.includes("HashMap"));
      expect(hashMapImport).toBeDefined();

      // Find aliased import: std::path::PathBuf as Path
      const aliasedImport = result.imports.find((i) => i.source.includes("PathBuf"));
      expect(aliasedImport).toBeDefined();
    });

    it("should identify relative imports (crate, self, super)", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-rust.rs")).text();
      const result = await parser.parseFile(content, "simple-rust.rs");

      // Find crate:: import
      const crateImport = result.imports.find((i) => i.source.startsWith("crate"));
      expect(crateImport).toBeDefined();
      expect(crateImport?.isRelative).toBe(true);

      // Find self:: import
      const selfImport = result.imports.find((i) => i.source.startsWith("self"));
      expect(selfImport).toBeDefined();
      expect(selfImport?.isRelative).toBe(true);

      // Find super:: import
      const superImport = result.imports.find((i) => i.source.startsWith("super"));
      expect(superImport).toBeDefined();
      expect(superImport?.isRelative).toBe(true);
    });

    it("should handle wildcard (glob) imports", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-rust.rs")).text();
      const result = await parser.parseFile(content, "simple-rust.rs");

      // Find wildcard import: use std::collections::*
      // The wildcard import should have source as the path before * and namespaceImport as "*"
      const wildcardImport = result.imports.find((i) => i.namespaceImport === "*");
      expect(wildcardImport).toBeDefined();
      expect(wildcardImport?.source).toBe("std::collections");
      expect(wildcardImport?.isSideEffect).toBe(true); // Glob imports are side-effect imports
    });
  });

  describe("parseFile - Rust Function Calls", () => {
    it("should extract Rust function calls", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-rust.rs")).text();
      const result = await parser.parseFile(content, "simple-rust.rs");

      expect(result.success).toBe(true);
      expect(result.calls.length).toBeGreaterThan(0);

      // Find call to simple_function within function_with_calls
      const simpleCall = result.calls.find(
        (c) => c.calledName === "simple_function" && c.callerName === "function_with_calls"
      );
      expect(simpleCall).toBeDefined();

      // Find call to function_with_params
      const paramCall = result.calls.find(
        (c) => c.calledName === "function_with_params" && c.callerName === "function_with_calls"
      );
      expect(paramCall).toBeDefined();
    });

    it("should extract method calls", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-rust.rs")).text();
      const result = await parser.parseFile(content, "simple-rust.rs");

      // Find point.distance() call
      const distanceCall = result.calls.find(
        (c) => c.calledName === "distance" && c.callerName === "function_with_calls"
      );
      expect(distanceCall).toBeDefined();
      expect(distanceCall?.calledExpression).toContain("distance");
    });

    it("should track caller context correctly", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-rust.rs")).text();
      const result = await parser.parseFile(content, "simple-rust.rs");

      // Calls within function_with_calls
      const callsInFunc = result.calls.filter((c) => c.callerName === "function_with_calls");
      expect(callsInFunc.length).toBeGreaterThan(0);
    });

    it("should not mark Rust calls as async (Rust uses .await suffix)", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-rust.rs")).text();
      const result = await parser.parseFile(content, "simple-rust.rs");

      // All Rust calls should have isAsync = false since Rust doesn't mark call sites as async
      for (const call of result.calls) {
        expect(call.isAsync).toBe(false);
      }
    });
  });

  describe("parseFile - Rust Exports", () => {
    it("should return empty exports for Rust (visibility by pub modifier)", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-rust.rs")).text();
      const result = await parser.parseFile(content, "simple-rust.rs");

      // Rust doesn't have explicit export statements like JS/TS
      // Visibility is determined by pub modifier
      expect(result.exports).toHaveLength(0);
    });
  });

  describe("parseFile - Rust Visibility Modifiers", () => {
    it("should detect pub as exported", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-rust.rs")).text();
      const result = await parser.parseFile(content, "simple-rust.rs");

      const pubFunc = result.entities.find((e) => e.name === "simple_function");
      expect(pubFunc?.isExported).toBe(true);
    });

    it("should detect pub(crate) as exported", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-rust.rs")).text();
      const result = await parser.parseFile(content, "simple-rust.rs");

      const crateFunc = result.entities.find((e) => e.name === "crate_visible_function");
      expect(crateFunc).toBeDefined();
      expect(crateFunc?.isExported).toBe(true);
    });

    it("should detect pub(super) as exported", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-rust.rs")).text();
      const result = await parser.parseFile(content, "simple-rust.rs");

      const superFunc = result.entities.find((e) => e.name === "super_visible_function");
      expect(superFunc).toBeDefined();
      expect(superFunc?.isExported).toBe(true);
    });
  });

  describe("parseFile - Rust Extension Support", () => {
    it("should correctly identify .rs extension as supported", () => {
      expect(TreeSitterParser.isSupported(".rs")).toBe(true);
      expect(TreeSitterParser.isSupported(".RS")).toBe(true);
    });

    it("should get language from .rs extension", () => {
      expect(TreeSitterParser.getLanguageFromExtension(".rs")).toBe("rust");
    });
  });

  // ==================== C Parsing Tests ====================

  describe("parseFile - C Functions", () => {
    it("should parse simple C functions", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-c.c")).text();
      const result = await parser.parseFile(content, "simple-c.c");

      expect(result.success).toBe(true);
      expect(result.language).toBe("c");
      expect(result.errors).toHaveLength(0);

      // Check entities were extracted
      expect(result.entities.length).toBeGreaterThan(0);

      // Find the add function
      const addFunc = result.entities.find((e) => e.name === "add");
      expect(addFunc).toBeDefined();
      expect(addFunc?.type).toBe("function");
      expect(addFunc?.metadata?.parameters).toBeDefined();
      expect(addFunc?.metadata?.parameters?.length).toBe(2);
      expect(addFunc?.metadata?.parameters?.[0]?.name).toBe("a");
      expect(addFunc?.metadata?.parameters?.[0]?.type).toBe("int");
      expect(addFunc?.metadata?.returnType).toBe("int");

      // Find main function
      const mainFunc = result.entities.find((e) => e.name === "main");
      expect(mainFunc).toBeDefined();
      expect(mainFunc?.type).toBe("function");
    });

    it("should extract C documentation comments", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-c.c")).text();
      const result = await parser.parseFile(content, "simple-c.c");

      const addFunc = result.entities.find((e) => e.name === "add");
      expect(addFunc?.metadata?.documentation).toBeDefined();
      expect(addFunc?.metadata?.documentation).toContain("simple function");
    });
  });

  describe("parseFile - C Structs, Unions, Enums", () => {
    it("should parse C structs", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-c.c")).text();
      const result = await parser.parseFile(content, "simple-c.c");

      // Find struct Point
      const point = result.entities.find((e) => e.name === "Point");
      expect(point).toBeDefined();
      expect(point?.type).toBe("class");
    });

    it("should parse C unions", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-c.c")).text();
      const result = await parser.parseFile(content, "simple-c.c");

      // Find union Data
      const data = result.entities.find((e) => e.name === "Data");
      expect(data).toBeDefined();
      expect(data?.type).toBe("class");
    });

    it("should parse C enums", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-c.c")).text();
      const result = await parser.parseFile(content, "simple-c.c");

      // Find enum Status
      const status = result.entities.find((e) => e.name === "Status");
      expect(status).toBeDefined();
      expect(status?.type).toBe("enum");
    });

    it("should parse C typedefs", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-c.c")).text();
      const result = await parser.parseFile(content, "simple-c.c");

      // Find typedef Point2D
      const point2d = result.entities.find((e) => e.name === "Point2D");
      expect(point2d).toBeDefined();
      expect(point2d?.type).toBe("type_alias");
    });
  });

  describe("parseFile - C Includes", () => {
    it("should extract C include directives", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-c.c")).text();
      const result = await parser.parseFile(content, "simple-c.c");

      expect(result.success).toBe(true);
      expect(result.imports.length).toBeGreaterThan(0);

      // Find system include: <stdio.h>
      const stdioInclude = result.imports.find((i) => i.source.includes("stdio.h"));
      expect(stdioInclude).toBeDefined();
      expect(stdioInclude?.isRelative).toBe(false);

      // Find local include: "local_header.h"
      const localInclude = result.imports.find((i) => i.source.includes("local_header.h"));
      expect(localInclude).toBeDefined();
      expect(localInclude?.isRelative).toBe(true);
    });
  });

  describe("parseFile - C Function Calls", () => {
    it("should extract C function calls", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-c.c")).text();
      const result = await parser.parseFile(content, "simple-c.c");

      expect(result.success).toBe(true);
      expect(result.calls.length).toBeGreaterThan(0);

      // Find call to add from main
      const addCall = result.calls.find((c) => c.calledName === "add" && c.callerName === "main");
      expect(addCall).toBeDefined();

      // Find call to printf from main
      const printfCall = result.calls.find(
        (c) => c.calledName === "printf" && c.callerName === "main"
      );
      expect(printfCall).toBeDefined();
    });

    it("should not mark C calls as async", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-c.c")).text();
      const result = await parser.parseFile(content, "simple-c.c");

      // All C calls should have isAsync = false
      for (const call of result.calls) {
        expect(call.isAsync).toBe(false);
      }
    });
  });

  describe("parseFile - C Extension Support", () => {
    it("should correctly identify C extensions as supported", () => {
      expect(TreeSitterParser.isSupported(".c")).toBe(true);
      expect(TreeSitterParser.isSupported(".h")).toBe(true);
      expect(TreeSitterParser.isSupported(".C")).toBe(true);
      expect(TreeSitterParser.isSupported(".H")).toBe(true);
    });

    it("should get language from C extensions", () => {
      expect(TreeSitterParser.getLanguageFromExtension(".c")).toBe("c");
      expect(TreeSitterParser.getLanguageFromExtension(".h")).toBe("c");
    });
  });

  // ==================== C++ Parsing Tests ====================

  describe("parseFile - C++ Functions", () => {
    it("should parse simple C++ functions", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-cpp.cpp")).text();
      const result = await parser.parseFile(content, "simple-cpp.cpp");

      expect(result.success).toBe(true);
      expect(result.language).toBe("cpp");
      expect(result.errors).toHaveLength(0);

      // Check entities were extracted
      expect(result.entities.length).toBeGreaterThan(0);

      // Find the multiply function
      const multiplyFunc = result.entities.find((e) => e.name === "multiply");
      expect(multiplyFunc).toBeDefined();
      expect(multiplyFunc?.type).toBe("function");
      expect(multiplyFunc?.metadata?.parameters?.length).toBe(2);
      expect(multiplyFunc?.metadata?.returnType).toBe("int");

      // Find main function
      const mainFunc = result.entities.find((e) => e.name === "main");
      expect(mainFunc).toBeDefined();
    });
  });

  describe("parseFile - C++ Classes", () => {
    it("should parse C++ classes", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-cpp.cpp")).text();
      const result = await parser.parseFile(content, "simple-cpp.cpp");

      // Find class Point
      const point = result.entities.find((e) => e.name === "Point");
      expect(point).toBeDefined();
      expect(point?.type).toBe("class");
    });

    it("should parse C++ structs", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-cpp.cpp")).text();
      const result = await parser.parseFile(content, "simple-cpp.cpp");

      // Find struct Rectangle
      const rect = result.entities.find((e) => e.name === "Rectangle");
      expect(rect).toBeDefined();
      expect(rect?.type).toBe("class");
    });

    it("should parse C++ enums", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-cpp.cpp")).text();
      const result = await parser.parseFile(content, "simple-cpp.cpp");

      // Find enum class Color
      const color = result.entities.find((e) => e.name === "Color");
      expect(color).toBeDefined();
      expect(color?.type).toBe("enum");
    });

    it("should parse C++ class with inheritance", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-cpp.cpp")).text();
      const result = await parser.parseFile(content, "simple-cpp.cpp");

      // Find Shape base class
      const shape = result.entities.find((e) => e.name === "Shape");
      expect(shape).toBeDefined();
      expect(shape?.type).toBe("class");

      // Find Circle class
      const circle = result.entities.find((e) => e.name === "Circle");
      expect(circle).toBeDefined();
      expect(circle?.type).toBe("class");
    });
  });

  describe("parseFile - C++ Templates", () => {
    it("should parse C++ template classes", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-cpp.cpp")).text();
      const result = await parser.parseFile(content, "simple-cpp.cpp");

      // Find template class Container
      const container = result.entities.find((e) => e.name === "Container");
      expect(container).toBeDefined();
      expect(container?.type).toBe("class");
    });

    it("should parse C++ template functions", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-cpp.cpp")).text();
      const result = await parser.parseFile(content, "simple-cpp.cpp");

      // Find template function add
      const addFunc = result.entities.find((e) => e.name === "add");
      expect(addFunc).toBeDefined();
      expect(addFunc?.type).toBe("function");
    });
  });

  describe("parseFile - C++ Includes", () => {
    it("should extract C++ include directives", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-cpp.cpp")).text();
      const result = await parser.parseFile(content, "simple-cpp.cpp");

      expect(result.success).toBe(true);
      expect(result.imports.length).toBeGreaterThan(0);

      // Find system include: <iostream>
      const iostreamInclude = result.imports.find((i) => i.source.includes("iostream"));
      expect(iostreamInclude).toBeDefined();
      expect(iostreamInclude?.isRelative).toBe(false);

      // Find local include: "local_header.hpp"
      const localInclude = result.imports.find((i) => i.source.includes("local_header.hpp"));
      expect(localInclude).toBeDefined();
      expect(localInclude?.isRelative).toBe(true);
    });
  });

  describe("parseFile - C++ Function Calls", () => {
    it("should extract C++ function calls", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-cpp.cpp")).text();
      const result = await parser.parseFile(content, "simple-cpp.cpp");

      expect(result.success).toBe(true);
      expect(result.calls.length).toBeGreaterThan(0);

      // Find call to multiply from main
      const multiplyCall = result.calls.find(
        (c) => c.calledName === "multiply" && c.callerName === "main"
      );
      expect(multiplyCall).toBeDefined();
    });

    it("should extract C++ method calls", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-cpp.cpp")).text();
      const result = await parser.parseFile(content, "simple-cpp.cpp");

      // Find method call p.distanceFromOrigin()
      const distanceCall = result.calls.find(
        (c) => c.calledName === "distanceFromOrigin" && c.callerName === "main"
      );
      expect(distanceCall).toBeDefined();

      // Find method call container.getValue()
      const getValueCall = result.calls.find(
        (c) => c.calledName === "getValue" && c.callerName === "main"
      );
      expect(getValueCall).toBeDefined();
    });
  });

  describe("parseFile - C++ Extension Support", () => {
    it("should correctly identify C++ extensions as supported", () => {
      expect(TreeSitterParser.isSupported(".cpp")).toBe(true);
      expect(TreeSitterParser.isSupported(".cc")).toBe(true);
      expect(TreeSitterParser.isSupported(".cxx")).toBe(true);
      expect(TreeSitterParser.isSupported(".hpp")).toBe(true);
      expect(TreeSitterParser.isSupported(".hxx")).toBe(true);
      expect(TreeSitterParser.isSupported(".CPP")).toBe(true);
    });

    it("should get language from C++ extensions", () => {
      expect(TreeSitterParser.getLanguageFromExtension(".cpp")).toBe("cpp");
      expect(TreeSitterParser.getLanguageFromExtension(".cc")).toBe("cpp");
      expect(TreeSitterParser.getLanguageFromExtension(".cxx")).toBe("cpp");
      expect(TreeSitterParser.getLanguageFromExtension(".hpp")).toBe("cpp");
      expect(TreeSitterParser.getLanguageFromExtension(".hxx")).toBe("cpp");
    });
  });

  describe("parseFile - C/C++ Exports", () => {
    it("should return empty exports for C (no export statements)", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-c.c")).text();
      const result = await parser.parseFile(content, "simple-c.c");

      // C doesn't have explicit export statements
      expect(result.exports).toHaveLength(0);
    });

    it("should return empty exports for C++ (no export statements)", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-cpp.cpp")).text();
      const result = await parser.parseFile(content, "simple-cpp.cpp");

      // C++ doesn't have explicit export statements (until C++20 modules)
      expect(result.exports).toHaveLength(0);
    });

    it("should mark C/C++ entities as exported by default", async () => {
      const cContent = await Bun.file(path.join(FIXTURES_DIR, "simple-c.c")).text();
      const cResult = await parser.parseFile(cContent, "simple-c.c");

      // C functions are exported by default (unless static)
      const addFunc = cResult.entities.find((e) => e.name === "add");
      expect(addFunc?.isExported).toBe(true);

      const cppContent = await Bun.file(path.join(FIXTURES_DIR, "simple-cpp.cpp")).text();
      const cppResult = await parser.parseFile(cppContent, "simple-cpp.cpp");

      // C++ functions are exported by default
      const multiplyFunc = cppResult.entities.find((e) => e.name === "multiply");
      expect(multiplyFunc?.isExported).toBe(true);
    });
  });

  // ==================== Ruby Tests ====================

  describe("parseFile - Ruby Classes", () => {
    it("should parse Ruby classes with inheritance", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-ruby.rb")).text();
      const result = await parser.parseFile(content, "simple-ruby.rb");

      expect(result.success).toBe(true);
      expect(result.language).toBe("ruby");

      // Find the User class
      const userClass = result.entities.find((e) => e.name === "User" && e.type === "class");
      expect(userClass).toBeDefined();
      expect(userClass?.isExported).toBe(true);
      expect(userClass?.metadata?.extends).toBe("BaseModel");
    });
  });

  describe("parseFile - Ruby Methods", () => {
    it("should parse Ruby instance methods", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-ruby.rb")).text();
      const result = await parser.parseFile(content, "simple-ruby.rb");

      expect(result.success).toBe(true);

      // Find instance methods
      const initMethod = result.entities.find((e) => e.name === "initialize");
      expect(initMethod).toBeDefined();
      expect(initMethod?.type).toBe("method");

      const displayMethod = result.entities.find((e) => e.name === "display_name");
      expect(displayMethod).toBeDefined();
      expect(displayMethod?.type).toBe("method");
    });

    it("should parse Ruby singleton methods (class methods)", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-ruby.rb")).text();
      const result = await parser.parseFile(content, "simple-ruby.rb");

      // Find singleton method (class method)
      const fromHashMethod = result.entities.find((e) => e.name === "from_hash");
      expect(fromHashMethod).toBeDefined();
      expect(fromHashMethod?.type).toBe("method");
      expect(fromHashMethod?.metadata?.isStatic).toBe(true);
    });

    it("should extract Ruby method parameters", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-ruby.rb")).text();
      const result = await parser.parseFile(content, "simple-ruby.rb");

      // Find initialize method with parameters
      const initMethod = result.entities.find((e) => e.name === "initialize");
      expect(initMethod?.metadata?.parameters).toBeDefined();
      expect(initMethod?.metadata?.parameters?.length).toBeGreaterThan(0);

      // Check for parameter with default value
      const emailParam = initMethod?.metadata?.parameters?.find((p) => p.name === "email");
      expect(emailParam?.hasDefault).toBe(true);
    });

    it("should extract Ruby splat and keyword parameters", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-ruby.rb")).text();
      const result = await parser.parseFile(content, "simple-ruby.rb");

      // Find method with splat/keyword params
      const updateMethod = result.entities.find((e) => e.name === "update");
      expect(updateMethod?.metadata?.parameters).toBeDefined();

      // Check for splat parameter
      const splatParam = updateMethod?.metadata?.parameters?.find((p) => p.isRest);
      expect(splatParam).toBeDefined();
    });
  });

  describe("parseFile - Ruby Imports", () => {
    it("should extract require statements", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-ruby.rb")).text();
      const result = await parser.parseFile(content, "simple-ruby.rb");

      expect(result.imports.length).toBeGreaterThan(0);

      // Find require 'json'
      const jsonImport = result.imports.find((i) => i.source === "json");
      expect(jsonImport).toBeDefined();
      expect(jsonImport?.isRelative).toBe(false);
    });

    it("should extract require_relative statements", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-ruby.rb")).text();
      const result = await parser.parseFile(content, "simple-ruby.rb");

      // Find require_relative './helper'
      const helperImport = result.imports.find((i) => i.source.includes("helper"));
      expect(helperImport).toBeDefined();
      expect(helperImport?.isRelative).toBe(true);
    });
  });

  describe("parseFile - Ruby Function Calls", () => {
    it("should extract Ruby method calls", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-ruby.rb")).text();
      const result = await parser.parseFile(content, "simple-ruby.rb");

      // Check for method calls (excluding require/require_relative)
      expect(result.calls.length).toBeGreaterThan(0);

      // Find a call with receiver (e.g., name.to_s)
      const toSCall = result.calls.find((c) => c.calledName === "to_s");
      expect(toSCall).toBeDefined();

      // Note: Ruby allows method calls without parentheses, which appear as identifiers
      // Only calls with parentheses like `function_with_params(a, b)` are detected
      // This is expected behavior - simple method calls may not be detected
    });
  });

  describe("parseFile - Ruby Exports", () => {
    it("should return empty exports for Ruby (no export statements)", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-ruby.rb")).text();
      const result = await parser.parseFile(content, "simple-ruby.rb");

      // Ruby doesn't have explicit export statements
      expect(result.exports).toHaveLength(0);
    });

    it("should mark Ruby entities as exported by default", async () => {
      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-ruby.rb")).text();
      const result = await parser.parseFile(content, "simple-ruby.rb");

      // Ruby has public visibility by default
      const userClass = result.entities.find((e) => e.name === "User");
      expect(userClass?.isExported).toBe(true);

      const initMethod = result.entities.find((e) => e.name === "initialize");
      expect(initMethod?.isExported).toBe(true);
    });
  });

  describe("parseFile - Ruby Extension Support", () => {
    it("should support .rb extension", () => {
      expect(TreeSitterParser.isSupported(".rb")).toBe(true);
      expect(TreeSitterParser.getLanguageFromExtension(".rb")).toBe("ruby");
    });

    it("should support .rake extension", () => {
      expect(TreeSitterParser.isSupported(".rake")).toBe(true);
      expect(TreeSitterParser.getLanguageFromExtension(".rake")).toBe("ruby");
    });

    it("should support .gemspec extension", () => {
      expect(TreeSitterParser.isSupported(".gemspec")).toBe(true);
      expect(TreeSitterParser.getLanguageFromExtension(".gemspec")).toBe("ruby");
    });
  });
});
