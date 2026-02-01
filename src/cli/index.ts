#!/usr/bin/env bun
/**
 * Personal Knowledge MCP - CLI Entry Point
 *
 * Command-line interface for repository management:
 * - index: Index a repository
 * - search: Search indexed repositories
 * - status: List indexed repositories
 * - remove: Remove a repository from index
 * - update: Update a repository with latest changes
 * - update-all: Update all repositories
 * - reset-update: Reset stuck update state
 * - health: Health check
 * - token: Manage authentication tokens (create, list, revoke, rotate)
 * - graph: Manage knowledge graph (migrate, populate)
 * - providers: Manage embedding providers (status, setup)
 * - models: Manage embedding model cache (list, status, validate, clear, path, import)
 */

import "dotenv/config";
import { Command } from "commander";
import { initializeDependencies } from "./utils/dependency-init.js";
import { handleCommandError } from "./utils/error-handler.js";
import { indexCommand } from "./commands/index-command.js";
import { searchCommand } from "./commands/search-command.js";
import { statusCommand } from "./commands/status-command.js";
import { removeCommand } from "./commands/remove-command.js";
import { healthCommand } from "./commands/health-command.js";
import { updateRepositoryCommand } from "./commands/update-repository-command.js";
import { updateAllCommand } from "./commands/update-all-command.js";
import { historyCommand } from "./commands/history-command.js";
import { resetUpdateCommand } from "./commands/reset-update-command.js";
import {
  tokenCreateCommand,
  tokenListCommand,
  tokenRevokeCommand,
  tokenRotateCommand,
} from "./commands/token-command.js";
import { graphMigrateCommand } from "./commands/graph-migrate-command.js";
import { graphPopulateCommand } from "./commands/graph-populate-command.js";
import { graphPopulateAllCommand } from "./commands/graph-populate-all-command.js";
import { providersStatusCommand, providersSetupCommand } from "./commands/providers-command.js";
import {
  modelsListCommand,
  modelsStatusCommand,
  modelsValidateCommand,
  modelsClearCommand,
  modelsPathCommand,
  modelsImportCommand,
} from "./commands/models-command.js";
import {
  IndexCommandOptionsSchema,
  SearchCommandOptionsSchema,
  StatusCommandOptionsSchema,
  RemoveCommandOptionsSchema,
  UpdateCommandOptionsSchema,
  UpdateAllCommandOptionsSchema,
  HistoryCommandOptionsSchema,
  ResetUpdateCommandOptionsSchema,
  TokenCreateCommandOptionsSchema,
  TokenListCommandOptionsSchema,
  TokenRevokeCommandOptionsSchema,
  TokenRotateCommandOptionsSchema,
  GraphMigrateCommandOptionsSchema,
  GraphPopulateCommandOptionsSchema,
  GraphPopulateAllCommandOptionsSchema,
  ProvidersStatusCommandOptionsSchema,
  ProvidersSetupCommandOptionsSchema,
  ModelsListCommandOptionsSchema,
  ModelsStatusCommandOptionsSchema,
  ModelsValidateCommandOptionsSchema,
  ModelsClearCommandOptionsSchema,
  ModelsPathCommandOptionsSchema,
  ModelsImportCommandOptionsSchema,
} from "./utils/validation.js";

const program = new Command();

program
  .name("pk-mcp")
  .description("Personal Knowledge MCP - CLI for repository indexing and semantic search")
  .version("1.0.0");

// Index command
program
  .command("index")
  .description("Index a repository for semantic search")
  .argument("<url>", "Repository URL to index")
  .option("-n, --name <name>", "Custom repository name")
  .option("-b, --branch <branch>", "Branch to clone")
  .option("-f, --force", "Force reindexing if repository already exists")
  .option("-p, --provider <provider>", "Embedding provider (openai, transformersjs, local, ollama)")
  .action(async (url: string, options: Record<string, unknown>) => {
    try {
      const validatedOptions = IndexCommandOptionsSchema.parse(options);
      const deps = await initializeDependencies({ provider: validatedOptions.provider });
      await indexCommand(url, validatedOptions, deps);
    } catch (error) {
      handleCommandError(error);
    }
  });

// Search command
program
  .command("search")
  .description("Search indexed repositories using semantic search")
  .argument("<query>", "Search query")
  .option("-l, --limit <number>", "Maximum results (1-100)", "10")
  .option("-t, --threshold <number>", "Similarity threshold (0.0-1.0)", "0.7")
  .option("-r, --repo <name>", "Filter to specific repository")
  .option("-j, --json", "Output as JSON")
  .action(async (query: string, options: Record<string, unknown>) => {
    try {
      const validatedOptions = SearchCommandOptionsSchema.parse(options);
      const deps = await initializeDependencies();
      await searchCommand(query, validatedOptions, deps);
    } catch (error) {
      handleCommandError(error);
    }
  });

// Status command
program
  .command("status")
  .description("List indexed repositories and their status")
  .option("-j, --json", "Output as JSON")
  .option("--check", "Check GitHub for available updates")
  .option("--metrics", "Display aggregate update metrics")
  .action(async (options: Record<string, unknown>) => {
    try {
      const validatedOptions = StatusCommandOptionsSchema.parse(options);
      const deps = await initializeDependencies();
      await statusCommand(validatedOptions, deps);
    } catch (error) {
      handleCommandError(error);
    }
  });

// Remove command
program
  .command("remove")
  .description("Remove a repository from the index")
  .argument("<name>", "Repository name to remove")
  .option("-f, --force", "Skip confirmation prompt")
  .option("--delete-files", "Also delete local repository files")
  .action(async (name: string, options: Record<string, unknown>) => {
    try {
      const validatedOptions = RemoveCommandOptionsSchema.parse(options);
      const deps = await initializeDependencies();
      await removeCommand(name, validatedOptions, deps);
    } catch (error) {
      handleCommandError(error);
    }
  });

// Health command
program
  .command("health")
  .description("Check health of all services")
  .action(async () => {
    try {
      const deps = await initializeDependencies();
      await healthCommand(deps);
    } catch (error) {
      handleCommandError(error);
    }
  });

// Update command
program
  .command("update")
  .description("Update a repository with latest changes")
  .argument("<repository>", "Repository name to update")
  .option("-f, --force", "Force full re-index instead of incremental update")
  .option("-j, --json", "Output as JSON")
  .option("-v, --verbose", "Show all errors with actionable guidance")
  .action(async (repository: string, options: Record<string, unknown>) => {
    try {
      const validatedOptions = UpdateCommandOptionsSchema.parse(options);
      const deps = await initializeDependencies();
      await updateRepositoryCommand(repository, validatedOptions, deps);
    } catch (error) {
      handleCommandError(error);
    }
  });

// Update-all command
program
  .command("update-all")
  .description("Update all repositories with latest changes")
  .option("-j, --json", "Output as JSON")
  .action(async (options: Record<string, unknown>) => {
    try {
      const validatedOptions = UpdateAllCommandOptionsSchema.parse(options);
      const deps = await initializeDependencies();
      await updateAllCommand(validatedOptions, deps);
    } catch (error) {
      handleCommandError(error);
    }
  });

// History command
program
  .command("history")
  .description("Display update history for a repository")
  .argument("<repository>", "Repository name to show history for")
  .option("-l, --limit <number>", "Maximum history entries to show (1-100)", "10")
  .option("-j, --json", "Output as JSON")
  .action(async (repository: string, options: Record<string, unknown>) => {
    try {
      const validatedOptions = HistoryCommandOptionsSchema.parse(options);
      const deps = await initializeDependencies();
      await historyCommand(repository, validatedOptions, deps);
    } catch (error) {
      handleCommandError(error);
    }
  });

// Reset-update command
program
  .command("reset-update")
  .description("Reset stuck update state for a repository")
  .argument("<repository>", "Repository name to reset")
  .option("-f, --force", "Skip confirmation prompt")
  .option("-r, --recover", "Attempt automatic recovery")
  .option("-j, --json", "Output as JSON")
  .action(async (repository: string, options: Record<string, unknown>) => {
    try {
      const validatedOptions = ResetUpdateCommandOptionsSchema.parse(options);
      const deps = await initializeDependencies();
      await resetUpdateCommand(repository, validatedOptions, deps);
    } catch (error) {
      handleCommandError(error);
    }
  });

// Token command group
const tokenProgram = program.command("token").description("Manage authentication tokens");

// Token create subcommand
tokenProgram
  .command("create")
  .description("Create a new authentication token")
  .requiredOption("-n, --name <name>", "Token name (e.g., 'Cursor IDE')")
  .option("-s, --scopes <scopes>", "Permission scopes: read,write,admin", "read")
  .option("-i, --instances <instances>", "Instance access: private,work,public", "public")
  .option("-e, --expires <duration>", "Expiration: 30d, 1y, 12h, 2w, 3m, or never", "never")
  .action(async (options: Record<string, unknown>) => {
    try {
      const validatedOptions = TokenCreateCommandOptionsSchema.parse(options);
      const deps = await initializeDependencies();
      await tokenCreateCommand(validatedOptions, deps);
    } catch (error) {
      handleCommandError(error);
    }
  });

// Token list subcommand
tokenProgram
  .command("list")
  .description("List all tokens")
  .option("-j, --json", "Output as JSON")
  .option("--all", "Include expired and revoked tokens")
  .action(async (options: Record<string, unknown>) => {
    try {
      const validatedOptions = TokenListCommandOptionsSchema.parse(options);
      const deps = await initializeDependencies();
      await tokenListCommand(validatedOptions, deps);
    } catch (error) {
      handleCommandError(error);
    }
  });

// Token revoke subcommand
tokenProgram
  .command("revoke")
  .description("Revoke a token")
  .option("-n, --name <name>", "Revoke by token name")
  .option("--id <prefix>", "Revoke by hash prefix (8+ characters)")
  .option("-f, --force", "Skip confirmation prompt")
  .action(async (options: Record<string, unknown>) => {
    try {
      const validatedOptions = TokenRevokeCommandOptionsSchema.parse(options);
      const deps = await initializeDependencies();
      await tokenRevokeCommand(validatedOptions, deps);
    } catch (error) {
      handleCommandError(error);
    }
  });

// Token rotate subcommand
tokenProgram
  .command("rotate")
  .description("Rotate a token (revoke old, create new with same metadata)")
  .requiredOption("-n, --name <name>", "Token name to rotate")
  .action(async (options: Record<string, unknown>) => {
    try {
      const validatedOptions = TokenRotateCommandOptionsSchema.parse(options);
      const deps = await initializeDependencies();
      await tokenRotateCommand(validatedOptions, deps);
    } catch (error) {
      handleCommandError(error);
    }
  });

// Graph command group
const graphProgram = program.command("graph").description("Manage knowledge graph");

// Graph migrate subcommand
graphProgram
  .command("migrate")
  .description("Apply schema migrations to FalkorDB knowledge graph")
  .option("--dry-run", "Show what would be executed without applying")
  .option("-f, --force", "Re-apply all migrations even if already applied")
  .option("--status", "Show current schema version and pending migrations")
  .option("-j, --json", "Output as JSON")
  .action(async (options: Record<string, unknown>) => {
    try {
      const validatedOptions = GraphMigrateCommandOptionsSchema.parse(options);
      await graphMigrateCommand(validatedOptions);
    } catch (error) {
      handleCommandError(error);
    }
  });

// Graph populate subcommand
graphProgram
  .command("populate")
  .description("Populate knowledge graph from an indexed repository")
  .argument("<repository>", "Repository name to populate")
  .option("-f, --force", "Delete existing graph data and repopulate")
  .option("-j, --json", "Output as JSON")
  .action(async (repository: string, options: Record<string, unknown>) => {
    try {
      const validatedOptions = GraphPopulateCommandOptionsSchema.parse(options);
      const deps = await initializeDependencies();
      await graphPopulateCommand(repository, validatedOptions, deps.repositoryService);
    } catch (error) {
      handleCommandError(error);
    }
  });

// Graph populate-all subcommand
graphProgram
  .command("populate-all")
  .description("Populate knowledge graph for all indexed repositories")
  .option("-f, --force", "Delete existing graph data and repopulate")
  .option("-j, --json", "Output as JSON")
  .action(async (options: Record<string, unknown>) => {
    try {
      const validatedOptions = GraphPopulateAllCommandOptionsSchema.parse(options);
      const deps = await initializeDependencies();
      await graphPopulateAllCommand(validatedOptions, deps.repositoryService);
    } catch (error) {
      handleCommandError(error);
    }
  });

// Providers command group
const providersProgram = program.command("providers").description("Manage embedding providers");

// Providers status subcommand
providersProgram
  .command("status")
  .description("Show available providers and their status")
  .option("-j, --json", "Output as JSON")
  .action(async (options: Record<string, unknown>) => {
    try {
      const validatedOptions = ProvidersStatusCommandOptionsSchema.parse(options);
      const deps = await initializeDependencies();
      await providersStatusCommand(validatedOptions, deps);
    } catch (error) {
      handleCommandError(error);
    }
  });

// Providers setup subcommand
providersProgram
  .command("setup")
  .description("Download/prepare local embedding models")
  .argument("<provider>", "Provider to set up (transformersjs, local, ollama)")
  .option("-m, --model <model>", "Model to download (provider-specific)")
  .option("-f, --force", "Re-download even if model exists")
  .action(async (provider: string, options: Record<string, unknown>) => {
    try {
      const validatedOptions = ProvidersSetupCommandOptionsSchema.parse({
        ...options,
        provider,
      });
      await providersSetupCommand(validatedOptions);
    } catch (error) {
      handleCommandError(error);
    }
  });

// Models command group
const modelsProgram = program.command("models").description("Manage embedding model cache");

// Models list subcommand
modelsProgram
  .command("list")
  .description("List all cached embedding models")
  .option("-p, --provider <provider>", "Filter to specific provider (transformersjs, ollama)")
  .option("-j, --json", "Output as JSON")
  .action(async (options: Record<string, unknown>) => {
    try {
      const validatedOptions = ModelsListCommandOptionsSchema.parse(options);
      await modelsListCommand(validatedOptions);
    } catch (error) {
      handleCommandError(error);
    }
  });

// Models status subcommand
modelsProgram
  .command("status")
  .description("Show cache status and disk usage")
  .option("-p, --provider <provider>", "Filter to specific provider (transformersjs, ollama)")
  .option("-j, --json", "Output as JSON")
  .action(async (options: Record<string, unknown>) => {
    try {
      const validatedOptions = ModelsStatusCommandOptionsSchema.parse(options);
      await modelsStatusCommand(validatedOptions);
    } catch (error) {
      handleCommandError(error);
    }
  });

// Models validate subcommand
modelsProgram
  .command("validate")
  .description("Validate cached model integrity")
  .argument("[modelId]", "Model ID to validate (all models if not specified)")
  .option("-p, --provider <provider>", "Filter to specific provider (transformersjs, ollama)")
  .option("--fix", "Attempt to fix invalid models by re-downloading")
  .option("-j, --json", "Output as JSON")
  .action(async (modelId: string | undefined, options: Record<string, unknown>) => {
    try {
      const validatedOptions = ModelsValidateCommandOptionsSchema.parse(options);
      await modelsValidateCommand(modelId, validatedOptions);
    } catch (error) {
      handleCommandError(error);
    }
  });

// Models clear subcommand
modelsProgram
  .command("clear")
  .description("Clear cached models")
  .argument("[modelId]", "Model ID to clear (all models if not specified)")
  .option("-p, --provider <provider>", "Filter to specific provider (transformersjs, ollama)")
  .option("-f, --force", "Skip confirmation prompt")
  .option("--dry-run", "Show what would be cleared without actually clearing")
  .action(async (modelId: string | undefined, options: Record<string, unknown>) => {
    try {
      const validatedOptions = ModelsClearCommandOptionsSchema.parse(options);
      await modelsClearCommand(modelId, validatedOptions);
    } catch (error) {
      handleCommandError(error);
    }
  });

// Models path subcommand
modelsProgram
  .command("path")
  .description("Show path for manual model placement (air-gapped installations)")
  .argument("<modelId>", "Model ID to get path for")
  .option("-p, --provider <provider>", "Provider (default: transformersjs)")
  .action((modelId: string, options: Record<string, unknown>) => {
    try {
      const validatedOptions = ModelsPathCommandOptionsSchema.parse(options);
      modelsPathCommand(modelId, validatedOptions);
    } catch (error) {
      handleCommandError(error);
    }
  });

// Models import subcommand
modelsProgram
  .command("import")
  .description("Import model from local files (air-gapped installations)")
  .argument("<sourcePath>", "Path to source model files")
  .requiredOption("-p, --provider <provider>", "Provider (transformersjs, ollama)")
  .requiredOption("-m, --model-id <modelId>", "Model identifier to use in cache")
  .option("--validate", "Validate after import")
  .option("--overwrite", "Overwrite existing cached model")
  .action(async (sourcePath: string, options: Record<string, unknown>) => {
    try {
      const validatedOptions = ModelsImportCommandOptionsSchema.parse(options);
      await modelsImportCommand(sourcePath, validatedOptions);
    } catch (error) {
      handleCommandError(error);
    }
  });

program.parse();
