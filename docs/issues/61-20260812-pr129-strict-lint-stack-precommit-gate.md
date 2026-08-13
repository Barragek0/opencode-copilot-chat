**Status:** ✅ Solved (merged, merge commit `a960694`, 2026-08-12T07:17:41Z)

# PR #129 — Strict-but-Sane Lint Stack + Intelligent Pre-Commit Gate

**Topic:** tooling / linting / eslint / pre-commit / husky / typescript / ci
**Updated:** 2026-08-13
**Tags:** #tooling #linting #eslint #pre-commit #husky #typescript #ci #community-pr
**Related:** PR [#129](https://github.com/ltmoerdani/opencode-copilot-chat/pull/129) (by [@Fahad090NP](https://github.com/Fahad090NP))
**Branch:** `chore/strict-lint` (merged into `main` via `a960694`)
**Supersedes:** —
**Sequence:** follows PR #114 (prettier + markdownlint codemod) and the husky/eslint toolchain merge in PR #110.

> **Maintainer verification note (2026-08-13):** the final merged state (20 commits) was independently verified before merge: `npm ci && npm run lint` all 7 steps green, staged-lint gate measured (~0.6s docs-only, ~8s `src/`), `void describe/it/test` = 0 across `src/test/`, `@ts-expect-error` allowed, zero `.mjs`/`.mts` in the repo. See [Post-Review Refinements](#post-review-refinements-final-5-commits) below.

---

## Overview

PR #129 (+3450/−944, 90 files changed) is a tooling-only overhaul that brings two quality levers to the project: (1) a strict-but-sane ESLint stack that keeps the type-aware rules which catch real bugs while dropping the stylistic layer that fought prettier, and (2) an **intelligent pre-commit gate** that lints exactly what a change can affect (staged files + their direct import dependents) instead of either the whole tree (slow) or only the staged files (blind). No runtime behavior change, no shipped-user-visible effect.

The branch was rebased onto `main` (including the 0.5.2 release cut) before merging, with docs re-formatted to pass the new strict checks.

---

## Problem

### 1. Lint stack fought itself

- `typescript-eslint` `strictTypeChecked` was mixed with a pure-`stylistic` layer (array-type, consistent-type-definitions, prefer-for-of) that fought prettier formatting and produced churn without catching bugs.
- `restrict-template-expressions` rejected numbers/booleans (noisy in logging).
- `no-floating-promises` ran on test files, but `node:test`'s runner handles those promises.

### 2. Pre-commit was either slow or blind

The previous husky hook ran the full-tree lint on every commit (slow, ~30s+) or only the staged files (blind to type-aware breakage in consumers of a changed module). Changing a module signature could leave type errors in its importers that only surfaced in CI.

---

## Solution

### 1. ESLint: keep type-aware strictness, drop style-only rules (`ffce99d`)

- **Kept:** `strict` + `strictTypeChecked` (the bug-catchers: `no-unsafe-*`, `no-unnecessary-condition`, `no-floating-promises`).
- **Dropped:** the pure-`stylistic` layer that churned against prettier.
- `restrict-template-expressions` now allows numbers/booleans.
- `no-floating-promises` is off for `*.test.*` (node:test handles those).
- YAML/JSONC config linters, zero-tolerance `no-warning-comments`, `.gitignore`-derived ignores all retained.

### 2. Lint now runs unit tests (`a84402a`)

`npm run lint` / `bun lint` ends with a Tests step (compile + unit tests). The 7 steps:

```text
✔ Editorconfig  ✔ ESLint  ✔ Markdown  ✔ Prettier  ✔ Shell  ✔ TypeScript  ✔ Tests
```

So the `lint` script is now the project's single "is everything green" command.

### 3. Intelligent pre-commit gate (`a4ef449`, `6cf7714`)

New `scripts/staged-lint.ts` (final name; was `scripts/staged-lint.js` before the post-review `.ts` pass. Also exposed as `npm run lint:staged`). Instead of linting the whole tree or only staged files, it lints exactly what a change can affect:

| Linter                                   | Scope                                                                                                                      |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| ESLint                                   | staged JS/TS files **plus their direct dependents** (files that import a staged file, resolved from the real import graph) |
| markdownlint / editorconfig / shellcheck | staged files only                                                                                                          |
| `tsc` check + unit tests                 | only when `src/` or `scripts/` changed                                                                                     |
| Formatting (prettier)                    | stays with lint-staged, runs after the gate                                                                                |

**Dependent detection:** changing a module triggers a re-lint of every file that imports it, so a type-aware rule break in a consumer can never slip past the hook.

**Measured performance:**

- Commit touching only config/hook files: ~1s
- Commit touching `src/`: ~10s
- Full-tree lint remains in CI and on demand via `npm run lint`.

### 4. Branch history (previously unmerged toolchain)

The branch also carries the earlier tooling overhaul that had not been merged as its own PR:

- Unified `scripts/lint.js` / `format.js` runners (picocolors output).
- Script renames: `*.mjs`/`*.mts` → `*.js`/`*.ts`.
- `editorconfig-checker` + `shellcheck` + `tsconfig.check.json` type-check.
- Zero-tolerance formatting.
- Dev-dependency bumps: eslint 10.8.1, `@types/node` 26.2.
- Husky PATH fixes (so the hook finds the toolchain on macOS/Linux without a login shell).

> **Note:** the `@types/node` bump to 26.2 in this branch supersedes the open dependabot PR #91 (`@types/node` 26.1.0 → 26.1.2). After #129 merged, #91 is effectively moot and can be closed.

---

## Verification

| Check                                        | Result                                                   |
| -------------------------------------------- | -------------------------------------------------------- |
| `npm run lint` (all 7 steps)                 | ✅ green (incl. 180 unit tests at merge time)            |
| Pre-commit gate (config-only commit)         | ✅ ~1s (independently re-measured ~0.6s)                 |
| Pre-commit gate (`src/` commit)              | ✅ ~10s (independently re-measured ~8s)                  |
| Dependent detection                          | ✅ verified (changing a module re-lints importers)       |
| Merge onto latest `main` (0.5.2 release cut) | ✅ no conflicts; docs re-formatted to pass strict checks |

### Maintainer-side verification (2026-08-13)

Independently reproduced in an isolated worktree against the final 20-commit head (`c817871`, merged as `a960694`):

| Check                                     | Result                                                |
| ----------------------------------------- | ----------------------------------------------------- |
| `npm ci` + `npm run lint` (7 steps)       | ✅ green on final head                                |
| Staged gate, docs-only change             | ✅ ~0.57s, correctly catches markdownlint violations  |
| Staged gate, `src/` change                | ✅ ~8.3s, runs ESLint + tsc + tests                   |
| `void describe/it/test` in `src/test/`    | ✅ 0 occurrences (dropped in `22e04b7`)               |
| `@ts-expect-error` in eslint config       | ✅ allowed (kept `@ts-ignore` banned)                 |
| `.mjs`/`.mts` files in repo               | ✅ 0 (final state is `.ts`/`.json` only)              |
| eslint on test file without `void` prefix | ✅ exit 0 (`no-floating-promises` off for `*.test.*`) |

---

## Post-Review Refinements (final 5 commits)

After the initial 15-commit branch, maintainer review surfaced three points and the contributor addressed all of them plus two config-consistency commits before merge (final: 20 commits):

| Commit    | Change                                                                                                                                                                                                                                                                                                       | Review point addressed               |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| `22e04b7` | Dropped all **217 `void describe/it/test` prefixes** across 15 test files. `no-floating-promises` is off for `*.test.*`, so the prefix was pure ceremony that contradicted the "ceremony is gone" narrative.                                                                                                 | #1 (void ceremony)                   |
| `5246434` | **Allowed `@ts-expect-error`** in `no-warning-comments` (kept `@ts-ignore` banned). Rationale: this extension leans on VS Code proposed APIs (`chatProvider.d.ts`, `languageModelThinkingPart.d.ts`) whose type gaps are real; `@ts-expect-error` self-heals the moment the API lands.                       | #3 (`@ts-expect-error` escape hatch) |
| `76570cc` | **Prefer TypeScript over JavaScript everywhere.** `eslint.config.ts` replaces `.mjs`; remaining `.js` scripts became typed `.ts` (`lint.ts`, `format.ts`, `staged-lint.ts`, `run-unit-tests.ts`). `tsx` added as devDependency so `.ts` scripts run on any Node (CI runs Node 20, no native type-stripping). | Config consistency                   |
| `514a63f` | Standard file extensions everywhere (`.ts`/`.js`, never `.mjs`/`.mts`).                                                                                                                                                                                                                                      | Config consistency                   |
| `c817871` | Renamed `.markdownlint-cli2.jsonc` → `.markdownlint-cli2.json` (file has no comments, so `.json` is the honest extension); references updated across `package.json`, `lint.ts`, `staged-lint.ts`, `.vscodeignore`; empty `.markdownlint/rules/` removed.                                                     | Config consistency                   |

**Net final state:** the repo is now TypeScript (`.ts`) for all source and scripts, JSON for configs, zero `.js`/`.mjs`/`.mts` anywhere.

> **Note on review point #2 ("2 failing reasoningHistory tests"):** contributor clarified this was a development-time artifact (first draft asserted `"think step 1"` instead of `"think \nstep\n 1"`, expectations fixed before commit), so there was no committed red that lint rescued. The honest value remains: `lint` previously never ran tests, which is exactly why it now does.

---

## Files of Interest

| Path                      | Role                                                                                                      |
| ------------------------- | --------------------------------------------------------------------------------------------------------- |
| `eslint.config.ts`        | strict-but-sane config (`strict` + `strictTypeChecked`, no stylistic layer; `.ts` since post-review pass) |
| `scripts/staged-lint.ts`  | intelligent pre-commit gate (staged files + import dependents)                                            |
| `scripts/lint.ts`         | unified lint runner (7 steps, picocolors output)                                                          |
| `scripts/format.ts`       | unified format runner                                                                                     |
| `tsconfig.check.json`     | standalone type-check (separate from the build `tsconfig.json`); type-checks `scripts/`                   |
| `.husky/pre-commit`       | calls `lint:staged` instead of the full-tree lint                                                         |
| `.markdownlint-cli2.json` | markdownlint config (renamed from `.jsonc` in `c817871`)                                                  |
| `package.json`            | `lint` script ends with Tests step; new `lint:staged` script; `tsx` devDependency for `.ts` scripts       |

---

## Related Work

- PR [#114](https://github.com/ltmoerdani/opencode-copilot-chat/pull/114) — the earlier prettier + markdownlint codemod that established the formatting baseline this PR builds on. Issue doc [`54-20260808-pr114-format-codemod-merge.md`](54-20260808-pr114-format-codemod-merge.md).
- PR [#110](https://github.com/ltmoerdani/opencode-copilot-chat/pull/110) — husky + eslint toolchain. Issue doc [`52-20260806-pr110-husky-eslint-toolchain-merge.md`](52-20260806-pr110-husky-eslint-toolchain-merge.md).
- Dependabot [#91](https://github.com/ltmoerdani/opencode-copilot-chat/pull/91) — `@types/node` patch; effectively superseded by the bump inside this PR. Safe to close.
