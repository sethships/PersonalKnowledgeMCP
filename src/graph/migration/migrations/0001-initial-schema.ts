/**
 * @module graph/migration/migrations/0001-initial-schema
 *
 * Initial graph database schema migration.
 *
 * Creates the foundational constraints and indexes for the knowledge graph
 * as defined in ADR-0002.
 *
 * This migration is idempotent - all statements use IF NOT EXISTS patterns.
 * Supports both Neo4j and FalkorDB adapters with appropriate Cypher syntax.
 */

import { getAllSchemaStatements } from "../../schema.js";
import type { GraphAdapterType } from "../../adapters/types.js";
import type { SchemaMigration } from "../types.js";

/**
 * Create the initial schema migration for a specific adapter
 *
 * The migration creates:
 * - Unique constraints for Repository, File (id for FalkorDB, composite for Neo4j), Chunk, Concept
 * - Performance indexes for File.extension, Function.name, Class.name, Module.name
 * - Full-text index for entity name search (Neo4j only)
 *
 * @param adapter - Graph database adapter type
 * @returns Migration definition with adapter-appropriate Cypher statements
 */
export function createMigration0001(adapter: GraphAdapterType): SchemaMigration {
  return {
    version: "1.0.0",
    description: "Initial schema with constraints and indexes per ADR-0002",
    statements: getAllSchemaStatements(adapter),
  };
}

/**
 * Default migration for backward compatibility (uses Neo4j syntax)
 *
 * @deprecated Use createMigration0001(adapter) for adapter-aware migrations
 */
export const migration0001: SchemaMigration = createMigration0001("neo4j");
