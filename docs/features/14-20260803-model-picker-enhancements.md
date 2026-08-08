**Status:** ✅ Solved

# Model Picker Enhancements — Provider Prefix Toggle & Kimi Context Selector

**Topic:** models / provider / byok / vscode
**Updated:** 2026-08-05
**Tags:** #models #provider #byok #vscode
**Issues:** [#92](https://github.com/ltmoerdani/opencode-copilot-chat/issues/92), [#87](https://github.com/ltmoerdani/opencode-copilot-chat/issues/87)
**PR:** [#102](https://github.com/ltmoerdani/opencode-copilot-chat/pull/102) by [@Wallacy](https://github.com/Wallacy)
**Released:** `v0.5.0` (2026-08-05)

---

## Overview

Two independent improvements to the Copilot Chat model picker, both driven by the per-model configuration schema and extension settings. Together they reduce visual noise in narrow chat panes and expose Kimi's tiered pricing context window as a first-class selector.

---

## Feature 1: Optional Provider Prefix (#92)

### Problem

Models appeared in the picker as `OpenCode Go / DeepSeek V4 Flash`. Copilot already renders the provider separately for each row, so the prefix in the model name was redundant. In a narrow chat view the selected model name was truncated before the actual model identifier, forcing users to widen the chat pane to roughly one-third of the screen just to read which model was active.

### Solution

New setting `opencodego.showProviderPrefix` (default `true`, preserving existing behavior). When set to `false`, model names display only the formatted model name without the `OpenCode Go` / `OpenCode Zen` prefix.

```json
"opencodego.showProviderPrefix": false
```

Changing the setting fires `notifyModelInfoChanged()` on all four registered providers (Go, Zen, Agent Go, Agent Zen) so the picker refreshes immediately without a window reload.

### Implementation

- New module `src/modelNames.ts` exports `formatModelName(modelId)` (extracted from `extension.ts`) and `providerModelDisplayName(providerPrefix, modelId, showProviderPrefix)`.
- `formatModelName` preserves the existing numeric-version joining logic (e.g. `gpt-5-6-luna` → `Gpt 5.6 Luna`).
- `provideLanguageModelChatInformation` reads the setting at call time and passes it to `providerModelDisplayName`.
- The configuration-change listener in `activate()` detects `opencodego.showProviderPrefix` and calls `notifyModelInfoChanged()` on every provider in the `modelInfoProviders` array.

### What is display-only

Model selection, session persistence, and request routing use the model `id`, not the display name. Toggling the prefix does not affect any downstream behavior.

---

## Feature 2: Kimi Context-Size Selector (#87)

### Problem

Kimi K3 exposes a cheaper 256K context mode alongside its larger advertised window, but the model picker had no way to select between them. Users were locked to the full context window with no way to opt into the cheaper tier.

### Solution

The per-model configuration schema now exposes a `contextSize` picker for Kimi models whose resolved metadata advertises more than 256K tokens. The schema offers:

- **256K** — labeled "Default pricing", selected by default.
- **Full window** (e.g. 1M) — labeled "Higher pricing".

### Implementation

New function `getContextSizeOptionsForModel(modelId, cost, fullContextWindow)` in `src/metadata.ts`:

1. **Defer to `models.dev` first.** If the model's cost metadata already publishes explicit context tiers (`cost.tiers[]` with `tier.type === "context"`), those tiers are used as-is. This means the Kimi selector does not override or duplicate pricing data that models.dev already provides correctly.
2. **Synthesize tiers only as fallback.** For Kimi models (`/^(?:kimi-|k3(?:-|$))/i`) whose `fullContextWindow > 262_144` and have no explicit tiers, synthesize the 256K + full-window pair.
3. **Skip fixed-size Kimi models.** If the model's whole window is 256K (≤262_144 binary), no selector is added — there is no second tier to offer.

### Why 262_144

256K is commonly published as 262,144 (binary 256K) in token-window specs. The guard `fullContextWindow <= 262_144` prevents exposing a fake second tier for models whose entire window is already the "default" tier.

---

## Files

| File | Change |
|------|--------|
| `src/modelNames.ts` | New: `formatModelName` (extracted), `providerModelDisplayName` |
| `src/metadata.ts` | New: `getContextSizeOptionsForModel` (Kimi-aware tier synthesis) |
| `src/extension.ts` | Import `getContextSizeOptionsForModel` + `providerModelDisplayName`; `modelInfoProviders` array for setting-change refresh; config listener for `showProviderPrefix` |
| `package.json` | New setting `opencodego.showProviderPrefix` |
| `src/test/modelNames.test.ts` | New: numeric version formatting, prefix on/off |
| `src/test/metadata.test.ts` | New: Kimi tier synthesis, `k3` short id, 256K-boundary skip, models.dev precedence |

---

## References

- Issue docs: [`docs/issues/45-20260803-issue92-provider-prefix.md`](../issues/45-20260803-issue92-provider-prefix.md), [`docs/issues/46-20260803-issue87-kimi-context-size.md`](../issues/46-20260803-issue87-kimi-context-size.md)
- Related: [`docs/features/06-20260614-agents-window-model-visibility.md`](06-20260614-agents-window-model-visibility.md) (agent-host model registration, also refreshed by `notifyModelInfoChanged`)
