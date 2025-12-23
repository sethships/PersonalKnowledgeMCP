/**
 * Token Output Formatters for CLI
 *
 * Functions for formatting token information as tables or JSON.
 */

import Table from "cli-table3";
import chalk from "chalk";
import type { TokenMetadata, TokenListItem } from "../../auth/types.js";

/**
 * Display information for a token in the list
 */
export interface TokenDisplayInfo extends TokenListItem {
  /** Whether the token has expired */
  isExpired: boolean;
  /** Whether the token has been revoked */
  isRevoked: boolean;
}

/**
 * Format a date string for display
 *
 * @param isoDate - ISO 8601 date string or null
 * @returns Formatted date string or "never"
 */
function formatDate(isoDate: string | null): string {
  if (!isoDate) return "never";
  try {
    const date = new Date(isoDate);
    return date.toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return isoDate;
  }
}

/**
 * Format ISO timestamp as relative time from now
 *
 * @param isoDate - ISO 8601 timestamp string
 * @returns Formatted relative time string
 */
function formatRelativeTime(isoDate: string | null): string {
  if (!isoDate) return "never";

  try {
    const date = new Date(isoDate);
    const now = new Date();

    if (isNaN(date.getTime())) {
      return isoDate;
    }

    const diffMs = date.getTime() - now.getTime();

    // Past dates
    if (diffMs < 0) {
      const absDiff = Math.abs(diffMs);
      const days = Math.floor(absDiff / (1000 * 60 * 60 * 24));
      if (days === 0) return "today";
      if (days === 1) return "yesterday";
      if (days < 30) return `${days}d ago`;
      const months = Math.floor(days / 30);
      if (months < 12) return `${months}mo ago`;
      return formatDate(isoDate);
    }

    // Future dates (for expiration)
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (days === 0) return "today";
    if (days === 1) return "in 1 day";
    if (days < 30) return `in ${days} days`;
    const months = Math.floor(days / 30);
    if (months < 12) return `in ${months}mo`;
    const years = Math.floor(days / 365);
    return `in ${years}y`;
  } catch {
    return isoDate;
  }
}

/**
 * Truncate a hash to display length
 *
 * @param hash - Full token hash (64 chars)
 * @returns First 8 characters
 */
function truncateHash(hash: string): string {
  return hash.substring(0, 8);
}

/**
 * Get colored status indicator for token
 *
 * @param isActive - Whether the token is active (not expired, not revoked)
 * @param isExpired - Whether the token has expired
 * @param isRevoked - Whether the token has been revoked
 * @returns Colored status string
 */
function getTokenStatusIndicator(
  isActive: boolean,
  isExpired: boolean,
  isRevoked: boolean
): string {
  if (isRevoked) {
    return chalk.red("revoked");
  }
  if (isExpired) {
    return chalk.yellow("expired");
  }
  if (isActive) {
    return chalk.green("active");
  }
  return chalk.gray("unknown");
}

/**
 * Create a formatted table of tokens
 *
 * @param tokens - List of token display information
 * @returns Formatted table string ready to print
 */
export function createTokenTable(tokens: TokenDisplayInfo[]): string {
  if (tokens.length === 0) {
    return (
      chalk.yellow("No tokens found.") +
      "\n\n" +
      chalk.bold("Create your first token:") +
      "\n  " +
      chalk.gray('pk-mcp token create -n "My Token" -s read,write')
    );
  }

  const table = new Table({
    head: [
      chalk.cyan("ID"),
      chalk.cyan("Name"),
      chalk.cyan("Scopes"),
      chalk.cyan("Instances"),
      chalk.cyan("Expires"),
      chalk.cyan("Status"),
    ],
    colAligns: ["left", "left", "left", "left", "left", "left"],
    colWidths: [10, 20, 18, 18, 14, 10],
    style: {
      head: [],
      border: ["gray"],
    },
  });

  for (const token of tokens) {
    const isActive = !token.isExpired && !token.isRevoked;

    table.push([
      chalk.gray(truncateHash(token.hash)),
      truncateName(token.metadata.name, 18),
      formatScopes(token.metadata.scopes),
      formatInstances(token.metadata.instanceAccess),
      formatExpirationShort(token.metadata.expiresAt, token.isExpired),
      getTokenStatusIndicator(isActive, token.isExpired, token.isRevoked),
    ]);
  }

  const activeCount = tokens.filter((t) => !t.isExpired && !t.isRevoked).length;
  const header = chalk.bold(`\nTokens (${activeCount} active, ${tokens.length} total)\n`);
  return header + table.toString();
}

/**
 * Truncate token name for display
 */
function truncateName(name: string, maxLength: number): string {
  if (name.length <= maxLength) return name;
  return name.substring(0, maxLength - 3) + "...";
}

/**
 * Format scopes for display
 */
function formatScopes(scopes: string[]): string {
  return scopes.join(", ");
}

/**
 * Format instances for display
 */
function formatInstances(instances: string[]): string {
  return instances.join(", ");
}

/**
 * Format expiration for table (short form)
 */
function formatExpirationShort(expiresAt: string | null, isExpired: boolean): string {
  if (!expiresAt) return chalk.gray("never");
  if (isExpired) return chalk.red(formatRelativeTime(expiresAt));
  return formatRelativeTime(expiresAt);
}

/**
 * Format tokens as JSON
 *
 * @param tokens - List of token display information
 * @returns Pretty-printed JSON string
 */
export function formatTokensJson(tokens: TokenDisplayInfo[]): string {
  return JSON.stringify(
    {
      totalTokens: tokens.length,
      activeTokens: tokens.filter((t) => !t.isExpired && !t.isRevoked).length,
      tokens: tokens.map((token) => ({
        id: truncateHash(token.hash),
        hash: token.hash,
        name: token.metadata.name,
        scopes: token.metadata.scopes,
        instanceAccess: token.metadata.instanceAccess,
        createdAt: token.metadata.createdAt,
        expiresAt: token.metadata.expiresAt,
        lastUsedAt: token.metadata.lastUsedAt,
        useCount: token.metadata.useCount,
        isExpired: token.isExpired,
        isRevoked: token.isRevoked,
        status: token.isRevoked ? "revoked" : token.isExpired ? "expired" : "active",
      })),
    },
    null,
    2
  );
}

/**
 * Format a newly created token for display
 *
 * Shows the raw token value in a prominent box with a warning that it will
 * never be shown again.
 *
 * @param rawToken - Raw token value (only shown once)
 * @param metadata - Token metadata
 * @returns Formatted string for display
 */
export function formatCreatedToken(rawToken: string, metadata: TokenMetadata): string {
  const boxWidth = 78;
  const border = "═".repeat(boxWidth);

  const lines: string[] = [];

  // Top border
  lines.push(chalk.yellow(`╔${border}╗`));

  // Warning header
  lines.push(
    chalk.yellow("║") +
      chalk.bgYellow.black(" IMPORTANT: Save this token now - it will NOT be shown again! ") +
      " ".repeat(boxWidth - 60) +
      chalk.yellow("║")
  );

  // Separator
  lines.push(chalk.yellow(`╠${border}╣`));

  // Token value with padding
  const tokenLine = `  Token: ${rawToken}`;
  const tokenPadding = " ".repeat(Math.max(0, boxWidth - tokenLine.length));
  lines.push(chalk.yellow("║") + chalk.cyan(tokenLine) + tokenPadding + chalk.yellow("║"));

  // Bottom border
  lines.push(chalk.yellow(`╚${border}╝`));

  // Token details
  const detailsLines: string[] = [
    "",
    chalk.bold("Token Details:"),
    `  Name:       ${chalk.cyan(metadata.name)}`,
    `  Scopes:     ${chalk.cyan(metadata.scopes.join(", "))}`,
    `  Instances:  ${chalk.cyan(metadata.instanceAccess.join(", "))}`,
    `  Created:    ${chalk.cyan(formatDate(metadata.createdAt))}`,
    `  Expires:    ${chalk.cyan(formatExpiration(metadata.expiresAt))}`,
  ];

  return lines.join("\n") + detailsLines.join("\n");
}

/**
 * Format expiration for details (long form)
 */
function formatExpiration(expiresAt: string | null): string {
  if (!expiresAt) return "never";
  const relativeTime = formatRelativeTime(expiresAt);
  return `${formatDate(expiresAt)} (${relativeTime})`;
}

/**
 * Format token revocation confirmation
 *
 * @param name - Token name that was revoked
 * @returns Formatted confirmation string
 */
export function formatTokenRevoked(name: string): string {
  return (
    chalk.green(`\nToken '${chalk.cyan(name)}' has been revoked.`) +
    "\n\n" +
    chalk.gray("The token can no longer be used for authentication.")
  );
}

/**
 * Format token rotation result
 *
 * Shows both the revocation of the old token and the new token value.
 *
 * @param name - Token name that was rotated
 * @param rawToken - New raw token value
 * @param metadata - New token metadata
 * @returns Formatted string for display
 */
export function formatTokenRotated(
  name: string,
  rawToken: string,
  metadata: TokenMetadata
): string {
  const revokedNote = chalk.gray(`\nOld token '${name}' has been revoked.\n`);

  return revokedNote + "\n" + formatCreatedToken(rawToken, metadata);
}

/**
 * Format revoke confirmation prompt
 *
 * @param name - Token name to revoke
 * @returns Formatted prompt string
 */
export function formatRevokeConfirmation(name: string): string {
  return (
    chalk.yellow(`\nRevoke token '${chalk.cyan(name)}'?\n`) +
    "\n" +
    chalk.gray(
      "This will permanently invalidate the token. Any applications using it will lose access."
    ) +
    "\n"
  );
}
