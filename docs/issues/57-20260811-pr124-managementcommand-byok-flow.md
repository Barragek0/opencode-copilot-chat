# PR #124 — Drop `managementCommand` to Restore Native BYOK Group Flow

**Status:** ✅ Solved (merged, merge commit `43a55c60`, 2026-08-10T23:38:09Z)
**Topic:** vscode / byok / provider / configuration / languageModelChatProviders
**Updated:** 2026-08-11
**Tags:** #vscode #byok #provider #managementCommand #languageModelChatProviders #bugfix #community
**Related:** Issue [#121](https://github.com/ltmoerdani/opencode-copilot-chat/issues/121) (closes), PR [#124](https://github.com/ltmoerdani/opencode-copilot-chat/pull/124)
**Author:** [@Fahad090NP](https://github.com/Fahad090NP)
**Branch:** `fix/issue-121-manage-models-unresponsive`
**Supersedes:** none

---

## Overview

The `languageModelChatProviders` contributions in `package.json` declared **both** `managementCommand` and a `configuration` schema. VS Code's native BYOK flow short-circuits on `managementCommand`, so the built-in "+ Add Models" and provider-group context-menu actions never worked for OpenCode Go / OpenCode Zen. This PR drops `managementCommand` from the four provider contributions so the native BYOK flow runs end-to-end.

---

## Problem (#121)

### Reported symptoms

1. **Context menu unresponsive** — _Rename Group_, _Update API Key_, _Delete_, and _Open in Language Models (JSON)_ did nothing when clicked.
2. **"+ Add Models" dead** — clicking _OpenCode Go_ or _OpenCode Zen_ under **+ Add Models** did not prompt for a group name or API key and never created a group.
3. **Leftover default group cannot be removed** — the `OpenCode Go` group persisted in `chatLanguageModels.json` (e.g. created by per-model `reasoningEffort` configuration) could never be deleted.

### Root cause

Verified against the VS Code source (`src/vs/workbench/contrib/chat/common/languageModels.ts`), `configureLanguageModelsProviderGroup()`:

```ts
if (vendor.managementCommand) {
  await this._resolveAllLanguageModels(vendor.vendor, false);
  return; // ← short-circuit: re-resolve models only, never prompt/create a group
}
// ...only below this point does VS Code prompt for a group name + configuration
//     and create the BYOK group in chatLanguageModels.json
```

Because the provider declared `managementCommand`, VS Code **short-circuited** — it re-resolved the model list and returned, never prompting for a group name or API key and never writing a group into `chatLanguageModels.json`. Consequences:

- No BYOK group could ever be created through "+ Add Models".
- Every built-in context-menu action operates on groups in `chatLanguageModels.json`; with no group present they threw `Language model provider group … not found` and failed silently.
- The leftover group (created by per-model `reasoningEffort` configuration) could not be deleted because the delete flow targets groups in `chatLanguageModels.json` keyed by vendor + group name.

`managementCommand` is also marked **deprecated** in VS Code's contribution schema (see below), so removing it aligns with where the platform is heading.

---

## Fix

Removed `managementCommand` from the four `languageModelChatProviders` contributions:

- `opencodego` → removed `"managementCommand": "opencodego.manage"`
- `opencodezen` → removed `"managementCommand": "opencodezen.manage"`
- `opencodego-agent` → removed `"managementCommand": "opencodego.manage"`
- `opencodezen-agent` → removed `"managementCommand": "opencodezen.manage"`

With only the `configuration` schema present, VS Code's native BYOK flow runs end-to-end:

- **+ Add Models** now prompts for a group name + API key and creates the group.
- **Rename / Update API Key / Delete / Open in Language Models (JSON)** now work against that group.
- The stale/leftover group can finally be deleted.

The extension's own management commands (`OpenCode Go: Manage Provider`, `OpenCode Go: Set API Key`, and the Zen equivalents) remain registered in `contributes.commands` and keep working from the Command Palette as the **legacy secret-storage path**, which the provider continues to fall back to (`getConfiguredApiKey` → `SecretStorage`, see `provideLanguageModelChatInformation`).

---

## Files Changed

| File           | Change                                                                                                |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| `package.json` | Removed `managementCommand` from `opencodego`, `opencodezen`, `opencodego-agent`, `opencodezen-agent` |
| `CHANGELOG.md` | New `[Unreleased] → Fixed` entry for #121                                                             |

No `src/` changes — this is a manifest-only fix.

---

## Why This Is Correct (Evidence)

1. **VS Code source confirmation** — the `if (vendor.managementCommand)` short-circuit is real (`languageModels.ts` `configureLanguageModelsProviderGroup`). With `managementCommand` present, VS Code never reaches the group-name / configuration prompts.
2. **Official contribution-point docs** mark `managementCommand` as deprecated:

   > `managementCommand` — Deprecated. Use `configuration` instead. Command ID that opens a UI for managing this provider.

   And `configuration` is documented as "the recommended way to let users configure a provider."

3. **No auth regression** — `provideLanguageModelChatInformation` / `provideLanguageModelChatResponse` already fall back to the extension's `SecretStorage` via `getConfiguredApiKey` when `options.configuration.apiKey` is absent, so users who set the key through the legacy commands keep working.

### Minor UX trade-off (agent vendors)

The "+ Add Models" dropdown in VS Code lists vendors with `managementCommand || configuration` (`updateAddModelsButton()` in `chatModelsWidget.ts`). After this change:

- The agent vendors (`*-agent`) no longer appear in "+ Add Models" — acceptable, since clicking them was previously a dead short-circuit too.
- The gear "Manage (Agents)…" entry in the Manage Language Models panel is no longer rendered for agent vendors (that branch is `else if (vendorEntry.vendor.managementCommand)`). Only relevant when `opencodego.showAgentModelsInManagePanel` is `true` (default `false`); the commands remain reachable from the Command Palette.

> **Note — not affected by PR #125 (#122):** the _base_ providers `opencodego` / `opencodezen` DO appear in the Agents window's "+ Add Models" list since PR #125 auto-enables the BYOK agent-host bridge (`chat.agentHost.byokModels.enabled` + `extensions.supportAgentsWindow`). That is the base vendor flow, separate from the `*-agent` variant vendors discussed above. PR #125 also added `when` clauses (`config.opencodego.enabled` / `config.opencodezen.enabled`) to the contributions but did **not** reintroduce `managementCommand`, so the native BYOK group flow from this PR stays intact.

---

## Verification

- [x] Installed the packaged VSIX on VS Code 1.132 — "+ Add Models → OpenCode Go" now prompts and creates the group; gear/context-menu actions work; the leftover group is deletable (author).
- [x] `npm run compile` — clean (author + maintainer).
- [x] `npm test` — 161/161 pass (author).
- [x] `npm run lint` — clean (author).
- [x] CI — build + GitGuardian pass on the PR.
- [x] Base branch — PR based on latest `main`, no conflict.
- [x] Manifest/JSON — no lint or schema errors in `package.json`.

---

## Review & Merge

1. **2026-08-11 — Maintainer review (@ltmoerdani).** Verified the short-circuit theory against VS Code source; confirmed `managementCommand` is deprecated in the contribution schema; confirmed legacy commands remain registered; no test touches the manifest (161/161 unaffected). Verdict: fix correct, safe to merge.
2. **2026-08-10 — Merged** as a merge commit (`43a55c60`) preserving the contributor's single commit (`f778835a`). Merge strategy: **merge commit, not squash**.

---

## Prevention Notes

- Do **not** re-add `managementCommand` to `languageModelChatProviders` while a `configuration` schema is present — it short-circuits the native BYOK flow and reopens #121.
- If a future provider needs a custom manage UI, prefer the deprecated-but-still-available `managementCommand` **only** for providers that do **not** declare a `configuration` schema, or drive the manage UI entirely from `contributes.commands` (Command Palette) as this extension already does.

---

## Related Docs

- `docs/architecture/01-20260514-open-code-provider-architecture.md` — provider architecture + configuration-commands table (updated for this PR).
- `docs/issues/43-20260803-issue86-zen-nonagent-0-models.md` — the `options.configuration` semantics and SecretStorage fallback that this fix relies on.
- `docs/issues/48-20260805-issue106-zen-duplicate-models.md` — BYOK group bookkeeping (`hasConfiguredByokGroup`) referenced in the key-resolution flow.
- PR [#125](https://github.com/ltmoerdani/opencode-copilot-chat/pull/125) (issue [#122](https://github.com/ltmoerdani/opencode-copilot-chat/issues/122)) — added `when` clauses (`config.opencodego.enabled` / `config.opencodezen.enabled`) and the Agents-window BYOK bridge on top of these contributions; did not reintroduce `managementCommand`.
- `docs/issues/55-20260811-pr123-deepseek-reasoning-content-echo.md` — adjacent reasoning-history fix merged the same day (#123 + follow-up #126).
