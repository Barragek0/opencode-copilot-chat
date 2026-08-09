// ESLint flat config — MAXIMUM strictness.
//
// Stack (strictest available for each layer):
//   - typescript-eslint `strict` + `strictTypeChecked` + `stylistic`:
//       type-aware rules (no-unsafe-*, no-unnecessary-condition, ...),
//       strict correctness rules, and stylistic consistency.
//   - eslint-plugin-yml `flat/standard`: strict YAML linting.
//   - eslint-plugin-jsonc `flat/recommended-with-jsonc`: strict JSON/JSONC.
//
// Zero tolerance: every violation is an error; warnings are turned into errors
// via `--max-warnings 0` in package.json. Nothing is disabled here except what
// the strict stacks themselves permit.

import { readFileSync } from "node:fs";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import yml from "eslint-plugin-yml";
import jsonc from "eslint-plugin-jsonc";

const gitignore = readFileSync(new URL(".gitignore", import.meta.url), "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#") && !line.startsWith("!"));

// Files not covered by tsconfig (which only includes src/), type-checked via
// the default project so strictTypeChecked rules still apply to them.
const nonProjectFiles = ["eslint.config.mjs", "scripts/*.js", "scripts/*.mjs", "scripts/*.mts"];

// The typescript-eslint `config()` helper is deprecated; ESLint core now
// provides `defineConfig()`. We replicate the helper's `extends` expansion
// explicitly by applying the TS `files` glob to each config object.
const tsFiles = ["**/*.{ts,mts,cts,js,mjs,cjs}"];

export default defineConfig([
  {
    ignores: gitignore,
  },
  // --- TypeScript / JavaScript: strictest type-aware rules -----------------
  ...tseslint.configs.strict.map((conf) => ({ ...conf, files: tsFiles })),
  ...tseslint.configs.strictTypeChecked.map((conf) => ({ ...conf, files: tsFiles })),
  ...tseslint.configs.stylistic.map((conf) => ({ ...conf, files: tsFiles })),
  {
    files: tsFiles,
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: nonProjectFiles,
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Parameters required by an interface/callback signature but unused in
      // an implementation are conventionally prefixed with `_` to signal
      // intentional non-use (TypeScript convention, used by typescript-eslint
      // recommended config). We cannot remove them without breaking the
      // interface conformance, so honor the `_` prefix instead of disabling
      // the rule.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  // --- YAML: strict rules from eslint-plugin-yml ---------------------------
  ...yml.configs["flat/standard"],
  // --- JSON / JSONC: strict rules from eslint-plugin-jsonc -----------------
  ...jsonc.configs["flat/recommended-with-jsonc"],
  // --- Repo-wide hard rules ------------------------------------------------
  {
    rules: {
      // Zero tolerance: no unfinished-work marker comments may ever be committed.
      "no-warning-comments": [
        "error",
        {
          terms: ["todo", "fixme", "xxx", "hack", "@ts-ignore", "@ts-expect-error"],
          location: "anywhere",
        },
      ],
    },
  },
]);
