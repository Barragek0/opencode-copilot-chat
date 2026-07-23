**Status:** ✅ Solved

# MiMo 2.5 — Thinking Loops Endlessly (No Token Budget Cap)

**Topic:** thinking / mimo / streaming / budget  
**Reported:** 2026-07-23  
**Tags:** #thinking #mimo #streaming #budget #bug

---

## Problem

When MiMo 2.5 (or MiMo 2.5 Pro) is used with `Thinking Effort` set to any value other than `Off`, the model's `reasoning_content` stream can enter an infinite loop — repeating the same chain-of-thought fragment indefinitely without converging to a final answer.

### Observed symptom

The thinking panel (collapsed by default in Copilot Chat) accumulates thousands of tokens that are variations of the same incomplete thought, e.g.:

```
Now fix the Penutup body. Now fix the Penutup body. Now fix the Penutup body.
[…repeated 30+ times]
```

or:

```
Actually, I think the user just wants…
Wait, I'm looking at the previous messages…
Actually, I think the user just wants…
[…repeated indefinitely]
```

### Impact

- The stream is **actively generating tokens** (not idle), so `DEFAULT_STREAM_IDLE_TIMEOUT_MS` (2 min) does **not** fire.
- The total timeout (`DEFAULT_REQUEST_TIMEOUT_MS`, 10 min) eventually fires, but the user is blocked for up to 10 minutes with no response.
- Cost impact: MiMo Go pricing charges for all thinking tokens generated.

---

## Root Cause

### Why it loops

MiMo models use the `@ai-sdk/openai-compatible` transport routed through `chat-completions`. The extension sent only:

```json
{ "reasoning_effort": "low" | "medium" | "high" }
```

Unlike Qwen (which has `thinking_budget` / `enable_thinking: false`) or Anthropic models (which have `budgetTokens`), `reasoning_effort` for `@ai-sdk/openai-compatible` models in the OpenCode transform does NOT include a `budget_tokens` cap:

```typescript
// OpenCode transform.ts — openai-compatible variants()
return Object.fromEntries(WIDELY_SUPPORTED_EFFORTS.map(effort => [effort, { reasoningEffort: effort }]))

// reasoningBudget() for @ai-sdk/openai-compatible → returns undefined (no budget support)
```

Without a token budget, MiMo can generate reasoning tokens beyond any reasonable limit before converging (or failing to converge).

### Codebase location

- `src/thinking.ts` → `buildThinkingPayload()` MiMo branch
- `src/retry.ts` → no handler for `budget_tokens` rejection

---

## Fix (v0.4.2)

### `src/thinking.ts` — Add `budget_tokens` to MiMo payload

Added a `budget_tokens` field alongside `reasoning_effort` to cap reasoning token generation per effort level:

| Effort | `reasoning_effort` | `budget_tokens` |
|--------|-------------------|-----------------|
| low    | `"low"`            | 8 192           |
| medium | `"medium"`         | 16 384          |
| high   | `"high"`           | 32 768          |

```typescript
// before
return { reasoning_effort: thinking.mimo };

// after
const mimoBudgetMap = { low: 8192, medium: 16384, high: 32768 };
const mimoBudget = mimoBudgetMap[thinking.mimo];
return {
  reasoning_effort: thinking.mimo,
  ...(mimoBudget !== undefined ? { budget_tokens: mimoBudget } : {}),
};
```

### `src/retry.ts` — Add `budget_tokens` rejection handler

If the OpenCode gateway or MiMo's API returns `HTTP 400 "extra inputs are not permitted, field: 'budget_tokens'"`, the retry logic now removes `budget_tokens` and retries with only `reasoning_effort`:

```typescript
{
  pattern: /extra inputs are not permitted.*budget_tokens/i,
  patch: (body) => { delete next.budget_tokens; return next; },
  describe: () => "removed budget_tokens (not accepted by this model)",
}
```

---

## Fallback behavior

If `budget_tokens` is not supported by the upstream (gateway or MiMo API):

1. Gateway returns `HTTP 400` with `"extra inputs are not permitted, field: 'budget_tokens'"`
2. `analyzeHttp400ForRetry()` matches the new pattern (or the existing generic pattern)
3. Extension retries with `{ reasoning_effort: "low"|"medium"|"high" }` only (previous behavior)

The fix is fully backward-compatible and gracefully degrades.

---

## Workaround (if loop still occurs)

If the user encounters a thinking loop before this fix is deployed:
1. Click the **Stop** button in Copilot Chat to cancel the request
2. Switch `Thinking Effort` to **Off** for MiMo in the model picker
3. Re-send the query

---

## Notes

- The `budget_tokens` values are conservative starting points. They can be tuned based on real-world usage feedback.
- A future enhancement could expose `mimoBudget` as a user-configurable setting (similar to `qwenBudget`) via the thinking picker.
- A stream-level reasoning guard (abort if `totalReasoningChars` exceeds threshold) was considered but deferred — the `budget_tokens` approach is preferable as it prevents token generation at the model level rather than after the fact.
