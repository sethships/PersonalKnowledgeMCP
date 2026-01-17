# Roslyn Analyzer

A standalone .NET console application that parses C# source files using Roslyn and outputs JSON compatible with the Personal Knowledge MCP system.

## Prerequisites

- .NET 10.0 SDK or later
- This is an **optional** dependency - only required for C# code analysis

## Usage

### Single File Mode

Parse a single C# file by piping content to stdin:

```bash
cat MyClass.cs | dotnet run --project tools/roslyn-analyzer -- MyClass.cs
```

Or using echo:

```bash
echo 'public class Foo { }' | dotnet run --project tools/roslyn-analyzer -- test.cs
```

### Batch Mode

Parse multiple files by passing JSON array to stdin:

```bash
echo '[{"path":"a.cs","content":"public class A {}"},{"path":"b.cs","content":"public class B {}"}]' | dotnet run --project tools/roslyn-analyzer -- --batch
```

## Output Format

The analyzer outputs JSON matching the Personal Knowledge MCP `ParseResult` interface:

```json
{
  "filePath": "MyClass.cs",
  "language": "csharp",
  "entities": [
    {
      "type": "class",
      "name": "MyClass",
      "filePath": "MyClass.cs",
      "lineStart": 1,
      "lineEnd": 10,
      "isExported": true,
      "metadata": {
        "isAbstract": false,
        "documentation": "Class documentation"
      }
    }
  ],
  "imports": [
    {
      "source": "System.Collections.Generic",
      "isRelative": false,
      "importedNames": ["*"],
      "isTypeOnly": false,
      "isSideEffect": false,
      "line": 1
    }
  ],
  "exports": [],
  "calls": [
    {
      "calledName": "DoSomething",
      "calledExpression": "service.DoSomething",
      "isAsync": true,
      "line": 15,
      "callerName": "ProcessData"
    }
  ],
  "parseTimeMs": 42.5,
  "errors": [],
  "success": true
}
```

## Entity Types

| C# Construct | Entity Type |
|--------------|-------------|
| `class` | `class` |
| `record` | `class` |
| `struct` | `class` |
| `interface` | `interface` |
| `enum` | `enum` |
| `delegate` | `type_alias` |
| Method | `method` |
| Constructor | `method` |
| Property | `property` |
| Field | `property` |

## Building

```bash
cd tools/roslyn-analyzer
dotnet build
```

## Running Tests

The Roslyn analyzer is tested through the TypeScript test suite:

```bash
bun test tests/unit/graph/parsing/RoslynParser.test.ts
```

> **Note:** Tests require .NET SDK to be installed. When running in CI without .NET SDK, tests will pass gracefully by skipping Roslyn-dependent assertions.

## Known Limitations

### Interface Detection Heuristic

The analyzer uses a naming convention heuristic to distinguish interfaces from classes in certain edge cases. Types starting with "I" followed by an uppercase letter are classified as interfaces. This may incorrectly classify classes like `Item`, `Image`, or `Input` as interfaces.

Full semantic analysis would require compilation with all referenced assemblies, which is outside the scope of this syntax-only parsing approach. For most codebases following C# naming conventions, this heuristic works correctly.

### .NET SDK Availability

The .NET SDK availability check is cached globally per process. If you install .NET SDK after the first check fails, you'll need to restart the MCP server. This is by design to avoid repeated expensive detection calls.

## Publishing (Optional)

For faster startup, you can publish as a self-contained executable:

```bash
dotnet publish -c Release -r win-x64 --self-contained
```

This creates a standalone executable that doesn't require .NET SDK at runtime.
