**Status:** 🟢 Fix PR open
**Fix PR:** [#178](https://github.com/ltmoerdani/opencode-copilot-chat/pull/178)

# Truncated streams: silent empty replies + no retry before first content

**Topic:** chat / transport / streaming / resilience
**Updated:** 2026-08-22
**Tags:** #chat #transport #streaming #bug #resilience

---

## Problem

Field report of the #170 truncation detector firing in the wild:

````text
OpenCode Go response stream ended before completion (no [DONE] or finish_reason
after 6349 bytes / 30 events).
```text

Detection works, but two sibling gaps remained:

1. **Silent empty reply.** `isStreamTruncated()` required `extractedPartCount > 0`,
   so a `[DONE]`-transport stream that received bytes but ended with no
   `[DONE]`, no `finish_reason`, and zero extractable parts counted as
   *success* — the user saw an empty answer with no error.
2. **No recovery before first content.** Transient fetch errors and transient
   5xx are retried by the engine, but a gateway drop before the first
   extractable part failed the whole turn with no retry.

## Root cause

The `extractedPartCount > 0` gate conflated "nothing usable arrived" with
"nothing abnormal happened". For a `[DONE]` transport the terminator's absence
is itself the abnormality signal: a healthy OpenCode stream always ends with
`data: [DONE]`, so bytes-received + no `[DONE]` + no `finish_reason` is a cut
stream whether or not any part had been extracted yet.

## Fix

- **`src/transports/sse.ts`** — drop the `extractedPartCount > 0` gate from
  `isStreamTruncated`.
- **`src/transports/engine.ts`** — when truncation is detected with
  `extractedPartCount === 0` (not cancelled, not already a retry), log
  `[retry] stream truncated before any content (…); retrying once…`, record a
  `truncated-retry` summary for the dead attempt, and re-run the request once
  via an internal `isTruncationRetry` options flag (`src/transports/
  streamParts.ts`). Zero parts were reported to VS Code, so no chat content can
  be duplicated. Content-emitting truncations still throw (retry would
  duplicate visible text) — the user message now adds that a single resend
  usually succeeds and carries the `x-opencode-request` id.
- **`src/core/transport.ts`** — `abortedReason` union gains `"truncated-retry"`.

## Verification

- `npm run lint` all 7 checks green; `sse.test.ts` updated (byte-only dead
  stream flags; no-bytes stream still doesn't).
- `npm run test-retry` mock-server E2E 7/7.
````
