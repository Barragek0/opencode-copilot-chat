**Status:** ✅ Solved (superseded — see note below)

# Go Usage Tracker — Status Bar Not Updating

**Topic:** debug / status-bar / logging / cli-removal / rest-api-research
**Updated:** 2026-08-13
**Tags:** #debug #status-bar #go-usage #cli #rest-api #logging
**Related:** `docs/features/03-20260605-go-usage-tracker.md`

> ⚠️ **Superseded (2026-08-13):** This doc's Phase 2 conclusion — "no public REST API for usage/billing" — was true in June 2026 but is **no longer true**. Upstream [anomalyco/opencode#16513](https://github.com/anomalyco/opencode/pull/16513) merged an official **`GET /zen/go/v1/usage`** endpoint (live 2026-08-11) that returns server-accurate rolling/weekly/monthly usage. The extension now syncs from it (PR #132), so the tracker is server-accurate, not estimated. See the consolidated issue #23 timeline: `65-20260813-issue23-go-usage-status-sync.md` and the PR #132 doc `62-20260812-pr132-go-usage-server-sync.md`. Keep this doc for the local-tracker debugging history; do not treat its API-conclusion as current.

---

## Symptom

After installing v0.2.0 and using OpenCode Go models in Copilot Chat, the status bar item `Go: 0%·0%·0%` did not change. No usage data was being recorded despite confirmed model usage.

---

## Investigation

### Phase 1: CLI Dependency Problem

**Discovery:** Initial implementation used SQLite-first approach — reading `~/.local/share/opencode/opencode.db` to get server-computed cost data. This required the user to have run OpenCode CLI (TUI) at least once.

**User Rejection:**

> "Kenapa anda masih bahasa terkait CLI, mac saya memang pernah menjalankan opencode dan melaui CLI, tapi jauh sebelum itu open usage sudha berfungsi"

**Root Cause:** The SQLite reader path was the primary data source. If `opencode.db` didn't exist or had no data, the tracker fell back to extension-tracked data. But the fallback was incomplete — it only worked for requests made AFTER extension install.

### Phase 2: Exhaustive REST API Search

Searched all possible OpenCode endpoints for programmatic usage data:

| Endpoint                   | Status |
| -------------------------- | ------ |
| `/zen/go/v1/usage`         | 404    |
| `/billing`                 | 404    |
| `/subscription`            | 404    |
| `/me`                      | 404    |
| `/account`                 | 404    |
| `/quota`                   | 404    |
| `/limits`                  | 404    |
| `/balance`                 | 404    |
| `/api/billing/*`           | 404    |
| `/api/workspace/*/billing` | 404    |

**Conclusion:** No public REST API for usage/billing. All billing functions are server-side only. Extension-tracked estimation is the only viable approach.

### Phase 3: Architecture Pivot

Removed all CLI-dependent code paths:

| Removed                         | Detail                                                                  |
| ------------------------------- | ----------------------------------------------------------------------- |
| `askUsdAmount()`                | Manual dollar input Quick Pick                                          |
| `setManualGoUsageBaseline()`    | Manual baseline setting                                                 |
| Manual baseline Quick Pick item | "Set manual baseline..." option                                         |
| SQLite-first path               | Removed from `getSummary()`, now only calls `buildSummaryFromTracked()` |
| CLI messaging                   | Removed all references to "run CLI first"                               |

**Result:** `getSummary()` now exclusively uses extension-tracked data. SQLite reader `readOpenCodeHistory()` kept as dead code for potential future enrichment.

### Phase 4: Debug Logging

Added diagnostic logging to identify why `record()` might silently skip entries:

**`goUsageTracker.ts` — `record()` method:**

```typescript
// Guard 1: Provider filter
if (!providerDisplayName.toLowerCase().includes("go")) {
  this.log(`[GoUsage] SKIP: provider "${providerDisplayName}" is not Go`);
  return;
}

// Guard 2: Zero tokens
if (promptTokens === 0 && completionTokens === 0) {
  this.log(`[GoUsage] SKIP: zero tokens for model ${modelId}`);
  return;
}
```

**`extension.ts` — `onTransportSummary` callback:**

```typescript
// Log before recording
console.log(`[GoUsage] onTransportSummary: vendor=${vendor}, provider=${providerDisplayName}, model=${modelId}`);

goUsageTracker.record({ ... });
```

**Output channel:** "OpenCode Go Usage" — visible in VS Code Output panel.

### Phase 5: `session.percent` Bug

**Found:** Session percentage calculation used `GO_LIMITS.weekly` ($30) instead of `GO_LIMITS.session` ($12).

**Fix:** Changed denominator to `GO_LIMITS.session` for the 5-hour rolling window percentage.

---

## Resolution

| Change                  | File                | Detail                                                 |
| ----------------------- | ------------------- | ------------------------------------------------------ |
| Removed CLI dependency  | `goUsageTracker.ts` | `getSummary()` → only `buildSummaryFromTracked()`      |
| Removed manual baseline | `extension.ts`      | Deleted `askUsdAmount()`, `setManualGoUsageBaseline()` |
| Added debug logging     | `goUsageTracker.ts` | `record()` guards log skip reasons                     |
| Added debug logging     | `extension.ts`      | `onTransportSummary` logs vendor/provider/model        |
| Fixed session.percent   | `goUsageTracker.ts` | Use `GO_LIMITS.session` not `GO_LIMITS.weekly`         |
| Built test VSIX         | `package.json`      | Temporarily v0.2.1 for testing                         |

## Verification

```bash
# Build test VSIX with debug logging
npx @vscode/vsce package --no-dependencies  # 103 KB VSIX (v0.2.1)
code --install-extension opencode-copilot-chat-0.2.1.vsix --force
```

**Testing approach:**

1. Open Copilot Chat
2. Send a message using a Go model
3. Check Output panel → "OpenCode Go Usage" channel
4. Verify status bar updates after request completes
5. Check `[GoUsage]` log lines for skip reasons

---

## Lessons Learned

1. **"No public billing API" was time-boxed** — At the time of this doc (June 2026) OpenCode had no public usage endpoint, so estimation was the only option. **This changed on 2026-08-11** when upstream merged the official `/zen/go/v1/usage` endpoint (PR #132 now syncs from it). Lesson: re-check upstream periodically; "no API" conclusions expire.
2. **Guard clauses are silent by default** — Adding logging to `record()` skip conditions makes debugging 10× faster.
3. **CLI requirements alienate VS Code users** — The extension's value is avoiding the CLI. Requiring CLI runs defeats the purpose.
4. **SQLite reader became real enrichment, then a fallback** — Kept as "future enrichment only", it was wired up in PR #60 and is now the middle tier of the server → SQLite → tracked fallback chain.

---

## Remaining Work (as of 2026-08-13)

- ✅ Verify status bar updates correctly with debug logging in production — **done**, tracker is now server-accurate (PR #132)
- ✅ SQLite reader no longer dead code — wired as fallback in PR #60
- [ ] Consider adding `onDidChangeConfiguration` to reset tracker if pricing changes
- ✅ Revert v0.2.1 test version → proper version bump — long since released (current: 0.5.2+)

> See the consolidated timeline `65-20260813-issue23-go-usage-status-sync.md` for the full arc from this local-tracker era to server-sync.
