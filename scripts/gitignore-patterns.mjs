import { readFileSync } from "node:fs";

/**
 * Read `.gitignore` and return its patterns as an array suitable for tools
 * that accept gitignore-style patterns (ESLint flat config `ignores`).
 *
 * This is the single source of truth for "which files are temporary /
 * generated / excluded", so every linter and formatter that supports
 * gitignore-style patterns should derive its ignores from here (or point
 * straight at `.gitignore` itself) instead of maintaining a parallel,
 * drifting ignore list:
 *
 * - ESLint: `ignores: readGitignorePatterns()` (this module).
 * - Prettier: `--ignore-path .gitignore` (native gitignore parsing).
 * - markdownlint-cli2: `gitignore: true` in `.markdownlint-cli2.jsonc`
 *   (native gitignore parsing, including nested `.gitignore` files).
 *
 * CONTRACT:
 * - Blank lines and `#` comments are dropped.
 * - `!` negations are dropped: ESLint's flat-config `ignores` handles them
 *   differently from git (relative vs. anchored semantics), and this
 *   repository's `.gitignore` does not use negations.
 * - Lines are trimmed so accidental leading/trailing whitespace can't
 *   silently disable an ignore rule.
 */
export function readGitignorePatterns(file = ".gitignore") {
  return readFileSync(new URL(`../${file}`, import.meta.url), "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("!"));
}
