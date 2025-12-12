/**
 * Interactive Prompts for CLI
 *
 * Simple utilities for getting user confirmation in interactive mode.
 */

import * as readline from "readline";

/**
 * Prompt user for confirmation
 *
 * Displays a message and waits for user input. Returns true if the user
 * enters 'yes' or 'y' (case-insensitive), false otherwise.
 *
 * @param message - The confirmation message to display
 * @returns Promise that resolves to true if confirmed, false otherwise
 *
 * @example
 * ```typescript
 * const confirmed = await confirm("Delete all files?");
 * if (confirmed) {
 *   // Proceed with deletion
 * }
 * ```
 */
export async function confirm(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(message + " ", (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      resolve(normalized === "yes" || normalized === "y");
    });
  });
}
