import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

/**
 * Read `.gitignore` and return its patterns, minus comments and negations.
 *
 * Use this wherever a tool needs gitignore-style ignore patterns at runtime —
 * ESLint (`ignores:`), custom linters, scripts — so nothing gitignored has to
 * be listed by hand again. Tools with native .gitignore support should use it
 * directly instead:
 *
 * - Prettier: `--ignore-path .gitignore`
 * - markdownlint-cli2: `"gitignore": true` in `.markdownlint-cli2.json`
 *
 * TypeScript projects are static JSON and cannot import this; their
 * `exclude` arrays mirror `.gitignore` (see tsconfig.json / tsconfig.check.json
 * / scripts/tsconfig.json).
 */
export function gitignorePatterns(): string[] {
  const file = path.join(root, ".gitignore");
  if (!existsSync(file)) {
    return [];
  }
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("!"));
}
