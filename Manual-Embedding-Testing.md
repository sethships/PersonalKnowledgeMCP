# Manual Embedding Provider Testing

This guide explains how to manually test the OpenAI embedding provider with a real API key to verify functionality outside of automated tests.

## Prerequisites

- Valid OpenAI API key with access to embeddings API
- Environment variable `OPENAI_API_KEY` set in your `.env` file
- Bun runtime installed

## What This Test Verifies

1. **Successful embedding generation** - Provider can generate embeddings for text
2. **API key sanitization** - Sensitive API keys are redacted from error messages
3. **Health check functionality** - Provider can verify connectivity
4. **Batch processing** - Multiple texts can be embedded efficiently

## Running the Test

### Setup

Create a test file `test-embedding-manual.ts` in your project root:

```typescript
/* eslint-disable @typescript-eslint/no-floating-promises */
/**
 * Manual test script for embedding provider
 */

import { createEmbeddingProvider } from "./src/providers/index.js";
import type { EmbeddingProviderConfig } from "./src/providers/index.js";

async function main() {
  console.log("=== Manual Embedding Provider Test ===\n");

  // Check for API key
  const apiKey = Bun.env["OPENAI_API_KEY"];
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
  console.log(`   Each embedding has ${embeddings[0]!.length} dimensions`);

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
    const originalKey = Bun.env["OPENAI_API_KEY"];
    Bun.env["OPENAI_API_KEY"] = "sk-fake1234567890abcdefghijklmnop";

    const badProvider = createEmbeddingProvider(badConfig);

    // Restore original key
    Bun.env["OPENAI_API_KEY"] = originalKey;

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
```

### Execute the Test

```bash
# Ensure your .env file has OPENAI_API_KEY set
bun run test-embedding-manual.ts
```

## Expected Output

```
=== Manual Embedding Provider Test ===

✓ API key found in environment
  Key prefix: sk-proj-...

1. Creating embedding provider...
   Provider: openai
   Model: text-embedding-3-small
   Dimensions: 1536

2. Testing health check...
   ✓ Health check passed

3. Testing single embedding...
   Input: "Hello world! This is a test of the OpenAI embedding provider."
   ✓ Generated embedding with 1536 dimensions
   First 5 values: [0.0123, -0.0456, 0.0789, -0.0234, 0.0567]

4. Testing batch embeddings...
   Input: 5 texts
   ✓ Generated 5 embeddings
   Each embedding has 1536 dimensions

5. Testing API key sanitization...
   Creating provider with invalid API key to test error handling...
   Error message: "Invalid API key or insufficient permissions"
   ✓ API key properly sanitized in error message

=== All tests passed! ===
```

## Troubleshooting

### "OPENAI_API_KEY environment variable not set"

**Solution:** Create a `.env` file in the project root:

```bash
OPENAI_API_KEY=sk-proj-your-actual-key-here
```

### Health Check Failed

**Possible causes:**
- Invalid or expired API key
- Network connectivity issues
- OpenAI API service disruption
- Rate limiting

**Solution:**
1. Verify your API key is valid in OpenAI dashboard
2. Check network connectivity
3. Review OpenAI status page

### "Invalid API key" Error

**Solution:** Double-check your API key:
- Must start with `sk-proj-` or `sk-`
- No extra spaces or quotes
- Key must have embeddings API access enabled

### Rate Limit Errors

If you see 429 errors:
- Wait a moment and retry
- Check your OpenAI account rate limits
- Consider upgrading your OpenAI plan for higher limits

## Cost Considerations

The manual test uses minimal tokens:
- Health check: ~1 token (~$0.000001)
- Single embedding: ~10 tokens (~$0.000002)
- Batch of 5: ~50 tokens (~$0.00001)

**Total cost per test run: < $0.00002 (two cents per 1000 runs)**

## Security Notes

- **Never commit API keys** to version control
- The provider automatically sanitizes API keys in error messages
- Test output intentionally truncates the API key display
- Error messages will show `sk-***REDACTED***` instead of actual keys

## Integration with Automated Tests

This manual test complements automated unit tests but provides:
- **Real API verification** - Confirms actual OpenAI connectivity
- **End-to-end validation** - Tests the complete provider setup
- **Troubleshooting** - Helps diagnose issues in development

For automated testing without API calls, see:
- `tests/unit/providers/openai-embedding.test.ts` - Mocked unit tests
- `tests/integration/providers/` - Integration tests (if enabled)
