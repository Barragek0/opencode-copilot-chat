# Issue — gpt-5.6-luna + image attachment → `invalid_prompt` (HTTP 400)

**Date:** 2026-08-08
**Status:** 🟢 Active (fix implemented, live verification pending)
**Severity:** High (vision input on every Responses-routed GPT model is broken)
**Related:** #103 (`docs/issues/47-20260804-gpt56-luna-responses-api-invalid-prompt.md`), #93 (`docs/issues/41-20260803-gpt56-luna-routing-fix.md`)

## Problem

Attaching an image to a chat using `gpt-5.6-luna` fails immediately with:

```text
OpenCode Go API request failed (400) model=gpt-5.6-luna payloadBytes=464399:
Error from provider (Console Go): Upstream request failed:
[invalid_prompt] Invalid Responses API request
```

The failing payload is ~464 KB — the size of a single pasted image — and the request
fails on the **first turn**, not after the session grows. This distinguishes it from
issue #103 (context overflow on long sessions), which was already fixed.

## Root cause

`gpt-5.6-luna` routes to the OpenAI **Responses API** (`/v1/responses`, see #93).
The Responses input grammar represents images as:

```json
{ "type": "input_image", "image_url": "https://… or data:image/png;base64,…" }
```

Per the official OpenAI Responses API reference, `ResponseInputImage.image_url` is a
**plain string** (a fully qualified URL or a base64 data URL).

Our serializer in `src/extension.ts` (`responsesUserContent`) was emitting the
**Chat Completions** shape instead — nesting the URL in an object:

```ts
{ type: "input_image", image_url: { url: "data:image/png;base64,…" } }
```

The gateway / upstream Responses API rejects the nested object with
`[invalid_prompt] Invalid Responses API request` (HTTP 400). Every image request on
every Responses-routed model (the GPT-5.x family) was broken.

The malformed shape was introduced in commit `5286a4b` ("feat: add Zen GPT and Gemini
routing") — before GPT models were routed to the Responses API — so it never surfaced
until #93 made the Responses transport the active path for `gpt-5.6-luna`.

## Fix

### 1. Emit `input_image.image_url` as a plain string

**File:** `src/responsesRequest.ts` (`responsesUserContent`)

```ts
if (part.type === "image_url" && part.image_url?.url) {
  // RULES: Responses API `input_image.image_url` is a plain STRING …
  return [{ type: "input_image", image_url: part.image_url.url }];
}
```

### 2. Extracted the Responses input serializer into a pure, testable module

The five functions that convert internal `ApiMessage`s into Responses `input` items
(`responsesInputItemsFromMessage`, `responsesUserContent`, `responsesAssistantText`,
`responsesToolOutput`, `joinedTextContent`) moved from `src/extension.ts` into
`src/responsesRequest.ts` (the existing Responses request module, no `vscode` import).
`extension.ts` now imports `responsesInputItemsFromMessage` and `joinedTextContent`
from there. The Google Gemini builder's `responsesAssistantText(...)` call now uses the
equivalent `joinedTextContent(...)`.

## Regression coverage

- `src/test/responsesRequest.test.ts` — new `responsesInputItemsFromMessage` suite:
  - image emitted as `input_image` with `image_url` **string** (the regression test)
  - empty string user message dropped
  - assistant text → `output_text`, tool calls → `function_call`
  - tool result with image → joined text + "[Image attachment omitted]" note
  - unsupported role → no items

All 161 unit tests pass (`npm test` = compile + unit tests).

## Verification status

- ✅ `npm test` — compile clean, 161/161 tests pass.
- ⏳ Live gateway: attach an image to `gpt-5.6-luna` in Copilot Chat and confirm the
  model answers about the image (requires the user's OpenCode Go API key). Also spot-
  check a text-only turn to confirm no regression vs. #103.

## Scope note

This is not specific to `gpt-5.6-luna` — any model routed to the Responses transport
(GPT-5.x family via OpenCode Go) was affected by the same malformed image shape. The
fix is transport-wide and has no per-model hardcoding.

## References

- OpenAI Responses API reference — `ResponseInputImage.image_url` (string): `https://developers.openai.com/api/reference/resources/responses`
- OpenAI images guide (Base64 data URL example): `https://developers.openai.com/docs/guides/images`
- Issue #103: `docs/issues/47-20260804-gpt56-luna-responses-api-invalid-prompt.md`
- Issue #93: `docs/issues/41-20260803-gpt56-luna-routing-fix.md`
- Source: `src/responsesRequest.ts`, `src/extension.ts`, `src/test/responsesRequest.test.ts`
