/**
 * OIDC Module Error Classes
 *
 * Domain-specific error types for OIDC authentication operations.
 * All errors extend AuthError and include a retryable flag.
 *
 * @module auth/oidc/errors
 */

import { AuthError } from "../errors.js";

/**
 * Base class for OIDC-specific errors
 *
 * Extends AuthError to maintain consistent error handling patterns.
 */
export abstract class OidcError extends AuthError {
  constructor(message: string, code: string, retryable: boolean = false) {
    super(message, code, retryable);
  }
}

/**
 * OIDC provider is not configured or disabled
 *
 * Not retryable - administrator must configure OIDC.
 */
export class OidcNotConfiguredError extends OidcError {
  constructor() {
    super("OIDC authentication is not configured or disabled", "OIDC_NOT_CONFIGURED", false);
  }
}

/**
 * OIDC provider discovery failed
 *
 * May be retryable - IdP could be temporarily unavailable.
 */
export class OidcDiscoveryError extends OidcError {
  /** Underlying error that caused the discovery failure */
  public override readonly cause?: Error;

  constructor(
    public readonly issuer: string,
    cause?: Error
  ) {
    super(
      `Failed to discover OIDC provider at ${issuer}`,
      "OIDC_DISCOVERY_FAILED",
      true // Retryable - IdP may be temporarily unavailable
    );
    this.cause = cause;
  }
}

/**
 * OIDC authorization flow error
 *
 * Not retryable - user must restart the authorization flow.
 */
export class OidcAuthFlowError extends OidcError {
  /** Underlying error that caused the auth flow failure */
  public override readonly cause?: Error;

  constructor(message: string, cause?: Error) {
    super(message, "OIDC_AUTH_FLOW_ERROR", false);
    this.cause = cause;
  }
}

/**
 * OIDC state parameter validation failed
 *
 * Not retryable - indicates potential CSRF attack or session issue.
 * User must restart the authorization flow.
 */
export class OidcStateValidationError extends OidcError {
  constructor() {
    super(
      "OIDC state parameter validation failed - possible CSRF attack or session expired",
      "OIDC_STATE_INVALID",
      false
    );
  }
}

/**
 * OIDC session not found or expired
 *
 * Not retryable - user must re-authenticate.
 */
export class OidcSessionNotFoundError extends OidcError {
  constructor(public readonly sessionId?: string) {
    super(
      sessionId
        ? `OIDC session not found: ${sessionId.substring(0, 8)}...`
        : "OIDC session not found",
      "OIDC_SESSION_NOT_FOUND",
      false
    );
  }
}

/**
 * OIDC session has expired
 *
 * Not retryable - user must re-authenticate.
 */
export class OidcSessionExpiredError extends OidcError {
  constructor(
    public readonly sessionId: string,
    public readonly expiredAt: string
  ) {
    super(`OIDC session expired at ${expiredAt}`, "OIDC_SESSION_EXPIRED", false);
  }
}

/**
 * OIDC token refresh failed
 *
 * May be retryable - IdP could be temporarily unavailable.
 * If refresh token is invalid/expired, user must re-authenticate.
 */
export class OidcTokenRefreshError extends OidcError {
  /** Underlying error that caused the refresh failure */
  public override readonly cause?: Error;

  constructor(cause?: Error, retryable: boolean = true) {
    super("Failed to refresh OIDC token", "OIDC_TOKEN_REFRESH_FAILED", retryable);
    this.cause = cause;
  }
}

/**
 * OIDC code exchange failed
 *
 * Not retryable - user must restart the authorization flow.
 */
export class OidcCodeExchangeError extends OidcError {
  /** Underlying error that caused the code exchange failure */
  public override readonly cause?: Error;

  constructor(message: string, cause?: Error) {
    super(`OIDC code exchange failed: ${message}`, "OIDC_CODE_EXCHANGE_FAILED", false);
    this.cause = cause;
  }
}

/**
 * OIDC user info fetch failed
 *
 * May be retryable - IdP could be temporarily unavailable.
 */
export class OidcUserInfoError extends OidcError {
  /** Underlying error that caused the userinfo failure */
  public override readonly cause?: Error;

  constructor(message: string, cause?: Error) {
    super(`Failed to fetch OIDC user info: ${message}`, "OIDC_USERINFO_FAILED", true);
    this.cause = cause;
  }
}

/**
 * OIDC session storage operation failed
 *
 * May be retryable depending on the underlying cause.
 */
export class OidcSessionStorageError extends OidcError {
  /** Underlying error that caused the storage failure */
  public override readonly cause?: Error;

  constructor(
    public readonly operation: "read" | "write" | "delete",
    message: string,
    cause?: Error,
    retryable: boolean = false
  ) {
    super(
      `OIDC session storage ${operation} failed: ${message}`,
      "OIDC_SESSION_STORAGE_ERROR",
      retryable
    );
    this.cause = cause;
  }
}
