**Status:** 🟢 Active

# PR #100 Review, Merge, and v0.4.5 Release

**Topic:** streaming / tool-calling / provider  
**Updated:** 2026-08-08  
**Tags:** #streaming #tool-calling #community-pr #deepseek #regression  
**Supersedes:** —

---

## Overview

Full review and merge cycle for community contributor PR #100 by [@xianhongtao](https://github.com/xianhongtao), which fixes a streaming regression where tool calls were flushed mid-stream before arguments finished accumulating, producing malformed `<invoke>` blocks without `<parameter>` elements and causing an unrecoverable tool-calling loop in the VS Code Chat sidebar. Covers code review, follow-up commits (version sync, naming consistency), merge plan, and post-merge live verification of the #93 path.

---

## Problem

After the 0.4.4 release (which shipped the #93 gpt-5.6-luna routing fix), models such as `deepseek-v4` / `deepseek-v4-pro` via the **OpenCode Zen** provider entered an unrecoverable tool-calling loop in the VS Code Chat panel. The model emitted an opening `<invoke>` tag with **no `<parameter>` elements** (empty arguments) and kept retrying, never converging.

- Reverting to 0.4.3 immediately resolved the issue.
- The exact same model + provider worked fine via the OpenCode CLI terminal client.
- Multiple reporters confirmed the regression originated from this extension, not GitHub Copilot itself.

Related issue: [#98 — VS Code Extension regressions cause malformed tool calls (`<invoke>` without `<parameter>`) in Chat sidebar](https://github.com/ltmoerdani/opencode-copilot-chat/issues/98)

---

## Root Cause

The #93 fix (shipped in 0.4.4) changed the flush condition in `OpenAiResponseExtractor.extractStreamParts()`:

```ts
if (
  first.finish_reason === "tool_calls"
  || (first.finish_reason == null && this.pendingToolCalls.size > 0)
) {
  const toolParts = this.flushToolCalls();
  ...
}
```

`extractStreamParts` runs **once per SSE event**. Standard OpenAI-compatible SSE streams (Go and Zen gateways alike) report `finish_reason: null` on **every intermediate chunk**, only the final chunk reports `"tool_calls"`. The new second clause fired on the **first chunk carrying a tool-call delta**, flushing an **incomplete** tool call:

1. Chunk 1: `tool_calls[{index:0, id, name, arguments:""}]`, `finish_reason: null` → condition matches → flush.
2. `flushToolCalls()` → `parseToolInput("")` → `{}` → emits a `LanguageModelToolCallPart` with **empty input**.
3. VS Code renders that as `<invoke name="...">` with **no `<parameter>`**.
4. The model receives the empty tool result and retries the call → infinite loop.

Each subsequent arguments delta chunk (also `finish_reason: null`) re-triggered the flush, dropping the real arguments fragments. Affected models: DeepSeek, Kimi, GLM, Qwen (non-plus), MiniMax (non-m2.x), MiMo.

**Why gpt-5.6-luna "worked" with the #93 fix:** the Go gateway delivered the complete tool call in a single final event (with `finish_reason: null`), so flushing at that point was harmless.

Full root-cause analysis: [`docs/issues/42-20260803-premature-tool-call-flush.md`](./42-20260803-premature-tool-call-flush.md).

---

## PR #100 Changes

**Author:** [@xianhongtao](https://github.com/xianhongtao) (external contributor)  
**Branch:** `xianhongtao/issue98` → `main`  
**Size:** +532 / −78, 8 files  
**Commits:** 3 (initial fix + 2 follow-ups from review feedback)

### Commit 1 — `b36ecf2e` "fix(streaming): flush tool calls only at stream end (fixes #98)"

Initial fix addressing the root cause:

1. **`src/toolCallAccumulator.ts` (new, pure module)** — Extracted the tool-call accumulation/flush logic into a pure module with **no `vscode` import** (mirroring the `src/thinking.ts` convention), making it unit-testable in plain Node. Exports:
   - `PendingToolCall` / `FlushedToolCall` interfaces
   - `parseToolInput(value)` (moved from `streaming.ts`)
   - `ToolCallAccumulator` class with `collect()`, `shouldFlushOnFinishReason()`, `flush()`, `flushRemainingToolCalls()`, and `size` getter
2. **`src/streaming.ts` — `OpenAiResponseExtractor`** — `pendingToolCalls` Map replaced by a `ToolCallAccumulator` instance; `extractStreamParts()` flush condition now ONLY `ToolCallAccumulator.shouldFlushOnFinishReason(first.finish_reason)` (i.e., `=== "tool_calls"`); new public `flushRemainingToolCalls(progress, localRequestId)` for end-of-stream flush.
3. **`src/streaming.ts` — transports** — `streamChatCompletions`, `streamResponsesApi`, `streamGoogleGenerateContent` each call `extractor.flushRemainingToolCalls(...)` after `await streamOpenCodeResponse(...)` and before `flushReasoningFallback`. Anthropic transport unchanged.
4. **`src/test/toolCallAccumulator.test.ts` (new)** — 15 `node:test` + `assert/strict` cases covering: multi-chunk stream emits exactly one complete call only on `"tool_calls"`; no premature flush on intermediate `null` chunks (the #93 regression); end-of-stream flush for gateways omitting `finish_reason`; edge cases (non-array deltas, args-only fragments, multiple tool calls by index, fragmented names); `parseToolInput` behavior.
5. **Docs** — CHANGELOG 0.4.5 entry, `docs/issues/42-20260803-premature-tool-call-flush.md`, `docs/devlog.md`.

### Commit 2 — `1e21425b` "chore: bump version to 0.4.5 for #98 fix"

Follow-up after review feedback flagged version inconsistency:

- `package.json`: `0.4.4` → `0.4.5`
- `package-lock.json`: `0.4.4` → `0.4.5` (2 locations)

Aligns with the CHANGELOG entry (already at `0.4.5`).

### Commit 3 — `effdea8f` "refactor: rename ToolCallAccumulator.flushRemaining to flushRemainingToolCalls"

Follow-up after review feedback flagged naming inconsistency between the accumulator's method and the extractor's method of the same purpose:

- `src/toolCallAccumulator.ts`: `flushRemaining()` → `flushRemainingToolCalls()` + JSDoc updated
- `src/test/toolCallAccumulator.test.ts`: 5 references updated (test names, assertions, docblock)

Now the method name is identical in `ToolCallAccumulator` and `OpenAiResponseExtractor`, eliminating the cognitive mismatch.

---

## Review Findings

### ✅ Strengths

1. **Accurate root cause analysis** — Author correctly identified that `finish_reason == null && pendingToolCalls.size > 0` fires on every intermediate chunk because most deltas carry `finish_reason: null`. Verified against current `main`.
2. **Right architectural call** — Extracting `ToolCallAccumulator` as a pure module (no `vscode` import, mirroring `src/thinking.ts`) makes the flush logic unit-testable, directly preventing the silent regression that shipped in 0.4.4 (no test covered the flush logic).
3. **Preserves #93** — The gpt-5.6-luna path (gateway omitting `finish_reason`) is handled via the new end-of-stream `flushRemainingToolCalls()`, called after `streamOpenCodeResponse` returns and before `flushReasoningFallback`. The #93 intent (never silently drop tool calls) is preserved.
4. **Solid test coverage** — 15 cases covering the regression path, end-of-stream flush, and edge cases.
5. **Honest PR description** — Author transparently noted that `gpt-5.6-luna` (#93 path) was NOT live-verified because China users cannot access GPT-series models via the gateway; covered only by unit tests. This reduced review guesswork.

### ⚠️ Concerns Raised (Both Addressed)

1. **Version inconsistency** — CHANGELOG said `0.4.5`, `package-lock.json` bumped only to `0.4.4`, `package.json` not bumped at all. → **Addressed by commit `1e21425b`** (synced to `0.4.5` in all three).
2. **Naming mismatch** — Extractor had `flushRemainingToolCalls()` while accumulator had `flushRemaining()`. → **Addressed by commit `effdea8f`** (renamed accumulator method + JSDoc + tests).

### ⚠️ Open Follow-up (Not a Blocker)

- **Live verification of `gpt-5.6-luna` (#93 path)** — Only unit-tested. The #93 end-of-stream flush path shares the exact extractor code verified with DeepSeek, but a live regression check on `gpt-5.6-luna` via OpenCode Go remains recommended post-merge for anyone who can access GPT models. Scheduled for the maintainer's post-merge verification.

---

## CI Status

All checks passing at commit `effdea8f`:

- ✅ GitGuardian Security Checks (32s)
- ✅ CI/build (20) (26s)

Copilot AI review: reviewed 6/7 files, generated no comments.

---

## Merge Plan

- **Strategy:** Merge commit (`gh pr merge 100 --merge`). **Never squash** — preserves all 3 contributor commits (per repo merge policy; squash incident on PR #39 must not repeat).
- **Pre-merge:** `gh pr view 100` + `gh pr diff 100` + confirm merge method with project owner.
- **Post-merge:** live-verify `gpt-5.6-luna` via Copilot Chat to confirm #93 path still works.

---

## Files Touched

| File | Status | Purpose |
| --- | --- | --- |
| `src/toolCallAccumulator.ts` | new (141 lines) | Pure tool-call accumulator module |
| `src/test/toolCallAccumulator.test.ts` | new (197 lines) | 15 unit test cases |
| `src/streaming.ts` | modified | `OpenAiResponseExtractor` integration + transport flush calls |
| `package.json` | modified | Version bump 0.4.4 → 0.4.5 |
| `package-lock.json` | modified | Version bump 0.4.4 → 0.4.5 (2 locations) |
| `CHANGELOG.md` | modified | 0.4.5 entry |
| `docs/issues/42-20260803-premature-tool-call-flush.md` | new | Root-cause analysis + fix details |
| `docs/devlog.md` | modified | Session handoff entry |

---

## Status

- ✅ `npm run compile` — exit 0.
- ✅ `npm test` — `toolCallAccumulator` suite passes (15 cases).
- ✅ `npm run test-retry` — E2E retry test passes.
- ✅ Manual F5 verification — `deepseek-v4` (Zen): tool calls now emit full `<parameter>`; the tool-calling loop is resolved.
- ⚠️ `gpt-5.6-luna` (Go) **NOT live-verified** — pending post-merge check.

---

## Recommendation

Keep tool-call flush decisions in the pure `ToolCallAccumulator` and add a unit test for any future change to streaming/tool-call behavior. The 0.4.4 regression shipped because no test covered the flush logic. This PR's extraction of the logic into a pure, tested module is the structural fix that prevents recurrence.
