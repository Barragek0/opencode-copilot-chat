**Status:** 🟢 Fix PR open
**Fix PR:** [#180](https://github.com/ltmoerdani/opencode-copilot-chat/pull/180)
**Related:** #178 (truncated-stream resilience — same retry mechanism, generalized here)

# Idle-stalled streams: no recovery before first content, no guidance on the timeout

**Topic:** chat / transport / streaming / resilience
**Updated:** 2026-08-22
**Tags:** #chat #transport #streaming #bug #resilience

---

## Problem

Field report of the #170 idle guard firing in the wild:

```text
OpenCode Go stream stalled for 2m 0s without new data.
```

The guard itself is correct (stops Copilot hanging forever), but:

1. **No retry before first content.** A half-dead connection that stops
   delivering frames before the first extractable part failed the whole turn
   immediately. When nothing was reported to VS Code yet, a one-shot retry is
   safe (no duplicated chat content) and recovers transient stalls.
2. **No guidance for legitimate long pauses.** Reasoning models that pause
   silently server-side can exceed 2 minutes with zero SSE frames; the error
   said nothing about `streamIdleTimeoutSeconds`.

## Fix

- **`src/transports/streamParts.ts`** — `isTruncationRetry` renamed to
  `isStreamFailureRetry`: both failure modes (truncation, idle stall) share a
  single one-shot retry budget, so worst case is exactly one extra attempt.
- **`src/transports/engine.ts`** — when the idle guard fires with
  `extractedPartCount === 0` (not cancelled, not already retried), log
  `[retry] stream stalled before any content (…); retrying once…`, record a
  `stalled-retry` summary for the dead attempt, and re-run once. A model that
  legitimately pauses longer than the timeout stalls again and fails with the
  same error — bounded extra latency, no loops. The stall error message now
  points at `streamIdleTimeoutSeconds`. `extractedPartCount` hoisted to
  function scope so the catch block can consult it.
- **`src/core/transport.ts`** — `abortedReason` union gains `"stalled-retry"`.

## Verification

- `npm run lint` all 7 checks green; `npm run test-retry` E2E passed.
