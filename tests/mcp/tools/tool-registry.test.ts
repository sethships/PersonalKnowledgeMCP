/**
 * Tests for MCP Tool Registry
 *
 * Verifies that update tools are always registered (with real or stub handlers),
 * that stub handlers return service_unavailable errors, and that reason strings
 * are properly threaded through.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import type { TextContent } from "@modelcontextprotocol/sdk/types.js";
import type { SearchService } from "../../../src/services/types.js";
import type { RepositoryMetadataService } from "../../../src/repositories/types.js";
import type { IncrementalUpdateCoordinator } from "../../../src/services/incremental-update-coordinator.js";
import type { MCPRateLimiter } from "../../../src/mcp/rate-limiter.js";
import type { JobTracker } from "../../../src/mcp/job-tracker.js";
import {
  createToolRegistry,
  getToolDefinitions,
  createUnavailableToolHandler,
} from "../../../src/mcp/tools/index.js";
import { initializeLogger, resetLogger } from "../../../src/logging/index.js";

/**
 * Type guard to check if value is TextContent
 */
function isTextContent(value: unknown): value is TextContent {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "text" &&
    "text" in value
  );
}

/**
 * Helper to safely extract text from MCP response content
 */
function getTextContent(content: unknown): string {
  if (Array.isArray(content) && content.length > 0 && isTextContent(content[0])) {
    return content[0].text;
  }
  throw new Error("Expected text content");
}

/**
 * Helper to safely get a registry entry, throwing if not found
 */
function getRegistryEntry(registry: ReturnType<typeof createToolRegistry>, toolName: string) {
  const entry = registry[toolName];
  if (!entry) {
    throw new Error(`Expected tool "${toolName}" to be registered`);
  }
  return entry;
}

/**
 * Minimal mock SearchService satisfying the interface
 */
function createMockSearchService(): SearchService {
  return {
    search: async () => ({ results: [], totalResults: 0, searchDurationMs: 0 }),
  } as unknown as SearchService;
}

/**
 * Minimal mock RepositoryMetadataService
 */
function createMockRepositoryService(): RepositoryMetadataService {
  return {
    listRepositories: async () => [],
    getRepository: async () => undefined,
  } as unknown as RepositoryMetadataService;
}

/**
 * Minimal mocks for update tool dependencies
 */
function createMockUpdateDeps(): {
  updateCoordinator: IncrementalUpdateCoordinator;
  rateLimiter: MCPRateLimiter;
  jobTracker: JobTracker;
} {
  return {
    updateCoordinator: {
      runIncrementalUpdate: async () => ({
        status: "updated",
        commitSha: "abc123",
        commitMessage: "test",
        stats: {
          filesAdded: 0,
          filesModified: 0,
          filesDeleted: 0,
          chunksUpserted: 0,
          chunksDeleted: 0,
          durationMs: 0,
        },
        errors: [],
        durationMs: 0,
      }),
    } as unknown as IncrementalUpdateCoordinator,
    rateLimiter: {
      checkRateLimit: () => ({ allowed: true, remainingMs: 0 }),
    } as unknown as MCPRateLimiter,
    jobTracker: {
      createJob: () => "job-1",
      getJob: () => undefined,
      getJobResponse: () => undefined,
      updateJob: () => {},
    } as unknown as JobTracker,
  };
}

describe("Tool Registry", () => {
  beforeEach(() => {
    initializeLogger({ level: "error", format: "pretty" });
  });

  afterEach(() => {
    resetLogger();
  });

  describe("createUnavailableToolHandler", () => {
    it("returns service_unavailable error with tool name and reason", async () => {
      const handler = createUnavailableToolHandler(
        "trigger_incremental_update",
        "GITHUB_PAT is not configured"
      );

      const result = await handler({});
      const text = getTextContent(result.content);
      const parsed = JSON.parse(text);

      expect(parsed.success).toBe(false);
      expect(parsed.error).toBe("service_unavailable");
      expect(parsed.message).toContain("trigger_incremental_update");
      expect(parsed.message).toContain("GITHUB_PAT is not configured");
    });

    it("sets isError to true on stub responses", async () => {
      const handler = createUnavailableToolHandler("get_update_status", "test reason");

      const result = await handler({});

      expect(result.isError).toBe(true);
    });

    it("includes reason string in the error message", async () => {
      const customReason = "Initialization failed: connection refused";
      const handler = createUnavailableToolHandler("trigger_incremental_update", customReason);

      const result = await handler({});
      const text = getTextContent(result.content);
      const parsed = JSON.parse(text);

      expect(parsed.message).toContain(customReason);
    });
  });

  describe("update tools registration", () => {
    it("registers both update tools even without update dependencies", () => {
      const registry = createToolRegistry({
        searchService: createMockSearchService(),
        repositoryService: createMockRepositoryService(),
      });

      expect(registry["trigger_incremental_update"]).toBeDefined();
      expect(registry["get_update_status"]).toBeDefined();
    });

    it("includes update tools in getToolDefinitions without deps", () => {
      const registry = createToolRegistry({
        searchService: createMockSearchService(),
        repositoryService: createMockRepositoryService(),
      });

      const definitions = getToolDefinitions(registry);
      const toolNames = definitions.map((d) => d.name);

      expect(toolNames).toContain("trigger_incremental_update");
      expect(toolNames).toContain("get_update_status");
    });

    it("stub trigger_incremental_update returns service_unavailable", async () => {
      const registry = createToolRegistry({
        searchService: createMockSearchService(),
        repositoryService: createMockRepositoryService(),
        updateToolsUnavailableReason: "GITHUB_PAT is not configured",
      });

      const { handler } = getRegistryEntry(registry, "trigger_incremental_update");
      const result = await handler({});
      const text = getTextContent(result.content);
      const parsed = JSON.parse(text);

      expect(result.isError).toBe(true);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toBe("service_unavailable");
      expect(parsed.message).toContain("GITHUB_PAT is not configured");
    });

    it("stub get_update_status returns service_unavailable", async () => {
      const registry = createToolRegistry({
        searchService: createMockSearchService(),
        repositoryService: createMockRepositoryService(),
        updateToolsUnavailableReason: "GITHUB_PAT is not configured",
      });

      const { handler } = getRegistryEntry(registry, "get_update_status");
      const result = await handler({});
      const text = getTextContent(result.content);
      const parsed = JSON.parse(text);

      expect(result.isError).toBe(true);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toBe("service_unavailable");
      expect(parsed.message).toContain("get_update_status");
    });

    it("uses default fallback reason when updateToolsUnavailableReason not provided", async () => {
      const registry = createToolRegistry({
        searchService: createMockSearchService(),
        repositoryService: createMockRepositoryService(),
        // No updateToolsUnavailableReason provided
      });

      const { handler } = getRegistryEntry(registry, "trigger_incremental_update");
      const result = await handler({});
      const text = getTextContent(result.content);
      const parsed = JSON.parse(text);

      // The default reason names the dependencies that were actually missing.
      // It must not blame GITHUB_PAT: after issue #598 the PAT can never be why
      // the stub path was taken, and that misattribution is the exact dead end
      // #598 was filed about.
      expect(parsed.message).toContain("Incremental update dependencies");
      expect(parsed.message).toContain("not supplied to the tool registry");
      expect(parsed.message).toContain("unrelated to GITHUB_PAT");
    });

    it("legacy two-arg signature also registers stub update tools", () => {
      const registry = createToolRegistry(createMockSearchService(), createMockRepositoryService());
      expect(registry["trigger_incremental_update"]).toBeDefined();
      expect(registry["get_update_status"]).toBeDefined();
    });

    it("uses real handlers when all update dependencies are provided", async () => {
      const updateDeps = createMockUpdateDeps();
      const registry = createToolRegistry({
        searchService: createMockSearchService(),
        repositoryService: createMockRepositoryService(),
        ...updateDeps,
      });

      // Both tools should be registered
      expect(registry["trigger_incremental_update"]).toBeDefined();
      expect(registry["get_update_status"]).toBeDefined();

      // Verify definitions match expected tool definitions
      const triggerEntry = getRegistryEntry(registry, "trigger_incremental_update");
      const statusEntry = getRegistryEntry(registry, "get_update_status");
      expect(triggerEntry.definition.name).toBe("trigger_incremental_update");
      expect(statusEntry.definition.name).toBe("get_update_status");

      // Verify real handler does not return service_unavailable stub
      const result = await triggerEntry.handler({ repository: "test-repo" });
      const text = getTextContent(result.content);
      const parsed = JSON.parse(text);
      expect(parsed.error).not.toBe("service_unavailable");
    });

    it("registers the real update handlers with no PAT concept in the deps (issue #598)", async () => {
      // Regression guard: the bootstrap no longer gates update-dependency
      // construction on GITHUB_PAT, so a registry built from those deps alone
      // must expose the REAL handlers. The stub is detectable behaviorally: it
      // answers `service_unavailable` for ANY input, whereas the real handler
      // resolves the repository first and answers `repository_not_found` for
      // an unknown name.
      const registry = createToolRegistry({
        searchService: createMockSearchService(),
        repositoryService: createMockRepositoryService(),
        ...createMockUpdateDeps(),
        // No githubPatConfigured, no updateToolsUnavailableReason.
      });

      const triggerResult = await getRegistryEntry(registry, "trigger_incremental_update").handler({
        repository: "not-indexed",
      });
      const triggerParsed = JSON.parse(getTextContent(triggerResult.content));
      expect(triggerParsed.error).toBe("repository_not_found");

      // get_update_status must be real too: an unknown job is `job_not_found`,
      // never `service_unavailable`.
      const statusResult = await getRegistryEntry(registry, "get_update_status").handler({
        job_id: "update-does-not-exist",
      });
      const statusParsed = JSON.parse(getTextContent(statusResult.content));
      expect(statusParsed.error).toBe("job_not_found");
    });
  });
});
