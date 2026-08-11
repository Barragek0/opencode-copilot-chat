// ESLint flat config — strict where it catches real bugs, quiet where it
// would only add ceremony.
//
// Stack:
//   - typescript-eslint `strict` + `strictTypeChecked`:
//       type-aware correctness rules (no-unsafe-*, no-unnecessary-condition,
//       ...). The pure-stylistic layer (`stylistic`) is deliberately NOT
//       enabled — it fights the formatter (prettier owns formatting) and its
//       rules (array-type, consistent-type-definitions, prefer-for-of, ...)
//       produced churn without catching bugs.
//   - eslint-plugin-yml `flat/standard`: strict YAML linting.
//   - eslint-plugin-jsonc `flat/recommended-with-jsonc`: strict JSON/JSONC.
//
// Zero tolerance: every violation is an error; warnings are turned into errors
// via `--max-warnings 0`. The only rules disabled here are ones whose noise
// outweighs their value (see the scoped overrides below).

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
const nonProjectFiles = ["eslint.config.mjs", "scripts/*.js", "scripts/*.mjs", "scripts/*.ts"];

// The typescript-eslint `config()` helper is deprecated; ESLint core now
// provides `defineConfig()`. We replicate the helper's `extends` expansion
// explicitly by applying the TS `files` glob to each config object.
const tsFiles = ["**/*.{ts,mts,cts,js,mjs,cjs}"];
const testFiles = ["**/*.test.{ts,tsx,js,mjs,cjs}"];

export default defineConfig([
  {
    ignores: gitignore,
  },
  // --- TypeScript / JavaScript: strict type-aware rules --------------------
  ...tseslint.configs.strict.map((conf) => ({ ...conf, files: tsFiles })),
  ...tseslint.configs.strictTypeChecked.map((conf) => ({ ...conf, files: tsFiles })),
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
      // Numbers and booleans interpolate unambiguously; requiring `String()`
      // around them is noise, not safety.
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        {
          allowNumber: true,
          allowBoolean: true,
        },
      ],
    },
  },
  {
    // node:test's describe/it are scheduled by the test runner; the returned
    // promise is handled there, so the `void`/`await` ceremony adds nothing.
    files: testFiles,
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
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
