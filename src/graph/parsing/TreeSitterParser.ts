/**
 * Tree-sitter based AST parser for multiple languages (TypeScript, JavaScript, Python, Java, Go).
 *
 * Parses source files and extracts code entities (functions, classes,
 * interfaces) and imports for knowledge graph population.
 *
 * @module graph/parsing/TreeSitterParser
 */

import type { Node } from "web-tree-sitter";
import type pino from "pino";
import path from "node:path";
import { getComponentLogger } from "../../logging/index.js";
import { LanguageLoader } from "./LanguageLoader.js";
import { LanguageNotSupportedError, FileTooLargeError, ParseTimeoutError } from "./errors.js";
import {
  type SupportedLanguage,
  type CodeEntity,
  type EntityType,
  type EntityMetadata,
  type ParameterInfo,
  type ImportInfo,
  type ExportInfo,
  type CallInfo,
  type ParseResult,
  type ParseError,
  type ParserConfig,
  DEFAULT_PARSER_CONFIG,
  getLanguageFromExtension,
  isSupportedExtension,
} from "./types.js";

/**
 * Node type to entity type mapping for TypeScript/JavaScript.
 */
const NODE_TO_ENTITY_TYPE: Record<string, EntityType> = {
  function_declaration: "function",
  function: "function",
  arrow_function: "function",
  generator_function_declaration: "function",
  method_definition: "method",
  class_declaration: "class",
  abstract_class_declaration: "class",
  interface_declaration: "interface",
  type_alias_declaration: "type_alias",
  enum_declaration: "enum",
  lexical_declaration: "variable",
  variable_declaration: "variable",
  public_field_definition: "property",
  property_signature: "property",
};

/**
 * Node type to entity type mapping for Python.
 * Python uses different AST node types than TypeScript/JavaScript.
 * Note: tree-sitter-python uses "function_definition" for both sync and async functions.
 * Async is detected via an "async" child node, not a separate node type.
 */
const PYTHON_NODE_TO_ENTITY_TYPE: Record<string, EntityType> = {
  function_definition: "function",
  class_definition: "class",
};

/**
 * Node type to entity type mapping for Java.
 * Java uses different AST node types than TypeScript/JavaScript/Python.
 * Note: Java doesn't have standalone functions - all are methods within classes.
 */
const JAVA_NODE_TO_ENTITY_TYPE: Record<string, EntityType> = {
  class_declaration: "class",
  interface_declaration: "interface",
  enum_declaration: "enum",
  method_declaration: "method",
  constructor_declaration: "method",
  field_declaration: "property",
};

/**
 * Node type to entity type mapping for Go.
 * Go uses different AST node types than other languages.
 * Note: Go has package-level functions (not methods on types) as first-class entities.
 * Structs and interfaces are type declarations in Go.
 */
const GO_NODE_TO_ENTITY_TYPE: Record<string, EntityType> = {
  function_declaration: "function",
  method_declaration: "method",
  type_declaration: "class", // structs and interfaces become "class" type
};

/**
 * Node types that represent entities we want to extract.
 * Currently used implicitly via NODE_TO_ENTITY_TYPE lookup.
 */
export const ENTITY_NODE_TYPES = Object.keys(NODE_TO_ENTITY_TYPE);

/**
 * Tree-sitter based parser for TypeScript and JavaScript files.
 *
 * Extracts code entities, imports, and exports from source files
 * using tree-sitter's incremental parsing capabilities.
 *
 * @example
 * ```typescript
 * const parser = new TreeSitterParser();
 * const result = await parser.parseFile(sourceCode, 'src/utils.ts');
 *
 * console.log(`Found ${result.entities.length} entities`);
 * console.log(`Found ${result.imports.length} imports`);
 * ```
 */
export class TreeSitterParser {
  private readonly languageLoader: LanguageLoader;
  private readonly config: Required<ParserConfig>;
  private _logger: pino.Logger | null = null;

  /**
   * Create a new TreeSitterParser instance.
   *
   * @param languageLoader - Optional custom language loader
   * @param config - Optional parser configuration
   */
  constructor(languageLoader?: LanguageLoader, config?: ParserConfig) {
    this.languageLoader = languageLoader ?? LanguageLoader.getInstance();
    this.config = {
      ...DEFAULT_PARSER_CONFIG,
      ...config,
    };
  }

  /**
   * Get the component logger (lazy initialization).
   */
  private get logger(): pino.Logger {
    if (!this._logger) {
      this._logger = getComponentLogger("graph:parsing:parser");
    }
    return this._logger;
  }

  /**
   * Check if a file extension is supported for parsing.
   *
   * @param extension - File extension with dot (e.g., '.ts')
   * @returns true if supported
   */
  static isSupported(extension: string): boolean {
    return isSupportedExtension(extension);
  }

  /**
   * Get the language for a file extension.
   *
   * @param extension - File extension with dot
   * @returns Language or null if not supported
   */
  static getLanguageFromExtension(extension: string): SupportedLanguage | null {
    return getLanguageFromExtension(extension);
  }

  /**
   * Parse a source file and extract entities.
   *
   * @param content - Source code content
   * @param filePath - File path (used for extension detection and in results)
   * @returns Parse result with entities, imports, and errors
   * @throws {LanguageNotSupportedError} If file extension is not supported
   * @throws {FileTooLargeError} If file exceeds max size
   * @throws {ParseTimeoutError} If parsing exceeds configured timeout
   */
  async parseFile(content: string, filePath: string): Promise<ParseResult> {
    const startTime = performance.now();
    const errors: ParseError[] = [];

    // Check file size
    const sizeBytes = new TextEncoder().encode(content).length;
    if (sizeBytes > this.config.maxFileSizeBytes) {
      throw new FileTooLargeError(filePath, sizeBytes, this.config.maxFileSizeBytes);
    }

    // Get language from extension
    const extension = path.extname(filePath).toLowerCase();
    const language = getLanguageFromExtension(extension);

    if (!language) {
      throw new LanguageNotSupportedError(filePath, extension);
    }

    this.logger.debug({ filePath, language, sizeBytes }, "Parsing file");

    // Create timeout promise for enforcing parseTimeoutMs
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new ParseTimeoutError(filePath, this.config.parseTimeoutMs));
      }, this.config.parseTimeoutMs);
    });

    // Define the parse operation
    const parseOperation = async (): Promise<ParseResult> => {
      // Get parser and language
      const parser = await this.languageLoader.getParser();
      const lang = await this.languageLoader.getLanguage(language);
      parser.setLanguage(lang);

      // Parse the content
      const tree = parser.parse(content);

      // Handle parse failure
      if (!tree) {
        errors.push({
          message: "Failed to parse file: parser returned null",
          recoverable: false,
        });

        return {
          filePath,
          language,
          entities: [],
          imports: [],
          exports: [],
          calls: [],
          parseTimeMs: performance.now() - startTime,
          errors,
          success: false,
        };
      }

      // Check for syntax errors
      if (tree.rootNode.hasError) {
        errors.push(...this.collectSyntaxErrors(tree.rootNode));
      }

      // Extract entities (language-aware)
      const entities = this.extractEntities(tree.rootNode, filePath, language);

      // Extract imports (language-aware)
      const imports = this.extractImports(tree.rootNode, language);

      // Extract exports (language-aware - Python doesn't have explicit exports)
      const exports = this.extractExports(tree.rootNode, language);

      // Extract function calls (language-aware)
      const calls = this.extractCalls(tree.rootNode, language);

      const parseTimeMs = performance.now() - startTime;

      this.logger.info(
        {
          metric: "parser.parse_file_ms",
          value: Math.round(parseTimeMs),
          filePath,
          entityCount: entities.length,
          importCount: imports.length,
          exportCount: exports.length,
          callCount: calls.length,
          errorCount: errors.length,
        },
        "File parsed successfully"
      );

      return {
        filePath,
        language,
        entities,
        imports,
        exports,
        calls,
        parseTimeMs,
        errors,
        success: true,
      };
    };

    try {
      // Race between parse operation and timeout
      const result = await Promise.race([parseOperation(), timeoutPromise]);
      return result;
    } catch (error) {
      const parseTimeMs = performance.now() - startTime;

      // Re-throw timeout errors and other known errors
      if (error instanceof ParseTimeoutError) {
        this.logger.warn({ filePath, timeoutMs: this.config.parseTimeoutMs }, "Parse timeout");
        throw error;
      }

      if (error instanceof LanguageNotSupportedError || error instanceof FileTooLargeError) {
        throw error;
      }

      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error({ err, filePath }, "Failed to parse file");

      errors.push({
        message: err.message,
        recoverable: false,
      });

      return {
        filePath,
        language,
        entities: [],
        imports: [],
        exports: [],
        calls: [],
        parseTimeMs,
        errors,
        success: false,
      };
    } finally {
      // Always clear the timeout to prevent memory leaks
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  }

  /**
   * Collect syntax errors from the parse tree.
   */
  private collectSyntaxErrors(node: Node): ParseError[] {
    const errors: ParseError[] = [];

    const collectErrors = (n: Node): void => {
      if (n.type === "ERROR" || n.isMissing) {
        errors.push({
          message: n.isMissing ? `Missing ${n.type}` : `Syntax error: unexpected ${n.type}`,
          line: n.startPosition.row + 1,
          column: n.startPosition.column,
          recoverable: true,
        });
      }

      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i);
        if (child) {
          collectErrors(child);
        }
      }
    };

    collectErrors(node);
    return errors;
  }

  /**
   * Extract code entities from the parse tree.
   */
  private extractEntities(root: Node, filePath: string, language: SupportedLanguage): CodeEntity[] {
    const entities: CodeEntity[] = [];
    const isPython = language === "python";
    const isJava = language === "java";
    const isGo = language === "go";

    const processNode = (node: Node, isExported: boolean = false): void => {
      // Use language-specific node type mapping
      let nodeTypeMapping: Record<string, EntityType>;
      if (isPython) {
        nodeTypeMapping = PYTHON_NODE_TO_ENTITY_TYPE;
      } else if (isJava) {
        nodeTypeMapping = JAVA_NODE_TO_ENTITY_TYPE;
      } else if (isGo) {
        nodeTypeMapping = GO_NODE_TO_ENTITY_TYPE;
      } else {
        nodeTypeMapping = NODE_TO_ENTITY_TYPE;
      }
      const entityType = nodeTypeMapping[node.type];

      // Handle Python decorated definitions
      if (isPython && node.type === "decorated_definition") {
        // Extract the actual definition from inside the decorated_definition
        const definition = node.childForFieldName("definition");
        if (definition) {
          processNode(definition, isExported);
        }
        return; // Don't recurse into already processed decorated definition
      }

      if (entityType) {
        try {
          const entity = this.extractEntity(node, filePath, entityType, isExported, language);
          if (entity) {
            entities.push(entity);
          }
        } catch (error) {
          this.logger.warn(
            {
              err: error,
              nodeType: node.type,
              filePath,
              line: node.startPosition.row + 1,
            },
            "Failed to extract entity"
          );
        }
      }

      // Check for export wrapper (TypeScript/JavaScript only)
      if (!isPython && node.type === "export_statement") {
        // Process the declaration inside the export
        const declaration = node.childForFieldName("declaration");
        if (declaration) {
          processNode(declaration, true);
        }
        return; // Don't recurse into already processed export
      }

      // Process children
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) {
          processNode(child, isExported);
        }
      }
    };

    processNode(root);
    return entities;
  }

  /**
   * Extract a single entity from a node.
   */
  private extractEntity(
    node: Node,
    filePath: string,
    entityType: EntityType,
    isExported: boolean,
    language: SupportedLanguage
  ): CodeEntity | null {
    const isPython = language === "python";
    const isJava = language === "java";
    const isGo = language === "go";

    // Get entity name (language-aware)
    let name: string | null;
    if (isPython) {
      name = this.extractPythonEntityName(node, entityType);
    } else if (isJava) {
      name = this.extractJavaEntityName(node, entityType);
    } else if (isGo) {
      name = this.extractGoEntityName(node, entityType);
    } else {
      name = this.extractEntityName(node, entityType);
    }
    if (!name && !this.config.includeAnonymous) {
      return null;
    }

    // In Go, exported identifiers start with uppercase letter
    // Override the isExported flag for Go based on naming convention
    let goExported = isExported;
    if (isGo && name) {
      goExported = name.charAt(0) === name.charAt(0).toUpperCase() && /[A-Z]/.test(name.charAt(0));
    }

    // Build metadata (language-aware)
    let metadata: EntityMetadata;
    if (isPython) {
      metadata = this.extractPythonMetadata(node, entityType);
    } else if (isJava) {
      metadata = this.extractJavaMetadata(node, entityType);
    } else if (isGo) {
      metadata = this.extractGoMetadata(node, entityType);
    } else {
      metadata = this.extractMetadata(node, entityType);
    }

    return {
      type: entityType,
      name: name ?? "<anonymous>",
      filePath,
      lineStart: node.startPosition.row + 1,
      lineEnd: node.endPosition.row + 1,
      columnStart: node.startPosition.column,
      columnEnd: node.endPosition.column,
      isExported: isGo ? goExported : isExported,
      metadata,
    };
  }

  /**
   * Extract the name of an entity.
   */
  private extractEntityName(node: Node, entityType: EntityType): string | null {
    // Try name field first
    const nameNode = node.childForFieldName("name");
    if (nameNode) {
      return nameNode.text;
    }

    // For variables, look at the declarator
    if (entityType === "variable") {
      const declarator = this.findFirstChild(node, ["variable_declarator", "lexical_declaration"]);
      if (declarator) {
        const nameChild = declarator.childForFieldName("name");
        if (nameChild) {
          return nameChild.text;
        }
        // Try first identifier child
        const identifier = this.findFirstChild(declarator, ["identifier"]);
        if (identifier) {
          return identifier.text;
        }
      }
    }

    // For methods, the name is often a property_identifier
    if (entityType === "method") {
      const identifier = this.findFirstChild(node, ["property_identifier", "identifier"]);
      if (identifier) {
        return identifier.text;
      }
    }

    // For properties
    if (entityType === "property") {
      const identifier = this.findFirstChild(node, ["property_identifier", "identifier"]);
      if (identifier) {
        return identifier.text;
      }
    }

    return null;
  }

  /**
   * Extract metadata from an entity node.
   */
  private extractMetadata(node: Node, entityType: EntityType): EntityMetadata {
    const metadata: EntityMetadata = {};

    // Check for async
    if (this.hasChildOfType(node, "async")) {
      metadata.isAsync = true;
    }

    // Check for static
    if (this.hasChildOfType(node, "static")) {
      metadata.isStatic = true;
    }

    // Check for abstract (in class or method)
    if (this.hasChildOfType(node, "abstract")) {
      metadata.isAbstract = true;
    }

    // Check for generator
    if (node.type.includes("generator")) {
      metadata.isGenerator = true;
    }

    // Extract parameters for functions/methods
    if (entityType === "function" || entityType === "method") {
      const params = this.extractParameters(node);
      if (params.length > 0) {
        metadata.parameters = params;
      }

      // Extract return type
      const returnType = this.extractReturnType(node);
      if (returnType) {
        metadata.returnType = returnType;
      }
    }

    // Extract extends for classes
    if (entityType === "class") {
      const extendsClause =
        node.childForFieldName("extends") ?? this.findFirstChild(node, ["extends_clause"]);
      if (extendsClause) {
        const parentClass = this.findFirstChild(extendsClause, ["identifier", "type_identifier"]);
        if (parentClass) {
          metadata.extends = parentClass.text;
        }
      }

      // Extract implements
      const implementsClause = this.findFirstChild(node, ["implements_clause"]);
      if (implementsClause) {
        metadata.implements = this.extractIdentifiers(implementsClause);
      }
    }

    // Extract type parameters
    const typeParams =
      node.childForFieldName("type_parameters") ?? this.findFirstChild(node, ["type_parameters"]);
    if (typeParams) {
      metadata.typeParameters = this.extractTypeParameters(typeParams);
    }

    // Extract documentation
    if (this.config.extractDocumentation) {
      const doc = this.extractDocumentation(node);
      if (doc) {
        metadata.documentation = doc;
      }
    }

    return metadata;
  }

  /**
   * Extract function parameters.
   */
  private extractParameters(node: Node): ParameterInfo[] {
    const params: ParameterInfo[] = [];

    const paramsNode =
      node.childForFieldName("parameters") ?? this.findFirstChild(node, ["formal_parameters"]);

    if (!paramsNode) {
      return params;
    }

    for (let i = 0; i < paramsNode.childCount; i++) {
      const child = paramsNode.child(i);
      if (!child) continue;

      if (
        child.type === "required_parameter" ||
        child.type === "optional_parameter" ||
        child.type === "rest_parameter" ||
        child.type === "identifier" ||
        child.type === "assignment_pattern"
      ) {
        const param = this.extractParameter(child);
        if (param) {
          params.push(param);
        }
      }
    }

    return params;
  }

  /**
   * Extract a single parameter.
   */
  private extractParameter(node: Node): ParameterInfo | null {
    let name: string | null = null;
    let type: string | undefined;
    let hasDefault = false;
    let isOptional = false;
    let isRest = false;

    if (node.type === "rest_parameter") {
      isRest = true;
      const pattern =
        node.childForFieldName("pattern") ?? this.findFirstChild(node, ["identifier"]);
      name = pattern?.text ?? null;
    } else if (node.type === "identifier") {
      name = node.text;
    } else if (node.type === "assignment_pattern") {
      hasDefault = true;
      const left = node.childForFieldName("left") ?? node.child(0);
      name = left?.text ?? null;
    } else {
      // required_parameter or optional_parameter
      isOptional = node.type === "optional_parameter";
      const pattern =
        node.childForFieldName("pattern") ?? this.findFirstChild(node, ["identifier"]);
      name = pattern?.text ?? null;

      // Check for type annotation
      const typeNode =
        node.childForFieldName("type") ?? this.findFirstChild(node, ["type_annotation"]);
      if (typeNode) {
        type = this.extractTypeText(typeNode);
      }

      // Check for default value
      const value = node.childForFieldName("value");
      if (value) {
        hasDefault = true;
      }
    }

    if (!name) {
      return null;
    }

    return { name, type, hasDefault, isOptional, isRest };
  }

  /**
   * Extract return type annotation.
   */
  private extractReturnType(node: Node): string | null {
    const returnType =
      node.childForFieldName("return_type") ?? this.findFirstChild(node, ["type_annotation"]);

    if (returnType) {
      return this.extractTypeText(returnType);
    }

    return null;
  }

  /**
   * Extract type text from a type annotation node.
   */
  private extractTypeText(node: Node): string {
    // Skip the colon in type annotations
    if (node.type === "type_annotation") {
      const typeNode = node.child(1);
      return typeNode?.text ?? node.text;
    }
    return node.text;
  }

  /**
   * Extract type parameters.
   */
  private extractTypeParameters(node: Node): string[] {
    const params: string[] = [];

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child?.type === "type_parameter") {
        const name =
          child.childForFieldName("name") ?? this.findFirstChild(child, ["type_identifier"]);
        if (name) {
          params.push(name.text);
        }
      }
    }

    return params;
  }

  /**
   * Extract JSDoc documentation.
   */
  private extractDocumentation(node: Node): string | null {
    // Look for preceding comment on this node
    const doc = this.findPrecedingJSDoc(node);
    if (doc) {
      return doc;
    }

    // If this is a child of an export_statement, check the parent's siblings
    if (node.parent?.type === "export_statement") {
      return this.findPrecedingJSDoc(node.parent);
    }

    return null;
  }

  /**
   * Find JSDoc comment preceding a node.
   */
  private findPrecedingJSDoc(node: Node): string | null {
    let prevSibling = node.previousSibling;
    while (prevSibling?.type === "comment" || prevSibling?.type === "\n") {
      if (prevSibling.type === "comment") {
        const text = prevSibling.text;
        if (text.startsWith("/**")) {
          return text;
        }
      }
      prevSibling = prevSibling.previousSibling;
    }
    return null;
  }

  // ==================== Python-Specific Methods ====================

  /**
   * Check if a parameter name is a Python implicit parameter (self/cls).
   * These are automatically passed by Python for instance/class methods.
   */
  private isPythonImplicitParameter(name: string): boolean {
    return name === "self" || name === "cls";
  }

  /**
   * Extract entity name for Python AST nodes.
   */
  private extractPythonEntityName(node: Node, _entityType: EntityType): string | null {
    // For Python functions and classes, the name is in the "name" field
    const nameNode = node.childForFieldName("name");
    if (nameNode) {
      return nameNode.text;
    }

    return null;
  }

  /**
   * Extract metadata from a Python entity node.
   */
  private extractPythonMetadata(node: Node, entityType: EntityType): EntityMetadata {
    const metadata: EntityMetadata = {};

    // Check for async functions
    // In tree-sitter-python, async functions have an "async" child node
    // The node type is still "function_definition", not "async_function_definition"
    if (node.type === "function_definition" && this.hasChildOfType(node, "async")) {
      metadata.isAsync = true;
    }

    // Extract parameters for functions
    if (entityType === "function") {
      const params = this.extractPythonParameters(node);
      if (params.length > 0) {
        metadata.parameters = params;
      }

      // Extract return type annotation
      const returnType = this.extractPythonReturnType(node);
      if (returnType) {
        metadata.returnType = returnType;
      }
    }

    // Extract base classes for Python classes
    if (entityType === "class") {
      const superclass = this.extractPythonSuperclass(node);
      if (superclass) {
        metadata.extends = superclass;
      }
    }

    // Extract docstring as documentation
    if (this.config.extractDocumentation) {
      const doc = this.extractPythonDocstring(node);
      if (doc) {
        metadata.documentation = doc;
      }
    }

    return metadata;
  }

  /**
   * Extract function parameters from Python AST.
   */
  private extractPythonParameters(node: Node): ParameterInfo[] {
    const params: ParameterInfo[] = [];

    const paramsNode = node.childForFieldName("parameters");
    if (!paramsNode) {
      return params;
    }

    for (let i = 0; i < paramsNode.childCount; i++) {
      const child = paramsNode.child(i);
      if (!child) continue;

      // Python parameter types
      if (
        child.type === "identifier" ||
        child.type === "typed_parameter" ||
        child.type === "default_parameter" ||
        child.type === "typed_default_parameter" ||
        child.type === "list_splat_pattern" ||
        child.type === "dictionary_splat_pattern"
      ) {
        const param = this.extractPythonParameter(child);
        if (param) {
          params.push(param);
        }
      }
    }

    return params;
  }

  /**
   * Extract a single Python parameter.
   */
  private extractPythonParameter(node: Node): ParameterInfo | null {
    let name: string | null = null;
    let type: string | undefined;
    let hasDefault = false;
    let isOptional = false;
    let isRest = false;

    switch (node.type) {
      case "identifier":
        name = node.text;
        // Skip implicit parameters in method definitions
        if (this.isPythonImplicitParameter(name)) {
          return null;
        }
        break;

      case "typed_parameter": {
        const nameNode = node.child(0);
        name = nameNode?.text ?? null;
        // Skip implicit parameters in method definitions
        if (name && this.isPythonImplicitParameter(name)) {
          return null;
        }
        const typeNode = node.childForFieldName("type");
        if (typeNode) {
          type = typeNode.text;
        }
        break;
      }

      case "default_parameter": {
        hasDefault = true;
        isOptional = true;
        const nameNode = node.childForFieldName("name");
        name = nameNode?.text ?? null;
        break;
      }

      case "typed_default_parameter": {
        hasDefault = true;
        isOptional = true;
        const nameNode = node.childForFieldName("name");
        name = nameNode?.text ?? null;
        const typeNode = node.childForFieldName("type");
        if (typeNode) {
          type = typeNode.text;
        }
        break;
      }

      case "list_splat_pattern": {
        // *args
        isRest = true;
        const nameNode = node.child(1) ?? node.child(0);
        name = nameNode?.text ?? null;
        break;
      }

      case "dictionary_splat_pattern": {
        // **kwargs
        isRest = true;
        const nameNode = node.child(1) ?? node.child(0);
        name = nameNode?.text ?? null;
        break;
      }

      default:
        return null;
    }

    if (!name) {
      return null;
    }

    return { name, type, hasDefault, isOptional, isRest };
  }

  /**
   * Extract return type annotation from Python function.
   */
  private extractPythonReturnType(node: Node): string | null {
    const returnTypeNode = node.childForFieldName("return_type");
    if (returnTypeNode) {
      return returnTypeNode.text;
    }
    return null;
  }

  /**
   * Extract superclass from Python class definition.
   */
  private extractPythonSuperclass(node: Node): string | null {
    const superclassNode = node.childForFieldName("superclasses");
    if (superclassNode) {
      // Get the first base class (primary inheritance)
      const firstBase = this.findFirstChild(superclassNode, ["identifier", "attribute"]);
      if (firstBase) {
        return firstBase.text;
      }
    }
    return null;
  }

  /**
   * Extract docstring from Python function or class.
   *
   * In Python, docstrings are the first statement if it's a string literal.
   */
  private extractPythonDocstring(node: Node): string | null {
    const bodyNode = node.childForFieldName("body");
    if (!bodyNode) {
      return null;
    }

    // The body is typically a "block" node
    // Look for the first expression_statement containing a string
    for (let i = 0; i < bodyNode.childCount; i++) {
      const child = bodyNode.child(i);
      if (!child) continue;

      if (child.type === "expression_statement") {
        // Check if it contains a string literal
        const stringNode = this.findFirstChild(child, ["string", "concatenated_string"]);
        if (stringNode) {
          // Return the docstring content (with quotes)
          return stringNode.text;
        }
      }

      // If the first non-comment statement isn't a string, there's no docstring
      if (child.type !== "comment" && child.type !== "pass_statement") {
        break;
      }
    }

    return null;
  }

  /**
   * Extract imports from Python import statements.
   */
  private extractPythonImports(root: Node): ImportInfo[] {
    const imports: ImportInfo[] = [];

    const processNode = (node: Node): void => {
      if (node.type === "import_statement" || node.type === "import_from_statement") {
        try {
          const infos = this.extractPythonImportInfo(node);
          imports.push(...infos);
        } catch (error) {
          this.logger.warn(
            {
              err: error,
              line: node.startPosition.row + 1,
            },
            "Failed to extract Python import"
          );
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) {
          processNode(child);
        }
      }
    };

    processNode(root);
    return imports;
  }

  /**
   * Extract information from Python import statements.
   *
   * Handles both:
   * - import foo, bar
   * - from foo import bar, baz
   */
  private extractPythonImportInfo(node: Node): ImportInfo[] {
    const infos: ImportInfo[] = [];

    if (node.type === "import_statement") {
      // import foo, bar as b
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (!child) continue;

        if (child.type === "dotted_name") {
          const source = child.text;
          infos.push({
            source,
            isRelative: false,
            importedNames: [source.split(".").pop() ?? source],
            isTypeOnly: false,
            isSideEffect: false,
            line: node.startPosition.row + 1,
          });
        } else if (child.type === "aliased_import") {
          const nameNode = child.childForFieldName("name");
          const aliasNode = child.childForFieldName("alias");
          if (nameNode) {
            const source = nameNode.text;
            const originalName = source.split(".").pop() ?? source;
            const info: ImportInfo = {
              source,
              isRelative: false,
              importedNames: [originalName],
              isTypeOnly: false,
              isSideEffect: false,
              line: node.startPosition.row + 1,
            };
            if (aliasNode) {
              info.aliases = { [originalName]: aliasNode.text };
            }
            infos.push(info);
          }
        }
      }
    } else if (node.type === "import_from_statement") {
      // from foo import bar, baz
      const moduleNode = node.childForFieldName("module_name");
      const source = moduleNode?.text ?? "";

      // Check for relative imports (from . import or from .. import)
      const isRelative =
        source.startsWith(".") ||
        node.children.some((c) => c?.type === "relative_import" || c?.type === "import_prefix");

      const importedNames: string[] = [];
      const aliases: Record<string, string> = {};

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (!child) continue;

        if (child.type === "dotted_name" || child.type === "identifier") {
          // Simple import: from foo import bar
          if (child !== moduleNode) {
            importedNames.push(child.text);
          }
        } else if (child.type === "aliased_import") {
          // Aliased import: from foo import bar as b
          const nameNode = child.childForFieldName("name");
          const aliasNode = child.childForFieldName("alias");
          if (nameNode) {
            importedNames.push(nameNode.text);
            if (aliasNode) {
              aliases[nameNode.text] = aliasNode.text;
            }
          }
        } else if (child.type === "wildcard_import") {
          // from foo import *
          importedNames.push("*");
        }
      }

      if (importedNames.length > 0 || source) {
        const info: ImportInfo = {
          source,
          isRelative,
          importedNames,
          isTypeOnly: false,
          isSideEffect: importedNames.length === 0,
          line: node.startPosition.row + 1,
        };
        if (Object.keys(aliases).length > 0) {
          info.aliases = aliases;
        }
        infos.push(info);
      }
    }

    return infos;
  }

  /**
   * Extract function calls from Python AST.
   */
  private extractPythonCalls(root: Node): CallInfo[] {
    const calls: CallInfo[] = [];

    const processNode = (node: Node, callerName?: string): void => {
      let currentCaller = callerName;

      // Update caller context when entering a function
      // Note: tree-sitter-python uses "function_definition" for both sync and async functions
      if (node.type === "function_definition") {
        const nameNode = node.childForFieldName("name");
        if (nameNode) {
          currentCaller = nameNode.text;
        }
      }

      // Check for call expression in Python
      if (node.type === "call") {
        try {
          const callInfo = this.extractPythonCallInfo(node, currentCaller);
          if (callInfo) {
            calls.push(callInfo);
          }
        } catch (error) {
          this.logger.warn(
            {
              err: error,
              line: node.startPosition.row + 1,
            },
            "Failed to extract Python call"
          );
        }
      }

      // Recurse into children
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) {
          processNode(child, currentCaller);
        }
      }
    };

    processNode(root);
    return calls;
  }

  /**
   * Extract information from a Python call node.
   */
  private extractPythonCallInfo(node: Node, callerName?: string): CallInfo | null {
    const functionNode = node.childForFieldName("function");
    if (!functionNode) {
      return null;
    }

    const callTarget = this.extractPythonCallTarget(functionNode);
    if (!callTarget) {
      return null;
    }

    // Check if this call is awaited (parent is await expression)
    const isAsync = node.parent?.type === "await";

    return {
      calledName: callTarget.name,
      calledExpression: callTarget.expression,
      isAsync,
      line: node.startPosition.row + 1,
      column: node.startPosition.column,
      callerName,
    };
  }

  /**
   * Extract call target from Python call expression.
   */
  private extractPythonCallTarget(node: Node): { name: string; expression: string } | null {
    // Simple identifier: foo()
    if (node.type === "identifier") {
      return {
        name: node.text,
        expression: node.text,
      };
    }

    // Attribute access: obj.method()
    if (node.type === "attribute") {
      const attrNode = node.childForFieldName("attribute");
      if (attrNode) {
        return {
          name: attrNode.text,
          expression: node.text,
        };
      }
    }

    // Subscript: obj["method"]()
    if (node.type === "subscript") {
      const subscriptNode = node.childForFieldName("subscript");
      if (subscriptNode && subscriptNode.type === "string") {
        const name = subscriptNode.text.slice(1, -1); // Remove quotes
        return {
          name,
          expression: node.text,
        };
      }
      return {
        name: "[dynamic]",
        expression: node.text,
      };
    }

    // Call expression (chained): foo().bar()
    if (node.type === "call") {
      return {
        name: "[chained]",
        expression: node.text,
      };
    }

    // Fallback
    if (node.text) {
      return {
        name: node.text,
        expression: node.text,
      };
    }

    return null;
  }

  // ==================== Java-Specific Methods ====================

  /**
   * Extract entity name for Java AST nodes.
   */
  private extractJavaEntityName(node: Node, entityType: EntityType): string | null {
    // For Java classes, interfaces, enums - the name is in the "name" field
    if (entityType === "class" || entityType === "interface" || entityType === "enum") {
      const nameNode = node.childForFieldName("name");
      if (nameNode) {
        return nameNode.text;
      }
    }

    // For Java methods/constructors - the name is in the "name" field
    if (entityType === "method") {
      const nameNode = node.childForFieldName("name");
      if (nameNode) {
        return nameNode.text;
      }
    }

    // For Java fields (field_declaration) - extract from variable_declarator
    if (entityType === "property") {
      const declarator = this.findFirstChild(node, ["variable_declarator"]);
      if (declarator) {
        const nameNode = declarator.childForFieldName("name");
        if (nameNode) {
          return nameNode.text;
        }
      }
    }

    return null;
  }

  /**
   * Extract metadata from a Java entity node.
   */
  private extractJavaMetadata(node: Node, entityType: EntityType): EntityMetadata {
    const metadata: EntityMetadata = {};

    // Extract modifiers (public, private, protected, static, final, abstract)
    const modifiers = this.extractJavaModifiers(node);
    if (modifiers.isStatic) {
      metadata.isStatic = true;
    }
    if (modifiers.isAbstract) {
      metadata.isAbstract = true;
    }

    // Extract parameters for methods
    if (entityType === "method") {
      const params = this.extractJavaParameters(node);
      if (params.length > 0) {
        metadata.parameters = params;
      }

      // Extract return type
      const returnType = this.extractJavaReturnType(node);
      if (returnType) {
        metadata.returnType = returnType;
      }
    }

    // Extract inheritance for classes
    if (entityType === "class") {
      const superclass = this.extractJavaSuperclass(node);
      if (superclass) {
        metadata.extends = superclass;
      }

      const interfaces = this.extractJavaInterfaces(node);
      if (interfaces.length > 0) {
        metadata.implements = interfaces;
      }
    }

    // Extract interfaces for interface declarations (extends)
    if (entityType === "interface") {
      const extendedInterfaces = this.extractJavaExtendedInterfaces(node);
      if (extendedInterfaces.length > 0) {
        metadata.implements = extendedInterfaces;
      }
    }

    // Extract type parameters (generics)
    const typeParams = node.childForFieldName("type_parameters");
    if (typeParams) {
      metadata.typeParameters = this.extractJavaTypeParameters(typeParams);
    }

    // Extract Javadoc comment
    if (this.config.extractDocumentation) {
      const doc = this.extractJavaDocumentation(node);
      if (doc) {
        metadata.documentation = doc;
      }
    }

    return metadata;
  }

  /**
   * Extract Java modifiers from a node (public, private, static, final, abstract, etc.)
   */
  private extractJavaModifiers(node: Node): {
    isPublic: boolean;
    isPrivate: boolean;
    isProtected: boolean;
    isStatic: boolean;
    isFinal: boolean;
    isAbstract: boolean;
  } {
    const result = {
      isPublic: false,
      isPrivate: false,
      isProtected: false,
      isStatic: false,
      isFinal: false,
      isAbstract: false,
    };

    // Look for modifiers node
    const modifiersNode = this.findFirstChild(node, ["modifiers"]);
    if (modifiersNode) {
      for (let i = 0; i < modifiersNode.childCount; i++) {
        const child = modifiersNode.child(i);
        if (!child) continue;
        switch (child.text) {
          case "public":
            result.isPublic = true;
            break;
          case "private":
            result.isPrivate = true;
            break;
          case "protected":
            result.isProtected = true;
            break;
          case "static":
            result.isStatic = true;
            break;
          case "final":
            result.isFinal = true;
            break;
          case "abstract":
            result.isAbstract = true;
            break;
        }
      }
    }

    return result;
  }

  /**
   * Extract function parameters from Java AST.
   */
  private extractJavaParameters(node: Node): ParameterInfo[] {
    const params: ParameterInfo[] = [];

    const paramsNode = node.childForFieldName("parameters");
    if (!paramsNode) {
      return params;
    }

    for (let i = 0; i < paramsNode.childCount; i++) {
      const child = paramsNode.child(i);
      if (!child) continue;

      // Java parameter types: formal_parameter, spread_parameter (varargs)
      if (child.type === "formal_parameter" || child.type === "spread_parameter") {
        const param = this.extractJavaParameter(child);
        if (param) {
          params.push(param);
        }
      }
    }

    return params;
  }

  /**
   * Extract a single Java parameter.
   */
  private extractJavaParameter(node: Node): ParameterInfo | null {
    let name: string | null = null;
    let type: string | undefined;
    const hasDefault = false; // Java doesn't support default parameters
    const isOptional = false;
    let isRest = false;

    if (node.type === "spread_parameter") {
      // Varargs: Type... name
      // tree-sitter-java structure: spread_parameter -> variable_declarator -> identifier
      isRest = true;
      const variableDeclarator = this.findFirstChild(node, ["variable_declarator"]);
      if (variableDeclarator) {
        const nameNode = variableDeclarator.childForFieldName("name");
        if (nameNode) {
          name = nameNode.text;
        } else {
          // Fallback: try to find an identifier directly
          const idNode = this.findFirstChild(variableDeclarator, ["identifier"]);
          name = idNode?.text ?? null;
        }
      }
      // Type is the first type_identifier child
      const typeNode = this.findFirstChild(node, ["type_identifier", "generic_type", "array_type"]);
      if (typeNode) {
        type = typeNode.text;
      }
    } else if (node.type === "formal_parameter") {
      const nameNode = node.childForFieldName("name");
      name = nameNode?.text ?? null;
      const typeNode = node.childForFieldName("type");
      if (typeNode) {
        type = typeNode.text;
      }
    }

    if (!name) {
      return null;
    }

    return { name, type, hasDefault, isOptional, isRest };
  }

  /**
   * Extract return type from Java method.
   */
  private extractJavaReturnType(node: Node): string | null {
    const typeNode = node.childForFieldName("type");
    if (typeNode) {
      return typeNode.text;
    }
    return null;
  }

  /**
   * Extract superclass from Java class declaration.
   */
  private extractJavaSuperclass(node: Node): string | null {
    const superclassNode = node.childForFieldName("superclass");
    if (superclassNode) {
      // The superclass field contains the type directly
      return superclassNode.text;
    }
    return null;
  }

  /**
   * Extract implemented interfaces from Java class declaration.
   */
  private extractJavaInterfaces(node: Node): string[] {
    const interfaces: string[] = [];
    const interfacesNode = node.childForFieldName("interfaces");
    if (interfacesNode) {
      // Interfaces are in a type_list
      for (let i = 0; i < interfacesNode.childCount; i++) {
        const child = interfacesNode.child(i);
        if (child && child.type !== ",") {
          interfaces.push(child.text);
        }
      }
    }
    return interfaces;
  }

  /**
   * Extract extended interfaces from Java interface declaration.
   */
  private extractJavaExtendedInterfaces(node: Node): string[] {
    const interfaces: string[] = [];
    // In Java, interface extends is captured similarly
    const extendsNode = this.findFirstChild(node, ["extends_interfaces"]);
    if (extendsNode) {
      for (let i = 0; i < extendsNode.childCount; i++) {
        const child = extendsNode.child(i);
        if (child && child.type !== "," && child.type !== "extends") {
          interfaces.push(child.text);
        }
      }
    }
    return interfaces;
  }

  /**
   * Extract type parameters from Java generic declarations.
   */
  private extractJavaTypeParameters(node: Node): string[] {
    const params: string[] = [];

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child?.type === "type_parameter") {
        const nameNode = child.child(0);
        if (nameNode) {
          params.push(nameNode.text);
        }
      }
    }

    return params;
  }

  /**
   * Extract Javadoc comment from preceding comment.
   */
  private extractJavaDocumentation(node: Node): string | null {
    let prevSibling = node.previousSibling;
    while (prevSibling) {
      if (prevSibling.type === "block_comment") {
        const text = prevSibling.text;
        // Javadoc starts with /**
        if (text.startsWith("/**")) {
          return text;
        }
      }
      // Skip whitespace/newlines but stop at other node types
      if (prevSibling.type !== "line_comment" && prevSibling.type !== "block_comment") {
        break;
      }
      prevSibling = prevSibling.previousSibling;
    }
    return null;
  }

  /**
   * Extract imports from Java import declarations.
   */
  private extractJavaImports(root: Node): ImportInfo[] {
    const imports: ImportInfo[] = [];

    const processNode = (node: Node): void => {
      if (node.type === "import_declaration") {
        try {
          const info = this.extractJavaImportInfo(node);
          if (info) {
            imports.push(info);
          }
        } catch (error) {
          this.logger.warn(
            {
              err: error,
              line: node.startPosition.row + 1,
            },
            "Failed to extract Java import"
          );
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) {
          processNode(child);
        }
      }
    };

    processNode(root);
    return imports;
  }

  /**
   * Extract information from a Java import declaration.
   *
   * Handles:
   * - import java.util.List;
   * - import java.util.*;
   * - import static java.lang.Math.PI;
   */
  private extractJavaImportInfo(node: Node): ImportInfo | null {
    // Check for static import
    const isStatic = this.hasChildOfType(node, "static");

    // The import path is in a scoped_identifier or identifier
    const scopedId = this.findFirstChild(node, ["scoped_identifier"]);
    const wildcardNode = this.findFirstChild(node, ["asterisk"]);

    let source = "";
    const importedNames: string[] = [];

    if (scopedId) {
      source = scopedId.text;
    } else {
      // Simple import like "import SomeClass;"
      const id = this.findFirstChild(node, ["identifier"]);
      if (id) {
        source = id.text;
      }
    }

    if (!source) {
      return null;
    }

    // For wildcard imports (import java.util.*)
    if (wildcardNode) {
      importedNames.push("*");
    } else {
      // Extract the last part as the imported name
      const parts = source.split(".");
      const lastPart = parts[parts.length - 1];
      if (lastPart) {
        importedNames.push(lastPart);
      }
    }

    return {
      source,
      isRelative: false, // Java imports are always absolute
      importedNames,
      isTypeOnly: !isStatic, // Regular imports are type imports in Java
      isSideEffect: false,
      line: node.startPosition.row + 1,
    };
  }

  /**
   * Extract function calls from Java AST.
   */
  private extractJavaCalls(root: Node): CallInfo[] {
    const calls: CallInfo[] = [];

    const processNode = (node: Node, callerName?: string): void => {
      let currentCaller = callerName;

      // Update caller context when entering a method
      if (node.type === "method_declaration" || node.type === "constructor_declaration") {
        const nameNode = node.childForFieldName("name");
        if (nameNode) {
          currentCaller = nameNode.text;
        }
      }

      // Check for method invocation
      if (node.type === "method_invocation") {
        try {
          const callInfo = this.extractJavaCallInfo(node, currentCaller);
          if (callInfo) {
            calls.push(callInfo);
          }
        } catch (error) {
          this.logger.warn(
            {
              err: error,
              line: node.startPosition.row + 1,
            },
            "Failed to extract Java call"
          );
        }
      }

      // Check for object creation (new expressions)
      if (node.type === "object_creation_expression") {
        try {
          const callInfo = this.extractJavaConstructorCall(node, currentCaller);
          if (callInfo) {
            calls.push(callInfo);
          }
        } catch (error) {
          this.logger.warn(
            {
              err: error,
              line: node.startPosition.row + 1,
            },
            "Failed to extract Java constructor call"
          );
        }
      }

      // Recurse into children
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) {
          processNode(child, currentCaller);
        }
      }
    };

    processNode(root);
    return calls;
  }

  /**
   * Extract information from a Java method invocation.
   */
  private extractJavaCallInfo(node: Node, callerName?: string): CallInfo | null {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) {
      return null;
    }

    const calledName = nameNode.text;

    // Build expression including object if present
    const objectNode = node.childForFieldName("object");
    let calledExpression = calledName;
    if (objectNode) {
      calledExpression = `${objectNode.text}.${calledName}`;
    }

    return {
      calledName,
      calledExpression,
      isAsync: false, // Java doesn't have async/await like JS
      line: node.startPosition.row + 1,
      column: node.startPosition.column,
      callerName,
    };
  }

  /**
   * Extract information from a Java constructor call (new expression).
   */
  private extractJavaConstructorCall(node: Node, callerName?: string): CallInfo | null {
    const typeNode = node.childForFieldName("type");
    if (!typeNode) {
      return null;
    }

    const calledName = typeNode.text;

    return {
      calledName,
      calledExpression: `new ${calledName}`,
      isAsync: false,
      line: node.startPosition.row + 1,
      column: node.startPosition.column,
      callerName,
    };
  }

  // ==================== Go-Specific Methods ====================

  /**
   * Extract entity name for Go AST nodes.
   */
  private extractGoEntityName(node: Node, entityType: EntityType): string | null {
    // For Go functions and methods, the name is in the "name" field
    if (entityType === "function" || entityType === "method") {
      const nameNode = node.childForFieldName("name");
      if (nameNode) {
        return nameNode.text;
      }
    }

    // For Go type declarations (struct, interface)
    if (entityType === "class") {
      // type_declaration contains type_spec children
      // type_spec has a name field
      const typeSpec = this.findFirstChild(node, ["type_spec"]);
      if (typeSpec) {
        const nameNode = typeSpec.childForFieldName("name");
        if (nameNode) {
          return nameNode.text;
        }
      }
    }

    return null;
  }

  /**
   * Extract metadata from a Go entity node.
   */
  private extractGoMetadata(node: Node, entityType: EntityType): EntityMetadata {
    const metadata: EntityMetadata = {};

    // Extract parameters for functions and methods
    if (entityType === "function" || entityType === "method") {
      const params = this.extractGoParameters(node);
      if (params.length > 0) {
        metadata.parameters = params;
      }

      // Extract return type
      const returnType = this.extractGoReturnType(node);
      if (returnType) {
        metadata.returnType = returnType;
      }
    }

    // Extract receiver type for methods (Go's version of "this")
    if (entityType === "method") {
      const receiver = this.extractGoReceiver(node);
      if (receiver) {
        // Store receiver info in extends field for now
        // This indicates which type the method belongs to
        metadata.extends = receiver;
      }
    }

    // Extract Go doc comments
    if (this.config.extractDocumentation) {
      const doc = this.extractGoDocumentation(node);
      if (doc) {
        metadata.documentation = doc;
      }
    }

    return metadata;
  }

  /**
   * Extract function parameters from Go AST.
   */
  private extractGoParameters(node: Node): ParameterInfo[] {
    const params: ParameterInfo[] = [];

    const paramsNode = node.childForFieldName("parameters");
    if (!paramsNode) {
      return params;
    }

    for (let i = 0; i < paramsNode.childCount; i++) {
      const child = paramsNode.child(i);
      if (!child) continue;

      // Go parameter_declaration contains identifier(s) and type
      if (child.type === "parameter_declaration") {
        const extractedParams = this.extractGoParameterDeclaration(child);
        params.push(...extractedParams);
      } else if (child.type === "variadic_parameter_declaration") {
        // Variadic parameter: ...T
        const param = this.extractGoVariadicParameter(child);
        if (param) {
          params.push(param);
        }
      }
    }

    return params;
  }

  /**
   * Extract parameters from a Go parameter_declaration node.
   * In Go, multiple parameters can share a type: (a, b int)
   */
  private extractGoParameterDeclaration(node: Node): ParameterInfo[] {
    const params: ParameterInfo[] = [];
    const names: string[] = [];
    let type: string | undefined;

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (!child) continue;

      if (child.type === "identifier") {
        names.push(child.text);
      } else if (child.type !== "," && child.type !== "(" && child.type !== ")") {
        // This is likely the type
        type = child.text;
      }
    }

    // Create parameter info for each name
    for (const name of names) {
      params.push({
        name,
        type,
        hasDefault: false, // Go doesn't support default parameters
        isOptional: false,
        isRest: false,
      });
    }

    // Handle case where there's just a type and no names (anonymous parameter)
    if (names.length === 0 && type) {
      params.push({
        name: "_",
        type,
        hasDefault: false,
        isOptional: false,
        isRest: false,
      });
    }

    return params;
  }

  /**
   * Extract a Go variadic parameter (...args).
   */
  private extractGoVariadicParameter(node: Node): ParameterInfo | null {
    let name: string | null = null;
    let type: string | undefined;

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (!child) continue;

      if (child.type === "identifier") {
        name = child.text;
      } else if (child.type !== "...") {
        // This is the type
        type = child.text;
      }
    }

    if (!name) {
      return null;
    }

    return {
      name,
      type: type ? `...${type}` : undefined,
      hasDefault: false,
      isOptional: false,
      isRest: true,
    };
  }

  /**
   * Extract return type from Go function.
   */
  private extractGoReturnType(node: Node): string | null {
    const resultNode = node.childForFieldName("result");
    if (resultNode) {
      return resultNode.text;
    }
    return null;
  }

  /**
   * Extract receiver type from Go method.
   * Methods in Go have receivers: func (r *Receiver) Method()
   */
  private extractGoReceiver(node: Node): string | null {
    const receiverNode = node.childForFieldName("receiver");
    if (!receiverNode) {
      return null;
    }

    // Find the type in the receiver
    // It could be a simple type or pointer type
    const paramDecl = this.findFirstChild(receiverNode, ["parameter_declaration"]);
    if (paramDecl) {
      // Look for type (skip identifier which is the receiver variable name)
      for (let i = 0; i < paramDecl.childCount; i++) {
        const child = paramDecl.child(i);
        if (
          child &&
          child.type !== "identifier" &&
          child.type !== "," &&
          child.type !== "(" &&
          child.type !== ")"
        ) {
          return child.text;
        }
      }
    }

    return null;
  }

  /**
   * Extract Go doc comments (comments preceding declarations).
   */
  private extractGoDocumentation(node: Node): string | null {
    // In Go, documentation comments are line comments starting with //
    // directly preceding the declaration
    const comments: string[] = [];
    let prevSibling = node.previousSibling;

    while (prevSibling) {
      if (prevSibling.type === "comment") {
        const text = prevSibling.text;
        // Only include // comments (not /* */)
        if (text.startsWith("//")) {
          comments.unshift(text);
        } else {
          break;
        }
      } else if (prevSibling.type === "\n" || prevSibling.type === "newline") {
        // Allow newlines between comments and declaration
      } else {
        // Stop at any other node type
        break;
      }
      prevSibling = prevSibling.previousSibling;
    }

    if (comments.length > 0) {
      return comments.join("\n");
    }

    return null;
  }

  /**
   * Extract imports from Go import declarations.
   */
  private extractGoImports(root: Node): ImportInfo[] {
    const imports: ImportInfo[] = [];

    const processNode = (node: Node): void => {
      if (node.type === "import_declaration") {
        try {
          const infos = this.extractGoImportInfo(node);
          imports.push(...infos);
        } catch (error) {
          this.logger.warn(
            {
              err: error,
              line: node.startPosition.row + 1,
            },
            "Failed to extract Go import"
          );
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) {
          processNode(child);
        }
      }
    };

    processNode(root);
    return imports;
  }

  /**
   * Extract information from Go import declarations.
   *
   * Handles both single and grouped imports:
   * - import "fmt"
   * - import alias "path/to/package"
   * - import (
   *     "fmt"
   *     alias "path/to/package"
   *   )
   */
  private extractGoImportInfo(node: Node): ImportInfo[] {
    const infos: ImportInfo[] = [];

    // Look for import_spec (single import) or import_spec_list (grouped imports)
    const processImportSpec = (spec: Node): void => {
      let source = "";
      let alias: string | undefined;

      // Check for alias (name field)
      const nameNode = spec.childForFieldName("name");
      if (nameNode) {
        alias = nameNode.text;
      }

      // Get the path (interpreted_string_literal)
      const pathNode = spec.childForFieldName("path");
      if (pathNode) {
        // Remove quotes from the path
        source = pathNode.text.replace(/^"|"$/g, "");
      }

      if (source) {
        const info: ImportInfo = {
          source,
          isRelative: source.startsWith("."),
          importedNames: [source.split("/").pop() ?? source],
          isTypeOnly: false,
          isSideEffect: alias === "_", // Blank import for side effects
          line: spec.startPosition.row + 1,
        };

        if (alias && alias !== "_" && alias !== ".") {
          info.aliases = { [source.split("/").pop() ?? source]: alias };
        }

        infos.push(info);
      }
    };

    // Process children to find import_spec nodes
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (!child) continue;

      if (child.type === "import_spec") {
        processImportSpec(child);
      } else if (child.type === "import_spec_list") {
        // Grouped imports
        for (let j = 0; j < child.childCount; j++) {
          const spec = child.child(j);
          if (spec?.type === "import_spec") {
            processImportSpec(spec);
          }
        }
      }
    }

    return infos;
  }

  /**
   * Extract function calls from Go AST.
   */
  private extractGoCalls(root: Node): CallInfo[] {
    const calls: CallInfo[] = [];

    const processNode = (node: Node, callerName?: string): void => {
      let currentCaller = callerName;

      // Update caller context when entering a function or method
      if (node.type === "function_declaration" || node.type === "method_declaration") {
        const nameNode = node.childForFieldName("name");
        if (nameNode) {
          currentCaller = nameNode.text;
        }
      }

      // Check for call expression in Go
      if (node.type === "call_expression") {
        try {
          const callInfo = this.extractGoCallInfo(node, currentCaller);
          if (callInfo) {
            calls.push(callInfo);
          }
        } catch (error) {
          this.logger.warn(
            {
              err: error,
              line: node.startPosition.row + 1,
            },
            "Failed to extract Go call"
          );
        }
      }

      // Recurse into children
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) {
          processNode(child, currentCaller);
        }
      }
    };

    processNode(root);
    return calls;
  }

  /**
   * Extract information from a Go call expression.
   */
  private extractGoCallInfo(node: Node, callerName?: string): CallInfo | null {
    const functionNode = node.childForFieldName("function");
    if (!functionNode) {
      return null;
    }

    const callTarget = this.extractGoCallTarget(functionNode);
    if (!callTarget) {
      return null;
    }

    return {
      calledName: callTarget.name,
      calledExpression: callTarget.expression,
      isAsync: false, // Go doesn't have async/await syntax
      line: node.startPosition.row + 1,
      column: node.startPosition.column,
      callerName,
    };
  }

  /**
   * Extract call target from Go call expression.
   */
  private extractGoCallTarget(node: Node): { name: string; expression: string } | null {
    // Simple identifier: foo()
    if (node.type === "identifier") {
      return {
        name: node.text,
        expression: node.text,
      };
    }

    // Selector expression: pkg.Function() or obj.Method()
    if (node.type === "selector_expression") {
      const fieldNode = node.childForFieldName("field");
      if (fieldNode) {
        return {
          name: fieldNode.text,
          expression: node.text,
        };
      }
    }

    // Parenthesized expression
    if (node.type === "parenthesized_expression") {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child && child.type !== "(" && child.type !== ")") {
          return this.extractGoCallTarget(child);
        }
      }
    }

    // Call expression (chained): foo().bar()
    if (node.type === "call_expression") {
      return {
        name: "[chained]",
        expression: node.text,
      };
    }

    // Type assertion: x.(Type)
    if (node.type === "type_assertion_expression") {
      return {
        name: "[type_assertion]",
        expression: node.text,
      };
    }

    // Index expression: arr[i]()
    if (node.type === "index_expression") {
      return {
        name: "[index]",
        expression: node.text,
      };
    }

    // Fallback
    if (node.text) {
      return {
        name: node.text,
        expression: node.text,
      };
    }

    return null;
  }

  /**
   * Extract imports from the parse tree.
   */
  private extractImports(root: Node, language: SupportedLanguage): ImportInfo[] {
    // Use language-specific import extraction
    if (language === "python") {
      return this.extractPythonImports(root);
    }
    if (language === "java") {
      return this.extractJavaImports(root);
    }
    if (language === "go") {
      return this.extractGoImports(root);
    }

    const imports: ImportInfo[] = [];

    const processNode = (node: Node): void => {
      if (node.type === "import_statement") {
        try {
          const info = this.extractImportInfo(node);
          if (info) {
            imports.push(info);
          }
        } catch (error) {
          this.logger.warn(
            {
              err: error,
              line: node.startPosition.row + 1,
            },
            "Failed to extract import"
          );
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) {
          processNode(child);
        }
      }
    };

    processNode(root);
    return imports;
  }

  /**
   * Extract information from an import statement.
   */
  private extractImportInfo(node: Node): ImportInfo | null {
    // Get the source module
    const sourceNode = node.childForFieldName("source") ?? this.findFirstChild(node, ["string"]);
    if (!sourceNode) {
      return null;
    }

    // Remove quotes from source
    const source = sourceNode.text.replace(/^['"]|['"]$/g, "");
    const isRelative = source.startsWith(".") || source.startsWith("/");
    const isTypeOnly = this.hasChildOfType(node, "type");

    // Check for side-effect import (import './styles.css')
    const hasSpecifiers = this.findFirstChild(node, [
      "import_clause",
      "namespace_import",
      "named_imports",
    ]);
    if (!hasSpecifiers) {
      return {
        source,
        isRelative,
        importedNames: [],
        isTypeOnly,
        isSideEffect: true,
        line: node.startPosition.row + 1,
      };
    }

    const info: ImportInfo = {
      source,
      isRelative,
      importedNames: [],
      isTypeOnly,
      isSideEffect: false,
      line: node.startPosition.row + 1,
    };

    // Extract import clause
    const importClause = this.findFirstChild(node, ["import_clause"]);
    if (importClause) {
      // Default import
      const defaultImport = this.findFirstChild(importClause, ["identifier"]);
      if (defaultImport && !this.hasParentOfType(defaultImport, "named_imports")) {
        info.defaultImport = defaultImport.text;
      }

      // Namespace import (import * as name)
      const namespaceImport = this.findFirstChild(importClause, ["namespace_import"]);
      if (namespaceImport) {
        const name = this.findFirstChild(namespaceImport, ["identifier"]);
        if (name) {
          info.namespaceImport = name.text;
        }
      }

      // Named imports
      const namedImports = this.findFirstChild(importClause, ["named_imports"]);
      if (namedImports) {
        const { names, aliases } = this.extractNamedImports(namedImports);
        info.importedNames = names;
        if (Object.keys(aliases).length > 0) {
          info.aliases = aliases;
        }
      }
    }

    return info;
  }

  /**
   * Extract named imports.
   */
  private extractNamedImports(node: Node): {
    names: string[];
    aliases: Record<string, string>;
  } {
    const names: string[] = [];
    const aliases: Record<string, string> = {};

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child?.type === "import_specifier") {
        const nameNode = child.childForFieldName("name");
        const aliasNode = child.childForFieldName("alias");

        if (nameNode) {
          names.push(nameNode.text);
          if (aliasNode) {
            aliases[nameNode.text] = aliasNode.text;
          }
        }
      }
    }

    return { names, aliases };
  }

  /**
   * Extract exports from the parse tree.
   */
  private extractExports(root: Node, language: SupportedLanguage): ExportInfo[] {
    // Python doesn't have explicit export statements like JavaScript/TypeScript
    // All module-level definitions are implicitly exported
    if (language === "python") {
      return [];
    }

    // Go doesn't have explicit export statements
    // Exports are determined by capitalization (handled in extractEntity)
    if (language === "go") {
      return [];
    }

    const exports: ExportInfo[] = [];

    const processNode = (node: Node): void => {
      if (node.type === "export_statement") {
        try {
          const info = this.extractExportInfo(node);
          if (info) {
            exports.push(info);
          }
        } catch (error) {
          this.logger.warn(
            {
              err: error,
              line: node.startPosition.row + 1,
            },
            "Failed to extract export"
          );
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) {
          processNode(child);
        }
      }
    };

    processNode(root);
    return exports;
  }

  /**
   * Extract information from an export statement.
   */
  private extractExportInfo(node: Node): ExportInfo | null {
    const info: ExportInfo = {
      exportedNames: [],
      isTypeOnly: this.hasChildOfType(node, "type"),
      isNamespaceExport: false,
      line: node.startPosition.row + 1,
    };

    // Check for export * from 'module'
    if (this.hasChildOfType(node, "*")) {
      info.isNamespaceExport = true;
      const sourceNode = node.childForFieldName("source") ?? this.findFirstChild(node, ["string"]);
      if (sourceNode) {
        info.source = sourceNode.text.replace(/^['"]|['"]$/g, "");
      }
      return info;
    }

    // Check for named exports (export { a, b })
    const exportClause = this.findFirstChild(node, ["export_clause"]);
    if (exportClause) {
      const { names, aliases } = this.extractExportSpecifiers(exportClause);
      info.exportedNames = names;
      if (Object.keys(aliases).length > 0) {
        info.aliases = aliases;
      }

      const sourceNode = node.childForFieldName("source") ?? this.findFirstChild(node, ["string"]);
      if (sourceNode) {
        info.source = sourceNode.text.replace(/^['"]|['"]$/g, "");
      }

      return info;
    }

    // Check for declaration exports (export function foo())
    const declaration = node.childForFieldName("declaration");
    if (declaration) {
      const name = this.extractEntityName(
        declaration,
        NODE_TO_ENTITY_TYPE[declaration.type] ?? "variable"
      );
      if (name) {
        info.exportedNames = [name];
      }
      return info;
    }

    // Check for default export
    if (this.hasChildOfType(node, "default")) {
      info.exportedNames = ["default"];
      return info;
    }

    return null;
  }

  /**
   * Extract export specifiers.
   */
  private extractExportSpecifiers(node: Node): {
    names: string[];
    aliases: Record<string, string>;
  } {
    const names: string[] = [];
    const aliases: Record<string, string> = {};

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child?.type === "export_specifier") {
        const nameNode = child.childForFieldName("name");
        const aliasNode = child.childForFieldName("alias");

        if (nameNode) {
          names.push(nameNode.text);
          if (aliasNode) {
            aliases[nameNode.text] = aliasNode.text;
          }
        }
      }
    }

    return { names, aliases };
  }

  // ==================== Helper Methods ====================

  /**
   * Find the first child of specific types.
   */
  private findFirstChild(node: Node, types: string[]): Node | null {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child && types.includes(child.type)) {
        return child;
      }
    }

    // Search recursively
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) {
        const found = this.findFirstChild(child, types);
        if (found) {
          return found;
        }
      }
    }

    return null;
  }

  /**
   * Check if node has a child of specific type.
   */
  private hasChildOfType(node: Node, type: string): boolean {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child?.type === type) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if node has parent of specific type.
   */
  private hasParentOfType(node: Node, type: string): boolean {
    let parent = node.parent;
    while (parent) {
      if (parent.type === type) {
        return true;
      }
      parent = parent.parent;
    }
    return false;
  }

  /**
   * Extract all identifier texts from a node.
   */
  private extractIdentifiers(node: Node): string[] {
    const identifiers: string[] = [];

    const collect = (n: Node): void => {
      if (n.type === "identifier" || n.type === "type_identifier") {
        identifiers.push(n.text);
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i);
        if (child) {
          collect(child);
        }
      }
    };

    collect(node);
    return identifiers;
  }

  // ==================== Call Extraction Methods ====================

  /**
   * Extract function calls from the parse tree.
   *
   * Traverses the AST to find all call_expression nodes and extracts
   * information about each function/method call for building CALLS relationships.
   *
   * @param root - Root node of the parse tree
   * @param language - The programming language being parsed
   * @returns Array of CallInfo objects
   */
  private extractCalls(root: Node, language: SupportedLanguage): CallInfo[] {
    // Use language-specific call extraction
    if (language === "python") {
      return this.extractPythonCalls(root);
    }
    if (language === "java") {
      return this.extractJavaCalls(root);
    }
    if (language === "go") {
      return this.extractGoCalls(root);
    }

    const calls: CallInfo[] = [];

    /**
     * Recursively process nodes to find call expressions.
     * Tracks the current caller context (function/method name).
     */
    const processNode = (node: Node, callerName?: string): void => {
      // Update caller context when entering a function/method
      let currentCaller = callerName;

      // Note: We intentionally exclude "new_expression" (constructor calls like `new Foo()`)
      // from caller context tracking. Constructor calls are semantically different from
      // function/method calls - they create instances rather than invoke behavior.
      // If constructor call tracking is needed, it should be handled separately.
      if (
        node.type === "function_declaration" ||
        node.type === "method_definition" ||
        node.type === "arrow_function" ||
        node.type === "function_expression" ||
        node.type === "generator_function_declaration"
      ) {
        // Get function name if available
        const nameNode = node.childForFieldName("name");
        if (nameNode) {
          currentCaller = nameNode.text;
        } else if (node.type === "arrow_function") {
          // For arrow functions assigned to variables, check immediate parent.
          // Note: This only handles top-level arrow function assignments like:
          //   const fn = () => { call(); }
          // It does NOT handle nested cases like:
          //   const obj = { method: () => { call(); } }
          // In nested cases, `call()` will have callerName=undefined rather than "method".
          // This is a known limitation - enhancing would require walking up the AST further.
          const parent = node.parent;
          if (parent?.type === "variable_declarator" || parent?.type === "lexical_declaration") {
            const varName = parent.childForFieldName("name");
            if (varName) {
              currentCaller = varName.text;
            }
          }
        }
      }

      // Check if this is a call expression
      if (node.type === "call_expression") {
        try {
          const callInfo = this.extractCallInfo(node, currentCaller);
          if (callInfo) {
            calls.push(callInfo);
          }
        } catch (error) {
          this.logger.warn(
            {
              err: error,
              line: node.startPosition.row + 1,
            },
            "Failed to extract call"
          );
        }
      }

      // Recurse into children
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) {
          processNode(child, currentCaller);
        }
      }
    };

    processNode(root);
    return calls;
  }

  /**
   * Extract information from a single call_expression node.
   *
   * @param node - The call_expression node
   * @param callerName - Name of the containing function/method
   * @returns CallInfo object or null if extraction fails
   */
  private extractCallInfo(node: Node, callerName?: string): CallInfo | null {
    // Get the function being called (the target of the call)
    const functionNode = node.childForFieldName("function");
    if (!functionNode) {
      return null;
    }

    // Extract the called name and expression
    const callTarget = this.extractCallTarget(functionNode);
    if (!callTarget) {
      return null;
    }

    // Check if this call is awaited
    const isAsync = node.parent?.type === "await_expression";

    return {
      calledName: callTarget.name,
      calledExpression: callTarget.expression,
      isAsync,
      line: node.startPosition.row + 1,
      column: node.startPosition.column,
      callerName,
    };
  }

  /**
   * Extract the name and expression from a call target.
   *
   * Handles different call patterns:
   * - Direct calls: foo()
   * - Method calls: obj.method()
   * - Chained calls: foo().bar()
   * - Computed calls: obj["method"]()
   *
   * @param node - The function node from call_expression
   * @returns Object with name and expression, or null
   */
  private extractCallTarget(node: Node): { name: string; expression: string } | null {
    // Simple identifier: foo()
    if (node.type === "identifier") {
      return {
        name: node.text,
        expression: node.text,
      };
    }

    // Member expression: obj.method() or obj["method"]()
    if (node.type === "member_expression") {
      const propertyNode = node.childForFieldName("property");
      const objectNode = node.childForFieldName("object");

      if (propertyNode && objectNode) {
        // For obj.method, name is "method", expression is "obj.method"
        const name = propertyNode.text;
        const expression = node.text;

        return { name, expression };
      }
    }

    // Subscript expression: obj["method"]() - dynamic property
    if (node.type === "subscript_expression") {
      const indexNode = node.childForFieldName("index");
      const objectNode = node.childForFieldName("object");

      if (indexNode && objectNode) {
        // Try to get static string index
        if (indexNode.type === "string") {
          // Remove quotes from string
          const name = indexNode.text.slice(1, -1);
          return {
            name,
            expression: node.text,
          };
        }
        // Dynamic index - use placeholder
        return {
          name: "[dynamic]",
          expression: node.text,
        };
      }
    }

    // Parenthesized expression: (foo)() or (obj.method)()
    if (node.type === "parenthesized_expression") {
      // Find the inner expression by iterating children to skip punctuation.
      // This is more robust than using index-based access (node.child(1))
      // as it doesn't assume a specific AST structure.
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child && child.type !== "(" && child.type !== ")") {
          return this.extractCallTarget(child);
        }
      }
    }

    // Call expression (chained): foo().bar() - the foo() part
    if (node.type === "call_expression") {
      // For chained calls, the full expression is complex
      // We return the whole text as both name and expression
      return {
        name: "[chained]",
        expression: node.text,
      };
    }

    // Optional chain: obj?.method()
    if (node.type === "optional_chain_expression") {
      const child = node.child(0);
      if (child) {
        return this.extractCallTarget(child);
      }
    }

    // Fallback for any other expression type
    // Use the text as both name and expression
    if (node.text) {
      return {
        name: node.text,
        expression: node.text,
      };
    }

    return null;
  }
}
