/**
 * Tree-sitter based AST parser for TypeScript and JavaScript.
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
  type ParseResult,
  type ParseError,
  type ParserConfig,
  DEFAULT_PARSER_CONFIG,
  getLanguageFromExtension,
  isSupportedExtension,
} from "./types.js";

/**
 * Node type to entity type mapping.
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
          parseTimeMs: performance.now() - startTime,
          errors,
          success: false,
        };
      }

      // Check for syntax errors
      if (tree.rootNode.hasError) {
        errors.push(...this.collectSyntaxErrors(tree.rootNode));
      }

      // Extract entities
      const entities = this.extractEntities(tree.rootNode, filePath);

      // Extract imports
      const imports = this.extractImports(tree.rootNode);

      // Extract exports
      const exports = this.extractExports(tree.rootNode);

      const parseTimeMs = performance.now() - startTime;

      this.logger.info(
        {
          metric: "parser.parse_file_ms",
          value: Math.round(parseTimeMs),
          filePath,
          entityCount: entities.length,
          importCount: imports.length,
          exportCount: exports.length,
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
  private extractEntities(root: Node, filePath: string): CodeEntity[] {
    const entities: CodeEntity[] = [];

    const processNode = (node: Node, isExported: boolean = false): void => {
      const entityType = NODE_TO_ENTITY_TYPE[node.type];

      if (entityType) {
        try {
          const entity = this.extractEntity(node, filePath, entityType, isExported);
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

      // Check for export wrapper
      if (node.type === "export_statement") {
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
    isExported: boolean
  ): CodeEntity | null {
    // Get entity name
    const name = this.extractEntityName(node, entityType);
    if (!name && !this.config.includeAnonymous) {
      return null;
    }

    // Build metadata
    const metadata = this.extractMetadata(node, entityType);

    return {
      type: entityType,
      name: name ?? "<anonymous>",
      filePath,
      lineStart: node.startPosition.row + 1,
      lineEnd: node.endPosition.row + 1,
      columnStart: node.startPosition.column,
      columnEnd: node.endPosition.column,
      isExported,
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

  /**
   * Extract imports from the parse tree.
   */
  private extractImports(root: Node): ImportInfo[] {
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
  private extractExports(root: Node): ExportInfo[] {
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
}
