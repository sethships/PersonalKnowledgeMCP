/**
 * User Mapping Service Implementation
 *
 * Resolves user claims to scopes and instance access based on configured rules.
 * Implements priority-based rule matching with comprehensive audit logging.
 *
 * @module auth/user-mapping/service
 */

import type { Logger } from "pino";
import type {
  UserMappingService,
  UserMappingStore,
  UserMappingRule,
  UserMappingConfig,
  NormalizedClaims,
  ResolvedMapping,
  MappingAuditEntry,
} from "./user-mapping-types.js";
import type { TokenScope, InstanceAccess } from "../types.js";
import { UserMappingNotConfiguredError } from "./user-mapping-errors.js";
import { getComponentLogger } from "../../logging/index.js";

/**
 * User mapping service implementation
 *
 * Resolves user claims to permissions using configured mapping rules.
 * Rules are evaluated in priority order (highest first) and the first
 * matching rule wins (no permission merging).
 *
 * **Features:**
 * - Priority-based rule evaluation
 * - Support for email, wildcard, group, and role matching
 * - Comprehensive audit logging
 * - Automatic rule reload when store changes
 *
 * @example
 * ```typescript
 * const service = new UserMappingServiceImpl(store, config, ["read"], ["public"]);
 *
 * const claims: NormalizedClaims = {
 *   sub: "user123",
 *   email: "user@company.com",
 *   groups: ["developers"],
 *   roles: ["admin"]
 * };
 *
 * const mapping = await service.resolveMapping(claims);
 * console.log(mapping.scopes); // ["read", "write", "admin"]
 * console.log(mapping.instanceAccess); // ["private", "work", "public"]
 * ```
 */
export class UserMappingServiceImpl implements UserMappingService {
  /**
   * User mapping store instance
   */
  private readonly store: UserMappingStore;

  /**
   * User mapping configuration
   */
  private readonly config: UserMappingConfig;

  /**
   * Default scopes when no rule matches
   */
  private readonly defaultScopes: TokenScope[];

  /**
   * Default instance access when no rule matches
   */
  private readonly defaultInstanceAccess: InstanceAccess[];

  /**
   * Lazy-initialized logger
   */
  private _logger: Logger | null = null;

  /**
   * Whether the service is ready (initialized)
   */
  private ready: boolean = false;

  /**
   * Cached rules sorted by priority
   */
  private sortedRulesCache: UserMappingRule[] | null = null;

  /**
   * Create a new user mapping service
   *
   * @param store - User mapping store for rule persistence
   * @param config - User mapping configuration
   * @param defaultScopes - Default scopes when no rule matches
   * @param defaultInstanceAccess - Default instance access when no rule matches
   */
  constructor(
    store: UserMappingStore,
    config: UserMappingConfig,
    defaultScopes: TokenScope[] = ["read"],
    defaultInstanceAccess: InstanceAccess[] = ["public"]
  ) {
    this.store = store;
    this.config = config;
    this.defaultScopes = defaultScopes;
    this.defaultInstanceAccess = defaultInstanceAccess;

    // Register for rule change notifications
    this.store.onRulesChanged(() => {
      this.invalidateRulesCache();
    });
  }

  /**
   * Lazy-initialized component logger
   */
  private get logger(): Logger {
    if (!this._logger) {
      this._logger = getComponentLogger("auth:user-mapping-service");
    }
    return this._logger;
  }

  /**
   * Resolve user claims to scopes and instance access
   *
   * Evaluates rules in priority order (highest first).
   * First matching rule wins - permissions are not merged.
   *
   * @param claims - Normalized user claims
   * @returns Resolved mapping with matched rule info
   * @throws {UserMappingNotConfiguredError} If mapping is disabled
   */
  async resolveMapping(claims: NormalizedClaims): Promise<ResolvedMapping> {
    if (!this.config.enabled) {
      throw new UserMappingNotConfiguredError();
    }

    const startTime = performance.now();

    // Get sorted rules (uses cache if available)
    const rules = await this.getSortedActiveRules();

    // Find first matching rule
    for (const rule of rules) {
      if (this.matchesRule(rule, claims)) {
        const result: ResolvedMapping = {
          scopes: [...rule.scopes],
          instanceAccess: [...rule.instanceAccess],
          matchedRule: rule,
          matchedPattern: rule.pattern,
          isDefault: false,
        };

        this.logAuditEntry(claims, rule, result, rules.length, startTime);
        this.ready = true;

        return result;
      }
    }

    // No match - use defaults
    const defaultResult: ResolvedMapping = {
      scopes: [...this.defaultScopes],
      instanceAccess: [...this.defaultInstanceAccess],
      matchedRule: null,
      matchedPattern: null,
      isDefault: true,
    };

    this.logAuditEntry(claims, null, defaultResult, rules.length, startTime);
    this.ready = true;

    return defaultResult;
  }

  /**
   * Get all configured mapping rules
   *
   * @returns Array of all rules (enabled and disabled)
   */
  async getAllRules(): Promise<UserMappingRule[]> {
    return this.store.loadRules();
  }

  /**
   * Reload rules from storage
   *
   * Called automatically when file watcher detects changes.
   */
  async reloadRules(): Promise<void> {
    this.invalidateRulesCache();
    await this.store.loadRules();
    this.logger.info("Rules reloaded");
  }

  /**
   * Check if the service is ready
   *
   * @returns True if service has successfully resolved at least one mapping
   */
  isReady(): boolean {
    return this.ready;
  }

  /**
   * Get sorted active rules (cached for performance)
   */
  private async getSortedActiveRules(): Promise<UserMappingRule[]> {
    if (this.sortedRulesCache !== null) {
      return this.sortedRulesCache;
    }

    const allRules = await this.store.loadRules();

    // Filter enabled rules and sort by priority (descending)
    this.sortedRulesCache = allRules
      .filter((rule) => rule.enabled)
      .sort((a, b) => b.priority - a.priority);

    return this.sortedRulesCache;
  }

  /**
   * Invalidate the sorted rules cache
   */
  private invalidateRulesCache(): void {
    this.sortedRulesCache = null;
  }

  /**
   * Check if a rule matches the given claims
   *
   * @param rule - Rule to check
   * @param claims - Normalized user claims
   * @returns True if rule matches
   */
  private matchesRule(rule: UserMappingRule, claims: NormalizedClaims): boolean {
    switch (rule.type) {
      case "email":
        return this.matchesExactEmail(rule.pattern, claims.email);

      case "email_wildcard":
        return this.matchesEmailWildcard(rule.pattern, claims.email);

      case "group":
        return this.matchesGroup(rule.pattern, claims.groups);

      case "role":
        return this.matchesRole(rule.pattern, claims.roles);

      case "default":
        return rule.pattern === "*";

      default:
        this.logger.warn({ ruleId: rule.id, type: rule.type }, "Unknown rule type encountered");
        return false;
    }
  }

  /**
   * Check exact email match (case-insensitive)
   *
   * @param pattern - Email pattern from rule
   * @param email - User's email from claims
   * @returns True if exact match
   */
  private matchesExactEmail(pattern: string, email: string | undefined): boolean {
    if (!email) return false;
    return email.toLowerCase() === pattern.toLowerCase();
  }

  /**
   * Check email wildcard match (domain match)
   *
   * Pattern format: *@domain.com
   *
   * @param pattern - Wildcard pattern (e.g., "*@company.com")
   * @param email - User's email from claims
   * @returns True if domain matches
   */
  private matchesEmailWildcard(pattern: string, email: string | undefined): boolean {
    if (!email) return false;

    // Pattern is *@domain.com - extract domain
    if (!pattern.startsWith("*@")) {
      this.logger.warn({ pattern }, "Invalid wildcard pattern - must start with *@");
      return false;
    }

    const patternDomain = pattern.substring(2).toLowerCase();
    const emailLower = email.toLowerCase();

    // Check if email ends with @domain
    return emailLower.endsWith(`@${patternDomain}`);
  }

  /**
   * Check group membership match
   *
   * Pattern format: group:name
   *
   * @param pattern - Group pattern (e.g., "group:developers")
   * @param groups - User's group memberships
   * @returns True if user is in the specified group
   */
  private matchesGroup(pattern: string, groups: string[]): boolean {
    // Pattern is group:name - extract name
    if (!pattern.startsWith("group:")) {
      this.logger.warn({ pattern }, "Invalid group pattern - must start with group:");
      return false;
    }

    const groupName = pattern.substring(6).toLowerCase();

    // Case-insensitive group matching
    return groups.some((g) => g.toLowerCase() === groupName);
  }

  /**
   * Check role assignment match
   *
   * Pattern format: role:name
   *
   * @param pattern - Role pattern (e.g., "role:admin")
   * @param roles - User's role assignments
   * @returns True if user has the specified role
   */
  private matchesRole(pattern: string, roles: string[]): boolean {
    // Pattern is role:name - extract name
    if (!pattern.startsWith("role:")) {
      this.logger.warn({ pattern }, "Invalid role pattern - must start with role:");
      return false;
    }

    const roleName = pattern.substring(5).toLowerCase();

    // Case-insensitive role matching
    return roles.some((r) => r.toLowerCase() === roleName);
  }

  /**
   * Log audit entry for mapping decision
   *
   * @param claims - User claims
   * @param rule - Matched rule (or null for defaults)
   * @param result - Resolved mapping
   * @param rulesEvaluated - Number of rules evaluated
   * @param startTime - Performance timestamp
   */
  private logAuditEntry(
    claims: NormalizedClaims,
    rule: UserMappingRule | null,
    result: ResolvedMapping,
    rulesEvaluated: number,
    startTime: number
  ): void {
    const durationMs = Math.round(performance.now() - startTime);

    const auditEntry: MappingAuditEntry = {
      timestamp: new Date().toISOString(),
      userId: claims.sub,
      email: claims.email,
      matchedPattern: rule?.pattern ?? null,
      matchedRuleId: rule?.id ?? null,
      resultScopes: result.scopes,
      resultInstanceAccess: result.instanceAccess,
      isDefault: result.isDefault,
      evaluatedRulesCount: rulesEvaluated,
    };

    this.logger.info(
      {
        audit: auditEntry,
        metric: "user_mapping.resolve_ms",
        value: durationMs,
      },
      result.isDefault
        ? "User mapping resolved to defaults"
        : `User mapping matched rule: ${rule?.pattern}`
    );
  }
}

/**
 * Create a user mapping service with default configuration
 *
 * @param store - User mapping store
 * @param config - User mapping configuration
 * @param defaultScopes - Default scopes (default: ["read"])
 * @param defaultInstanceAccess - Default instance access (default: ["public"])
 * @returns User mapping service instance
 */
export function createUserMappingService(
  store: UserMappingStore,
  config: UserMappingConfig,
  defaultScopes: TokenScope[] = ["read"],
  defaultInstanceAccess: InstanceAccess[] = ["public"]
): UserMappingService {
  return new UserMappingServiceImpl(store, config, defaultScopes, defaultInstanceAccess);
}
