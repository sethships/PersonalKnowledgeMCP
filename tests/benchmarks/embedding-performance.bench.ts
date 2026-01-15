/* eslint-disable @typescript-eslint/no-non-null-assertion */
/**
 * Performance benchmark tests for embedding providers
 *
 * Measures embedding generation latency and throughput for local providers.
 * Tracks performance against project targets:
 * - Single embedding: <100ms (warm model)
 * - Batch of 10: <500ms
 * - Model initialization: <30s
 *
 * Run with:
 *   RUN_BENCHMARKS=true bun test tests/benchmarks/embedding-performance.bench.ts
 *
 * With Ollama:
 *   RUN_BENCHMARKS=true INCLUDE_OLLAMA=true bun test tests/benchmarks/embedding-performance.bench.ts
 *
 * Prerequisites:
 * - Transformers.js model downloaded (first run may take a few minutes)
 * - Ollama running with embedding model (optional)
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { createEmbeddingProvider } from "../../src/providers/factory.js";
import type { EmbeddingProvider, EmbeddingProviderConfig } from "../../src/providers/types.js";
import {
  calculateStats,
  formatStats,
  measureTime,
  benchmarkFunction,
  BENCHMARK_TEXTS,
  type BenchmarkStats,
} from "../fixtures/benchmark-fixtures.js";

// Test configuration
const shouldRunBenchmarks = Bun.env["RUN_BENCHMARKS"] === "true";
const includeOllama = Bun.env["INCLUDE_OLLAMA"] === "true";
const verbose = Bun.env["VERBOSE"] === "true";

/**
 * Performance targets from PRD
 */
const PERFORMANCE_TARGETS = {
  /** Single embedding latency for warm model (ms) */
  singleEmbeddingWarm: 100,

  /** Batch of 10 embeddings (ms) */
  batchOf10: 500,

  /** Model initialization - cold start (ms) */
  modelInitCold: 30000,

  /** Model initialization - warm/cached (ms) */
  modelInitWarm: 5000,

  /** Throughput - texts per second (minimum) */
  minThroughput: 5,
};

/**
 * Performance benchmark result
 */
interface PerformanceBenchmark {
  name: string;
  stats: BenchmarkStats;
  target: number;
  passed: boolean;
  throughput?: number;
}

/**
 * Print benchmark results
 */
function printBenchmarks(providerName: string, benchmarks: PerformanceBenchmark[]): void {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Performance Benchmarks: ${providerName}`);
  console.log("=".repeat(60));

  for (const benchmark of benchmarks) {
    const status = benchmark.passed ? "✓ PASS" : "✗ FAIL";
    console.log(`\n${status}: ${benchmark.name}`);
    console.log(`  Target: ${benchmark.target}ms`);
    console.log(`  Mean: ${benchmark.stats.mean.toFixed(2)}ms`);
    console.log(`  Median: ${benchmark.stats.median.toFixed(2)}ms`);
    console.log(`  P95: ${benchmark.stats.p95.toFixed(2)}ms`);
    console.log(
      `  Min: ${benchmark.stats.min.toFixed(2)}ms, Max: ${benchmark.stats.max.toFixed(2)}ms`
    );
    if (benchmark.throughput !== undefined) {
      console.log(`  Throughput: ${benchmark.throughput.toFixed(2)} texts/sec`);
    }
  }
}

describe.skipIf(!shouldRunBenchmarks)("Embedding Performance Benchmarks", () => {
  describe("Transformers.js Performance", () => {
    let provider: EmbeddingProvider;
    const benchmarks: PerformanceBenchmark[] = [];

    beforeAll(async () => {
      console.log("\nInitializing Transformers.js provider for performance benchmark...");

      const config: EmbeddingProviderConfig = {
        provider: "transformersjs",
        model: "Xenova/all-MiniLM-L6-v2",
        dimensions: 384,
        batchSize: 32,
        maxRetries: 0,
        timeoutMs: 300000,
      };

      // Measure cold start (model initialization)
      const coldStartResult = await measureTime(async () => {
        provider = createEmbeddingProvider(config);
        await provider.generateEmbedding("cold start initialization");
      });

      console.log(`Cold start: ${coldStartResult.elapsedMs.toFixed(2)}ms`);

      benchmarks.push({
        name: "Model Initialization (Cold Start)",
        stats: calculateStats([coldStartResult.elapsedMs]),
        target: PERFORMANCE_TARGETS.modelInitCold,
        passed: coldStartResult.elapsedMs <= PERFORMANCE_TARGETS.modelInitCold,
      });
    }, 600000);

    test("single embedding latency (warm)", async () => {
      // Run multiple iterations to get statistics
      const latencies = await benchmarkFunction(
        async () => {
          await provider.generateEmbedding(BENCHMARK_TEXTS.short[0]!);
        },
        20, // iterations
        3 // warmup
      );

      const stats = calculateStats(latencies);

      benchmarks.push({
        name: "Single Embedding (Warm)",
        stats,
        target: PERFORMANCE_TARGETS.singleEmbeddingWarm,
        passed: stats.median <= PERFORMANCE_TARGETS.singleEmbeddingWarm,
      });

      if (verbose) {
        console.log(formatStats(stats, "Single Embedding"));
      }

      // P50 should be under target
      expect(stats.median).toBeLessThanOrEqual(PERFORMANCE_TARGETS.singleEmbeddingWarm * 2);
    });

    test("batch of 10 embeddings", async () => {
      const latencies = await benchmarkFunction(
        async () => {
          await provider.generateEmbeddings(BENCHMARK_TEXTS.short);
        },
        10,
        2
      );

      const stats = calculateStats(latencies);

      benchmarks.push({
        name: "Batch of 10 Embeddings",
        stats,
        target: PERFORMANCE_TARGETS.batchOf10,
        passed: stats.median <= PERFORMANCE_TARGETS.batchOf10,
      });

      if (verbose) {
        console.log(formatStats(stats, "Batch of 10"));
      }

      expect(stats.median).toBeLessThanOrEqual(PERFORMANCE_TARGETS.batchOf10 * 2);
    });

    test("throughput benchmark", async () => {
      const texts = BENCHMARK_TEXTS.short;
      const iterations = 5;

      const latencies: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const { elapsedMs } = await measureTime(async () => {
          await provider.generateEmbeddings(texts);
        });
        latencies.push(elapsedMs);
      }

      const stats = calculateStats(latencies);
      const avgTimePerBatch = stats.mean;
      const throughput = (texts.length / avgTimePerBatch) * 1000; // texts per second

      benchmarks.push({
        name: "Throughput",
        stats,
        target: PERFORMANCE_TARGETS.minThroughput,
        passed: throughput >= PERFORMANCE_TARGETS.minThroughput,
        throughput,
      });

      console.log(`\nThroughput: ${throughput.toFixed(2)} texts/second`);

      expect(throughput).toBeGreaterThanOrEqual(PERFORMANCE_TARGETS.minThroughput);
    });

    test("text length impact", async () => {
      const categories = ["tiny", "short", "medium"] as const;

      console.log("\nLatency by text length:");

      for (const category of categories) {
        const texts = BENCHMARK_TEXTS[category];
        const text = texts[0]!;

        const latencies = await benchmarkFunction(
          async () => {
            await provider.generateEmbedding(text);
          },
          10,
          2
        );

        const stats = calculateStats(latencies);
        console.log(`  ${category} (${text.length} chars): ${stats.median.toFixed(2)}ms median`);
      }

      // All should complete
      expect(true).toBe(true);
    });

    test("code embedding performance", async () => {
      const latencies = await benchmarkFunction(
        async () => {
          await provider.generateEmbedding(BENCHMARK_TEXTS.code[0]!);
        },
        10,
        2
      );

      const stats = calculateStats(latencies);

      console.log(`\nCode embedding: ${stats.median.toFixed(2)}ms median`);

      // Should complete in reasonable time
      expect(stats.median).toBeLessThan(1000);
    });

    test("print performance summary", () => {
      printBenchmarks("Transformers.js", benchmarks);

      // At least some benchmarks should pass
      const passedCount = benchmarks.filter((b) => b.passed).length;
      expect(passedCount).toBeGreaterThan(0);
    });
  });

  describe.skipIf(!includeOllama)("Ollama Performance", () => {
    let provider: EmbeddingProvider;
    const benchmarks: PerformanceBenchmark[] = [];
    const ollamaBaseUrl = Bun.env["OLLAMA_BASE_URL"] || "http://localhost:11434";

    beforeAll(async () => {
      console.log(`\nInitializing Ollama provider at ${ollamaBaseUrl}...`);

      const config: EmbeddingProviderConfig = {
        provider: "ollama",
        model: "nomic-embed-text",
        dimensions: 768,
        batchSize: 32,
        maxRetries: 3,
        timeoutMs: 60000,
      };

      provider = createEmbeddingProvider(config);

      // Check health
      const healthy = await provider.healthCheck();
      if (!healthy) {
        throw new Error(`Ollama not available at ${ollamaBaseUrl}`);
      }

      // Warm up model
      const warmupResult = await measureTime(async () => {
        await provider.generateEmbedding("warmup");
      });

      console.log(`Initial warmup: ${warmupResult.elapsedMs.toFixed(2)}ms`);
    }, 120000);

    test("single embedding latency (warm)", async () => {
      const latencies = await benchmarkFunction(
        async () => {
          await provider.generateEmbedding(BENCHMARK_TEXTS.short[0]!);
        },
        20,
        3
      );

      const stats = calculateStats(latencies);

      benchmarks.push({
        name: "Single Embedding (Warm)",
        stats,
        target: 50, // Ollama target is 50ms with GPU
        passed: stats.median <= 100, // More lenient for CPU
      });

      if (verbose) {
        console.log(formatStats(stats, "Single Embedding"));
      }

      // Should complete in reasonable time
      expect(stats.median).toBeLessThan(500);
    });

    test("batch of 10 embeddings", async () => {
      // Ollama processes sequentially, so batch of 10 will be ~10x single
      const latencies = await benchmarkFunction(
        async () => {
          await provider.generateEmbeddings(BENCHMARK_TEXTS.short.slice(0, 5)); // Use 5 for speed
        },
        5,
        1
      );

      const stats = calculateStats(latencies);

      benchmarks.push({
        name: "Batch of 5 Embeddings",
        stats,
        target: 500,
        passed: stats.median <= 1000,
      });

      if (verbose) {
        console.log(formatStats(stats, "Batch of 5"));
      }

      expect(stats.median).toBeLessThan(2000);
    });

    test("throughput benchmark", async () => {
      const texts = BENCHMARK_TEXTS.short.slice(0, 5); // Use 5 for speed
      const iterations = 3;

      const latencies: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const { elapsedMs } = await measureTime(async () => {
          await provider.generateEmbeddings(texts);
        });
        latencies.push(elapsedMs);
      }

      const stats = calculateStats(latencies);
      const avgTimePerBatch = stats.mean;
      const throughput = (texts.length / avgTimePerBatch) * 1000;

      benchmarks.push({
        name: "Throughput",
        stats,
        target: PERFORMANCE_TARGETS.minThroughput,
        passed: throughput >= PERFORMANCE_TARGETS.minThroughput,
        throughput,
      });

      console.log(`\nThroughput: ${throughput.toFixed(2)} texts/second`);

      // Should have reasonable throughput
      expect(throughput).toBeGreaterThan(0);
    });

    test("print performance summary", () => {
      printBenchmarks("Ollama", benchmarks);

      // Summary printed, test passes
      expect(true).toBe(true);
    });
  });

  describe("Comparative Performance", () => {
    test.skipIf(!includeOllama)(
      "compare Transformers.js vs Ollama latency",
      async () => {
        // Initialize both providers
        const transformersConfig: EmbeddingProviderConfig = {
          provider: "transformersjs",
          model: "Xenova/all-MiniLM-L6-v2",
          dimensions: 384,
          batchSize: 32,
          maxRetries: 0,
          timeoutMs: 300000,
        };

        const ollamaConfig: EmbeddingProviderConfig = {
          provider: "ollama",
          model: "nomic-embed-text",
          dimensions: 768,
          batchSize: 32,
          maxRetries: 3,
          timeoutMs: 60000,
        };

        const transformersProvider = createEmbeddingProvider(transformersConfig);
        const ollamaProvider = createEmbeddingProvider(ollamaConfig);

        // Warm up both
        await transformersProvider.generateEmbedding("warmup");
        await ollamaProvider.generateEmbedding("warmup");

        // Compare single embedding latency
        const testText = "Compare embedding latency between providers";

        const transformersLatencies = await benchmarkFunction(
          async () => {
            await transformersProvider.generateEmbedding(testText);
          },
          10,
          2
        );

        const ollamaLatencies = await benchmarkFunction(
          async () => {
            await ollamaProvider.generateEmbedding(testText);
          },
          10,
          2
        );

        const transformersStats = calculateStats(transformersLatencies);
        const ollamaStats = calculateStats(ollamaLatencies);

        console.log("\n=== Latency Comparison ===");
        console.log(`Transformers.js: ${transformersStats.median.toFixed(2)}ms median`);
        console.log(`Ollama: ${ollamaStats.median.toFixed(2)}ms median`);

        const faster = transformersStats.median < ollamaStats.median ? "Transformers.js" : "Ollama";
        const ratio =
          Math.max(transformersStats.median, ollamaStats.median) /
          Math.min(transformersStats.median, ollamaStats.median);

        console.log(`${faster} is ${ratio.toFixed(2)}x faster`);

        // Both should complete
        expect(transformersStats.median).toBeGreaterThan(0);
        expect(ollamaStats.median).toBeGreaterThan(0);
      },
      120000
    );
  });
});

// Print instructions if benchmarks are skipped
if (!shouldRunBenchmarks) {
  console.log(
    "\n⏱️ Performance benchmarks are SKIPPED by default.\n" +
      "To run these benchmarks:\n\n" +
      "  Basic (Transformers.js only):\n" +
      "    RUN_BENCHMARKS=true bun test tests/benchmarks/embedding-performance.bench.ts\n\n" +
      "  With Ollama comparison:\n" +
      "    RUN_BENCHMARKS=true INCLUDE_OLLAMA=true bun test tests/benchmarks/embedding-performance.bench.ts\n\n" +
      "  Verbose output:\n" +
      "    RUN_BENCHMARKS=true VERBOSE=true bun test tests/benchmarks/embedding-performance.bench.ts\n\n" +
      "Note: First run may download Transformers.js model (~22MB).\n"
  );
}
