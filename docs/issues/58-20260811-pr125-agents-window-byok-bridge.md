# PR #125 — OpenCode Go/Zen in the Agents Window + Remove Providers from Language Models (#122)

**Status:** ✅ Solved (merged, merge commit `3001d68`, 2026-08-11T07:22:30Z)
**Topic:** vscode / agents-window / byok / provider / configuration / languageModelChatProviders
**Updated:** 2026-08-11
**Tags:** #vscode #agents-window #byok #provider #when-clause #providerEnablement #bugfix #community
**Related:** Issue [#122](https://github.com/ltmoerdani/opencode-copilot-chat/issues/122) (closes, completed 2026-08-11), PR [#125](https://github.com/ltmoerdani/opencode-copilot-chat/pull/125)
**Author:** [@Fahad090NP](https://github.com/Fahad090NP)
**Branch:** `fix/issue-122-agents-window-models`
**Supersedes:** part of `docs/features/06-20260614-agents-window-model-visibility.md` (VS Code ≥1.129 path); legacy agent-host variants doc still apply to VS Code ≤1.128

---

## Overview

Two problems were reported against the Agents window and the Language Models management UI:

1. **OpenCode Go / OpenCode Zen did not appear in the VS Code Agents window** model picker nor in its "+ Add Models" vendor list (VS Code ≥1.129).
2. **There was no way to remove the providers** — `OpenCode Go` / `OpenCode Zen` always appeared in the Manage Language Models list and every model picker.

This PR fixes both: it auto-enables the two VS Code core settings the Agents window depends on (with revert + reload UX), and adds a per-provider kill switch (`opencodego.enabled` / `opencodezen.enabled`) plus commands/QuickPick actions to remove and re-add a provider, keeping API keys and BYOK groups intact.

---

## Problem (#122)

### Reported symptoms

1. **Models missing from the Agents window.** Opening the Agents window → Language Models tab → **+ Add Models** showed no `OpenCode Go` / `OpenCode Zen` entries; the models were selectable only in the regular Chat view.
2. **No way to remove the providers.** Both providers always appeared in the Manage Language Models list and every model picker with no delete/remove path (follow-up feedback on #122).

**Environment:** extension `0.5.1`, VS Code `1.132.0`, provider OpenCode Go / OpenCode Zen.

### Root cause

VS Code ≥1.129 runs the **Agents window in a separate agent host process** and keeps the two mechanisms this feature depends on **off by default**:

| Setting | Role | Default |
| ------- | ---- | ------- |
| `chat.agentHost.byokModels.enabled` | Experimental BYOK language-model bridge that mirrors extension BYOK models into agent-host sessions (VS Code 1.129+) | `false` |
| `extensions.supportAgentsWindow` | The ONLY way a code extension is allowed to run in the Agents window (sessions window) process | unset per extension |

Without `extensions.supportAgentsWindow.<id>`, VS Code disables any extension with a `main` entry in the Agents window process (`canExecuteOnSessionsWindow` returns `false`), so the extension's `languageModelChatProviders` vendors are never registered there — neither the model picker nor the "+ Add Models" list can show OpenCode Go/Zen.

On older versions (≤1.128) the bridge does not exist, so the extension's own agent-host providers (`targetChatSessionType: "copilotcli"`) are the only path — hence they remain registered.

---

## Fix (PR #125)

### 1. `fix(agents)` — Agents window support (commit `c5fbceb`)

On activation, when `opencodego.agentsWindow` is on and the new `opencodego.autoEnableAgentsWindow` setting (default `true`) is on, the extension auto-enables both core settings, **merging with any existing user values**:

- `chat.agentHost.byokModels.enabled` → `true` (only on VS Code 1.129+, guarded by `isModernAgentHostVscode()`).
- `extensions.supportAgentsWindow."ltmoerdani.opencode-copilot-chat"` → `true`.

Key behaviors:

- **Records in globalState** exactly what it flipped (`opencode.agentsByokBridge.v1`, `opencode.supportAgentsWindow.v1`), so `revertAgentsWindowSupport()` can restore **only its own changes** when the user disables `agentsWindow` (or turns off auto-config). Settings the user configured manually are left untouched.
- **One-time notification** with a **Reload Now** button (both settings require a window/agent-host restart).
- **Legacy agent-host providers** (`targetChatSessionType: "copilotcli"`) remain registered for VS Code 1.125–1.128 where the bridge does not exist.

### 2. `feat(models)` — remove providers from Language Models (commit `d4ee65d`)

- New `opencodego.enabled` / `opencodezen.enabled` settings (default `true`); the `languageModelChatProviders` vendor contributions carry matching `when` clauses (`config.opencodego.enabled` / `config.opencodezen.enabled`), so a disabled provider disappears from the Manage Language Models view, the "+ Add Models" list, the Chat picker, and the Agents window.
- Runtime registration is skipped at startup when the setting is off (spread-gated `registerLanguageModelChatProvider` calls in `activate()`).
- New commands `OpenCode Go: Remove/Re-add Provider in Language Models` (and Zen equivalent), plus a **Remove from Language Models** / **Re-add to Language Models** action in the Manage Provider QuickPick (reachable even without an API key — the old `manage()` early-return on missing key was removed).
- API keys and BYOK groups are **kept**, so re-enabling restores the provider unchanged. A window reload is required after toggling.

### 3. `fix(models)` — read provider enabled flag from the correct config section (commit `99af0c9`, review follow-up)

The original implementation read the Zen flag with a **section-scoped** configuration:

```ts
// ❌ BUG (original)
const opencodeCfg = vscode.workspace.getConfiguration("opencodego");
const zenProviderEnabled = opencodeCfg.get<boolean>("opencodezen.enabled", true);
```

`getConfiguration("opencodego")` resolves keys **relative to that section**, so this actually read `opencodego.opencodezen.enabled` (which never exists) and always fell back to `true`. Net effect: disabling Zen set `opencodezen.enabled = false`, the `when` clause hid the vendor from Manage Models, but the provider was still registered at runtime, so Zen models stayed in the Chat picker — the opposite of the intended behavior. Go was unaffected (`enabled` read from the right section).

**Fix:** new pure module `src/providerEnablement.ts` maps every vendor (including agent variants) to the **full root-configuration key**:

```ts
export function providerEnabledSetting(vendor: AllProviderVendor): string {
  return `${resolveBaseVendor(vendor)}.enabled`;
}
```

Callers now read from the **root** configuration (`vscode.workspace.getConfiguration().get(key, ...)`), never section-scoped. Agent variants resolve to their base vendor, so they follow the same switch as the vendor they mirror. The `manage()` QuickPick also uses `providerEnabledSetting(this.definition.vendor)` (fixes the agent-vendor `getConfiguration("opencodego-agent").get("enabled")` always-`true` issue).

### 4. `chore(tooling)` — linters/formatters honor `.gitignore` at runtime (commit `741cf45`)

Stops maintaining parallel, drifting ignore lists; every tool derives its exclusions from `.gitignore` at run time:

- **ESLint**: flat config reads `.gitignore` via the new shared `scripts/gitignore-patterns.mjs` (single source of truth).
- **Prettier**: `format` / `format:check` pass `--ignore-path .gitignore` explicitly.
- **markdownlint-cli2**: config renamed `.markdownlint.json` → `.markdownlint-cli2.jsonc` and gains `"gitignore": true` (native gitignore parsing, including nested `.gitignore` files), so the hardcoded `#node_modules` exclusion is no longer needed. `docs/**` stays excluded from the default lint script.

### 5. `chore` — ignore `tmp/` (commit `317eaf8`)

Placeholders for temporary working copies live under `tmp/`, are never committed, and are excluded from the VSIX via `.vscodeignore` (`tmp/**`).

---

## Files Changed

| File | Change |
| ---- | ------ |
| `src/providerEnablement.ts` | **NEW** — pure helper `providerEnabledSetting()` mapping vendor → full root config key (base vendor for agent variants); documents the section-scoped read pitfall |
| `src/test/providerEnablement.test.ts` | **NEW** — regression tests: base vendors map to their own setting, agent variants follow base, keys are full root-configuration keys (10 tests) |
| `src/extension.ts` | Auto-enable/revert `chat.agentHost.byokModels.enabled` + `extensions.supportAgentsWindow`; gated provider registration; `toggleProviderEnabled()`; `ensureAgentsWindowSupport()` / `revertAgentsWindowSupport()`; `isModernAgentHostVscode()`; `manage()` uses `providerEnabledSetting` and drops the missing-key early-return; `warmModelPickerMetadata()` reads enabled from root config |
| `package.json` | New `opencodego.enabled` / `opencodezen.enabled` / `opencodego.autoEnableAgentsWindow` settings; `when` clauses on vendor contributions; `Remove/Re-add Provider in Language Models` commands; lint/format script updates (markdownlint-cli2 rename, `--ignore-path .gitignore`) |
| `eslint.config.mjs` | Uses `readGitignorePatterns()` from the shared module |
| `scripts/gitignore-patterns.mjs` | **NEW** — shared gitignore-pattern reader for ESLint |
| `.markdownlint-cli2.jsonc` | **NEW** — replaces `.markdownlint.json`, adds `"gitignore": true` |
| `.markdownlint.json` | Deleted (renamed to `.markdownlint-cli2.jsonc`) |
| `.gitignore` | Added `tmp/` |
| `.vscodeignore` | `tmp/**`; `.markdownlint.json` → `.markdownlint-cli2.jsonc` |
| `CHANGELOG.md` | `[Unreleased] → Added` entries (remove providers + Agents window support) |
| `README.md` | Agents Window section rewritten for the VS Code ≥1.129 BYOK bridge + auto-enable flow |

---

## Configuration Summary (new/changed)

| Setting | Default | Purpose |
| ------- | ------- | ------- |
| `opencodego.enabled` | `true` | Register the OpenCode Go provider; `false` removes it from Language Models and all pickers (until reload) |
| `opencodezen.enabled` | `true` | Register the OpenCode Zen provider; `false` removes it from Language Models and all pickers (until reload) |
| `opencodego.autoEnableAgentsWindow` | `true` | Auto-manage `chat.agentHost.byokModels.enabled` + `extensions.supportAgentsWindow` when `agentsWindow` is on; `false` leaves them to the user |
| `opencodego.agentsWindow` | `true` | Master switch for Agents window support (existing) |

New commands:

- `OpenCode Go: Remove/Re-add Provider in Language Models`
- `OpenCode Zen: Remove/Re-add Provider in Language Models`
- Manage Provider QuickPick: **Remove from Language Models** (when enabled) / **Re-add to Language Models** (when disabled)

---

## Verification

- [x] Packaged VSIX tested on VS Code 1.132 — OpenCode Go/Zen appear in the Agents window model picker and the "+ Add Models" list; both providers work in Copilot Chat (author).
- [x] Removing a provider via the command/QuickPick + reload removes it from Language Models, Chat picker, "+ Add Models", and the Agents window; re-adding restores it with key/group intact (author).
- [x] `npm test` — 171/171 pass (author).
- [x] `npm run lint` — clean (author).
- [x] VSIX contents verified (no `tmp/` packaged).
- [x] CI — build + GitGuardian pass on the PR.
- [x] Merge state — CLEAN / MERGEABLE after rebase onto current `main`.

### Maintainer verification (2026-08-11)

- [x] Confirmed the Zen config-scoping bug was real (review) and the `providerEnablement.ts` root-config fix is correct.
- [x] Local worktree verification: `npm run compile` clean, `npm test` **171/171 pass (0 fail)** including the new `providerEnablement` suite.
- [x] Confirmed `when` clause support for `languageModelChatProviders` (official docs: "A when clause that controls whether this provider appears in the Manage Models list") and `managementCommand` deprecation — consistent with PR #124.
- [x] Merge state CLEAN; merged as a **merge commit** (`3001d68`) preserving the contributor's 5 commits.

---

## Review & Merge

1. **2026-08-10/11 — Maintainer review (@ltmoerdani).** Found the `opencodezen.enabled` section-scoped read bug (`opencodego.opencodezen.enabled` never exists → always `true`) in `activate()` and `warmModelPickerMetadata()`, plus the agent-vendor `manage()` guard gap. Requested a fix + test.
2. **2026-08-11 — Contributor response (@Fahad090NP).** Addressed all points: new `src/providerEnablement.ts` pure module + root-config reads, agent-vendor guard fixed, `providerEnablement` regression tests added (171/171), rebased onto current `main` (no conflicts; `when` clauses kept). Kept `autoEnableAgentsWindow` default `true` deliberately (documented, tracked, revertible, one-time reload notification); maintainer agreed.
3. **2026-08-11 — Merged** as a merge commit (`3001d68`). Merge strategy: **merge commit, not squash**. Issue #122 closed as completed.

---

## Prevention Notes

- **Never read a full-key setting (`opencodezen.enabled`) through a section-scoped config** (`getConfiguration("opencodego")`) — VS Code resolves keys relative to the section, silently producing `opencodego.opencodezen.enabled`. Use the root config (`getConfiguration().get(key, ...)`) or `providerEnabledSetting()`.
- **Do not reintroduce `managementCommand`** on providers that declare a `configuration` schema — it short-circuits the native BYOK flow (see `docs/issues/57-20260811-pr124-managementcommand-byok-flow.md`). PR #125's `when` clauses are the correct way to gate vendor visibility.
- **Agent-host variants** (`*-agent`, `targetChatSessionType: "copilotcli"`) are only needed for VS Code ≤1.128. On 1.129+ the BYOK bridge (`chat.agentHost.byokModels.enabled`) is the mechanism; keep both for now.
- `tmp/` is git-ignored and excluded from the VSIX — keep temporary working copies there, never commit them.

---

## Related Docs

- `docs/features/06-20260614-agents-window-model-visibility.md` — original Agents window feature (PR #39/#42, agent variants, manual `extensions.supportAgentsWindow`); the VS Code ≥1.129 BYOK-bridge path documented here supersedes the manual setup step.
- `docs/issues/57-20260811-pr124-managementcommand-byok-flow.md` — dropped `managementCommand` (PR #124, #121); PR #125 adds `when` clauses on top without reintroducing it.
- `docs/architecture/01-20260514-open-code-provider-architecture.md` — provider architecture; timeline updated for PR #125.
- `CHANGELOG.md` — `[Unreleased] → Added` entries for both halves of this PR.
