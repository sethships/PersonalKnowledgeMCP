/**
 * Unit tests for TreeSitterParser.
 *
 * Tests AST parsing and entity extraction for TypeScript and JavaScript files.
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
      expect(TreeSitterParser.isSupported(".ts")).toBe(true);
      expect(TreeSitterParser.isSupported(".tsx")).toBe(true);
      expect(TreeSitterParser.isSupported(".js")).toBe(true);
      expect(TreeSitterParser.isSupported(".jsx")).toBe(true);
      expect(TreeSitterParser.isSupported(".mjs")).toBe(true);
      expect(TreeSitterParser.isSupported(".cjs")).toBe(true);
      expect(TreeSitterParser.isSupported(".mts")).toBe(true);
      expect(TreeSitterParser.isSupported(".cts")).toBe(true);

      // Case insensitive
      expect(TreeSitterParser.isSupported(".TS")).toBe(true);
      expect(TreeSitterParser.isSupported(".TSX")).toBe(true);

      // Unsupported
      expect(TreeSitterParser.isSupported(".py")).toBe(false);
      expect(TreeSitterParser.isSupported(".css")).toBe(false);
      expect(TreeSitterParser.isSupported(".md")).toBe(false);
      expect(TreeSitterParser.isSupported("")).toBe(false);
    });

    it("should get language from extension", () => {
      expect(TreeSitterParser.getLanguageFromExtension(".ts")).toBe("typescript");
      expect(TreeSitterParser.getLanguageFromExtension(".tsx")).toBe("tsx");
      expect(TreeSitterParser.getLanguageFromExtension(".js")).toBe("javascript");
      expect(TreeSitterParser.getLanguageFromExtension(".jsx")).toBe("jsx");
      expect(TreeSitterParser.getLanguageFromExtension(".mjs")).toBe("javascript");
      expect(TreeSitterParser.getLanguageFromExtension(".mts")).toBe("typescript");

      expect(TreeSitterParser.getLanguageFromExtension(".py")).toBeNull();
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
});
