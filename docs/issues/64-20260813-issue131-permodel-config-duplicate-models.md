**Status:** 🟢 Active (fix PR #135 open, not yet merged as of 2026-08-13)

# Issue #131 — Duplicate OpenCode Zen / Go models after per-model config (reasoningEffort)

**Topic:** provider / byok / vscode / configuration / duplicate / per-model-config
**Updated:** 2026-08-13
**Tags:** #provider #byok #vscode #configuration #duplicate #per-model-config #reasoning-effort
**Related:** Issue [#131](https://github.com/ltmoerdani/opencode-copilot-chat/issues/131) (this issue), PR [#135](https://github.com/ltmoerdani/opencode-copilot-chat/pull/135) (fix, open), issue doc [`48-20260805-issue106-zen-duplicate-models.md`](48-20260805-issue106-zen-duplicate-models.md) (original #106), [#86](https://github.com/ltmoerdani/opencode-copilot-chat/issues/86) (SecretStorage fallback)
**Reporter:** [@xianhongtao](https://github.com/xianhongtao) (follow-up to #106)
**Extension version affected:** 0.5.2 (also present in 0.5.0/0.5.1)
**Fixed in:** Unreleased (PR #135)

---

## Overview

A user who sets their API key via the extension command (`OpenCode Zen: Set API Key` / `OpenCode Go: Set API Key`) and then changes a per-model option (e.g. `reasoningEffort`) in the model picker sees **every model listed twice** — and this is **not** covered by the #106 fix shipped in 0.5.2. The #106 fix only handles provider groups that carry an `apiKey`; the per-model configuration group carries no key, so the duplicate persists on the latest build.

This issue documents the confirmed root cause (evidence-based, from reporter data + VS Code source) and the fix proposed in PR #135.

## Problem

Reported numbers from @xianhongtao (extension 0.5.2, VS Code 1.132.1 System setup, Stable):

| Step                                                    | Zen model count |
| ------------------------------------------------------- | --------------- |
| Reload window (no per-model config)                     | 7               |
| Delete per-model group via Manage Models (Cog)          | 7               |
| Change `reasoningEffort` on one model (group recreated) | 14              |

7 unique Zen models are doubled to 14 the moment a per-model configuration group exists, and return to 7 when it is removed. Touching `reasoningEffort` recreates the group and the duplicates come straight back.

### Environment facts from the reporter

- API key set **only** via `OpenCode Go: Set API Key` → the key lives in SecretStorage, not in any provider group.
- `chatLanguageModels.json` contains three groups; the two relevant ones are **settings-only** (no `apiKey`):

```jsonc
[
  {
    "name": "OpenCode Go",
    "vendor": "opencodego",
    "settings": { "opencodego:deepseek-v4-flash::session-2026-05-21-b::sk-***": { "reasoningEffort": "max" } },
  },
  {
    "name": "OpenCode Zen",
    "vendor": "opencodezen",
    "settings": { "opencodezen:deepseek-v4-flash-free::session-2026-05-21-b::sk-***": { "reasoningEffort": "max" } },
  },
]
```

The `::sk-***` suffix is the key fingerprint (`fpEffectiveModelId`, issue #63).

## Root Cause (confirmed)

1. **Per-model config creates a settings-only group.** When the user picks a per-model option (e.g. `reasoningEffort`), VS Code's `setModelConfiguration()` / `configureModel()` writes a group into `chatLanguageModels.json` that carries only `settings` — no `apiKey`:

   ```ts
   // languageModels.ts — configureModel(): group created with only settings
   const newGroup: ILanguageModelsProviderGroup = { name: groupName, vendor: metadata.vendor, settings: { [metadata.id]: {} } };
   ```

2. **VS Code resolves one call per group for a provider with a `configuration` schema.** Our vendor declares `configuration` (with `"required": ["apiKey"]` in `package.json`), so the `!vendor.configuration` shortcut in `_resolveAllLanguageModels` does **not** skip group resolution. For each group it calls:

   ```ts
   // languageModels.ts — _resolveAllLanguageModels()
   const configuration = await this._resolveConfiguration(group, vendor.configuration);
   const models = await provider.provideLanguageModelChatInfo({ group: group.name, silent, configuration }, CancellationToken.None);
   ```

   For a settings-only group, `_resolveConfiguration()` skips `vendor`/`name`/`range`/`modelsRange`/`settings` and returns `{}` — **no `apiKey`**.

3. **ext-host drops `group`; only `{ silent, configuration }` reaches the extension.** `extHostLanguageModels.$provideLanguageModelChatInfo()` forwards only `{ silent, configuration }`, so the extension cannot tell a settings-only group apart by `group` name — it must use `configuration`.

4. **The #106 fix does not cover this path.** `provideLanguageModelChatInformation()` sets the `hasConfiguredByokGroup` flag only when `getConfiguredApiKey(opts)` returns a key. A settings-only group call arrives with `configuration: {}` → `getConfiguredApiKey` is `undefined` → the flag is never set → the SecretStorage fallback runs on **both** the groupless call (7 models) and the group call (7 more) → **14, permanently** (refresh cannot heal it because no call ever carries a key).

5. **Why delete "fixes" it.** Removing the per-model group from `chatLanguageModels.json` leaves only the groupless call, so the fallback serves one set (7). Re-picking `reasoningEffort` recreates the group → 14 again.

## Fix (PR #135)

`src/extension.ts` — `provideLanguageModelChatInformation()`, in the BYOK flag block:

```typescript
let apiKey = getConfiguredApiKey(opts);
if (apiKey) {
  await this.markByokGroupConfigured();
} else if (opts.configuration !== undefined) {
  // A group call with a non-undefined configuration that carries no API
  // key is a per-model configuration group (only `settings`, no key —
  // e.g. a `reasoningEffort` picked in the model picker). VS Code
  // resolves its configuration to `{}` here. The groupless call already
  // served the models via SecretStorage, so serving them again would
  // duplicate every model (issue #131). The per-model settings still
  // apply at request time via `modelConfiguration`.
  return [];
}
```

Discriminator rationale (verified against VS Code source): the groupless call passes **no** `configuration` (so `opts.configuration === undefined` → normal path); every group call passes a `configuration` object. A non-undefined `configuration` without an `apiKey` can therefore only be a per-model configuration group → return `[]`.

### Behavior matrix

| Scenario                                                  | Result                                                 |
| --------------------------------------------------------- | ------------------------------------------------------ |
| Key via extension command only, no per-model config (#86) | N models, single set (unchanged)                       |
| Native BYOK group with `apiKey` (#106/#63)                | N models per group, flag suppresses groupless set      |
| Per-model config group (settings-only, this issue)        | `[]` from group call; groupless call serves N once     |
| Agent variants (`*-agent`, no `configuration` schema)     | `configuration` always `undefined` → unaffected        |
| Per-model settings (reasoningEffort/contextSize)          | Still applied at request time via `modelConfiguration` |

### Files changed (PR #135)

- `src/extension.ts` — the `else if (opts.configuration !== undefined) return [];` carve-out (+19/−1 overall).
- `.github/workflows/ci.yml` — shellcheck install workaround for CI (branch hygiene, unrelated to the fix).

## Verification (PR #135, reported by author)

- `npm test` 180/180 pass.
- `npm run lint` (strict + tsc check) green.
- Scenarios preserved: #86 (key via command, no group), #106/#63 (groups carrying an `apiKey`), agent variants (no `configuration` schema → `configuration` always `undefined`).

## Review note for next session

- PR #135 `mergeable` was `UNKNOWN` at last fetch — re-fetch before merge.
- Merge as **merge commit** (`--merge`), never squash.
- After merge: update this document to `✅ Solved`, add the CHANGELOG entry (already staged under `[Unreleased]`), and reply to @xianhongtao on #106 with the fix + 0.5.3 target.

## Workaround for users before 0.5.3

- Avoid setting `reasoningEffort` per model in the picker (leave the default), **or**
- Set the key through Manage Models / "+ Add Models" instead of the extension command (the native BYOK-group path does not trigger this path).

## References

- GitHub Issue: [#131](https://github.com/ltmoerdani/opencode-copilot-chat/issues/131)
- Fix PR: [#135](https://github.com/ltmoerdani/opencode-copilot-chat/pull/135) by [@Fahad090NP](https://github.com/Fahad090NP)
- Original duplicate issue: [#106](https://github.com/ltmoerdani/opencode-copilot-chat/issues/106) — `docs/issues/48-20260805-issue106-zen-duplicate-models.md`
- SecretStorage fallback: [#86](https://github.com/ltmoerdani/opencode-copilot-chat/issues/86) — `docs/issues/43-20260803-issue86-zen-nonagent-0-models.md`
- Open PR tracker: `docs/issues/63-20260813-open-prs-133-135-136-tracker.md`
- VS Code source: `LanguageModelsService._resolveAllLanguageModels`, `_resolveConfiguration`, `configureModel`, `setModelConfiguration` (`src/vs/workbench/contrib/chat/common/languageModels.ts`); `extHostLanguageModels.$provideLanguageModelChatInfo` (`src/vs/workbench/api/common/extHostLanguageModels.ts`).
