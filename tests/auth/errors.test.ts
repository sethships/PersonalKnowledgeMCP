/**
 * Error Classes Unit Tests
 *
 * Tests for the auth module error classes.
 *
 * @module tests/auth/errors
 */

import { describe, it, expect } from "bun:test";
import {
  AuthError,
  TokenValidationError,
  TokenNotFoundError,
  TokenRevokedError,
  TokenExpiredError,
  InsufficientScopesError,
  InstanceAccessDeniedError,
  TokenStorageError,
  TokenGenerationError,
} from "../../src/auth/errors.js";

describe("Auth Error Classes", () => {
  describe("TokenValidationError", () => {
    it("should have correct properties", () => {
      const error = new TokenValidationError("Invalid format");

      expect(error.message).toBe("Invalid format");
      expect(error.name).toBe("TokenValidationError");
      expect(error.code).toBe("TOKEN_VALIDATION_ERROR");
      expect(error.retryable).toBe(false);
      expect(error).toBeInstanceOf(AuthError);
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe("TokenNotFoundError", () => {
    it("should have correct properties", () => {
      const error = new TokenNotFoundError("abcdef1234567890".repeat(4));

      expect(error.message).toBe("Token not found: abcdef12...");
      expect(error.name).toBe("TokenNotFoundError");
      expect(error.code).toBe("TOKEN_NOT_FOUND");
      expect(error.retryable).toBe(false);
      expect(error.tokenHash).toBe("abcdef1234567890".repeat(4));
    });
  });

  describe("TokenRevokedError", () => {
    it("should have correct properties", () => {
      const error = new TokenRevokedError("abcdef1234567890".repeat(4));

      expect(error.message).toBe("Token has been revoked: abcdef12...");
      expect(error.name).toBe("TokenRevokedError");
      expect(error.code).toBe("TOKEN_REVOKED");
      expect(error.retryable).toBe(false);
      expect(error.tokenHash).toBe("abcdef1234567890".repeat(4));
    });
  });

  describe("TokenExpiredError", () => {
    it("should have correct properties", () => {
      const expiredAt = "2024-01-01T00:00:00.000Z";
      const error = new TokenExpiredError("abcdef1234567890".repeat(4), expiredAt);

      expect(error.message).toBe(`Token expired at ${expiredAt}`);
      expect(error.name).toBe("TokenExpiredError");
      expect(error.code).toBe("TOKEN_EXPIRED");
      expect(error.retryable).toBe(false);
      expect(error.tokenHash).toBe("abcdef1234567890".repeat(4));
      expect(error.expiredAt).toBe(expiredAt);
    });
  });

  describe("InsufficientScopesError", () => {
    it("should have correct properties", () => {
      const error = new InsufficientScopesError(["write", "admin"], ["read"]);

      expect(error.message).toBe("Insufficient scopes. Required: [write, admin], Present: [read]");
      expect(error.name).toBe("InsufficientScopesError");
      expect(error.code).toBe("INSUFFICIENT_SCOPES");
      expect(error.retryable).toBe(false);
      expect(error.requiredScopes).toEqual(["write", "admin"]);
      expect(error.presentScopes).toEqual(["read"]);
    });
  });

  describe("InstanceAccessDeniedError", () => {
    it("should have correct properties", () => {
      const error = new InstanceAccessDeniedError(["private", "work"], ["public"]);

      expect(error.message).toBe(
        "Instance access denied. Required: [private, work], Present: [public]"
      );
      expect(error.name).toBe("InstanceAccessDeniedError");
      expect(error.code).toBe("INSTANCE_ACCESS_DENIED");
      expect(error.retryable).toBe(false);
      expect(error.requiredAccess).toEqual(["private", "work"]);
      expect(error.presentAccess).toEqual(["public"]);
    });
  });

  describe("TokenStorageError", () => {
    it("should have correct properties for read operation", () => {
      const cause = new Error("File not found");
      const error = new TokenStorageError("read", "Cannot open file", cause);

      expect(error.message).toBe("Token storage read failed: Cannot open file");
      expect(error.name).toBe("TokenStorageError");
      expect(error.code).toBe("TOKEN_STORAGE_ERROR");
      expect(error.retryable).toBe(false);
      expect(error.operation).toBe("read");
      expect(error.cause).toBe(cause);
    });

    it("should have correct properties for write operation", () => {
      const error = new TokenStorageError("write", "Disk full", undefined, true);

      expect(error.message).toBe("Token storage write failed: Disk full");
      expect(error.operation).toBe("write");
      expect(error.retryable).toBe(true);
      expect(error.cause).toBeUndefined();
    });
  });

  describe("TokenGenerationError", () => {
    it("should have correct properties", () => {
      const cause = new Error("Crypto failure");
      const error = new TokenGenerationError("Random bytes failed", cause);

      expect(error.message).toBe("Token generation failed: Random bytes failed");
      expect(error.name).toBe("TokenGenerationError");
      expect(error.code).toBe("TOKEN_GENERATION_ERROR");
      expect(error.retryable).toBe(false);
      expect(error.cause).toBe(cause);
    });

    it("should work without cause", () => {
      const error = new TokenGenerationError("Unknown error");

      expect(error.cause).toBeUndefined();
    });
  });

  describe("Error inheritance", () => {
    it("all errors should extend AuthError", () => {
      expect(new TokenValidationError("test")).toBeInstanceOf(AuthError);
      expect(new TokenNotFoundError("a".repeat(64))).toBeInstanceOf(AuthError);
      expect(new TokenRevokedError("a".repeat(64))).toBeInstanceOf(AuthError);
      expect(new TokenExpiredError("a".repeat(64), "now")).toBeInstanceOf(AuthError);
      expect(new InsufficientScopesError([], [])).toBeInstanceOf(AuthError);
      expect(new InstanceAccessDeniedError([], [])).toBeInstanceOf(AuthError);
      expect(new TokenStorageError("read", "test")).toBeInstanceOf(AuthError);
      expect(new TokenGenerationError("test")).toBeInstanceOf(AuthError);
    });

    it("all errors should extend Error", () => {
      expect(new TokenValidationError("test")).toBeInstanceOf(Error);
      expect(new TokenNotFoundError("a".repeat(64))).toBeInstanceOf(Error);
      expect(new TokenRevokedError("a".repeat(64))).toBeInstanceOf(Error);
      expect(new TokenExpiredError("a".repeat(64), "now")).toBeInstanceOf(Error);
      expect(new InsufficientScopesError([], [])).toBeInstanceOf(Error);
      expect(new InstanceAccessDeniedError([], [])).toBeInstanceOf(Error);
      expect(new TokenStorageError("read", "test")).toBeInstanceOf(Error);
      expect(new TokenGenerationError("test")).toBeInstanceOf(Error);
    });

    it("all errors should have stack traces", () => {
      const error = new TokenValidationError("test");
      expect(error.stack).toBeDefined();
      expect(error.stack).toContain("TokenValidationError");
    });
  });
});
