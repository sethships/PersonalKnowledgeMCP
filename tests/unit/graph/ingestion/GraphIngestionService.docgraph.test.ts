/**
 * Unit tests for `GraphIngestionService.ingestDocumentGraph` (Phase D / #567).
 *
 * Uses a recording mock adapter to verify the Cypher contract:
 *   - one round trip to build the symbol index
 *   - batched UNWIND MERGE for Document / Section / ExternalLink nodes
 *   - one MERGE per edge type
 *   - stale-MENTIONS sweep at the end
 *
 * These tests are infrastructure-free — no FalkorDB, no embeddings, no IO —
 * so they run in milliseconds and don't burn OpenAI credits.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { GraphIngestionService } from "../../../../src/graph/ingestion/GraphIngestionService.js";
import { EntityExtractor } from "../../../../src/graph/extraction/EntityExtractor.js";
import { RelationshipExtractor } from "../../../../src/graph/extraction/RelationshipExtractor.js";
import type { GraphStorageAdapter } from "../../../../src/graph/adapters/types.js";
import type { DocExtractionResult } from "../../../../src/graph/extraction/doc-types.js";
import { initializeLogger } from "../../../../src/logging/index.js";

interface QueryRecord {
  cypher: string;
  params?: Record<string, unknown>;
}

function makeRecordingAdapter(): {
  adapter: GraphStorageAdapter;
  queries: QueryRecord[];
  setSymbols: (rows: { id: string; name: string; type: string; filePath: string }[]) => void;
  setStaleSweep: (n: number) => void;
} {
  const queries: QueryRecord[] = [];
  let symbolRows: { id: string; name: string; type: string; filePath: string }[] = [];
  let staleRemoved = 0;

  const adapter = {
    runQuery: async <T>(cypher: string, params?: Record<string, unknown>): Promise<T[]> => {
      queries.push({ cypher, params });
      if (cypher.includes("labels(s)[0] AS type")) {
        return symbolRows as unknown as T[];
      }
      if (cypher.includes("RETURN removed")) {
        return [{ removed: staleRemoved }] as unknown as T[];
      }
      return [] as T[];
    },
  } as unknown as GraphStorageAdapter;

  return {
    adapter,
    queries,
    setSymbols: (rows) => {
      symbolRows = rows;
    },
    setStaleSweep: (n) => {
      staleRemoved = n;
    },
  };
}

function makeService(adapter: GraphStorageAdapter): GraphIngestionService {
  return new GraphIngestionService(adapter, new EntityExtractor(), new RelationshipExtractor());
}

function makeDoc(
  filePath: string,
  partial: Partial<DocExtractionResult> = {}
): DocExtractionResult {
  return {
    filePath,
    format: "markdown",
    title: partial.title ?? filePath,
    wordCount: 10,
    sections: [],
    unresolvedLinks: [],
    codeMentions: [],
    parseTimeMs: 1,
    errors: [],
    success: true,
    ...partial,
  };
}

beforeEach(() => initializeLogger({ level: "silent", format: "json" }));

describe("GraphIngestionService.ingestDocumentGraph", () => {
  it("returns zeros and skips Cypher when documents list is empty", async () => {
    const { adapter, queries } = makeRecordingAdapter();
    const svc = makeService(adapter);
    const result = await svc.ingestDocumentGraph("repo", []);
    expect(result.documentsCreated).toBe(0);
    expect(result.edgesCreated).toBe(0);
    expect(queries).toHaveLength(0);
  });

  it("writes Document nodes with the expected payload shape", async () => {
    const { adapter, queries } = makeRecordingAdapter();
    const svc = makeService(adapter);

    const doc = makeDoc("notes.md", { title: "Notes", wordCount: 42 });
    const result = await svc.ingestDocumentGraph("repo", [doc]);

    expect(result.documentsCreated).toBe(1);
    const docMerge = queries.find((q) => q.cypher.includes("MERGE (d:Document"));
    expect(docMerge).toBeDefined();
    const docs = (docMerge!.params as { docs: { id: string; title: string }[] }).docs;
    expect(docs).toHaveLength(1);
    expect(docs[0]!.id).toBe("Document:repo:notes.md");
    expect(docs[0]!.title).toBe("Notes");
  });

  it("writes Section nodes when documents have headings", async () => {
    const { adapter, queries } = makeRecordingAdapter();
    const svc = makeService(adapter);

    const doc = makeDoc("g.md", {
      sections: [
        { id: "Section:1", level: 1, title: "Top", startChar: 0, endChar: 100 },
        { id: "Section:2", level: 2, title: "Sub", parentId: "Section:1", startChar: 10, endChar: 50 },
      ],
    });
    const result = await svc.ingestDocumentGraph("repo", [doc]);
    expect(result.sectionsCreated).toBe(2);
    const secMerge = queries.find((q) => q.cypher.includes("MERGE (s:Section"));
    expect(secMerge).toBeDefined();
  });

  it("emits one MERGE per edge type that has at least one edge", async () => {
    const { adapter, queries, setSymbols } = makeRecordingAdapter();
    setSymbols([{ id: "Class:Auth", name: "AuthService", type: "Class", filePath: "src/a.ts" }]);
    const svc = makeService(adapter);

    const doc = makeDoc("notes.md", {
      sections: [
        { id: "Section:s1", level: 1, title: "Top", startChar: 0, endChar: 50 },
      ],
      codeMentions: [{ identifier: "AuthService", confidence: "high" }],
      unresolvedLinks: [
        { type: "markdown", target: "https://example.com/x", text: "x" },
      ],
    });
    const result = await svc.ingestDocumentGraph("repo", [doc]);

    expect(result.edgesCreated).toBeGreaterThan(0);
    expect(result.externalLinksCreated).toBe(1);

    const cypherSeen = queries.map((q) => q.cypher);
    expect(cypherSeen.some((c) => c.includes("MERGE (from)-[r:LINKS_TO]->(to)"))).toBe(true);
    expect(cypherSeen.some((c) => c.includes("MERGE (from)-[r:MENTIONS]->(to)"))).toBe(true);
    expect(cypherSeen.some((c) => c.includes("MERGE (from)-[r:HAS_SECTION]->(to)"))).toBe(true);
  });

  it("runs the stale-MENTIONS sweep and surfaces the count", async () => {
    const { adapter, setStaleSweep } = makeRecordingAdapter();
    setStaleSweep(3);
    const svc = makeService(adapter);
    const doc = makeDoc("x.md");
    const result = await svc.ingestDocumentGraph("repo", [doc]);
    expect(result.staleMentionsRemoved).toBe(3);
  });

  it("queries the symbol index scoped to the repository", async () => {
    const { adapter, queries } = makeRecordingAdapter();
    const svc = makeService(adapter);
    await svc.ingestDocumentGraph("my-repo", [makeDoc("x.md")]);
    const symbolQuery = queries.find((q) => q.cypher.includes("labels(s)[0] AS type"));
    expect(symbolQuery).toBeDefined();
    expect((symbolQuery!.params as { repository: string }).repository).toBe("my-repo");
  });
});
