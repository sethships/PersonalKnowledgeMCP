/**
 * Error Handler Middleware Tests
 */

import { describe, test, expect, beforeEach, beforeAll, mock } from "bun:test";
import type { Request, Response, NextFunction } from "express";
import { initializeLogger } from "../../../../src/logging/index.js";
import {
  errorHandler,
  notFoundHandler,
  HttpError,
  badRequest,
  notFound,
  internalError,
} from "../../../../src/http/middleware/error-handler.js";

// Initialize logger before tests (wrapped in try-catch for parallel test execution)
beforeAll(() => {
  try {
    initializeLogger({ level: "silent", format: "json" });
  } catch {
    // Logger already initialized by another test file, ignore
  }
});

describe("Error Handler Middleware", () => {
  describe("HttpError class", () => {
    test("should create error with status code and message", () => {
      const error = new HttpError(400, "Bad request");

      expect(error.statusCode).toBe(400);
      expect(error.message).toBe("Bad request");
      expect(error.name).toBe("HttpError");
    });

    test("should create error with optional code", () => {
      const error = new HttpError(400, "Bad request", "INVALID_INPUT");

      expect(error.statusCode).toBe(400);
      expect(error.message).toBe("Bad request");
      expect(error.code).toBe("INVALID_INPUT");
    });
  });

  describe("error factory functions", () => {
    test("badRequest should create 400 error", () => {
      const error = badRequest("Invalid input", "INVALID_INPUT");

      expect(error.statusCode).toBe(400);
      expect(error.message).toBe("Invalid input");
      expect(error.code).toBe("INVALID_INPUT");
    });

    test("notFound should create 404 error", () => {
      const error = notFound("Resource not found", "NOT_FOUND");

      expect(error.statusCode).toBe(404);
      expect(error.message).toBe("Resource not found");
      expect(error.code).toBe("NOT_FOUND");
    });

    test("internalError should create 500 error", () => {
      const error = internalError("Something went wrong", "INTERNAL_ERROR");

      expect(error.statusCode).toBe(500);
      expect(error.message).toBe("Something went wrong");
      expect(error.code).toBe("INTERNAL_ERROR");
    });
  });

  describe("errorHandler middleware", () => {
    let mockRequest: Partial<Request>;
    let mockResponse: Partial<Response>;
    let nextFn: ReturnType<typeof mock>;
    let jsonData: unknown;

    beforeEach(() => {
      jsonData = undefined;

      mockRequest = {
        method: "GET",
        path: "/test",
        headers: {
          "x-request-id": "test-request-id",
        },
      };

      mockResponse = {
        status: mock((_code: number) => mockResponse as Response),
        json: mock((data: unknown) => {
          jsonData = data;
          return mockResponse as Response;
        }),
      };

      nextFn = mock(() => {});
    });

    test("should handle HttpError with correct status code", () => {
      const error = new HttpError(400, "Bad request", "BAD_REQUEST");

      errorHandler(error, mockRequest as Request, mockResponse as Response, nextFn as NextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(jsonData).toEqual({
        error: {
          message: "Bad request",
          code: "BAD_REQUEST",
          statusCode: 400,
        },
      });
    });

    test("should handle generic Error as 500", () => {
      const error = new Error("Something broke");

      errorHandler(error, mockRequest as Request, mockResponse as Response, nextFn as NextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(jsonData).toEqual({
        error: {
          message: "Internal server error",
          code: "INTERNAL_ERROR",
          statusCode: 500,
        },
      });
    });

    test("should not leak internal error details for 500 errors", () => {
      const error = new Error("Database connection failed: password=secret123");

      errorHandler(error, mockRequest as Request, mockResponse as Response, nextFn as NextFunction);

      expect(jsonData).toEqual({
        error: {
          message: "Internal server error",
          code: "INTERNAL_ERROR",
          statusCode: 500,
        },
      });
    });

    test("should preserve HttpError message for non-500 errors", () => {
      const error = new HttpError(401, "Unauthorized access");

      errorHandler(error, mockRequest as Request, mockResponse as Response, nextFn as NextFunction);

      expect(jsonData).toEqual({
        error: {
          message: "Unauthorized access",
          code: undefined,
          statusCode: 401,
        },
      });
    });
  });

  describe("notFoundHandler middleware", () => {
    let mockRequest: Partial<Request>;
    let mockResponse: Partial<Response>;
    let jsonData: unknown;

    beforeEach(() => {
      jsonData = undefined;

      mockRequest = {
        method: "GET",
        path: "/unknown-route",
      };

      mockResponse = {
        status: mock((_code: number) => mockResponse as Response),
        json: mock((data: unknown) => {
          jsonData = data;
          return mockResponse as Response;
        }),
      };
    });

    test("should return 404 with route information", () => {
      notFoundHandler(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(jsonData).toEqual({
        error: {
          message: "Route not found: GET /unknown-route",
          code: "NOT_FOUND",
          statusCode: 404,
        },
      });
    });

    test("should include method in error message", () => {
      // Create a new request object since path is read-only
      const postRequest: Partial<Request> = {
        method: "POST",
        path: "/api/v1/resource",
      };

      notFoundHandler(postRequest as Request, mockResponse as Response);

      expect(jsonData).toEqual({
        error: {
          message: "Route not found: POST /api/v1/resource",
          code: "NOT_FOUND",
          statusCode: 404,
        },
      });
    });
  });
});
