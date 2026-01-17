/**
 * Unit tests for RoslynParser.
 *
 * Tests C# AST parsing and entity extraction using Roslyn.
 * Note: These tests require .NET SDK to be installed.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import path from "node:path";
import { RoslynParser } from "../../../../src/graph/parsing/roslyn/RoslynParser.js";
import {
  isDotNetAvailable,
  resetDetectionCache,
} from "../../../../src/graph/parsing/roslyn/RoslynDetector.js";
import { RoslynNotAvailableError } from "../../../../src/graph/parsing/errors.js";
import { CodeParser } from "../../../../src/graph/parsing/CodeParser.js";
import { initializeLogger, resetLogger } from "../../../../src/logging/index.js";

// Path to test fixtures
const FIXTURES_DIR = path.join(process.cwd(), "tests/fixtures/parsing");

describe("RoslynParser", () => {
  let parser: RoslynParser;
  let dotNetAvailable = false;

  beforeAll(async () => {
    // Initialize logger for tests
    initializeLogger({ level: "error", format: "json" });

    // Reset detection cache for clean test
    resetDetectionCache();

    // Check if .NET is available
    dotNetAvailable = await isDotNetAvailable();

    // Create parser instance
    parser = new RoslynParser();
  });

  afterAll(() => {
    resetDetectionCache();
    resetLogger();
  });

  describe("availability detection", () => {
    it("should detect .NET SDK availability", async () => {
      const available = await parser.isAvailable();
      expect(typeof available).toBe("boolean");
    });

    it("should return detailed availability info", async () => {
      const result = await parser.getAvailability();
      expect(result).toHaveProperty("available");
      if (result.available) {
        expect(result.version).toBeDefined();
      } else {
        expect(result.error).toBeDefined();
      }
    });
  });

  describe("parseFile - C# Methods", () => {
    it("should parse simple C# methods", async () => {
      if (!dotNetAvailable) return;

      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-csharp.cs")).text();
      const result = await parser.parseFile(content, "simple-csharp.cs");

      expect(result.success).toBe(true);
      expect(result.language).toBe("csharp");
      expect(result.errors).toHaveLength(0);

      // Check entities were extracted
      expect(result.entities.length).toBeGreaterThan(0);

      // Find AddItem method
      const addItem = result.entities.find((e) => e.name === "AddItem");
      expect(addItem).toBeDefined();
      expect(addItem?.type).toBe("method");
      expect(addItem?.isExported).toBe(true);
    });

    it("should parse methods with parameters", async () => {
      if (!dotNetAvailable) return;

      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-csharp.cs")).text();
      const result = await parser.parseFile(content, "simple-csharp.cs");

      // Find MethodWithOptionalParams
      const methodWithParams = result.entities.find((e) => e.name === "MethodWithOptionalParams");
      expect(methodWithParams).toBeDefined();
      expect(methodWithParams?.metadata?.parameters).toBeDefined();
      expect(methodWithParams?.metadata?.parameters?.length).toBe(3);

      // Check optional parameters have hasDefault = true
      const optionalParam = methodWithParams?.metadata?.parameters?.find(
        (p) => p.name === "optional"
      );
      expect(optionalParam?.hasDefault).toBe(true);
    });

    it("should parse async methods", async () => {
      if (!dotNetAvailable) return;

      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-csharp.cs")).text();
      const result = await parser.parseFile(content, "simple-csharp.cs");

      // Find ProcessAsync method - use the class implementation (line 113) not the interface (line 93)
      // Interface method signatures don't have the 'async' keyword even if they return Task
      const asyncMethod = result.entities.find(
        (e) => e.name === "ProcessAsync" && e.metadata?.isAsync === true
      );
      expect(asyncMethod).toBeDefined();
      expect(asyncMethod?.lineStart).toBe(113); // The implementation in DataProcessor class
    });

    it("should parse static methods", async () => {
      if (!dotNetAvailable) return;

      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-csharp.cs")).text();
      const result = await parser.parseFile(content, "simple-csharp.cs");

      // Find Truncate static extension method
      const truncate = result.entities.find((e) => e.name === "Truncate");
      expect(truncate).toBeDefined();
      expect(truncate?.metadata?.isStatic).toBe(true);
    });

    it("should parse methods with params array", async () => {
      if (!dotNetAvailable) return;

      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-csharp.cs")).text();
      const result = await parser.parseFile(content, "simple-csharp.cs");

      // Find MethodWithParams
      const paramsMethod = result.entities.find((e) => e.name === "MethodWithParams");
      expect(paramsMethod).toBeDefined();
      expect(paramsMethod?.metadata?.parameters?.[0]?.isRest).toBe(true);
    });
  });

  describe("parseFile - C# Types", () => {
    it("should parse classes", async () => {
      if (!dotNetAvailable) return;

      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-csharp.cs")).text();
      const result = await parser.parseFile(content, "simple-csharp.cs");

      // Find SimpleClass
      const simpleClass = result.entities.find(
        (e) => e.name === "SimpleClass" && e.type === "class"
      );
      expect(simpleClass).toBeDefined();
      expect(simpleClass?.isExported).toBe(true);
    });

    it("should parse interfaces", async () => {
      if (!dotNetAvailable) return;

      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-csharp.cs")).text();
      const result = await parser.parseFile(content, "simple-csharp.cs");

      // Find IProcessor interface
      const processor = result.entities.find((e) => e.name === "IProcessor");
      expect(processor).toBeDefined();
      expect(processor?.type).toBe("interface");
      expect(processor?.isExported).toBe(true);
    });

    it("should parse structs as class type", async () => {
      if (!dotNetAvailable) return;

      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-csharp.cs")).text();
      const result = await parser.parseFile(content, "simple-csharp.cs");

      // Find Point struct
      const point = result.entities.find((e) => e.name === "Point" && e.type === "class");
      expect(point).toBeDefined();
      expect(point?.isExported).toBe(true);
    });

    it("should parse records as class type", async () => {
      if (!dotNetAvailable) return;

      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-csharp.cs")).text();
      const result = await parser.parseFile(content, "simple-csharp.cs");

      // Find Person record
      const person = result.entities.find((e) => e.name === "Person" && e.type === "class");
      expect(person).toBeDefined();
      expect(person?.isExported).toBe(true);
    });

    it("should parse enums", async () => {
      if (!dotNetAvailable) return;

      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-csharp.cs")).text();
      const result = await parser.parseFile(content, "simple-csharp.cs");

      // Find Status enum
      const status = result.entities.find((e) => e.name === "Status");
      expect(status).toBeDefined();
      expect(status?.type).toBe("enum");
      expect(status?.isExported).toBe(true);
    });

    it("should parse delegates as type_alias", async () => {
      if (!dotNetAvailable) return;

      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-csharp.cs")).text();
      const result = await parser.parseFile(content, "simple-csharp.cs");

      // Find MessageHandler delegate
      const delegate = result.entities.find((e) => e.name === "MessageHandler");
      expect(delegate).toBeDefined();
      expect(delegate?.type).toBe("type_alias");
    });

    it("should parse abstract classes", async () => {
      if (!dotNetAvailable) return;

      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-csharp.cs")).text();
      const result = await parser.parseFile(content, "simple-csharp.cs");

      // Find BaseEntity abstract class
      const baseEntity = result.entities.find((e) => e.name === "BaseEntity" && e.type === "class");
      expect(baseEntity).toBeDefined();
      expect(baseEntity?.metadata?.isAbstract).toBe(true);
    });

    it("should parse generic classes with type parameters", async () => {
      if (!dotNetAvailable) return;

      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-csharp.cs")).text();
      const result = await parser.parseFile(content, "simple-csharp.cs");

      // Find Repository<T> generic class
      const repo = result.entities.find((e) => e.name === "Repository" && e.type === "class");
      expect(repo).toBeDefined();
      expect(repo?.metadata?.typeParameters).toBeDefined();
      expect(repo?.metadata?.typeParameters?.length).toBe(1);
      expect(repo?.metadata?.typeParameters?.[0]).toBe("T");
    });
  });

  describe("parseFile - C# Properties and Fields", () => {
    it("should parse properties", async () => {
      if (!dotNetAvailable) return;

      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-csharp.cs")).text();
      const result = await parser.parseFile(content, "simple-csharp.cs");

      // Find Name property
      const nameProp = result.entities.find((e) => e.name === "Name" && e.type === "property");
      expect(nameProp).toBeDefined();
      expect(nameProp?.isExported).toBe(true);
    });

    it("should parse fields", async () => {
      if (!dotNetAvailable) return;

      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-csharp.cs")).text();
      const result = await parser.parseFile(content, "simple-csharp.cs");

      // Find _items field
      const itemsField = result.entities.find((e) => e.name === "_items" && e.type === "property");
      expect(itemsField).toBeDefined();
      expect(itemsField?.isExported).toBe(false); // private field
    });
  });

  describe("parseFile - C# Imports (using directives)", () => {
    it("should extract using directives", async () => {
      if (!dotNetAvailable) return;

      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-csharp.cs")).text();
      const result = await parser.parseFile(content, "simple-csharp.cs");

      expect(result.success).toBe(true);
      expect(result.imports.length).toBeGreaterThan(0);

      // Find System using
      const systemImport = result.imports.find((i) => i.source === "System");
      expect(systemImport).toBeDefined();
      expect(systemImport?.isRelative).toBe(false);
    });

    it("should parse aliased using directives", async () => {
      if (!dotNetAvailable) return;

      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-csharp.cs")).text();
      const result = await parser.parseFile(content, "simple-csharp.cs");

      // Find Path alias for System.IO.Path
      const aliasedImport = result.imports.find((i) => i.aliases && i.aliases["System.IO.Path"]);
      expect(aliasedImport).toBeDefined();
    });

    it("should parse static using directives", async () => {
      if (!dotNetAvailable) return;

      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-csharp.cs")).text();
      const result = await parser.parseFile(content, "simple-csharp.cs");

      // Find static using
      const staticImport = result.imports.find((i) => i.namespaceImport === "static");
      expect(staticImport).toBeDefined();
    });

    it("should mark all C# imports as non-relative", async () => {
      if (!dotNetAvailable) return;

      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-csharp.cs")).text();
      const result = await parser.parseFile(content, "simple-csharp.cs");

      for (const imp of result.imports) {
        expect(imp.isRelative).toBe(false);
      }
    });
  });

  describe("parseFile - C# Function Calls", () => {
    it("should extract method calls", async () => {
      if (!dotNetAvailable) return;

      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-csharp.cs")).text();
      const result = await parser.parseFile(content, "simple-csharp.cs");

      expect(result.success).toBe(true);
      expect(result.calls.length).toBeGreaterThan(0);
    });

    it("should extract constructor calls", async () => {
      if (!dotNetAvailable) return;

      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-csharp.cs")).text();
      const result = await parser.parseFile(content, "simple-csharp.cs");

      // Find new SimpleClass call
      const ctorCall = result.calls.find((c) => c.calledExpression.includes("new SimpleClass"));
      expect(ctorCall).toBeDefined();
    });

    it("should track caller context", async () => {
      if (!dotNetAvailable) return;

      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-csharp.cs")).text();
      const result = await parser.parseFile(content, "simple-csharp.cs");

      // Find calls within DemonstrateCallsAsync
      const callsInDemo = result.calls.filter((c) => c.callerName === "DemonstrateCallsAsync");
      expect(callsInDemo.length).toBeGreaterThan(0);
    });

    it("should mark awaited calls as async", async () => {
      if (!dotNetAvailable) return;

      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-csharp.cs")).text();
      const result = await parser.parseFile(content, "simple-csharp.cs");

      // Find await FetchDataAsync call
      const asyncCall = result.calls.find(
        (c) => c.calledName === "FetchDataAsync" && c.isAsync === true
      );
      expect(asyncCall).toBeDefined();
    });
  });

  describe("parseFile - C# Exports", () => {
    it("should return empty exports for C# (visibility by modifiers)", async () => {
      if (!dotNetAvailable) return;

      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-csharp.cs")).text();
      const result = await parser.parseFile(content, "simple-csharp.cs");

      // C# doesn't have explicit export statements like JS/TS
      // Visibility is determined by access modifiers
      expect(result.exports).toHaveLength(0);
    });
  });

  describe("parseFile - C# Visibility Modifiers", () => {
    it("should detect public as exported", async () => {
      if (!dotNetAvailable) return;

      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-csharp.cs")).text();
      const result = await parser.parseFile(content, "simple-csharp.cs");

      const publicClass = result.entities.find((e) => e.name === "SimpleClass");
      expect(publicClass?.isExported).toBe(true);
    });

    it("should detect internal as exported", async () => {
      if (!dotNetAvailable) return;

      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-csharp.cs")).text();
      const result = await parser.parseFile(content, "simple-csharp.cs");

      const internalClass = result.entities.find((e) => e.name === "InternalHelper");
      expect(internalClass?.isExported).toBe(true);
    });

    it("should detect private as not exported", async () => {
      if (!dotNetAvailable) return;

      const content = await Bun.file(path.join(FIXTURES_DIR, "simple-csharp.cs")).text();
      const result = await parser.parseFile(content, "simple-csharp.cs");

      const privateField = result.entities.find((e) => e.name === "_items");
      expect(privateField?.isExported).toBe(false);

      const privateMethod = result.entities.find((e) => e.name === "InternalProcess");
      expect(privateMethod?.isExported).toBe(false);
    });
  });

  describe("error handling", () => {
    it("should throw RoslynNotAvailableError when .NET is not available", async () => {
      // Create a parser that will check availability
      const testParser = new RoslynParser();

      // Mock unavailable .NET by testing error message format
      if (!(await testParser.isAvailable())) {
        // eslint-disable-next-line @typescript-eslint/await-thenable
        await expect(testParser.parseFile("public class Test {}", "test.cs")).rejects.toThrow(
          RoslynNotAvailableError
        );
      }
    });
  });
});

describe("CodeParser - C# Routing", () => {
  let codeParser: CodeParser;
  let dotNetAvailable = false;

  beforeAll(async () => {
    initializeLogger({ level: "error", format: "json" });
    resetDetectionCache();
    dotNetAvailable = await isDotNetAvailable();
    codeParser = new CodeParser();
  });

  afterAll(() => {
    resetDetectionCache();
    resetLogger();
  });

  it("should recognize .cs extension as supported", () => {
    expect(CodeParser.isSupported(".cs")).toBe(true);
    expect(CodeParser.isSupported(".CS")).toBe(true);
    expect(CodeParser.isSupported("cs")).toBe(true);
  });

  it("should get csharp language from .cs extension", () => {
    expect(CodeParser.getLanguageFromExtension(".cs")).toBe("csharp");
    expect(CodeParser.getLanguageFromExtension("cs")).toBe("csharp");
  });

  it("should identify csharp as using Roslyn", () => {
    expect(CodeParser.usesRoslyn("csharp")).toBe(true);
    expect(CodeParser.usesRoslyn("typescript")).toBe(false);
  });

  it("should route C# files to Roslyn parser", async () => {
    if (!dotNetAvailable) return;

    const content = "public class Test { public void Method() {} }";
    const result = await codeParser.parseFile(content, "test.cs");

    expect(result.language).toBe("csharp");
    expect(result.success).toBe(true);
  });

  it("should route TypeScript files to tree-sitter parser", async () => {
    const content = "export function test(): void {}";
    const result = await codeParser.parseFile(content, "test.ts");

    expect(result.language).toBe("typescript");
    expect(result.success).toBe(true);
  });
});
