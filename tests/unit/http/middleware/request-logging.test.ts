/**
 * Request Logging Middleware Tests
 */

import { describe, test, expect, beforeEach, beforeAll, mock } from "bun:test";
import type { Request, Response } from "express";
import { initializeLogger } from "../../../../src/logging/index.js";
import { requestLogging } from "../../../../src/http/middleware/request-logging.js";

// Initialize logger before tests (wrapped in try-catch for parallel test execution)
beforeAll(() => {
  try {
    initializeLogger({ level: "silent", format: "json" });
  } catch {
    // Logger already initialized by another test file, ignore
  }
});

describe("requestLogging middleware", () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let nextFn: ReturnType<typeof mock>;
  let finishHandler: (() => void) | undefined;

  beforeEach(() => {
    // Mock Request.get() with proper overload typing for Express
    const getMock = mock((header: string): string | undefined => {
      const headers: Record<string, string> = {
        "User-Agent": "Test Agent",
        "Content-Type": "application/json",
      };
      return headers[header];
    });

    mockRequest = {
      method: "GET",
      path: "/test",
      query: { foo: "bar" },
      headers: {},
      get: getMock as Request["get"],
    };

    mockResponse = {
      statusCode: 200,
      on: mock((event: string, handler: () => void) => {
        if (event === "finish") {
          finishHandler = handler;
        }
        return mockResponse as Response;
      }),
    };

    nextFn = mock(() => {});
  });

  test("should call next() to continue middleware chain", () => {
    requestLogging(mockRequest as Request, mockResponse as Response, nextFn as () => void);

    expect(nextFn).toHaveBeenCalled();
  });

  test("should add x-request-id header to request", () => {
    requestLogging(mockRequest as Request, mockResponse as Response, nextFn as () => void);

    expect(mockRequest.headers!["x-request-id"]).toBeDefined();
    expect(mockRequest.headers!["x-request-id"]).toMatch(/^req_/);
  });

  test("should register finish handler on response", () => {
    requestLogging(mockRequest as Request, mockResponse as Response, nextFn as () => void);

    expect(mockResponse.on).toHaveBeenCalledWith("finish", expect.any(Function));
  });

  test("should generate unique request IDs", () => {
    const ids: string[] = [];

    for (let i = 0; i < 10; i++) {
      mockRequest.headers = {};
      requestLogging(mockRequest as Request, mockResponse as Response, nextFn as () => void);
      ids.push(mockRequest.headers["x-request-id"] as string);
    }

    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(10);
  });

  test("should handle finish event for successful response", () => {
    requestLogging(mockRequest as Request, mockResponse as Response, nextFn as () => void);

    // Simulate response finish
    expect(finishHandler).toBeDefined();
    finishHandler!();
    // No assertion needed - just verify it doesn't throw
  });

  test("should handle finish event for client error response", () => {
    mockResponse.statusCode = 404;

    requestLogging(mockRequest as Request, mockResponse as Response, nextFn as () => void);

    expect(finishHandler).toBeDefined();
    finishHandler!();
    // No assertion needed - just verify it doesn't throw
  });

  test("should handle finish event for server error response", () => {
    mockResponse.statusCode = 500;

    requestLogging(mockRequest as Request, mockResponse as Response, nextFn as () => void);

    expect(finishHandler).toBeDefined();
    finishHandler!();
    // No assertion needed - just verify it doesn't throw
  });
});
