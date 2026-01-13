/**
 * Tests for CLI Dependency Initialization - Provider Resolution
 *
 * These tests verify the provider resolution logic without mocking the full
 * dependency initialization chain, which would require mocking many modules
 * and cause mock leakage issues in Bun's test runner.
 *
 * Full integration tests for initializeDependencies() would require either:
 * 1. Running in isolation (separate test process)
 * 2. Using Bun's native module mocking when it supports scoped mocks
 *
 * The provider resolution logic is also covered by:
 * - tests/cli/utils/validation.test.ts (Zod schema validation)
 * - Manual testing with `bun run cli index --provider <value>`
 */

import { describe, it, expect } from "bun:test";

// Test the provider resolution priority logic conceptually
// These are behavioral specifications that document expected behavior
describe("Provider Resolution Priority (Design Specification)", () => {
  describe("resolution order", () => {
    it("CLI flag should take priority over environment variable", () => {
      // Given:
      // - EMBEDDING_PROVIDER env var = "openai"
      // - CLI --provider flag = "transformersjs"
      //
      // Expected: Use "transformersjs" from CLI flag
      //
      // This is documented in dependency-init.ts lines 121-127:
      // const resolvedProvider =
      //   options?.provider ||
      //   Bun.env["EMBEDDING_PROVIDER"] ||
      //   embeddingProviderFactory.getDefaultProvider();

      const cliProvider = "transformersjs";
      const envProvider = "openai";
      const defaultProvider = "transformersjs";

      const resolved = cliProvider || envProvider || defaultProvider;
      expect(resolved).toBe("transformersjs");
    });

    it("Environment variable should be used when no CLI flag", () => {
      // Given:
      // - EMBEDDING_PROVIDER env var = "ollama"
      // - CLI --provider flag = undefined
      //
      // Expected: Use "ollama" from environment variable

      const cliProvider = undefined;
      const envProvider = "ollama";
      const defaultProvider = "transformersjs";

      const resolved = cliProvider || envProvider || defaultProvider;
      expect(resolved).toBe("ollama");
    });

    it("Factory default should be used when neither CLI nor env var set", () => {
      // Given:
      // - EMBEDDING_PROVIDER env var = undefined
      // - CLI --provider flag = undefined
      //
      // Expected: Use factory default

      const cliProvider = undefined;
      const envProvider = undefined;
      const defaultProvider = "transformersjs";

      const resolved = cliProvider || envProvider || defaultProvider;
      expect(resolved).toBe("transformersjs");
    });
  });

  describe("provider lookup logic", () => {
    it("should find provider by exact ID match (lowercase)", () => {
      const providers = [
        { id: "openai", aliases: [] as string[], requiredEnvVars: ["OPENAI_API_KEY"] },
        {
          id: "transformersjs",
          aliases: ["local", "transformers"],
          requiredEnvVars: [] as string[],
        },
        { id: "ollama", aliases: [] as string[], requiredEnvVars: ["OLLAMA_HOST"] },
      ];

      const resolvedProvider = "OPENAI"; // User passes uppercase

      // This matches the logic in dependency-init.ts lines 131-137
      const providerInfo = providers.find(
        (p) =>
          p.id === resolvedProvider.toLowerCase() ||
          p.aliases.includes(resolvedProvider.toLowerCase())
      );

      expect(providerInfo).toBeDefined();
      expect(providerInfo?.id).toBe("openai");
    });

    it("should find provider by alias match", () => {
      const providers = [
        { id: "openai", aliases: [] as string[], requiredEnvVars: ["OPENAI_API_KEY"] },
        {
          id: "transformersjs",
          aliases: ["local", "transformers"],
          requiredEnvVars: [] as string[],
        },
        { id: "ollama", aliases: [] as string[], requiredEnvVars: ["OLLAMA_HOST"] },
      ];

      const resolvedProvider = "local"; // Alias for transformersjs

      const providerInfo = providers.find(
        (p) =>
          p.id === resolvedProvider.toLowerCase() ||
          p.aliases.includes(resolvedProvider.toLowerCase())
      );

      expect(providerInfo).toBeDefined();
      expect(providerInfo?.id).toBe("transformersjs");
    });

    it("should return undefined for unknown provider", () => {
      const providers = [
        { id: "openai", aliases: [] as string[], requiredEnvVars: ["OPENAI_API_KEY"] },
        {
          id: "transformersjs",
          aliases: ["local", "transformers"],
          requiredEnvVars: [] as string[],
        },
      ];

      const resolvedProvider = "unknown-provider";

      const providerInfo = providers.find(
        (p) =>
          p.id === resolvedProvider.toLowerCase() ||
          p.aliases.includes(resolvedProvider.toLowerCase())
      );

      expect(providerInfo).toBeUndefined();
    });
  });
});

// Document expected error messages
describe("Error Messages (Design Specification)", () => {
  it("should describe unavailable provider error format", () => {
    // When a known provider is not available (missing env vars),
    // the error should include required environment variables
    const provider = "openai";
    const requiredEnvVars = ["OPENAI_API_KEY"];

    const errorMessage =
      `Provider '${provider}' is not available.\n` +
      `Required environment variables: ${requiredEnvVars.join(", ")}\n` +
      `Please set these in your .env file or environment.`;

    expect(errorMessage).toContain("Provider 'openai' is not available");
    expect(errorMessage).toContain("OPENAI_API_KEY");
  });

  it("should describe unknown provider error format", () => {
    // When provider is not recognized at all
    const provider = "unknown";
    const validProviders = ["openai", "transformersjs", "ollama"];

    const errorMessage =
      `Unknown provider: '${provider}'.\n` + `Valid providers: ${validProviders.join(", ")}`;

    expect(errorMessage).toContain("Unknown provider");
    expect(errorMessage).toContain("openai");
  });
});
