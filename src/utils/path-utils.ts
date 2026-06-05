/**
 * Path utility functions
 *
 * Shared helpers for detecting and resolving filesystem paths.
 */

import { normalize, resolve } from "node:path";

/**
 * Canonicalize an absolute path into a form suitable for equality comparison
 * across platforms.
 *
 * Resolves `.`/`..`, normalises separators, and lower-cases on Windows where
 * the filesystem is case-insensitive (NTFS/FAT). On POSIX the result preserves
 * case because two differently-cased names refer to distinct files.
 *
 * Used by registration-time duplicate-path detection so that two CLI/MCP calls
 * pointing at the same on-disk folder under different names are rejected
 * regardless of how the user typed the path.
 */
export function canonicalizePathForComparison(absPath: string): string {
  const normalized = normalize(resolve(absPath));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

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
  if (
    s.startsWith("./") ||
    s.startsWith(".\\") ||
    s.startsWith("../") ||
    s.startsWith("..\\") ||
    s === "." ||
    s === ".."
  )
    return true;
  return false;
}
