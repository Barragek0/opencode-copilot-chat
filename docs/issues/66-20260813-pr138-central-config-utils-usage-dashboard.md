**Status:** ✅ Solved

# PR #138 — Central Config + Shared Utils + Usage Dashboard (merged)

**Topic:** refactor / usage / dashboard / autocomplete / bug-fixes / provider
**Updated:** 2026-08-13
**Tags:** #refactor #usage #dashboard #autocomplete #config #utils #bugfix #provider
**PR:** [#138](https://github.com/ltmoerdani/opencode-copilot-chat/pull/138) (`refactor/central-config-utils`, merged 2026-08-13, merge commit `616d6f6`)
**Closes:** bug issues [#139](https://github.com/ltmoerdani/opencode-copilot-chat/issues/139) – [#148](https://github.com/ltmoerdani/opencode-copilot-chat/issues/148)
**Supersedes:** open-PR tracker [`63-20260813-open-prs-133-135-136-tracker.md`](63-20260813-open-prs-133-135-136-tracker.md)

---

## Overview

A large contributor PR that lands in three intentional halves, **stacked on PR #136** (it carries #136's 17 autocomplete commits). The branch is `refactor/central-config-utils`; once #136 merged, GitHub auto-retargeted it to `main` and only the refactor+usage commits remained. Diff: **+4335/−1051, 46 files, 44 commits**.

## 1. Central Config + Shared Utilities (behavior-preserving)

- **`src/config.ts`** (new, dependency-free) — every tunable constant in the codebase: URLs, timeouts, limits, storage keys, setting keys, defaults, GO subscription tiers. Modules import from it and re-export the names their callers/tests rely on.
- **`src/utils.ts`** (new, pure) — replaces near-identical copies scattered across modules: `isRecord` (was defined 6×), `firstString`, `compactErrorCode`, `positiveNumber`, `toFiniteNumber`, `getErrorMessage`, `formatUsd`, `formatCount`/`formatTokenCount` (K/M/B/T), `formatRelativeTime`, `escapeHtml`, and two cancellable delay helpers.
- **`BaseResponseExtractor`** — both stream extractors (`OpenAiResponseExtractor`, `AnthropicResponseExtractor`) now share a single base instead of duplicating reasoning accounting and think-tag filtering.
- Verification scripts (`verify-estimate-token-count`, `validate-models`) import the **real production logic** instead of drifted copies; 4 dead exports removed.

## 2. Verified Production Bugs Fixed (#139–#148)

| #   | Bug (user-facing framing)                                                                                                      | Fix                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| 139 | `kimi-k2.7-code` 400s on cold start / offline (bundled `temperature: false` fallback ignored)                                  | fallback chain includes the bundled value                                                   |
| 140 | Audio/PDF/video models advertised image input they can't process                                                               | vision requires an actual image modality                                                    |
| 141 | Zen `freeOnly` filter bypassed on cached/bundled model lists (paid models shown offline to free-only users)                    | filter applied on every path (live, cache, bundled, metadata success + error)               |
| 142 | Kimi K2.7 / MiniMax M3 chain-of-thought leaked into visible chat text (Anthropic-style `thinking` block undetected)            | detection covers every reasoning channel (`bodyRequestsThinking()`)                         |
| 143 | Re-editing monthly spent targets inflated the baseline (baseline subtracted on a raw-SQLite path that never contains it)       | baseline only subtracted on the summary path                                                |
| 144 | Today/Yesterday/Codebase showed 0 when `sqlite3` wasn't on the host PATH (Android SDK on PATH only when launched from a shell) | CLI history read via `node:sqlite` first, then `sqlite3` binary from PATH + known locations |
| 145 | Anthropic stream extractor wrote usage fields onto itself instead of the request summary                                       | duplicate wrong-object write removed                                                        |
| 146 | String settings values (temperature/maxTokens/timeout) caused HTTP 400 upstream                                                | numeric settings sanitized/clamped with fallbacks                                           |
| 147 | `26h` instead of `1d 2h` in the usage reset countdown                                                                          | days branch takes precedence                                                                |
| 148 | Error classification could crash on hosts without a global `DOMException`                                                      | guarded `instanceof DOMException`                                                           |

Additional internal cleanups (no user-visible change): dead ternary in `sanitizeToolSchema`, duplicated Audio badge branch, `sqliteAvailable` inversion.

## 3. Usage — Real Data, Realtime, Full Dashboard

- **Today/Yesterday** merge the OpenCode CLI history (`~/.local/share/opencode/opencode.db`: per-message `cost`, `tokens.{input,output,reasoning,cache}`, `path.cwd`) with extension-tracked requests. Source selectable: `opencodego.usageTodayYesterdaySource` (`auto`/`cli`/`extension`).
- **Codebase row** replaces "Session (est)" — all-time usage for the current workspace, matched per-directory via `path.cwd`, windowed by `usageCodebaseWindowDays` (0 = all history). Toggle `usageCodebaseRow`.
- **Permanent tracking** — "Reset tracked usage data" action removed; 31-day entry cutoff gone (only the 2000-entry cap remains).
- **Instant startup + fast reads** — last server-usage snapshot persisted (`opencodego.serverUsage.v1`); multi-GB CLI read memoized (3s TTL).
- **Realtime** — background refresh loop (`usageRefreshIntervalSeconds`, default 60s, min 5s), immediate repaint on config changes, manual Refresh button.
- **Compact formatting** — `1.2M` tokens / `1.7k` requests / `$1.23M` / `$0.0004` sub-cent dollars everywhere.
- **Full-page usage panel (webview)** — animated ring meters (Session/Weekly/Monthly), stat chips, Spend/Requests/Tokens line charts with whole-chart hover, Models tab (overlapping per-model spend lines, ranked legend), **Suggested / Approved** tabs (per-day completion counters), Window toggle (Week → 14 days → Month → Lifetime, lifetime default), round equal axis steps, top-right Set targets / Rename / Refresh buttons.

### New Settings

`usageTodayYesterdaySource`, `usageCodebaseRow`, `usageCodebaseWindowDays`, `usageRollingSessionMeter`, `usageDayBoundary` (utc/local), `usageRefreshIntervalSeconds`, `usageChartDays`.

## Review Cycle

Maintainer review (2026-08-13) raised a **scope question** (the branch carries a whole usage dashboard not mentioned in the description) plus two small points; all addressed:

1. **Scope — intentional.** The usage rework depends on the refactor (`config.ts`/`utils.ts`), so it rides along. PR body rewritten to reflect reality; changelog updated.
2. **`freeOnly` on metadata-success path — fixed** (`d1c9c59`): `definition.filterModel` now applied in every branch.
3. **Unescaped model names in panel — fixed** (`d1c9c59`): legend/tooltips HTML-escape via `esc()`.
4. Plus the #136 review fixes (key fallback, failure logs, indentation, `qwen3.7-plus` fallback) live in this branch.

## Verification

- **276 unit tests** green (grown from 207 at the #136 merge base), strict lint + tsc + prettier + markdownlint green, VSIX packages and installs cleanly.
- Maintainer independently re-ran the suite and lint on the final head before merge.

## Merge

- Order honored: **#136 first** (merge commit `7df19f4`), then **#138** (merge commit `616d6f6`, 2026-08-13). Both merge commits — contributor history preserved.

## Related

- Feature doc [`15-20260813-inline-code-suggestions.md`](../features/15-20260813-inline-code-suggestions.md) — the autocomplete feature #136.
- Issue doc [`63-20260813-open-prs-133-135-136-tracker.md`](63-20260813-open-prs-133-135-136-tracker.md) — the original open-PR tracker (now solved).
