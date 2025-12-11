/**
 * Example test file using Bun's built-in test runner
 *
 * Run tests with: bun test
 * Run with coverage: bun test --coverage
 * Run in watch mode: bun test --watch
 */

import { expect, test, describe, beforeAll, afterAll } from "bun:test";

describe("Example Test Suite", () => {
  beforeAll(() => {
    // Setup before all tests in this suite
  });

  afterAll(() => {
    // Cleanup after all tests in this suite
  });

  test("basic assertion", () => {
    expect(1 + 1).toBe(2);
  });

  test("async test example", async () => {
    const result = await Promise.resolve("hello");
    expect(result).toBe("hello");
  });

  test("array matching", () => {
    const arr = [1, 2, 3];
    expect(arr).toEqual([1, 2, 3]);
    expect(arr).toContain(2);
  });

  test("object matching", () => {
    const obj = { name: "test", value: 42 };
    expect(obj).toMatchObject({ name: "test" });
  });
});

describe("Test Coverage Example", () => {
  test("should demonstrate coverage tracking", () => {
    const add = (a: number, b: number): number => a + b;
    expect(add(2, 3)).toBe(5);
  });
});
