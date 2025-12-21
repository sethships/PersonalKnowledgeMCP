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
  IndexCommandOptionsSchema,
  SearchCommandOptionsSchema,
  StatusCommandOptionsSchema,
  RemoveCommandOptionsSchema,
  UpdateCommandOptionsSchema,
  UpdateAllCommandOptionsSchema,
  HistoryCommandOptionsSchema,
  ResetUpdateCommandOptionsSchema,
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
  .action(async (url: string, options: Record<string, unknown>) => {
    try {
      const validatedOptions = IndexCommandOptionsSchema.parse(options);
      const deps = await initializeDependencies();
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
  .option("--json", "Output as JSON")
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
  .option("--json", "Output as JSON")
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
  .option("--json", "Output as JSON")
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
  .option("--json", "Output as JSON")
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
  .option("--json", "Output as JSON")
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
  .option("--json", "Output as JSON")
  .action(async (repository: string, options: Record<string, unknown>) => {
    try {
      const validatedOptions = ResetUpdateCommandOptionsSchema.parse(options);
      const deps = await initializeDependencies();
      await resetUpdateCommand(repository, validatedOptions, deps);
    } catch (error) {
      handleCommandError(error);
    }
  });

program.parse();
