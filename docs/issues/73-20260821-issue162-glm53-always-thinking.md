**Status:** ✅ Solved

# GLM 5.3+ Cannot Disable Thinking (HTTP 400)

**Topic:** thinking / glm / retry / http-400
**Updated:** 2026-08-21
**Tags:** #thinking #glm #retry #http-400
**Related:** Issue [#162](https://github.com/ltmoerdani/opencode-copilot-chat/issues/162) · PR [#166](https://github.com/ltmoerdani/opencode-copilot-chat/pull/166) · `src/thinking/glm.ts` · `src/retry.ts` · feature doc [`02-20260517-per-model-thinking-controls.md`](../features/02-20260517-per-model-thinking-controls.md)

---

## Symptom

Selecting a GLM 5.3+ model with Thinking set to `off` failed every request with:

```txt
HTTP 400: This model always engages in thinking and cannot be disabled; please use low, high, or max
```

## Root Cause

GLM 5.3 and later **always** engage in thinking — the `thinking: { type: "disabled" }` payload our picker could produce is rejected upstream. Our `GlmThinking` strategy still exposed `off` like older GLM versions.

## Fix (two layers)

1. **`src/thinking/glm.ts`** — `GlmThinking` detects GLM 5.3+ by version and forces thinking on (default `high`). The picker exposes only `high`/`max` and hides `off` — mirroring the Kimi K2.7-code force-on fix.
2. **`src/retry.ts`** — defensive retry pattern strips `thinking` from the payload when upstream reports "cannot be disabled", so any stale cached `off` (e.g. persisted per-model config from before the fix) self-heals on the next request.

## Verification

- Unit tests added: version detection, forced-on resolution, payload shape, picker schema (`src/test/thinking.test.ts`), retry strip pattern (`src/test/retry.test.ts`).
- Merge commit `a1f5855` (2026-08-21), `npm run lint` all 7 gates green.
