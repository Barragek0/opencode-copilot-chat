# Issue #109 - DeepSeek V4 Flash Context Overflow

**Date:** 2026-08-07
**Status:** Implemented; live reporter verification pending
**Severity:** High
**GitHub:** [#109](https://github.com/ltmoerdani/opencode-copilot-chat/issues/109)

## Symptom

Long Copilot Agent sessions using `deepseek-v4-flash` could reach the model's
1,048,576-token context limit while the extension still requested the model's
full 384,000-token completion allowance. The upstream rejected the request with
HTTP 400.

The failure was more likely when many Copilot or MCP tools were enabled.

## Structural Cause

The request-time estimate serialized only `apiMessages`. Tool definitions and
their JSON schemas are also part of the provider prompt, but were absent from
the estimate. In addition, the fixed 64-token safety margin did not scale with
prompts containing hundreds of thousands of tokens or with differences between
provider tokenizers.

The #103 work bounded output against the local estimate, but did not eliminate
these two sources of under-counting.

## Implemented Protection

1. `estimatePromptTokenCount()` includes messages and tool definitions.
2. `calculateModelLimits()` reserves 12% of the local prompt estimate as
   tokenizer headroom for request-time budgets.
3. `analyzeHttp400ForRetry()` recognizes context-limit errors containing the
   upstream context, requested, and completion counts. It computes a corrected
   output budget, adds a small server-count safety margin, and retries once.

The recovery supports `max_tokens`, `max_output_tokens`,
`max_completion_tokens`, and Gemini's nested
`generationConfig.maxOutputTokens`, so it applies across the extension's
transports without DeepSeek-specific branching.

## Regression Coverage

- The exact values from #109 are covered in `src/test/modelLimits.test.ts` and
  `src/test/retry.test.ts`.
- `src/test/tokenEstimate.test.ts` verifies that tool schemas increase the
  prompt estimate.
- The retry is skipped when the prompt itself cannot fit by reducing output.
