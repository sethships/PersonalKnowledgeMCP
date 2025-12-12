#!/usr/bin/env bun
/**
 * Personal Knowledge MCP - CLI Entry Point
 *
 * Command-line interface for repository management:
 * - index: Index a repository
 * - search: Search indexed repositories
 * - status: List indexed repositories
 * - remove: Remove a repository from index
 * - health: Health check
 */

/* eslint-disable @typescript-eslint/no-unsafe-argument */

import "dotenv/config";
import { Command } from "commander";
import { initializeDependencies } from "./utils/dependency-init.js";
import { handleCommandError } from "./utils/error-handler.js";
import { indexCommand, type IndexCommandOptions } from "./commands/index-command.js";
import { searchCommand, type SearchCommandOptions } from "./commands/search-command.js";
import { statusCommand, type StatusCommandOptions } from "./commands/status-command.js";
import { removeCommand, type RemoveCommandOptions } from "./commands/remove-command.js";
import { healthCommand } from "./commands/health-command.js";

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
      const deps = await initializeDependencies();
      await indexCommand(url, options as IndexCommandOptions, deps);
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
      const deps = await initializeDependencies();
      await searchCommand(query, options as SearchCommandOptions, deps);
    } catch (error) {
      handleCommandError(error);
    }
  });

// Status command
program
  .command("status")
  .description("List indexed repositories and their status")
  .option("--json", "Output as JSON")
  .action(async (options: Record<string, unknown>) => {
    try {
      const deps = await initializeDependencies();
      await statusCommand(options as StatusCommandOptions, deps);
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
      const deps = await initializeDependencies();
      await removeCommand(name, options as RemoveCommandOptions, deps);
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

program.parse();
