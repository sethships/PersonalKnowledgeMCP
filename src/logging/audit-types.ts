/**
 * Audit Logging Type Definitions
 *
 * Defines the schema for security audit events. All events share a common
 * base structure with event-specific details for security and compliance.
 *
 * Design principles:
 * - Never log raw tokens (only first 8 chars of hash)
 * - Never log passwords or secrets
 * - Include correlation IDs for tracing
 * - Structured format for querying
 *
 * @module logging/audit-types
 */

/**
 * All audit event types
 *
 * Categories:
 * - auth.*: Authentication events (success/failure)
 * - token.*: Token lifecycle (create/revoke/delete)
 * - instance.*: Instance access control
 * - scope.*: Scope authorization
 * - config.*: Configuration changes
 * - session.*: OIDC session lifecycle
 */
export type AuditEventType =
  | "auth.success"
  | "auth.failure"
  | "token.created"
  | "token.revoked"
  | "token.deleted"
  | "instance.access"
  | "instance.denied"
  | "scope.denied"
  | "config.changed"
  | "session.created"
  | "session.expired"
  | "session.invalidated";

/**
 * Authentication method used
 */
export type AuthMethod = "bearer" | "oidc";

/**
 * Authentication failure reasons
 */
export type AuthFailureReason =
  | "missing"
  | "invalid"
  | "expired"
  | "revoked"
  | "not_found"
  | "format";

/**
 * Token identifier for audit logging
 *
 * SECURITY: Only log hash prefix (8 chars) to prevent correlation attacks
 * while still allowing admin to identify tokens when investigating.
 */
export interface TokenIdentifier {
  /** First 8 characters of token hash (SHA-256) */
  tokenHashPrefix: string;

  /** Human-readable token name (optional) */
  tokenName?: string;
}

/**
 * User identifier for OIDC sessions
 */
export interface UserIdentifier {
  /** OIDC subject claim */
  sub?: string;

  /** User email (if available from claims) */
  email?: string;

  /** Session ID prefix (first 8 chars) for correlation */
  sessionIdPrefix?: string;
}

/**
 * Base audit event structure
 *
 * All audit events include these common fields.
 */
export interface AuditEventBase {
  /** ISO 8601 timestamp when event occurred */
  timestamp: string;

  /** Event type for categorization and filtering */
  eventType: AuditEventType;

  /** Request/correlation ID from x-request-id header */
  requestId?: string;

  /** Whether the action succeeded */
  success: boolean;

  /** Source IP address (from X-Forwarded-For or req.ip) */
  sourceIp?: string;

  /** Instance being accessed (private, work, public) */
  instance?: string;
}

// ============================================================================
// Authentication Events
// ============================================================================

/**
 * Authentication success event
 */
export interface AuthSuccessEvent extends AuditEventBase {
  eventType: "auth.success";
  success: true;
  token?: TokenIdentifier;
  user?: UserIdentifier;
  authMethod: AuthMethod;
}

/**
 * Authentication failure event
 */
export interface AuthFailureEvent extends AuditEventBase {
  eventType: "auth.failure";
  success: false;
  reason: AuthFailureReason;
  token?: TokenIdentifier;
  authMethod: AuthMethod;
}

// ============================================================================
// Token Lifecycle Events
// ============================================================================

/**
 * Token created event
 */
export interface TokenCreatedEvent extends AuditEventBase {
  eventType: "token.created";
  success: true;
  token: TokenIdentifier;
  scopes: string[];
  instanceAccess: string[];
  expiresAt: string | null;
}

/**
 * Token revoked event
 */
export interface TokenRevokedEvent extends AuditEventBase {
  eventType: "token.revoked";
  success: true;
  token: TokenIdentifier;
}

/**
 * Token deleted event
 */
export interface TokenDeletedEvent extends AuditEventBase {
  eventType: "token.deleted";
  success: true;
  token: TokenIdentifier;
}

// ============================================================================
// Instance Access Events
// ============================================================================

/**
 * Instance access granted event
 */
export interface InstanceAccessEvent extends AuditEventBase {
  eventType: "instance.access";
  success: true;
  token?: TokenIdentifier;
  user?: UserIdentifier;
}

/**
 * Instance access denied event
 */
export interface InstanceDeniedEvent extends AuditEventBase {
  eventType: "instance.denied";
  success: false;
  token?: TokenIdentifier;
  user?: UserIdentifier;
  requestedInstance: string;
  allowedInstances: string[];
}

// ============================================================================
// Scope Authorization Events
// ============================================================================

/**
 * Scope denied event
 */
export interface ScopeDeniedEvent extends AuditEventBase {
  eventType: "scope.denied";
  success: false;
  token?: TokenIdentifier;
  user?: UserIdentifier;
  requiredScope: string;
  grantedScopes: string[];
}

// ============================================================================
// Configuration Events
// ============================================================================

/**
 * Configuration change types
 */
export type ConfigChangeType = "user-mapping" | "rate-limit" | "cors" | "instance";

/**
 * Configuration changed event
 */
export interface ConfigChangedEvent extends AuditEventBase {
  eventType: "config.changed";
  success: true;
  configType: ConfigChangeType;
  changedBy?: TokenIdentifier | UserIdentifier;
  /** Brief description of what changed */
  changes?: string;
}

// ============================================================================
// OIDC Session Events
// ============================================================================

/**
 * Session invalidation reasons
 */
export type SessionInvalidationReason = "logout" | "revoked" | "admin";

/**
 * OIDC session created event
 */
export interface SessionCreatedEvent extends AuditEventBase {
  eventType: "session.created";
  success: true;
  user: UserIdentifier;
  /** Scopes granted to the session (for OIDC) */
  scopes?: string[];
  /** Instance access granted to the session (for OIDC) */
  instanceAccess?: string[];
}

/**
 * OIDC session expired event
 */
export interface SessionExpiredEvent extends AuditEventBase {
  eventType: "session.expired";
  success: true;
  user: UserIdentifier;
}

/**
 * OIDC session invalidated event
 */
export interface SessionInvalidatedEvent extends AuditEventBase {
  eventType: "session.invalidated";
  success: true;
  user: UserIdentifier;
  reason: SessionInvalidationReason;
}

// ============================================================================
// Union Type
// ============================================================================

/**
 * Union type of all audit events
 */
export type AuditEvent =
  | AuthSuccessEvent
  | AuthFailureEvent
  | TokenCreatedEvent
  | TokenRevokedEvent
  | TokenDeletedEvent
  | InstanceAccessEvent
  | InstanceDeniedEvent
  | ScopeDeniedEvent
  | ConfigChangedEvent
  | SessionCreatedEvent
  | SessionExpiredEvent
  | SessionInvalidatedEvent;

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Audit logger configuration
 */
export interface AuditLoggerConfig {
  /** Enable/disable audit logging */
  enabled: boolean;

  /** Path to audit log file */
  logPath: string;

  /** Maximum log file size in bytes before rotation (default: 10MB) */
  maxFileSize: number;

  /** Number of rotated files to keep (default: 10) */
  maxFiles: number;

  /** Retention period in days (0 = no auto-cleanup, default: 90) */
  retentionDays: number;
}

// ============================================================================
// Query Types
// ============================================================================

/**
 * Query options for audit log search
 */
export interface AuditQueryOptions {
  /** Filter by event types */
  eventTypes?: AuditEventType[];

  /** Start timestamp (ISO 8601) - inclusive */
  startTime?: string;

  /** End timestamp (ISO 8601) - inclusive */
  endTime?: string;

  /** Filter by token hash prefix */
  tokenHashPrefix?: string;

  /** Filter by user email */
  userEmail?: string;

  /** Filter by success/failure */
  success?: boolean;

  /** Filter by instance */
  instance?: string;

  /** Maximum results (default: 100) */
  limit?: number;

  /** Offset for pagination (default: 0) */
  offset?: number;
}

/**
 * Query result
 */
export interface AuditQueryResult {
  /** Matching events */
  events: AuditEvent[];

  /** Total count of matching events (for pagination) */
  total: number;

  /** Whether more results are available */
  hasMore: boolean;
}

// ============================================================================
// Audit Logger Interface
// ============================================================================

/**
 * Audit logger interface
 *
 * Implementations must be fire-and-forget (non-blocking).
 */
export interface AuditLogger {
  /**
   * Emit an audit event (fire-and-forget)
   *
   * @param event - Audit event to log
   */
  emit(event: AuditEvent): void;

  /**
   * Query audit events from log files
   *
   * @param options - Query filter options
   * @returns Matching events with pagination info
   */
  query(options: AuditQueryOptions): Promise<AuditQueryResult>;

  /**
   * Check if audit logging is enabled
   */
  isEnabled(): boolean;

  /**
   * Check if circuit breaker is open (logging paused due to failures)
   */
  isCircuitOpen(): boolean;

  /**
   * Get the path to the current audit log file
   */
  getLogPath(): string;
}
