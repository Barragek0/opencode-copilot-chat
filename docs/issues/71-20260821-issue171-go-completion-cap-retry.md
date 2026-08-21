**Status:** ✅ Resolved
**Related issue:** [#171](https://github.com/ltmoerdani/opencode-copilot-chat/issues/171)
**Fix PR:** (this branch)

# Cap output budget to the upstream-reported completion limit

**Topic:** chat / retry / models / limits
**Updated:** 2026-08-21
**Tags:** #chat #retry #models #limits #bug #metadata

---

## Problem

`deepseek-v4-flash` via OpenCode Go fails on the first request with HTTP 400:

```txt
bad request: max_tokens is too large: 384000. This model supports at most
131072 completion tokens.
```

The extension sends `max_tokens: 384000` because models.dev still lists
`limit.output: 384000` for the model (verified live against
`https://models.dev/api.json` on 2026-08-21), and live metadata takes
precedence over the bundled snapshot in `resolveModelMetadata`. The gateway,
however, now enforces a hard completion cap of `131072`.

Related but distinct from #109: there the failure was
`prompt + completion > context window`; here the gateway rejects the
completion budget outright.

## Root cause

`calculateModelLimits` clamps the configured output budget only against the
_context window_ (`min(configuredMaxOutputTokens, remainingContext)`). With a
1M context and a small prompt, the stale 384000 passes through untouched into
`src/request/openai.ts` → `max_tokens`. No client-side source knows the true
cap until the gateway rejects the request — and the existing
`patchContextOverflow` retry only matches the
"maximum context length is …" phrasing, not this one.

## Fix

Two layers:

- **Self-healing retry (`src/retry.ts`)** — new `patchMaxTokensCap` classifier:
  when an HTTP 400 body matches
  `max_tokens is too large: <N>. This model supports at most <M> completion tokens`,
  the output budget (`max_tokens` / `max_output_tokens` /
  `max_completion_tokens`, or nested `generationConfig.maxOutputTokens`) is
  clamped to the reported cap and the request retried once via the existing
  HTTP-400 patch path. Works for any model whose upstream cap shrinks — not
  just deepseek-v4-flash. Shared `findOutputTarget` / `applyOutputTarget`
  helpers de-duplicate the output-key handling previously inlined in
  `patchContextOverflow`.
- **Bundled snapshot (`src/models/metadata.ts`)** — GO_VENDOR
  `deepseek-v4-flash` fallback corrected to `maxOutputTokens: 131072`, so
  offline/fallback resolution does not send the rejected value either.
  (`deepseek-v4-pro` is left at 384000 — no confirmed upstream cap yet; the
  retry covers it if it ever errors.)

## Verification

- `src/test/retry.test.ts` — caps the exact error text from #171, comma-
  formatted counts, Responses-style keys, the nested Google budget; no-ops
  when already within the cap or when no output budget is present.
- `src/test/metadata.test.ts` — bundled fallback reports 131072 for
  `deepseek-v4-flash`.
- `npm run lint` (all 7 gates incl. compile + unit tests) green.
