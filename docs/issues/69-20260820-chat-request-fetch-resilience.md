**Status:** ✅ Resolved
**Related issue:** [#78](https://github.com/ltmoerdani/opencode-copilot-chat/issues/78) (model-list fetch resilience — same classifier, extended to the chat path)
**Fix PR:** (this branch)

# Retry transient network failures on the chat request path

**Topic:** chat / provider / request / transport / resilience
**Updated:** 2026-08-20
**Tags:** #chat #provider #request #transport #resilience #bug #network

---

## Problem

A chat request can fail with a hard, user-facing error even when the gateway is
momentarily reachable:

```txt
Sorry, your request failed. Please try again.

Client Request Id: d306d0f1-b5b9-4e1a-a5e0-4677e509f283

Reason: fetch failed: TypeError: fetch failed
```

The `Reason:` is the raw undici wrapper `TypeError: fetch failed` — a `fetch()`
that **threw** before any HTTP response was received. This is a transient
network condition (DNS wobble, TCP reset, connect timeout, or the undici socket
reuse race tracked in [`nodejs/undici#5450`](https://github.com/nodejs/undici/issues/5450)),
not a permanent failure. The same class of error is already retried for the
model-list fetch (issue #78), but the **chat** path had no such retry, so a
single transient blip became a hard failure the user had to manually retry.

## Root cause

`provideLanguageModelChatResponse` → `runStream*()` → `streamOpenCodeResponse`
(shared engine in `src/transports/engine.ts`) calls `fetch()` exactly once per
attempt. The engine only retried **HTTP** responses:

- HTTP 400 → one parameter-patch retry (`analyzeHttp400ForRetry`).
- HTTP 5xx → a short backoff loop (`isTransientServerError`).

A `fetch()` that _throws_ a network error was never caught by either path — it
propagated straight out of the `try` block, was re-thrown by
`provideLanguageModelChatResponse`, and VS Code rendered it as the generic
"Sorry, your request failed" dialog. The model-list path (`fetchModels`) already
handled this via `isTransientFetchError` + an exponential-backoff loop, but that
helper lived in `provider/definitions.ts` and was never wired into the chat path.

## Fix

- **`src/transports/engine.ts`** — added `fetchWithTransientRetry`, a wrapper
  around the existing `fetchWithBody` that retries a `fetch()` that _throws_ on
  transient errors only. It is used for the initial request, the HTTP-400 patch
  retry, and each 5xx retry. Behaviour:
  - Retries up to `TRANSIENT_FETCH_MAX_RETRIES = 3` times with exponential
    backoff (`TRANSIENT_FETCH_RETRY_BASE_MS = 500` × 2ⁿ, plus up to
    `TRANSIENT_FETCH_RETRY_JITTER_MS = 250` jitter) — matching the model-list
    fetch values.
  - Classifies errors with `isTransientFetchError`: `ECONNRESET`, `EAI_AGAIN`,
    `UND_ERR_CONNECT_TIMEOUT`, the generic `TypeError: fetch failed` wrapper, and
    HTTP 408/429/5xx are retried; `AbortError` (user cancellation **or** our own
    request/stream timeout) and HTTP 4xx are **never** retried.
  - On exhaustion it throws a clear, actionable `OpenCodeRequestError`
    ("`<provider> couldn't reach the gateway (network error). Check your
    connection, VPN, or firewall, then try again.") instead of the raw undici
    wrapper, so the user gets guidance rather than a stack-trace fragment.
- **`src/retry.ts`** — `isTransientFetchError` moved here from
  `provider/definitions.ts` (the shared retry-decision module, no `vscode`
  runtime import) so the chat path and the model-list path share one source of
  truth. `definitions.ts` re-exports it, so `OpenCodeProvider` keeps working.
- **`src/config.ts`** — added `TRANSIENT_FETCH_MAX_RETRIES`,
  `TRANSIENT_FETCH_RETRY_BASE_MS`, `TRANSIENT_FETCH_RETRY_JITTER_MS`.

## Verification

- `src/test/retry.test.ts` — covers `isTransientFetchError`: the generic
  `TypeError: fetch failed` wrapper, undici `E*` cause codes, `UND_ERR_*`
  connect/socket timeouts, `TimeoutError` (retried) vs `AbortError` (not),
  HTTP 408/429/5xx via message (retried) vs 400 (not), and an unknown plain
  error (permanent).
- `npm run lint` (all 7 gates) green; `npm test` green.
