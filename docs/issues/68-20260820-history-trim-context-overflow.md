**Status:** ✅ Resolved
**Fix PR:** (this branch)

# Trim conversation history to fit the model context window

**Topic:** chat / provider / request / payload
**Updated:** 2026-08-20
**Tags:** #chat #provider #request #payload #bug

---

## Problem

Two reported symptoms, one root cause:

1. **"No response came" across multiple VS Code windows.** When several windows
   chat in separate sessions, requests intermittently fail with no response
   parts emitted.
2. **Repeated failures that Compact Conversation fixes.** Sending many messages
   in a row eventually errors every time; running _Compact Conversation_ and then
   sending one message works again in most cases.

Both point at the same thing: the request payload grows with the full
conversation history and is never bounded for **text** turns.

## Root cause

`provideLanguageModelChatResponse` builds the wire payload from the entire
message list. The only history guard was `trimOldImagesFromHistoryInPlace`
(images only). There was **no text-history truncation**, so a long conversation
exceeds the model's context window and the upstream either:

- rejects the oversized request with HTTP 400 (empty assistant message,
  `finish_reason: null`), or
- hangs / returns an empty stream → VS Code surfaces "No response came".

Compact Conversation shrinks the history, which is why it "fixes" the symptom.
This also explains the reported Muse Spark 990 KB payload: it is the
uncompacted conversation history, not a model-specific quirk.

## Fix

New pure module `src/provider/historyTrim.ts` → `trimOldMessagesToFitContext`:

- Computes an input budget = `contextWindow − maxOutputTokens − safetyMargin`
  (the safety margin is `HISTORY_TRIM_SAFETY_MARGIN_TOKENS = 2048`).
- Drops the oldest messages until the estimated prompt tokens fit the budget.
- **Preserves** the first message (system/anchor) and the last message (current
  prompt).
- **Never splits a tool-call group** — trimming stops before the first
  assistant message that carries `tool_calls` (and its following `tool` results),
  so no tool reference is orphaned (which would itself 400 the request).
- Mutates the array in place and returns the count removed (logged as
  `[history-trim]` for diagnostics).

Called in `OpenCodeProvider.provideLanguageModelChatResponse` right after the
existing image-history trim, before the prompt-token estimate and limit calc.

## Verification

- `src/test/messages.test.ts` — 4 cases: no-op when it fits, drops oldest while
  keeping anchor + last, never splits a tool group, no-op when only anchor + last
  remain.
- `npm test` (337 pass) and `npm run lint` (all 7 gates) green.
