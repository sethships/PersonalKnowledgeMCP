/**
 * Tests for DEFAULT_EXTENSIONS shared constant
 *
 * @module tests/unit/ingestion/default-extensions
 */

import { describe, it, expect } from "bun:test";
import { DEFAULT_EXTENSIONS } from "../../../src/ingestion/default-extensions.js";

describe("DEFAULT_EXTENSIONS", () => {
  it("should be a non-empty array", () => {
    expect(Array.isArray(DEFAULT_EXTENSIONS)).toBe(true);
    expect(DEFAULT_EXTENSIONS.length).toBeGreaterThan(0);
  });

  it("should contain exactly 19 extensions", () => {
    expect(DEFAULT_EXTENSIONS).toHaveLength(19);
  });

  it("should contain all expected JavaScript/TypeScript extensions", () => {
    expect(DEFAULT_EXTENSIONS).toContain(".js");
    expect(DEFAULT_EXTENSIONS).toContain(".ts");
    expect(DEFAULT_EXTENSIONS).toContain(".jsx");
    expect(DEFAULT_EXTENSIONS).toContain(".tsx");
  });

  it("should contain C# extension", () => {
    expect(DEFAULT_EXTENSIONS).toContain(".cs");
  });

  it("should contain Python extension", () => {
    expect(DEFAULT_EXTENSIONS).toContain(".py");
  });

  it("should contain Java, Go, and Rust extensions", () => {
    expect(DEFAULT_EXTENSIONS).toContain(".java");
    expect(DEFAULT_EXTENSIONS).toContain(".go");
    expect(DEFAULT_EXTENSIONS).toContain(".rs");
  });

  it("should contain C/C++ extensions", () => {
    expect(DEFAULT_EXTENSIONS).toContain(".cpp");
    expect(DEFAULT_EXTENSIONS).toContain(".c");
    expect(DEFAULT_EXTENSIONS).toContain(".h");
  });

  it("should contain documentation extensions", () => {
    expect(DEFAULT_EXTENSIONS).toContain(".md");
    expect(DEFAULT_EXTENSIONS).toContain(".txt");
    expect(DEFAULT_EXTENSIONS).toContain(".rst");
  });

  it("should contain configuration extensions", () => {
    expect(DEFAULT_EXTENSIONS).toContain(".json");
    expect(DEFAULT_EXTENSIONS).toContain(".yaml");
    expect(DEFAULT_EXTENSIONS).toContain(".yml");
    expect(DEFAULT_EXTENSIONS).toContain(".toml");
  });

  it("should have all extensions starting with a dot", () => {
    for (const ext of DEFAULT_EXTENSIONS) {
      expect(ext).toMatch(/^\./);
    }
  });

  it("should have all extensions in lowercase", () => {
    for (const ext of DEFAULT_EXTENSIONS) {
      expect(ext).toBe(ext.toLowerCase() as typeof ext);
    }
  });

  it("should be importable from barrel export", async () => {
    const { DEFAULT_EXTENSIONS: barrelExport } = await import("../../../src/ingestion/index.js");
    expect(barrelExport).toBe(DEFAULT_EXTENSIONS);
  });
});
