/**
 * Unit tests for search_images MCP tool
 *
 * Tests tool definition, handler execution, response formatting, and error handling
 * with mocked ImageSearchService dependencies.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import type {
  ImageSearchService,
  ImageSearchResponse,
  ImageSearchQuery,
} from "../../../src/services/image-search-types.js";
import {
  searchImagesToolDefinition,
  createSearchImagesHandler,
} from "../../../src/mcp/tools/search-images.js";
import { initializeLogger, resetLogger } from "../../../src/logging/index.js";
import type { TextContent } from "@modelcontextprotocol/sdk/types.js";

/** Helper interface for JSON Schema property testing */
interface JsonSchemaProperty {
  type?: string;
  minimum?: number;
  maximum?: number;
  default?: unknown;
  description?: string;
  items?: { type?: string; enum?: string[] };
  enum?: string[];
}

/** Helper interface for search_images tool response */
interface ImageSearchResultJSON {
  path: string;
  filename: string;
  format: string;
  width: number;
  height: number;
  sizeBytes: number;
  dateTaken?: string;
  dateModified: string;
  exif?: {
    camera?: string;
    orientation?: number;
    gpsLatitude?: number;
    gpsLongitude?: number;
  };
  folder: string;
}

interface ImageSearchResponseJSON {
  results: ImageSearchResultJSON[];
  metadata: {
    totalResults: number;
    queryTimeMs: number;
  };
}

/** Mock ImageSearchService */
class MockImageSearchService implements ImageSearchService {
  private mockResponse: ImageSearchResponse | null = null;
  private shouldFail = false;
  private failureError: Error | null = null;
  public lastQuery: ImageSearchQuery | null = null;

  async searchImages(query: ImageSearchQuery): Promise<ImageSearchResponse> {
    this.lastQuery = query;

    if (this.shouldFail && this.failureError) {
      throw this.failureError;
    }

    return (
      this.mockResponse || {
        results: [],
        metadata: {
          totalResults: 0,
          queryTimeMs: 50,
        },
      }
    );
  }

  setMockResponse(response: ImageSearchResponse): void {
    this.mockResponse = response;
  }

  setShouldFail(shouldFail: boolean, error?: Error): void {
    this.shouldFail = shouldFail;
    this.failureError = error || null;
  }
}

describe("search_images Tool", () => {
  beforeEach(() => {
    initializeLogger({ level: "silent", format: "json" });
  });

  afterEach(() => {
    resetLogger();
  });

  describe("tool definition", () => {
    it("should have correct name", () => {
      expect(searchImagesToolDefinition.name).toBe("search_images");
    });

    it("should have helpful description", () => {
      expect(searchImagesToolDefinition.description).toBeDefined();
      expect(searchImagesToolDefinition.description!.length).toBeGreaterThan(50);
    });

    it("should define input schema", () => {
      expect(searchImagesToolDefinition.inputSchema).toBeDefined();
      expect(searchImagesToolDefinition.inputSchema.type).toBe("object");
    });

    it("should not require any parameters", () => {
      expect(searchImagesToolDefinition.inputSchema.required).toBeUndefined();
    });

    it("should define format property as array with enum", () => {
      const formatProp = searchImagesToolDefinition.inputSchema.properties![
        "format"
      ] as JsonSchemaProperty;
      expect(formatProp.type).toBe("array");
      expect(formatProp.items?.enum).toContain("jpeg");
      expect(formatProp.items?.enum).toContain("png");
      expect(formatProp.items?.enum).toContain("gif");
      expect(formatProp.items?.enum).toContain("webp");
      expect(formatProp.items?.enum).toContain("tiff");
      expect(formatProp.items?.enum).toContain("all");
      expect(formatProp.default).toEqual(["all"]);
    });

    it("should define folder property", () => {
      const folderProp = searchImagesToolDefinition.inputSchema.properties![
        "folder"
      ] as JsonSchemaProperty;
      expect(folderProp.type).toBe("string");
    });

    it("should define date_from and date_to properties", () => {
      const dateFromProp = searchImagesToolDefinition.inputSchema.properties![
        "date_from"
      ] as JsonSchemaProperty;
      const dateToProp = searchImagesToolDefinition.inputSchema.properties![
        "date_to"
      ] as JsonSchemaProperty;
      expect(dateFromProp.type).toBe("string");
      expect(dateToProp.type).toBe("string");
    });

    it("should define min_width and min_height properties", () => {
      const minWidthProp = searchImagesToolDefinition.inputSchema.properties![
        "min_width"
      ] as JsonSchemaProperty;
      const minHeightProp = searchImagesToolDefinition.inputSchema.properties![
        "min_height"
      ] as JsonSchemaProperty;
      expect(minWidthProp.type).toBe("integer");
      expect(minWidthProp.minimum).toBe(1);
      expect(minHeightProp.type).toBe("integer");
      expect(minHeightProp.minimum).toBe(1);
    });

    it("should define limit property with range", () => {
      const limitProp = searchImagesToolDefinition.inputSchema.properties![
        "limit"
      ] as JsonSchemaProperty;
      expect(limitProp.type).toBe("integer");
      expect(limitProp.minimum).toBe(1);
      expect(limitProp.maximum).toBe(100);
      expect(limitProp.default).toBe(20);
    });

    it("should define filename_pattern property", () => {
      const patternProp = searchImagesToolDefinition.inputSchema.properties![
        "filename_pattern"
      ] as JsonSchemaProperty;
      expect(patternProp.type).toBe("string");
    });
  });

  describe("createSearchImagesHandler", () => {
    let mockService: MockImageSearchService;

    beforeEach(() => {
      mockService = new MockImageSearchService();
    });

    describe("successful search", () => {
      it("should return results for valid query", async () => {
        const mockResponse: ImageSearchResponse = {
          results: [
            {
              path: "screenshots/dashboard.png",
              filename: "dashboard.png",
              format: "png",
              width: 1920,
              height: 1080,
              sizeBytes: 245760,
              dateModified: new Date("2026-01-15T10:30:00Z"),
              folder: "work-screenshots",
            },
          ],
          metadata: {
            totalResults: 1,
            queryTimeMs: 45,
          },
        };

        mockService.setMockResponse(mockResponse);
        const handler = createSearchImagesHandler(mockService);

        const result = await handler({
          format: ["png"],
          min_width: 800,
        });

        expect(result.isError).toBe(false);
        expect(result.content).toHaveLength(1);
        expect(result.content[0]!.type).toBe("text");

        const responseData = JSON.parse(
          (result.content[0] as TextContent).text
        ) as ImageSearchResponseJSON;
        expect(responseData.results).toHaveLength(1);
        expect(responseData.results[0]!.filename).toBe("dashboard.png");
        expect(responseData.results[0]!.width).toBe(1920);
        expect(responseData.metadata.totalResults).toBe(1);
      });

      it("should pass all parameters to ImageSearchService", async () => {
        const handler = createSearchImagesHandler(mockService);

        await handler({
          folder: "my-images",
          format: ["jpeg", "png"],
          date_from: "2026-01-01",
          date_to: "2026-01-31",
          min_width: 800,
          min_height: 600,
          filename_pattern: "screenshot*",
          limit: 10,
        });

        expect(mockService.lastQuery).not.toBeNull();
        expect(mockService.lastQuery?.folder).toBe("my-images");
        expect(mockService.lastQuery?.format).toEqual(["jpeg", "png"]);
        expect(mockService.lastQuery?.date_from).toBe("2026-01-01");
        expect(mockService.lastQuery?.date_to).toBe("2026-01-31");
        expect(mockService.lastQuery?.min_width).toBe(800);
        expect(mockService.lastQuery?.min_height).toBe(600);
        expect(mockService.lastQuery?.filename_pattern).toBe("screenshot*");
        expect(mockService.lastQuery?.limit).toBe(10);
      });

      it("should apply default values for optional parameters", async () => {
        const handler = createSearchImagesHandler(mockService);

        await handler({});

        expect(mockService.lastQuery?.format).toEqual(["all"]);
        expect(mockService.lastQuery?.limit).toBe(20);
      });

      it("should handle empty results gracefully", async () => {
        mockService.setMockResponse({
          results: [],
          metadata: {
            totalResults: 0,
            queryTimeMs: 30,
          },
        });

        const handler = createSearchImagesHandler(mockService);
        const result = await handler({});

        expect(result.isError).toBe(false);
        const responseData = JSON.parse(
          (result.content[0] as TextContent).text
        ) as ImageSearchResponseJSON;
        expect(responseData.results).toHaveLength(0);
        expect(responseData.metadata.totalResults).toBe(0);
      });

      it("should include EXIF data when present", async () => {
        const mockResponse: ImageSearchResponse = {
          results: [
            {
              path: "photos/vacation.jpg",
              filename: "vacation.jpg",
              format: "jpeg",
              width: 4032,
              height: 3024,
              sizeBytes: 3456789,
              dateTaken: new Date("2026-01-10T14:30:00Z"),
              dateModified: new Date("2026-01-10T14:30:00Z"),
              exif: {
                camera: "iPhone 15 Pro",
                orientation: 1,
              },
              folder: "personal-photos",
            },
          ],
          metadata: {
            totalResults: 1,
            queryTimeMs: 60,
          },
        };

        mockService.setMockResponse(mockResponse);
        const handler = createSearchImagesHandler(mockService);
        const result = await handler({ format: ["jpeg"] });

        const responseData = JSON.parse(
          (result.content[0] as TextContent).text
        ) as ImageSearchResponseJSON;
        expect(responseData.results[0]!.exif).toBeDefined();
        expect(responseData.results[0]!.exif!.camera).toBe("iPhone 15 Pro");
      });

      it("should omit EXIF data when not present", async () => {
        const mockResponse: ImageSearchResponse = {
          results: [
            {
              path: "diagrams/arch.png",
              filename: "arch.png",
              format: "png",
              width: 1024,
              height: 768,
              sizeBytes: 50000,
              dateModified: new Date("2026-01-15T10:00:00Z"),
              folder: "docs",
            },
          ],
          metadata: {
            totalResults: 1,
            queryTimeMs: 25,
          },
        };

        mockService.setMockResponse(mockResponse);
        const handler = createSearchImagesHandler(mockService);
        const result = await handler({});

        const responseData = JSON.parse(
          (result.content[0] as TextContent).text
        ) as ImageSearchResponseJSON;
        expect(responseData.results[0]!.exif).toBeUndefined();
      });
    });

    describe("error handling", () => {
      it("should handle service errors gracefully", async () => {
        mockService.setShouldFail(true, new Error("Storage connection failed"));
        const handler = createSearchImagesHandler(mockService);

        const result = await handler({});

        expect(result.isError).toBe(true);
        expect((result.content[0] as TextContent).text).toContain("Error:");
      });

      it("should handle invalid format values", async () => {
        const handler = createSearchImagesHandler(mockService);

        const result = await handler({
          format: ["invalid-format"],
        });

        expect(result.isError).toBe(true);
      });

      it("should handle invalid date_from format", async () => {
        const handler = createSearchImagesHandler(mockService);

        const result = await handler({
          date_from: "not-a-date",
        });

        expect(result.isError).toBe(true);
      });

      it("should handle invalid date_to format", async () => {
        const handler = createSearchImagesHandler(mockService);

        const result = await handler({
          date_to: "January 15 2026",
        });

        expect(result.isError).toBe(true);
      });

      it("should handle negative min_width", async () => {
        const handler = createSearchImagesHandler(mockService);

        const result = await handler({
          min_width: -1,
        });

        expect(result.isError).toBe(true);
      });

      it("should handle limit exceeding maximum", async () => {
        const handler = createSearchImagesHandler(mockService);

        const result = await handler({
          limit: 200,
        });

        expect(result.isError).toBe(true);
      });

      it("should reject extra unknown properties", async () => {
        const handler = createSearchImagesHandler(mockService);

        const result = await handler({
          unknown_param: "value",
        });

        expect(result.isError).toBe(true);
      });
    });

    describe("parameter handling", () => {
      it("should accept all valid format values", async () => {
        const handler = createSearchImagesHandler(mockService);

        await handler({
          format: ["jpeg", "png", "gif", "webp", "tiff"],
        });

        expect(mockService.lastQuery?.format).toEqual(["jpeg", "png", "gif", "webp", "tiff"]);
      });

      it("should trim whitespace from folder", async () => {
        const handler = createSearchImagesHandler(mockService);

        await handler({
          folder: "  my-folder  ",
        });

        expect(mockService.lastQuery?.folder).toBe("my-folder");
      });

      it("should accept valid date range", async () => {
        const handler = createSearchImagesHandler(mockService);

        await handler({
          date_from: "2026-01-01",
          date_to: "2026-12-31",
        });

        expect(mockService.lastQuery?.date_from).toBe("2026-01-01");
        expect(mockService.lastQuery?.date_to).toBe("2026-12-31");
      });
    });
  });
});
