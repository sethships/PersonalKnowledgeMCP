/**
 * Graph Migrate Command - Manage Neo4j schema migrations
 *
 * Applies schema migrations to the Neo4j knowledge graph, including
 * constraints and indexes for optimal performance.
 *
 * @example
 * ```bash
 * # Show current schema status
 * pk-mcp graph migrate --status
 *
 * # Preview what would be applied
 * pk-mcp graph migrate --dry-run
 *
 * # Apply pending migrations
 * pk-mcp graph migrate
 *
 * # Force re-apply all migrations
 * pk-mcp graph migrate --force
 * ```
 */

/* eslint-disable no-console */

import chalk from "chalk";
import ora from "ora";
import { Neo4jStorageClientImpl } from "../../graph/Neo4jClient.js";
import { MigrationRunner, registerAllMigrations } from "../../graph/migration/index.js";
import type { Neo4jConfig } from "../../graph/types.js";
import type { ValidatedGraphMigrateOptions } from "../utils/validation.js";
import { getNeo4jConfig } from "../utils/neo4j-config.js";

/**
 * Execute graph migrate command
 *
 * @param options - Command options
 */
export async function graphMigrateCommand(options: ValidatedGraphMigrateOptions): Promise<void> {
  const { dryRun = false, force = false, status = false, json = false } = options;

  // Get Neo4j config and create client
  let config: Neo4jConfig;
  try {
    config = getNeo4jConfig();
  } catch (error) {
    if (json) {
      console.log(
        JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        })
      );
    } else {
      console.error(chalk.red("\n" + (error instanceof Error ? error.message : String(error))));
      console.error("\n" + chalk.bold("Next steps:"));
      console.error("  • Set NEO4J_PASSWORD in your .env file");
      console.error("  • Or export NEO4J_PASSWORD in your shell");
    }
    process.exit(1);
  }

  const spinner = ora({
    text: "Connecting to Neo4j...",
    color: "cyan",
  });

  if (!json) {
    spinner.start();
  }

  let client: Neo4jStorageClientImpl | null = null;

  try {
    // Create client and connect
    client = new Neo4jStorageClientImpl(config);
    await client.connect();

    if (!json) {
      spinner.succeed("Connected to Neo4j");
    }

    // Create migration runner and register migrations
    const runner = new MigrationRunner(client);
    registerAllMigrations(runner);

    // Status-only mode
    if (status) {
      const schemaStatus = await runner.getStatus();

      if (json) {
        console.log(JSON.stringify(schemaStatus, null, 2));
      } else {
        console.log(chalk.bold("\nSchema Status\n"));

        if (schemaStatus.currentVersion) {
          console.log(`  Current version: ${chalk.cyan(schemaStatus.currentVersion)}`);
        } else {
          console.log(`  Current version: ${chalk.gray("(none)")}`);
        }

        console.log(`  Latest version:  ${chalk.cyan(schemaStatus.latestVersion)}`);
        console.log(`  Pending:         ${chalk.yellow(schemaStatus.pendingCount.toString())}`);

        if (schemaStatus.pendingVersions.length > 0) {
          console.log(`  Pending versions: ${schemaStatus.pendingVersions.join(", ")}`);
        }

        if (schemaStatus.history.length > 0) {
          console.log(chalk.bold("\nMigration History\n"));
          for (const applied of schemaStatus.history) {
            const date = applied.appliedAt.toISOString().split("T")[0];
            console.log(`  ${chalk.green("✓")} ${applied.version} - ${applied.description}`);
            console.log(chalk.gray(`    Applied: ${date}`));
          }
        }
      }

      return;
    }

    // Run migrations
    if (!json) {
      const actionText = dryRun ? "Checking migrations (dry run)..." : "Applying migrations...";
      spinner.text = actionText;
      spinner.start();
    }

    const result = await runner.migrate({ dryRun, force });

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

      if (result.applied.length === 0 && result.skipped.length === 0) {
        console.log(chalk.gray("  No migrations to apply."));
      } else {
        if (result.skipped.length > 0) {
          console.log(chalk.gray(`  Skipped: ${result.skipped.length} (already applied)`));
        }

        if (result.applied.length > 0) {
          const verb = dryRun ? "Would apply" : "Applied";
          console.log(chalk.green(`  ${verb}: ${result.applied.length} migration(s)`));

          for (const applied of result.applied) {
            console.log(`    ${chalk.green("✓")} ${applied.version} - ${applied.description}`);
          }
        }

        if (result.currentVersion) {
          console.log(`\n  Current version: ${chalk.cyan(result.currentVersion)}`);
        }
      }

      if (dryRun && result.applied.length > 0) {
        console.log(chalk.yellow("\n  (Dry run - no changes made)"));
        console.log(chalk.gray("  Run without --dry-run to apply these migrations."));
      }
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
      console.error("  • Verify Neo4j is running: " + chalk.gray("docker compose up neo4j -d"));
      console.error("  • Check Neo4j connection settings in .env");
      console.error("  • Verify Neo4j credentials are correct");
    }

    process.exit(1);
  } finally {
    // Disconnect from Neo4j
    if (client) {
      try {
        await client.disconnect();
      } catch {
        // Ignore disconnect errors during cleanup
      }
    }
  }
}
