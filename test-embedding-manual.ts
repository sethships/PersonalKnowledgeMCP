/* eslint-disable @typescript-eslint/no-floating-promises */
/**
 * Manual test script for embedding provider
 *
 * Tests the OpenAI embedding provider with a real API key to verify:
 * 1. Successful embedding generation
 * 2. API key sanitization in error messages
 * 3. Health check functionality
 * 4. Batch processing
 *
 * Run with: bun run test-embedding-manual.ts
 */

import { createEmbeddingProvider } from "./src/providers/index.js";
import type { EmbeddingProviderConfig } from "./src/providers/index.js";

async function main() {
  console.log("=== Manual Embedding Provider Test ===\n");

  // Check for API key
  const apiKey = Bun.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("ERROR: OPENAI_API_KEY environment variable not set");
    console.error("Please set it in your .env file or export it:");
    console.error("  export OPENAI_API_KEY='sk-...'");
    process.exit(1);
  }

  console.log("✓ API key found in environment");
  console.log(`  Key prefix: ${apiKey.substring(0, 8)}...`);

  // Create provider
  const config: EmbeddingProviderConfig = {
    provider: "openai",
    model: "text-embedding-3-small",
    dimensions: 1536,
    batchSize: 100,
    maxRetries: 3,
    timeoutMs: 30000,
  };

  console.log("\n1. Creating embedding provider...");
  const provider = createEmbeddingProvider(config);
  console.log(`   Provider: ${provider.providerId}`);
  console.log(`   Model: ${provider.modelId}`);
  console.log(`   Dimensions: ${provider.dimensions}`);

  // Test 1: Health check
  console.log("\n2. Testing health check...");
  const isHealthy = await provider.healthCheck();
  if (!isHealthy) {
    console.error("   ✗ Health check failed");
    process.exit(1);
  }
  console.log("   ✓ Health check passed");

  // Test 2: Single embedding
  console.log("\n3. Testing single embedding...");
  const text = "Hello world! This is a test of the OpenAI embedding provider.";
  console.log(`   Input: "${text}"`);
  const embedding = await provider.generateEmbedding(text);
  console.log(`   ✓ Generated embedding with ${embedding.length} dimensions`);
  console.log(
    `   First 5 values: [${embedding
      .slice(0, 5)
      .map((v) => v.toFixed(4))
      .join(", ")}]`
  );

  // Test 3: Batch embeddings
  console.log("\n4. Testing batch embeddings...");
  const texts = [
    "First test sentence",
    "Second test sentence",
    "Third test sentence",
    "Fourth test sentence",
    "Fifth test sentence",
  ];
  console.log(`   Input: ${texts.length} texts`);
  const embeddings = await provider.generateEmbeddings(texts);
  console.log(`   ✓ Generated ${embeddings.length} embeddings`);
  console.log(`   Each embedding has ${embeddings[0].length} dimensions`);

  // Test 4: Verify API key sanitization (trigger an error with invalid API key)
  console.log("\n5. Testing API key sanitization...");
  console.log("   Creating provider with invalid API key to test error handling...");
  try {
    const badConfig: EmbeddingProviderConfig = {
      provider: "openai",
      model: "text-embedding-3-small",
      dimensions: 1536,
      batchSize: 100,
      maxRetries: 0, // No retries for faster failure
      timeoutMs: 5000,
    };

    // Set a fake API key temporarily
    const originalKey = Bun.env.OPENAI_API_KEY;
    Bun.env.OPENAI_API_KEY = "sk-fake1234567890abcdefghijklmnop";

    const badProvider = createEmbeddingProvider(badConfig);

    // Restore original key
    Bun.env.OPENAI_API_KEY = originalKey;

    await badProvider.generateEmbedding("test");
    console.error("   ✗ Should have thrown an error!");
  } catch (error) {
    const errorMessage = (error as Error).message;
    console.log(`   Error message: "${errorMessage}"`);

    // Verify API key is NOT in the error message
    if (errorMessage.includes("sk-fake")) {
      console.error("   ✗ API key was NOT sanitized!");
      console.error("   Error message contains API key!");
      process.exit(1);
    } else {
      console.log("   ✓ API key properly sanitized in error message");
    }
  }

  console.log("\n=== All tests passed! ===");
}

main().catch((error) => {
  console.error("\n=== Test failed with error ===");
  console.error(error);
  process.exit(1);
});
