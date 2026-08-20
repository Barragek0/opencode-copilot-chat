**Status:** ✅ Resolved
**Fix PR:** (this branch)

# Stream no longer ends silently on a dropped/truncated connection

**Topic:** chat / provider / transport / streaming / resilience
**Updated:** 2026-08-20
**Tags:** #chat #provider #transport #streaming #bug #resilience

---

## Problem

During development the model would appear to "stop working" and the session would
end with no warning or error. Two distinct failure modes produce the same silent
symptom:

1. **Hang-then-cancel.** The response generates fine, then nothing happens. The
   user waits and eventually cancels manually (or the 2-minute stream-idle
   timeout fires). No error is ever shown.
2. **Silent truncation.** The response cuts off partway through (or comes back
   empty) and the session ends as if the request succeeded — no "request
   failed", no retry prompt, just a partial/empty answer.

Both look like "the model stopped" but are really transport-level stream
termination problems that the extension swallowed.

## Root cause

`provideLanguageModelChatResponse` → `runStream*()` → `streamOpenCodeResponse`
(shared engine in `src/transports/engine.ts`) reads the SSE body in a loop that
only exits on `reader.read()` returning `done` (connection closed) or
cancellation. It **ignored OpenCode's `data: [DONE]` stream terminator**
(confirmed in `tmp/opencode-dev/.../server/transport/ws.ts`, which enqueues
`data: [DONE]\n\n` and then closes the controller). Consequences:

- If the gateway keeps the TCP/keep-alive connection open after `[DONE]` (or the
  HTTP→SSE proxy does not forward the close promptly), the loop never sees
  `done` and sits until the idle timeout → mode 1 (hang-then-cancel).
- If the connection is instead **dropped** before `[DONE]` (proxy reset, upstream
  crash, truncated payload, VPN/firewall cut), `reader.read()` returns `done`
  with no `[DONE]` and no `finish_reason`. The engine had no signal that this was
  abnormal, so it completed "successfully" with whatever partial content arrived
  → mode 2 (silent truncation). The extractors do capture `finish_reason` /
  `stop_reason` from the final chunk, but a truncated stream never delivers that
  final chunk.

The previous `diag-empty-response` path only logged format mismatches; it did not
catch a stream that carried real content and then died.

## Fix

- **`src/transports/sse.ts`** — `parseServerSentEvent` gains an `onDone` callback,
  invoked when a `data: [DONE]` line is seen. `[DONE]` is no longer passed to the
  extractor (it was already skipped, but the callback makes the terminator
  observable to the caller).
- **`src/transports/engine.ts`** —
  - Tracks `streamFlags.sawDone` and **breaks the read loop as soon as `[DONE]`
    arrives**, so completion is prompt instead of waiting on a possibly-lingering
    connection (fixes mode 1).
  - After the loop, calls the new `isStreamTruncated` helper: if the stream ended
    with **no `[DONE]` AND no captured `finish_reason`** while we had already
    extracted content and received bytes, it throws a clear
    `OpenCodeRequestError` ("`<provider> stopped sending data before the response
    was complete (the connection closed unexpectedly). Your message may be cut
    off — try sending it again. If this keeps happening, check your connection,
    VPN, or firewall.") instead of silently succeeding (fixes mode 2). The
    partial content already streamed to VS Code stays visible; the error tells
    the user to retry.
- **`src/transports/sse.ts`** — `isStreamTruncated` is a small pure helper
  (exported) so the decision is unit-testable and not buried in the engine.
- **`src/test/sse.test.ts`** — unit tests for `[DONE]` handling (fires `onDone`,
  skipped by the extractor, fires once across multiple events) and for
  `isStreamTruncated` (flags a closed stream with content but no `[DONE]` /
  `finish_reason`; does not flag a stream that saw `[DONE]`, captured a
  `finish_reason`, was empty, or carried no bytes).

## Verification

- `npm run lint` (editorconfig, eslint, markdown, prettier, shellcheck,
  typecheck, unit tests) — green.
- `src/test/sse.test.ts` — new tests pass.
