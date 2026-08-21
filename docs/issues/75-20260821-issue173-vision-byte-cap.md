**Status:** ✅ Resolved
**Related issue:** [#173](https://github.com/ltmoerdani/opencode-copilot-chat/issues/173)
**Fix PR:** (this branch)

# Exclude image data from the history-trim byte ceiling

**Topic:** chat / provider / payload / vision
**Updated:** 2026-08-21
**Tags:** #chat #provider #payload #vision #bug #performance

---

## Problem

`trimOldMessagesToFitContext` counts base64 image data toward
`MAX_REQUEST_PAYLOAD_BYTES` (512 KB). A vision payload with 1–2 surviving
images (`MAX_HISTORY_IMAGES_KEPT = 2`, up to ~5 MB base64 each) sits far above
the cap even after token trimming succeeded — so the trimmer dropped the whole
text middle history for nothing and still reported over-cap (images remain),
falling back to `noTrim`. Net effect: lost context, zero benefit. Observed in
the wild as a 503 on a `payloadBytes=520805` request.

The 512 KB figure itself is conservative: the gateway has accepted bodies up to
~1.5 MB (#44 / withdrawn #104).

## Root cause

`payloadBytes()` stringified the raw message array; `image_url.url` data URLs
dominate the byte count but are already bounded by the dedicated image-history
trimmer — the byte ceiling exists to bound _text_ growth.

## Fix

`src/provider/historyTrim.ts`:

- New `stripImageData()` — copy-on-write clone of a message with oversized
  base64 data URLs replaced by an `[image]` placeholder (structure overhead
  stays counted → estimate remains slightly pessimistic, never under-trims).
- `payloadBytes()` and per-unit byte measurement run on stripped messages.
  Text-only payloads measure exactly as before.
- Contract JSDoc updated.

## Verification

- `src/test/messages.test.ts` — three new cases: a >512 KB image payload no
  longer triggers any text trim; genuinely oversized _text_ history still
  trims with images present; small non-data image URLs are counted fully.
- `npm run lint` (all 7 gates incl. compile + unit tests) green.
