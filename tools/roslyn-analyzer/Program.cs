/**
 * Roslyn Analyzer CLI Entry Point
 *
 * Parses C# source files using Roslyn and outputs JSON matching
 * the Personal Knowledge MCP ParseResult interface.
 *
 * Usage:
 *   Single file: echo "content" | dotnet run --project tools/roslyn-analyzer -- filepath.cs
 *   Batch mode:  echo '[{"path":"a.cs","content":"..."}]' | dotnet run --project tools/roslyn-analyzer -- --batch
 */

using System.Diagnostics;
using System.Text.Json;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using RoslynAnalyzer.Analyzers;
using RoslynAnalyzer.Models;

// JSON serialization options
var jsonOptions = new JsonSerializerOptions
{
    WriteIndented = false,
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase
};

// Parse arguments
var isBatchMode = args.Contains("--batch");
var filePath = args.FirstOrDefault(a => !a.StartsWith("--")) ?? "stdin.cs";

try
{
    if (isBatchMode)
    {
        await ProcessBatchMode(jsonOptions);
    }
    else
    {
        await ProcessSingleFile(filePath, jsonOptions);
    }
}
catch (Exception ex)
{
    // Output error as JSON for the TypeScript wrapper to parse
    var errorResult = new ParseResult
    {
        FilePath = filePath,
        Errors = [new ParseError { Message = ex.Message, Recoverable = false }],
        Success = false
    };
    Console.WriteLine(JsonSerializer.Serialize(errorResult, jsonOptions));
    Environment.Exit(1);
}

async Task ProcessSingleFile(string path, JsonSerializerOptions options)
{
    var content = await Console.In.ReadToEndAsync();
    var result = AnalyzeFile(path, content);
    Console.WriteLine(JsonSerializer.Serialize(result, options));
}

async Task ProcessBatchMode(JsonSerializerOptions options)
{
    var input = await Console.In.ReadToEndAsync();
    var files = JsonSerializer.Deserialize<List<FileInput>>(input, options);

    if (files == null || files.Count == 0)
    {
        Console.WriteLine("[]");
        return;
    }

    var results = files.Select(f => AnalyzeFile(f.Path, f.Content)).ToList();
    Console.WriteLine(JsonSerializer.Serialize(results, options));
}

ParseResult AnalyzeFile(string path, string content)
{
    var stopwatch = Stopwatch.StartNew();

    try
    {
        // Parse the C# source
        var tree = CSharpSyntaxTree.ParseText(content, path: path);
        var root = tree.GetRoot();

        // Extract entities, imports, and calls
        var entityAnalyzer = new EntityAnalyzer(path);
        var importAnalyzer = new ImportAnalyzer();
        var callAnalyzer = new CallAnalyzer();

        var entities = entityAnalyzer.Extract(root);
        var imports = importAnalyzer.Extract(root);
        var calls = callAnalyzer.Extract(root);

        // Collect parse errors
        var diagnostics = tree.GetDiagnostics()
            .Where(d => d.Severity == DiagnosticSeverity.Error)
            .Select(d =>
            {
                var lineSpan = d.Location.GetLineSpan();
                return new ParseError
                {
                    Message = d.GetMessage(),
                    Line = lineSpan.StartLinePosition.Line + 1,
                    Column = lineSpan.StartLinePosition.Character,
                    Recoverable = true
                };
            })
            .ToList();

        stopwatch.Stop();

        return new ParseResult
        {
            FilePath = path,
            Entities = entities,
            Imports = imports,
            Exports = [], // C# doesn't have explicit exports
            Calls = calls,
            ParseTimeMs = stopwatch.Elapsed.TotalMilliseconds,
            Errors = diagnostics,
            Success = !diagnostics.Any(e => !e.Recoverable)
        };
    }
    catch (Exception ex)
    {
        stopwatch.Stop();

        return new ParseResult
        {
            FilePath = path,
            ParseTimeMs = stopwatch.Elapsed.TotalMilliseconds,
            Errors = [new ParseError { Message = ex.Message, Recoverable = false }],
            Success = false
        };
    }
}
