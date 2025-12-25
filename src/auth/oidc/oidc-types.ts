/**
 * OIDC Module Type Definitions
 *
 * Defines types for OpenID Connect authentication including session management,
 * configuration, and provider interfaces.
 *
 * @module auth/oidc/types
 */

import type { TokenScope, InstanceAccess } from "../types.js";

/**
 * OIDC provider configuration
 */
export interface OidcConfig {
  /** Whether OIDC authentication is enabled */
  enabled: boolean;

  /** OIDC issuer URL (e.g., https://tenant.auth0.com/) */
  issuer?: string;

  /** OAuth2 client ID */
  clientId?: string;

  /** OAuth2 client secret */
  clientSecret?: string;

  /** Redirect URI for authorization callback */
  redirectUri?: string;

  /** Default scopes assigned to all OIDC-authenticated users */
  defaultScopes: TokenScope[];

  /** Default instance access levels for OIDC users */
  defaultInstanceAccess: InstanceAccess[];

  /** Session TTL in seconds (default: 3600) */
  sessionTtlSeconds: number;

  /** Refresh token this many seconds before expiry (default: 300) */
  refreshBeforeExpirySeconds: number;

  /**
   * Whether to set the Secure flag on OIDC session cookies.
   * - true: Cookies only sent over HTTPS (recommended for production)
   * - false: Cookies sent over HTTP and HTTPS (for local development)
   * - undefined: Auto-detect based on NODE_ENV (secure if production)
   */
  cookieSecure?: boolean;

  /**
   * Name of the OIDC session cookie.
   * Default: "pk_mcp_oidc_session"
   *
   * Customize to avoid conflicts when multiple instances share the same domain.
   */
  cookieName: string;
}

/**
 * User information extracted from OIDC claims
 */
export interface OidcUserInfo {
  /** OIDC subject identifier (unique user ID from IdP) */
  sub: string;

  /** User's email address */
  email?: string;

  /** User's display name */
  name?: string;

  /** User's profile picture URL */
  picture?: string;
}

/**
 * PKCE and state data stored during authorization flow
 */
export interface OidcAuthFlowState {
  /** Random state parameter for CSRF protection */
  state: string;

  /** PKCE code verifier (kept secret, used during code exchange) */
  codeVerifier: string;

  /** Redirect URI used for this auth flow */
  redirectUri: string;

  /** Original URL the user was trying to access (for post-auth redirect) */
  originalUrl?: string;
}

/**
 * OIDC tokens received from the identity provider
 */
export interface OidcTokens {
  /** Access token for API calls */
  accessToken: string;

  /** Refresh token for obtaining new access tokens */
  refreshToken?: string;

  /** ID token containing user claims */
  idToken?: string;

  /** ISO 8601 timestamp when access token expires */
  tokenExpiresAt: string;
}

/**
 * OIDC session stored for authenticated users
 */
export interface OidcSession {
  /** Unique session identifier (UUID) */
  sessionId: string;

  /** ISO 8601 timestamp when session was created */
  createdAt: string;

  /** ISO 8601 timestamp when session expires */
  expiresAt: string;

  /** Auth flow state (present during authorization, cleared after callback) */
  authFlowState?: OidcAuthFlowState;

  /** User information (present after successful authentication) */
  user?: OidcUserInfo;

  /** OIDC tokens (present after successful authentication) */
  tokens?: OidcTokens;

  /** Mapped permission scopes for this user */
  mappedScopes: TokenScope[];

  /** Mapped instance access levels for this user */
  mappedInstanceAccess: InstanceAccess[];

  /**
   * Optimistic locking version number
   * Incremented on each update to detect concurrent modifications
   */
  version?: number;
}

/**
 * Session storage interface for OIDC sessions
 *
 * Abstracts the underlying storage mechanism (file-based for MVP).
 */
export interface OidcSessionStore {
  /**
   * Create a new empty session for starting an auth flow
   *
   * @returns New session with generated ID
   */
  createSession(): Promise<OidcSession>;

  /**
   * Retrieve a session by ID
   *
   * @param sessionId - Session ID to look up
   * @returns Session if found and not expired, null otherwise
   */
  getSession(sessionId: string): Promise<OidcSession | null>;

  /**
   * Update an existing session
   *
   * @param session - Session to update (must have valid sessionId)
   */
  updateSession(session: OidcSession): Promise<void>;

  /**
   * Delete a session (for logout)
   *
   * @param sessionId - Session ID to delete
   */
  deleteSession(sessionId: string): Promise<void>;

  /**
   * Clean up expired sessions
   *
   * @returns Number of sessions cleaned up
   */
  cleanExpiredSessions(): Promise<number>;

  /**
   * Get storage file path (for logging/diagnostics)
   *
   * @returns Absolute path to storage file
   */
  getStoragePath(): string;

  /**
   * Invalidate any in-memory cache
   *
   * Used after external modifications or for testing.
   */
  invalidateCache(): void;

  /**
   * Start automatic session cleanup
   *
   * Schedules periodic cleanup of expired sessions.
   *
   * @param intervalMs - Cleanup interval in milliseconds (default: 300000 = 5 minutes)
   */
  startAutoCleanup(intervalMs?: number): void;

  /**
   * Stop automatic session cleanup
   *
   * Cancels the periodic cleanup interval.
   */
  stopAutoCleanup(): void;

  /**
   * Check if automatic cleanup is running
   *
   * @returns True if cleanup interval is active
   */
  isAutoCleanupRunning(): boolean;
}

/**
 * OIDC provider interface for authentication operations
 */
export interface OidcProvider {
  /**
   * Check if OIDC is enabled
   *
   * @returns True if OIDC is configured and enabled
   */
  isEnabled(): boolean;

  /**
   * Generate authorization URL for starting OIDC flow
   *
   * Creates PKCE challenge and stores state in session.
   *
   * @param sessionId - Session ID to associate with this auth flow
   * @param originalUrl - Optional URL to redirect to after authentication
   * @returns Authorization URL to redirect user to
   */
  getAuthorizationUrl(sessionId: string, originalUrl?: string): Promise<string>;

  /**
   * Handle authorization callback from IdP
   *
   * Validates state, exchanges code for tokens, fetches user info.
   *
   * @param sessionId - Session ID from cookie
   * @param code - Authorization code from IdP
   * @param state - State parameter from IdP (for validation)
   * @returns Updated session with user info and tokens
   */
  handleCallback(sessionId: string, code: string, state: string): Promise<OidcSession>;

  /**
   * Refresh access token using refresh token
   *
   * @param sessionId - Session ID to refresh
   * @returns Updated session with new tokens
   */
  refreshToken(sessionId: string): Promise<OidcSession>;

  /**
   * Get user info for a session
   *
   * @param sessionId - Session ID to get user for
   * @returns User info from session
   */
  getUserInfo(sessionId: string): Promise<OidcUserInfo>;

  /**
   * End OIDC session (logout)
   *
   * @param sessionId - Session ID to end
   */
  logout(sessionId: string): Promise<void>;

  /**
   * Get OIDC configuration
   *
   * @returns Current OIDC configuration
   */
  getConfig(): OidcConfig;
}

/**
 * Session store file format for persistence
 */
export interface OidcSessionStoreFile {
  /** File format version */
  version: "1.0";

  /** Map of session ID to session data */
  sessions: Record<string, OidcSession>;
}

/**
 * Default OIDC session cookie name
 *
 * This is the default value used when OIDC_COOKIE_NAME is not configured.
 * Prefer using config.cookieName for runtime cookie name.
 */
export const OIDC_SESSION_COOKIE = "pk_mcp_oidc_session";
