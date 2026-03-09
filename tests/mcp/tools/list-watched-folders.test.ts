/**
 * Unit tests for list_watched_folders MCP tool
 *
 * Tests tool definition, handler execution, response formatting, and error handling
 * with mocked ListWatchedFoldersService dependencies.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import type {
  ListWatchedFoldersService,
  ListWatchedFoldersResponse,
} from "../../../src/services/list-watched-folders-types.js";
import {
  listWatchedFoldersToolDefinition,
  createListWatchedFoldersHandler,
} from "../../../src/mcp/tools/list-watched-folders.js";
import { initializeLogger, resetLogger } from "../../../src/logging/index.js";
import type { TextContent } from "@modelcontextprotocol/sdk/types.js";

/** Helper interface for the JSON response */
interface WatchedFolderJSON {
  id: string;
  name: string;
  path: string;
  enabled: boolean;
  documentCount: number;
  imageCount: number;
  lastScanAt?: string;
  watcherStatus: string;
  includePatterns: string[];
  excludePatterns: string[];
}

interface ListWatchedFoldersResponseJSON {
  folders: WatchedFolderJSON[];
}

/** Mock ListWatchedFoldersService */
class MockListWatchedFoldersService implements ListWatchedFoldersService {
  private mockResponse: ListWatchedFoldersResponse | null = null;
  private shouldFail = false;
  private failureError: Error | null = null;

  async listWatchedFolders(): Promise<ListWatchedFoldersResponse> {
    if (this.shouldFail && this.failureError) {
      throw this.failureError;
    }

    return (
      this.mockResponse || {
        folders: [],
      }
    );
  }

  setMockResponse(response: ListWatchedFoldersResponse): void {
    this.mockResponse = response;
  }

  setShouldFail(shouldFail: boolean, error?: Error): void {
    this.shouldFail = shouldFail;
    this.failureError = error || null;
  }
}

describe("list_watched_folders Tool", () => {
  beforeEach(() => {
    initializeLogger({ level: "silent", format: "json" });
  });

  afterEach(() => {
    resetLogger();
  });

  describe("tool definition", () => {
    it("should have correct name", () => {
      expect(listWatchedFoldersToolDefinition.name).toBe("list_watched_folders");
    });

    it("should have helpful description", () => {
      expect(listWatchedFoldersToolDefinition.description).toBeDefined();
      expect(listWatchedFoldersToolDefinition.description!.length).toBeGreaterThan(30);
    });

    it("should define input schema with no properties", () => {
      expect(listWatchedFoldersToolDefinition.inputSchema).toBeDefined();
      expect(listWatchedFoldersToolDefinition.inputSchema.type).toBe("object");
      expect(
        Object.keys(listWatchedFoldersToolDefinition.inputSchema.properties || {})
      ).toHaveLength(0);
    });

    it("should not require any parameters", () => {
      expect(listWatchedFoldersToolDefinition.inputSchema.required).toBeUndefined();
    });
  });

  describe("createListWatchedFoldersHandler", () => {
    let mockService: MockListWatchedFoldersService;

    beforeEach(() => {
      mockService = new MockListWatchedFoldersService();
    });

    describe("successful listing", () => {
      it("should return folders list", async () => {
        const mockResponse: ListWatchedFoldersResponse = {
          folders: [
            {
              id: "folder-1",
              name: "Study Notes",
              path: "/home/user/notes",
              enabled: true,
              documentCount: 42,
              imageCount: 5,
              lastScanAt: new Date("2026-01-15T10:00:00Z"),
              watcherStatus: "active",
              includePatterns: ["*.md", "*.pdf"],
              excludePatterns: [".git/**"],
            },
          ],
        };

        mockService.setMockResponse(mockResponse);
        const handler = createListWatchedFoldersHandler(mockService);

        const result = await handler({});

        expect(result.isError).toBe(false);
        expect(result.content).toHaveLength(1);
        expect(result.content[0]!.type).toBe("text");

        const responseData = JSON.parse(
          (result.content[0] as TextContent).text
        ) as ListWatchedFoldersResponseJSON;
        expect(responseData.folders).toHaveLength(1);
        expect(responseData.folders[0]!.name).toBe("Study Notes");
        expect(responseData.folders[0]!.documentCount).toBe(42);
        expect(responseData.folders[0]!.imageCount).toBe(5);
        expect(responseData.folders[0]!.watcherStatus).toBe("active");
      });

      it("should handle empty folder list", async () => {
        mockService.setMockResponse({ folders: [] });
        const handler = createListWatchedFoldersHandler(mockService);

        const result = await handler({});

        expect(result.isError).toBe(false);
        const responseData = JSON.parse(
          (result.content[0] as TextContent).text
        ) as ListWatchedFoldersResponseJSON;
        expect(responseData.folders).toHaveLength(0);
      });

      it("should include all folder metadata fields", async () => {
        const mockResponse: ListWatchedFoldersResponse = {
          folders: [
            {
              id: "folder-abc",
              name: "Work Docs",
              path: "C:\\Users\\dev\\work-docs",
              enabled: false,
              documentCount: 100,
              imageCount: 20,
              watcherStatus: "paused",
              includePatterns: ["*.docx", "*.pdf", "*.txt"],
              excludePatterns: ["temp/**", "*.tmp"],
            },
          ],
        };

        mockService.setMockResponse(mockResponse);
        const handler = createListWatchedFoldersHandler(mockService);
        const result = await handler({});

        const responseData = JSON.parse(
          (result.content[0] as TextContent).text
        ) as ListWatchedFoldersResponseJSON;

        const folder = responseData.folders[0]!;
        expect(folder.id).toBe("folder-abc");
        expect(folder.name).toBe("Work Docs");
        expect(folder.path).toBe("C:\\Users\\dev\\work-docs");
        expect(folder.enabled).toBe(false);
        expect(folder.documentCount).toBe(100);
        expect(folder.imageCount).toBe(20);
        expect(folder.watcherStatus).toBe("paused");
        expect(folder.includePatterns).toEqual(["*.docx", "*.pdf", "*.txt"]);
        expect(folder.excludePatterns).toEqual(["temp/**", "*.tmp"]);
      });

      it("should handle multiple folders", async () => {
        const mockResponse: ListWatchedFoldersResponse = {
          folders: [
            {
              id: "folder-1",
              name: "Notes",
              path: "/notes",
              enabled: true,
              documentCount: 10,
              imageCount: 0,
              watcherStatus: "active",
              includePatterns: [],
              excludePatterns: [],
            },
            {
              id: "folder-2",
              name: "Photos",
              path: "/photos",
              enabled: true,
              documentCount: 0,
              imageCount: 500,
              watcherStatus: "active",
              includePatterns: [],
              excludePatterns: [],
            },
          ],
        };

        mockService.setMockResponse(mockResponse);
        const handler = createListWatchedFoldersHandler(mockService);
        const result = await handler({});

        const responseData = JSON.parse(
          (result.content[0] as TextContent).text
        ) as ListWatchedFoldersResponseJSON;
        expect(responseData.folders).toHaveLength(2);
      });

      it("should accept empty object as args", async () => {
        const handler = createListWatchedFoldersHandler(mockService);
        const result = await handler({});

        expect(result.isError).toBe(false);
      });

      it("should accept undefined as args", async () => {
        const handler = createListWatchedFoldersHandler(mockService);
        const result = await handler(undefined);

        expect(result.isError).toBe(false);
      });
    });

    describe("error handling", () => {
      it("should handle service errors gracefully", async () => {
        mockService.setShouldFail(true, new Error("Database connection failed"));
        const handler = createListWatchedFoldersHandler(mockService);

        const result = await handler({});

        expect(result.isError).toBe(true);
        expect((result.content[0] as TextContent).text).toContain("Error:");
      });

      it("should not leak internal error details", async () => {
        mockService.setShouldFail(
          true,
          new Error("PostgreSQL error at /internal/path: connection refused")
        );
        const handler = createListWatchedFoldersHandler(mockService);

        const result = await handler({});

        expect(result.isError).toBe(true);
        expect((result.content[0] as TextContent).text).not.toContain("/internal/path");
        expect((result.content[0] as TextContent).text).not.toContain("PostgreSQL");
        expect((result.content[0] as TextContent).text).toBe(
          "Error: MCP error -32603: An unexpected error occurred."
        );
      });
    });
  });
});
