**Status:** ✅ Solved

# PR #157 Bug-Hunt Pass — 35 Fixes Across Streaming, Usage, Providers, Models, Tooling

**Topic:** bug-hunt / streaming / usage / providers / models / tooling
**Updated:** 2026-08-21
**Tags:** #bug-hunt #streaming #usage #providers #models #tooling
**Related:** PR [#157](https://github.com/ltmoerdani/opencode-copilot-chat/pull/157) (by [@Fahad090NP](https://github.com/Fahad090NP)) · merge commit `a830618` (2026-08-17)

---

## Overview

A single contributor pass fixing 35 latent bugs found by code review across 35 files — streaming/extractors, usage dashboard/history/pricing, provider settings/messages/vision proxy, request schema, and tooling (staged-lint).

## Key verified fixes (spotlight)

- **Webview crash:** `esc()` called 3× in the Models tab of `usage/dashboard.ts` without a definition — real crash; now defined/used correctly.
- **5xx `Router.Unavailable` dead branch:** `isTransientServerError` needed a body match for non-502/503/504, but `consumedErrorBody` was only set on the 400 path (`transports/engine.ts`) — the retry never fired. Now wired.
- **Cancel during backoff surfaced a stale 5xx body:** backoff loop broke on cancel and threw the stale error; now respects `AbortError`.
- **Day bucketing off-by-one:** `Math.round` → `Math.floor` in `usage/history.ts` — afternoon entries landed in tomorrow's bucket.
- **Active usage profile overridden every ~300 ms:** `ensureProfileSync` ran unconditionally from `provideLanguageModelChatInformation` (contract ~300 ms), breaking multi-key setups. Now guarded.
- **Reasoning dropped without a progress sink:** `progress` was optional; old flush paths cleared reasoning that was never streamed.
- **Phantom tokens from the reasoning marker:** token counting treated the marker MIME as a real part; now excluded (and marker-before-internal ordering fixed in `provider/messages.ts`).
- **Registry catch-all safety:** per-model `family` falls back to the `default` registry row — `lookupModelRegistryEntry` can never return `undefined`.
- **Debouncer stale-token race:** `debounce()` self-cancels; completion path now re-validates the token.
- Plus staged-lint hardening, schema validation widening (`request/schema.ts`, +93-line test suite), vision-proxy placeholder fixes, and more — full list in the PR.

## Review verdict (2026-08-17, pre-merge)

Independently verified — not just contributor claims: `tsc` clean, 324/324 unit tests (new `src/test/schema.test.ts`), CI + GitGuardian pass, live gateway check confirmed the model drift claim. Two discrepancies found in review (an overclaimed `getWeathergetWeather` fix absent from the diff, and a wrong issue citation `#51` → `#63`) were both addressed by the contributor before merge.

## Remaining risk (flagged, not blockers)

- Live smoke test still advised for: Google tool-call streaming, the 5xx retry path, and vision placeholders (contributor self-flagged).
- Model picker grouping after the family change (agent variants share family with base vendor).
- Explicit profile flag is never reset when the BYOK key is swapped entirely (edge case).
