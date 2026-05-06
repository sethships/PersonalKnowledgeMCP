/**
 * Path Utility Tests
 */

import { describe, it, expect } from "bun:test";
import { resolve, normalize } from "node:path";
import { isLocalPath, canonicalizePathForComparison } from "../../../src/utils/path-utils.js";

describe("isLocalPath", () => {
  it("should detect Windows absolute paths", () => {
    expect(isLocalPath("C:\\Users\\user\\repo")).toBe(true);
    expect(isLocalPath("C:/src/myrepo")).toBe(true);
    expect(isLocalPath("D:\\projects\\test")).toBe(true);
  });

  it("should detect Unix absolute paths", () => {
    expect(isLocalPath("/home/user/repo")).toBe(true);
    expect(isLocalPath("/var/repos/myproject")).toBe(true);
  });

  it("should detect relative paths", () => {
    expect(isLocalPath("./relative/path")).toBe(true);
    expect(isLocalPath("../parent/path")).toBe(true);
    expect(isLocalPath(".\\my-repo")).toBe(true);
    expect(isLocalPath("..\\my-repo")).toBe(true);
    expect(isLocalPath(".")).toBe(true);
    expect(isLocalPath("..")).toBe(true);
  });

  it("should not detect remote URLs as local paths", () => {
    expect(isLocalPath("https://github.com/user/repo")).toBe(false);
    expect(isLocalPath("https://gitlab.com/user/repo.git")).toBe(false);
    expect(isLocalPath("git@github.com:user/repo.git")).toBe(false);
    expect(isLocalPath("http://example.com/repo")).toBe(false);
  });

  it("should return false for empty or falsy input", () => {
    expect(isLocalPath("")).toBe(false);
    expect(isLocalPath("   ")).toBe(false);
  });

  it("should handle paths with leading/trailing whitespace", () => {
    expect(isLocalPath("  C:\\src\\repo  ")).toBe(true);
    expect(isLocalPath("  /home/user/repo  ")).toBe(true);
  });
});

describe("canonicalizePathForComparison", () => {
  it("collapses redundant segments and resolves to absolute", () => {
    const noisy = "./a/b/../c/./d";
    const canonical = canonicalizePathForComparison(noisy);
    expect(canonical).toBe(
      process.platform === "win32"
        ? normalize(resolve(noisy)).toLowerCase()
        : normalize(resolve(noisy))
    );
  });

  it("returns the same string for two equivalent representations of the same path", () => {
    const a = canonicalizePathForComparison("./foo/bar");
    const b = canonicalizePathForComparison("./foo/./bar");
    const c = canonicalizePathForComparison("./foo/baz/../bar");
    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  it("treats case-different paths as equal on Windows and unequal on POSIX", () => {
    const upper = canonicalizePathForComparison("/Users/Foo/Bar");
    const lower = canonicalizePathForComparison("/users/foo/bar");
    if (process.platform === "win32") {
      expect(upper).toBe(lower);
    } else {
      expect(upper).not.toBe(lower);
    }
  });
});
