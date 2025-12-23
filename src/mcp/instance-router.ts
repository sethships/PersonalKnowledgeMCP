/**
 * Multi-Instance Router Module
 *
 * Routes MCP requests to the correct ChromaDB instance based on token access.
 * Manages connection pools for multiple instances with lazy initialization.
 *
 * @module mcp/instance-router
 */

import type { InstanceAccess, TokenMetadata } from "../auth/types.js";
import type { ChromaStorageClient } from "../storage/types.js";
import type { MultiInstanceConfig, InstanceConfig } from "../config/instance-config.js";
import { ChromaStorageClientImpl } from "../storage/chroma-client.js";
import { InstanceAccessDeniedError } from "../auth/errors.js";
import { getComponentLogger } from "../logging/index.js";
import { getEnabledInstances } from "../config/index.js";

/**
 * Lazy-initialized logger
 */
let logger: ReturnType<typeof getComponentLogger> | null = null;

function getLogger(): ReturnType<typeof getComponentLogger> {
  if (!logger) {
    logger = getComponentLogger("instance-router");
  }
  return logger;
}

/**
 * Instance connection state
 */
interface InstanceConnection {
  /** ChromaDB storage client */
  client: ChromaStorageClient;
  /** Whether the connection is established */
  connected: boolean;
  /** Last health check result */
  healthy: boolean;
  /** Last health check timestamp */
  lastHealthCheck: number;
}

/**
 * Instance router interface
 *
 * Routes requests to the correct ChromaDB instance based on token access.
 */
export interface InstanceRouter {
  /**
   * Get storage client for the requested instance
   *
   * Validates that the token (if present) has access to the instance.
   * For unauthenticated requests (stdio), uses the default instance
   * if requireAuthForDefaultInstance is false.
   *
   * @param requestedInstance - Instance to access (optional, defaults to config default)
   * @param tokenMetadata - Token metadata for authorization (optional for stdio)
   * @returns ChromaDB storage client for the instance
   * @throws {InstanceAccessDeniedError} If token lacks access to the instance
   * @throws {Error} If instance is not enabled or connection fails
   */
  getStorageClient(
    requestedInstance?: InstanceAccess,
    tokenMetadata?: TokenMetadata
  ): Promise<ChromaStorageClient>;

  /**
   * Get the default instance for unauthenticated requests
   *
   * @returns Default instance name
   */
  getDefaultInstance(): InstanceAccess;

  /**
   * Get all instances the token can access
   *
   * For unauthenticated requests, returns default instance only
   * if requireAuthForDefaultInstance is false.
   *
   * @param tokenMetadata - Token metadata (optional)
   * @returns Array of accessible instance names
   */
  getAccessibleInstances(tokenMetadata?: TokenMetadata): InstanceAccess[];

  /**
   * Check health of all enabled instances
   *
   * @returns Map of instance name to health status
   */
  healthCheck(): Promise<Record<InstanceAccess, boolean>>;

  /**
   * Graceful shutdown of all connections
   */
  shutdown(): Promise<void>;

  /**
   * Get instance configuration by name
   *
   * @param instanceName - Instance name
   * @returns Instance configuration or undefined if not found/disabled
   */
  getInstanceConfig(instanceName: InstanceAccess): InstanceConfig | undefined;
}

/**
 * Instance router implementation
 *
 * Manages multiple ChromaDB connections with lazy initialization.
 */
export class InstanceRouterImpl implements InstanceRouter {
  private readonly config: MultiInstanceConfig;
  private readonly connections: Map<InstanceAccess, InstanceConnection> = new Map();
  private readonly connectionLocks: Map<InstanceAccess, Promise<ChromaStorageClient>> = new Map();

  constructor(config: MultiInstanceConfig) {
    this.config = config;

    const log = getLogger();
    const enabledInstances = getEnabledInstances(config);

    log.info(
      {
        enabledInstances,
        defaultInstance: config.defaultInstance,
        requireAuthForDefault: config.requireAuthForDefaultInstance,
      },
      "Instance router initialized"
    );
  }

  /**
   * Create a new storage client for an instance
   */
  private createStorageClient(instanceConfig: InstanceConfig): ChromaStorageClient {
    return new ChromaStorageClientImpl({
      host: instanceConfig.chromadb.host,
      port: instanceConfig.chromadb.port,
      authToken: instanceConfig.chromadb.authToken,
    });
  }

  /**
   * Get or create a connection for an instance (with locking to prevent races)
   */
  private async getOrCreateConnection(instanceName: InstanceAccess): Promise<ChromaStorageClient> {
    const log = getLogger();

    // Check if already connected
    const existing = this.connections.get(instanceName);
    if (existing?.connected && existing.healthy) {
      return existing.client;
    }

    // Check if connection is in progress (prevent race conditions)
    const pending = this.connectionLocks.get(instanceName);
    if (pending) {
      log.debug({ instance: instanceName }, "Waiting for pending connection");
      return pending;
    }

    // Start new connection
    const connectionPromise = this.establishConnection(instanceName);
    this.connectionLocks.set(instanceName, connectionPromise);

    try {
      const client = await connectionPromise;
      return client;
    } finally {
      this.connectionLocks.delete(instanceName);
    }
  }

  /**
   * Establish a new connection to an instance
   */
  private async establishConnection(instanceName: InstanceAccess): Promise<ChromaStorageClient> {
    const log = getLogger();
    const instanceConfig = this.config.instances[instanceName];

    if (!instanceConfig || !instanceConfig.enabled) {
      throw new Error(`Instance "${instanceName}" is not enabled`);
    }

    log.info(
      {
        instance: instanceName,
        host: instanceConfig.chromadb.host,
        port: instanceConfig.chromadb.port,
      },
      "Establishing connection to instance"
    );

    const client = this.createStorageClient(instanceConfig);

    try {
      await client.connect();

      const healthy = await client.healthCheck();
      if (!healthy) {
        throw new Error(`Health check failed for instance "${instanceName}"`);
      }

      this.connections.set(instanceName, {
        client,
        connected: true,
        healthy: true,
        lastHealthCheck: Date.now(),
      });

      log.info({ instance: instanceName }, "Connection established successfully");

      return client;
    } catch (error) {
      log.error({ instance: instanceName, error }, "Failed to establish connection to instance");
      throw error;
    }
  }

  /**
   * Validate token has access to the requested instance
   */
  private validateAccess(instanceName: InstanceAccess, tokenMetadata?: TokenMetadata): void {
    const log = getLogger();

    // If no token provided (stdio transport)
    if (!tokenMetadata) {
      // Check if we require auth for the default instance
      if (this.config.requireAuthForDefaultInstance) {
        throw new InstanceAccessDeniedError([instanceName], []);
      }

      // For local deployments, only allow default instance without auth
      if (instanceName !== this.config.defaultInstance) {
        log.warn(
          { requested: instanceName, default: this.config.defaultInstance },
          "Unauthenticated request tried to access non-default instance"
        );
        throw new InstanceAccessDeniedError([instanceName], [this.config.defaultInstance]);
      }

      return;
    }

    // Token provided - check instance access
    if (!tokenMetadata.instanceAccess.includes(instanceName)) {
      log.warn(
        {
          requested: instanceName,
          allowed: tokenMetadata.instanceAccess,
          tokenName: tokenMetadata.name,
        },
        "Token lacks access to requested instance"
      );
      throw new InstanceAccessDeniedError([instanceName], tokenMetadata.instanceAccess);
    }
  }

  async getStorageClient(
    requestedInstance?: InstanceAccess,
    tokenMetadata?: TokenMetadata
  ): Promise<ChromaStorageClient> {
    const log = getLogger();

    // Determine which instance to use
    const instanceName = requestedInstance ?? this.config.defaultInstance;

    // Validate access
    this.validateAccess(instanceName, tokenMetadata);

    // Check if instance is enabled
    const instanceConfig = this.config.instances[instanceName];
    if (!instanceConfig || !instanceConfig.enabled) {
      throw new Error(`Instance "${instanceName}" is not available`);
    }

    log.debug(
      {
        instance: instanceName,
        hasToken: !!tokenMetadata,
        tokenName: tokenMetadata?.name,
      },
      "Getting storage client for instance"
    );

    // Get or create connection
    return this.getOrCreateConnection(instanceName);
  }

  getDefaultInstance(): InstanceAccess {
    return this.config.defaultInstance;
  }

  getAccessibleInstances(tokenMetadata?: TokenMetadata): InstanceAccess[] {
    const enabledInstances = getEnabledInstances(this.config);

    // No token - return default instance only (if auth not required)
    if (!tokenMetadata) {
      if (this.config.requireAuthForDefaultInstance) {
        return [];
      }
      return [this.config.defaultInstance];
    }

    // Filter to instances the token can access AND are enabled
    return enabledInstances.filter((instance) => tokenMetadata.instanceAccess.includes(instance));
  }

  async healthCheck(): Promise<Record<InstanceAccess, boolean>> {
    const log = getLogger();
    const results: Record<string, boolean> = {};
    const enabledInstances = getEnabledInstances(this.config);

    await Promise.all(
      enabledInstances.map(async (instanceName) => {
        try {
          const connection = this.connections.get(instanceName);

          if (connection?.connected) {
            // Use existing connection
            const healthy = await connection.client.healthCheck();
            connection.healthy = healthy;
            connection.lastHealthCheck = Date.now();
            results[instanceName] = healthy;
          } else {
            // Try to establish connection for health check
            const instanceConfig = this.config.instances[instanceName];
            const client = this.createStorageClient(instanceConfig);
            await client.connect();
            const healthy = await client.healthCheck();
            results[instanceName] = healthy;
          }
        } catch (error) {
          log.warn({ instance: instanceName, error }, "Health check failed for instance");
          results[instanceName] = false;
        }
      })
    );

    return results as Record<InstanceAccess, boolean>;
  }

  async shutdown(): Promise<void> {
    const log = getLogger();
    log.info("Shutting down instance router");

    // Wait for any pending connections
    await Promise.all(Array.from(this.connectionLocks.values()));

    // Clear all connections (ChromaDB client doesn't have explicit disconnect)
    this.connections.clear();
    this.connectionLocks.clear();

    log.info("Instance router shutdown complete");
  }

  getInstanceConfig(instanceName: InstanceAccess): InstanceConfig | undefined {
    const config = this.config.instances[instanceName];
    if (!config || !config.enabled) {
      return undefined;
    }
    return config;
  }
}

/**
 * Create an instance router from configuration
 *
 * @param config - Multi-instance configuration
 * @returns Instance router
 */
export function createInstanceRouter(config: MultiInstanceConfig): InstanceRouter {
  return new InstanceRouterImpl(config);
}
