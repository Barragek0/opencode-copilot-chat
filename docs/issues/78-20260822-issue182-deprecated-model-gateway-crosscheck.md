**Status:** ✅ Solved

# Deprecated Model Gateway Cross-Check (#182)

**Topic:** models / provider / registry / availability
**Updated:** 2026-08-22
**Tags:** #models #provider #zen #deprecated #gateway
**Supersedes:** —

---

## Overview

`models.dev` `status: deprecated` was hiding live models from the picker. The fix cross-checks against the gateway response: only hide when both `models.dev` says deprecated AND the gateway confirms the model is absent.

---

## Problem

`deepseek-v4-flash-free` is live on the OpenCode Zen gateway (`https://opencode.ai/zen/v1/models` returns it), but `models.dev` marks it `status: "deprecated"`. The extension's `shouldHideDeprecatedModel` filter was hiding it unconditionally — a stale false positive.

Initial commenters on the issue ("no longer available on OpenCode Zen") were incorrect — the model is served and billable. The reporter's deeper investigation confirmed the data mismatch.

### Root Cause

The original deprecated filter (issue #03, 2026-05-16) was added because the gateway **can** list models that are broken at the provider level (`ring-2.6-1t-free`, `trinity-large-preview-free`). `models.dev deprecated` was the only signal that caught them.

However, `models.dev` is community-maintained and can drift — marking working models as deprecated. The filter had no cross-check against the gateway, so stale `deprecated` flags hid live models.

### Two Competing Failure Modes

|                 | Scenario                                                  | Before fix          |
| --------------- | --------------------------------------------------------- | ------------------- |
| #03 (May 2026)  | Gateway lists broken model, `models.dev` says deprecated  | ✅ Correctly hidden |
| #182 (Aug 2026) | Gateway lists working model, `models.dev` says deprecated | ❌ Falsely hidden   |

---

## Solution

`shouldHideDeprecatedModel` now takes an optional `liveModelIds` set (the gateway response). It only hides when:

1. `models.dev` says `deprecated` **AND**
2. `liveModelIds` is provided (not offline/fallback) **AND**
3. The model is NOT in `liveModelIds` (gateway confirms absence)

This means:

- Gateway lists it → live → don't hide (fixes #182)
- Gateway absent + `models.dev` deprecated → hide (preserves #03 protection)
- Offline/fallback (no live data) → fail open, don't hide on stale metadata alone

### Files Changed

| File                               | Change                                                                                                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/provider/settings.ts`         | `shouldHideDeprecatedModel` gains `liveModelIds?: ReadonlySet<string>` parameter; early-returns `false` when live set confirms the model is present or absent data |
| `src/provider/modelList.ts`        | `filterAvailableModels` signature gains `liveModelIds?`; gateway fetch builds `Set(ids)` and passes it through                                                     |
| `src/provider/OpenCodeProvider.ts` | `filterAvailableModels` threads `liveModelIds` to `shouldHideDeprecatedModel`; fetcher wiring updated                                                              |

---

## Verification

```bash
npm run compile  # passes
npm test         # passes (existing tests unchanged)
```

Registry check:

| Model                        | Gateway   | `models.dev` | Before fix | After fix |
| ---------------------------- | --------- | ------------ | ---------- | --------- |
| `deepseek-v4-flash-free`     | ✅ live   | deprecated   | ❌ hidden  | ✅ shown  |
| `laguna-s-2.1-free`          | ✅ live   | deprecated   | ❌ hidden  | ✅ shown  |
| `ring-2.6-1t-free`           | ❌ absent | deprecated   | ✅ hidden  | ✅ hidden |
| `trinity-large-preview-free` | ❌ absent | deprecated   | ✅ hidden  | ✅ hidden |

---

## Notes

- `KNOWN_UNAVAILABLE_MODEL_IDS` (`ring-2.6-1t`, `ring-2.6-1t-free`, `trinity-large-preview-free`) remains as a manual safety net for models known to fail even if listed.
- `models.dev` is still valuable for enrichment (pricing, context windows, capabilities) — just not as the sole source of truth for availability.
