/**
 * Shared fixtures for embedding provider benchmarks
 *
 * Provides common test data, utility functions, and types for
 * quality, performance, and memory benchmarking tests.
 */

/**
 * Memory metrics from process.memoryUsage()
 */
export interface MemoryMetrics {
  /** Resident Set Size - total memory allocated for the process */
  rss: number;
  /** Total size of the V8 heap */
  heapTotal: number;
  /** Actual memory used by the V8 heap */
  heapUsed: number;
  /** Memory used by C++ objects bound to JavaScript */
  external: number;
  /** ArrayBuffers and SharedArrayBuffers */
  arrayBuffers: number;
}

/**
 * Performance benchmark result for a single operation
 */
export interface LatencyResult {
  /** Operation name */
  operation: string;
  /** Latency in milliseconds */
  latencyMs: number;
  /** Whether the operation succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

/**
 * Aggregated benchmark statistics
 */
export interface BenchmarkStats {
  /** Number of samples */
  count: number;
  /** Mean latency in ms */
  mean: number;
  /** Median latency in ms (p50) */
  median: number;
  /** 95th percentile latency in ms */
  p95: number;
  /** 99th percentile latency in ms */
  p99: number;
  /** Minimum latency in ms */
  min: number;
  /** Maximum latency in ms */
  max: number;
  /** Standard deviation in ms */
  stdDev: number;
}

/**
 * Quality test case with similar and dissimilar pairs
 */
export interface QualityTestCase {
  /** ID for the test case */
  id: string;
  /** Category of the test (semantic, code, technical, etc.) */
  category: string;
  /** Pair of semantically similar texts */
  similar: [string, string];
  /** Semantically dissimilar text */
  dissimilar: string;
  /** Expected minimum similarity for the similar pair */
  expectedMinSimilarity?: number;
}

/**
 * Sample texts for benchmark testing by length
 */
export const BENCHMARK_TEXTS = {
  /** Very short texts (1-5 words) */
  tiny: [
    "Hello world",
    "Quick test",
    "TypeScript code",
    "Database query",
    "API endpoint",
  ],

  /** Short texts (10-20 words) */
  short: [
    "The quick brown fox jumps over the lazy dog near the river bank.",
    "Machine learning models are trained on large datasets to make predictions.",
    "TypeScript is a typed superset of JavaScript that compiles to plain JavaScript.",
    "Docker containers provide isolated environments for running applications.",
    "React components can be composed together to build complex user interfaces.",
  ],

  /** Medium texts (50-100 words) */
  medium: [
    "Software architecture is the high-level structure of a software system, defining how components interact and communicate. Good architecture enables scalability, maintainability, and flexibility. Common patterns include microservices, event-driven architecture, and layered architecture. The choice of architecture depends on project requirements, team expertise, and long-term goals. Well-designed architecture separates concerns, minimizes coupling, and maximizes cohesion.",
    "Database indexing is a technique to speed up data retrieval operations. Indexes work like a book's index, allowing the database to find rows without scanning the entire table. Common index types include B-tree indexes for range queries, hash indexes for equality comparisons, and full-text indexes for text search. Proper indexing strategy is crucial for application performance.",
    "Test-driven development (TDD) is a software development approach where tests are written before the implementation code. The cycle consists of writing a failing test, implementing code to pass the test, and refactoring. TDD helps ensure code correctness, improves design, and provides documentation. It encourages small, incremental changes and continuous integration.",
  ],

  /** Long texts (200+ words) */
  long: [
    `The Model Context Protocol (MCP) is an open protocol that enables seamless integration between
    AI assistants and various data sources or tools. It provides a standardized way for AI systems
    to access external resources, execute tools, and retrieve contextual information. MCP uses a
    client-server architecture where the AI assistant acts as a client, connecting to MCP servers
    that provide specific capabilities.

    Key features of MCP include: (1) Resource access - servers can expose files, databases, APIs,
    and other data sources; (2) Tool execution - servers can provide executable tools that the AI
    can invoke; (3) Prompts - servers can offer pre-defined prompts for common tasks; (4) Sampling -
    servers can request AI completions through the client.

    MCP supports multiple transport mechanisms including stdio for local processes, HTTP with
    Server-Sent Events for web-based servers, and WebSocket for real-time bidirectional communication.
    The protocol is designed to be secure, with support for authentication and authorization mechanisms.`,
  ],

  /** Code snippets for testing code embedding quality */
  code: [
    `function fibonacci(n: number): number {
      if (n <= 1) return n;
      return fibonacci(n - 1) + fibonacci(n - 2);
    }`,
    `async function fetchData(url: string): Promise<Response> {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(\`HTTP error: \${response.status}\`);
      }
      return response;
    }`,
    `class Repository<T> {
      private items: Map<string, T> = new Map();

      add(id: string, item: T): void {
        this.items.set(id, item);
      }

      get(id: string): T | undefined {
        return this.items.get(id);
      }
    }`,
    `const memoize = <T extends (...args: unknown[]) => unknown>(fn: T): T => {
      const cache = new Map<string, ReturnType<T>>();
      return ((...args: Parameters<T>): ReturnType<T> => {
        const key = JSON.stringify(args);
        if (cache.has(key)) return cache.get(key)!;
        const result = fn(...args) as ReturnType<T>;
        cache.set(key, result);
        return result;
      }) as T;
    };`,
  ],

  /** Technical documentation snippets */
  documentation: [
    "The EmbeddingProvider interface defines the contract for all embedding implementations. It requires three read-only properties: providerId (string identifier), modelId (model name), and dimensions (vector size). Implementations must provide generateEmbedding, generateEmbeddings, healthCheck, and getCapabilities methods.",
    "ChromaDB is a vector database optimized for storing and querying embedding vectors. It supports CRUD operations on collections, similarity search using cosine distance, and metadata filtering. Collections can be persisted to disk or kept in memory for testing purposes.",
    "The ingestion pipeline processes files from repositories through multiple stages: cloning, scanning, chunking, embedding, and storage. Each stage can be configured independently, allowing for customization based on repository size and content type.",
  ],
};

/**
 * Quality test cases for comparing embedding semantic accuracy
 *
 * Each test case contains semantically similar texts that should have
 * high cosine similarity, and a dissimilar text for contrast.
 */
export const QUALITY_TEST_CASES: QualityTestCase[] = [
  // Semantic similarity - general concepts
  {
    id: "semantic-royalty",
    category: "semantic",
    similar: ["king", "queen"],
    dissimilar: "banana",
    expectedMinSimilarity: 0.5,
  },
  {
    id: "semantic-animals",
    category: "semantic",
    similar: ["dog", "puppy"],
    dissimilar: "computer",
    expectedMinSimilarity: 0.6,
  },
  {
    id: "semantic-transport",
    category: "semantic",
    similar: ["car", "automobile"],
    dissimilar: "music",
    expectedMinSimilarity: 0.7,
  },
  {
    id: "semantic-weather",
    category: "semantic",
    similar: ["sunny", "bright weather"],
    dissimilar: "database",
    expectedMinSimilarity: 0.4,
  },

  // Programming concepts
  {
    id: "code-languages",
    category: "code",
    similar: ["JavaScript", "TypeScript"],
    dissimilar: "cooking recipe",
    expectedMinSimilarity: 0.5,
  },
  {
    id: "code-paradigms",
    category: "code",
    similar: ["object-oriented programming", "OOP with classes"],
    dissimilar: "mountain hiking",
    expectedMinSimilarity: 0.5,
  },
  {
    id: "code-tools",
    category: "code",
    similar: ["git version control", "source code management"],
    dissimilar: "baking bread",
    expectedMinSimilarity: 0.4,
  },
  {
    id: "code-testing",
    category: "code",
    similar: ["unit test", "automated testing"],
    dissimilar: "ocean waves",
    expectedMinSimilarity: 0.4,
  },

  // Technical documentation
  {
    id: "tech-api",
    category: "technical",
    similar: ["REST API endpoint", "HTTP web service interface"],
    dissimilar: "flower garden",
    expectedMinSimilarity: 0.4,
  },
  {
    id: "tech-database",
    category: "technical",
    similar: ["SQL database query", "relational database SELECT statement"],
    dissimilar: "poetry writing",
    expectedMinSimilarity: 0.5,
  },
  {
    id: "tech-container",
    category: "technical",
    similar: ["Docker container", "containerized application"],
    dissimilar: "piano music",
    expectedMinSimilarity: 0.5,
  },

  // Sentence-level similarity
  {
    id: "sentence-cat",
    category: "sentence",
    similar: ["The cat sat on the mat.", "A feline rested on the rug."],
    dissimilar: "The stock market crashed yesterday.",
    expectedMinSimilarity: 0.4,
  },
  {
    id: "sentence-weather",
    category: "sentence",
    similar: ["It is raining outside today.", "The weather is wet and rainy."],
    dissimilar: "The algorithm has O(n log n) complexity.",
    expectedMinSimilarity: 0.5,
  },
  {
    id: "sentence-code",
    category: "sentence",
    similar: [
      "This function calculates the factorial of a number.",
      "The method computes n factorial recursively.",
    ],
    dissimilar: "The pizza was delicious with extra cheese.",
    expectedMinSimilarity: 0.4,
  },
];

/**
 * Calculate cosine similarity between two vectors
 *
 * @param a - First embedding vector
 * @param b - Second embedding vector
 * @returns Cosine similarity value between -1 and 1
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimensions must match: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dotProduct += ai * bi;
    magnitudeA += ai * ai;
    magnitudeB += bi * bi;
  }

  magnitudeA = Math.sqrt(magnitudeA);
  magnitudeB = Math.sqrt(magnitudeB);

  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0;
  }

  return dotProduct / (magnitudeA * magnitudeB);
}

/**
 * Calculate Euclidean distance between two vectors
 *
 * @param a - First embedding vector
 * @param b - Second embedding vector
 * @returns Euclidean distance (lower is more similar)
 */
export function euclideanDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimensions must match: ${a.length} vs ${b.length}`);
  }

  let sumSquares = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i]! - b[i]!;
    sumSquares += diff * diff;
  }

  return Math.sqrt(sumSquares);
}

/**
 * Get current memory usage metrics
 *
 * @returns Memory metrics in bytes
 */
export function measureMemory(): MemoryMetrics {
  const usage = process.memoryUsage();
  return {
    rss: usage.rss,
    heapTotal: usage.heapTotal,
    heapUsed: usage.heapUsed,
    external: usage.external,
    arrayBuffers: usage.arrayBuffers,
  };
}

/**
 * Format memory metrics for display
 *
 * @param metrics - Memory metrics to format
 * @returns Human-readable memory string
 */
export function formatMemory(metrics: MemoryMetrics): string {
  const formatBytes = (bytes: number): string => {
    const mb = bytes / 1024 / 1024;
    return `${mb.toFixed(2)} MB`;
  };

  return [
    `RSS: ${formatBytes(metrics.rss)}`,
    `Heap Total: ${formatBytes(metrics.heapTotal)}`,
    `Heap Used: ${formatBytes(metrics.heapUsed)}`,
    `External: ${formatBytes(metrics.external)}`,
    `ArrayBuffers: ${formatBytes(metrics.arrayBuffers)}`,
  ].join(", ");
}

/**
 * Calculate benchmark statistics from an array of latency values
 *
 * @param latencies - Array of latency values in milliseconds
 * @returns Aggregated statistics
 */
export function calculateStats(latencies: number[]): BenchmarkStats {
  if (latencies.length === 0) {
    return {
      count: 0,
      mean: 0,
      median: 0,
      p95: 0,
      p99: 0,
      min: 0,
      max: 0,
      stdDev: 0,
    };
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  const count = sorted.length;

  // Mean
  const sum = sorted.reduce((acc, val) => acc + val, 0);
  const mean = sum / count;

  // Median (p50)
  const medianIndex = Math.floor(count / 2);
  const median =
    count % 2 === 0
      ? (sorted[medianIndex - 1]! + sorted[medianIndex]!) / 2
      : sorted[medianIndex]!;

  // Percentiles
  const percentile = (p: number): number => {
    const index = Math.ceil((p / 100) * count) - 1;
    return sorted[Math.max(0, Math.min(index, count - 1))]!;
  };

  const p95 = percentile(95);
  const p99 = percentile(99);

  // Min/Max
  const min = sorted[0]!;
  const max = sorted[count - 1]!;

  // Standard deviation
  const squaredDiffs = sorted.map((val) => Math.pow(val - mean, 2));
  const avgSquaredDiff = squaredDiffs.reduce((acc, val) => acc + val, 0) / count;
  const stdDev = Math.sqrt(avgSquaredDiff);

  return { count, mean, median, p95, p99, min, max, stdDev };
}

/**
 * Format benchmark statistics for display
 *
 * @param stats - Statistics to format
 * @param label - Label for the statistics
 * @returns Formatted string
 */
export function formatStats(stats: BenchmarkStats, label: string): string {
  return [
    `${label} (n=${stats.count}):`,
    `  Mean: ${stats.mean.toFixed(2)}ms`,
    `  Median: ${stats.median.toFixed(2)}ms`,
    `  P95: ${stats.p95.toFixed(2)}ms`,
    `  P99: ${stats.p99.toFixed(2)}ms`,
    `  Min: ${stats.min.toFixed(2)}ms`,
    `  Max: ${stats.max.toFixed(2)}ms`,
    `  StdDev: ${stats.stdDev.toFixed(2)}ms`,
  ].join("\n");
}

/**
 * Sleep for a specified number of milliseconds
 *
 * @param ms - Milliseconds to sleep
 * @returns Promise that resolves after the delay
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run garbage collection if available (requires --expose-gc flag)
 *
 * @returns True if GC was triggered, false otherwise
 */
export function tryGC(): boolean {
  if (typeof global.gc === "function") {
    global.gc();
    return true;
  }
  return false;
}

/**
 * Measure the execution time of an async function
 *
 * @param fn - Async function to measure
 * @returns Result and elapsed time in milliseconds
 */
export async function measureTime<T>(
  fn: () => Promise<T>
): Promise<{ result: T; elapsedMs: number }> {
  const start = performance.now();
  const result = await fn();
  const elapsedMs = performance.now() - start;
  return { result, elapsedMs };
}

/**
 * Run a function multiple times and collect timing statistics
 *
 * @param fn - Async function to benchmark
 * @param iterations - Number of iterations to run
 * @param warmupIterations - Number of warmup iterations (not counted)
 * @returns Array of latency measurements
 */
export async function benchmarkFunction(
  fn: () => Promise<void>,
  iterations: number = 10,
  warmupIterations: number = 2
): Promise<number[]> {
  // Warmup
  for (let i = 0; i < warmupIterations; i++) {
    await fn();
  }

  // Actual measurements
  const latencies: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const { elapsedMs } = await measureTime(fn);
    latencies.push(elapsedMs);
  }

  return latencies;
}
