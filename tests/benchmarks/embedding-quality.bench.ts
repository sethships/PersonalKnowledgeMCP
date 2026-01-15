/* eslint-disable @typescript-eslint/no-non-null-assertion */
/**
 * Quality benchmark tests for embedding providers
 *
 * Compares semantic quality of local embedding providers against OpenAI as reference.
 * Tests measure how well embeddings capture semantic similarity using:
 * - Cosine similarity for semantically similar text pairs
 * - Ranking quality (similar texts should score higher than dissimilar)
 * - Cross-provider correlation
 *
 * Run with:
 *   RUN_BENCHMARKS=true bun test tests/benchmarks/embedding-quality.bench.ts
 *
 * For full comparison with OpenAI (requires OPENAI_API_KEY):
 *   RUN_BENCHMARKS=true INCLUDE_OPENAI=true bun test tests/benchmarks/embedding-quality.bench.ts
 *
 * Prerequisites:
 * - Transformers.js model downloaded (first run may take a few minutes)
 * - Ollama running with nomic-embed-text model (optional)
 * - OpenAI API key set for reference comparison (optional)
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { createEmbeddingProvider } from "../../src/providers/factory.js";
import type { EmbeddingProvider, EmbeddingProviderConfig } from "../../src/providers/types.js";
import {
  cosineSimilarity,
  QUALITY_TEST_CASES,
  type QualityTestCase,
} from "../fixtures/benchmark-fixtures.js";

// Test configuration
const shouldRunBenchmarks = Bun.env["RUN_BENCHMARKS"] === "true";
const includeOpenAI = Bun.env["INCLUDE_OPENAI"] === "true" && !!Bun.env["OPENAI_API_KEY"];
const includeOllama = Bun.env["INCLUDE_OLLAMA"] === "true";

/**
 * Quality test result for a single test case
 */
interface QualityResult {
  testCase: QualityTestCase;
  similarityScore: number;
  dissimilarityScore: number;
  passed: boolean;
  margin: number;
}

/**
 * Provider quality summary
 */
interface ProviderQualitySummary {
  providerId: string;
  totalTests: number;
  passedTests: number;
  passRate: number;
  avgSimilarityScore: number;
  avgDissimilarityScore: number;
  avgMargin: number;
}

/**
 * Run quality tests for a provider
 */
async function runQualityTests(
  provider: EmbeddingProvider,
  testCases: QualityTestCase[]
): Promise<QualityResult[]> {
  const results: QualityResult[] = [];

  for (const testCase of testCases) {
    try {
      // Get embeddings for all three texts
      const embeddings = await provider.generateEmbeddings([
        testCase.similar[0],
        testCase.similar[1],
        testCase.dissimilar,
      ]);

      // Calculate similarities
      const similarityScore = cosineSimilarity(embeddings[0]!, embeddings[1]!);
      const dissimilarityScore = cosineSimilarity(embeddings[0]!, embeddings[2]!);

      // Test passes if similar texts have higher similarity than dissimilar
      const passed = similarityScore > dissimilarityScore;
      const margin = similarityScore - dissimilarityScore;

      results.push({
        testCase,
        similarityScore,
        dissimilarityScore,
        passed,
        margin,
      });
    } catch (error) {
      console.error(`Error testing ${testCase.id}:`, error);
      results.push({
        testCase,
        similarityScore: 0,
        dissimilarityScore: 0,
        passed: false,
        margin: 0,
      });
    }
  }

  return results;
}

/**
 * Calculate summary statistics for quality results
 */
function summarizeResults(providerId: string, results: QualityResult[]): ProviderQualitySummary {
  const passedTests = results.filter((r) => r.passed).length;
  const avgSimilarity = results.reduce((sum, r) => sum + r.similarityScore, 0) / results.length;
  const avgDissimilarity =
    results.reduce((sum, r) => sum + r.dissimilarityScore, 0) / results.length;
  const avgMargin = results.reduce((sum, r) => sum + r.margin, 0) / results.length;

  return {
    providerId,
    totalTests: results.length,
    passedTests,
    passRate: passedTests / results.length,
    avgSimilarityScore: avgSimilarity,
    avgDissimilarityScore: avgDissimilarity,
    avgMargin,
  };
}

/**
 * Print quality summary to console
 */
function printSummary(summary: ProviderQualitySummary): void {
  console.log(`\n=== ${summary.providerId} Quality Summary ===`);
  console.log(
    `Pass Rate: ${(summary.passRate * 100).toFixed(1)}% (${summary.passedTests}/${summary.totalTests})`
  );
  console.log(`Avg Similarity Score: ${summary.avgSimilarityScore.toFixed(4)}`);
  console.log(`Avg Dissimilarity Score: ${summary.avgDissimilarityScore.toFixed(4)}`);
  console.log(`Avg Margin: ${summary.avgMargin.toFixed(4)}`);
}

/**
 * Print detailed results
 */
function printDetailedResults(results: QualityResult[]): void {
  console.log("\nDetailed Results:");
  console.log("-".repeat(80));

  for (const result of results) {
    const status = result.passed ? "✓" : "✗";
    console.log(
      `${status} ${result.testCase.id} (${result.testCase.category}): ` +
        `sim=${result.similarityScore.toFixed(4)}, ` +
        `dissim=${result.dissimilarityScore.toFixed(4)}, ` +
        `margin=${result.margin.toFixed(4)}`
    );
  }
}

describe.skipIf(!shouldRunBenchmarks)("Embedding Quality Benchmarks", () => {
  describe("Transformers.js Quality", () => {
    let provider: EmbeddingProvider;
    let results: QualityResult[];

    beforeAll(async () => {
      console.log("\nInitializing Transformers.js provider for quality benchmark...");

      const config: EmbeddingProviderConfig = {
        provider: "transformersjs",
        model: "Xenova/all-MiniLM-L6-v2",
        dimensions: 384,
        batchSize: 32,
        maxRetries: 0,
        timeoutMs: 300000,
      };

      provider = createEmbeddingProvider(config);

      // Warm up
      await provider.generateEmbedding("warmup");

      // Run all quality tests
      console.log("Running quality tests...");
      results = await runQualityTests(provider, QUALITY_TEST_CASES);

      const summary = summarizeResults("transformersjs", results);
      printSummary(summary);
      printDetailedResults(results);
    }, 600000);

    test("achieves minimum 70% pass rate on quality tests", () => {
      const passRate = results.filter((r) => r.passed).length / results.length;
      expect(passRate).toBeGreaterThanOrEqual(0.7);
    });

    test("similar texts have positive similarity", () => {
      const avgSimilarity = results.reduce((sum, r) => sum + r.similarityScore, 0) / results.length;
      expect(avgSimilarity).toBeGreaterThan(0);
    });

    test("average margin between similar and dissimilar is positive", () => {
      const avgMargin = results.reduce((sum, r) => sum + r.margin, 0) / results.length;
      expect(avgMargin).toBeGreaterThan(0);
    });

    test("semantic test cases pass", () => {
      const semanticResults = results.filter((r) => r.testCase.category === "semantic");
      const passRate = semanticResults.filter((r) => r.passed).length / semanticResults.length;
      expect(passRate).toBeGreaterThanOrEqual(0.6);
    });

    test("code test cases pass", () => {
      const codeResults = results.filter((r) => r.testCase.category === "code");
      const passRate = codeResults.filter((r) => r.passed).length / codeResults.length;
      expect(passRate).toBeGreaterThanOrEqual(0.6);
    });
  });

  describe.skipIf(!includeOllama)("Ollama Quality", () => {
    let provider: EmbeddingProvider;
    let results: QualityResult[];
    const ollamaBaseUrl = Bun.env["OLLAMA_BASE_URL"] || "http://localhost:11434";

    beforeAll(async () => {
      console.log(`\nInitializing Ollama provider at ${ollamaBaseUrl} for quality benchmark...`);

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

      // Warm up
      await provider.generateEmbedding("warmup");

      // Run all quality tests
      console.log("Running quality tests...");
      results = await runQualityTests(provider, QUALITY_TEST_CASES);

      const summary = summarizeResults("ollama", results);
      printSummary(summary);
      printDetailedResults(results);
    }, 300000);

    test("achieves minimum 70% pass rate on quality tests", () => {
      const passRate = results.filter((r) => r.passed).length / results.length;
      expect(passRate).toBeGreaterThanOrEqual(0.7);
    });

    test("similar texts have positive similarity", () => {
      const avgSimilarity = results.reduce((sum, r) => sum + r.similarityScore, 0) / results.length;
      expect(avgSimilarity).toBeGreaterThan(0);
    });

    test("average margin between similar and dissimilar is positive", () => {
      const avgMargin = results.reduce((sum, r) => sum + r.margin, 0) / results.length;
      expect(avgMargin).toBeGreaterThan(0);
    });
  });

  describe.skipIf(!includeOpenAI)("OpenAI Reference Comparison", () => {
    let openaiProvider: EmbeddingProvider;
    let transformersProvider: EmbeddingProvider;
    let openaiResults: QualityResult[];
    let transformersResults: QualityResult[];

    beforeAll(async () => {
      console.log("\nInitializing providers for OpenAI comparison...");

      // Initialize OpenAI provider
      const openaiConfig: EmbeddingProviderConfig = {
        provider: "openai",
        model: "text-embedding-3-small",
        dimensions: 1536,
        batchSize: 100,
        maxRetries: 3,
        timeoutMs: 30000,
      };
      openaiProvider = createEmbeddingProvider(openaiConfig);

      // Initialize Transformers.js provider
      const transformersConfig: EmbeddingProviderConfig = {
        provider: "transformersjs",
        model: "Xenova/all-MiniLM-L6-v2",
        dimensions: 384,
        batchSize: 32,
        maxRetries: 0,
        timeoutMs: 300000,
      };
      transformersProvider = createEmbeddingProvider(transformersConfig);

      // Warm up both providers
      await openaiProvider.generateEmbedding("warmup");
      await transformersProvider.generateEmbedding("warmup");

      // Run quality tests on both
      console.log("Running quality tests on OpenAI...");
      openaiResults = await runQualityTests(openaiProvider, QUALITY_TEST_CASES);

      console.log("Running quality tests on Transformers.js...");
      transformersResults = await runQualityTests(transformersProvider, QUALITY_TEST_CASES);

      const openaiSummary = summarizeResults("openai", openaiResults);
      const transformersSummary = summarizeResults("transformersjs", transformersResults);

      printSummary(openaiSummary);
      printSummary(transformersSummary);
    }, 600000);

    test("Transformers.js pass rate within 20% of OpenAI", () => {
      const openaiPassRate = openaiResults.filter((r) => r.passed).length / openaiResults.length;
      const transformersPassRate =
        transformersResults.filter((r) => r.passed).length / transformersResults.length;

      const difference = Math.abs(openaiPassRate - transformersPassRate);
      console.log(`\nPass rate comparison:`);
      console.log(`  OpenAI: ${(openaiPassRate * 100).toFixed(1)}%`);
      console.log(`  Transformers.js: ${(transformersPassRate * 100).toFixed(1)}%`);
      console.log(`  Difference: ${(difference * 100).toFixed(1)}%`);

      expect(difference).toBeLessThanOrEqual(0.2);
    });

    test("ranking correlation between providers", () => {
      // Compare rankings: which test cases both providers agree on
      const agreementCount = QUALITY_TEST_CASES.filter((_, i) => {
        const openaiPassed = openaiResults[i]?.passed ?? false;
        const transformersPassed = transformersResults[i]?.passed ?? false;
        return openaiPassed === transformersPassed;
      }).length;

      const agreementRate = agreementCount / QUALITY_TEST_CASES.length;
      console.log(`\nRanking agreement: ${(agreementRate * 100).toFixed(1)}%`);

      // Expect at least 60% agreement
      expect(agreementRate).toBeGreaterThanOrEqual(0.6);
    });

    test("margin correlation between providers", () => {
      // Calculate Pearson correlation between margins
      const openaiMargins = openaiResults.map((r) => r.margin);
      const transformersMargins = transformersResults.map((r) => r.margin);

      const n = openaiMargins.length;
      const meanOpenai = openaiMargins.reduce((a, b) => a + b, 0) / n;
      const meanTransformers = transformersMargins.reduce((a, b) => a + b, 0) / n;

      let numerator = 0;
      let denomOpenai = 0;
      let denomTransformers = 0;

      for (let i = 0; i < n; i++) {
        const diffOpenai = openaiMargins[i]! - meanOpenai;
        const diffTransformers = transformersMargins[i]! - meanTransformers;
        numerator += diffOpenai * diffTransformers;
        denomOpenai += diffOpenai * diffOpenai;
        denomTransformers += diffTransformers * diffTransformers;
      }

      const correlation = numerator / Math.sqrt(denomOpenai * denomTransformers);
      console.log(`\nMargin correlation: ${correlation.toFixed(4)}`);

      // Expect positive correlation (both should trend same direction)
      expect(correlation).toBeGreaterThan(0);
    });
  });
});

// Print instructions if benchmarks are skipped
if (!shouldRunBenchmarks) {
  console.log(
    "\n📊 Embedding quality benchmarks are SKIPPED by default.\n" +
      "To run these benchmarks:\n\n" +
      "  Basic (Transformers.js only):\n" +
      "    RUN_BENCHMARKS=true bun test tests/benchmarks/embedding-quality.bench.ts\n\n" +
      "  With Ollama comparison:\n" +
      "    RUN_BENCHMARKS=true INCLUDE_OLLAMA=true bun test tests/benchmarks/embedding-quality.bench.ts\n\n" +
      "  With OpenAI reference comparison:\n" +
      "    RUN_BENCHMARKS=true INCLUDE_OPENAI=true bun test tests/benchmarks/embedding-quality.bench.ts\n\n" +
      "Note: First run may download Transformers.js model (~22MB).\n"
  );
}
