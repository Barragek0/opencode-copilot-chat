**Status:** 🟢 Active

# Inline Code Suggestions (Ghost Text) — Experimental (#49)

**Topic:** autocomplete / inline-completions / ghost-text / fim / qwen / provider
**Updated:** 2026-08-13
**Tags:** #autocomplete #inline-completions #ghost-text #fim #qwen #provider #feature
**GitHub Issue:** [#49](https://github.com/ltmoerdani/opencode-copilot-chat/issues/49)
**PR:** [#136](https://github.com/ltmoerdani/opencode-copilot-chat/pull/136) (+ #138 for the review fixes)
**Related:** Issue doc [`25-20260617-inline-completions-fim-research.md`](../issues/25-20260617-inline-completions-fim-research.md)

---

## Overview

Ghost-text inline completions (Copilot-style) while typing, powered by the OpenCode gateway with **thinking forced off**. The feature is **opt-in** (`opencodego.inlineSuggestions`, default `false`) and **experimental**. Merged via PR #136 (2026-08-13, merge commit `7df19f4`); the five maintainer review points were addressed in the stacked PR #138 (merge commit `616d6f6`).

## Engine Decision (live-measured, not assumed)

OpenCode exposes **no FIM endpoint** (`/completions` probed 404 on `zen/go`/`zen`/`beta`), and every opencode-go model is reasoning-first. A live latency probe (`scripts/probe-completion-latency.ts`, key from env only) measured:

| Model                                        | TTFB       | Total      | Hidden reasoning             |
| -------------------------------------------- | ---------- | ---------- | ---------------------------- |
| `deepseek-v4-flash` (no `reasoning_effort`)  | 1813ms     | 2264ms     | 128 chars — non-viable       |
| **`qwen3.5-plus` (`enable_thinking=false`)** | **1518ms** | **1608ms** | **0 — genuine non-thinking** |

So the default engine is **`qwen3.5-plus` with `enable_thinking: false`** — zero hidden reasoning, ~1.5s time-to-first-token. DeepSeek is intentionally **not** the default (burns hidden reasoning tokens even with thinking off).

## How It Works

Because the gateway exposes no FIM endpoint, completions **emulate fill-in-the-middle** with FIM tokens (`<|fim_prefix|>…<|fim_suffix|>…<|fim_middle|>`) sent inline over `/chat/completions`. The `suffix` field is tolerated by the gateway (probed HTTP 200) but not relied on — FIM emulation works even if the gateway ignores the field.

### Module Layout (`src/autocomplete/`, 8 files, 15 unit tests)

| File          | Role                                                                                                           |
| ------------- | -------------------------------------------------------------------------------------------------------------- |
| `context.ts`  | bounded prefix/suffix window (10 lines before cursor, short suffix), pure + unit-tested                        |
| `prompt.ts`   | fill-in-the-middle emulation with FIM tokens; Qwen family sends `enable_thinking: false`                       |
| `throttle.ts` | 300ms debounce, latest-wins, superseded runs aborted (`Debouncer`), live `delayMs` resync                      |
| `engine.ts`   | streamed chat-completions engine, 3s timeout, cancellation (AbortSignal), pure SSE parsing, failure logging    |
| `provider.ts` | `InlineCompletionItemProvider` (single insert at cursor), all timing/size knobs config-driven                  |
| `index.ts`    | registration; key resolved per request (profile key → secret); dedicated "OpenCode Completions" output channel |
| `types.ts`    | `CompletionContext` / `CompletionResult` / `CompletionEngine` contract                                         |
| `usage.ts`    | per-day Suggested/Approved counters (from #138) — persisted in globalState, charted in the usage panel         |

## Cancellation & Timing

- **Debounce:** 300ms after the last keystroke (`inlineSuggestionsDebounceMs`). Live — a pending run reschedules when the setting changes.
- **Cancellation:** latest keystroke aborts the in-flight request via `AbortSignal`; stale ghost text never renders.
- **Timeout:** 3s (`inlineSuggestionsTimeoutMs`); the ghost text simply does not appear.
- **Context window:** tiny by design (10 lines before cursor + short suffix) to keep payloads fast.

## Settings (all under `opencodego.`)

| Setting                        | Default        | Notes                                                                            |
| ------------------------------ | -------------- | -------------------------------------------------------------------------------- |
| `inlineSuggestions`            | `false`        | Opt-in master switch; requires a window reload                                   |
| `inlineSuggestionsModel`       | `qwen3.5-plus` | Dropdown: `qwen3.5-plus` / `qwen3.6-plus` / `qwen3.7-plus` / `deepseek-v4-flash` |
| `inlineSuggestionsDebounceMs`  | `300`          | 50–2000                                                                          |
| `inlineSuggestionsTimeoutMs`   | `3000`         | 500–15000                                                                        |
| `inlineSuggestionsMaxTokens`   | `128`          | 16–1024                                                                          |
| `inlineSuggestionsPrefixLines` | `10`           | 1–100                                                                            |
| `inlineSuggestionsSuffixChars` | `300`          | 0 disables the suffix                                                            |

## Review Fixes (merged via #138)

The five maintainer review points on #136 were addressed in #138 (and therefore landed on `main` with #138):

1. **Key fallback** — `registerInlineCompletions` resolves the key like the chat path: active profile key first, then the global secret (commit `5da9b6c`).
2. **Failure logging** — the engine logs every failure (network error, non-OK status, mid-stream interruption) to the "OpenCode Completions" output channel (commit `5da9b6c`).
3. **Usage cost attribution** — acknowledged; per-day **Suggested / Approved** counters ship (usage.ts + usage panel), but wiring the USD cost into `tracker.record()` is a documented follow-up (CHANGELOG known limitation).
4. **Live debounce knob** — `Debouncer.delayMs` reschedules a pending run on config change (commit `68c3eb6`).
5. **Indentation** — `cleanCompletion` strips leading spaces/tabs but preserves leading newlines so nested-line continuations keep their indentation (commit `5da9b6c`).
6. **`qwen3.7-plus`** added to the bundled Go fallback model list + metadata snapshot (commit `1c26fd1`).

## Known Limits

- VS Code's own BYOK inline-completion path (`microsoft/vscode#318545`) is still open, so this is a **standalone provider**. If GitHub Copilot's ghost text is active it can win the same slot; users can disable Copilot's via `editor.inlineSuggestions.enabled` / `github.copilot.nextEditSuggestions.enabled`.
- Inline-completion request **cost is not yet attributed** in the Go usage tracker (follow-up planned — the engine uses a raw fetch today).
- Acceptance detection is heuristic (VS Code has no stable acceptance event): an insert starting at the suggestion position with matching multi-character text within a 30s window counts as approved.

## Verification

- `npm test` — 15 autocomplete unit tests among the suite (207 at #136 merge base, 276 after #138).
- `npm run lint` — strict (ESLint + tsc + prettier + markdownlint) green.
- `.vscodeignore` updated so `out/autocomplete/` is packaged into the VSIX (without it the feature would silently vanish from the release).
