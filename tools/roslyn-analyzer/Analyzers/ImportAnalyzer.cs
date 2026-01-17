/**
 * Import (using directive) extraction from C# syntax trees using Roslyn.
 *
 * Extracts using directives including regular, static, aliased, and global usings.
 */

using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using RoslynAnalyzer.Models;

namespace RoslynAnalyzer.Analyzers;

/// <summary>
/// Extracts using directives (imports) from a Roslyn syntax tree.
/// </summary>
public class ImportAnalyzer
{
    /// <summary>
    /// Extract all using directives from the syntax tree.
    /// </summary>
    public List<ImportInfo> Extract(SyntaxNode root)
    {
        var imports = new List<ImportInfo>();

        // Extract compilation unit level usings
        if (root is CompilationUnitSyntax compilationUnit)
        {
            foreach (var usingDirective in compilationUnit.Usings)
            {
                imports.Add(ExtractUsingDirective(usingDirective));
            }
        }

        // Also extract namespace-level usings
        foreach (var namespaceDecl in root.DescendantNodes().OfType<BaseNamespaceDeclarationSyntax>())
        {
            foreach (var usingDirective in namespaceDecl.Usings)
            {
                imports.Add(ExtractUsingDirective(usingDirective));
            }
        }

        return imports;
    }

    private ImportInfo ExtractUsingDirective(UsingDirectiveSyntax usingDirective)
    {
        var lineSpan = usingDirective.GetLocation().GetLineSpan();
        var isStatic = usingDirective.StaticKeyword != default;
        var isGlobal = usingDirective.GlobalKeyword != default;
        var alias = usingDirective.Alias?.Name.ToString();
        var source = usingDirective.Name?.ToString() ?? usingDirective.NamespaceOrType?.ToString() ?? "";

        var importInfo = new ImportInfo
        {
            Source = source,
            IsRelative = false, // C# doesn't have relative imports
            ImportedNames = isStatic ? ["*"] : [], // Static using imports all static members
            IsTypeOnly = false,
            IsSideEffect = false,
            Line = lineSpan.StartLinePosition.Line + 1
        };

        // Handle aliased using
        if (alias != null)
        {
            return importInfo with
            {
                Aliases = new Dictionary<string, string> { { source, alias } },
                ImportedNames = [alias]
            };
        }

        // Handle static using
        if (isStatic)
        {
            return importInfo with
            {
                NamespaceImport = "static"
            };
        }

        // Regular namespace using
        return importInfo with
        {
            ImportedNames = ["*"] // Namespace imports bring in all types
        };
    }
}
