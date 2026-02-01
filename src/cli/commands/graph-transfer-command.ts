/**
 * Graph Transfer Command - Migrate data between graph databases
 *
 * Provides CLI functionality to migrate graph data from one database backend
 * to another (e.g., Neo4j to FalkorDB).
 *
 * @example
 * ```bash
 * # Migrate from Neo4j to FalkorDB (default)
 * pk-mcp graph transfer
 *
 * # Dry run to see what would be migrated
 * pk-mcp graph transfer --dry-run
 *
 * # Specify source and target explicitly
 * pk-mcp graph transfer --source neo4j --target falkordb
 *
 * # Customize batch size for large graphs
 * pk-mcp graph transfer --batch-size 500
 *
 * # Output as JSON
 * pk-mcp graph transfer --json
 * ```
 */

/* eslint-disable no-console */

import chalk from "chalk";
import ora from "ora";
import type { ValidatedGraphTransferOptions } from "../utils/validation.js";
import { createMigrationService, type MigrationProgress } from "../../migration/index.js";
import type { GraphStorageConfig, GraphAdapterType } from "../../graph/adapters/types.js";
import { initializeLogger, type LogLevel } from "../../logging/index.js";
import { getGraphConfig } from "../utils/neo4j-config.js";
import { getFalkorDBConfig } from "../utils/falkordb-config.js";

/**
 * Format bytes into human-readable string
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

/**
 * Get configuration for the specified adapter type
 */
function getAdapterConfig(adapterType: GraphAdapterType): GraphStorageConfig {
  switch (adapterType) {
    case "neo4j":
      return getGraphConfig();
    case "falkordb":
      return getFalkorDBConfig();
    default: {
      // TypeScript exhaustiveness check
      const _exhaustiveCheck: never = adapterType;
      throw new Error(`Unsupported adapter type: ${String(_exhaustiveCheck)}`);
    }
  }
}

/**
 * Execute graph transfer command
 *
 * Migrates data from source graph database to target graph database.
 *
 * @param options - Command options
 */
export async function graphTransferCommand(options: ValidatedGraphTransferOptions): Promise<void> {
  // Initialize logger for CLI (commands that don't use initializeDependencies)
  initializeLogger({
    level: (Bun.env["LOG_LEVEL"] as LogLevel) || "warn",
    format: (Bun.env["LOG_FORMAT"] as "json" | "pretty") || "pretty",
  });

  const {
    source = "neo4j",
    target = "falkordb",
    dryRun = false,
    batchSize = 1000,
    validationSamples = 10,
    json = false,
  } = options;

  // Validate source and target are different
  if (source === target) {
    if (json) {
      console.log(
        JSON.stringify({
          success: false,
          error: "Source and target databases must be different",
        })
      );
    } else {
      console.error(chalk.red("\nError: Source and target databases must be different"));
      console.error(chalk.gray(`  Both set to: ${source}`));
    }
    process.exit(1);
  }

  // Get configurations
  let sourceConfig: GraphStorageConfig;
  let targetConfig: GraphStorageConfig;

  try {
    sourceConfig = getAdapterConfig(source);
  } catch (error) {
    if (json) {
      console.log(
        JSON.stringify({
          success: false,
          error: `Source configuration error: ${error instanceof Error ? error.message : String(error)}`,
        })
      );
    } else {
      console.error(chalk.red(`\nError: Failed to get ${source} configuration`));
      console.error(chalk.gray(`  ${error instanceof Error ? error.message : String(error)}`));
      console.error("\n" + chalk.bold("Next steps:"));
      if (source === "neo4j") {
        console.error("  • Set NEO4J_PASSWORD in your .env file");
      } else {
        console.error("  • Set FALKORDB_PASSWORD in your .env file");
      }
    }
    process.exit(1);
  }

  try {
    targetConfig = getAdapterConfig(target);
  } catch (error) {
    if (json) {
      console.log(
        JSON.stringify({
          success: false,
          error: `Target configuration error: ${error instanceof Error ? error.message : String(error)}`,
        })
      );
    } else {
      console.error(chalk.red(`\nError: Failed to get ${target} configuration`));
      console.error(chalk.gray(`  ${error instanceof Error ? error.message : String(error)}`));
      console.error("\n" + chalk.bold("Next steps:"));
      if (target === "falkordb") {
        console.error("  • Set FALKORDB_PASSWORD in your .env file");
        console.error("  • Start FalkorDB: " + chalk.gray("docker compose up falkordb -d"));
      } else {
        console.error("  • Set NEO4J_PASSWORD in your .env file");
      }
    }
    process.exit(1);
  }

  const spinner = ora({
    text: `Initializing migration from ${source} to ${target}...`,
    color: "cyan",
  });

  if (!json) {
    console.log(chalk.bold("\nGraph Data Migration\n"));
    console.log(`  Source:      ${chalk.cyan(source)}`);
    console.log(`  Target:      ${chalk.cyan(target)}`);
    console.log(`  Batch size:  ${chalk.cyan(batchSize.toString())}`);
    console.log(`  Dry run:     ${dryRun ? chalk.yellow("Yes") : chalk.green("No")}`);
    console.log("");
    spinner.start();
  }

  const migrationService = createMigrationService();

  // Progress callback for spinner updates
  const onProgress = (progress: MigrationProgress): void => {
    if (!json && spinner) {
      let text = `${progress.phase}: ${progress.step}`;
      if (progress.total !== undefined && progress.percentage !== undefined) {
        text += ` (${progress.processed}/${progress.total} - ${progress.percentage}%)`;
      } else {
        text += ` (${progress.processed} processed)`;
      }
      spinner.text = text;
    }
  };

  try {
    const result = await migrationService.migrate(sourceConfig, targetConfig, source, target, {
      batchSize,
      dryRun,
      validationSamples,
      onProgress,
    });

    if (!json) {
      spinner.stop();
    }

    if (json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(chalk.bold("\nMigration Result\n"));

      if (result.error) {
        console.log(chalk.red(`  Error: ${result.error}`));
        process.exit(1);
      }

      // Export summary
      console.log(chalk.bold("  Export:"));
      console.log(
        `    Nodes exported:         ${chalk.cyan(result.export.metadata.nodeCount.toString())}`
      );
      console.log(
        `    Relationships exported: ${chalk.cyan(result.export.metadata.relationshipCount.toString())}`
      );
      console.log(
        `    Node labels:            ${chalk.gray(result.export.metadata.nodeLabels.join(", ") || "(none)")}`
      );
      console.log(
        `    Relationship types:     ${chalk.gray(result.export.metadata.relationshipTypes.join(", ") || "(none)")}`
      );

      // Import summary (if not dry run)
      if (result.import) {
        console.log("");
        console.log(chalk.bold("  Import:"));
        console.log(
          `    Nodes imported:         ${chalk.cyan(result.import.nodesImported.toString())}`
        );
        console.log(
          `    Relationships imported: ${chalk.cyan(result.import.relationshipsImported.toString())}`
        );
        if (result.import.nodeErrors.length > 0) {
          console.log(
            `    Node errors:            ${chalk.red(result.import.nodeErrors.length.toString())}`
          );
        }
        if (result.import.relationshipErrors.length > 0) {
          console.log(
            `    Relationship errors:    ${chalk.red(result.import.relationshipErrors.length.toString())}`
          );
        }
        console.log(
          `    Duration:               ${chalk.gray(formatDuration(result.import.durationMs))}`
        );
      }

      // Validation summary
      console.log("");
      console.log(chalk.bold("  Validation:"));
      console.log(
        `    Status: ${result.validation.isValid ? chalk.green("PASSED") : chalk.red("FAILED")}`
      );

      if (result.validation.discrepancies.length > 0) {
        console.log(`    Discrepancies:`);
        for (const d of result.validation.discrepancies) {
          console.log(`      ${chalk.yellow("•")} ${d}`);
        }
      }

      if (result.validation.sampleChecks.length > 0) {
        const passedSamples = result.validation.sampleChecks.filter(
          (s) => s.propertiesMatch
        ).length;
        console.log(
          `    Sample checks: ${passedSamples}/${result.validation.sampleChecks.length} passed`
        );
      }

      // Summary
      console.log("");
      console.log(`  Total duration: ${chalk.cyan(formatDuration(result.totalDurationMs))}`);

      if (dryRun) {
        console.log("");
        console.log(chalk.yellow("  (Dry run - no data was written to target)"));
        console.log(chalk.gray("  Run without --dry-run to perform the migration."));
      } else if (result.success) {
        console.log("");
        console.log(chalk.green("  Migration completed successfully!"));
      } else {
        console.log("");
        console.log(
          chalk.red("  Migration completed with errors. Please review the validation results.")
        );
      }
    }

    if (!result.success && !dryRun) {
      process.exit(1);
    }
  } catch (error) {
    if (!json) {
      spinner.fail("Migration failed");
    }

    const errorMessage = error instanceof Error ? error.message : String(error);

    if (json) {
      console.log(
        JSON.stringify({
          success: false,
          error: errorMessage,
        })
      );
    } else {
      console.error(chalk.red(`\nError: ${errorMessage}`));
      console.error("\n" + chalk.bold("Next steps:"));
      console.error(`  • Verify ${source} is running`);
      console.error(`  • Verify ${target} is running`);
      console.error("  • Check connection settings in .env");
    }

    process.exit(1);
  }
}
