**Status:** ✅ Solved (merged, merge commit `fec411b`; follow-up `typeof` guard + unit tests shipped via PR #126 merge `7be0c06`, both in release `0.5.2`)

# PR #123 — Echo `reasoning_content` on Multi-Turn Thinking Requests (DeepSeek V4)

**Topic:** streaming / thinking / reasoning / provider / community-pr
**Updated:** 2026-08-11
**Tags:** #thinking #reasoning #reasoning-content #deepseek #multi-turn #community-pr
**Supersedes:** —

---

## Overview

Full review cycle for community contributor PR #123 by [@Fahad090NP](https://github.com/Fahad090NP), which fixes the repeated `HTTP 400: The reasoning_content in the thinking mode must be passed back to the API` on multi-turn conversations with DeepSeek V4 Flash and other OpenAI-compatible reasoning models.

This is the mirror image of the MiMo carve-out in issue #38: DeepSeek's upstream validator **requires** the previously emitted `reasoning_content` to be echoed back unchanged, while MiMo's validator **rejects** it. The extension must therefore gate the echo by model family.

---

## Problem

Using DeepSeek V4 Flash (or another OpenAI-compatible reasoning model) in Copilot Chat, every follow-up turn after the first thinking turn failed with:

```text
OpenCode Go API request failed (400) model=deepseek-v4-flash payloadBytes=150659:
Error from provider (Console Go): Upstream request failed:
[invalid_request_error] The reasoning_content in the thinking mode must be passed back to the API.
```

### Root Cause

`convertMessage()` in `src/extension.ts` iterates `message.content` and routes each part. `LanguageModelThinkingPart` instances coming from assistant history were not handled explicitly, so they fell through to `partToText()`, which returns `""` for any part type it does not recognize. The thinking text was therefore **silently dropped** from the history sent on follow-up turns, and DeepSeek's upstream validator 400s when the previously emitted `reasoning_content` is missing.

---

## Solution

PR #123 (commit `fec411b`, single file `src/extension.ts`, **+70/−1**) adds thinking-text extraction and echo:

### 1. Extract thinking text from history

A new `thinkingTextParts` array collects text from `LanguageModelThinkingPart` parts via the new `thinkingPartText()` helper (handles both `string` and `string[]` `value` shapes). The thinking text never leaks into the visible assistant `content`, because `partToText()` still returns `""` for thinking parts.

### 2. Echo as `reasoning_content` on assistant history messages

- **Tool-call assistant messages** (existing branch): `reasoning_content: shouldOmitReasoningEcho ? undefined : (reasoningForToolCalls(...) ?? thinkingText)`. The tool-call reasoning cache (`reasoningContentByToolCallId`) stays the primary source; history thinking becomes the fallback when the cache misses.
- **Plain assistant messages** (new branch): `reasoning_content: shouldEchoThinkingHistory(rawModelId) ? thinkingText : undefined`. Previously these messages were emitted without any reasoning field.

### 3. Family gating — `shouldEchoThinkingHistory()`

| Family                      | Echo?              | Reason                                                                    |
| --------------------------- | ------------------ | ------------------------------------------------------------------------- |
| DeepSeek                    | ✅ Yes             | **REQUIRED** by upstream (HTTP 400 if omitted)                            |
| Gemini                      | ✅ Yes             | `googleContentsFromMessages()` maps it to `{ text, thought: true }` parts |
| GLM / Kimi / Qwen / MiniMax | ✅ Yes (tolerated) | Cross-turn reasoning continuity                                           |
| MiMo                        | ❌ No              | Strict Pydantic-style validator rejects it (issue #38)                    |
| GPT                         | ❌ No              | OpenAI Responses API messages carry no `reasoning_content` field          |
| Claude                      | ❌ No              | Anthropic Messages API has no `reasoning_content` field                   |
| Unknown                     | ❌ No              | Left untouched (no echo)                                                  |

---

## Verification

Local review performed in a **separate worktree** (branch `review/pr-123`), leaving the `main` working tree untouched:

| Check                                             | Result          |
| ------------------------------------------------- | --------------- |
| `npm run compile`                                 | ✅ PASS         |
| `npm run lint` (eslint + prettier + markdownlint) | ✅ PASS         |
| `npm test`                                        | ✅ 161/161 pass |

Transport tracing confirmed:

- `googleContentsFromMessages()` (`src/extension.ts`) already reads `message.reasoning_content` and emits it as a `{ text, thought: true }` part — the Gemini echo is necessary and safe.
- `responsesInputItemsFromMessage()` (`src/responsesRequest.ts`) and `anthropicAssistantBlocks()` (`src/extension.ts`) do **not** read `reasoning_content` — GPT and Claude simply ignore the field, so nothing leaks into the Responses or Anthropic transports.
- The MiMo carve-out from issue #38 (`shouldOmitReasoningEcho`) remains intact in both echo paths.

---

## Review Notes (non-blocking)

1. `part instanceof vscode.LanguageModelThinkingPart` lacks the `typeof vscode.LanguageModelThinkingPart === "function"` runtime guard that `src/streaming.ts` uses. Safe on the supported engine (`^1.125.0`), but consistency would be preferable.
2. `shouldEchoThinkingHistory()` and `thinkingPartText()` are pure functions with **no unit tests**. Family gating is regression-prone (lesson from issue #38) — extracting them to a pure module (like `src/thinking.ts`) with tests is a worthwhile follow-up.

---

## Related Work

- Issue #38 — [`38-20260725-top-level-image-size-guard.md`](38-20260725-top-level-image-size-guard.md): MiMo **rejects** `reasoning_content` echo in tool-call history (the inverse of this fix).
- Upstream `anomalyco/opencode#36354` — DeepSeek V4 `reasoning_content` echo handling in the OpenCode gateway.
- Feature — [`02-20260517-per-model-thinking-controls.md`](../features/02-20260517-per-model-thinking-controls.md): per-model thinking controls.
- Issue — [`33-20260709-thinking-part-byok-surfacing-research.md`](33-20260709-thinking-part-byok-surfacing-research.md): surfacing reasoning as `LanguageModelThinkingPart`.

---

## Merge & Follow-up

- **Merged** with a **merge commit** (never squash — contributor commit `fec411b` preserved), 2026-08-10.
- **PR #126** (merged 2026-08-11, merge commit `7be0c06`) addressed the two review notes: added the `typeof vscode.LanguageModelThinkingPart === "function"` runtime guard to `thinkingPartText()`, extracted `shouldEchoThinkingHistory` + the value-normalization logic into a new pure module `src/reasoningHistory.ts`, and added a +16-test suite (177/177 pass). Full review and merge record: `59-20260811-pr126-reasoning-history-guard-tests.md`.
- CHANGELOG `[0.5.2]` entry finalized.
- **Release 0.5.2** cut 2026-08-11. DeepSeek V4 Flash fix (#123) + follow-up (#126) both shipped. Dependabot #91 (@types/node patch) deferred to next release; #90 (TypeScript major) still pending separate verification. See `60-20260811-release-0-5-2-plan.md`.
