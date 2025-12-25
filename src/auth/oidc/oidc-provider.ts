/**
 * OIDC Provider Implementation
 *
 * Implements OpenID Connect authentication using authorization code flow with PKCE.
 * Uses the openid-client library for standards-compliant OIDC interactions.
 *
 * @module auth/oidc/provider
 */

import * as client from "openid-client";
import type { Logger } from "pino";
import { getComponentLogger } from "../../logging/index.js";
import type {
  OidcConfig,
  OidcProvider,
  OidcSession,
  OidcSessionStore,
  OidcUserInfo,
} from "./oidc-types.js";
import {
  OidcNotConfiguredError,
  OidcDiscoveryError,
  OidcAuthFlowError,
  OidcStateValidationError,
  OidcCodeExchangeError,
  OidcTokenRefreshError,
  OidcUserInfoError,
  OidcSessionNotFoundError,
} from "./oidc-errors.js";

/**
 * OIDC Provider Implementation
 *
 * Provides OpenID Connect authentication using the authorization code flow
 * with PKCE for enhanced security.
 *
 * @example
 * ```typescript
 * const provider = new OidcProviderImpl(config, sessionStore);
 *
 * // Check if OIDC is enabled
 * if (provider.isEnabled()) {
 *   // Start auth flow
 *   const session = await sessionStore.createSession();
 *   const authUrl = await provider.getAuthorizationUrl(session.sessionId);
 *   // Redirect user to authUrl
 *
 *   // Handle callback
 *   const updatedSession = await provider.handleCallback(sessionId, code, state);
 * }
 * ```
 */
export class OidcProviderImpl implements OidcProvider {
  /**
   * Lazy-initialized logger
   */
  private _logger: Logger | null = null;

  /**
   * Cached OIDC client configuration after discovery
   *
   * **Note**: Discovery is cached for the lifetime of this provider instance.
   * If the OIDC provider's discovery document changes (key rotation, endpoint updates),
   * the application must be restarted to pick up changes. This is intentional for
   * performance - discovery is an expensive network operation.
   */
  private clientConfig: client.Configuration | null = null;

  /**
   * Promise for in-progress discovery (prevents concurrent discovery)
   */
  private discoveryPromise: Promise<void> | null = null;

  /**
   * Create a new OIDC provider
   *
   * @param config - OIDC configuration
   * @param sessionStore - Session store for managing auth flow state
   */
  constructor(
    private readonly config: OidcConfig,
    private readonly sessionStore: OidcSessionStore
  ) {}

  /**
   * Lazy-initialized component logger
   */
  private get logger(): Logger {
    if (!this._logger) {
      this._logger = getComponentLogger("auth:oidc-provider");
    }
    return this._logger;
  }

  /**
   * Check if OIDC is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Get the current OIDC configuration
   */
  getConfig(): OidcConfig {
    return this.config;
  }

  /**
   * Ensure OIDC provider has been discovered
   *
   * Performs OIDC discovery if not already done.
   * Discovery is cached for the lifetime of the provider.
   */
  private async ensureDiscovered(): Promise<client.Configuration> {
    if (!this.config.enabled) {
      throw new OidcNotConfiguredError();
    }

    if (!this.config.issuer || !this.config.clientId || !this.config.clientSecret) {
      throw new OidcNotConfiguredError();
    }

    if (this.clientConfig) {
      return this.clientConfig;
    }

    // Prevent concurrent discovery
    if (!this.discoveryPromise) {
      this.discoveryPromise = this.performDiscovery();
    }

    await this.discoveryPromise;

    if (!this.clientConfig) {
      throw new OidcDiscoveryError(this.config.issuer);
    }

    return this.clientConfig;
  }

  /**
   * Perform OIDC discovery
   */
  private async performDiscovery(): Promise<void> {
    const startTime = performance.now();

    try {
      this.logger.info({ issuer: this.config.issuer }, "Discovering OIDC provider");

      this.clientConfig = await client.discovery(
        new URL(this.config.issuer!),
        this.config.clientId!,
        this.config.clientSecret
      );

      const durationMs = Math.round(performance.now() - startTime);
      this.logger.info(
        { metric: "oidc.discovery_ms", value: durationMs },
        "OIDC provider discovered successfully"
      );
    } catch (error) {
      const durationMs = Math.round(performance.now() - startTime);
      this.logger.error(
        { err: error, metric: "oidc.discovery_ms", value: durationMs },
        "OIDC discovery failed"
      );

      throw new OidcDiscoveryError(this.config.issuer!, error instanceof Error ? error : undefined);
    }
  }

  /**
   * Generate authorization URL for starting OIDC flow
   *
   * Creates PKCE challenge and stores state in session.
   *
   * @param sessionId - Session ID to associate with this auth flow
   * @param originalUrl - Optional URL to redirect to after authentication
   * @returns Authorization URL to redirect user to
   */
  async getAuthorizationUrl(sessionId: string, originalUrl?: string): Promise<string> {
    // Check session exists first (before network calls)
    const session = await this.sessionStore.getSession(sessionId);
    if (!session) {
      throw new OidcSessionNotFoundError(sessionId);
    }

    const clientConfig = await this.ensureDiscovered();

    // Generate PKCE values
    const codeVerifier = client.randomPKCECodeVerifier();
    const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
    const state = client.randomState();

    // Store auth flow state in session (including original URL for post-auth redirect)
    session.authFlowState = {
      state,
      codeVerifier,
      redirectUri: this.config.redirectUri!,
      originalUrl,
    };
    await this.sessionStore.updateSession(session);

    // Build authorization URL
    const authUrl = client.buildAuthorizationUrl(clientConfig, {
      redirect_uri: this.config.redirectUri!,
      scope: "openid email profile",
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });

    this.logger.debug(
      { sessionId, state: state.substring(0, 8) + "...", hasOriginalUrl: !!originalUrl },
      "Generated authorization URL"
    );

    return authUrl.href;
  }

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
  async handleCallback(sessionId: string, code: string, state: string): Promise<OidcSession> {
    // Check session exists and has auth flow state first (before network calls)
    const session = await this.sessionStore.getSession(sessionId);
    if (!session) {
      throw new OidcSessionNotFoundError(sessionId);
    }

    if (!session.authFlowState) {
      throw new OidcAuthFlowError("No pending auth flow for session");
    }

    const clientConfig = await this.ensureDiscovered();
    const startTime = performance.now();

    // Validate state parameter
    if (session.authFlowState.state !== state) {
      this.logger.warn(
        {
          sessionId,
          expectedState: session.authFlowState.state.substring(0, 8) + "...",
          receivedState: state.substring(0, 8) + "...",
        },
        "OIDC state mismatch"
      );
      throw new OidcStateValidationError();
    }

    try {
      // Exchange code for tokens
      const callbackParams = new URLSearchParams({ code, state });
      const callbackUrl = new URL(
        `${session.authFlowState.redirectUri}?${callbackParams.toString()}`
      );

      const tokens = await client.authorizationCodeGrant(clientConfig, callbackUrl, {
        pkceCodeVerifier: session.authFlowState.codeVerifier,
      });

      // Fetch user info
      let userInfo: OidcUserInfo;
      try {
        const claims = tokens.claims();
        const subClaim = claims?.sub;
        if (!subClaim) {
          throw new Error("No sub claim in token");
        }
        const userInfoResponse = await client.fetchUserInfo(
          clientConfig,
          tokens.access_token,
          subClaim
        );

        userInfo = {
          sub: userInfoResponse.sub,
          email:
            typeof userInfoResponse["email"] === "string" ? userInfoResponse["email"] : undefined,
          name: typeof userInfoResponse["name"] === "string" ? userInfoResponse["name"] : undefined,
          picture:
            typeof userInfoResponse["picture"] === "string"
              ? userInfoResponse["picture"]
              : undefined,
        };
      } catch (error) {
        // If userinfo fails, try to get info from ID token claims
        const claims = tokens.claims();
        if (claims?.sub) {
          userInfo = {
            sub: claims.sub,
            email: typeof claims["email"] === "string" ? claims["email"] : undefined,
            name: typeof claims["name"] === "string" ? claims["name"] : undefined,
          };
          this.logger.warn(
            { err: error, sessionId },
            "Userinfo endpoint failed, using ID token claims"
          );
        } else {
          throw new OidcUserInfoError(
            "Failed to get user info",
            error instanceof Error ? error : undefined
          );
        }
      }

      // Calculate token expiry
      const expiresIn = tokens.expires_in || 3600;
      const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

      // Update session with tokens and user info
      session.tokens = {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        idToken: tokens.id_token,
        tokenExpiresAt,
      };
      session.user = userInfo;
      session.mappedScopes = [...this.config.defaultScopes];
      session.mappedInstanceAccess = [...this.config.defaultInstanceAccess];
      session.expiresAt = tokenExpiresAt;

      // Clear auth flow state (no longer needed)
      delete session.authFlowState;

      await this.sessionStore.updateSession(session);

      const durationMs = Math.round(performance.now() - startTime);
      this.logger.info(
        {
          sessionId,
          sub: userInfo.sub,
          metric: "oidc.callback_ms",
          value: durationMs,
        },
        "OIDC authentication successful"
      );

      return session;
    } catch (error) {
      if (error instanceof OidcStateValidationError || error instanceof OidcUserInfoError) {
        throw error;
      }

      const durationMs = Math.round(performance.now() - startTime);
      this.logger.error(
        { err: error, sessionId, metric: "oidc.callback_ms", value: durationMs },
        "OIDC code exchange failed"
      );

      throw new OidcCodeExchangeError(
        error instanceof Error ? error.message : "Unknown error",
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Refresh access token using refresh token
   *
   * @param sessionId - Session ID to refresh
   * @returns Updated session with new tokens
   */
  async refreshToken(sessionId: string): Promise<OidcSession> {
    // Check session exists and has refresh token first (before network calls)
    const session = await this.sessionStore.getSession(sessionId);
    if (!session) {
      throw new OidcSessionNotFoundError(sessionId);
    }

    if (!session.tokens?.refreshToken) {
      throw new OidcTokenRefreshError(undefined, false);
    }

    const clientConfig = await this.ensureDiscovered();
    const startTime = performance.now();

    try {
      const tokens = await client.refreshTokenGrant(clientConfig, session.tokens.refreshToken);

      // Calculate new expiry
      const expiresIn = tokens.expires_in || 3600;
      const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

      // Update session tokens
      session.tokens = {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || session.tokens.refreshToken,
        idToken: tokens.id_token,
        tokenExpiresAt,
      };
      session.expiresAt = tokenExpiresAt;

      await this.sessionStore.updateSession(session);

      const durationMs = Math.round(performance.now() - startTime);
      this.logger.debug(
        { sessionId, metric: "oidc.refresh_ms", value: durationMs },
        "Token refreshed successfully"
      );

      return session;
    } catch (error) {
      const durationMs = Math.round(performance.now() - startTime);
      this.logger.error(
        { err: error, sessionId, metric: "oidc.refresh_ms", value: durationMs },
        "Token refresh failed"
      );

      throw new OidcTokenRefreshError(
        error instanceof Error ? error : undefined,
        true // Retryable for transient errors
      );
    }
  }

  /**
   * Get user info for a session
   *
   * @param sessionId - Session ID to get user for
   * @returns User info from session
   */
  async getUserInfo(sessionId: string): Promise<OidcUserInfo> {
    const session = await this.sessionStore.getSession(sessionId);
    if (!session) {
      throw new OidcSessionNotFoundError(sessionId);
    }

    if (!session.user) {
      throw new OidcAuthFlowError("No user info available - authentication not complete");
    }

    return session.user;
  }

  /**
   * End OIDC session (logout)
   *
   * @param sessionId - Session ID to end
   */
  async logout(sessionId: string): Promise<void> {
    await this.sessionStore.deleteSession(sessionId);
    this.logger.info({ sessionId }, "OIDC session ended");
  }
}
