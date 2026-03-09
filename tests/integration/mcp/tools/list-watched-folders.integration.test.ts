/**
 * Integration tests for list_watched_folders MCP tool
 *
 * Tests the full integration path: MCP handler -> ListWatchedFoldersServiceImpl
 * -> FolderWatcherService -> real filesystem with temporary directories.
 *
 * No external services (ChromaDB, Neo4j, etc.) are required -- these tests
 * operate entirely against temp directories created during the test run.
 *
 * @module tests/integration/mcp/tools/list-watched-folders.integration.test
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { FolderWatcherService } from "../../../../src/services/folder-watcher-service.js";
import { ListWatchedFoldersServiceImpl } from "../../../../src/services/list-watched-folders-service.js";
import { createListWatchedFoldersHandler } from "../../../../src/mcp/tools/list-watched-folders.js";
import type { WatchedFolder } from "../../../../src/services/folder-watcher-types.js";
import { initializeLogger, resetLogger } from "../../../../src/logging/index.js";

// Generous timeout for filesystem operations -- CI environments can be slow
const TEST_TIMEOUT = 30000;

/**
 * Create a WatchedFolder configuration for testing.
 *
 * Generates a unique ID per call to prevent collisions between tests.
 */
function createTestFolder(basePath: string, overrides: Partial<WatchedFolder> = {}): WatchedFolder {
  return {
    id: `test-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    path: basePath,
    name: "Test Folder",
    enabled: true,
    includePatterns: null,
    excludePatterns: null,
    debounceMs: 200,
    createdAt: new Date(),
    lastScanAt: null,
    fileCount: 0,
    updatedAt: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Logger lifecycle
// ---------------------------------------------------------------------------

beforeAll(() => {
  initializeLogger({ level: "silent", format: "json" });
});

afterAll(() => {
  resetLogger();
});

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("list_watched_folders MCP Tool Integration Tests", () => {
  /** Root temp directory created once per suite run */
  let testBaseDir: string;

  /** FolderWatcherService instance -- recreated per test */
  let folderWatcherService: FolderWatcherService;

  /** MCP tool handler under test -- recreated per test */
  let handler: ReturnType<typeof createListWatchedFoldersHandler>;

  // -------------------------------------------------------------------------
  // Suite-level setup / teardown
  // -------------------------------------------------------------------------

  beforeAll(async () => {
    testBaseDir = path.join(os.tmpdir(), `list-watched-folders-integration-${Date.now()}`);
    await fs.promises.mkdir(testBaseDir, { recursive: true });
  });

  afterAll(async () => {
    try {
      await fs.promises.rm(testBaseDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors -- temp directory may already be gone
    }
  });

  // -------------------------------------------------------------------------
  // Per-test setup / teardown
  // -------------------------------------------------------------------------

  beforeEach(() => {
    folderWatcherService = new FolderWatcherService({
      defaultDebounceMs: 200,
      maxConcurrentWatchers: 10,
    });

    const service = new ListWatchedFoldersServiceImpl(folderWatcherService);
    handler = createListWatchedFoldersHandler(service);
  });

  afterEach(async () => {
    // Ensure all watchers are stopped so file handles are released
    await folderWatcherService.stopAllWatchers();
  });

  // -------------------------------------------------------------------------
  // Helper: create a unique sub-directory inside the suite temp dir
  // -------------------------------------------------------------------------

  async function createTempSubDir(suffix: string): Promise<string> {
    const dir = path.join(
      testBaseDir,
      `${suffix}-${Date.now()}-${Math.random().toString(36).substring(7)}`
    );
    await fs.promises.mkdir(dir, { recursive: true });
    return dir;
  }

  /**
   * Parse the JSON body out of a successful handler result.
   *
   * The handler returns `{ content: [{ type: "text", text: "..." }], isError: false }`.
   * This helper extracts and parses that JSON text.
   */
  function parseHandlerResult(result: any): any {
    expect(result).toBeDefined();
    expect(result.isError).toBe(false);
    expect(result.content).toBeArray();
    expect(result.content.length).toBeGreaterThanOrEqual(1);

    const textContent = result.content[0];
    expect(textContent.type).toBe("text");
    expect(typeof textContent.text).toBe("string");

    return JSON.parse(textContent.text);
  }

  // =========================================================================
  // Test cases
  // =========================================================================

  // ---- 1. Single active folder --------------------------------------------

  it(
    "should return a single active folder when one folder is being watched",
    async () => {
      const dir = await createTempSubDir("single");
      const folder = createTestFolder(dir, { name: "My Single Folder" });

      await folderWatcherService.startWatching(folder);

      const result = await handler({});
      const parsed = parseHandlerResult(result);

      expect(parsed.folders).toBeArray();
      expect(parsed.folders).toHaveLength(1);

      const entry = parsed.folders[0];
      expect(entry.id).toBe(folder.id);
      expect(entry.name).toBe("My Single Folder");
      expect(entry.path).toBe(dir);
      expect(entry.enabled).toBe(true);
      expect(entry.watcherStatus).toBe("active");
      expect(entry.includePatterns).toEqual([]);
      expect(entry.excludePatterns).toEqual([]);
    },
    TEST_TIMEOUT
  );

  // ---- 2. Multiple folders ------------------------------------------------

  it(
    "should return multiple folders when several directories are watched",
    async () => {
      const dirA = await createTempSubDir("multi-a");
      const dirB = await createTempSubDir("multi-b");

      const folderA = createTestFolder(dirA, { name: "Folder A" });
      const folderB = createTestFolder(dirB, { name: "Folder B" });

      await folderWatcherService.startWatching(folderA);
      await folderWatcherService.startWatching(folderB);

      const result = await handler({});
      const parsed = parseHandlerResult(result);

      expect(parsed.folders).toBeArray();
      expect(parsed.folders).toHaveLength(2);

      // Collect returned IDs for order-independent assertions
      const ids = parsed.folders.map((f: any) => f.id);
      expect(ids).toContain(folderA.id);
      expect(ids).toContain(folderB.id);

      // Verify each folder has correct details
      const entryA = parsed.folders.find((f: any) => f.id === folderA.id);
      const entryB = parsed.folders.find((f: any) => f.id === folderB.id);

      expect(entryA.name).toBe("Folder A");
      expect(entryA.path).toBe(dirA);
      expect(entryA.watcherStatus).toBe("active");

      expect(entryB.name).toBe("Folder B");
      expect(entryB.path).toBe(dirB);
      expect(entryB.watcherStatus).toBe("active");
    },
    TEST_TIMEOUT
  );

  // ---- 3. Empty folder list -----------------------------------------------

  it(
    "should return an empty folders array when no folders are watched",
    async () => {
      const result = await handler({});
      const parsed = parseHandlerResult(result);

      expect(parsed.folders).toBeArray();
      expect(parsed.folders).toHaveLength(0);
    },
    TEST_TIMEOUT
  );

  // ---- 4. Response format validation --------------------------------------

  it(
    "should include all required fields in each folder entry",
    async () => {
      const dir = await createTempSubDir("format-check");
      const folder = createTestFolder(dir);

      await folderWatcherService.startWatching(folder);

      const result = await handler({});
      const parsed = parseHandlerResult(result);

      expect(parsed.folders).toHaveLength(1);

      const entry = parsed.folders[0];

      // Verify every field from the WatchedFolderEntry interface is present
      const requiredFields = [
        "id",
        "name",
        "path",
        "enabled",
        "documentCount",
        "imageCount",
        "watcherStatus",
        "includePatterns",
        "excludePatterns",
      ];

      for (const field of requiredFields) {
        expect(entry).toHaveProperty(field);
      }

      // Type checks on individual fields
      expect(typeof entry.id).toBe("string");
      expect(typeof entry.name).toBe("string");
      expect(typeof entry.path).toBe("string");
      expect(typeof entry.enabled).toBe("boolean");
      expect(typeof entry.documentCount).toBe("number");
      expect(typeof entry.imageCount).toBe("number");
      expect(typeof entry.watcherStatus).toBe("string");
      expect(Array.isArray(entry.includePatterns)).toBe(true);
      expect(Array.isArray(entry.excludePatterns)).toBe(true);
    },
    TEST_TIMEOUT
  );

  // ---- 5. Handler with no / undefined / null arguments --------------------

  describe("handler argument flexibility", () => {
    it(
      "should succeed when called with an empty object",
      async () => {
        const result = await handler({});
        const parsed = parseHandlerResult(result);

        expect(parsed.folders).toBeArray();
      },
      TEST_TIMEOUT
    );

    it(
      "should succeed when called with undefined",
      async () => {
        const result = await handler(undefined);
        const parsed = parseHandlerResult(result);

        expect(parsed.folders).toBeArray();
      },
      TEST_TIMEOUT
    );

    it(
      "should succeed when called with null",
      async () => {
        const result = await handler(null);
        const parsed = parseHandlerResult(result);

        expect(parsed.folders).toBeArray();
      },
      TEST_TIMEOUT
    );
  });

  // ---- 6. Folder with include and exclude patterns -------------------------

  it(
    "should surface include and exclude patterns in the response",
    async () => {
      const dir = await createTempSubDir("patterns");
      const folder = createTestFolder(dir, {
        name: "Patterned Folder",
        includePatterns: ["*.md", "*.txt", "*.pdf"],
        excludePatterns: ["node_modules/**", ".git/**"],
      });

      await folderWatcherService.startWatching(folder);

      const result = await handler({});
      const parsed = parseHandlerResult(result);

      expect(parsed.folders).toHaveLength(1);

      const entry = parsed.folders[0];
      expect(entry.includePatterns).toEqual(["*.md", "*.txt", "*.pdf"]);
      expect(entry.excludePatterns).toEqual(["node_modules/**", ".git/**"]);
    },
    TEST_TIMEOUT
  );

  // ---- 7. documentCount and imageCount are always 0 -----------------------

  it(
    "should return documentCount and imageCount as 0 (not yet implemented)",
    async () => {
      const dir = await createTempSubDir("counts");
      const folder = createTestFolder(dir);

      await folderWatcherService.startWatching(folder);

      const result = await handler({});
      const parsed = parseHandlerResult(result);

      expect(parsed.folders).toHaveLength(1);

      const entry = parsed.folders[0];
      expect(entry.documentCount).toBe(0);
      expect(entry.imageCount).toBe(0);
    },
    TEST_TIMEOUT
  );

  // ---- 8. Performance: handler responds within 500ms ----------------------

  it(
    "should respond within 500ms",
    async () => {
      // Set up a couple of folders to ensure it is not trivially empty
      const dirA = await createTempSubDir("perf-a");
      const dirB = await createTempSubDir("perf-b");

      await folderWatcherService.startWatching(createTestFolder(dirA, { name: "Perf A" }));
      await folderWatcherService.startWatching(createTestFolder(dirB, { name: "Perf B" }));

      const start = performance.now();
      const result = await handler({});
      const elapsed = performance.now() - start;

      // Validate result to ensure it actually completed
      const parsed = parseHandlerResult(result);
      expect(parsed.folders).toHaveLength(2);

      expect(elapsed).toBeLessThan(500);
    },
    TEST_TIMEOUT
  );

  // ---- 9. Error handling: invalid arguments (non-object) ------------------

  describe("error handling for invalid arguments", () => {
    it(
      "should return isError response when called with a string",
      async () => {
        const result = await handler("invalid-args" as any);

        expect(result).toBeDefined();
        expect(result.isError).toBe(true);
        expect(result.content).toBeArray();
        expect(result.content.length).toBeGreaterThanOrEqual(1);
        expect(result.content[0]!.type).toBe("text");
        expect((result.content[0] as any).text).toContain("Error");
      },
      TEST_TIMEOUT
    );

    it(
      "should return isError response when called with a number",
      async () => {
        const result = await handler(42 as any);

        expect(result).toBeDefined();
        expect(result.isError).toBe(true);
        expect(result.content).toBeArray();
        expect(result.content[0]!.type).toBe("text");
        expect((result.content[0] as any).text).toContain("Error");
      },
      TEST_TIMEOUT
    );

    it(
      "should return isError response when called with a boolean",
      async () => {
        const result = await handler(true as any);

        expect(result).toBeDefined();
        expect(result.isError).toBe(true);
        expect(result.content).toBeArray();
        expect(result.content[0]!.type).toBe("text");
        expect((result.content[0] as any).text).toContain("Error");
      },
      TEST_TIMEOUT
    );
  });

  // ---- 10. lastScanAt is null / undefined for fresh folders ----------------

  it(
    "should report lastScanAt as null or undefined for a newly created watcher",
    async () => {
      const dir = await createTempSubDir("last-scan");
      const folder = createTestFolder(dir, { lastScanAt: null });

      await folderWatcherService.startWatching(folder);

      const result = await handler({});
      const parsed = parseHandlerResult(result);

      expect(parsed.folders).toHaveLength(1);

      const entry = parsed.folders[0];
      // The service maps null lastScanAt to undefined; JSON.stringify drops undefined,
      // so the field is either null or absent from the serialized output.
      const lastScan = entry.lastScanAt ?? null;
      expect(lastScan).toBeNull();
    },
    TEST_TIMEOUT
  );

  // ---- 11. Enabled flag is preserved in response --------------------------
  // Note: only enabled=true is tested here because FolderWatcherService.startWatching()
  // requires an active watcher. Testing enabled=false would require a different setup
  // path (e.g. loading persisted config) which is beyond the scope of this integration test.

  it(
    "should preserve the enabled flag from the folder configuration",
    async () => {
      const dir = await createTempSubDir("enabled-flag");
      const folder = createTestFolder(dir, { enabled: true });

      await folderWatcherService.startWatching(folder);

      const result = await handler({});
      const parsed = parseHandlerResult(result);

      expect(parsed.folders).toHaveLength(1);
      expect(parsed.folders[0].enabled).toBe(true);
    },
    TEST_TIMEOUT
  );

  // ---- 12. Folder ID is unique per entry ----------------------------------

  it(
    "should return unique IDs for each folder entry",
    async () => {
      const dirA = await createTempSubDir("unique-id-a");
      const dirB = await createTempSubDir("unique-id-b");
      const dirC = await createTempSubDir("unique-id-c");

      await folderWatcherService.startWatching(createTestFolder(dirA, { name: "A" }));
      await folderWatcherService.startWatching(createTestFolder(dirB, { name: "B" }));
      await folderWatcherService.startWatching(createTestFolder(dirC, { name: "C" }));

      const result = await handler({});
      const parsed = parseHandlerResult(result);

      expect(parsed.folders).toHaveLength(3);

      const ids = parsed.folders.map((f: any) => f.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(3);
    },
    TEST_TIMEOUT
  );

  // ---- 13. Null patterns are mapped to empty arrays -----------------------

  it(
    "should map null include/exclude patterns to empty arrays",
    async () => {
      const dir = await createTempSubDir("null-patterns");
      const folder = createTestFolder(dir, {
        includePatterns: null,
        excludePatterns: null,
      });

      await folderWatcherService.startWatching(folder);

      const result = await handler({});
      const parsed = parseHandlerResult(result);

      expect(parsed.folders).toHaveLength(1);

      const entry = parsed.folders[0];
      expect(entry.includePatterns).toEqual([]);
      expect(entry.excludePatterns).toEqual([]);
    },
    TEST_TIMEOUT
  );

  // ---- 14. Handler result wraps content in MCP TextContent format ----------

  it(
    "should return a valid MCP CallToolResult structure",
    async () => {
      const result = await handler({});

      // Top-level CallToolResult shape
      expect(result).toHaveProperty("content");
      expect(result).toHaveProperty("isError");
      expect(result.isError).toBe(false);

      // Content array with TextContent element
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content.length).toBe(1);
      expect(result.content[0]).toHaveProperty("type", "text");
      expect(result.content[0]).toHaveProperty("text");

      // Text must be valid JSON
      expect(() => JSON.parse((result.content[0] as any).text)).not.toThrow();
    },
    TEST_TIMEOUT
  );
});
