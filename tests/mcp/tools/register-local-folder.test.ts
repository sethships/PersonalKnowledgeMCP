/**
 * Unit tests for register_local_folder MCP tool (Phase C / issue #566 / T4.3-T4.4).
 *
 * Covers: argument validation, tool-definition shape (so it appears in
 * tools/list), sync mode happy path, sync failure surfacing typed errors,
 * async mode returning a JobTracker job ID, and watcher start invocation
 * when the coordinator is wired.
 *
 * @module tests/mcp/tools/register-local-folder
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import type { TextContent } from "@modelcontextprotocol/sdk/types.js";
import {
  registerLocalFolderToolDefinition,
  createRegisterLocalFolderHandler,
} from "../../../src/mcp/tools/register-local-folder.js";
import { initializeLogger, resetLogger } from "../../../src/logging/index.js";
import type { IngestionService } from "../../../src/services/ingestion-service.js";
import type { LocalFolderUpdateCoordinator } from "../../../src/services/local-folder-update-coordinator.js";
import type { RepositoryMetadataService, RepositoryInfo } from "../../../src/repositories/types.js";
import type { JobTracker } from "../../../src/mcp/job-tracker.js";
import type { IndexResult } from "../../../src/services/ingestion-types.js";

function successResult(name: string): IndexResult {
  return {
    status: "success",
    repository: name,
    collectionName: `repo_${name}`,
    stats: {
      filesScanned: 5,
      filesProcessed: 5,
      filesFailed: 0,
      chunksCreated: 17,
      embeddingsGenerated: 17,
      documentsStored: 17,
      durationMs: 142,
    },
    errors: [],
    completedAt: new Date(),
  };
}

function failedResult(name: string, message: string): IndexResult {
  return {
    status: "failed",
    repository: name,
    collectionName: "",
    stats: {
      filesScanned: 0,
      filesProcessed: 0,
      filesFailed: 0,
      chunksCreated: 0,
      embeddingsGenerated: 0,
      documentsStored: 0,
      durationMs: 1,
    },
    errors: [{ type: "fatal_error", message, originalError: new Error(message) }],
    completedAt: new Date(),
  };
}

function makeIngestionStub(result: IndexResult): IngestionService {
  return {
    indexRepository: mock(async () => result),
  } as unknown as IngestionService;
}

function makeMetadataStub(repo?: RepositoryInfo): RepositoryMetadataService {
  return {
    getRepository: mock(async (name: string) =>
      repo && repo.name === name ? repo : null
    ),
    listRepositories: mock(async () => (repo ? [repo] : [])),
    updateRepository: mock(async () => undefined),
    removeRepository: mock(async () => undefined),
  } as unknown as RepositoryMetadataService;
}

function makeCoordinatorStub(): LocalFolderUpdateCoordinator & {
  startWatching: ReturnType<typeof mock>;
  stopWatching: ReturnType<typeof mock>;
} {
  return {
    startWatching: mock(async () => undefined),
    stopWatching: mock(async () => undefined),
    updateRepository: mock(async () => ({}) as any),
  } as any;
}

function makeJobTrackerStub(): JobTracker & {
  createJob: ReturnType<typeof mock>;
  updateStatus: ReturnType<typeof mock>;
  complete: ReturnType<typeof mock>;
  fail: ReturnType<typeof mock>;
} {
  return {
    createJob: mock((repo: string) => `job-${repo}-${Date.now()}`),
    updateStatus: mock(() => undefined),
    complete: mock(() => undefined),
    fail: mock(() => undefined),
    timeout: mock(() => undefined),
    getRunningJob: mock(() => null),
    getJobResponse: mock(() => null),
  } as any;
}

function parseTextResponse(content: TextContent[]): Record<string, unknown> {
  const text = content[0]?.type === "text" ? content[0].text : "";
  return JSON.parse(text) as Record<string, unknown>;
}

describe("register_local_folder MCP tool", () => {
  beforeEach(() => initializeLogger({ level: "silent", format: "json" }));
  afterEach(() => resetLogger());

  describe("tool definition", () => {
    it("declares the expected name and required `path` argument", () => {
      expect(registerLocalFolderToolDefinition.name).toBe("register_local_folder");
      expect(registerLocalFolderToolDefinition.inputSchema.required).toEqual(["path"]);
      const props = registerLocalFolderToolDefinition.inputSchema.properties as Record<
        string,
        { type: string }
      >;
      expect(props["path"]?.type).toBe("string");
      expect(props["watch"]?.type).toBe("boolean");
      expect(props["followSymlinks"]?.type).toBe("boolean");
      expect(props["tier"]?.type).toBe("string");
      expect(props["async"]?.type).toBe("boolean");
    });
  });

  describe("argument validation", () => {
    const handler = createRegisterLocalFolderHandler({
      ingestionService: makeIngestionStub(successResult("ignored")),
      repositoryService: makeMetadataStub(),
    });

    it("rejects missing path", async () => {
      const result = await handler({});
      expect(result.isError).toBe(true);
      const body = parseTextResponse(result.content as TextContent[]);
      expect(body["error"]).toBe("invalid_argument");
      expect(String(body["message"])).toContain("path");
    });

    it("rejects empty path string", async () => {
      const result = await handler({ path: "  " });
      expect(result.isError).toBe(true);
      const body = parseTextResponse(result.content as TextContent[]);
      expect(body["error"]).toBe("invalid_argument");
    });
  });

  describe("sync mode", () => {
    it("returns a `registered` response on successful indexing", async () => {
      const ingestion = makeIngestionStub(successResult("my-folder"));
      const metadata = makeMetadataStub({
        name: "my-folder",
        source: "local-folder",
        url: null,
        localPath: "C:/some/path",
        collectionName: "repo_my_folder",
        fileCount: 5,
        chunkCount: 17,
        lastIndexedAt: new Date().toISOString(),
        indexDurationMs: 142,
        status: "ready",
        branch: "(local-folder)",
        includeExtensions: [".ts"],
        excludePatterns: [],
        tier: "private",
      });
      const coordinator = makeCoordinatorStub();

      const handler = createRegisterLocalFolderHandler({
        ingestionService: ingestion,
        localFolderCoordinator: coordinator,
        repositoryService: metadata,
      });

      const result = await handler({ path: "C:/some/path", watch: true });

      expect(result.isError).toBe(false);
      const body = parseTextResponse(result.content as TextContent[]);
      expect(body["success"]).toBe(true);
      expect(body["repository"]).toBe("my-folder");
      expect(body["status"]).toBe("registered");
      expect(body["files_processed"]).toBe(5);
      expect(body["chunks_created"]).toBe(17);
      expect(body["watch_enabled"]).toBe(true);

      // Coordinator.startWatching invoked exactly once with the resolved repo.
      expect((coordinator.startWatching as any).mock.calls.length).toBe(1);
    });

    it("does NOT call startWatching when watch=false", async () => {
      const ingestion = makeIngestionStub(successResult("no-watch-folder"));
      const metadata = makeMetadataStub({
        name: "no-watch-folder",
        source: "local-folder",
        url: null,
        localPath: "C:/some/path",
        collectionName: "repo_no_watch_folder",
        fileCount: 1,
        chunkCount: 1,
        lastIndexedAt: new Date().toISOString(),
        indexDurationMs: 1,
        status: "ready",
        branch: "(local-folder)",
        includeExtensions: [".ts"],
        excludePatterns: [],
        tier: "private",
      });
      const coordinator = makeCoordinatorStub();
      const handler = createRegisterLocalFolderHandler({
        ingestionService: ingestion,
        localFolderCoordinator: coordinator,
        repositoryService: metadata,
      });

      await handler({ path: "C:/some/path", watch: false });

      expect((coordinator.startWatching as any).mock.calls.length).toBe(0);
    });

    it("surfaces a `registration_failed` error with the typed error message when IngestionService returns failed", async () => {
      const ingestion = makeIngestionStub(failedResult("doomed", "size guardrail tripped"));
      const handler = createRegisterLocalFolderHandler({
        ingestionService: ingestion,
        repositoryService: makeMetadataStub(),
      });

      const result = await handler({ path: "C:/big/folder" });

      expect(result.isError).toBe(true);
      const body = parseTextResponse(result.content as TextContent[]);
      expect(body["error"]).toBe("registration_failed");
      expect(String(body["message"])).toContain("size guardrail");
    });
  });

  describe("async mode", () => {
    it("returns a job ID immediately when async=true and JobTracker is wired", async () => {
      const ingestion = makeIngestionStub(successResult("async-folder"));
      const metadata = makeMetadataStub({
        name: "async-folder",
        source: "local-folder",
        url: null,
        localPath: "C:/async/path",
        collectionName: "repo_async_folder",
        fileCount: 1,
        chunkCount: 1,
        lastIndexedAt: new Date().toISOString(),
        indexDurationMs: 5,
        status: "ready",
        branch: "(local-folder)",
        includeExtensions: [".ts"],
        excludePatterns: [],
        tier: "private",
      });
      const tracker = makeJobTrackerStub();

      const handler = createRegisterLocalFolderHandler({
        ingestionService: ingestion,
        repositoryService: metadata,
        jobTracker: tracker,
      });

      const result = await handler({ path: "C:/async/path", async: true });
      expect(result.isError).toBe(false);
      const body = parseTextResponse(result.content as TextContent[]);
      expect(body["async"]).toBe(true);
      expect(body["job_id"]).toBeTruthy();
      expect((tracker.createJob as any).mock.calls.length).toBe(1);

      // Allow the fire-and-forget background worker to settle.
      await new Promise((r) => setTimeout(r, 20));
      expect((tracker.complete as any).mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    it("falls back to sync when async=true but no JobTracker was wired", async () => {
      const ingestion = makeIngestionStub(successResult("sync-fallback"));
      const handler = createRegisterLocalFolderHandler({
        ingestionService: ingestion,
        repositoryService: makeMetadataStub(),
        // jobTracker omitted
      });

      const result = await handler({ path: "C:/sync/path", async: true });
      const body = parseTextResponse(result.content as TextContent[]);
      // Sync response shape — no async:true field.
      expect(body["async"]).toBeUndefined();
      expect(body["status"]).toBe("registered");
    });
  });
});
