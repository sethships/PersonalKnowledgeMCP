/**
 * Test fixtures for file chunker tests.
 *
 * Provides sample file content and helper functions for creating test data.
 */

import type { FileInfo } from "../../src/ingestion/types.js";

/**
 * Small file content that fits in a single chunk.
 *
 * ~6 lines, ~100 characters
 */
export const SMALL_FILE_CONTENT = `import express from 'express';

const app = express();

app.listen(3000);
console.log('Server started');`;

/**
 * Empty file content.
 */
export const EMPTY_FILE_CONTENT = "";

/**
 * Whitespace-only file content.
 */
export const WHITESPACE_ONLY_CONTENT = "   \n\n  \n  \t\n";

/**
 * Single very long line that exceeds typical chunk limits.
 *
 * ~3000 characters (750 estimated tokens)
 */
export const LONG_SINGLE_LINE = "a".repeat(3000);

/**
 * Medium file content for testing multiple chunks.
 *
 * ~50 lines, ~1500 characters (enough for 2-3 chunks at default settings)
 */
export const MEDIUM_FILE_CONTENT = `/**
 * User authentication middleware.
 */
import express from 'express';
import jwt from 'jsonwebtoken';
import { UserModel } from '../models/User.js';

const router = express.Router();

/**
 * Login endpoint.
 */
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await UserModel.findOne({ email });

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isValid = await user.comparePassword(password);

    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET);

    res.json({ token, user: { id: user.id, email: user.email } });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Register endpoint.
 */
router.post('/register', async (req, res) => {
  const { email, password, name } = req.body;

  try {
    const existing = await UserModel.findOne({ email });

    if (existing) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const user = await UserModel.create({ email, password, name });

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET);

    res.json({ token, user: { id: user.id, email: user.email } });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;`;

/**
 * Large file content for testing chunk limits.
 *
 * Generates ~200 lines of code (enough to trigger multiple chunks and test limits)
 */
export function generateLargeFileContent(lineCount: number = 200): string {
  const lines: string[] = [
    "/**",
    " * Auto-generated test file.",
    " */",
    "",
    "export class TestClass {",
  ];

  for (let i = 0; i < lineCount; i++) {
    lines.push(`  // Line ${i + 1}`);
    lines.push(`  method${i}() {`);
    lines.push(`    return "result-${i}";`);
    lines.push(`  }`);
    lines.push("");
  }

  lines.push("}");

  return lines.join("\n");
}

/**
 * File content with Windows line endings (\r\n).
 */
export const WINDOWS_LINE_ENDINGS_CONTENT =
  "line 1\r\nline 2\r\nline 3\r\nline 4\r\n";

/**
 * File content with no final newline.
 */
export const NO_FINAL_NEWLINE_CONTENT = "line 1\nline 2\nline 3";

/**
 * File content with Unicode characters.
 */
export const UNICODE_CONTENT = `// 中文注释
const greeting = "Hello 世界";
const emoji = "🚀 🎉 ✨";

function test() {
  console.log(greeting);
  console.log(emoji);
}`;

/**
 * Create a mock FileInfo object for testing.
 *
 * Provides sensible defaults that can be overridden.
 *
 * @param overrides - Partial FileInfo to override defaults
 * @returns Complete FileInfo object
 */
export function createMockFileInfo(
  overrides?: Partial<FileInfo>
): FileInfo {
  return {
    relativePath: "src/test.ts",
    absolutePath: "/repo/src/test.ts",
    extension: ".ts",
    sizeBytes: 1024,
    modifiedAt: new Date("2024-12-11T10:00:00Z"),
    ...overrides,
  };
}
