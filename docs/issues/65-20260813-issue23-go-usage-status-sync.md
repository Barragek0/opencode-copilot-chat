**Status:** ✅ Solved (2026-08-13)

# Issue #23 — Go Usage Status Not Updating: From Local Drift to Server-Accurate Meters

**Topic:** usage / go-usage / server-sync / opencode-api / status-bar
**Updated:** 2026-08-13
**Tags:** #usage #go-usage #server-sync #opencode-api #status-bar #sqlite #community-pr
**Related:** Issue [#23](https://github.com/ltmoerdani/opencode-copilot-chat/issues/23) (closed), issue [#130](https://github.com/ltmoerdani/opencode-copilot-chat/issues/130) (closed), PR [#50](https://github.com/ltmoerdani/opencode-copilot-chat/pull/50), PR [#60](https://github.com/ltmoerdani/opencode-copilot-chat/pull/60), PR [#132](https://github.com/ltmoerdani/opencode-copilot-chat/pull/132), upstream [anomalyco/opencode#16513](https://github.com/anomalyco/opencode/pull/16513)
**Supersedes:** —
**Builds on:** `docs/issues/13-20260605-go-usage-status-bar-not-updating.md` (original debugging), `docs/features/03-20260605-go-usage-tracker.md` (local tracker), `docs/issues/62-20260812-pr132-go-usage-server-sync.md` (final fix)

---

## Overview

Issue #23 was the original user report that the Go usage status bar drifts from opencode.ai. It took **two months** and **four distinct phases** to fully resolve, ending with the extension reading **server-accurate, account-wide usage** from the official `/zen/go/v1/usage` endpoint instead of estimating locally.

This document is the consolidated timeline of the whole arc, so maintainers can see how a "no public API" conclusion (June) became a shipped server-sync integration (August) once upstream shipped the endpoint. The PR-level detail lives in the linked docs below; this doc ties the story together.

---

## Timeline

### 1. [2026-06-12] Original report — issue #23 opened

**Problem:** [@rh71el2](https://github.com/rh71el2) reported the usage status card does not match opencode.ai:

- Weekly usage % is ~9% too low.
- Monthly usage % is ~15% too low, and shows "27d left" where it should be ~"19d left" (subscription started 6/1).
- VS Code updates + reboots did not help.

**Status:** ✅ Root cause identified, not yet fixable cleanly (see below).

### 2. [2026-06-13 → 2026-06-14] Diagnosis — no public API

**Problem:** [@Wallacy](https://github.com/Wallacy) (contributor) explained the tracker computes **locally only**; there is no public opencode API for usage. The owner (ltmoerdani) confirmed after probing `/usage`, `/billing`, `/subscription`, `/quota`, `/balance` and ~10 other endpoints — all 404. Billing is server-side behind browser OAuth on opencode.ai.

**Root cause:** The tracker can never see:

- Usage from the OpenCode CLI/TUI,
- Usage from other devices / other VS Code windows,
- Usage from before the extension was installed.

So local estimates are always lower than reality. The "27d vs 19d" monthly mismatch is a separate anchor bug: the monthly window used the date of the **first tracked request** in the extension, not the real subscription start date.

**Proposed options (owner, 2026-06-14):**

- **A.** Manual sync from opencode.ai (partial fix, needs re-sync).
- **B.** Label the tracker explicitly "this device only" (clarity).
- **C.** Configurable subscription start date (fixes the monthly anchor bug).
- **D.** OAuth-based sync (ideal, but fragile — reverse-engineers auth).

**Status:** ✅ Diagnosis confirmed; options A+C chosen as the pragmatic path, D deferred.

### 3. [2026-06-17] Partial fix 1 — manual usage targets (PR #50)

**Problem:** Users still want accurate numbers today.

**Solution:** [@Wallacy](https://github.com/Wallacy) shipped PR #50 "feat: manual usage targets + live pricing for Go tracker":

- New command **"OpenCode Go: Set Usage Targets..."** (also linked in the status bar tooltip).
- Five input boxes pre-filled with current values (Enter = keep, Escape = cancel).
- Last two inputs configure the **monthly reset day (1–31) and hour (0–23 UTC)** — fixes the monthly "resets in" timer.
- Cost fallback table now queries the **live models.dev metadata cache** instead of a static snapshot, so new models price correctly without code changes.

**Status:** ✅ Shipped; closes the manual-sync + anchor part of #23 (commit `d031457`).

### 4. [2026-06-30] Partial fix 2 — SQLite-backed cost accuracy (PR #60)

**Problem:** PR #50 helped, but tracked estimates still drift 9–15% from actual billing because server-side cache affinity and CLI/TUI usage are invisible to the extension.

**Solution:** PR #60 "feat: SQLite-backed cost accuracy" wires the existing (previously dead-code) `readOpenCodeHistory()` into `getSummary()`:

1. Reads actual billed amounts from `~/.local/share/opencode/opencode.db` (written by the OpenCode CLI).
2. Aggregates real billed costs into session/weekly/monthly/today/yesterday buckets.
3. Enriches today/yesterday tokens from tracked entries (SQLite stores cost only).
4. Falls back to `buildSummaryFromTracked()` when no SQLite DB exists.

New `UsageSummary.sqliteAvailable` flag hints at the data source. This fixes issue #59 (the root cause of #23 drift) — but only for **this machine**; cross-device usage stays out of the numbers.

**Status:** ✅ Shipped.

### 5. [2026-08-11 → 2026-08-12] Upstream enables the real fix — `/zen/go/v1/usage`

**Problem:** SQLite is still per-machine. The fundamental blocker (no public API) had to be removed upstream.

**What happened:**

- [anomalyco/opencode#16513](https://github.com/anomalyco/opencode/pull/16513) "feat(console): add go usage endpoint" by [@peculiarnewbie](https://github.com/peculiarnewbie) was **merged to `dev`** on 2026-08-11/12 by [@vimtor](https://github.com/vimtor) (2 commits incl. "secure go usage auth").
- It adds **`GET /zen/go/v1/usage`**, returning the same rolling/weekly/monthly Go usage the Zen dashboard shows, computed server-side.
- Auth uses the **`opencode-go` key already on disk** (`~/.local/share/opencode/auth.json`) — the same key users already send to `/zen/go/v1/models`, so no new auth surface.
- Confirmed live by the owner on 2026-08-12 and by vimtor's public note "you can now query your OpenCode Go usage via API".
- 20 participants, ~96 👍 reactions; closes upstream feature request #16017.

**Endpoint contract (verified against upstream route source `packages/console/app/src/routes/zen/go/v1/usage.ts`):**

| Status | Meaning                                                                                                                                                                |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `200`  | `{ usage: { rolling, weekly, monthly: { status, percent, resetsAt } } }` — `percent` is integer 0–100, `resetsAt` ISO timestamp, `status` is `"ok"` / `"rate-limited"` |
| `401`  | Missing/invalid key (`AuthError`); also surfaces when a valid key has no active Go plan (not distinguished upstream)                                                   |
| `403`  | `EntitlementError` — "OpenCode Go subscription required."                                                                                                              |
| `404`  | Endpoint not deployed (pre-merge)                                                                                                                                      |

**Status:** ✅ Upstream unblocked; this is the "Option D" that was previously deemed too fragile, now official.

### 6. [2026-08-12] Our tracking issue + reply — issue #130 created

**Action:** On 2026-08-12, [@mderazon](https://github.com/mderazon) pointed the repo at the merged upstream PR on issue #23. The owner:

- Posted a reply on issue #23 acknowledging the change and noting the endpoint needs a production-live check before building on it.
- Opened **issue #130** "[FEATURE] Sync Go usage from official /zen/go/v1/usage endpoint" with a proposed sync-layer design (fetch with existing key, map rolling/weekly/monthly, keep Today/Yesterday local, fall back to SQLite → tracked, never log the key).

**Status:** ✅ Issue opened; design matched what PR #132 then implemented.

### 7. [2026-08-12T22:51Z] Resolution — PR #132 merged

**Problem:** Local + SQLite estimates still drift across devices; the status bar had to be server-accurate now that the endpoint exists.

**Solution:** [@Fahad090NP](https://github.com/Fahad090NP)'s PR #132 "feat(usage): sync Go usage from the official /zen/go/v1/usage endpoint (#130)" (merge commit `4a14b1e`, +607/−120, 8 files):

- New pure module `src/goUsageSync.ts` — `fetchGoUsage()` (Bearer auth, failure classifier: `unauthorized` / `no-subscription` / `not-found` / `network` / `invalid`) + `mergeServerUsage()`.
- `src/goUsageTracker.ts` gains `syncServerUsage(apiKey)` with a **60s TTL**; `getSummary()` stays synchronous and overlays the cached server snapshot.
- `src/extension.ts`: startup sync, per-request re-sync using the exact key the request ran under, background sync on status-bar refresh.
- Bonus dialog fixes: wired the dead "Reset tracked usage data" action, stopped reset from collapsing the card to the first-run state, wired the dead "Open OpenCode console" quick-pick, stabilized panel/hover geometry.
- Type-safety cleanups surfaced by the new strict lint stack (#129).

**Verification:** endpoint verified live in production (401 shape matches upstream source); `npm run lint` 7 steps green; `npm test` 189/189 (incl. the post-review `hasData` regression test).

**Status:** ✅ Solved. Issue #130 closed 2026-08-12T22:51:07Z. This is the **final** fix for #23's root cause.

---

## Final Solution (as shipped)

The Go usage meters are now **server-accurate and account-wide**:

```text
/zen/go/v1/usage (official, live 2026-08-11)
  ← fetchGoUsage(apiKey) — Bearer header, 60s TTL, never logs/persists key
  ← mergeServerUsage() — overlay rolling/weekly/monthly percent + resetsAt
  ← goUsageTracker.getSummary() — server snapshot on top of local summary
  fallback chain: server → SQLite (opencode.db) → tracked estimates
```

- **Rolling (5h, $12)** → server `usage.rolling`
- **Weekly ($30)** → server `usage.weekly`
- **Monthly ($60)** → server `usage.monthly` (`resetsAt` fixes the "27d vs 19d" anchor bug for real — reset time is computed server-side from the actual subscription start)
- **Today / Yesterday / per-session spend** stay device-local (the API does not return them).

## Security Notes

- The Go key is read from `SecretStorage` per request and sent only to `https://opencode.ai/zen/go/v1/usage` as `Authorization: Bearer <key>`.
- The key is **never logged** and **never persisted** outside the existing SecretStorage path.
- Failure responses are classified; raw bodies are not surfaced to the user.

## Lessons Learned

1. **"No public API" is a moving target.** June's exhaustive probe (all 404) was correct then, but the upstream console team merged the endpoint in August. Re-check upstream PRs/issues before concluding a server sync is impossible; community dashboards (openusage, CodexBar, claude-usage-api) adopt official endpoints quickly once they land.
2. **Layered fixes compose well.** Manual targets (#50) and SQLite (#60) were partial, but each made the status bar more useful and the SQLite reader became the fallback for the final server-sync — no code thrown away.
3. **Same key, no new auth surface.** The endpoint reuses the existing `opencode-go` key and base URL the extension already talks to, which made adoption cheap and safe.
4. **Account-wide ≠ device-local.** The server endpoint is authoritative for limits; local history stays authoritative for spend details. Keeping the two scopes separate (per openusage#1095 pattern) avoids confusing numbers.

## Related Work

- `docs/issues/62-20260812-pr132-go-usage-server-sync.md` — PR #132 final fix (this doc's §7).
- `docs/issues/30-20260630-pr60-sqlite-cost-deepseek-overflow.md` — PR #60 SQLite fix (this doc's §4).
- `docs/issues/29-20260617-pr50-manual-usage-targets-live-pricing.md` — PR #50 manual targets (this doc's §3).
- `docs/issues/13-20260605-go-usage-status-bar-not-updating.md` — original local-tracker debugging; its "no public REST API" conclusion is **superseded** by this doc.
- `docs/features/03-20260605-go-usage-tracker.md` — the local-tracked Go Usage Tracker the server sync builds on.
- Upstream `anomalyco/opencode#16513` — the server route that exposes `/zen/go/v1/usage`.
- `robinebers/openusage#1095` — external project adopting the same API (limits account-wide, spend local).
