# PR #110 — Husky + ESLint + Prettier + Markdownlint Pre-commit Stack

**Date:** 2026-08-06
**Status:** ✅ Merged (merge commit `6d0522a`, 2026-08-06T18:53:16Z)
**Related:** PR [#110](https://github.com/ltmoerdani/opencode-copilot-chat/pull/110)
**Author:** [@Fahad090NP](https://github.com/Fahad090NP)
**Branch:** `chore/tooling`
**Predecessor:** PR [#107](https://github.com/ltmoerdani/opencode-copilot-chat/pull/107) (scope split — original submission bundled tooling with the retry fix; maintainer requested a separate PR)
**Follow-up:** PR [#114](https://github.com/ltmoerdani/opencode-copilot-chat/pull/114) (format codemod)

## What

Developer tooling + docs baseline for the repo:

- **Husky + lint-staged** pre-commit hook running `eslint --fix`, `prettier`, and `markdownlint-cli2 --fix` on staged files.
- **ESLint flat config** (`eslint.config.mjs`) using `typescript-eslint` recommended preset, with ignore list read from `.gitignore`.
- **Prettier** config kept in `.prettierrc.json` (single source, inherited from PR #108). A duplicate `"prettier"` block in `package.json` was dropped during review.
- **Markdownlint** (`.markdownlint.json`) with `MD013` (line-length) off; further rule relaxations landed in PR #114.
- **tsconfig** scoped to `src` via `"include": ["src"]`, so `tsc -p ./` no longer tries to compile the gitignored `inspirations/` reference folder or `scripts/`.
- **CONTRIBUTING.md** — agent/AI-contributor workflow guidance folded in (6 "Workflow expectations" bullets: think first, surgical changes, fix root causes, no bulk automation, self-review, verify before claiming done).
- **`prepare` script** (`husky`) so the pre-commit hook installs automatically on `npm install`.

## Review Notes

Six points raised during review, all addressed in commit `4c43b10`:

1. **Prettier config conflict** — `package.json` had a `"prettier": {"trailingComma": "none"}` block that contradicted `.prettierrc.json` (`trailingComma: "all"` from #108). Dropped the package.json block; `.prettierrc.json` is now the single source.
2. **"3167 problems" lint count** — verified locally as **48 problems (47 errors, 1 warning)** after scoping. The 3167 figure came from eslint scanning an untracked local `inspirations/` folder. PR description corrected.
3. **98 files fail format:check** — agreed to land a one-shot format codemod PR (#114) before this PR's hook goes live, so the hook never trips on a stale file. PR description updated.
4. **Branch rebased on main** — picked up `.prettierrc.json` from #108, resolving the P1 conflict visibly.
5. **"AGENTS.md dropped"** — `AGENTS.md` never existed in the repo; description wording corrected. CONTRIBUTING.md additions kept.
6. **7 npm audit vulnerabilities** — `npm audit fix` applied; 0 vulnerabilities remaining.

## Verification

- `npm run compile` → passes.
- `npm test` → 133/133 pass.
- `npm run lint` → 48 problems (47 errors, 1 warning). Baseline; fix-up PR scoped to these will follow.
- `npm run format:check` → 98 files flagged (pre-codemod baseline).
- `npm audit` → 0 vulnerabilities.
- Husky `.husky/pre-commit` installed and executable; `prepare` script auto-runs on install.

## Files Changed

- `.husky/pre-commit` (new) — `npx lint-staged`.
- `.markdownlint.json` (new) — `MD013` off.
- `CONTRIBUTING.md` — "Workflow expectations" section + table reformatting.
- `eslint.config.mjs` (new) — flat config with `typescript-eslint` recommended + gitignore ignores.
- `package.json` — `lint`, `lint:js`, `lint:fix`, `lint:md`, `format`, `format:check`, `prepare` scripts; `lint-staged` config block; devDependencies (`eslint`, `husky`, `lint-staged`, `markdownlint-cli2`, `prettier`, `typescript-eslint`).
- `tsconfig.json` — `"include": ["src"]`.
- `package-lock.json` — dependency install.

## Sequencing

The pre-commit hook goes live the moment this PR lands. To avoid the hook blocking the next contributor who touches one of the 98 unformatted files, the format codemod (PR #114) was merged shortly after, back-to-back.

## References

- PR: [#110](https://github.com/ltmoerdani/opencode-copilot-chat/pull/110)
- Predecessor (scope split): [#107](https://github.com/ltmoerdani/opencode-copilot-chat/pull/107)
- Follow-up (codemod): [#114](https://github.com/ltmoerdani/opencode-copilot-chat/pull/114)
- Related config PR: [#108](https://github.com/ltmoerdani/opencode-copilot-chat/pull/108) (`.prettierrc.json`)
