/**
 * Migrate Extensions Command - Backfill empty includeExtensions metadata
 *
 * Repositories indexed before extension metadata persistence was implemented
 * have `includeExtensions: []` in repositories.json. This command backfills
 * those empty arrays with DEFAULT_EXTENSIONS values.
 *
 * @example
 * ```bash
 * # Preview what would be migrated
 * pk-mcp migrate-extensions --dry-run
 *
 * # Migrate all repositories with empty extensions
 * pk-mcp migrate-extensions
 *
 * # Machine-readable output
 * pk-mcp migrate-extensions --json
 * ```
 */

/* eslint-disable no-console */

import chalk from "chalk";
import { RepositoryMetadataStoreImpl } from "../../repositories/metadata-store.js";
import { DEFAULT_EXTENSIONS } from "../../ingestion/default-extensions.js";
import { initializeLogger, type LogLevel } from "../../logging/index.js";
import type { RepositoryMetadataService } from "../../repositories/types.js";
import type { ValidatedMigrateExtensionsOptions } from "../utils/validation.js";

/**
 * Result of a single repository migration
 */
interface MigrationRepoResult {
  /** Repository name */
  name: string;
  /** Whether the repository was migrated or skipped */
  action: "migrated" | "skipped";
  /** Reason for skipping (if applicable) */
  reason?: string;
}

/**
 * Overall migration result
 */
interface MigrationResult {
  /** Total repositories inspected */
  totalRepositories: number;
  /** Count of repositories that were migrated */
  migratedCount: number;
  /** Count of repositories that were skipped */
  skippedCount: number;
  /** Per-repository results */
  repositories: MigrationRepoResult[];
  /** Whether this was a dry run */
  dryRun: boolean;
}

/**
 * Execute migrate-extensions command
 *
 * Backfills empty `includeExtensions` arrays with DEFAULT_EXTENSIONS for all
 * repositories that need it. Idempotent — skips repos that already have
 * non-empty extensions.
 *
 * @param options - Command options (dryRun, json)
 * @param repositoryService - Optional injected service (for testing)
 */
export async function migrateExtensionsCommand(
  options: ValidatedMigrateExtensionsOptions,
  repositoryService?: RepositoryMetadataService
): Promise<void> {
  // Initialize logger for CLI (commands that don't use initializeDependencies)
  initializeLogger({
    level: (Bun.env["LOG_LEVEL"] as LogLevel) || "warn",
    format: (Bun.env["LOG_FORMAT"] as "json" | "pretty") || "pretty",
  });

  const { dryRun = false, json = false } = options;
  const service = repositoryService ?? RepositoryMetadataStoreImpl.getInstance();

  // Load all repositories
  const repos = await service.listRepositories();

  const result: MigrationResult = {
    totalRepositories: repos.length,
    migratedCount: 0,
    skippedCount: 0,
    repositories: [],
    dryRun,
  };

  if (repos.length === 0) {
    if (json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(chalk.yellow("No repositories found. Nothing to migrate."));
    }
    return;
  }

  if (!json && !dryRun) {
    console.log(chalk.bold("\nMigrating includeExtensions metadata...\n"));
  } else if (!json && dryRun) {
    console.log(chalk.bold("\nMigrate Extensions (dry run)\n"));
  }

  const extensionsToSet = [...DEFAULT_EXTENSIONS];

  for (const repo of repos) {
    if (repo.includeExtensions && repo.includeExtensions.length > 0) {
      result.skippedCount++;
      result.repositories.push({
        name: repo.name,
        action: "skipped",
        reason: "already has extensions",
      });

      if (!json) {
        console.log(
          `  ${chalk.gray("skip")}  ${repo.name} ${chalk.gray(`(${repo.includeExtensions.length} extensions configured)`)}`
        );
      }
      continue;
    }

    // Repository needs migration
    if (!dryRun) {
      await service.updateRepository({
        ...repo,
        includeExtensions: extensionsToSet,
      });
    }

    result.migratedCount++;
    result.repositories.push({
      name: repo.name,
      action: "migrated",
    });

    if (!json) {
      const verb = dryRun ? "would migrate" : "migrated";
      console.log(
        `  ${chalk.green("✓")}  ${verb}  ${repo.name} ${chalk.gray(`→ ${extensionsToSet.length} extensions`)}`
      );
    }
  }

  // Summary
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(chalk.bold("\nSummary\n"));
    console.log(`  Total repositories: ${result.totalRepositories}`);

    if (dryRun) {
      console.log(`  Would migrate:      ${chalk.cyan(result.migratedCount.toString())}`);
    } else {
      console.log(`  Migrated:           ${chalk.green(result.migratedCount.toString())}`);
    }
    console.log(`  Skipped:            ${chalk.gray(result.skippedCount.toString())}`);

    if (dryRun && result.migratedCount > 0) {
      console.log(chalk.yellow("\n  (Dry run — no changes made)"));
      console.log(chalk.gray("  Run without --dry-run to apply these migrations."));
    } else if (result.migratedCount === 0) {
      console.log(chalk.gray("\n  All repositories already have extensions configured."));
    }
  }
}
