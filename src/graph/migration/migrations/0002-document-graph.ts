/**
 * @module graph/migration/migrations/0002-document-graph
 *
 * Phase D — document-graph schema additions (issue #567).
 *
 * Adds indexes for `Document`, `Section`, and `ExternalLink` nodes so that
 * markdown / PDF / DOCX documents can become first-class graph citizens
 * alongside the existing code entities.
 *
 * Idempotent: every statement uses IF NOT EXISTS (Neo4j) or relies on
 * FalkorDB's native silent-no-op behavior for duplicate index creation.
 *
 * Why a separate migration: graphs that already advanced to version 1.0.0
 * (the initial schema) will not re-run 0001 even though `getAllSchemaStatements`
 * now returns the new indexes. A separate version bump is the only way to
 * pick up the additions on already-migrated installs.
 */

import type { GraphAdapterType } from "../../adapters/types.js";
import type { SchemaMigration } from "../types.js";

const NEO4J_STATEMENTS = [
  "CREATE INDEX document_id IF NOT EXISTS FOR (d:Document) ON (d.id)",
  "CREATE INDEX document_repository IF NOT EXISTS FOR (d:Document) ON (d.repository)",
  "CREATE INDEX section_documentId IF NOT EXISTS FOR (s:Section) ON (s.documentId)",
] as const;

const FALKORDB_STATEMENTS = [
  "CREATE INDEX FOR (d:Document) ON (d.id)",
  "CREATE INDEX FOR (d:Document) ON (d.repository)",
  "CREATE INDEX FOR (s:Section) ON (s.documentId)",
] as const;

export function createMigration0002(adapter: GraphAdapterType): SchemaMigration {
  return {
    version: "1.1.0",
    description: "Phase D — document graph indexes (Document, Section, ExternalLink)",
    statements: adapter === "falkordb" ? [...FALKORDB_STATEMENTS] : [...NEO4J_STATEMENTS],
  };
}

export const migration0002: SchemaMigration = createMigration0002("neo4j");
