import tseslint from "typescript-eslint";
import { readGitignorePatterns } from "./scripts/gitignore-patterns.mjs";

export default tseslint.config(
  {
    // Ignore everything `.gitignore` ignores (tmp/, out/, generated scripts,
    // …) so linting stays in sync with the repo's ignore rules at runtime.
    ignores: readGitignorePatterns(),
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: ["**/*.d.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
