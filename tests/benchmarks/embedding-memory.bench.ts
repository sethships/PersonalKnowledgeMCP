/* eslint-disable @typescript-eslint/no-non-null-assertion */
/**
 * Memory profiling tests for embedding providers
 *
 * Measures memory usage patterns during embedding operations:
 * - Baseline memory before model load
 * - Memory after model initialization
 * - Memory during batch processing
 * - Memory stability (checking for leaks)
 *
 * Run with:
 *   RUN_BENCHMARKS=true bun test tests/benchmarks/embedding-memory.bench.ts
 *
 * For more accurate GC results (if supported):
 *   bun --expose-gc test tests/benchmarks/embedding-memory.bench.ts
 *
 * Prerequisites:
 * - Transformers.js model downloaded (first run may take a few minutes)
 */

import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { createEmbeddingProvider } from "../../src/providers/factory.js";
import type { EmbeddingProvider, EmbeddingProviderConfig } from "../../src/providers/types.js";
import {
  measureMemory,
  formatMemory,
  tryGC,
  sleep,
  BENCHMARK_TEXTS,
  type MemoryMetrics,
} from "../fixtures/benchmark-fixtures.js";

// Test configuration
const shouldRunBenchmarks = Bun.env["RUN_BENCHMARKS"] === "true";
const verbose = Bun.env["VERBOSE"] === "true";

/**
 * Memory snapshot at a point in time
 */
interface MemorySnapshot {
  label: string;
  metrics: MemoryMetrics;
  timestamp: number;
}

/**
 * Memory delta between two snapshots
 */
interface MemoryDelta {
  label: string;
  rss: number;
  heapUsed: number;
  external: number;
}

/**
 * Calculate memory delta between two snapshots
 */
function calculateDelta(before: MemorySnapshot, after: MemorySnapshot): MemoryDelta {
  return {
    label: `${before.label} -> ${after.label}`,
    rss: after.metrics.rss - before.metrics.rss,
    heapUsed: after.metrics.heapUsed - before.metrics.heapUsed,
    external: after.metrics.external - before.metrics.external,
  };
}

/**
 * Format memory delta for display
 */
function formatDelta(delta: MemoryDelta): string {
  const formatBytes = (bytes: number): string => {
    const mb = bytes / 1024 / 1024;
    const sign = mb >= 0 ? "+" : "";
    return `${sign}${mb.toFixed(2)} MB`;
  };

  return [
    `${delta.label}:`,
    `  RSS: ${formatBytes(delta.rss)}`,
    `  Heap Used: ${formatBytes(delta.heapUsed)}`,
    `  External: ${formatBytes(delta.external)}`,
  ].join("\n");
}

/**
 * Take a memory snapshot
 */
function takeSnapshot(label: string): MemorySnapshot {
  return {
    label,
    metrics: measureMemory(),
    timestamp: Date.now(),
  };
}

describe.skipIf(!shouldRunBenchmarks)("Embedding Memory Profiling", () => {
  describe("Transformers.js Memory Usage", () => {
    const snapshots: MemorySnapshot[] = [];
    let provider: EmbeddingProvider;

    beforeAll(() => {
      // Try to trigger GC before baseline measurement
      tryGC();
    });

    afterEach(() => {
      // Try to clean up after each test
      tryGC();
    });

    test("baseline memory measurement", () => {
      const snapshot = takeSnapshot("baseline");
      snapshots.push(snapshot);

      console.log(`\nBaseline memory: ${formatMemory(snapshot.metrics)}`);

      // Just record baseline, no assertions
      expect(snapshot.metrics.heapUsed).toBeGreaterThan(0);
    });

    test("memory after provider creation (no model load)", () => {
      const config: EmbeddingProviderConfig = {
        provider: "transformersjs",
        model: "Xenova/all-MiniLM-L6-v2",
        dimensions: 384,
        batchSize: 32,
        maxRetries: 0,
        timeoutMs: 300000,
      };

      provider = createEmbeddingProvider(config);

      const snapshot = takeSnapshot("provider_created");
      snapshots.push(snapshot);

      console.log(`\nAfter provider creation: ${formatMemory(snapshot.metrics)}`);

      const delta = calculateDelta(snapshots[0]!, snapshot);
      console.log(formatDelta(delta));

      // Provider creation should use minimal memory (lazy loading)
      expect(delta.heapUsed).toBeLessThan(50 * 1024 * 1024); // Less than 50MB
    });

    test("memory after model initialization", async () => {
      // Generate first embedding to trigger model load
      await provider.generateEmbedding("initialize model");

      const snapshot = takeSnapshot("model_loaded");
      snapshots.push(snapshot);

      console.log(`\nAfter model load: ${formatMemory(snapshot.metrics)}`);

      const delta = calculateDelta(snapshots[0]!, snapshot);
      console.log(formatDelta(delta));

      // Model should use some memory, but not excessive
      // all-MiniLM-L6-v2 is ~22MB model
      expect(delta.heapUsed + delta.external).toBeLessThan(500 * 1024 * 1024); // Less than 500MB total
    }, 300000);

    test("memory during batch processing", async () => {
      const beforeBatch = takeSnapshot("before_batch");

      // Process a batch of texts
      const texts = BENCHMARK_TEXTS.short;
      await provider.generateEmbeddings(texts);

      const afterBatch = takeSnapshot("after_batch");
      snapshots.push(afterBatch);

      const delta = calculateDelta(beforeBatch, afterBatch);
      console.log(`\nBatch processing memory change:`);
      console.log(formatDelta(delta));

      // Memory should not grow significantly during processing
      // Small increases are OK as embeddings are generated
      expect(delta.heapUsed).toBeLessThan(50 * 1024 * 1024); // Less than 50MB growth
    });

    test("memory stability over multiple operations", async () => {
      const initialSnapshot = takeSnapshot("stability_start");

      // Run multiple embedding operations
      for (let i = 0; i < 10; i++) {
        await provider.generateEmbeddings(BENCHMARK_TEXTS.short.slice(0, 3));
        if (verbose) {
          const current = measureMemory();
          console.log(
            `  Iteration ${i + 1}: Heap = ${(current.heapUsed / 1024 / 1024).toFixed(2)} MB`
          );
        }
      }

      // Give GC a chance - double GC attempt for more reliable measurement
      tryGC();
      await sleep(200);
      tryGC();
      await sleep(100);

      const finalSnapshot = takeSnapshot("stability_end");
      const delta = calculateDelta(initialSnapshot, finalSnapshot);

      console.log(`\nMemory stability (10 iterations):`);
      console.log(formatDelta(delta));

      // Memory should be relatively stable (no significant leaks)
      // Note: This assertion is advisory - memory profiling is inherently non-deterministic
      // Relaxed threshold (150MB) accounts for GC timing variance in CI environments
      expect(Math.abs(delta.heapUsed)).toBeLessThan(150 * 1024 * 1024);
    });

    test("memory with different text lengths", async () => {
      console.log("\nMemory by text length:");

      const categories = ["tiny", "short", "medium"] as const;

      for (const category of categories) {
        tryGC();
        await sleep(50);

        const before = takeSnapshot(`before_${category}`);

        const texts = BENCHMARK_TEXTS[category];
        await provider.generateEmbeddings(texts);

        const after = takeSnapshot(`after_${category}`);
        const delta = calculateDelta(before, after);

        console.log(
          `  ${category}: Heap ${delta.heapUsed >= 0 ? "+" : ""}${(delta.heapUsed / 1024 / 1024).toFixed(2)} MB`
        );
      }

      // This test is informational - results logged above
      // No hard assertion as memory varies by text length and GC timing
    });

    test("memory summary", () => {
      console.log("\n" + "=".repeat(60));
      console.log("Memory Profile Summary");
      console.log("=".repeat(60));

      // Print all snapshots
      for (let i = 0; i < snapshots.length; i++) {
        const snapshot = snapshots[i]!;
        console.log(`\n${snapshot.label}:`);
        console.log(`  ${formatMemory(snapshot.metrics)}`);

        if (i > 0) {
          const delta = calculateDelta(snapshots[0]!, snapshot);
          console.log(
            `  Delta from baseline: Heap ${(delta.heapUsed / 1024 / 1024).toFixed(2)} MB`
          );
        }
      }

      // Summary assertions
      const baseline = snapshots[0]!;
      const final = snapshots[snapshots.length - 1]!;
      const totalDelta = calculateDelta(baseline, final);

      console.log("\n" + "-".repeat(60));
      console.log(`Total memory growth: ${(totalDelta.heapUsed / 1024 / 1024).toFixed(2)} MB heap`);
      console.log("=".repeat(60));

      // Test passes if we got here
      expect(snapshots.length).toBeGreaterThan(0);
    });
  });

  describe("Memory Leak Detection", () => {
    test("repeated provider creation does not leak", async () => {
      tryGC();
      const baseline = takeSnapshot("leak_baseline");

      // Create and use multiple providers
      for (let i = 0; i < 3; i++) {
        const config: EmbeddingProviderConfig = {
          provider: "transformersjs",
          model: "Xenova/all-MiniLM-L6-v2",
          dimensions: 384,
          batchSize: 32,
          maxRetries: 0,
          timeoutMs: 300000,
        };

        const tempProvider = createEmbeddingProvider(config);
        await tempProvider.generateEmbedding(`Test ${i}`);

        // Let the provider go out of scope
      }

      // Allow GC
      tryGC();
      await sleep(100);

      const final = takeSnapshot("leak_final");
      const delta = calculateDelta(baseline, final);

      console.log("\nRepeated provider creation:");
      console.log(formatDelta(delta));

      // Some memory growth is expected due to cached models
      // But it shouldn't grow linearly with iterations
      expect(delta.heapUsed).toBeLessThan(200 * 1024 * 1024); // Less than 200MB
    }, 600000);

    test("long-running batch operations stay stable", async () => {
      const config: EmbeddingProviderConfig = {
        provider: "transformersjs",
        model: "Xenova/all-MiniLM-L6-v2",
        dimensions: 384,
        batchSize: 32,
        maxRetries: 0,
        timeoutMs: 300000,
      };

      const provider = createEmbeddingProvider(config);
      await provider.generateEmbedding("warmup");

      tryGC();
      const baseline = takeSnapshot("long_run_baseline");
      const memoryReadings: number[] = [];

      // Run many iterations
      const iterations = 20;
      for (let i = 0; i < iterations; i++) {
        await provider.generateEmbedding(`Iteration ${i}`);

        if (i % 5 === 0) {
          const current = measureMemory();
          memoryReadings.push(current.heapUsed);

          if (verbose) {
            console.log(`  Iteration ${i}: ${(current.heapUsed / 1024 / 1024).toFixed(2)} MB`);
          }
        }
      }

      tryGC();
      await sleep(100);

      const final = takeSnapshot("long_run_final");
      const delta = calculateDelta(baseline, final);

      console.log(`\nLong-running stability (${iterations} iterations):`);
      console.log(formatDelta(delta));

      // Check for linear growth (leak indicator)
      if (memoryReadings.length >= 3) {
        const firstReading = memoryReadings[0]!;
        const lastReading = memoryReadings[memoryReadings.length - 1]!;
        const growth = lastReading - firstReading;

        console.log(
          `Memory trend: ${(growth / 1024 / 1024).toFixed(2)} MB over ${memoryReadings.length} samples`
        );

        // Should not have consistent upward trend
        // Allow some variance but not linear growth
        const avgGrowthPerSample = growth / (memoryReadings.length - 1);
        expect(avgGrowthPerSample).toBeLessThan(10 * 1024 * 1024); // Less than 10MB per sample
      }
    }, 300000);
  });
});

// Print instructions if benchmarks are skipped
if (!shouldRunBenchmarks) {
  console.log(
    "\n💾 Memory profiling tests are SKIPPED by default.\n" +
      "To run these tests:\n\n" +
      "  Basic:\n" +
      "    RUN_BENCHMARKS=true bun test tests/benchmarks/embedding-memory.bench.ts\n\n" +
      "  Verbose output:\n" +
      "    RUN_BENCHMARKS=true VERBOSE=true bun test tests/benchmarks/embedding-memory.bench.ts\n\n" +
      "Note: Memory measurements may vary based on GC timing.\n"
  );
}
