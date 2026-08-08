**Status:** ✅ Solved

# PR #107 Review & Merge — Transient 5xx Gateway Retry

**Topic:** streaming / retry / reliability / community-pr
**Updated:** 2026-08-08
**Tags:** #streaming #retry #transient #router-unavailable #community-pr #jitter
**Supersedes:** —

---

## Overview

Full review and merge cycle for community contributor PR #107 by [@Fahad090NP](https://github.com/Fahad090NP), which adds transient 5xx retry with exponential backoff + jitter to the streaming request path. Covers code review, scope-split request, jitter follow-up, merge plan, and post-merge verification. Complements the existing HTTP 400 retry mechanism documented in [`07-20260615-model-validation-retry.md`](../features/07-20260615-model-validation-retry.md).

---

## Problem

When the OpenCode gateway momentarily has no healthy backend for a model (router capacity churn, upstream down, restart window), it returns either a classic `502`/`503`/`504` or a `5xx` with a body naming the `Router.Unavailable` condition. Before this PR, the extension surfaced the error to the user immediately on the first failure, even though a second attempt a second later usually succeeds. This produced flaky chat experiences under gateway load, especially during multi-turn agent sessions and parallel tool-call bursts.

---

## Solution

Two coordinated changes, both touching the existing retry module so the two retry families (HTTP 400 degraded-parameter + transient 5xx) share a single mental model:

### 1. `isTransientServerError` classifier (`src/retry.ts`)

A pure function that classifies a failed HTTP response as worth retrying:

- `502`, `503`, `504` are transient by definition (gateway churn, upstream down).
- Other `5xx` are retried **only** when the response body identifies the known momentary condition `Router.Unavailable`. The classifier compacts the body (strips non-letters) and matches `RouterUnavailable` case-insensitively, so JSON shape variations (`{"error":{"type":"Router.Unavailable"}}`, `type: router.unavailable`, etc.) all hit.
- Anything else, including `500`s with unrelated bodies, is treated as permanent so real bugs surface instead of being masked by retries.

```ts
export function isTransientServerError(status: number, errorDetail: string): boolean {
  if (status === 502 || status === 503 || status === 504) {
    return true;
  }
  return status >= 500 && /RouterUnavailable/i.test(compactErrorCode(errorDetail));
}
```

Constants exported for callers and tests:

| Constant | Value | Purpose |
| --- | --- | --- |
| `TRANSIENT_5XX_MAX_RETRIES` | `2` | Hard cap on retries before surfacing the error |
| `TRANSIENT_5XX_RETRY_BASE_MS` | `1000` | Base backoff, doubles per attempt (1s, 2s) |
| `TRANSIENT_5XX_RETRY_JITTER_MS` | `250` | Max random jitter added per backoff |

### 2. Streaming retry loop + cancellation-aware sleep (`src/streaming.ts`)

- `fetchWithBody(body)` helper collapses the three duplicated `fetch(...)` call sites (first attempt, HTTP 400 patched retry, transient 5xx retry) into one closure, so headers/signal/body shape stay in sync.
- After the HTTP 400 retry block, a `while` loop retries up to `TRANSIENT_5XX_MAX_RETRIES` times whenever `isTransientServerError(response.status, consumedErrorBody ?? "")` returns true. Backoff is exponential with jitter:

  ```ts
  const backoffMs = Math.round(
    TRANSIENT_5XX_RETRY_BASE_MS * 2 ** (attempt - 1) +
      Math.random() * TRANSIENT_5XX_RETRY_JITTER_MS,
  );
  ```

- `sleepWithCancellation(ms, token)` waits for the backoff but aborts early if the user cancels. The cancellation listener is registered **before** `setTimeout` and resolves the promise on fire, so there is no window where a cancellation arrives between `await` resuming and the listener being removed.
- `consumedErrorBody` is reset to `undefined` at the end of the HTTP 400 block and again after every 5xx retry, so the 5xx classifier and the final error handler always read a fresh response body.
- A small UX win in `src/errors.ts`: `describeRouterUnavailable(apiError, fallback)` replaces raw gateway JSON with an actionable hint when the error is `Router.Unavailable` ("OpenCode's router has no healthy backend for this model right now. Retry in a few seconds, or switch to another model."). The request-facing log message keeps the raw detail for debugging.

### 3. Unit tests (`src/test/retry.test.ts`)

Five `node:test` cases for `isTransientServerError`:

1. `502`/`503`/`504` flagged transient.
2. `500` with body naming `Router.Unavailable` flagged transient.
3. `500` with unrelated body treated as permanent.
4. Non-5xx (`429`) treated as permanent.
5. `Router.Unavailable` matched case-insensitively.

---

## Interaction With the HTTP 400 Retry Path

The two retry families chain in a single request lifecycle:

```
fetch → 400? → analyzeHttp400ForRetry → patch body → fetch → 5xx? → retry up to 2× (backoff + jitter) → surface error
```

Worst case for one user request is 4 fetches: initial + 1 HTTP 400 patched retry + 2 transient retries. This is **intentional** and was confirmed during review. The `consumedErrorBody` reset at the end of the 400 block ensures the 5xx block reads a fresh body, and the same reset inside the 5xx loop ensures each iteration sees the latest response.

---

## PR #107 Changes

**Author:** [@Fahad090NP](https://github.com/Fahad090NP) (external contributor)
**Branch:** `feat/error-handling` → `main`
**Merged:** 2026-08-07 (merge commit `6d519f7`, merge not squash)
**Final size:** +167 / -34, 4 files

| File | Change |
| --- | --- |
| `src/retry.ts` | Added `isTransientServerError`, `TRANSIENT_5XX_*` constants, rewrote header comment to document both retry families |
| `src/streaming.ts` | Added `fetchWithBody`, `sleepWithCancellation`, transient 5xx retry loop with jitter, stale body resets; fixed 3 pre-existing lint issues |
| `src/errors.ts` | Added `describeRouterUnavailable` for actionable user-facing hint |
| `src/test/retry.test.ts` | 5 unit tests for `isTransientServerError` |

The original submission also bundled a husky + eslint + markdownlint + AGENTS.md + tsconfig stack; per review feedback that stack was split off to PR [#110](https://github.com/ltmoerdani/opencode-copilot-chat/pull/110) and the standalone `AGENTS.md` was dropped in favor of folding relevant guidance into `CONTRIBUTING.md`.

---

## Review Findings

| # | Concern | Severity | Resolution |
| --- | --- | --- | --- |
| 1 | Scope creep: PR title said `fix(streaming)` but 6 of 11 files were tooling/docs/build | High | Split into two PRs; this PR narrowed to 4 source files |
| 2 | No jitter on backoff; concurrent retries could thundering-herd the gateway | Medium | Added `+ Math.random() * TRANSIENT_5XX_RETRY_JITTER_MS` (≤250ms) |
| 3 | 400→5xx handoff could trigger up to 4 fetches per request | Low | Confirmed intentional; `consumedErrorBody` reset documented |
| 4 | `compactErrorCode` regex could false-positive on `*routerunavailable*` substrings | Low | Accepted; real-world error bodies don't contain that substring outside the genuine condition |
| 5 | `AGENTS.md` conflicted with project workflow (e.g. "never run build, user's job") | Medium | Dropped; relevant parts folded into `CONTRIBUTING.md` in PR #110 |
| 6 | `tsconfig.json` `"include": ["src"]` change | Low | Moved to PR #110 with the rest of the build tooling |

---

## Verification

- `npm run compile` — clean, no TS errors.
- `npm test` — author-claimed 138/138 pass at submission time.
- `npm run test-retry` — E2E retry flow green.
- Code grep on `main` after merge confirms `TRANSIENT_5XX_RETRY_JITTER_MS`, `isTransientServerError`, `sleepWithCancellation`, `fetchWithBody`, and `describeRouterUnavailable` are all present in their expected files.

Manual live verification against a real `Router.Unavailable` burst was not performed; the classifier is covered by unit tests and the retry loop reuses the existing fetch path.

---

## Files Touched on Merge

- `src/retry.ts`
- `src/streaming.ts`
- `src/errors.ts`
- `src/test/retry.test.ts`

---

## Related

- Feature doc: [`07-20260615-model-validation-retry.md`](../features/07-20260615-model-validation-retry.md) (HTTP 400 retry; this PR extends the same module with 5xx retry)
- Sibling PR (tooling stack): [#110 — chore: add husky, eslint, and markdownlint pre-commit stack](https://github.com/ltmoerdani/opencode-copilot-chat/pull/110)
- Related transient-resilience work: [`35-20260720-issue78-model-list-fetch-resilience.md`](./35-20260720-issue78-model-list-fetch-resilience.md) (model-list fetch retry with similar classification + backoff pattern)
