/**
 * Entity extraction from C# syntax trees using Roslyn.
 *
 * Extracts classes, interfaces, structs, records, enums, methods,
 * properties, fields, and delegates from C# source files.
 */

using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using RoslynAnalyzer.Models;

namespace RoslynAnalyzer.Analyzers;

/// <summary>
/// Extracts code entities from a Roslyn syntax tree.
/// </summary>
public class EntityAnalyzer
{
    private readonly string _filePath;

    public EntityAnalyzer(string filePath)
    {
        _filePath = filePath;
    }

    /// <summary>
    /// Extract all code entities from the syntax tree.
    /// </summary>
    public List<CodeEntity> Extract(SyntaxNode root)
    {
        var entities = new List<CodeEntity>();
        ExtractEntities(root, entities);
        return entities;
    }

    private void ExtractEntities(SyntaxNode node, List<CodeEntity> entities)
    {
        switch (node)
        {
            case ClassDeclarationSyntax classDecl:
                entities.Add(ExtractTypeDeclaration(classDecl, "class"));
                break;

            case InterfaceDeclarationSyntax interfaceDecl:
                entities.Add(ExtractTypeDeclaration(interfaceDecl, "interface"));
                break;

            case StructDeclarationSyntax structDecl:
                entities.Add(ExtractTypeDeclaration(structDecl, "class"));
                break;

            case RecordDeclarationSyntax recordDecl:
                entities.Add(ExtractTypeDeclaration(recordDecl, "class"));
                break;

            case EnumDeclarationSyntax enumDecl:
                entities.Add(ExtractEnumDeclaration(enumDecl));
                break;

            case DelegateDeclarationSyntax delegateDecl:
                entities.Add(ExtractDelegateDeclaration(delegateDecl));
                break;

            case MethodDeclarationSyntax methodDecl:
                entities.Add(ExtractMethodDeclaration(methodDecl));
                break;

            case ConstructorDeclarationSyntax ctorDecl:
                entities.Add(ExtractConstructorDeclaration(ctorDecl));
                break;

            case PropertyDeclarationSyntax propDecl:
                entities.Add(ExtractPropertyDeclaration(propDecl));
                break;

            case FieldDeclarationSyntax fieldDecl:
                entities.AddRange(ExtractFieldDeclarations(fieldDecl));
                break;
        }

        // Recurse into children
        foreach (var child in node.ChildNodes())
        {
            ExtractEntities(child, entities);
        }
    }

    private CodeEntity ExtractTypeDeclaration(TypeDeclarationSyntax typeDecl, string entityType)
    {
        var lineSpan = typeDecl.GetLocation().GetLineSpan();
        var modifiers = GetModifierInfo(typeDecl.Modifiers);

        // Extract base types
        string? extendsType = null;
        var implementsList = new List<string>();

        if (typeDecl.BaseList != null)
        {
            foreach (var baseType in typeDecl.BaseList.Types)
            {
                var typeName = baseType.Type.ToString();
                // By convention, interfaces start with 'I'
                if (typeName.StartsWith("I") && char.IsUpper(typeName.ElementAtOrDefault(1)))
                {
                    implementsList.Add(typeName);
                }
                else if (extendsType == null && entityType == "class")
                {
                    extendsType = typeName;
                }
                else
                {
                    implementsList.Add(typeName);
                }
            }
        }

        // For interfaces, all base types go in extends (interface inheritance)
        if (entityType == "interface" && typeDecl.BaseList != null)
        {
            implementsList.Clear();
            extendsType = null;
            // Interfaces can extend multiple interfaces, but we only capture the first in extends
            var baseTypes = typeDecl.BaseList.Types.Select(t => t.Type.ToString()).ToList();
            if (baseTypes.Count > 0)
            {
                extendsType = baseTypes[0];
            }
            if (baseTypes.Count > 1)
            {
                implementsList.AddRange(baseTypes.Skip(1));
            }
        }

        return new CodeEntity
        {
            Type = entityType,
            Name = typeDecl.Identifier.Text,
            FilePath = _filePath,
            LineStart = lineSpan.StartLinePosition.Line + 1,
            LineEnd = lineSpan.EndLinePosition.Line + 1,
            ColumnStart = lineSpan.StartLinePosition.Character,
            ColumnEnd = lineSpan.EndLinePosition.Character,
            IsExported = modifiers.IsPublicOrInternal,
            Metadata = new EntityMetadata
            {
                IsAbstract = modifiers.IsAbstract,
                IsStatic = modifiers.IsStatic,
                Extends = extendsType,
                Implements = implementsList.Count > 0 ? implementsList : null,
                TypeParameters = ExtractTypeParameters(typeDecl.TypeParameterList),
                Documentation = ExtractDocumentation(typeDecl)
            }
        };
    }

    private CodeEntity ExtractEnumDeclaration(EnumDeclarationSyntax enumDecl)
    {
        var lineSpan = enumDecl.GetLocation().GetLineSpan();
        var modifiers = GetModifierInfo(enumDecl.Modifiers);

        return new CodeEntity
        {
            Type = "enum",
            Name = enumDecl.Identifier.Text,
            FilePath = _filePath,
            LineStart = lineSpan.StartLinePosition.Line + 1,
            LineEnd = lineSpan.EndLinePosition.Line + 1,
            ColumnStart = lineSpan.StartLinePosition.Character,
            ColumnEnd = lineSpan.EndLinePosition.Character,
            IsExported = modifiers.IsPublicOrInternal,
            Metadata = new EntityMetadata
            {
                Documentation = ExtractDocumentation(enumDecl)
            }
        };
    }

    private CodeEntity ExtractDelegateDeclaration(DelegateDeclarationSyntax delegateDecl)
    {
        var lineSpan = delegateDecl.GetLocation().GetLineSpan();
        var modifiers = GetModifierInfo(delegateDecl.Modifiers);

        return new CodeEntity
        {
            Type = "type_alias",
            Name = delegateDecl.Identifier.Text,
            FilePath = _filePath,
            LineStart = lineSpan.StartLinePosition.Line + 1,
            LineEnd = lineSpan.EndLinePosition.Line + 1,
            ColumnStart = lineSpan.StartLinePosition.Character,
            ColumnEnd = lineSpan.EndLinePosition.Character,
            IsExported = modifiers.IsPublicOrInternal,
            Metadata = new EntityMetadata
            {
                Parameters = ExtractParameters(delegateDecl.ParameterList),
                ReturnType = delegateDecl.ReturnType.ToString(),
                TypeParameters = ExtractTypeParameters(delegateDecl.TypeParameterList),
                Documentation = ExtractDocumentation(delegateDecl)
            }
        };
    }

    private CodeEntity ExtractMethodDeclaration(MethodDeclarationSyntax methodDecl)
    {
        var lineSpan = methodDecl.GetLocation().GetLineSpan();
        var modifiers = GetModifierInfo(methodDecl.Modifiers);

        return new CodeEntity
        {
            Type = "method",
            Name = methodDecl.Identifier.Text,
            FilePath = _filePath,
            LineStart = lineSpan.StartLinePosition.Line + 1,
            LineEnd = lineSpan.EndLinePosition.Line + 1,
            ColumnStart = lineSpan.StartLinePosition.Character,
            ColumnEnd = lineSpan.EndLinePosition.Character,
            IsExported = modifiers.IsPublicOrInternal,
            Metadata = new EntityMetadata
            {
                IsAsync = modifiers.IsAsync,
                IsStatic = modifiers.IsStatic,
                IsAbstract = modifiers.IsAbstract,
                Parameters = ExtractParameters(methodDecl.ParameterList),
                ReturnType = methodDecl.ReturnType.ToString(),
                TypeParameters = ExtractTypeParameters(methodDecl.TypeParameterList),
                Documentation = ExtractDocumentation(methodDecl)
            }
        };
    }

    private CodeEntity ExtractConstructorDeclaration(ConstructorDeclarationSyntax ctorDecl)
    {
        var lineSpan = ctorDecl.GetLocation().GetLineSpan();
        var modifiers = GetModifierInfo(ctorDecl.Modifiers);

        return new CodeEntity
        {
            Type = "method",
            Name = ctorDecl.Identifier.Text,
            FilePath = _filePath,
            LineStart = lineSpan.StartLinePosition.Line + 1,
            LineEnd = lineSpan.EndLinePosition.Line + 1,
            ColumnStart = lineSpan.StartLinePosition.Character,
            ColumnEnd = lineSpan.EndLinePosition.Character,
            IsExported = modifiers.IsPublicOrInternal,
            Metadata = new EntityMetadata
            {
                IsStatic = modifiers.IsStatic,
                Parameters = ExtractParameters(ctorDecl.ParameterList),
                Documentation = ExtractDocumentation(ctorDecl)
            }
        };
    }

    private CodeEntity ExtractPropertyDeclaration(PropertyDeclarationSyntax propDecl)
    {
        var lineSpan = propDecl.GetLocation().GetLineSpan();
        var modifiers = GetModifierInfo(propDecl.Modifiers);

        return new CodeEntity
        {
            Type = "property",
            Name = propDecl.Identifier.Text,
            FilePath = _filePath,
            LineStart = lineSpan.StartLinePosition.Line + 1,
            LineEnd = lineSpan.EndLinePosition.Line + 1,
            ColumnStart = lineSpan.StartLinePosition.Character,
            ColumnEnd = lineSpan.EndLinePosition.Character,
            IsExported = modifiers.IsPublicOrInternal,
            Metadata = new EntityMetadata
            {
                IsStatic = modifiers.IsStatic,
                ReturnType = propDecl.Type.ToString(),
                Documentation = ExtractDocumentation(propDecl)
            }
        };
    }

    private List<CodeEntity> ExtractFieldDeclarations(FieldDeclarationSyntax fieldDecl)
    {
        var entities = new List<CodeEntity>();
        var modifiers = GetModifierInfo(fieldDecl.Modifiers);
        var fieldType = fieldDecl.Declaration.Type.ToString();

        foreach (var variable in fieldDecl.Declaration.Variables)
        {
            var lineSpan = variable.GetLocation().GetLineSpan();

            entities.Add(new CodeEntity
            {
                Type = "property",
                Name = variable.Identifier.Text,
                FilePath = _filePath,
                LineStart = lineSpan.StartLinePosition.Line + 1,
                LineEnd = lineSpan.EndLinePosition.Line + 1,
                ColumnStart = lineSpan.StartLinePosition.Character,
                ColumnEnd = lineSpan.EndLinePosition.Character,
                IsExported = modifiers.IsPublicOrInternal,
                Metadata = new EntityMetadata
                {
                    IsStatic = modifiers.IsStatic,
                    ReturnType = fieldType,
                    Documentation = ExtractDocumentation(fieldDecl)
                }
            });
        }

        return entities;
    }

    private List<Models.ParameterInfo>? ExtractParameters(ParameterListSyntax? parameterList)
    {
        if (parameterList == null || parameterList.Parameters.Count == 0)
            return null;

        return parameterList.Parameters.Select(p => new Models.ParameterInfo
        {
            Name = p.Identifier.Text,
            Type = p.Type?.ToString(),
            HasDefault = p.Default != null,
            IsOptional = p.Default != null,
            IsRest = p.Modifiers.Any(m => m.IsKind(SyntaxKind.ParamsKeyword))
        }).ToList();
    }

    private List<string>? ExtractTypeParameters(TypeParameterListSyntax? typeParameterList)
    {
        if (typeParameterList == null || typeParameterList.Parameters.Count == 0)
            return null;

        return typeParameterList.Parameters.Select(p => p.Identifier.Text).ToList();
    }

    private string? ExtractDocumentation(SyntaxNode node)
    {
        var trivia = node.GetLeadingTrivia();
        var docComment = trivia
            .Where(t => t.IsKind(SyntaxKind.SingleLineDocumentationCommentTrivia) ||
                        t.IsKind(SyntaxKind.MultiLineDocumentationCommentTrivia))
            .FirstOrDefault();

        if (docComment == default)
            return null;

        var docText = docComment.ToFullString();
        // Clean up the XML doc comment formatting
        var lines = docText.Split('\n')
            .Select(l => l.Trim().TrimStart('/').Trim())
            .Where(l => !string.IsNullOrWhiteSpace(l) && !l.StartsWith("<") && !l.EndsWith(">"))
            .ToList();

        // Extract summary content
        var summaryMatch = System.Text.RegularExpressions.Regex.Match(
            docText,
            @"<summary>\s*(.*?)\s*</summary>",
            System.Text.RegularExpressions.RegexOptions.Singleline);

        if (summaryMatch.Success)
        {
            var summary = summaryMatch.Groups[1].Value;
            return string.Join(" ", summary.Split('\n')
                .Select(l => l.Trim().TrimStart('/').Trim())
                .Where(l => !string.IsNullOrWhiteSpace(l)));
        }

        return lines.Count > 0 ? string.Join(" ", lines) : null;
    }

    private ModifierInfo GetModifierInfo(SyntaxTokenList modifiers)
    {
        return new ModifierInfo
        {
            IsPublic = modifiers.Any(m => m.IsKind(SyntaxKind.PublicKeyword)),
            IsInternal = modifiers.Any(m => m.IsKind(SyntaxKind.InternalKeyword)),
            IsPrivate = modifiers.Any(m => m.IsKind(SyntaxKind.PrivateKeyword)),
            IsProtected = modifiers.Any(m => m.IsKind(SyntaxKind.ProtectedKeyword)),
            IsStatic = modifiers.Any(m => m.IsKind(SyntaxKind.StaticKeyword)),
            IsAbstract = modifiers.Any(m => m.IsKind(SyntaxKind.AbstractKeyword)),
            IsAsync = modifiers.Any(m => m.IsKind(SyntaxKind.AsyncKeyword)),
            IsVirtual = modifiers.Any(m => m.IsKind(SyntaxKind.VirtualKeyword)),
            IsOverride = modifiers.Any(m => m.IsKind(SyntaxKind.OverrideKeyword)),
            IsSealed = modifiers.Any(m => m.IsKind(SyntaxKind.SealedKeyword)),
            IsReadonly = modifiers.Any(m => m.IsKind(SyntaxKind.ReadOnlyKeyword))
        };
    }

    private record ModifierInfo
    {
        public bool IsPublic { get; init; }
        public bool IsInternal { get; init; }
        public bool IsPrivate { get; init; }
        public bool IsProtected { get; init; }
        public bool IsStatic { get; init; }
        public bool IsAbstract { get; init; }
        public bool IsAsync { get; init; }
        public bool IsVirtual { get; init; }
        public bool IsOverride { get; init; }
        public bool IsSealed { get; init; }
        public bool IsReadonly { get; init; }

        // Public or internal (or no explicit modifier, which defaults to internal for types)
        public bool IsPublicOrInternal => IsPublic || IsInternal || (!IsPrivate && !IsProtected);
    }
}
