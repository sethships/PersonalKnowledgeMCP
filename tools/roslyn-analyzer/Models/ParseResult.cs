/**
 * Data models for Roslyn analyzer output.
 *
 * These models match the TypeScript ParseResult interface exactly
 * to ensure seamless integration with the Personal Knowledge MCP system.
 */

using System.Text.Json.Serialization;

namespace RoslynAnalyzer.Models;

/// <summary>
/// Result of parsing a single source file.
/// </summary>
public class ParseResult
{
    /// <summary>File path that was parsed.</summary>
    [JsonPropertyName("filePath")]
    public required string FilePath { get; init; }

    /// <summary>Language detected and used for parsing.</summary>
    [JsonPropertyName("language")]
    public string Language => "csharp";

    /// <summary>Code entities extracted from the file.</summary>
    [JsonPropertyName("entities")]
    public List<CodeEntity> Entities { get; init; } = [];

    /// <summary>Import statements found in the file.</summary>
    [JsonPropertyName("imports")]
    public List<ImportInfo> Imports { get; init; } = [];

    /// <summary>Export statements found in the file.</summary>
    [JsonPropertyName("exports")]
    public List<ExportInfo> Exports { get; init; } = [];

    /// <summary>Function calls found in the file.</summary>
    [JsonPropertyName("calls")]
    public List<CallInfo> Calls { get; init; } = [];

    /// <summary>Time taken to parse the file in milliseconds.</summary>
    [JsonPropertyName("parseTimeMs")]
    public double ParseTimeMs { get; set; }

    /// <summary>Any errors encountered during parsing.</summary>
    [JsonPropertyName("errors")]
    public List<ParseError> Errors { get; init; } = [];

    /// <summary>Whether the parse was successful (no fatal errors).</summary>
    [JsonPropertyName("success")]
    public bool Success { get; set; } = true;
}

/// <summary>
/// A code entity extracted from source file AST.
/// </summary>
public class CodeEntity
{
    /// <summary>Type of code entity.</summary>
    [JsonPropertyName("type")]
    public required string Type { get; init; }

    /// <summary>Name of the entity.</summary>
    [JsonPropertyName("name")]
    public required string Name { get; init; }

    /// <summary>File path relative to repository root.</summary>
    [JsonPropertyName("filePath")]
    public required string FilePath { get; init; }

    /// <summary>Starting line number (1-based).</summary>
    [JsonPropertyName("lineStart")]
    public int LineStart { get; init; }

    /// <summary>Ending line number (1-based, inclusive).</summary>
    [JsonPropertyName("lineEnd")]
    public int LineEnd { get; init; }

    /// <summary>Starting column (0-based).</summary>
    [JsonPropertyName("columnStart")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? ColumnStart { get; init; }

    /// <summary>Ending column (0-based).</summary>
    [JsonPropertyName("columnEnd")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? ColumnEnd { get; init; }

    /// <summary>Whether the entity is exported (public/internal visibility).</summary>
    [JsonPropertyName("isExported")]
    public bool IsExported { get; init; }

    /// <summary>Whether this is the default export.</summary>
    [JsonPropertyName("isDefault")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public bool? IsDefault { get; init; }

    /// <summary>Additional entity-specific metadata.</summary>
    [JsonPropertyName("metadata")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public EntityMetadata? Metadata { get; init; }
}

/// <summary>
/// Additional metadata for code entities.
/// </summary>
public class EntityMetadata
{
    /// <summary>Whether the function/method is async.</summary>
    [JsonPropertyName("isAsync")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public bool? IsAsync { get; init; }

    /// <summary>Whether the class is abstract.</summary>
    [JsonPropertyName("isAbstract")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public bool? IsAbstract { get; init; }

    /// <summary>Whether the function is a generator (iterator in C#).</summary>
    [JsonPropertyName("isGenerator")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public bool? IsGenerator { get; init; }

    /// <summary>Whether the property/method is static.</summary>
    [JsonPropertyName("isStatic")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public bool? IsStatic { get; init; }

    /// <summary>Function/method parameters.</summary>
    [JsonPropertyName("parameters")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public List<ParameterInfo>? Parameters { get; init; }

    /// <summary>Return type annotation.</summary>
    [JsonPropertyName("returnType")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? ReturnType { get; init; }

    /// <summary>Parent class (for extends clause).</summary>
    [JsonPropertyName("extends")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Extends { get; init; }

    /// <summary>Implemented interfaces (for implements clause).</summary>
    [JsonPropertyName("implements")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public List<string>? Implements { get; init; }

    /// <summary>Generic type parameters.</summary>
    [JsonPropertyName("typeParameters")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public List<string>? TypeParameters { get; init; }

    /// <summary>XML documentation comment.</summary>
    [JsonPropertyName("documentation")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Documentation { get; init; }
}

/// <summary>
/// Information about a function or method parameter.
/// </summary>
public class ParameterInfo
{
    /// <summary>Parameter name.</summary>
    [JsonPropertyName("name")]
    public required string Name { get; init; }

    /// <summary>Type annotation.</summary>
    [JsonPropertyName("type")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Type { get; init; }

    /// <summary>Whether the parameter has a default value.</summary>
    [JsonPropertyName("hasDefault")]
    public bool HasDefault { get; init; }

    /// <summary>Whether the parameter is optional.</summary>
    [JsonPropertyName("isOptional")]
    public bool IsOptional { get; init; }

    /// <summary>Whether this is a params parameter.</summary>
    [JsonPropertyName("isRest")]
    public bool IsRest { get; init; }
}

/// <summary>
/// Information about an import statement (using directive).
/// </summary>
public record ImportInfo
{
    /// <summary>Namespace or module being imported.</summary>
    [JsonPropertyName("source")]
    public required string Source { get; init; }

    /// <summary>Whether this is a relative import (always false for C#).</summary>
    [JsonPropertyName("isRelative")]
    public bool IsRelative { get; init; }

    /// <summary>Names being imported.</summary>
    [JsonPropertyName("importedNames")]
    public List<string> ImportedNames { get; init; } = [];

    /// <summary>Alias mappings.</summary>
    [JsonPropertyName("aliases")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public Dictionary<string, string>? Aliases { get; init; }

    /// <summary>Default import name.</summary>
    [JsonPropertyName("defaultImport")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? DefaultImport { get; init; }

    /// <summary>Namespace import name (for static using).</summary>
    [JsonPropertyName("namespaceImport")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? NamespaceImport { get; init; }

    /// <summary>Whether this is a type-only import.</summary>
    [JsonPropertyName("isTypeOnly")]
    public bool IsTypeOnly { get; init; }

    /// <summary>Whether this is a side-effect import.</summary>
    [JsonPropertyName("isSideEffect")]
    public bool IsSideEffect { get; init; }

    /// <summary>Line number where the import appears (1-based).</summary>
    [JsonPropertyName("line")]
    public int Line { get; init; }
}

/// <summary>
/// Information about an export statement.
/// Note: C# doesn't have explicit exports; visibility is determined by modifiers.
/// </summary>
public class ExportInfo
{
    /// <summary>Names being exported.</summary>
    [JsonPropertyName("exportedNames")]
    public List<string> ExportedNames { get; init; } = [];

    /// <summary>Alias mappings.</summary>
    [JsonPropertyName("aliases")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public Dictionary<string, string>? Aliases { get; init; }

    /// <summary>Source module for re-exports.</summary>
    [JsonPropertyName("source")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Source { get; init; }

    /// <summary>Whether this is a type-only export.</summary>
    [JsonPropertyName("isTypeOnly")]
    public bool IsTypeOnly { get; init; }

    /// <summary>Whether this is a namespace export.</summary>
    [JsonPropertyName("isNamespaceExport")]
    public bool IsNamespaceExport { get; init; }

    /// <summary>Line number where the export appears (1-based).</summary>
    [JsonPropertyName("line")]
    public int Line { get; init; }
}

/// <summary>
/// Information about a function call.
/// </summary>
public class CallInfo
{
    /// <summary>Name of the function/method being called.</summary>
    [JsonPropertyName("calledName")]
    public required string CalledName { get; init; }

    /// <summary>Full expression for the call target.</summary>
    [JsonPropertyName("calledExpression")]
    public required string CalledExpression { get; init; }

    /// <summary>Whether this call is awaited.</summary>
    [JsonPropertyName("isAsync")]
    public bool IsAsync { get; init; }

    /// <summary>Line number where the call appears (1-based).</summary>
    [JsonPropertyName("line")]
    public int Line { get; init; }

    /// <summary>Column where the call appears (0-based).</summary>
    [JsonPropertyName("column")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? Column { get; init; }

    /// <summary>Name of the containing function/method.</summary>
    [JsonPropertyName("callerName")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? CallerName { get; init; }
}

/// <summary>
/// A parsing error.
/// </summary>
public class ParseError
{
    /// <summary>Error message.</summary>
    [JsonPropertyName("message")]
    public required string Message { get; init; }

    /// <summary>Line number where the error occurred (1-based).</summary>
    [JsonPropertyName("line")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? Line { get; init; }

    /// <summary>Column where the error occurred (0-based).</summary>
    [JsonPropertyName("column")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? Column { get; init; }

    /// <summary>Whether parsing can continue despite this error.</summary>
    [JsonPropertyName("recoverable")]
    public bool Recoverable { get; init; } = true;
}

/// <summary>
/// Input for batch mode processing.
/// </summary>
public class FileInput
{
    [JsonPropertyName("path")]
    public required string Path { get; init; }

    [JsonPropertyName("content")]
    public required string Content { get; init; }
}
