# PR #113 — Harden OpenCode VS Code Bridge

**Date:** 2026-08-07
**Status:** ✅ Merged (merge commit `268059f`, 2026-08-07T15:30:35Z)
**Related:** PR [#113](https://github.com/ltmoerdani/opencode-copilot-chat/pull/113)
**Author:** [@Wallacy](https://github.com/Wallacy)
**Branch:** `feat/bridge-hardening`
**Closes:** #103 (long sessions `invalid_prompt`), #109 (DeepSeek V4 Flash context overflow)
**Partially addresses:** #89 (runtime diagnostics enriched, definitive elevated/admin fix still pending repro)

## What

Major hardening of the OpenCode language-model bridge against four classes of failure that surfaced once multi-turn agent sessions, Responses-routed models, and long tool-heavy prompts hit production:

1. **Context-budget failures in long and tool-heavy sessions** (#103, #109)
2. **VS Code integration drift** (BYOK metadata, proposal-gated capabilities)
3. **Credential loss after Extension Host restart**
4. **Cancellation listener leaks + stale VSIX artifacts**

## Changes

### Context budget (#103, #109)

- Enable `truncation: "auto"` for Responses API requests.
- Remove the proxy-sensitive `text.verbosity` field from Responses requests.
- Include Copilot/MCP tool definitions and JSON schemas in prompt estimates (previously only message text was counted, so tool-heavy sessions silently blew past the limit).
- Reserve proportional tokenizer headroom instead of a fixed 64-token margin.
- Bound the requested output to the context remaining after the normalized prompt.
- Recover from exact upstream HTTP 400 context overflows by using the provider-reported counts to reduce the output budget and retry once. Covers Chat Completions, Anthropic Messages, Responses, and Gemini output-budget formats.
- Pure regression tests for every output-budget format.

### VS Code integration

- Mark models as `isBYOK` and expose capacity warnings through the model picker `warningText` field.
- Add provider management commands and explicit utility-model configuration (`OpenCode: Configure Utility Models`).
- Keep vision and tool calling enabled without advertising `capabilities.editTools`, which is still gated behind the `chatProvider` proposed API in VS Code 1.132. Omitting it does not disable agent edits or tool calls; it is only an edit-tool preference hint. Keeping it off allows the published extension to work in regular VS Code without `--enable-proposed-api`.

### Credentials

- Restore credentials for cached models after an Extension Host restart by falling back to `SecretStorage` before reporting a missing API key. VS Code can invoke a cached selected model before model discovery has rebuilt the in-memory model-to-key map.

### Diagnostics (#89)

- Runtime diagnostics now include extension and VS Code versions, extension host, remote/UI mode, workspace trust, Node/platform details, Windows integrity level, installation paths, credential presence, and model-selection errors.

### Reliability + build

- Fix cancellation listener leaks: model discovery and streaming retry delays now dispose VS Code cancellation subscriptions after success, timeout, or cancellation.
- Provider connection test gets a 30-second timeout.
- Clean `out/` before compilation to prevent stale artifacts (e.g. the removed autocomplete implementation) from entering the VSIX.
- Linting, tests, and VSIX packaging are now blocking CI checks.
- Reduce development-only files shipped in the VSIX (internal docs, scripts, compiled tests, source maps, GitHub/Husky config, lint config). README demo and Photon runtime remain.

## Scope Notes

- `opencode serve` is documented but not registered as a native VS Code model source because its session/agent API is not a compatible inference endpoint for VS Code's tool loop. See [OpenCode server documentation](https://opencode.ai/docs/server/) and #88.
- Inline autocomplete remains dependent on upstream VS Code/Copilot support.
- #89 now has richer diagnostics, but a reproducible elevated/admin failure is still needed for a definitive fix.
- The #109 failure is now covered structurally and by the exact reported token counts; final validation with the reporter's near-limit live session is still pending.
- Proposal-only edit-tool preferences remain intentionally disabled for Marketplace compatibility and can be restored when `chatProvider.editTools` becomes stable.

## Verification

- `npm run compile` → passes.
- `npm run lint` → passes (baseline at time of merge).
- Unit tests green (count as of merge: 161 after follow-up #116).
- Live validation for #109's near-limit session still pending reporter confirmation.

## Files Changed

- `src/extension.ts` — BYOK metadata, capacity warnings, utility-model configuration, credential fallback, cancellation disposal, `out/` clean.
- `src/contextWindowHook.ts`, `src/contextWindowHookBridge.ts` — context budget + tool-schema estimation.
- `src/responsesRequest.ts` — `truncation: "auto"`, `text.verbosity` removal, output bounding.
- `src/modelCapabilities.ts` — drop `capabilities.editTools`.
- `src/retry.ts`, `src/streaming.ts` — cancellation disposal + retry timeout handling.
- `src/test/` — regression suites for output-budget formats.
- `README.md`, `CHANGELOG.md`, contributor checklist — updated.

## References

- PR: [#113](https://github.com/ltmoerdani/opencode-copilot-chat/pull/113)
- Issue #103: `docs/issues/47-20260804-gpt56-luna-responses-api-invalid-prompt.md`
- Issue #109: `docs/issues/49-20260807-issue109-deepseek-context-overflow.md`
- Issue #89: runtime diagnostics enriched; definitive elevated/admin fix still pending repro.
