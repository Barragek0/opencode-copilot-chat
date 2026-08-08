# Issue #103 — gpt-5.6-luna Responses API `invalid_prompt` (HTTP 400)

**Date:** 2026-08-04
**Status:** ✅ Solved — merged via PR #113 on 2026-08-07
**Severity:** High
**PR:** [#113](https://github.com/ltmoerdani/opencode-copilot-chat/pull/113)
**GitHub:** [#103](https://github.com/ltmoerdani/opencode-copilot-chat/issues/103)
**Related:** #41 (`docs/issues/41-20260803-gpt56-luna-routing-fix.md`)

## Problem

Requests to `gpt-5.6-luna` via the Responses API fail once a session grows past a certain size:

```text
OpenCode Go API request failed (400) model=gpt-5.6-luna payloadBytes=1528273:
Error from provider (Console Go): Upstream request failed:
[invalid_prompt] Invalid Responses API request
```

The payload in the failing request was around 1.5 MB (1,528,273 bytes). Short sessions still work. The model only breaks once the conversation accumulates enough history, tool outputs, or attached content.

## Investigation

### What was checked

- Routing is correct. `gpt-5.6-luna` routes to the Responses API in `src/routing.ts` (lines 27–33), endpoint `https://opencode.ai/zen/go/v1/responses`.
- The model is registered with limits in `src/metadata.ts`: `{ contextWindow: 1050000, maxOutputTokens: 128000 }`, and listed in the Go provider's `fallbackModels`.
- Issue #41 is not this bug. That fix addressed response parsing (tool-call `finish_reason: null`), not request validation. The two live in different layers.

### Root cause

Checked against the official OpenAI Responses API reference (`https://developers.openai.com/api/reference/resources/responses`). Three gaps in `buildResponsesRequestBody()` (`src/extension.ts` lines 2826–2849).

**1. `truncation` is never sent, so it defaults to `disabled`.**

The OpenAI docs spell this out:

> `truncation: "disabled"` (default): If the input size will exceed the context window size for a model, the request will fail with a 400 error.
> `truncation: "auto"`: truncate by dropping items from the beginning.

The body builder does not set the field. Every long conversation inherits the default and hits a hard 400.

**2. `max_output_tokens` is not capped against the remaining context window.**

```ts
max_output_tokens: limits.maxOutputTokens,  // 128000 for gpt-5.6-luna
```

Do the arithmetic. Context window is 1,050,000 tokens. Static `max_output_tokens` is 128,000. So the request fails the moment the prompt exceeds `1,050,000 − 128,000 = 922,000` tokens.

The 1.5 MB payload is roughly 375K tokens on a 4-char-per-token estimate. That estimate breaks down fast once tool definitions, reasoning history, and image content are in the mix. Once `prompt + 128K > 1.05M`, the 400 is guaranteed.

**3. `text.verbosity` is sent on every Responses call.**

```ts
text: { verbosity: modelId === "gpt-5-codex" ? "medium" : "low" },
```

`text.verbosity` is a native OpenAI Responses API field. The OpenCode Go gateway is a proxy in front of other providers, and there is no guarantee it understands or forwards this field. A provider that rejects unknown fields will return `invalid_prompt`.

### Why short sessions still work

Small payload, so `prompt + 128K < 1.05M`. The gateway also appears to tolerate `verbosity` on small requests. As the payload grows, one of the three conditions above trips. The bug only shows up under load.

## Implemented fix

Implemented on 2026-08-06 for every model routed through the Responses transport.

### 1. Send `truncation: "auto"` on the Responses body

**Files:** `src/responsesRequest.ts` and `src/extension.ts`.

```ts
return buildResponsesRequestEnvelope({
  model: modelId,
  input,
  maxOutputTokens: limits.maxOutputTokens,
  thinkingPayload,
  tools,
});
```

OpenAI explicitly recommends `"auto"` for stateless multi-turn usage. This alone fixes most long-session failures without user intervention.

### 2. Cap `max_output_tokens` against the remaining window

**File:** `src/modelLimits.ts`.

```ts
const remainingContext = Math.max(1, contextWindow - promptReserve);
const maxOutputTokens = Math.max(1, Math.min(configuredMaxOutputTokens, remainingContext));
```

The previous 4,096-token floor could exceed the remaining context and recreate the 400. Request-time limits now use a strict floor of one token; `truncation: "auto"` remains the fallback when the input itself exceeds the window. Estimation runs after vision proxying and old-image trimming, so it reflects the actual payload.

### 3. Stop sending `text.verbosity`

**File:** `src/extension.ts`, inside `buildResponsesRequestBody()`.

The `text` field was removed from the shared Responses request envelope. It is non-essential, and avoiding it keeps the OpenCode proxy compatible with upstream providers that reject unknown or unsupported options.

### Regression coverage

- `src/test/modelLimits.test.ts` covers near-full contexts, overrides, and advertised limits.
- `src/test/responsesRequest.test.ts` covers automatic truncation, bounded output, optional fields, and the absence of `text.verbosity`.

## Verification

- Automated: compile, lint, all 145 unit tests, and clean VSIX packaging pass.
- Live gateway verification remains for three scenarios:
  - Short session, 1–3 turns. Confirm no regression.
  - Long session, 10+ turns with code output and MCP tool results. Confirm no 400.
  - Image input. Confirm vision still works. Caveat: with `truncation: "auto"`, the earliest image will be dropped first on overflow.
- Inspect the Output Channel during that run. The `[request]` log should show payload size and a 200 response.

## Resolution

Merged via **PR #113** (merge commit `268059f`, 2026-08-07) into `main`. All 4 contributor commits preserved. The fix applies to every model routed through the Responses transport. Live gateway smoke tests passed; a full near-limit production session is still recommended before closing out.

## Risk assessment

| Fix                     | Risk                                                | Mitigation                                                                                                     |
| ----------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `truncation: "auto"`    | Drops early conversation turns when overflow occurs | It activates only when needed; preserving a response is preferable to a hard 400.                              |
| Cap `max_output_tokens` | Output may come back shorter than expected          | The budget is bounded to the measured remaining context, with server-side truncation as the overflow fallback. |
| Remove `text.verbosity` | Output becomes slightly more verbose by default     | Negligible.                                                                                                    |

## Scope note

This bug is not specific to `gpt-5.6-luna`. Any GPT model routed to the Responses API will hit the same wall. `gpt-5.6-luna` is just the one where it shows up first, because it is the model most often used in long agent sessions with many tool calls.

The fix applies to every model that routes to the Responses transport. There is no per-model hardcoding.

## References

- OpenAI Responses API reference: `https://developers.openai.com/api/reference/resources/responses` (see `truncation` field)
- Issue #41: `docs/issues/41-20260803-gpt56-luna-routing-fix.md`
- Source: `src/extension.ts` (`buildResponsesRequestBody`)
- Source: `src/routing.ts` (Responses routing for `gpt-*`)
- Source: `src/metadata.ts` (`gpt-5.6-luna` limits)
