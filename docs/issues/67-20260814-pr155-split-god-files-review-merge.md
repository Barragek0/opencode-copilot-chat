**Status:** ✅ Solved

# PR #155 — Split God Files into Domain Modules + Data-Driven Model Registry (merged)

**Topic:** refactor / architecture / registry / thinking / api-key / byok / streaming / usage
**Updated:** 2026-08-15
**Tags:** #refactor #architecture #registry #thinking #api-key #byok #streaming #usage #provider #models #transports
**PR:** [#155](https://github.com/ltmoerdani/opencode-copilot-chat/pull/155) (`refactor/split-god-files`, merged 2026-08-14, merge commit `a95565f`)
**Author:** [@xianhongtao](https://github.com/xianhongtao)
**Supersedes:** open-PR tracker [`63-20260813-open-prs-133-135-136-tracker.md`](63-20260813-open-prs-133-135-136-tracker.md) (registry part)

---

## Overview

A large contributor PR that splits the three god files — `src/extension.ts` (4,653 lines), `src/streaming.ts` (1,620) and `src/goUsageTracker.ts` (1,510) — into domain modules (behavior-preserving), and adds a **data-driven model registry** so per-model wiring (transport + thinking family) lives in one table. Diff: **+9,195/−8,009, 87 files, 24 commits** (includes internal merges of already-merged PRs #152/#154; final diff against `main` was clean).

This doc records the maintainer review (2026-08-14) and merge. The feature-level living reference lives in [`17-20260814-data-driven-model-registry.md`](../features/17-20260814-data-driven-model-registry.md).

## What Landed (final structure)

### `src/usage/` — Go usage domain (from `goUsageTracker.ts` 1,510)

- `tracker.ts` — `GoUsageTracker` class + types + time-window helpers
- `history.ts` — OpenCode CLI SQLite read/aggregation (pure)
- `pricing.ts` — bundled pricing snapshot + `estimateCost` (pure)
- `formatting.ts` — status-bar / quick-pick formatting
- `dashboard.ts` — status bar + usage webview + tooltip SVG
- moved `usage.ts` / `usageProfile.ts` / `goUsageSync.ts` in

### `src/transports/` — one file per transport (from `streaming.ts` 1,620)

- `chatCompletions.ts` / `responses.ts` / `anthropic.ts` / `google.ts` — one entry per transport
- `engine.ts` — shared HTTP+SSE streaming engine + retry/backoff
- `sse.ts` — pure SSE data-line parser
- `extractors.ts` / `extract.ts` — response extractors + non-stream helpers
- `streamParts.ts` — progress/thinking part emission
- `thinkTags.ts` — pure inline `<think>` tag stripper
- contract types in `src/core/transport.ts`; routing in `src/core/routing.ts`

### `src/thinking/` — per-provider strategy classes

- `provider.ts` (interface + factory), `base.ts` (shared base), `types.ts` / `schema.ts` / `payload.ts` / `resolve.ts`
- one class per family: `deepseek` / `glm` / `kimi` / `minimax` / `openai` / `qwen` / `mimo` / `fallback`
- `thinking.ts` kept as a thin barrel re-exporting the historical public API

### `src/provider/` — `OpenCodeProvider` class + support

- `OpenCodeProvider.ts`, `definitions.ts` (PROVIDERS table + model types), `messages.ts` / `tokens.ts` (conversion + token estimation), `settings.ts`, `visionProxy.ts`

### `src/models/` — model metadata domain

- `metadata.ts`, `modelLimits.ts`, `modelCapabilities.ts`, `modelNames.ts`, `pricing.ts`, `metadataFetcher.ts` (models.dev cache)

### `src/commands/` — command handlers

- `providers.ts` / `agentsWindow.ts` / `diagnostics.ts` / `thinkingPicker.ts`

### `src/request/` — per-endpoint request builders

- `openai.ts` / `anthropic.ts` / `google.ts` + `types.ts` / `schema.ts` / `shared.ts` / `headers.ts`

### `src/core/registry.ts` — data-driven model registry (NEW)

- `MODEL_REGISTRY`: 11 family rows + catch-all → `{ endpointKind, sdkPackage, thinkingFamily, vendors? }`
- `resolveModelRouting()` (transport) and `thinkingFamily()` both read it
- Adding a model family = one row (+ optionally a thinking strategy class)

### Entry point

- `extension.ts` is now a thin entry (~415 lines) that only wires activation + command registration
- compat barrels `streaming.ts` / `goUsageTracker.ts` **removed**; every importer references canonical paths

## Behavior-Preserving Verification (maintainer, 2026-08-14)

Independent verification on a worktree at the PR head:

| Check                                                           | Result                                                                                                                         |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `npm run compile`                                               | ✅ clean                                                                                                                       |
| `npm test`                                                      | ✅ **310/310** (PR listed 305; the registry work added a few)                                                                  |
| `npm run test-retry` (mock-server E2E)                          | ✅ 7/7                                                                                                                         |
| `npx eslint src/`                                               | ✅ clean (exit 0)                                                                                                              |
| `any` / `TODO` / `FIXME` in new code                            | ✅ none                                                                                                                        |
| Routing diff (old `routing.ts` vs `core/routing.ts` + registry) | 🟢 identical (gpt→responses, claude→messages, minimax-m2 Go→messages/Zen→chat, qwen-messages, gemini Zen→google, default→chat) |
| `thinkingFamily()` + payload mapping                            | 🟢 identical (deepseek/glm/kimi/minimax/openai/qwen/mimo)                                                                      |
| SSE parser                                                      | 🟢 byte-identical (`parseServerSentEvent`)                                                                                     |
| Command registration                                            | 🟢 only `opencodego.setApiKey` removed (intentional), 18 other commands intact                                                 |
| Diff cleanliness                                                | 🟢 PR #152/#154 already in `main`, no stray files                                                                              |

### Review points raised & disposition

1. **API key migration gap (Zen).** Previously Go and Zen shared one `opencodego.apiKey` secret; the PR splits them (`opencodezen.apiKey` added). Users who set the Zen key via the old `Set API Key` command have it in `opencodego.apiKey`, so after this change Zen reads an empty slot until re-added via BYOK. **No one-time migration in the PR.** Decision: not a merge blocker (recovery path exists via BYOK), but a **follow-up migration is required before release** — see [Follow-up](#follow-up-before-release).
2. **Thinking "single config authority" is a behavior change.** The `globalState` shadow copy of thinking config is removed; VS Code per-model config is the single authority (workspace settings + per-family defaults as fallbacks). This fixes one model's thinking effort leaking onto another. It's a real behavior change (not pure refactor) — deserves a manual live spin before release.
3. **Merge strategy:** merge commit (`--merge`), not squash — all 24 contributor commits preserved. ✅ executed.

## API Key Handling Change

- `OpenCode Go/Zen: Set API Key` commands and the Set/Clear items inside `Manage Provider` are **removed** from `package.json`.
- Keys are now configured exclusively through VS Code's native BYOK flow (**Chat: Manage Language Models → "+ Add Models"**).
- `SecretStorage` stays as an internal **per-vendor mirror**: `opencodego.apiKey` / `opencodezen.apiKey` (new `secretKeyFor(vendor)` helper in `src/config.ts`). The BYOK resolution writes it so agent-host variants and cold-start requests inherit the group key.
- `Refresh Models` / `Test Connection` now point at the BYOK flow when no key is configured.
- Fixes the latent collision where Go and Zen shared a single secret and overwrote each other's key.

## Verification (author-reported, in PR)

- Live F5 Debug host session calling **DeepSeek V4 Flash** through the refactored transport path (streaming, reasoning, tool calls) — no issues.
- `npm run compile` clean · `npm test` 305/305 (incl. 14 new `registry.test.ts`) · `npm run test-retry` 7/7 · `npm run lint` fully green · `npm run package` VSIX (105 files, 2.67 MB).

## Follow-up (before release)

1. **Zen API key one-time migration** — copy legacy `opencodego.apiKey` into the `opencodezen.apiKey` slot on activation when the Zen slot is empty and Go holds no separate key (or document explicitly as a breaking change in release notes). Tracked as a TODO in the release plan.
2. **Post-merge validation** — the merge does **not** imply an immediate release. Run a longer live session across several models and both vendors, plus the full suite, before cutting the next release. This is a large behavior-surface change (thinking refactor + API-key entry point).
3. **Remaining architecture candidates** (from `docs/architecture/02-...` migration plan): full `ModelTransport` port interface, usage webview HTML → own file — still future work, not part of this PR.

## Merge

- Merge commit `a95565f` (2026-08-14), **merge commit** (not squash) — contributor history preserved.
- CHANGELOG `[Unreleased]` updated by author (4 changed entries + 1 fixed entry).
- `docs/architecture/02-...` timeline updated by author.
- Devlog updated; this issue doc added post-merge.

## Related

- Feature doc [`17-20260814-data-driven-model-registry.md`](../features/17-20260814-data-driven-model-registry.md) — living reference for the registry + god-file split.
- Architecture doc [`02-20260809-provider-adapter-architecture.md`](../architecture/02-20260809-provider-adapter-architecture.md) — the plan this PR executes (Strangler Fig phase).
- Feature doc [`02-20260517-per-model-thinking-controls.md`](../features/02-20260517-per-model-thinking-controls.md) — thinking feature (per-provider strategy refactor).
- Issue doc [`64-20260813-issue131-permodel-config-duplicate-models.md`](64-20260813-issue131-permodel-config-duplicate-models.md) — #131 fix interplay (model ID normalization).
