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

## Root Cause Deep Dive — Go Gateway Bug (#37635)

### Discovery

On 2026-07-23, riset internet menemukan issue **anomalyco/opencode#37635** (5 hari lalu):

> **"opencode-go gateway returns `reasoning_content` instead of `content` in streaming responses"**

Reporter melakukan direct API test:

```
POST https://opencode.ai/zen/go/v1/chat/completions
{"model":"grok-4.5","messages":[...],"stream":true}
```

Hasilnya — **semua chunk streaming** dari Go gateway menggunakan `reasoning_content`, bukan `content`:

```
data: {"choices":[{"delta":{"role":"assistant","reasoning_content":"The"}}]}
data: {"choices":[{"delta":{"reasoning_content":" user"}]}
data: {"choices":[{"delta":{"reasoning_content":" asks"}]}
... (18 chunk reasoning_content) ...
data: {"choices":[{"delta":{"content":"2"}}]}
data: {"choices":[{"finish_reason":"stop","delta":{}}]}
```

**Affected models:** ALL opencode-go models — mimo-v2.5, mimo-v2.5-pro, deepseek-v4-pro, kimi-k3, glm-5.1, dll.

**Hanya Go gateway (`/zen/go/`) yang kena.** Zen gateway (`/zen/v1/`) tidak terpengaruh.

Non-streaming endpoint juga OK — bug hanya di streaming.

### Hubungan dengan thinking loop

Kombinasi dua bug menghasilkan gejala "thinking looping":

| # | Bug | Akibat |
|---|-----|--------|
| 1 | **#37635** — Go gateway streaming pakai `reasoning_content` untuk semua output | Extension kita emit SEMUA output sebagai `LanguageModelThinkingPart` (thinking panel) |
| 2 | **Model looping** — MiMo 2.5 kadang gagal converge dan generate teks yang sama berulang | Token thinking membengkak tanpa batas |

Tanpa `budget_tokens`: model looping sampai 10 menit (total timeout).
Dengan `budget_tokens` + workaround: looping terdeteksi dan dihentikan lebih awal.

### Related issues

| Issue | Status | Relevance |
|-------|--------|-----------|
| [#37635](https://github.com/anomalyco/opencode/issues/37635) — Go gateway `reasoning_content` vs `content` | 🟡 Open (MrMushrooooom) | Root cause — gateway bug, server-side fix needed |
| [#35209](https://github.com/anomalyco/opencode/issues/35209) — Models enter extended thinking on simple prompts | 🟡 Open (StarpTech) | Related: thinking options not gated by model capabilities |
| [#36354](https://github.com/anomalyco/opencode/issues/36354) — MiMo / DeepSeek tool-call "Internal server error" | 🟡 Open (jlongster) | Related: reasoning_content handling broken for tool calls |

## Notes

- The `budget_tokens` values are conservative starting points. They can be tuned based on real-world usage feedback.
- A future enhancement could expose `mimoBudget` as a user-configurable setting (similar to `qwenBudget`) via the thinking picker.
- A stream-level reasoning guard (abort if `totalReasoningChars` exceeds threshold) was considered but deferred — the `budget_tokens` approach is preferable as it prevents token generation at the model level rather than after the fact.
- The `treatReasoningAsContent` workaround applies to ALL Go gateway models, not just MiMo. It can be removed once upstream #37635 is fixed.
