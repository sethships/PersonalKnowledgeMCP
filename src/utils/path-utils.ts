/**
 * Path utility functions
 *
 * Shared helpers for detecting and resolving filesystem paths.
 */

/**
 * Detect whether a string is a local filesystem path rather than a remote URL.
 *
 * Recognises:
 * - Windows absolute paths: C:\... or C:/...
 * - Unix absolute paths: /...
 * - Relative paths: ./ or ../
 * - Bare dot references: "." or ".."
 */
export function isLocalPath(urlOrPath: string): boolean {
  if (!urlOrPath) return false;
  const s = urlOrPath.trim();
  // Windows absolute: C:\... or C:/...
  if (/^[A-Za-z]:[/\\]/.test(s)) return true;
  // Unix absolute
  if (s.startsWith("/")) return true;
  // Relative
  if (s.startsWith("./") || s.startsWith("../") || s === "." || s === "..") return true;
  return false;
}
