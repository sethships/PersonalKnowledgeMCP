/**
 * Token Service Implementation
 *
 * Provides bearer token authentication operations including generation,
 * validation, revocation, and scope/access checking.
 *
 * @module auth/token-service
 */

import crypto from "crypto";
import type { Logger } from "pino";
import { z } from "zod";
import type {
  TokenService,
  TokenStore,
  GenerateTokenParams,
  GeneratedToken,
  TokenValidationResult,
  TokenScope,
  InstanceAccess,
  TokenMetadata,
  StoredToken,
  TokenListItem,
} from "./types.js";
import {
  GenerateTokenParamsSchema,
  RawTokenSchema,
  TokenHashSchema,
  TOKEN_PREFIX,
} from "./validation.js";
import { TokenValidationError, TokenGenerationError } from "./errors.js";
import { getComponentLogger, getAuditLogger } from "../logging/index.js";
import type { AuditLogger } from "../logging/audit-types.js";

/**
 * Token service implementation with caching for fast validation
 *
 * Provides methods for token lifecycle management and authentication.
 * Optimized for <10ms validation using cached token lookups.
 *
 * @example
 * ```typescript
 * const tokenService = new TokenServiceImpl(tokenStore);
 *
 * // Generate a new token
 * const { rawToken, metadata } = await tokenService.generateToken({
 *   name: "Cursor IDE",
 *   scopes: ["read", "write"],
 *   instanceAccess: ["work"]
 * });
 *
 * // Validate token
 * const result = await tokenService.validateToken(rawToken);
 * if (result.valid) {
 *   console.log("Token valid:", result.metadata);
 * }
 * ```
 */
export class TokenServiceImpl implements TokenService {
  /**
   * Lazy-initialized logger to avoid module load-time initialization
   */
  private _logger: Logger | null = null;

  /**
   * Lazy-initialized audit logger
   */
  private _auditLogger: AuditLogger | null = null;

  /**
   * Create a new TokenService instance
   *
   * @param tokenStore - Token storage backend
   */
  constructor(private readonly tokenStore: TokenStore) {}

  /**
   * Lazy-initialized component logger
   */
  private get logger(): Logger {
    if (!this._logger) {
      this._logger = getComponentLogger("auth:token-service");
    }
    return this._logger;
  }

  /**
   * Lazy-initialized audit logger
   */
  private getAudit(): AuditLogger | null {
    if (this._auditLogger === null) {
      try {
        this._auditLogger = getAuditLogger();
      } catch {
        // Audit logger not initialized, skip audit logging
        return null;
      }
    }
    return this._auditLogger;
  }

  /**
   * Generate a new token
   *
   * Creates a new bearer token with the specified parameters.
   * The raw token is only returned once and cannot be retrieved later.
   *
   * **Token Format:** `pk_mcp_<32 hex chars>`
   *
   * @param params - Token generation parameters
   * @returns Generated token with raw value (only shown once)
   * @throws {TokenValidationError} If parameters are invalid
   * @throws {TokenGenerationError} If generation fails
   */
  async generateToken(params: GenerateTokenParams): Promise<GeneratedToken> {
    const startTime = performance.now();

    try {
      // Validate parameters
      const validated = GenerateTokenParamsSchema.parse(params);

      // Generate 16 random bytes -> 32 hex chars
      const randomBytes = crypto.randomBytes(16);
      const randomHex = randomBytes.toString("hex");

      // Create raw token with prefix
      const rawToken = `${TOKEN_PREFIX}${randomHex}`;

      // Hash for storage (never store raw token)
      const tokenHash = crypto.createHash("sha256").update(rawToken, "utf8").digest("hex");

      // Create metadata
      const now = new Date();
      const metadata: TokenMetadata = {
        name: validated.name,
        createdAt: now.toISOString(),
        expiresAt:
          validated.expiresInSeconds !== null
            ? new Date(now.getTime() + validated.expiresInSeconds * 1000).toISOString()
            : null,
        scopes: validated.scopes as TokenScope[],
        instanceAccess: validated.instanceAccess as InstanceAccess[],
        useCount: 0,
      };

      // Store token
      const tokens = await this.tokenStore.loadTokens();
      tokens.set(tokenHash, {
        tokenHash,
        metadata,
        revoked: false,
      });
      await this.tokenStore.saveTokens(tokens);

      const durationMs = Math.round(performance.now() - startTime);
      this.logger.info(
        {
          metric: "token.generate_ms",
          value: durationMs,
          tokenName: validated.name,
          scopes: validated.scopes,
          instanceAccess: validated.instanceAccess,
          hasExpiration: validated.expiresInSeconds !== null,
        },
        "Token generated"
      );

      // Emit audit event for token creation
      const audit = this.getAudit();
      if (audit) {
        audit.emit({
          timestamp: new Date().toISOString(),
          eventType: "token.created",
          success: true,
          token: {
            tokenHashPrefix: tokenHash.substring(0, 8),
            tokenName: validated.name,
          },
          scopes: validated.scopes as TokenScope[],
          instanceAccess: validated.instanceAccess as InstanceAccess[],
          expiresAt: metadata.expiresAt,
        });
      }

      return { rawToken, tokenHash, metadata };
    } catch (error) {
      const durationMs = Math.round(performance.now() - startTime);

      if (error instanceof z.ZodError) {
        const messages = error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
        this.logger.warn(
          {
            metric: "token.generate_ms",
            value: durationMs,
            validationErrors: messages,
          },
          "Token generation validation failed"
        );
        throw new TokenValidationError(`Invalid token parameters: ${messages.join("; ")}`);
      }

      this.logger.error(
        {
          metric: "token.generate_ms",
          value: durationMs,
          err: error,
        },
        "Token generation failed"
      );

      throw new TokenGenerationError(
        error instanceof Error ? error.message : String(error),
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Validate a raw token
   *
   * Optimized for speed (<10ms target) using cached lookups.
   * Updates usage statistics asynchronously (fire-and-forget).
   *
   * @param rawToken - Raw token string to validate
   * @returns Validation result with metadata if valid
   */
  async validateToken(rawToken: string): Promise<TokenValidationResult> {
    const startTime = performance.now();

    try {
      // 1. Validate format (fast regex check)
      const formatResult = RawTokenSchema.safeParse(rawToken);
      if (!formatResult.success) {
        this.logValidation(startTime, false, "invalid");
        return { valid: false, reason: "invalid" };
      }

      // 2. Hash token
      const tokenHash = crypto.createHash("sha256").update(rawToken, "utf8").digest("hex");

      // 3. Lookup in store (uses cache for speed)
      const tokens = await this.tokenStore.loadTokens();
      const storedToken = tokens.get(tokenHash);

      if (!storedToken) {
        this.logValidation(startTime, false, "not_found");
        return { valid: false, reason: "not_found" };
      }

      // 4. Check revoked
      if (storedToken.revoked) {
        this.logValidation(startTime, false, "revoked");
        return { valid: false, reason: "revoked" };
      }

      // 5. Check expiration
      if (storedToken.metadata.expiresAt) {
        const expiresAt = new Date(storedToken.metadata.expiresAt);
        if (expiresAt < new Date()) {
          this.logValidation(startTime, false, "expired");
          return { valid: false, reason: "expired" };
        }
      }

      // Update usage stats (fire-and-forget, don't block validation)
      this.updateUsageStats(tokenHash, tokens).catch((err: unknown) => {
        this.logger.warn(
          { err, tokenHash: tokenHash.substring(0, 8) },
          "Failed to update token usage stats"
        );
      });

      this.logValidation(startTime, true);
      return { valid: true, metadata: storedToken.metadata };
    } catch (error) {
      this.logger.error({ err: error }, "Token validation error");
      return { valid: false, reason: "invalid" };
    }
  }

  /**
   * Check if token has required scopes
   *
   * Admin scope grants all permissions.
   *
   * @param rawToken - Raw token string
   * @param requiredScopes - Scopes that must be present
   * @returns True if token has all required scopes
   */
  async hasScopes(rawToken: string, requiredScopes: TokenScope[]): Promise<boolean> {
    const result = await this.validateToken(rawToken);

    if (!result.valid || !result.metadata) {
      return false;
    }

    // Admin scope grants all permissions
    if (result.metadata.scopes.includes("admin")) {
      return true;
    }

    // Check if all required scopes are present
    const metadata = result.metadata;
    return requiredScopes.every((scope) => metadata.scopes.includes(scope));
  }

  /**
   * Check if token has required instance access
   *
   * @param rawToken - Raw token string
   * @param requiredAccess - Instance access levels that must be present
   * @returns True if token has all required access levels
   */
  async hasInstanceAccess(rawToken: string, requiredAccess: InstanceAccess[]): Promise<boolean> {
    const result = await this.validateToken(rawToken);

    if (!result.valid || !result.metadata) {
      return false;
    }

    // Check if all required access levels are present
    const metadata = result.metadata;
    return requiredAccess.every((access) => metadata.instanceAccess.includes(access));
  }

  /**
   * Revoke a token by its hash
   *
   * Revoked tokens cannot be used for authentication.
   *
   * @param tokenHash - SHA-256 hash of the token
   * @returns True if token was found and revoked
   */
  async revokeToken(tokenHash: string): Promise<boolean> {
    // Validate hash format before processing
    const hashResult = TokenHashSchema.safeParse(tokenHash);
    if (!hashResult.success) {
      this.logger.warn(
        { tokenHashPrefix: tokenHash.substring(0, 8) },
        "Invalid token hash format for revocation"
      );
      return false;
    }

    const tokens = await this.tokenStore.loadTokens();
    const token = tokens.get(tokenHash);

    if (!token) {
      this.logger.info({ tokenHash: tokenHash.substring(0, 8) }, "Token not found for revocation");
      return false;
    }

    token.revoked = true;
    token.revokedAt = new Date().toISOString();

    await this.tokenStore.saveTokens(tokens);

    this.logger.info(
      { tokenHash: tokenHash.substring(0, 8), tokenName: token.metadata.name },
      "Token revoked"
    );

    // Emit audit event for token revocation
    const audit = this.getAudit();
    if (audit) {
      audit.emit({
        timestamp: new Date().toISOString(),
        eventType: "token.revoked",
        success: true,
        token: {
          tokenHashPrefix: tokenHash.substring(0, 8),
          tokenName: token.metadata.name,
        },
      });
    }

    return true;
  }

  /**
   * List all active (non-revoked, non-expired) tokens
   *
   * @returns Array of token hashes with metadata
   */
  async listTokens(): Promise<TokenListItem[]> {
    const tokens = await this.tokenStore.loadTokens();
    const now = new Date();

    const activeTokens: TokenListItem[] = [];

    for (const [hash, token] of tokens) {
      // Skip revoked
      if (token.revoked) continue;

      // Skip expired
      if (token.metadata.expiresAt && new Date(token.metadata.expiresAt) < now) {
        continue;
      }

      activeTokens.push({ hash, metadata: token.metadata });
    }

    return activeTokens;
  }

  /**
   * Delete a token permanently
   *
   * Unlike revocation, deletion removes the token entirely.
   * This is an admin-only operation.
   *
   * @param tokenHash - SHA-256 hash of the token
   * @returns True if token was found and deleted
   */
  async deleteToken(tokenHash: string): Promise<boolean> {
    // Validate hash format before processing
    const hashResult = TokenHashSchema.safeParse(tokenHash);
    if (!hashResult.success) {
      this.logger.warn(
        { tokenHashPrefix: tokenHash.substring(0, 8) },
        "Invalid token hash format for deletion"
      );
      return false;
    }

    const tokens = await this.tokenStore.loadTokens();

    const token = tokens.get(tokenHash);
    if (!token) {
      this.logger.info({ tokenHash: tokenHash.substring(0, 8) }, "Token not found for deletion");
      return false;
    }

    // Capture token info before deletion for audit log
    const tokenName = token.metadata.name;

    tokens.delete(tokenHash);
    await this.tokenStore.saveTokens(tokens);

    this.logger.info({ tokenHash: tokenHash.substring(0, 8) }, "Token deleted");

    // Emit audit event for token deletion
    const audit = this.getAudit();
    if (audit) {
      audit.emit({
        timestamp: new Date().toISOString(),
        eventType: "token.deleted",
        success: true,
        token: {
          tokenHashPrefix: tokenHash.substring(0, 8),
          tokenName,
        },
      });
    }

    return true;
  }

  /**
   * Update token usage statistics (fire-and-forget)
   *
   * **Known Limitation (MVP):** This method has a race condition under concurrent
   * token validations. Multiple simultaneous validations of the same token may
   * overwrite each other's usage count updates, potentially losing increments.
   * This is acceptable for MVP scope where usage stats are informational only.
   *
   * For production use cases requiring accurate usage counts, consider:
   * - Using a separate counter store with atomic operations
   * - Implementing optimistic locking with version numbers
   * - Using database-backed storage with atomic increment
   *
   * @param tokenHash - Token hash to update
   * @param tokens - Current tokens map
   */
  private async updateUsageStats(
    tokenHash: string,
    tokens: Map<string, StoredToken>
  ): Promise<void> {
    const token = tokens.get(tokenHash);
    if (!token) return;

    token.metadata.lastUsedAt = new Date().toISOString();
    token.metadata.useCount = (token.metadata.useCount || 0) + 1;

    await this.tokenStore.saveTokens(tokens);
  }

  /**
   * Log validation result with performance metrics
   *
   * @param startTime - Start time from performance.now()
   * @param valid - Whether validation succeeded
   * @param reason - Failure reason if invalid
   */
  private logValidation(startTime: number, valid: boolean, reason?: string): void {
    const durationMs = Math.round(performance.now() - startTime);
    this.logger.debug(
      {
        metric: "token.validate_ms",
        value: durationMs,
        valid,
        reason,
      },
      valid ? "Token validated" : `Token validation failed: ${reason}`
    );
  }

  /**
   * Find a token by its name
   *
   * Searches active (non-revoked, non-expired) tokens by exact name match.
   *
   * @param name - Token name to search for
   * @returns Token if found, undefined otherwise
   */
  async findTokenByName(name: string): Promise<TokenListItem | undefined> {
    const tokens = await this.tokenStore.loadTokens();
    const now = new Date();

    for (const [hash, token] of tokens) {
      // Skip revoked
      if (token.revoked) continue;

      // Skip expired
      if (token.metadata.expiresAt && new Date(token.metadata.expiresAt) < now) {
        continue;
      }

      // Match by name (case-sensitive)
      if (token.metadata.name === name) {
        return { hash, metadata: token.metadata };
      }
    }

    return undefined;
  }

  /**
   * Find tokens by hash prefix
   *
   * Searches all tokens (including revoked/expired) by hash prefix.
   * Returns array to handle potential ambiguity.
   *
   * @param prefix - Hash prefix (minimum 8 characters recommended)
   * @returns Array of matching tokens (may be empty or have multiple matches)
   */
  async findTokenByHashPrefix(prefix: string): Promise<TokenListItem[]> {
    const tokens = await this.tokenStore.loadTokens();
    const matches: TokenListItem[] = [];
    const lowerPrefix = prefix.toLowerCase();

    for (const [hash, token] of tokens) {
      if (hash.toLowerCase().startsWith(lowerPrefix)) {
        matches.push({ hash, metadata: token.metadata });
      }
    }

    return matches;
  }

  /**
   * List all tokens including expired and revoked
   *
   * Returns all tokens with status flags for UI display.
   *
   * @returns Array of all tokens with status information
   */
  async listAllTokens(): Promise<
    Array<TokenListItem & { isExpired: boolean; isRevoked: boolean }>
  > {
    const tokens = await this.tokenStore.loadTokens();
    const now = new Date();
    const result: Array<TokenListItem & { isExpired: boolean; isRevoked: boolean }> = [];

    for (const [hash, token] of tokens) {
      const isExpired = token.metadata.expiresAt ? new Date(token.metadata.expiresAt) < now : false;

      result.push({
        hash,
        metadata: token.metadata,
        isExpired,
        isRevoked: token.revoked,
      });
    }

    // Sort by created date, newest first
    result.sort((a, b) => {
      const dateA = new Date(a.metadata.createdAt);
      const dateB = new Date(b.metadata.createdAt);
      return dateB.getTime() - dateA.getTime();
    });

    return result;
  }
}
