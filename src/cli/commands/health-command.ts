/**
 * Health Command - Check service health status
 *
 * Verifies that all required services are operational.
 */

/* eslint-disable no-console */

import chalk from "chalk";
import type { CliDependencies } from "../utils/dependency-init.js";

/**
 * Health check result for a single service
 */
interface HealthCheckResult {
  name: string;
  healthy: boolean;
  durationMs: number;
  error?: string;
}

/**
 * Execute health command
 *
 * Checks the health of all dependencies and displays results.
 * Exit code 0 if all checks pass, 1 if any fail.
 *
 * @param deps - CLI dependencies
 */
export async function healthCommand(deps: CliDependencies): Promise<void> {
  console.log(chalk.bold("\nHealth Check Results\n"));

  const results: HealthCheckResult[] = [];

  // Check ChromaDB
  const chromaStart = performance.now();
  try {
    const isHealthy = await deps.chromaClient.healthCheck();
    results.push({
      name: "ChromaDB",
      healthy: isHealthy,
      durationMs: performance.now() - chromaStart,
    });
  } catch (error) {
    results.push({
      name: "ChromaDB",
      healthy: false,
      durationMs: performance.now() - chromaStart,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Check Neo4j (optional - only if configured)
  if (deps.neo4jClient) {
    const neo4jStart = performance.now();
    try {
      const isHealthy = await deps.neo4jClient.healthCheck();
      results.push({
        name: "Neo4j",
        healthy: isHealthy,
        durationMs: performance.now() - neo4jStart,
      });
    } catch (error) {
      results.push({
        name: "Neo4j",
        healthy: false,
        durationMs: performance.now() - neo4jStart,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Check OpenAI API (embedding provider)
  const openaiStart = performance.now();
  try {
    // Simple check - verify provider is initialized
    // We don't make an actual API call to avoid costs
    const isHealthy =
      deps.embeddingProvider.providerId === "openai" && deps.embeddingProvider.modelId !== "";
    results.push({
      name: "OpenAI API",
      healthy: isHealthy,
      durationMs: performance.now() - openaiStart,
    });
  } catch (error) {
    results.push({
      name: "OpenAI API",
      healthy: false,
      durationMs: performance.now() - openaiStart,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Check Metadata Store
  const metadataStart = performance.now();
  try {
    await deps.repositoryService.listRepositories();
    results.push({
      name: "Metadata Store",
      healthy: true,
      durationMs: performance.now() - metadataStart,
    });
  } catch (error) {
    results.push({
      name: "Metadata Store",
      healthy: false,
      durationMs: performance.now() - metadataStart,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Display results
  for (const result of results) {
    const status = result.healthy ? chalk.green("✓") : chalk.red("✗");
    const duration = chalk.gray(`(${Math.round(result.durationMs)}ms)`);
    const healthStatus = result.healthy ? chalk.green("healthy") : chalk.red("unhealthy");

    console.log(`${status} ${result.name.padEnd(20)} ${healthStatus.padEnd(20)} ${duration}`);

    if (result.error) {
      console.log(chalk.gray(`  Error: ${result.error}`));
    }
  }

  // Summary
  const allHealthy = results.every((r) => r.healthy);
  console.log();

  if (allHealthy) {
    console.log(chalk.green("✓ All systems operational."));
    process.exit(0);
  } else {
    console.log(chalk.red("✗ Some systems are unhealthy."));
    console.log("\n" + chalk.bold("Next steps:"));
    console.log(
      "  • Verify ChromaDB is running: " + chalk.gray("docker compose --profile default up -d")
    );
    console.log(
      "  • Verify Neo4j is running: " +
        chalk.gray("docker compose --profile default up -d") +
        " (or check NEO4J_PASSWORD in .env)"
    );
    console.log("  • Check OPENAI_API_KEY in .env file");
    console.log("  • Check DATA_PATH permissions");
    process.exit(1);
  }
}
