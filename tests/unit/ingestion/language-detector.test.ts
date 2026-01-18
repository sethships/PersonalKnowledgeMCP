/**
 * Unit tests for language-detector module.
 *
 * Tests the detectLanguage function and SUPPORTED_LANGUAGES constant
 * for correct language detection from file paths.
 */

import { describe, test, expect } from "bun:test";
import {
  detectLanguage,
  SUPPORTED_LANGUAGES,
  type ProgrammingLanguage,
} from "../../../src/ingestion/language-detector.js";

describe("language-detector", () => {
  describe("detectLanguage", () => {
    describe("TypeScript detection", () => {
      test("detects .ts files as typescript", () => {
        expect(detectLanguage("src/utils/auth.ts")).toBe("typescript");
        expect(detectLanguage("index.ts")).toBe("typescript");
        expect(detectLanguage("path/to/deep/file.ts")).toBe("typescript");
      });

      test("detects .tsx files as tsx", () => {
        expect(detectLanguage("components/Button.tsx")).toBe("tsx");
        expect(detectLanguage("app/page.tsx")).toBe("tsx");
        expect(detectLanguage("src/App.tsx")).toBe("tsx");
      });

      test("handles uppercase TypeScript extensions", () => {
        expect(detectLanguage("file.TS")).toBe("typescript");
        expect(detectLanguage("file.TSX")).toBe("tsx");
        expect(detectLanguage("file.Ts")).toBe("typescript");
        expect(detectLanguage("file.Tsx")).toBe("tsx");
      });
    });

    describe("JavaScript detection", () => {
      test("detects .js files as javascript", () => {
        expect(detectLanguage("lib/helpers.js")).toBe("javascript");
        expect(detectLanguage("index.js")).toBe("javascript");
        expect(detectLanguage("scripts/build.js")).toBe("javascript");
      });

      test("detects .mjs files as javascript", () => {
        expect(detectLanguage("module.mjs")).toBe("javascript");
        expect(detectLanguage("lib/esm/index.mjs")).toBe("javascript");
      });

      test("detects .cjs files as javascript", () => {
        expect(detectLanguage("config.cjs")).toBe("javascript");
        expect(detectLanguage("lib/commonjs/index.cjs")).toBe("javascript");
      });

      test("detects .jsx files as jsx", () => {
        expect(detectLanguage("app/page.jsx")).toBe("jsx");
        expect(detectLanguage("components/Header.jsx")).toBe("jsx");
        expect(detectLanguage("src/index.jsx")).toBe("jsx");
      });

      test("handles uppercase JavaScript extensions", () => {
        expect(detectLanguage("file.JS")).toBe("javascript");
        expect(detectLanguage("file.JSX")).toBe("jsx");
        expect(detectLanguage("file.MJS")).toBe("javascript");
        expect(detectLanguage("file.CJS")).toBe("javascript");
      });
    });

    describe("Java detection", () => {
      test("detects .java files as java", () => {
        expect(detectLanguage("src/main/java/App.java")).toBe("java");
        expect(detectLanguage("Main.java")).toBe("java");
        expect(detectLanguage("com/example/service/UserService.java")).toBe("java");
      });

      test("handles uppercase Java extensions", () => {
        expect(detectLanguage("file.JAVA")).toBe("java");
        expect(detectLanguage("file.Java")).toBe("java");
      });
    });

    describe("Go detection", () => {
      test("detects .go files as go", () => {
        expect(detectLanguage("main.go")).toBe("go");
        expect(detectLanguage("cmd/server/main.go")).toBe("go");
        expect(detectLanguage("pkg/utils/helpers.go")).toBe("go");
      });

      test("handles uppercase Go extension", () => {
        expect(detectLanguage("file.GO")).toBe("go");
        expect(detectLanguage("file.Go")).toBe("go");
      });
    });

    describe("C detection", () => {
      test("detects .c files as c", () => {
        expect(detectLanguage("main.c")).toBe("c");
        expect(detectLanguage("src/utils.c")).toBe("c");
        expect(detectLanguage("lib/helpers.c")).toBe("c");
      });

      test("detects .h files as c", () => {
        expect(detectLanguage("include/header.h")).toBe("c");
        expect(detectLanguage("utils.h")).toBe("c");
      });

      test("handles uppercase C extensions", () => {
        expect(detectLanguage("file.C")).toBe("c");
        expect(detectLanguage("file.H")).toBe("c");
      });
    });

    describe("C++ detection", () => {
      test("detects .cpp files as cpp", () => {
        expect(detectLanguage("main.cpp")).toBe("cpp");
        expect(detectLanguage("src/utils.cpp")).toBe("cpp");
        expect(detectLanguage("lib/helpers.cpp")).toBe("cpp");
      });

      test("detects .cc files as cpp", () => {
        expect(detectLanguage("main.cc")).toBe("cpp");
        expect(detectLanguage("src/utils.cc")).toBe("cpp");
      });

      test("detects .cxx files as cpp", () => {
        expect(detectLanguage("main.cxx")).toBe("cpp");
        expect(detectLanguage("src/utils.cxx")).toBe("cpp");
      });

      test("detects .hpp files as cpp", () => {
        expect(detectLanguage("include/header.hpp")).toBe("cpp");
        expect(detectLanguage("utils.hpp")).toBe("cpp");
      });

      test("detects .hxx files as cpp", () => {
        expect(detectLanguage("include/header.hxx")).toBe("cpp");
        expect(detectLanguage("utils.hxx")).toBe("cpp");
      });

      test("handles uppercase C++ extensions", () => {
        expect(detectLanguage("file.CPP")).toBe("cpp");
        expect(detectLanguage("file.CC")).toBe("cpp");
        expect(detectLanguage("file.CXX")).toBe("cpp");
        expect(detectLanguage("file.HPP")).toBe("cpp");
        expect(detectLanguage("file.HXX")).toBe("cpp");
      });
    });

    describe("unknown language detection", () => {
      test("returns unknown for non-supported extensions", () => {
        expect(detectLanguage("config.json")).toBe("unknown");
        expect(detectLanguage("README.md")).toBe("unknown");
        expect(detectLanguage("style.css")).toBe("unknown");
      });

      test("returns unknown for files without extension", () => {
        expect(detectLanguage("Makefile")).toBe("unknown");
        expect(detectLanguage("Dockerfile")).toBe("unknown");
        expect(detectLanguage(".gitignore")).toBe("unknown");
      });

      test("returns unknown for empty path", () => {
        expect(detectLanguage("")).toBe("unknown");
      });

      test("returns unknown for path ending with dot", () => {
        expect(detectLanguage("file.")).toBe("unknown");
      });
    });

    describe("path handling", () => {
      test("handles absolute paths", () => {
        expect(detectLanguage("/home/user/project/src/index.ts")).toBe("typescript");
        expect(detectLanguage("C:\\Users\\dev\\project\\index.js")).toBe("javascript");
      });

      test("handles paths with multiple dots", () => {
        expect(detectLanguage("file.test.ts")).toBe("typescript");
        expect(detectLanguage("component.spec.tsx")).toBe("tsx");
        expect(detectLanguage("config.local.js")).toBe("javascript");
        expect(detectLanguage("style.module.jsx")).toBe("jsx");
      });

      test("handles paths with special characters", () => {
        expect(detectLanguage("src/@types/index.ts")).toBe("typescript");
        expect(detectLanguage("node_modules/pkg/index.js")).toBe("javascript");
      });
    });
  });

  describe("SUPPORTED_LANGUAGES", () => {
    test("contains all supported languages", () => {
      expect(SUPPORTED_LANGUAGES).toContain("typescript");
      expect(SUPPORTED_LANGUAGES).toContain("tsx");
      expect(SUPPORTED_LANGUAGES).toContain("javascript");
      expect(SUPPORTED_LANGUAGES).toContain("jsx");
      expect(SUPPORTED_LANGUAGES).toContain("java");
      expect(SUPPORTED_LANGUAGES).toContain("go");
      expect(SUPPORTED_LANGUAGES).toContain("python");
      expect(SUPPORTED_LANGUAGES).toContain("rust");
      expect(SUPPORTED_LANGUAGES).toContain("csharp");
      expect(SUPPORTED_LANGUAGES).toContain("c");
      expect(SUPPORTED_LANGUAGES).toContain("cpp");
    });

    test("does not contain unknown", () => {
      expect(SUPPORTED_LANGUAGES).not.toContain("unknown");
    });

    test("has exactly 11 languages", () => {
      expect(SUPPORTED_LANGUAGES).toHaveLength(11);
    });

    test("is readonly", () => {
      // TypeScript should prevent modification, but we can verify structure
      expect(Object.isFrozen(SUPPORTED_LANGUAGES)).toBe(false); // as const doesn't freeze
      expect(Array.isArray(SUPPORTED_LANGUAGES)).toBe(true);
    });
  });

  describe("ProgrammingLanguage type", () => {
    test("all detected languages are valid ProgrammingLanguage values", () => {
      const testCases: Array<{ path: string; expected: ProgrammingLanguage }> = [
        { path: "file.ts", expected: "typescript" },
        { path: "file.tsx", expected: "tsx" },
        { path: "file.js", expected: "javascript" },
        { path: "file.jsx", expected: "jsx" },
        { path: "file.java", expected: "java" },
        { path: "file.go", expected: "go" },
        { path: "file.py", expected: "python" },
        { path: "file.rs", expected: "rust" },
        { path: "file.cs", expected: "csharp" },
        { path: "file.c", expected: "c" },
        { path: "file.h", expected: "c" },
        { path: "file.cpp", expected: "cpp" },
        { path: "file.hpp", expected: "cpp" },
        { path: "file.json", expected: "unknown" },
      ];

      testCases.forEach(({ path, expected }) => {
        const result: ProgrammingLanguage = detectLanguage(path);
        expect(result).toBe(expected);
      });
    });
  });
});
