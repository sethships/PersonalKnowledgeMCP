/**
 * Roslyn C# parser module.
 *
 * Provides C# parsing using Roslyn (Microsoft.CodeAnalysis) via a .NET CLI tool.
 * Requires .NET SDK 6.0 or later to be installed.
 *
 * @module graph/parsing/roslyn
 */

export { RoslynParser } from "./RoslynParser.js";
export {
  detectDotNet,
  isDotNetAvailable,
  resetDetectionCache,
  type DotNetDetectionResult,
} from "./RoslynDetector.js";
