/**
 * Tests for PostgreSQL migration 003-phase6-documents
 *
 * Validates the up and down migration SQL files for the documents
 * and document_chunks tables (Phase 6: Unstructured Document Ingestion).
 *
 * These are structural validation tests that verify SQL file correctness
 * without requiring a running PostgreSQL instance.
 */

import { describe, test, expect } from "bun:test";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const INIT_SCRIPTS_DIR = resolve(import.meta.dir, "../../init-scripts");
const UP_MIGRATION_PATH = resolve(INIT_SCRIPTS_DIR, "003-phase6-documents.sql");
const DOWN_MIGRATION_PATH = resolve(INIT_SCRIPTS_DIR, "003-phase6-documents-down.sql");

/** Schema version string that must match between up and down migrations */
const SCHEMA_VERSION = "0.6.1-documents";

/**
 * Read a migration file and return its contents as a string.
 * Throws if the file does not exist.
 */
function readMigrationFile(filePath: string): string {
  return readFileSync(filePath, "utf-8");
}

describe("003-phase6-documents: Up Migration", () => {
  test("up migration file exists", () => {
    expect(existsSync(UP_MIGRATION_PATH)).toBe(true);
  });

  test("up migration file is non-empty", () => {
    const content = readMigrationFile(UP_MIGRATION_PATH);
    expect(content.trim().length).toBeGreaterThan(0);
  });

  test("creates documents table with IF NOT EXISTS", () => {
    const content = readMigrationFile(UP_MIGRATION_PATH);
    expect(content).toContain("CREATE TABLE IF NOT EXISTS documents");
  });

  test("creates document_chunks table with IF NOT EXISTS", () => {
    const content = readMigrationFile(UP_MIGRATION_PATH);
    expect(content).toContain("CREATE TABLE IF NOT EXISTS document_chunks");
  });

  test("documents table has all required columns", () => {
    const content = readMigrationFile(UP_MIGRATION_PATH);
    const requiredColumns = [
      "id UUID PRIMARY KEY",
      "source_id VARCHAR(255) NOT NULL",
      "file_path VARCHAR(1024) NOT NULL",
      "absolute_path VARCHAR(2048)",
      "document_type VARCHAR(50) NOT NULL",
      "title VARCHAR(512)",
      "author VARCHAR(255)",
      "page_count INTEGER",
      "word_count INTEGER",
      "toc_structure JSONB",
      "section_count INTEGER",
      "image_width INTEGER",
      "image_height INTEGER",
      "image_format VARCHAR(50)",
      "exif_data JSONB",
      "content_description TEXT",
      "file_size_bytes BIGINT NOT NULL",
      "content_hash VARCHAR(64) NOT NULL",
      "processing_status VARCHAR(50) NOT NULL",
      "processing_error TEXT",
      "chunk_count INTEGER",
      "ocr_processed BOOLEAN",
      "ocr_confidence NUMERIC(5,2)",
      "updated_at TIMESTAMP WITH TIME ZONE",
    ];

    for (const col of requiredColumns) {
      expect(content).toContain(col);
    }
  });

  test("documents table uses TIMESTAMPTZ for all timestamp columns", () => {
    const content = readMigrationFile(UP_MIGRATION_PATH);

    // Extract the documents table definition (between CREATE TABLE and the closing paren+semicolon)
    const documentsTableMatch = content.match(
      /CREATE TABLE IF NOT EXISTS documents\s*\(([\s\S]*?)\);/
    );
    expect(documentsTableMatch).not.toBeNull();
    const tableBody = documentsTableMatch![1]!;

    // Find all lines that mention TIMESTAMP
    const timestampLines = tableBody
      .split("\n")
      .filter((line) => line.includes("TIMESTAMP") && !line.trim().startsWith("--"));

    // Every TIMESTAMP usage should be WITH TIME ZONE
    for (const line of timestampLines) {
      expect(line).toContain("TIMESTAMP WITH TIME ZONE");
    }
  });

  test("documents table has unique constraint on (source_id, file_path)", () => {
    const content = readMigrationFile(UP_MIGRATION_PATH);
    expect(content).toContain("UNIQUE (source_id, file_path)");
  });

  test("documents table has CHECK constraint on document_type", () => {
    const content = readMigrationFile(UP_MIGRATION_PATH);
    expect(content).toMatch(
      /CHECK\s*\(\s*document_type\s+IN\s*\(\s*'pdf'\s*,\s*'docx'\s*,\s*'markdown'\s*,\s*'image'\s*\)\s*\)/
    );
  });

  test("documents table has CHECK constraint on processing_status", () => {
    const content = readMigrationFile(UP_MIGRATION_PATH);
    expect(content).toMatch(
      /CHECK\s*\(\s*processing_status\s+IN\s*\(\s*'pending'\s*,\s*'processing'\s*,\s*'indexed'\s*,\s*'error'\s*\)\s*\)/
    );
  });

  test("document_chunks table has all required columns", () => {
    const content = readMigrationFile(UP_MIGRATION_PATH);
    const requiredColumns = [
      "id UUID PRIMARY KEY",
      "document_id UUID NOT NULL",
      "chromadb_id VARCHAR(255) NOT NULL",
      "chunk_index INTEGER NOT NULL",
      "start_offset INTEGER",
      "end_offset INTEGER",
      "page_number INTEGER",
      "section_heading VARCHAR(512)",
    ];

    for (const col of requiredColumns) {
      expect(content).toContain(col);
    }
  });

  test("document_chunks has FK reference to documents with CASCADE delete", () => {
    const content = readMigrationFile(UP_MIGRATION_PATH);
    expect(content).toMatch(/REFERENCES\s+documents\s*\(\s*id\s*\)\s+ON\s+DELETE\s+CASCADE/);
  });

  test("document_chunks has unique constraint on (document_id, chunk_index)", () => {
    const content = readMigrationFile(UP_MIGRATION_PATH);
    expect(content).toContain("UNIQUE (document_id, chunk_index)");
  });

  test("creates all expected indexes with IF NOT EXISTS", () => {
    const content = readMigrationFile(UP_MIGRATION_PATH);
    const expectedIndexes = [
      "idx_documents_source",
      "idx_documents_type",
      "idx_documents_hash",
      "idx_documents_status",
      "idx_documents_source_status",
      "idx_chunks_document",
      "idx_chunks_chromadb",
    ];

    for (const idx of expectedIndexes) {
      expect(content).toContain(`CREATE INDEX IF NOT EXISTS ${idx}`);
    }
  });

  test("composite index covers source_id + processing_status", () => {
    const content = readMigrationFile(UP_MIGRATION_PATH);
    expect(content).toMatch(
      /idx_documents_source_status\s*\n\s*ON\s+documents\s*\(\s*source_id\s*,\s*processing_status\s*\)/
    );
  });

  test("inserts schema version into _schema_info", () => {
    const content = readMigrationFile(UP_MIGRATION_PATH);
    expect(content).toContain(`INSERT INTO _schema_info (schema_version, description)`);
    expect(content).toContain(`'${SCHEMA_VERSION}'`);
    expect(content).toContain("ON CONFLICT (schema_version) DO NOTHING");
  });

  test("uses gen_random_uuid() for UUID defaults", () => {
    const content = readMigrationFile(UP_MIGRATION_PATH);
    // Both tables should use gen_random_uuid()
    const matches = content.match(/gen_random_uuid\(\)/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });
});

describe("003-phase6-documents: Down Migration", () => {
  test("down migration file exists", () => {
    expect(existsSync(DOWN_MIGRATION_PATH)).toBe(true);
  });

  test("down migration file is non-empty", () => {
    const content = readMigrationFile(DOWN_MIGRATION_PATH);
    expect(content.trim().length).toBeGreaterThan(0);
  });

  test("drops document_chunks table with IF EXISTS", () => {
    const content = readMigrationFile(DOWN_MIGRATION_PATH);
    expect(content).toContain("DROP TABLE IF EXISTS document_chunks");
  });

  test("drops documents table with IF EXISTS", () => {
    const content = readMigrationFile(DOWN_MIGRATION_PATH);
    expect(content).toContain("DROP TABLE IF EXISTS documents");
  });

  test("drops tables in correct dependency order (chunks before documents)", () => {
    const content = readMigrationFile(DOWN_MIGRATION_PATH);
    const chunksDropPos = content.indexOf("DROP TABLE IF EXISTS document_chunks");
    const documentsDropPos = content.indexOf("DROP TABLE IF EXISTS documents");

    // document_chunks must be dropped before documents (FK dependency)
    expect(chunksDropPos).toBeLessThan(documentsDropPos);
  });

  test("removes schema version entry from _schema_info", () => {
    const content = readMigrationFile(DOWN_MIGRATION_PATH);
    expect(content).toContain(
      `DELETE FROM _schema_info WHERE schema_version = '${SCHEMA_VERSION}'`
    );
  });

  test("schema version matches between up and down migrations", () => {
    const upContent = readMigrationFile(UP_MIGRATION_PATH);
    const downContent = readMigrationFile(DOWN_MIGRATION_PATH);

    // Extract version from up migration
    const upVersionMatch = upContent.match(/VALUES\s*\(\s*'([^']+)'\s*,/);
    expect(upVersionMatch).not.toBeNull();

    // Extract version from down migration
    const downVersionMatch = downContent.match(/schema_version\s*=\s*'([^']+)'/);
    expect(downVersionMatch).not.toBeNull();

    expect(upVersionMatch![1]).toBe(downVersionMatch![1]);
    expect(upVersionMatch![1]).toBe(SCHEMA_VERSION);
  });
});

describe("003-phase6-documents: SQL Syntax Validation", () => {
  test("up migration has balanced parentheses", () => {
    const content = readMigrationFile(UP_MIGRATION_PATH);
    // Strip SQL comments (-- to end of line) for accurate counting
    const noComments = content.replace(/--.*$/gm, "");
    const openParens = (noComments.match(/\(/g) || []).length;
    const closeParens = (noComments.match(/\)/g) || []).length;
    expect(openParens).toBe(closeParens);
  });

  test("down migration has balanced parentheses", () => {
    const content = readMigrationFile(DOWN_MIGRATION_PATH);
    const noComments = content.replace(/--.*$/gm, "");
    const openParens = (noComments.match(/\(/g) || []).length;
    const closeParens = (noComments.match(/\)/g) || []).length;
    expect(openParens).toBe(closeParens);
  });

  test("up migration statements end with semicolons", () => {
    const content = readMigrationFile(UP_MIGRATION_PATH);
    // Strip comments and blank lines, find SQL statements
    const lines = content.split("\n");
    const statementEnds: string[] = [];

    let inStatement = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("--") || trimmed === "") continue;

      if (
        trimmed.startsWith("CREATE") ||
        trimmed.startsWith("INSERT") ||
        trimmed.startsWith("DROP") ||
        trimmed.startsWith("DELETE")
      ) {
        inStatement = true;
      }

      if (inStatement && trimmed.endsWith(";")) {
        statementEnds.push(trimmed);
        inStatement = false;
      }
    }

    // Should have at least: 2 CREATE TABLEs + 7 indexes + 1 INSERT = 10 statements
    expect(statementEnds.length).toBeGreaterThanOrEqual(10);
  });

  test("down migration statements end with semicolons", () => {
    const content = readMigrationFile(DOWN_MIGRATION_PATH);
    const lines = content.split("\n");
    const statementEnds: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("--") || trimmed === "") continue;

      if ((trimmed.startsWith("DROP") || trimmed.startsWith("DELETE")) && trimmed.endsWith(";")) {
        statementEnds.push(trimmed);
      }
    }

    // Should have: 2 DROPs + 1 DELETE = 3 statements
    expect(statementEnds.length).toBe(3);
  });

  test("no bare TIMESTAMP without time zone in up migration", () => {
    const content = readMigrationFile(UP_MIGRATION_PATH);
    // Strip comments for accurate checking
    const noComments = content.replace(/--.*$/gm, "");
    // Match TIMESTAMP that is NOT followed by " WITH TIME ZONE"
    // This ensures consistency with the TIMESTAMPTZ pattern from watched_folders
    const bareTimestampMatches = noComments.match(/\bTIMESTAMP\b(?!\s+WITH\s+TIME\s+ZONE)/gi);
    expect(bareTimestampMatches).toBeNull();
  });
});

describe("003-phase6-documents: Consistency with Existing Migrations", () => {
  test("follows same header comment pattern as 002", () => {
    const content = readMigrationFile(UP_MIGRATION_PATH);
    expect(content).toContain("-- Personal Knowledge MCP - PostgreSQL Schema");
    expect(content).toContain("-- Phase 6:");
    expect(content).toContain("-- Migration: 003-phase6-documents");
  });

  test("uses same section separator style as 002", () => {
    const content = readMigrationFile(UP_MIGRATION_PATH);
    // Should use the ====... separator pattern
    expect(content).toContain(
      "-- ============================================================================"
    );
  });

  test("includes usage examples section", () => {
    const content = readMigrationFile(UP_MIGRATION_PATH);
    expect(content).toContain("-- Usage Examples");
  });

  test("schema version follows semantic versioning convention", () => {
    // 001 = 0.0.1-placeholder, 002 = 0.6.0-watched-folders, 003 = 0.6.1-documents
    expect(SCHEMA_VERSION).toMatch(/^\d+\.\d+\.\d+-.+$/);
  });
});
