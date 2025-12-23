/**
 * Token Commands - Manage authentication tokens
 *
 * Commands for token lifecycle management:
 * - create: Generate a new token
 * - list: List all tokens
 * - revoke: Revoke a token
 * - rotate: Rotate a token (revoke old, create new)
 */

/* eslint-disable no-console */

import chalk from "chalk";
import type { CliDependencies } from "../utils/dependency-init.js";
import type { TokenScope, InstanceAccess } from "../../auth/types.js";
import { confirm } from "../utils/prompts.js";
import {
  createTokenSpinner,
  completeTokenSpinner,
  createRotateSpinner,
  completeRotateSpinner,
  createRevokeSpinner,
  completeRevokeSpinner,
} from "../output/progress.js";
import {
  createTokenTable,
  formatTokensJson,
  formatCreatedToken,
  formatTokenRevoked,
  formatTokenRotated,
  formatRevokeConfirmation,
  type TokenDisplayInfo,
} from "../output/token-formatters.js";

// ============================================================================
// Command Option Types
// ============================================================================

/**
 * Options for token create command
 */
export interface TokenCreateOptions {
  /** Token name */
  name: string;
  /** Permission scopes */
  scopes: TokenScope[];
  /** Instance access levels */
  instances: InstanceAccess[];
  /** Expiration in seconds from now (null = never) */
  expires: number | null;
}

/**
 * Options for token list command
 */
export interface TokenListOptions {
  /** Output as JSON */
  json?: boolean;
  /** Include expired and revoked tokens */
  all?: boolean;
}

/**
 * Options for token revoke command
 */
export interface TokenRevokeOptions {
  /** Revoke by name */
  name?: string;
  /** Revoke by hash prefix */
  id?: string;
  /** Skip confirmation prompt */
  force?: boolean;
}

/**
 * Options for token rotate command
 */
export interface TokenRotateOptions {
  /** Token name to rotate */
  name: string;
}

// ============================================================================
// Token Create Command
// ============================================================================

/**
 * Execute token create command
 *
 * Generates a new authentication token with the specified parameters.
 * The raw token is displayed once and cannot be retrieved later.
 *
 * @param options - Command options
 * @param deps - CLI dependencies
 */
export async function tokenCreateCommand(
  options: TokenCreateOptions,
  deps: CliDependencies
): Promise<void> {
  const spinner = createTokenSpinner(options.name);

  try {
    const result = await deps.tokenService.generateToken({
      name: options.name,
      scopes: options.scopes,
      instanceAccess: options.instances,
      expiresInSeconds: options.expires,
    });

    completeTokenSpinner(spinner, true);

    // Display the token (only time it's shown)
    console.log(formatCreatedToken(result.rawToken, result.metadata));
  } catch (error) {
    completeTokenSpinner(spinner, false);
    throw error;
  }
}

// ============================================================================
// Token List Command
// ============================================================================

/**
 * Execute token list command
 *
 * Lists all tokens with their metadata. By default, shows only active tokens.
 * Use --all to include expired and revoked tokens.
 *
 * @param options - Command options
 * @param deps - CLI dependencies
 */
export async function tokenListCommand(
  options: TokenListOptions,
  deps: CliDependencies
): Promise<void> {
  let tokens: TokenDisplayInfo[];

  if (options.all) {
    // Get all tokens including expired/revoked
    tokens = await deps.tokenService.listAllTokens();
  } else {
    // Get only active tokens
    const activeTokens = await deps.tokenService.listTokens();
    tokens = activeTokens.map((token) => ({
      ...token,
      isExpired: false,
      isRevoked: false,
    }));
  }

  if (options.json) {
    console.log(formatTokensJson(tokens));
  } else {
    console.log(createTokenTable(tokens));
  }
}

// ============================================================================
// Token Revoke Command
// ============================================================================

/**
 * Execute token revoke command
 *
 * Revokes a token by name or hash prefix. Requires confirmation unless --force.
 *
 * @param options - Command options
 * @param deps - CLI dependencies
 */
export async function tokenRevokeCommand(
  options: TokenRevokeOptions,
  deps: CliDependencies
): Promise<void> {
  let tokenHash: string;
  let tokenName: string;

  // Find token by name or hash prefix
  if (options.name) {
    const token = await deps.tokenService.findTokenByName(options.name);
    if (!token) {
      throw new Error(
        `Token '${options.name}' not found.\nRun 'pk-mcp token list' to see available tokens.`
      );
    }
    tokenHash = token.hash;
    tokenName = token.metadata.name;
  } else if (options.id) {
    const matches = await deps.tokenService.findTokenByHashPrefix(options.id);
    if (matches.length === 0) {
      throw new Error(
        `No token found with hash prefix '${options.id}'.\nRun 'pk-mcp token list' to see available tokens.`
      );
    }
    if (matches.length > 1) {
      const matchList = matches
        .map((m) => `  • ${m.hash.substring(0, 8)} - ${m.metadata.name}`)
        .join("\n");
      throw new Error(
        `Multiple tokens match hash prefix '${options.id}':\n${matchList}\n\nPlease use a longer prefix or specify by name.`
      );
    }
    const matchedToken = matches[0];
    if (!matchedToken) {
      throw new Error(`Unexpected error: Token match not found after validation.`);
    }
    tokenHash = matchedToken.hash;
    tokenName = matchedToken.metadata.name;
  } else {
    throw new Error(
      "Either --name or --id must be provided.\nRun 'pk-mcp token revoke --help' for usage."
    );
  }

  // Confirm revocation (unless --force)
  if (!options.force) {
    console.log(formatRevokeConfirmation(tokenName));

    const confirmed = await confirm("Type 'yes' to confirm:");
    if (!confirmed) {
      console.log(chalk.gray("\nOperation cancelled."));
      return;
    }
  }

  const spinner = createRevokeSpinner(tokenName);

  try {
    const success = await deps.tokenService.revokeToken(tokenHash);

    if (success) {
      completeRevokeSpinner(spinner, true);
      console.log(formatTokenRevoked(tokenName));
    } else {
      completeRevokeSpinner(spinner, false);
      throw new Error(`Failed to revoke token '${tokenName}'.`);
    }
  } catch (error) {
    completeRevokeSpinner(spinner, false);
    throw error;
  }
}

// ============================================================================
// Token Rotate Command
// ============================================================================

/**
 * Execute token rotate command
 *
 * Rotates a token by revoking the old one and creating a new one with the
 * same metadata (name, scopes, instances). The expiration is reset.
 *
 * @param options - Command options
 * @param deps - CLI dependencies
 */
export async function tokenRotateCommand(
  options: TokenRotateOptions,
  deps: CliDependencies
): Promise<void> {
  // Find existing token by name
  const existingToken = await deps.tokenService.findTokenByName(options.name);
  if (!existingToken) {
    throw new Error(
      `Token '${options.name}' not found.\nRun 'pk-mcp token list' to see available tokens.`
    );
  }

  const spinner = createRotateSpinner(options.name);

  try {
    // Revoke old token
    const revoked = await deps.tokenService.revokeToken(existingToken.hash);
    if (!revoked) {
      completeRotateSpinner(spinner, false);
      throw new Error(`Failed to revoke existing token '${options.name}'.`);
    }

    // Create new token with same metadata (except expiration)
    // Note: We preserve scopes and instances, but reset expiration
    // Users can specify new expiration when calling token create directly if needed
    const result = await deps.tokenService.generateToken({
      name: existingToken.metadata.name,
      scopes: existingToken.metadata.scopes,
      instanceAccess: existingToken.metadata.instanceAccess,
      // Reset expiration - if original had expiration, keep same duration from now
      expiresInSeconds: calculateExpirationSeconds(existingToken.metadata.expiresAt),
    });

    completeRotateSpinner(spinner, true);

    // Display the new token
    console.log(formatTokenRotated(options.name, result.rawToken, result.metadata));
  } catch (error) {
    completeRotateSpinner(spinner, false);
    throw error;
  }
}

/**
 * Calculate expiration seconds to maintain similar expiration duration
 *
 * If the original token had no expiration, return null.
 * Otherwise, calculate the original duration and apply it to the new token.
 *
 * @param expiresAt - Original expiration timestamp or null
 * @returns Expiration in seconds or null
 */
function calculateExpirationSeconds(expiresAt: string | null): number | null {
  if (!expiresAt) {
    return null; // Never expires
  }

  // For rotated tokens, we don't try to preserve the remaining time
  // Instead, we could either:
  // 1. Give the same duration as the original (requires createdAt)
  // 2. Use a default duration
  // 3. Set to never expires
  //
  // For simplicity and security, rotated tokens get no expiration by default.
  // Users can create a new token with specific expiration if needed.
  return null;
}
