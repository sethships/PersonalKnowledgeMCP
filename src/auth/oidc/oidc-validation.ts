/**
 * OIDC Module Validation Schemas
 *
 * Zod schemas for validating OIDC configuration and session data.
 *
 * @module auth/oidc/validation
 */

import { z } from "zod";
import { TokenScopeSchema, InstanceAccessSchema } from "../validation.js";

/**
 * UUID format validation for session IDs
 */
export const SessionIdSchema = z.string().uuid("Session ID must be a valid UUID");

/**
 * OIDC issuer URL validation
 */
export const OidcIssuerSchema = z
  .string()
  .url("OIDC issuer must be a valid URL")
  .refine(
    (url) => url.startsWith("https://") || url.startsWith("http://localhost"),
    "OIDC issuer must use HTTPS (except localhost for development)"
  );

/**
 * OIDC redirect URI validation
 */
export const OidcRedirectUriSchema = z.string().url("OIDC redirect URI must be a valid URL");

/**
 * OIDC configuration validation schema
 *
 * When enabled=true, all required fields must be present.
 * When enabled=false, other fields are optional.
 */
export const OidcConfigSchema = z
  .object({
    enabled: z.boolean(),

    issuer: OidcIssuerSchema.optional(),

    clientId: z.string().min(1, "OIDC client ID is required when OIDC is enabled").optional(),

    clientSecret: z
      .string()
      .min(1, "OIDC client secret is required when OIDC is enabled")
      .optional(),

    redirectUri: OidcRedirectUriSchema.optional(),

    defaultScopes: z
      .array(TokenScopeSchema)
      .min(1, "At least one default scope is required")
      .default(["read"]),

    defaultInstanceAccess: z
      .array(InstanceAccessSchema)
      .min(1, "At least one default instance access is required")
      .default(["public"]),

    sessionTtlSeconds: z
      .number()
      .int("Session TTL must be a whole number")
      .positive("Session TTL must be positive")
      .max(86400 * 30, "Session TTL cannot exceed 30 days")
      .default(3600),

    refreshBeforeExpirySeconds: z
      .number()
      .int("Refresh threshold must be a whole number")
      .nonnegative("Refresh threshold must be non-negative")
      .default(300),

    cookieSecure: z
      .boolean()
      .optional()
      .describe("Whether to set the Secure flag on OIDC session cookies"),

    cookieName: z
      .string()
      .min(1, "Cookie name must not be empty")
      .max(64, "Cookie name must not exceed 64 characters")
      .regex(
        /^[a-zA-Z0-9_-]+$/,
        "Cookie name must only contain alphanumeric characters, hyphens, and underscores"
      )
      .default("pk_mcp_oidc_session")
      .describe("Name of the OIDC session cookie"),
  })
  .refine(
    (data) => {
      // If OIDC is disabled, no further validation needed
      if (!data.enabled) return true;

      // If enabled, all required fields must be present
      return !!(data.issuer && data.clientId && data.clientSecret && data.redirectUri);
    },
    {
      message: "When OIDC is enabled, issuer, clientId, clientSecret, and redirectUri are required",
    }
  );

/**
 * OIDC user info validation
 */
export const OidcUserInfoSchema = z.object({
  sub: z.string().min(1, "OIDC subject (sub) is required"),
  email: z.string().email().optional(),
  name: z.string().optional(),
  picture: z.string().url().optional(),
});

/**
 * OIDC auth flow state validation (stored during authorization)
 */
export const OidcAuthFlowStateSchema = z.object({
  state: z.string().min(1, "OIDC state is required"),
  codeVerifier: z
    .string()
    .min(43, "PKCE code verifier must be at least 43 characters (RFC 7636)")
    .max(128, "PKCE code verifier must not exceed 128 characters (RFC 7636)")
    .regex(
      /^[A-Za-z0-9._~-]+$/,
      "PKCE code verifier must only contain unreserved URI characters (RFC 7636)"
    ),
  redirectUri: z.string().url("Redirect URI must be a valid URL"),
  originalUrl: z
    .string()
    .refine((val) => {
      // Allow relative paths (starting with /) or full URLs
      if (val.startsWith("/")) {
        return true;
      }
      try {
        new URL(val);
        return true;
      } catch {
        return false;
      }
    }, "Original URL must be a valid URL or relative path")
    .optional(),
});

/**
 * OIDC tokens validation
 */
export const OidcTokensSchema = z.object({
  accessToken: z.string().min(1, "Access token is required"),
  refreshToken: z.string().optional(),
  idToken: z.string().optional(),
  tokenExpiresAt: z.string().datetime({ message: "tokenExpiresAt must be ISO 8601 format" }),
});

/**
 * OIDC session validation
 */
export const OidcSessionSchema = z.object({
  sessionId: SessionIdSchema,
  createdAt: z.string().datetime({ message: "createdAt must be ISO 8601 format" }),
  expiresAt: z.string().datetime({ message: "expiresAt must be ISO 8601 format" }),
  authFlowState: OidcAuthFlowStateSchema.optional(),
  user: OidcUserInfoSchema.optional(),
  tokens: OidcTokensSchema.optional(),
  mappedScopes: z.array(TokenScopeSchema),
  mappedInstanceAccess: z.array(InstanceAccessSchema),
});

/**
 * OIDC session store file format validation
 */
export const OidcSessionStoreFileSchema = z.object({
  version: z.literal("1.0"),
  sessions: z.record(z.string(), OidcSessionSchema),
});

// Inferred types for use with validated data
export type ValidatedOidcConfig = z.infer<typeof OidcConfigSchema>;
export type ValidatedOidcUserInfo = z.infer<typeof OidcUserInfoSchema>;
export type ValidatedOidcAuthFlowState = z.infer<typeof OidcAuthFlowStateSchema>;
export type ValidatedOidcTokens = z.infer<typeof OidcTokensSchema>;
export type ValidatedOidcSession = z.infer<typeof OidcSessionSchema>;
export type ValidatedOidcSessionStoreFile = z.infer<typeof OidcSessionStoreFileSchema>;
