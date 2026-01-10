/**
 * @module graph/migration/migrations/0001-initial-schema
 *
 * Initial Neo4j schema migration.
 *
 * Creates the foundational constraints and indexes for the knowledge graph
 * as defined in ADR-0002.
 *
 * This migration is idempotent - all statements use IF NOT EXISTS.
 */

import { getAllSchemaStatements } from "../../schema.js";
import type { SchemaMigration } from "../types.js";

/**
 * Initial schema migration
 *
 * Creates:
 * - Unique constraints for Repository, File (composite), Chunk, Concept
 * - Performance indexes for File.extension, Function.name, Class.name, Module.name
 * - Full-text index for entity name search
 */
export const migration0001: SchemaMigration = {
  version: "1.0.0",
  description: "Initial schema with constraints and indexes per ADR-0002",
  statements: getAllSchemaStatements(),
};
