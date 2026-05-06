/**
 * Nested .gitignore filter for local-folder repositories.
 *
 * Walks the directory tree from a root path and collects every `.gitignore`
 * found, then exposes an `isIgnored(absoluteFilePath)` predicate that applies
 * each `.gitignore`'s rules with the same scoping git itself uses: a rule from
 * `<root>/.gitignore` matches paths relative to `<root>`, while a rule from
 * `<root>/sub/dir/.gitignore` matches paths relative to `<root>/sub/dir`. Rules
 * from a more deeply nested `.gitignore` take precedence over an ancestor's,
 * including support for negation (`!keep.txt`).
 *
 * The root-only `.gitignore` loader on `FileScanner` is preserved unchanged for
 * git-remote callers; this filter is opted into via
 * `ScanOptions.respectNestedGitignore` and is intended for `local-folder` and
 * `local-git` sources where users routinely have nested `.gitignore` files.
 *
 * Implementation note: each `.gitignore` produces its own `ignore()` instance
 * so we can evaluate them in deepest-first order without re-implementing
 * git's pattern semantics. Performance scales linearly with depth, which is
 * acceptable because local-folder trees are walked exactly twice per
 * registration / update (size pre-scan + actual scan).
 *
 * @module ingestion/gitignore-filter
 */

import ignore, { type Ignore } from "ignore";
import { readFile, readdir, stat } from "fs/promises";
import { join, resolve, relative, sep } from "path";
import { posix } from "path";
import { getComponentLogger } from "../logging/index.js";

interface NestedRule {
  /** Absolute path of the directory containing the .gitignore. */
  dir: string;
  /** Configured ignore() instance loaded with that file's rules. */
  ig: Ignore;
}

/**
 * Predicate-style filter that honors every `.gitignore` from a tree root
 * down to each candidate file.
 *
 * Construct with the static {@link load} factory; the constructor itself is
 * private (accessed via the factory). All path arguments to {@link isIgnored}
 * must be absolute and on the platform's native separator — the filter
 * normalizes internally.
 */
export class GitignoreFilter {
  private readonly rootPath: string;
  /**
   * Rules ordered from shallowest (root) to deepest. Evaluation walks this
   * list in order so deeper rules override shallower ones, matching git's
   * "last matching pattern wins" semantics within a directory and the
   * "deeper file overrides" semantics across directories.
   */
  private readonly rules: ReadonlyArray<NestedRule>;

  private constructor(rootPath: string, rules: ReadonlyArray<NestedRule>) {
    this.rootPath = rootPath;
    this.rules = rules;
  }

  /**
   * Walk `rootPath` discovering every `.gitignore` and load its rules.
   *
   * Directories whose own `.gitignore` already excludes them by their parent
   * are still traversed — an outer `.gitignore` ignoring `node_modules/` does
   * NOT prevent us from reading a `.gitignore` inside `node_modules`. The
   * skip happens at filtering time, not at discovery time. (We still skip
   * the literal `.git` directory because it has special semantics and never
   * carries a `.gitignore` we need to honor.)
   *
   * @param rootPath - Absolute path to the repository / folder root.
   */
  static async load(rootPath: string): Promise<GitignoreFilter> {
    const root = resolve(rootPath);
    const rules: NestedRule[] = [];
    await GitignoreFilter.collectRules(root, root, rules);
    rules.sort((a, b) => a.dir.length - b.dir.length);
    return new GitignoreFilter(root, rules);
  }

  /**
   * Recursively collect `.gitignore` rules under `currentDir`.
   *
   * Errors reading a single `.gitignore` (permissions, malformed UTF-8) are
   * logged and skipped — partial coverage is preferable to refusing to
   * scan the repo at all.
   */
  private static async collectRules(
    rootPath: string,
    currentDir: string,
    out: NestedRule[]
  ): Promise<void> {
    const gitignorePath = join(currentDir, ".gitignore");
    try {
      const content = await readFile(gitignorePath, "utf-8");
      const ig = ignore().add(content);
      out.push({ dir: currentDir, ig });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "EISDIR") {
        // Log and continue — do not throw; absent / unreadable .gitignore is fine.
        getComponentLogger("ingestion:gitignore-filter").debug(
          { gitignorePath, err },
          "Could not read .gitignore (continuing without it)"
        );
      }
    }

    let entries: string[];
    try {
      entries = await readdir(currentDir);
    } catch {
      return;
    }

    for (const name of entries) {
      if (name === ".git") continue;
      const childPath = join(currentDir, name);
      let isDir = false;
      try {
        const st = await stat(childPath);
        isDir = st.isDirectory();
      } catch {
        continue;
      }
      if (isDir) {
        await GitignoreFilter.collectRules(rootPath, childPath, out);
      }
    }
  }

  /**
   * Return `true` if `absoluteFilePath` is ignored by any `.gitignore` from
   * the root down to the file's directory.
   *
   * Paths outside `rootPath` are rejected as ignored — defense against
   * symlink escapes. Trailing-slash semantics for directory-only patterns
   * (`build/`) are delegated to the `ignore` package.
   */
  isIgnored(absoluteFilePath: string): boolean {
    const abs = resolve(absoluteFilePath);
    if (!GitignoreFilter.isWithin(this.rootPath, abs)) {
      return true;
    }

    // Git semantics: rules are evaluated from shallowest .gitignore down to
    // deepest, and the LAST .gitignore with an explicit verdict wins. A
    // negation (`!keep.txt`) in a nested .gitignore therefore overrides a
    // matching rule from a shallower one. Walk in reverse (deepest first) and
    // return as soon as some .gitignore has an explicit opinion on the file.
    for (let i = this.rules.length - 1; i >= 0; i--) {
      const rule = this.rules[i]!;
      if (!GitignoreFilter.isWithin(rule.dir, abs)) continue;
      const relToRule = posix.normalize(relative(rule.dir, abs).split(sep).join(posix.sep));
      if (!relToRule || relToRule.startsWith("..")) continue;
      const verdict = rule.ig.test(relToRule);
      if (verdict.ignored || verdict.unignored) {
        // unignored=true means a `!pattern` matched — keep the file.
        return verdict.ignored && !verdict.unignored;
      }
    }
    return false;
  }

  /**
   * Filter an array of absolute file paths to those NOT ignored.
   *
   * Convenience for callers (FileScanner, size guard) that already have a
   * batch in hand. Equivalent to `paths.filter((p) => !this.isIgnored(p))`.
   */
  filterAbsolute(absolutePaths: readonly string[]): string[] {
    return absolutePaths.filter((p) => !this.isIgnored(p));
  }

  /**
   * Number of `.gitignore` files discovered. Exposed for diagnostics and
   * tests; not part of any public contract.
   */
  get ruleFileCount(): number {
    return this.rules.length;
  }

  private static isWithin(parent: string, child: string): boolean {
    if (parent === child) return true;
    const rel = relative(parent, child);
    return Boolean(rel) && !rel.startsWith("..") && !rel.startsWith(`..${sep}`);
  }
}
