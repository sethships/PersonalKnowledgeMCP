/**
 * Unit tests for models-formatters
 *
 * Tests formatting functions for model cache CLI output.
 *
 * @see Issue #165: Add model download and caching logic
 */

/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { describe, it, expect } from "bun:test";

import {
  formatBytes,
  createModelsListTable,
  formatModelsJson,
  createCacheStatusTable,
  formatCacheStatusJson,
  createValidationResultTable,
  formatValidationJson,
  createModelPathTable,
  formatClearResult,
  formatImportResult,
} from "../../../src/cli/output/models-formatters.js";
import type {
  CachedModelInfo,
  CacheStatus,
  AggregatedCacheStatus,
  ModelValidationResult,
  ModelPathInfo,
  CacheClearResult,
  ModelImportResult,
} from "../../../src/services/model-cache-types.js";

// ============================================================================
// formatBytes Tests
// ============================================================================

describe("formatBytes", () => {
  it("should format 0 bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("should format bytes", () => {
    expect(formatBytes(500)).toBe("500.0 B");
  });

  it("should format kilobytes", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
  });

  it("should format megabytes", () => {
    expect(formatBytes(1048576)).toBe("1.0 MB");
    expect(formatBytes(1572864)).toBe("1.5 MB");
  });

  it("should format gigabytes", () => {
    expect(formatBytes(1073741824)).toBe("1.0 GB");
  });

  it("should format terabytes", () => {
    expect(formatBytes(1099511627776)).toBe("1.0 TB");
  });
});

// ============================================================================
// Models List Formatting Tests
// ============================================================================

describe("createModelsListTable", () => {
  it("should show message when no models cached", () => {
    const result = createModelsListTable([]);

    expect(result).toContain("No cached models");
    expect(result).toContain("providers setup");
  });

  it("should format single model correctly", () => {
    const models: CachedModelInfo[] = [
      {
        provider: "transformersjs",
        modelId: "Xenova/all-MiniLM-L6-v2",
        path: "/cache/model",
        sizeBytes: 45000000,
        downloadedAt: new Date(),
        isValid: true,
      },
    ];

    const result = createModelsListTable(models);

    expect(result).toContain("Xenova/all-MiniLM-L6-v2");
    // Provider name may be truncated in table, check for partial match
    expect(result).toContain("Transformers");
    expect(result).toContain("Valid");
  });

  it("should show invalid status for invalid models", () => {
    const models: CachedModelInfo[] = [
      {
        provider: "transformersjs",
        modelId: "test/model",
        path: "/cache/model",
        sizeBytes: 1000,
        downloadedAt: new Date(),
        isValid: false,
      },
    ];

    const result = createModelsListTable(models);

    expect(result).toContain("Invalid");
  });

  it("should include total size summary", () => {
    const models: CachedModelInfo[] = [
      {
        provider: "transformersjs",
        modelId: "model1",
        path: "/cache/model1",
        sizeBytes: 1048576,
        downloadedAt: new Date(),
        isValid: true,
      },
      {
        provider: "ollama",
        modelId: "model2",
        path: "/cache/model2",
        sizeBytes: 2097152,
        downloadedAt: new Date(),
        isValid: true,
      },
    ];

    const result = createModelsListTable(models);

    expect(result).toContain("2 model");
  });
});

describe("formatModelsJson", () => {
  it("should return valid JSON for empty array", () => {
    const result = formatModelsJson([]);
    const parsed = JSON.parse(result);

    expect(parsed.models).toBeArray();
    expect(parsed.models.length).toBe(0);
    expect(parsed.summary.totalModels).toBe(0);
  });

  it("should include all model properties", () => {
    const models: CachedModelInfo[] = [
      {
        provider: "transformersjs",
        modelId: "test/model",
        path: "/cache/model",
        sizeBytes: 1000,
        downloadedAt: new Date("2024-01-01"),
        lastAccessedAt: new Date("2024-01-02"),
        isValid: true,
        metadata: { version: "1.0" },
      },
    ];

    const result = formatModelsJson(models);
    const parsed = JSON.parse(result);

    expect(parsed.models[0].modelId).toBe("test/model");
    expect(parsed.models[0].provider).toBe("transformersjs");
    expect(parsed.models[0].sizeBytes).toBe(1000);
    expect(parsed.models[0].isValid).toBe(true);
  });

  it("should include summary with totals", () => {
    const models: CachedModelInfo[] = [
      {
        provider: "transformersjs",
        modelId: "model1",
        path: "/p1",
        sizeBytes: 1000,
        downloadedAt: new Date(),
        isValid: true,
      },
      {
        provider: "ollama",
        modelId: "model2",
        path: "/p2",
        sizeBytes: 2000,
        downloadedAt: new Date(),
        isValid: true,
      },
    ];

    const result = formatModelsJson(models);
    const parsed = JSON.parse(result);

    expect(parsed.summary.totalModels).toBe(2);
    expect(parsed.summary.totalSizeBytes).toBe(3000);
  });
});

// ============================================================================
// Cache Status Formatting Tests
// ============================================================================

describe("createCacheStatusTable", () => {
  it("should format single provider status", () => {
    const status: CacheStatus = {
      provider: "transformersjs",
      cacheDir: "/home/.cache/huggingface",
      exists: true,
      totalSizeBytes: 50000000,
      modelCount: 2,
      models: [],
    };

    const result = createCacheStatusTable(status);

    // Provider name may be truncated in table
    expect(result).toContain("Transformers");
    expect(result).toContain("/home/.cache/huggingface");
    expect(result).toContain("2");
  });

  it("should show empty status indicator", () => {
    const status: CacheStatus = {
      provider: "transformersjs",
      cacheDir: "/cache",
      exists: false,
      totalSizeBytes: 0,
      modelCount: 0,
      models: [],
    };

    const result = createCacheStatusTable(status);

    expect(result).toContain("Empty");
  });

  it("should format aggregated status", () => {
    const status: AggregatedCacheStatus = {
      totalSizeBytes: 100000000,
      totalModelCount: 5,
      providers: [
        {
          provider: "transformersjs",
          cacheDir: "/cache/tf",
          exists: true,
          totalSizeBytes: 60000000,
          modelCount: 3,
          models: [],
        },
        {
          provider: "ollama",
          cacheDir: "/cache/ollama",
          exists: true,
          totalSizeBytes: 40000000,
          modelCount: 2,
          models: [],
        },
      ],
    };

    const result = createCacheStatusTable(status);

    // Provider name may be truncated in table
    expect(result).toContain("Transformers");
    expect(result).toContain("Ollama");
    expect(result).toContain("5 model");
  });
});

describe("formatCacheStatusJson", () => {
  it("should return valid JSON for single provider", () => {
    const status: CacheStatus = {
      provider: "transformersjs",
      cacheDir: "/cache",
      exists: true,
      totalSizeBytes: 1000,
      modelCount: 1,
      models: [],
    };

    const result = formatCacheStatusJson(status);
    const parsed = JSON.parse(result);

    expect(parsed.provider).toBe("transformersjs");
    expect(parsed.totalSizeBytes).toBe(1000);
  });

  it("should return valid JSON for aggregated status", () => {
    const status: AggregatedCacheStatus = {
      totalSizeBytes: 3000,
      totalModelCount: 2,
      providers: [
        {
          provider: "transformersjs",
          cacheDir: "/cache/tf",
          exists: true,
          totalSizeBytes: 2000,
          modelCount: 1,
          models: [],
        },
      ],
    };

    const result = formatCacheStatusJson(status);
    const parsed = JSON.parse(result);

    expect(parsed.totalSizeBytes).toBe(3000);
    expect(parsed.providers).toBeArray();
  });
});

// ============================================================================
// Validation Result Formatting Tests
// ============================================================================

describe("createValidationResultTable", () => {
  it("should show message when no models to validate", () => {
    const result = createValidationResultTable([]);

    expect(result).toContain("No models to validate");
  });

  it("should show valid status", () => {
    const results: ModelValidationResult[] = [
      {
        modelId: "test/model",
        provider: "transformersjs",
        valid: true,
        validatedAt: new Date(),
      },
    ];

    const result = createValidationResultTable(results);

    expect(result).toContain("test/model");
    expect(result).toContain("Valid");
  });

  it("should show invalid status with issues", () => {
    const results: ModelValidationResult[] = [
      {
        modelId: "test/model",
        provider: "transformersjs",
        valid: false,
        issues: ["Missing onnx file", "Checksum mismatch"],
        validatedAt: new Date(),
      },
    ];

    const result = createValidationResultTable(results);

    expect(result).toContain("Invalid");
    expect(result).toContain("Missing onnx");
  });

  it("should include summary counts", () => {
    const results: ModelValidationResult[] = [
      {
        modelId: "model1",
        provider: "transformersjs",
        valid: true,
        validatedAt: new Date(),
      },
      {
        modelId: "model2",
        provider: "transformersjs",
        valid: false,
        validatedAt: new Date(),
      },
    ];

    const result = createValidationResultTable(results);

    expect(result).toContain("1 valid");
    expect(result).toContain("1 invalid");
  });
});

describe("formatValidationJson", () => {
  it("should return valid JSON with summary", () => {
    const results: ModelValidationResult[] = [
      {
        modelId: "model1",
        provider: "transformersjs",
        valid: true,
        validatedAt: new Date(),
      },
      {
        modelId: "model2",
        provider: "ollama",
        valid: false,
        issues: ["Not found"],
        validatedAt: new Date(),
      },
    ];

    const result = formatValidationJson(results);
    const parsed = JSON.parse(result);

    expect(parsed.summary.total).toBe(2);
    expect(parsed.summary.valid).toBe(1);
    expect(parsed.summary.invalid).toBe(1);
  });
});

// ============================================================================
// Model Path Formatting Tests
// ============================================================================

describe("createModelPathTable", () => {
  it("should display path information", () => {
    const pathInfo: ModelPathInfo = {
      provider: "transformersjs",
      modelId: "Xenova/all-MiniLM-L6-v2",
      cacheDir: "/home/.cache/huggingface/transformers",
      modelPath: "/home/.cache/huggingface/transformers/models--Xenova--all-MiniLM-L6-v2",
      expectedStructure: ["onnx/", "tokenizer.json"],
      requiredFiles: ["onnx/model.onnx"],
    };

    const result = createModelPathTable(pathInfo);

    expect(result).toContain("Xenova/all-MiniLM-L6-v2");
    expect(result).toContain("Transformers.js");
    expect(result).toContain("models--Xenova--all-MiniLM-L6-v2");
  });

  it("should include expected structure", () => {
    const pathInfo: ModelPathInfo = {
      provider: "transformersjs",
      modelId: "test/model",
      cacheDir: "/cache",
      modelPath: "/cache/models--test--model",
      expectedStructure: ["onnx/", "config.json"],
      requiredFiles: ["onnx/model.onnx"],
    };

    const result = createModelPathTable(pathInfo);

    expect(result).toContain("Expected Structure");
    expect(result).toContain("onnx/");
  });

  it("should show Ollama-specific instructions", () => {
    const pathInfo: ModelPathInfo = {
      provider: "ollama",
      modelId: "nomic-embed-text",
      cacheDir: "(managed by Ollama server)",
      modelPath: "(managed by Ollama server)",
      expectedStructure: [],
      requiredFiles: [],
    };

    const result = createModelPathTable(pathInfo);

    expect(result).toContain("ollama create");
  });
});

// ============================================================================
// Clear Result Formatting Tests
// ============================================================================

describe("formatClearResult", () => {
  it("should format dry run result", () => {
    const result: CacheClearResult = {
      success: true,
      modelsCleared: 3,
      bytesFreed: 150000000,
      clearedModels: ["model1", "model2", "model3"],
      dryRun: true,
    };

    const output = formatClearResult(result);

    expect(output).toContain("Dry run");
    expect(output).toContain("3");
  });

  it("should show nothing cleared message", () => {
    const result: CacheClearResult = {
      success: true,
      modelsCleared: 0,
      bytesFreed: 0,
      clearedModels: [],
      dryRun: false,
    };

    const output = formatClearResult(result);

    expect(output).toContain("No models were cleared");
  });

  it("should format successful clear", () => {
    const result: CacheClearResult = {
      success: true,
      modelsCleared: 2,
      bytesFreed: 50000000,
      clearedModels: ["model1", "model2"],
      dryRun: false,
    };

    const output = formatClearResult(result);

    expect(output).toContain("Cleared 2 model");
    expect(output).toContain("Space freed");
  });
});

// ============================================================================
// Import Result Formatting Tests
// ============================================================================

describe("formatImportResult", () => {
  it("should format failed import", () => {
    const result: ModelImportResult = {
      success: false,
      error: "Source directory not found",
    };

    const output = formatImportResult(result);

    expect(output).toContain("failed");
    expect(output).toContain("Source directory not found");
  });

  it("should format successful import", () => {
    const result: ModelImportResult = {
      success: true,
      model: {
        provider: "transformersjs",
        modelId: "test/model",
        path: "/cache/model",
        sizeBytes: 45000000,
        downloadedAt: new Date(),
        isValid: true,
      },
      filesCopied: 15,
      bytesCopied: 45000000,
    };

    const output = formatImportResult(result);

    expect(output).toContain("successfully");
    expect(output).toContain("test/model");
    expect(output).toContain("15");
  });
});
