/**
 * A simple exported function for testing basic parsing.
 * @param x - The input number
 * @returns The doubled value
 */
export function doubleNumber(x: number): number {
  return x * 2;
}

/**
 * An async function with multiple parameters.
 */
export async function fetchData(url: string, timeout?: number): Promise<string> {
  // Implementation
  return "data";
}

// Non-exported function
function privateHelper(value: string): void {
  console.log(value);
}

// Arrow function assigned to const
export const addNumbers = (a: number, b: number): number => a + b;

// Generator function
export function* generateSequence(start: number, end: number): Generator<number> {
  for (let i = start; i <= end; i++) {
    yield i;
  }
}
