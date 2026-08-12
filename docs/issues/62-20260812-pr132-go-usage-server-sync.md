**Status:** ✅ Solved (merged, merge commit `4a14b1e`, 2026-08-12T22:51:06Z)

# PR #132 — Server-Accurate Go Usage via Official `/zen/go/v1/usage` Endpoint (#130)

**Topic:** usage / go-usage / server-sync / opencode-api / status-bar / webview
**Updated:** 2026-08-13
**Tags:** #usage #go-usage #server-sync #opencode-api #status-bar #webview #community-pr
**Related:** Issue [#130](https://github.com/ltmoerdani/opencode-copilot-chat/issues/130) (closed), issue [#23](https://github.com/ltmoerdani/opencode-copilot-chat/issues/23) (local drift root cause), PR [#132](https://github.com/ltmoerdani/opencode-copilot-chat/pull/132) (by [@Fahad090NP](https://github.com/Fahad090NP))
**Branch:** `feat/issue-130-go-usage-sync` (merged into `main` via `4a14b1e`)
**Supersedes:** —
**Builds on:** `docs/features/03-20260605-go-usage-tracker.md` (the local-tracked Go Usage Tracker)

---

## Overview

PR #132 (+607/−120, 8 files changed) replaces locally estimated Go usage meters with **server-accurate meters synced from the official `/zen/go/v1/usage` endpoint**. The status bar, tooltip, quick-pick, and usage webview previously showed locally estimated Session/Weekly/Monthly values (tokens × pricing + local `opencode.db`), which drifted from opencode.ai because CLI usage, cross-device usage, and pre-install usage were invisible to the extension. The server endpoint is authoritative for rolling/weekly/monthly percent and `resetsAt`; the extension keeps its local Today/Yesterday/per-session spend tracking on top of that.

The PR also fixes three dialog bugs found along the way: a dead "Reset tracked usage data" action, a card that collapsed into the first-run state on reset, and a dead "Open OpenCode console" quick-pick.

---

## Problem (#130)

### Reported symptoms

The Go Usage Tracker's Session/Weekly/Monthly meters were estimates computed locally (token count × pricing + local `opencode.db`). They drifted from the values on opencode.ai because any usage that happened outside this extension (CLI, another device, before install) was invisible. Users reported the percentage not matching the dashboard.

### Root cause

The extension had no read path against the official Go usage endpoint. All meters were derived from local observation of streaming requests made by this extension only. Issue #23 is the original report of this class of drift.

---

## Solution

### 1. Sync layer — `src/goUsageSync.ts` (new, pure + unit-tested)

| Function               | Role                                                                                                                                                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `fetchGoUsage(apiKey)` | `GET /zen/go/v1/usage` with the stored Go key as a Bearer token. Failures are classified (`unauthorized` / `no-subscription` / `not-found` / `network` / `invalid`) so callers can decide whether to fall back to local estimates. The key is never logged or persisted. |
| `mergeServerUsage()`   | Overlays the server rolling/weekly/monthly percent + `resetsAt` onto the local summary. `spent` is derived from the authoritative percent. Today/Yesterday/per-session spend stay device-local.                                                                          |

The module is pure (no VS Code imports) so it is unit-testable without a host.

### 2. Tracker wiring — `src/goUsageTracker.ts`

- `syncServerUsage(apiKey)` with a **60s TTL** (failures are paced too, so a bad key can't hammer the API).
- `getSummary()` stays synchronous and overlays the cached server snapshot on top of the local summary before returning.

### 3. Extension wiring

- **Startup sync** with the stored key.
- **Per-request re-sync** using the exact key the request ran under (covers native BYOK group keys that differ from the stored key).
- **Background sync on status-bar refresh** with a repaint when new data arrives.

### 4. Dialog fixes (found along the way)

| Bug                                                                                   | Fix                                                                                                                       |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| "Reset tracked usage data" quick-pick action was never wired — picking it did nothing | Now: modal confirm → `tracker.clear()` (also clears session costs) → repaint                                              |
| Reset collapsed the card into the first-run "No data" state                           | A persisted `everTracked` flag keeps the card with zeroed local values instead                                            |
| "Open OpenCode console" quick-pick was dead                                           | Now opens the console; a "Synced from opencode.ai" note appears when server meters are active                             |
| Usage panel + hover card had layout jumps                                             | Stable geometry: fixed width/columns, consistent 14/16px gutters, always-visible Today/Yesterday rows, clean compact card |

### 5. Type-safety cleanups

Resolved always-true/false TS hints flagged by the new strict lint stack (PR #129): redundant cancellation guards, a dead `if (tracker)` branch, and two wrong types — `GO_MODEL_PRICING` and the metadata `providers` map are genuinely `Partial` at runtime and are now typed as such.

### 6. Post-review fixes (merged with the PR)

The maintainer review surfaced three points, all fixed and merged as the top three commits of the PR (`172c2e9`, `98efb6b`, `0bff8b7`):

| Review point                          | Fix commit | Result in merged state                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Multi-profile sync key                | `0bff8b7`  | The extension remembers which API key owns each profile fingerprint (`profileApiKeys` map, set in `ensureProfileForApiKey`); the status-bar background sync uses the **active profile's own key**, falling back to the extension secret only when unknown. Switching profiles without a request now syncs the right account's meters, and the refresh path no longer races the per-request sync with a different key. |
| `hasData` ignored the server snapshot | `172c2e9`  | `mergeServerUsage()` now flips `hasData` to `true` whenever a server snapshot is applied, so a fresh install with CLI usage shows real meters on the status bar / tooltip instead of "OpenCode Go" / "No usage data yet". Regression test added (`mergeServerUsage — server meters imply hasData`).                                                                                                                   |
| Concurrent sync double-fetch          | `98efb6b`  | Concurrent `syncServerUsage()` calls for the same key share a single in-flight promise (startup + status-bar refresh no longer double-fetch); failures stay TTL-paced.                                                                                                                                                                                                                                                |

---

## Verification

| Check                                                           | Result                                                                                    |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Endpoint verified live in production                            | ✅ 401 shape matches upstream route source; upstream `anomalyco/opencode#16513` merged    |
| `npm run lint` (strict, 7 steps incl. tsc check)                | ✅ green                                                                                  |
| `npm test`                                                      | ✅ 189/189 (incl. the fresh-install `hasData` regression test from the post-review fixes) |
| Branch merged with current `main` (incl. strict-lint toolchain) | ✅ mergeable, no conflicts                                                                |

---

## Files of Interest

| Path                           | Role                                                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `src/goUsageSync.ts`           | new — pure sync layer (`fetchGoUsage`, `mergeServerUsage`, failure classifier)                              |
| `src/test/goUsageSync.test.ts` | new — server usage mapper + failure classification tests + fresh-install `hasData` regression test          |
| `src/goUsageTracker.ts`        | `syncServerUsage(apiKey)` with 60s TTL + in-flight dedup; `getSummary()` overlays cached server snapshot    |
| `src/extension.ts`             | startup sync, per-request re-sync, background sync on status-bar refresh using the active profile's own key |
| `package.json`                 | no new commands; the existing Reset/Console quick-pick actions are now wired                                |

---

## Security Notes

- The Go API key is read from `SecretStorage` per request and sent only to `https://opencode.ai/zen/go/v1/usage` as a `Authorization: Bearer <key>` header.
- The key is **never logged** and **never persisted** outside the existing `SecretStorage` path.
- Failure responses are classified but their raw bodies are not surfaced to the user.

---

## Related Work

- Consolidated issue #23 timeline [`65-20260813-issue23-go-usage-status-sync.md`](65-20260813-issue23-go-usage-status-sync.md) — the full arc from the June report through PR #50/#60 partial fixes to this server-sync fix.
- Feature doc [`03-20260605-go-usage-tracker.md`](../features/03-20260605-go-usage-tracker.md) — the local-tracked Go Usage Tracker that this PR extends with server-synced meters.
- Issue doc [`61-20260812-pr129-strict-lint-stack-precommit-gate.md`](61-20260812-pr129-strict-lint-stack-precommit-gate.md) — the strict lint stack whose type-aware rules surfaced the TS hints fixed here.
- Upstream `anomalyco/opencode#16513` — the server-side route that exposes `/zen/go/v1/usage`.
