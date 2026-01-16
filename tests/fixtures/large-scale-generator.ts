/**
 * Large-Scale Test Data Generator for Performance Testing
 *
 * Generates synthetic repository data at scale (10K+ files) with realistic
 * code patterns, dependencies, and import relationships for validating
 * graph performance against PRD targets.
 *
 * @module tests/fixtures/large-scale-generator
 */

import * as fs from "fs";
import * as path from "path";
import type { FileInput } from "../../src/graph/ingestion/types.js";

/**
 * Configuration for large-scale test data generation
 */
export interface LargeScaleGeneratorConfig {
  /** Number of files to generate */
  fileCount: number;

  /** Average number of imports per file */
  avgImportsPerFile: number;

  /** Percentage of files that are utility/shared (0-1) */
  utilityFileRatio: number;

  /** Maximum depth of directory nesting */
  maxDirectoryDepth: number;

  /** Distribution of file sizes */
  fileSizeDistribution: {
    /** Small utility files (10-50 lines) */
    small: number;
    /** Medium files (50-200 lines) */
    medium: number;
    /** Large modules (200-500 lines) */
    large: number;
  };

  /** External npm modules to reference */
  externalModules: string[];

  /** Seed for deterministic generation */
  seed?: number;
}

/**
 * Generated file with content and metadata
 */
export interface GeneratedFile {
  /** File path relative to repository root */
  path: string;

  /** File content */
  content: string;

  /** Imports this file references */
  imports: string[];

  /** Exports this file provides */
  exports: string[];

  /** Number of functions defined */
  functionCount: number;

  /** Number of classes defined */
  classCount: number;
}

/**
 * Result of large-scale repository generation
 */
export interface GeneratedRepository {
  /** Repository name */
  name: string;

  /** Generated files */
  files: GeneratedFile[];

  /** Statistics about the generated repository */
  stats: {
    totalFiles: number;
    totalFunctions: number;
    totalClasses: number;
    totalImports: number;
    totalExports: number;
    avgImportsPerFile: number;
    maxImportsPerFile: number;
    directoryCount: number;
  };
}

/**
 * Default configuration for realistic TypeScript repository
 */
export const DEFAULT_GENERATOR_CONFIG: LargeScaleGeneratorConfig = {
  fileCount: 1000,
  avgImportsPerFile: 5,
  utilityFileRatio: 0.15,
  maxDirectoryDepth: 4,
  fileSizeDistribution: {
    small: 0.4,
    medium: 0.45,
    large: 0.15,
  },
  externalModules: [
    "lodash",
    "express",
    "react",
    "axios",
    "uuid",
    "zod",
    "pino",
    "crypto",
    "path",
    "fs",
  ],
  seed: 42,
};

/**
 * Simple seeded random number generator for deterministic output
 */
class SeededRandom {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  /** Get next random number between 0 and 1 */
  next(): number {
    const x = Math.sin(this.seed++) * 10000;
    return x - Math.floor(x);
  }

  /** Get random integer between min (inclusive) and max (exclusive) */
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min)) + min;
  }

  /** Choose random item from array */
  choose<T>(arr: T[]): T {
    return arr[this.nextInt(0, arr.length)]!;
  }

  /** Shuffle array in place */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i + 1);
      [arr[i], arr[j]] = [arr[j]!, arr[i]!];
    }
    return arr;
  }
}

/**
 * Directory names for realistic project structure
 */
const DIRECTORY_NAMES = [
  "components",
  "services",
  "utils",
  "helpers",
  "models",
  "types",
  "config",
  "middleware",
  "handlers",
  "controllers",
  "repositories",
  "providers",
  "hooks",
  "context",
  "store",
  "api",
  "lib",
  "core",
  "features",
  "modules",
];

/**
 * Function name patterns for realistic code
 */
const FUNCTION_PATTERNS = [
  "get",
  "set",
  "create",
  "update",
  "delete",
  "find",
  "fetch",
  "process",
  "handle",
  "validate",
  "transform",
  "parse",
  "format",
  "calculate",
  "generate",
  "build",
  "init",
  "setup",
  "configure",
  "load",
];

/**
 * Entity names for functions and classes
 */
const ENTITY_NAMES = [
  "User",
  "Item",
  "Order",
  "Product",
  "Customer",
  "Account",
  "Transaction",
  "Payment",
  "Session",
  "Config",
  "Settings",
  "Data",
  "Result",
  "Response",
  "Request",
  "Event",
  "Message",
  "Notification",
  "Log",
  "Metric",
];

/**
 * Type names for interfaces and type aliases
 */
const TYPE_NAMES = [
  "Props",
  "Options",
  "Params",
  "State",
  "Context",
  "Config",
  "Result",
  "Input",
  "Output",
  "Payload",
];

/**
 * Large-scale test data generator
 */
export class LargeScaleGenerator {
  private config: LargeScaleGeneratorConfig;
  private random: SeededRandom;
  private generatedPaths: Set<string> = new Set();
  private directories: string[] = [];

  constructor(config: Partial<LargeScaleGeneratorConfig> = {}) {
    this.config = { ...DEFAULT_GENERATOR_CONFIG, ...config };
    this.random = new SeededRandom(this.config.seed ?? 42);
  }

  /**
   * Generate a large-scale repository with realistic structure
   */
  generateLargeRepository(name: string = "scale-test-repo"): GeneratedRepository {
    this.generatedPaths.clear();
    this.directories = [];

    // Generate directory structure first
    this.generateDirectoryStructure();

    // Calculate file counts by type
    const smallCount = Math.floor(this.config.fileCount * this.config.fileSizeDistribution.small);
    const mediumCount = Math.floor(this.config.fileCount * this.config.fileSizeDistribution.medium);
    const largeCount = this.config.fileCount - smallCount - mediumCount;

    // Generate files
    const files: GeneratedFile[] = [];

    // Generate utility files first (these will be imported by others)
    const utilityCount = Math.floor(this.config.fileCount * this.config.utilityFileRatio);
    for (let i = 0; i < utilityCount; i++) {
      files.push(this.generateUtilityFile(i));
    }

    // Generate small files
    for (let i = 0; i < smallCount - utilityCount; i++) {
      files.push(this.generateSmallFile(i, files));
    }

    // Generate medium files
    for (let i = 0; i < mediumCount; i++) {
      files.push(this.generateMediumFile(i, files));
    }

    // Generate large files
    for (let i = 0; i < largeCount; i++) {
      files.push(this.generateLargeFile(i, files));
    }

    // Calculate statistics
    const stats = this.calculateStats(files);

    return { name, files, stats };
  }

  /**
   * Generate directory structure
   */
  private generateDirectoryStructure(): void {
    // Always have src as root
    this.directories.push("src");

    // Generate subdirectories
    const dirCount = Math.min(
      Math.floor(this.config.fileCount / 20),
      DIRECTORY_NAMES.length * this.config.maxDirectoryDepth
    );

    for (let i = 0; i < dirCount; i++) {
      const depth = this.random.nextInt(1, this.config.maxDirectoryDepth + 1);
      let dirPath = "src";

      for (let d = 0; d < depth; d++) {
        const dirName = this.random.choose(DIRECTORY_NAMES);
        dirPath = `${dirPath}/${dirName}`;
        if (!this.directories.includes(dirPath)) {
          this.directories.push(dirPath);
        }
      }
    }
  }

  /**
   * Generate a unique file path
   */
  private generateFilePath(prefix: string, extension: string = "ts"): string {
    let attempts = 0;
    let filePath: string;

    do {
      const dir = this.random.choose(this.directories);
      const fileName = `${prefix}${this.random.nextInt(0, 10000)}.${extension}`;
      filePath = `${dir}/${fileName}`;
      attempts++;
    } while (this.generatedPaths.has(filePath) && attempts < 100);

    // Handle collision by adding timestamp suffix to ensure uniqueness
    if (attempts >= 100 && this.generatedPaths.has(filePath)) {
      const timestamp = Date.now();
      const dir = this.random.choose(this.directories);
      filePath = `${dir}/${prefix}${timestamp}.${extension}`;
    }

    this.generatedPaths.add(filePath);
    return filePath;
  }

  /**
   * Generate a utility/shared file (heavily imported)
   */
  private generateUtilityFile(_index: number): GeneratedFile {
    const filePath = this.generateFilePath("utils");
    const exports: string[] = [];
    const functions: string[] = [];

    // Generate 3-8 utility functions
    const funcCount = this.random.nextInt(3, 9);
    for (let i = 0; i < funcCount; i++) {
      const funcName = `${this.random.choose(FUNCTION_PATTERNS)}${this.random.choose(ENTITY_NAMES)}`;
      if (!exports.includes(funcName)) {
        exports.push(funcName);
        functions.push(this.generateFunctionCode(funcName, "utility"));
      }
    }

    // Generate 1-3 types
    const typeCount = this.random.nextInt(1, 4);
    const types: string[] = [];
    for (let i = 0; i < typeCount; i++) {
      const typeName = `${this.random.choose(ENTITY_NAMES)}${this.random.choose(TYPE_NAMES)}`;
      if (!exports.includes(typeName)) {
        exports.push(typeName);
        types.push(this.generateTypeCode(typeName));
      }
    }

    const content = this.assembleFileContent([], functions, types, [], exports);

    return {
      path: filePath,
      content,
      imports: [],
      exports,
      functionCount: functions.length,
      classCount: 0,
    };
  }

  /**
   * Generate a small file (10-50 lines)
   */
  private generateSmallFile(_index: number, existingFiles: GeneratedFile[]): GeneratedFile {
    const filePath = this.generateFilePath("small");
    const imports = this.generateImports(existingFiles, 1, 3);
    const exports: string[] = [];
    const functions: string[] = [];

    // 1-2 functions
    const funcCount = this.random.nextInt(1, 3);
    for (let i = 0; i < funcCount; i++) {
      const funcName = `${this.random.choose(FUNCTION_PATTERNS)}${this.random.choose(ENTITY_NAMES)}`;
      exports.push(funcName);
      functions.push(this.generateFunctionCode(funcName, "small"));
    }

    const content = this.assembleFileContent(imports, functions, [], [], exports);

    return {
      path: filePath,
      content,
      imports: imports.map((i) => i.module),
      exports,
      functionCount: functions.length,
      classCount: 0,
    };
  }

  /**
   * Generate a medium file (50-200 lines)
   */
  private generateMediumFile(_index: number, existingFiles: GeneratedFile[]): GeneratedFile {
    const filePath = this.generateFilePath("medium");
    const imports = this.generateImports(existingFiles, 3, 8);
    const exports: string[] = [];
    const functions: string[] = [];
    const types: string[] = [];

    // 3-8 functions
    const funcCount = this.random.nextInt(3, 9);
    for (let i = 0; i < funcCount; i++) {
      const funcName = `${this.random.choose(FUNCTION_PATTERNS)}${this.random.choose(ENTITY_NAMES)}`;
      exports.push(funcName);
      functions.push(this.generateFunctionCode(funcName, "medium"));
    }

    // 1-3 types
    const typeCount = this.random.nextInt(1, 4);
    for (let i = 0; i < typeCount; i++) {
      const typeName = `${this.random.choose(ENTITY_NAMES)}${this.random.choose(TYPE_NAMES)}`;
      exports.push(typeName);
      types.push(this.generateTypeCode(typeName));
    }

    const content = this.assembleFileContent(imports, functions, types, [], exports);

    return {
      path: filePath,
      content,
      imports: imports.map((i) => i.module),
      exports,
      functionCount: functions.length,
      classCount: 0,
    };
  }

  /**
   * Generate a large file (200-500 lines) with classes
   */
  private generateLargeFile(_index: number, existingFiles: GeneratedFile[]): GeneratedFile {
    const filePath = this.generateFilePath("service");
    const imports = this.generateImports(existingFiles, 5, 15);
    const exports: string[] = [];
    const functions: string[] = [];
    const types: string[] = [];
    const classes: string[] = [];

    // 1-2 classes
    const classCount = this.random.nextInt(1, 3);
    for (let i = 0; i < classCount; i++) {
      const className = `${this.random.choose(ENTITY_NAMES)}Service`;
      exports.push(className);
      classes.push(this.generateClassCode(className));
    }

    // 5-10 standalone functions
    const funcCount = this.random.nextInt(5, 11);
    for (let i = 0; i < funcCount; i++) {
      const funcName = `${this.random.choose(FUNCTION_PATTERNS)}${this.random.choose(ENTITY_NAMES)}`;
      exports.push(funcName);
      functions.push(this.generateFunctionCode(funcName, "large"));
    }

    // 2-5 types
    const typeCount = this.random.nextInt(2, 6);
    for (let i = 0; i < typeCount; i++) {
      const typeName = `${this.random.choose(ENTITY_NAMES)}${this.random.choose(TYPE_NAMES)}`;
      exports.push(typeName);
      types.push(this.generateTypeCode(typeName));
    }

    const content = this.assembleFileContent(imports, functions, types, classes, exports);

    return {
      path: filePath,
      content,
      imports: imports.map((i) => i.module),
      exports,
      functionCount: functions.length,
      classCount: classes.length,
    };
  }

  /**
   * Generate import statements
   */
  private generateImports(
    existingFiles: GeneratedFile[],
    minImports: number,
    maxImports: number
  ): Array<{ module: string; names: string[] }> {
    const imports: Array<{ module: string; names: string[] }> = [];
    const importCount = this.random.nextInt(minImports, maxImports + 1);

    // Import from existing files
    const localImportCount = Math.floor(importCount * 0.7);
    const externalImportCount = importCount - localImportCount;

    // Local imports
    if (existingFiles.length > 0) {
      const shuffled = this.random.shuffle([...existingFiles]);
      for (let i = 0; i < Math.min(localImportCount, shuffled.length); i++) {
        const file = shuffled[i]!;
        if (file.exports.length > 0) {
          const importNames = this.random.shuffle([...file.exports]).slice(
            0,
            this.random.nextInt(1, Math.min(4, file.exports.length + 1))
          );
          imports.push({
            module: this.toRelativeImport(file.path),
            names: importNames,
          });
        }
      }
    }

    // External imports
    for (let i = 0; i < externalImportCount; i++) {
      const module = this.random.choose(this.config.externalModules);
      if (!imports.some((imp) => imp.module === module)) {
        imports.push({
          module,
          names: [this.generateExternalImportName(module)],
        });
      }
    }

    return imports;
  }

  /**
   * Convert file path to relative import path
   */
  private toRelativeImport(filePath: string): string {
    return "./" + filePath.replace(/\.ts$/, ".js");
  }

  /**
   * Generate a realistic import name for an external module
   */
  private generateExternalImportName(module: string): string {
    const moduleNames: Record<string, string[]> = {
      lodash: ["map", "filter", "reduce", "find", "debounce"],
      express: ["Router", "Request", "Response", "NextFunction"],
      react: ["useState", "useEffect", "useCallback", "useMemo"],
      axios: ["AxiosResponse", "AxiosError", "AxiosRequestConfig"],
      uuid: ["v4 as uuidv4", "validate"],
      zod: ["z", "ZodSchema", "ZodError"],
      pino: ["Logger", "LoggerOptions"],
      crypto: ["createHash", "randomBytes"],
      path: ["join", "resolve", "dirname"],
      fs: ["readFile", "writeFile", "existsSync"],
    };

    return this.random.choose(moduleNames[module] ?? ["default"]);
  }

  /**
   * Generate function code
   */
  private generateFunctionCode(name: string, size: "utility" | "small" | "medium" | "large"): string {
    const isAsync = this.random.next() > 0.3;
    const paramCount = this.random.nextInt(0, 4);
    const params: string[] = [];

    for (let i = 0; i < paramCount; i++) {
      const paramName = ["input", "data", "options", "config", "params"][i] ?? `arg${i}`;
      const paramType = ["string", "number", "boolean", "Record<string, unknown>", "unknown"][
        this.random.nextInt(0, 5)
      ];
      params.push(`${paramName}: ${paramType}`);
    }

    const returnType = isAsync ? "Promise<void>" : "void";
    const asyncKeyword = isAsync ? "async " : "";

    // Generate body based on size
    const bodyLines = this.generateFunctionBody(size);

    return `/**
 * ${name} - Generated function for performance testing
 */
export ${asyncKeyword}function ${name}(${params.join(", ")}): ${returnType} {
${bodyLines}
}
`;
  }

  /**
   * Generate function body lines
   */
  private generateFunctionBody(size: "utility" | "small" | "medium" | "large"): string {
    const lineCount = {
      utility: this.random.nextInt(3, 10),
      small: this.random.nextInt(5, 15),
      medium: this.random.nextInt(15, 40),
      large: this.random.nextInt(30, 80),
    }[size];

    const lines: string[] = [];
    for (let i = 0; i < lineCount; i++) {
      lines.push(this.generateCodeLine(i));
    }

    return lines.join("\n");
  }

  /**
   * Generate a single code line
   */
  private generateCodeLine(index: number): string {
    const templates = [
      "  const result${i} = process(input);",
      "  const value${i} = data.get('key${i}');",
      "  if (condition${i}) { return; }",
      "  logger.debug({ step: ${i} }, 'Processing');",
      "  await delay(${i});",
      "  const config${i} = getConfig();",
      "  validateInput(param${i});",
      "  const transformed${i} = transform(raw${i});",
      "  cache.set('key${i}', value${i});",
      "  metrics.increment('counter${i}');",
    ];

    return this.random.choose(templates).replace(/\$\{i\}/g, String(index));
  }

  /**
   * Generate type/interface code
   */
  private generateTypeCode(name: string): string {
    const propCount = this.random.nextInt(2, 8);
    const props: string[] = [];

    for (let i = 0; i < propCount; i++) {
      const propName = ["id", "name", "value", "type", "status", "data", "config", "options"][i] ??
        `prop${i}`;
      const propType = ["string", "number", "boolean", "Date", "unknown"][
        this.random.nextInt(0, 5)
      ];
      const optional = this.random.next() > 0.7 ? "?" : "";
      props.push(`  ${propName}${optional}: ${propType};`);
    }

    return `/**
 * ${name} - Generated type for performance testing
 */
export interface ${name} {
${props.join("\n")}
}
`;
  }

  /**
   * Generate class code
   */
  private generateClassCode(name: string): string {
    const methodCount = this.random.nextInt(5, 12);
    const methods: string[] = [];

    // Constructor
    methods.push(`  constructor(private readonly config: Record<string, unknown>) {
    // Initialize service
  }`);

    // Methods
    for (let i = 0; i < methodCount; i++) {
      const methodName = `${this.random.choose(FUNCTION_PATTERNS)}${this.random.choose(ENTITY_NAMES)}`;
      const isAsync = this.random.next() > 0.4;
      const asyncKeyword = isAsync ? "async " : "";
      const returnType = isAsync ? "Promise<void>" : "void";

      methods.push(`
  /**
   * ${methodName} - Class method
   */
  ${asyncKeyword}${methodName}(): ${returnType} {
${this.generateFunctionBody("medium")}
  }`);
    }

    return `/**
 * ${name} - Generated class for performance testing
 */
export class ${name} {
${methods.join("\n")}
}
`;
  }

  /**
   * Assemble complete file content
   */
  private assembleFileContent(
    imports: Array<{ module: string; names: string[] }>,
    functions: string[],
    types: string[],
    classes: string[],
    _exports: string[]
  ): string {
    const lines: string[] = [];

    // File header
    lines.push("/**");
    lines.push(" * Auto-generated file for performance testing");
    lines.push(" * @generated");
    lines.push(" */");
    lines.push("");

    // Imports
    for (const imp of imports) {
      lines.push(`import { ${imp.names.join(", ")} } from "${imp.module}";`);
    }

    if (imports.length > 0) {
      lines.push("");
    }

    // Types
    for (const type of types) {
      lines.push(type);
    }

    // Classes
    for (const cls of classes) {
      lines.push(cls);
    }

    // Functions
    for (const func of functions) {
      lines.push(func);
    }

    return lines.join("\n");
  }

  /**
   * Calculate statistics for generated repository
   */
  private calculateStats(files: GeneratedFile[]): GeneratedRepository["stats"] {
    const totalFunctions = files.reduce((sum, f) => sum + f.functionCount, 0);
    const totalClasses = files.reduce((sum, f) => sum + f.classCount, 0);
    const totalImports = files.reduce((sum, f) => sum + f.imports.length, 0);
    const totalExports = files.reduce((sum, f) => sum + f.exports.length, 0);
    const maxImports = Math.max(...files.map((f) => f.imports.length));
    const directories = new Set(files.map((f) => path.dirname(f.path)));

    return {
      totalFiles: files.length,
      totalFunctions,
      totalClasses,
      totalImports,
      totalExports,
      avgImportsPerFile: totalImports / files.length,
      maxImportsPerFile: maxImports,
      directoryCount: directories.size,
    };
  }

  /**
   * Convert generated files to FileInput format for ingestion
   */
  static toFileInputs(repo: GeneratedRepository): FileInput[] {
    return repo.files.map((file) => ({
      path: file.path,
      content: file.content,
      hash: this.hashContent(file.content),
    }));
  }

  /**
   * Simple hash function for content
   */
  private static hashContent(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16).padStart(8, "0");
  }

  /**
   * Write generated repository to disk (for debugging/inspection)
   */
  static async writeTestRepository(basePath: string, repo: GeneratedRepository): Promise<void> {
    for (const file of repo.files) {
      const filePath = path.join(basePath, file.path);
      const dirPath = path.dirname(filePath);

      // Create directory
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }

      // Write file
      fs.writeFileSync(filePath, file.content, "utf-8");
    }
  }
}

/**
 * Pre-configured generators for common test scenarios
 */
export const SCALE_TEST_CONFIGS = {
  /** 1K files - baseline for fast CI tests */
  small: {
    fileCount: 1000,
    avgImportsPerFile: 4,
    utilityFileRatio: 0.15,
    maxDirectoryDepth: 3,
    fileSizeDistribution: { small: 0.5, medium: 0.4, large: 0.1 },
    externalModules: ["lodash", "express", "zod"],
    seed: 42,
  } satisfies LargeScaleGeneratorConfig,

  /** 5K files - medium scale test */
  medium: {
    fileCount: 5000,
    avgImportsPerFile: 5,
    utilityFileRatio: 0.12,
    maxDirectoryDepth: 4,
    fileSizeDistribution: { small: 0.45, medium: 0.4, large: 0.15 },
    externalModules: ["lodash", "express", "react", "axios", "zod", "pino"],
    seed: 42,
  } satisfies LargeScaleGeneratorConfig,

  /** 10K files - full scale performance target */
  large: {
    fileCount: 10000,
    avgImportsPerFile: 6,
    utilityFileRatio: 0.1,
    maxDirectoryDepth: 5,
    fileSizeDistribution: { small: 0.4, medium: 0.45, large: 0.15 },
    externalModules: DEFAULT_GENERATOR_CONFIG.externalModules,
    seed: 42,
  } satisfies LargeScaleGeneratorConfig,

  /** 15K files - stress test beyond PRD targets */
  xlarge: {
    fileCount: 15000,
    avgImportsPerFile: 7,
    utilityFileRatio: 0.08,
    maxDirectoryDepth: 6,
    fileSizeDistribution: { small: 0.35, medium: 0.45, large: 0.2 },
    externalModules: DEFAULT_GENERATOR_CONFIG.externalModules,
    seed: 42,
  } satisfies LargeScaleGeneratorConfig,
};

/**
 * Type alias for scale test configuration
 */
export type ScaleTestConfig = LargeScaleGeneratorConfig;
