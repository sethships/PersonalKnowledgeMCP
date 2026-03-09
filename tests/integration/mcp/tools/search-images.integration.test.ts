/**
 * Integration tests for the search_images MCP tool handler
 *
 * These tests exercise the full MCP tool handler pipeline without external services:
 *   validation (real Zod schema) -> handler -> formatting -> error handling (real mapToMCPError)
 *
 * The only mock is the ImageSearchService layer, which has no implementation yet.
 * Everything else -- argument validation, error mapping, response formatting -- uses
 * the real production code, making these true integration tests of the MCP pipeline.
 *
 * No external service gating is required (no ChromaDB, FalkorDB, etc.).
 *
 * @module tests/integration/mcp/tools/search-images.integration
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createSearchImagesHandler } from "../../../../src/mcp/tools/search-images.js";
import type {
  ImageSearchService,
  ImageSearchResponse,
  ImageSearchQuery,
} from "../../../../src/services/image-search-types.js";
import { initializeLogger, resetLogger } from "../../../../src/logging/index.js";
import type { TextContent } from "@modelcontextprotocol/sdk/types.js";

/**
 * JSON representation of an image search result as returned in the MCP response.
 * Date fields are serialized as ISO strings by JSON.stringify.
 */
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

/** JSON representation of the full search_images MCP response */
interface ImageSearchResponseJSON {
  results: ImageSearchResultJSON[];
  metadata: {
    totalResults: number;
    queryTimeMs: number;
  };
}

/**
 * Mock ImageSearchService that captures received queries and returns
 * configurable responses. This is the only mock in the test -- all
 * validation, error mapping, and formatting use real production code.
 */
class MockImageSearchService implements ImageSearchService {
  /** The most recently received query, for assertion purposes */
  public lastQuery: ImageSearchQuery | null = null;

  /** History of all queries received during a test */
  public queryHistory: ImageSearchQuery[] = [];

  private mockResponse: ImageSearchResponse | null = null;
  private shouldFail = false;
  private failureError: Error | null = null;

  async searchImages(query: ImageSearchQuery): Promise<ImageSearchResponse> {
    this.lastQuery = query;
    this.queryHistory.push({ ...query });

    if (this.shouldFail && this.failureError) {
      throw this.failureError;
    }

    return (
      this.mockResponse ?? {
        results: [],
        metadata: {
          totalResults: 0,
          queryTimeMs: 10,
        },
      }
    );
  }

  /** Configure the response the mock will return on the next call */
  setMockResponse(response: ImageSearchResponse): void {
    this.mockResponse = response;
  }

  /** Configure the mock to throw an error on the next call */
  setShouldFail(shouldFail: boolean, error?: Error): void {
    this.shouldFail = shouldFail;
    this.failureError = error ?? null;
  }

  /** Reset the mock to its initial state */
  reset(): void {
    this.lastQuery = null;
    this.queryHistory = [];
    this.mockResponse = null;
    this.shouldFail = false;
    this.failureError = null;
  }
}

/**
 * Helper to parse the JSON text content from a CallToolResult.
 * Reduces boilerplate across test cases.
 */
function parseResponse(result: {
  content: Array<{ type: string; text?: string }>;
}): ImageSearchResponseJSON {
  const textContent = result.content[0] as TextContent;
  return JSON.parse(textContent.text) as ImageSearchResponseJSON;
}

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

/** A result with full EXIF data including GPS coordinates */
const RESULT_WITH_EXIF: ImageSearchResponse["results"][0] = {
  path: "photos/vacation/beach-sunset.jpg",
  filename: "beach-sunset.jpg",
  format: "jpeg",
  width: 4032,
  height: 3024,
  sizeBytes: 3_456_789,
  dateTaken: new Date("2026-01-10T18:30:00Z"),
  dateModified: new Date("2026-01-10T18:30:00Z"),
  exif: {
    camera: "iPhone 15 Pro",
    orientation: 1,
    gpsLatitude: 36.8529,
    gpsLongitude: -75.978,
  },
  folder: "personal-photos",
};

/** A result without EXIF data (e.g., a generated diagram) */
const RESULT_WITHOUT_EXIF: ImageSearchResponse["results"][0] = {
  path: "diagrams/architecture-v2.png",
  filename: "architecture-v2.png",
  format: "png",
  width: 1920,
  height: 1080,
  sizeBytes: 245_760,
  dateModified: new Date("2026-02-15T10:00:00Z"),
  folder: "project-docs",
};

describe("search_images MCP Tool - Integration Tests", () => {
  let mockService: MockImageSearchService;

  beforeAll(() => {
    initializeLogger({ level: "silent", format: "json" });
    mockService = new MockImageSearchService();
  });

  afterAll(() => {
    resetLogger();
  });

  // -----------------------------------------------------------------------
  // 1. Handler returns formatted results with all metadata fields
  // -----------------------------------------------------------------------
  describe("successful search with formatted results", () => {
    it("should return formatted results with all metadata fields for multiple results", async () => {
      const mockResponse: ImageSearchResponse = {
        results: [RESULT_WITH_EXIF, RESULT_WITHOUT_EXIF],
        metadata: {
          totalResults: 2,
          queryTimeMs: 85,
        },
      };

      mockService.reset();
      mockService.setMockResponse(mockResponse);
      const handler = createSearchImagesHandler(mockService);

      const result = await handler({});

      // Verify MCP response envelope
      expect(result.isError).toBe(false);
      expect(result.content).toHaveLength(1);
      expect(result.content[0]!.type).toBe("text");

      // Parse and verify JSON structure
      const response = parseResponse(result);

      // Metadata assertions
      expect(response.metadata.totalResults).toBe(2);
      expect(response.metadata.queryTimeMs).toBe(85);

      // First result (with EXIF)
      const r1 = response.results[0]!;
      expect(r1.path).toBe("photos/vacation/beach-sunset.jpg");
      expect(r1.filename).toBe("beach-sunset.jpg");
      expect(r1.format).toBe("jpeg");
      expect(r1.width).toBe(4032);
      expect(r1.height).toBe(3024);
      expect(r1.sizeBytes).toBe(3_456_789);
      expect(r1.dateTaken).toBeDefined();
      expect(r1.dateModified).toBeDefined();
      expect(r1.folder).toBe("personal-photos");

      // Second result (no EXIF)
      const r2 = response.results[1]!;
      expect(r2.path).toBe("diagrams/architecture-v2.png");
      expect(r2.filename).toBe("architecture-v2.png");
      expect(r2.format).toBe("png");
      expect(r2.width).toBe(1920);
      expect(r2.height).toBe(1080);
      expect(r2.sizeBytes).toBe(245_760);
      expect(r2.folder).toBe("project-docs");
    });
  });

  // -----------------------------------------------------------------------
  // 2. Filter by format
  // -----------------------------------------------------------------------
  describe("filter by format", () => {
    it("should pass format filter to the service", async () => {
      mockService.reset();
      const handler = createSearchImagesHandler(mockService);

      await handler({ format: ["png"] });

      expect(mockService.lastQuery).not.toBeNull();
      expect(mockService.lastQuery!.format).toEqual(["png"]);
    });

    it("should pass multiple format values to the service", async () => {
      mockService.reset();
      const handler = createSearchImagesHandler(mockService);

      await handler({ format: ["jpeg", "webp", "tiff"] });

      expect(mockService.lastQuery!.format).toEqual(["jpeg", "webp", "tiff"]);
    });
  });

  // -----------------------------------------------------------------------
  // 3. Filter by date range
  // -----------------------------------------------------------------------
  describe("filter by date range", () => {
    it("should pass date_from and date_to to the service", async () => {
      mockService.reset();
      const handler = createSearchImagesHandler(mockService);

      await handler({
        date_from: "2026-01-01",
        date_to: "2026-06-30",
      });

      expect(mockService.lastQuery!.date_from).toBe("2026-01-01");
      expect(mockService.lastQuery!.date_to).toBe("2026-06-30");
    });

    it("should accept date_from alone", async () => {
      mockService.reset();
      const handler = createSearchImagesHandler(mockService);

      await handler({ date_from: "2025-12-01" });

      expect(mockService.lastQuery!.date_from).toBe("2025-12-01");
      expect(mockService.lastQuery!.date_to).toBeUndefined();
    });

    it("should accept date_to alone", async () => {
      mockService.reset();
      const handler = createSearchImagesHandler(mockService);

      await handler({ date_to: "2026-03-15" });

      expect(mockService.lastQuery!.date_from).toBeUndefined();
      expect(mockService.lastQuery!.date_to).toBe("2026-03-15");
    });

    it("should accept same date for date_from and date_to", async () => {
      mockService.reset();
      const handler = createSearchImagesHandler(mockService);

      const result = await handler({
        date_from: "2026-02-14",
        date_to: "2026-02-14",
      });

      expect(result.isError).toBe(false);
      expect(mockService.lastQuery!.date_from).toBe("2026-02-14");
      expect(mockService.lastQuery!.date_to).toBe("2026-02-14");
    });
  });

  // -----------------------------------------------------------------------
  // 4. Filter by minimum dimensions
  // -----------------------------------------------------------------------
  describe("filter by minimum dimensions", () => {
    it("should pass min_width and min_height to the service", async () => {
      mockService.reset();
      const handler = createSearchImagesHandler(mockService);

      await handler({ min_width: 800, min_height: 600 });

      expect(mockService.lastQuery!.min_width).toBe(800);
      expect(mockService.lastQuery!.min_height).toBe(600);
    });

    it("should accept min_width alone", async () => {
      mockService.reset();
      const handler = createSearchImagesHandler(mockService);

      await handler({ min_width: 1920 });

      expect(mockService.lastQuery!.min_width).toBe(1920);
      expect(mockService.lastQuery!.min_height).toBeUndefined();
    });

    it("should accept min_height alone", async () => {
      mockService.reset();
      const handler = createSearchImagesHandler(mockService);

      await handler({ min_height: 1080 });

      expect(mockService.lastQuery!.min_width).toBeUndefined();
      expect(mockService.lastQuery!.min_height).toBe(1080);
    });
  });

  // -----------------------------------------------------------------------
  // 5. Filter by filename pattern
  // -----------------------------------------------------------------------
  describe("filter by filename pattern", () => {
    it("should pass filename_pattern to the service", async () => {
      mockService.reset();
      const handler = createSearchImagesHandler(mockService);

      await handler({ filename_pattern: "screenshot*" });

      expect(mockService.lastQuery!.filename_pattern).toBe("screenshot*");
    });

    it("should trim whitespace from filename_pattern", async () => {
      mockService.reset();
      const handler = createSearchImagesHandler(mockService);

      await handler({ filename_pattern: "  *.diagram.*  " });

      expect(mockService.lastQuery!.filename_pattern).toBe("*.diagram.*");
    });
  });

  // -----------------------------------------------------------------------
  // 6. Limit enforcement
  // -----------------------------------------------------------------------
  describe("limit enforcement", () => {
    it("should pass limit to the service", async () => {
      mockService.reset();
      const handler = createSearchImagesHandler(mockService);

      await handler({ limit: 5 });

      expect(mockService.lastQuery!.limit).toBe(5);
    });

    it("should accept limit at minimum boundary (1)", async () => {
      mockService.reset();
      const handler = createSearchImagesHandler(mockService);

      const result = await handler({ limit: 1 });

      expect(result.isError).toBe(false);
      expect(mockService.lastQuery!.limit).toBe(1);
    });

    it("should accept limit at maximum boundary (100)", async () => {
      mockService.reset();
      const handler = createSearchImagesHandler(mockService);

      const result = await handler({ limit: 100 });

      expect(result.isError).toBe(false);
      expect(mockService.lastQuery!.limit).toBe(100);
    });
  });

  // -----------------------------------------------------------------------
  // 7. Empty results handling
  // -----------------------------------------------------------------------
  describe("empty results handling", () => {
    it("should return valid response structure with zero results", async () => {
      mockService.reset();
      mockService.setMockResponse({
        results: [],
        metadata: {
          totalResults: 0,
          queryTimeMs: 12,
        },
      });

      const handler = createSearchImagesHandler(mockService);
      const result = await handler({});

      expect(result.isError).toBe(false);

      const response = parseResponse(result);
      expect(response.results).toHaveLength(0);
      expect(response.results).toEqual([]);
      expect(response.metadata.totalResults).toBe(0);
      expect(response.metadata.queryTimeMs).toBe(12);
    });
  });

  // -----------------------------------------------------------------------
  // 8. EXIF data inclusion
  // -----------------------------------------------------------------------
  describe("EXIF data inclusion", () => {
    it("should include all EXIF fields in the response when present", async () => {
      mockService.reset();
      mockService.setMockResponse({
        results: [RESULT_WITH_EXIF],
        metadata: { totalResults: 1, queryTimeMs: 40 },
      });

      const handler = createSearchImagesHandler(mockService);
      const result = await handler({ format: ["jpeg"] });

      const response = parseResponse(result);
      const exif = response.results[0]!.exif;

      expect(exif).toBeDefined();
      expect(exif!.camera).toBe("iPhone 15 Pro");
      expect(exif!.orientation).toBe(1);
      expect(exif!.gpsLatitude).toBe(36.8529);
      expect(exif!.gpsLongitude).toBe(-75.978);
    });

    it("should include partial EXIF data when only some fields are present", async () => {
      mockService.reset();
      mockService.setMockResponse({
        results: [
          {
            ...RESULT_WITH_EXIF,
            exif: { camera: "Canon EOS R5" },
          },
        ],
        metadata: { totalResults: 1, queryTimeMs: 30 },
      });

      const handler = createSearchImagesHandler(mockService);
      const result = await handler({});

      const response = parseResponse(result);
      expect(response.results[0]!.exif).toBeDefined();
      expect(response.results[0]!.exif!.camera).toBe("Canon EOS R5");
      expect(response.results[0]!.exif!.orientation).toBeUndefined();
      expect(response.results[0]!.exif!.gpsLatitude).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // 9. EXIF data exclusion
  // -----------------------------------------------------------------------
  describe("EXIF data exclusion", () => {
    it("should omit the exif field entirely when not present on the result", async () => {
      mockService.reset();
      mockService.setMockResponse({
        results: [RESULT_WITHOUT_EXIF],
        metadata: { totalResults: 1, queryTimeMs: 20 },
      });

      const handler = createSearchImagesHandler(mockService);
      const result = await handler({});

      const response = parseResponse(result);
      expect(response.results[0]!.exif).toBeUndefined();

      // Also verify the key is not present in the raw JSON
      const rawText = (result.content[0] as TextContent).text;
      const rawParsed = JSON.parse(rawText);
      expect("exif" in rawParsed.results[0]).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // 10. Error handling - service failure
  // -----------------------------------------------------------------------
  describe("error handling - service failure", () => {
    it("should return isError true when the service throws a generic Error", async () => {
      mockService.reset();
      mockService.setShouldFail(true, new Error("Storage backend unavailable"));

      const handler = createSearchImagesHandler(mockService);
      const result = await handler({});

      expect(result.isError).toBe(true);
      expect(result.content).toHaveLength(1);
      expect(result.content[0]!.type).toBe("text");

      const errorText = (result.content[0] as TextContent).text;
      expect(errorText).toContain("Error:");
    });

    it("should not leak internal error details in the response", async () => {
      mockService.reset();
      mockService.setShouldFail(
        true,
        new Error("Connection refused at /internal/secret/path:5432")
      );

      const handler = createSearchImagesHandler(mockService);
      const result = await handler({});

      expect(result.isError).toBe(true);
      const errorText = (result.content[0] as TextContent).text;
      // mapToMCPError sanitizes generic Error messages
      expect(errorText).not.toContain("/internal/secret/path");
      expect(errorText).not.toContain("5432");
      expect(errorText).toContain("unexpected error occurred");
    });

    it("should handle non-Error thrown values gracefully", async () => {
      mockService.reset();
      // Override searchImages to throw a string instead of an Error
      const originalFn = mockService.searchImages.bind(mockService);
      mockService.searchImages = async (_query: ImageSearchQuery) => {
        throw "unexpected string error";
      };

      try {
        const handler = createSearchImagesHandler(mockService);
        const result = await handler({});

        expect(result.isError).toBe(true);
        const errorText = (result.content[0] as TextContent).text;
        expect(errorText).toContain("Error:");
      } finally {
        // Restore original function even if assertions fail
        mockService.searchImages = originalFn;
      }
    });
  });

  // -----------------------------------------------------------------------
  // 11. Error handling - invalid argument types
  // -----------------------------------------------------------------------
  describe("error handling - invalid argument types", () => {
    it("should return error when limit is a string instead of number", async () => {
      mockService.reset();
      const handler = createSearchImagesHandler(mockService);

      const result = await handler({ limit: "abc" as any });

      expect(result.isError).toBe(true);
      const errorText = (result.content[0] as TextContent).text;
      expect(errorText).toContain("Error:");
      // The validation McpError passes through mapToMCPError which sanitizes
      // generic Error instances, so we only verify the error flag is set
    });

    it("should return validation error for non-integer limit", async () => {
      mockService.reset();
      const handler = createSearchImagesHandler(mockService);

      const result = await handler({ limit: 5.5 });

      expect(result.isError).toBe(true);
    });

    it("should return validation error for limit of zero", async () => {
      mockService.reset();
      const handler = createSearchImagesHandler(mockService);

      const result = await handler({ limit: 0 });

      expect(result.isError).toBe(true);
    });

    it("should return validation error for limit exceeding maximum (101)", async () => {
      mockService.reset();
      const handler = createSearchImagesHandler(mockService);

      const result = await handler({ limit: 101 });

      expect(result.isError).toBe(true);
    });

    it("should return validation error for negative min_width", async () => {
      mockService.reset();
      const handler = createSearchImagesHandler(mockService);

      const result = await handler({ min_width: -1 });

      expect(result.isError).toBe(true);
    });

    it("should return validation error for min_width of zero", async () => {
      mockService.reset();
      const handler = createSearchImagesHandler(mockService);

      const result = await handler({ min_width: 0 });

      expect(result.isError).toBe(true);
    });

    it("should return validation error for min_height of zero", async () => {
      mockService.reset();
      const handler = createSearchImagesHandler(mockService);

      const result = await handler({ min_height: 0 });

      expect(result.isError).toBe(true);
    });

    it("should return validation error for invalid format value", async () => {
      mockService.reset();
      const handler = createSearchImagesHandler(mockService);

      const result = await handler({ format: ["bmp"] });

      expect(result.isError).toBe(true);
    });

    it("should reject unknown extra properties (strict schema)", async () => {
      mockService.reset();
      const handler = createSearchImagesHandler(mockService);

      const result = await handler({ unknown_property: "value" });

      expect(result.isError).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // 12. Error handling - invalid date format
  // -----------------------------------------------------------------------
  describe("error handling - invalid date format", () => {
    it("should return validation error for non-date string in date_from", async () => {
      mockService.reset();
      const handler = createSearchImagesHandler(mockService);

      const result = await handler({ date_from: "not-a-date" });

      expect(result.isError).toBe(true);
      const errorText = (result.content[0] as TextContent).text;
      expect(errorText).toContain("Error:");
    });

    it("should return validation error for incorrect date format in date_to", async () => {
      mockService.reset();
      const handler = createSearchImagesHandler(mockService);

      const result = await handler({ date_to: "January 15 2026" });

      expect(result.isError).toBe(true);
    });

    it("should return validation error for semantically invalid date (month 13)", async () => {
      mockService.reset();
      const handler = createSearchImagesHandler(mockService);

      const result = await handler({ date_from: "2026-13-01" });

      expect(result.isError).toBe(true);
    });

    it("should return validation error for impossible date (Feb 30)", async () => {
      mockService.reset();
      const handler = createSearchImagesHandler(mockService);

      const result = await handler({ date_to: "2026-02-30" });

      expect(result.isError).toBe(true);
    });

    it("should return validation error for date with extra characters", async () => {
      mockService.reset();
      const handler = createSearchImagesHandler(mockService);

      const result = await handler({ date_from: "2026-01-01T00:00:00Z" });

      expect(result.isError).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // 13. Error handling - date_from after date_to
  // -----------------------------------------------------------------------
  describe("error handling - inverted date range", () => {
    it("should return validation error when date_from is after date_to", async () => {
      mockService.reset();
      const handler = createSearchImagesHandler(mockService);

      const result = await handler({
        date_from: "2026-12-31",
        date_to: "2026-01-01",
      });

      expect(result.isError).toBe(true);
      const errorText = (result.content[0] as TextContent).text;
      expect(errorText).toContain("Error:");
    });

    it("should return validation error when dates are one day apart and inverted", async () => {
      mockService.reset();
      const handler = createSearchImagesHandler(mockService);

      const result = await handler({
        date_from: "2026-03-02",
        date_to: "2026-03-01",
      });

      expect(result.isError).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // 14. Performance
  // -----------------------------------------------------------------------
  describe("performance", () => {
    it("should complete handler + formatting within 500ms", async () => {
      mockService.reset();
      // Return a moderately sized result set to exercise formatting
      const results = Array.from({ length: 50 }, (_, i) => ({
        path: `folder/image-${i}.png`,
        filename: `image-${i}.png`,
        format: "png" as const,
        width: 1920,
        height: 1080,
        sizeBytes: 100_000 + i * 1000,
        dateModified: new Date("2026-01-15T10:00:00Z"),
        folder: "test-folder",
      }));

      mockService.setMockResponse({
        results,
        metadata: { totalResults: 50, queryTimeMs: 45 },
      });

      const handler = createSearchImagesHandler(mockService);
      const startTime = performance.now();
      const result = await handler({});
      const duration = performance.now() - startTime;

      expect(result.isError).toBe(false);
      expect(duration).toBeLessThan(500);

      // Verify all 50 results made it through
      const response = parseResponse(result);
      expect(response.results).toHaveLength(50);
    });
  });

  // -----------------------------------------------------------------------
  // 15. Default values
  // -----------------------------------------------------------------------
  describe("default values", () => {
    it("should apply defaults when called with empty object", async () => {
      mockService.reset();
      const handler = createSearchImagesHandler(mockService);

      const result = await handler({});

      expect(result.isError).toBe(false);
      expect(mockService.lastQuery).not.toBeNull();

      // Verify Zod schema defaults are applied
      expect(mockService.lastQuery!.format).toEqual(["all"]);
      expect(mockService.lastQuery!.limit).toBe(20);

      // Verify optional fields without defaults remain undefined
      expect(mockService.lastQuery!.folder).toBeUndefined();
      expect(mockService.lastQuery!.date_from).toBeUndefined();
      expect(mockService.lastQuery!.date_to).toBeUndefined();
      expect(mockService.lastQuery!.min_width).toBeUndefined();
      expect(mockService.lastQuery!.min_height).toBeUndefined();
      expect(mockService.lastQuery!.filename_pattern).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Combined parameter pipeline tests
  // -----------------------------------------------------------------------
  describe("full parameter pipeline", () => {
    it("should pass all parameters through validation to the service", async () => {
      mockService.reset();
      const handler = createSearchImagesHandler(mockService);

      await handler({
        folder: "my-screenshots",
        format: ["png", "jpeg"],
        date_from: "2026-01-01",
        date_to: "2026-06-30",
        min_width: 1024,
        min_height: 768,
        filename_pattern: "screenshot*",
        limit: 25,
      });

      const query = mockService.lastQuery!;
      expect(query.folder).toBe("my-screenshots");
      expect(query.format).toEqual(["png", "jpeg"]);
      expect(query.date_from).toBe("2026-01-01");
      expect(query.date_to).toBe("2026-06-30");
      expect(query.min_width).toBe(1024);
      expect(query.min_height).toBe(768);
      expect(query.filename_pattern).toBe("screenshot*");
      expect(query.limit).toBe(25);
    });

    it("should trim whitespace from folder input", async () => {
      mockService.reset();
      const handler = createSearchImagesHandler(mockService);

      await handler({ folder: "  trimmed-folder  " });

      expect(mockService.lastQuery!.folder).toBe("trimmed-folder");
    });

    it("should accept all five valid format values at once", async () => {
      mockService.reset();
      const handler = createSearchImagesHandler(mockService);

      await handler({ format: ["jpeg", "png", "gif", "webp", "tiff"] });

      expect(mockService.lastQuery!.format).toEqual(["jpeg", "png", "gif", "webp", "tiff"]);
    });

    it("should accept the 'all' format value", async () => {
      mockService.reset();
      const handler = createSearchImagesHandler(mockService);

      await handler({ format: ["all"] });

      expect(mockService.lastQuery!.format).toEqual(["all"]);
    });
  });

  // -----------------------------------------------------------------------
  // MCP response structure consistency
  // -----------------------------------------------------------------------
  describe("response structure consistency", () => {
    it("should always return content array with exactly one text element on success", async () => {
      mockService.reset();
      mockService.setMockResponse({
        results: [RESULT_WITH_EXIF, RESULT_WITHOUT_EXIF],
        metadata: { totalResults: 2, queryTimeMs: 50 },
      });

      const handler = createSearchImagesHandler(mockService);
      const result = await handler({});

      expect(result.isError).toBe(false);
      expect(result.content).toHaveLength(1);
      expect(result.content[0]!.type).toBe("text");
    });

    it("should always return content array with exactly one text element on error", async () => {
      mockService.reset();
      mockService.setShouldFail(true, new Error("test error"));

      const handler = createSearchImagesHandler(mockService);
      const result = await handler({});

      expect(result.isError).toBe(true);
      expect(result.content).toHaveLength(1);
      expect(result.content[0]!.type).toBe("text");
    });

    it("should return valid JSON in the text content on success", async () => {
      mockService.reset();
      const handler = createSearchImagesHandler(mockService);
      const result = await handler({});

      expect(result.isError).toBe(false);
      const textContent = (result.content[0] as TextContent).text;

      // Should not throw
      const parsed = JSON.parse(textContent);
      expect(parsed).toHaveProperty("results");
      expect(parsed).toHaveProperty("metadata");
    });

    it("should serialize Date fields as ISO strings in JSON output", async () => {
      mockService.reset();
      mockService.setMockResponse({
        results: [RESULT_WITH_EXIF],
        metadata: { totalResults: 1, queryTimeMs: 30 },
      });

      const handler = createSearchImagesHandler(mockService);
      const result = await handler({});

      const response = parseResponse(result);
      const dateTaken = response.results[0]!.dateTaken!;
      const dateModified = response.results[0]!.dateModified;

      // JSON.stringify converts Date objects to ISO strings
      expect(typeof dateTaken).toBe("string");
      expect(typeof dateModified).toBe("string");
      expect(dateTaken).toBe("2026-01-10T18:30:00.000Z");
      expect(dateModified).toBe("2026-01-10T18:30:00.000Z");
    });

    it("should omit dateTaken from output when not present on the result", async () => {
      mockService.reset();
      mockService.setMockResponse({
        results: [RESULT_WITHOUT_EXIF],
        metadata: { totalResults: 1, queryTimeMs: 15 },
      });

      const handler = createSearchImagesHandler(mockService);
      const result = await handler({});

      const response = parseResponse(result);
      expect(response.results[0]!.dateTaken).toBeUndefined();
    });
  });
});
