/**
 * This file contains intentional syntax errors for testing error handling.
 */

// Missing closing brace
export function brokenFunction(x: number) {
  return x * 2

// Missing closing parenthesis
export function anotherBroken(a: string {
  return a;
}

// Valid function after errors (parser should recover)
export function validAfterErrors(): string {
  return "recovered";
}
