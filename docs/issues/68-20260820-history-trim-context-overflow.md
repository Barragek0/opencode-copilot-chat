**Status:** ✅ Resolved
**Related issue:** [#109](https://github.com/ltmoerdani/opencode-copilot-chat/issues/109) (context-limit failure from unbounded history — same root cause)
**Fix PR:** (this branch)

# Trim conversation history to fit the model context window

**Topic:** chat / provider / request / payload
**Updated:** 2026-08-20
**Tags:** #chat #provider #request #payload #bug #performance

---

## Problem

Several related symptoms, one root cause — the request payload is never bounded
for **text** turns, so a long (or repeated) conversation grows past what the
upstream will accept:

1. **"No response came" / "Sorry, no response was returned"** across multiple
   VS Code windows. Requests intermittently fail with no response parts emitted.
2. **`503 Endpoint is unavailable`** (`payloadBytes` ≈ 783 KB) — the gateway
   rejects the oversized request.
3. **`request timed out after 10m 0s`** — a huge payload makes the upstream hang
   until the 10-minute request timeout fires.
4. **Repeated failures that Compact Conversation fixes.** Sending many messages
   in a row eventually errors every time; running _Compact Conversation_ and then
   sending one message works again. The reporter noted failures begin once the
   context window is **~70% full**, and that the slowness is specific to the
   VS Code session (OpenCode / other clients are fine) — pointing at the
   extension doing heavy work per request, not the model.

## Root cause

`provideLanguageModelChatResponse` builds the wire payload from the entire
message list. The only history guard was `trimOldImagesFromHistoryInPlace`
(images only). There was **no text-history truncation**, so a long conversation
exceeds the model's context window and the upstream either:

- rejects the oversized request with HTTP 400/503 (empty assistant message,
  `finish_reason: null`), or
- hangs / returns an empty stream → VS Code surfaces "No response came" /
  "Sorry, no response was returned".

Compact Conversation shrinks the history, which is why it "fixes" the symptom.
This also explains the reported ~783 KB payload: it is the uncompacted
conversation history, not a model-specific quirk.

Two gaps made the first pass insufficient:

- The token budget was `contextWindow − maxOutput − margin`, which can still sit
  **above** the ~70% failure threshold the reporter described, so trimming to
  "the context window" alone did not always drop enough.
- The trim re-estimated the **whole** payload on every candidate drop
  (O(n²) in the history length), which is the session slowness — the extension
  re-stringifies and re-tokenizes an 800 KB payload many times per request.

## Fix

Reworked `src/provider/historyTrim.ts` → `trimOldMessagesToFitContext` so it
bounds the payload on **two** independent axes and runs in **O(n)**:

- **Token budget** = `min(⌊contextWindow × HISTORY_TRIM_TARGET_RATIO⌋,
contextWindow − maxOutput − HISTORY_TRIM_SAFETY_MARGIN_TOKENS)`, with
  `HISTORY_TRIM_TARGET_RATIO = 0.7` so we stay safely below the observed
  failure threshold rather than right up against the window.
- **Hard byte cap** = `MAX_REQUEST_PAYLOAD_BYTES` (512 KB). This is the reliable
  guarantee: it bounds the actual bytes sent upstream regardless of how the
  token heuristic estimates the history, so a single oversized turn or an
  inaccurate estimate can no longer produce a payload the gateway rejects (the
  reporter's 503 was at ~783 KB).
- **O(n) instead of O(n²):** the full history is estimated once, then each
  dropped unit's size is subtracted incrementally — no per-candidate
  re-stringification of the whole array. This removes the per-request session
  slowness.
- **Tool-call groups are dropped as one unit** (assistant `tool_calls` + its
  following `tool` results), so agentic histories with many tool turns are
  trimmed too, while a group is only dropped when every one of its tool results
  is contained in the group (never orphaning a reference, which would 400).
- **Preserves** the first message (system/anchor) and the last message (current
  prompt).
- **Returns** `{ removed, finalTokens, finalBytes }` so the caller reuses the
  estimate instead of re-estimating the trimmed payload a second time.

Called in `OpenCodeProvider.provideLanguageModelChatResponse` right after the
existing image-history trim, before the prompt-token estimate and limit calc.

## Verification

- `src/test/messages.test.ts` — covers: no-op when it fits, drops oldest while
  keeping anchor + last, drops a complete tool-call group as one unit, no-op
  when only anchor + last remain, **enforces the hard byte cap** even with a
  generous token budget, returns final token/byte estimates, and never drops
  the anchor or current prompt.
- `npm test` (all pass) and `npm run lint` (all 7 gates) green.
