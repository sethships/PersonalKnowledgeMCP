/**
 * Function/method call extraction from C# syntax trees using Roslyn.
 *
 * Extracts invocation expressions, object creation expressions,
 * and member access calls.
 */

using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using RoslynAnalyzer.Models;

namespace RoslynAnalyzer.Analyzers;

/// <summary>
/// Extracts function/method calls from a Roslyn syntax tree.
/// </summary>
public class CallAnalyzer
{
    /// <summary>
    /// Extract all function calls from the syntax tree.
    /// </summary>
    public List<CallInfo> Extract(SyntaxNode root)
    {
        var calls = new List<CallInfo>();
        ExtractCalls(root, calls, null);
        return calls;
    }

    private void ExtractCalls(SyntaxNode node, List<CallInfo> calls, string? currentCaller)
    {
        // Update caller context when entering a method/function
        string? newCaller = currentCaller;
        if (node is MethodDeclarationSyntax methodDecl)
        {
            newCaller = methodDecl.Identifier.Text;
        }
        else if (node is ConstructorDeclarationSyntax ctorDecl)
        {
            newCaller = ctorDecl.Identifier.Text;
        }
        else if (node is LocalFunctionStatementSyntax localFunc)
        {
            newCaller = localFunc.Identifier.Text;
        }

        switch (node)
        {
            case InvocationExpressionSyntax invocation:
                var callInfo = ExtractInvocation(invocation, newCaller);
                if (callInfo != null)
                {
                    calls.Add(callInfo);
                }
                break;

            case ObjectCreationExpressionSyntax objectCreation:
                var ctorCall = ExtractObjectCreation(objectCreation, newCaller);
                if (ctorCall != null)
                {
                    calls.Add(ctorCall);
                }
                break;

            case ImplicitObjectCreationExpressionSyntax implicitCreation:
                var implicitCall = ExtractImplicitObjectCreation(implicitCreation, newCaller);
                if (implicitCall != null)
                {
                    calls.Add(implicitCall);
                }
                break;
        }

        // Recurse into children
        foreach (var child in node.ChildNodes())
        {
            ExtractCalls(child, calls, newCaller);
        }
    }

    private CallInfo? ExtractInvocation(InvocationExpressionSyntax invocation, string? caller)
    {
        var lineSpan = invocation.GetLocation().GetLineSpan();
        var expression = invocation.Expression;
        var (calledName, calledExpression) = ExtractCallTarget(expression);

        if (string.IsNullOrEmpty(calledName))
            return null;

        // Check if this is an awaited call
        var isAsync = invocation.Parent is AwaitExpressionSyntax;

        return new CallInfo
        {
            CalledName = calledName,
            CalledExpression = calledExpression,
            IsAsync = isAsync,
            Line = lineSpan.StartLinePosition.Line + 1,
            Column = lineSpan.StartLinePosition.Character,
            CallerName = caller
        };
    }

    private CallInfo? ExtractObjectCreation(ObjectCreationExpressionSyntax objectCreation, string? caller)
    {
        var lineSpan = objectCreation.GetLocation().GetLineSpan();
        var typeName = objectCreation.Type.ToString();

        // Check if this is an awaited call
        var isAsync = objectCreation.Parent is AwaitExpressionSyntax;

        return new CallInfo
        {
            CalledName = typeName,
            CalledExpression = $"new {typeName}",
            IsAsync = isAsync,
            Line = lineSpan.StartLinePosition.Line + 1,
            Column = lineSpan.StartLinePosition.Character,
            CallerName = caller
        };
    }

    private CallInfo? ExtractImplicitObjectCreation(ImplicitObjectCreationExpressionSyntax implicitCreation, string? caller)
    {
        var lineSpan = implicitCreation.GetLocation().GetLineSpan();

        // For implicit new(), we can't determine the type from the expression alone
        // Mark it as "new()" to indicate implicit creation
        var isAsync = implicitCreation.Parent is AwaitExpressionSyntax;

        return new CallInfo
        {
            CalledName = "new",
            CalledExpression = "new()",
            IsAsync = isAsync,
            Line = lineSpan.StartLinePosition.Line + 1,
            Column = lineSpan.StartLinePosition.Character,
            CallerName = caller
        };
    }

    private (string calledName, string calledExpression) ExtractCallTarget(ExpressionSyntax expression)
    {
        switch (expression)
        {
            case IdentifierNameSyntax identifier:
                // Simple function call: FunctionName()
                return (identifier.Identifier.Text, identifier.Identifier.Text);

            case MemberAccessExpressionSyntax memberAccess:
                // Member access: obj.Method() or Namespace.Class.Method()
                var memberName = memberAccess.Name.Identifier.Text;
                var fullExpression = memberAccess.ToString();
                return (memberName, fullExpression);

            case MemberBindingExpressionSyntax memberBinding:
                // Null-conditional: obj?.Method()
                return (memberBinding.Name.Identifier.Text, memberBinding.ToString());

            case GenericNameSyntax genericName:
                // Generic method call: Method<T>()
                return (genericName.Identifier.Text, genericName.ToString());

            case InvocationExpressionSyntax nestedInvocation:
                // Nested call like Method1()() - extract the outer method
                return ExtractCallTarget(nestedInvocation.Expression);

            case ParenthesizedExpressionSyntax parenthesized:
                // (expression).Method()
                return ExtractCallTarget(parenthesized.Expression);

            case ConditionalAccessExpressionSyntax conditionalAccess:
                // obj?.Method() - extract the method part
                if (conditionalAccess.WhenNotNull is InvocationExpressionSyntax condInvocation)
                {
                    var (name, _) = ExtractCallTarget(condInvocation.Expression);
                    return (name, conditionalAccess.ToString());
                }
                return (string.Empty, conditionalAccess.ToString());

            default:
                // Fallback - try to get meaningful text
                return (string.Empty, expression.ToString());
        }
    }
}
