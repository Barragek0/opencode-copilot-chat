**Status:** ✅ Solved

# Image Attachment Normalization

**Topic:** vision / streaming / provider / gateway
**Updated:** 2026-08-05
**Tags:** #vision #streaming #provider #gateway
**Issues:** [#94](https://github.com/ltmoerdani/opencode-copilot-chat/issues/94), [#38](https://github.com/ltmoerdani/opencode-copilot-chat/issues/38) (superseded)
**PR:** [#102](https://github.com/ltmoerdani/opencode-copilot-chat/pull/102) by [@Wallacy](https://github.com/Wallacy)
**Released:** `v0.5.0` (2026-08-05)

---

## Overview

Top-level and tool-result image attachments are now resized and re-encoded to provider-safe dimensions **before** the final payload guard runs. This mirrors the normalization that the standalone OpenCode CLI applies before forwarding images to the gateway, fixing the long-standing class of `400 Upstream request failed` errors that hit images which were valid pixels but exceeded the gateway's implicit size contract.

Prior to this feature, the extension forwarded raw `Uint8Array` image bytes as base64 data URIs without any transformation. The only defense was a hard raw-byte guard that replaced oversized images with a placeholder text part, which lost the image entirely even when a simple resize would have made it acceptable.

---

## Problem

### Observed behavior

| Image | Before fix | After fix |
|-------|------------|-----------|
| Small PNG, any dimensions (<1MB raw) | ✅ Sent as-is | ✅ Passed through unchanged (already in spec) |
| Sub-2MB raw, dimensions >2000px | ✅ Sent as-is, but `400 Upstream request failed` on some models (e.g. `gpt-5.6-luna`, see issue #94 `payloadBytes=880950`) | ✅ Resized to ≤2000px, re-encoded, sent successfully |
| >2MB raw, any dimensions | ❌ Replaced with placeholder text part (`MAX_TOP_LEVEL_IMAGE_BYTES`) | ✅ Resized + re-encoded; only dropped if normalized base64 still exceeds 5MB |
| Tool-result image (MCP screenshot) | ✅ Subject to separate `MAX_TOOL_RESULT_IMAGE_BYTES = 1MB` raw guard | ✅ Normalized first, then same 1MB raw guard still applies for cumulative history bounding |

### Why the raw-byte guard was not enough

The standalone OpenCode CLI normalizes every image before sending: resize to ≤2000×2000, re-encode to PNG/JPEG, cap base64 at 5MB. The extension did not replicate this step, so it sent pixel-faithful data the gateway rejected. The `MAX_TOP_LEVEL_IMAGE_BYTES = 2_000_000` raw guard introduced in issue #38 was a blunt instrument: it protected the gateway from multi-MB payloads by dropping the image, but it could not recover images that were perfectly sendable after a resize.

---

## Implementation

### `src/imageNormalizer.ts` (new)

WASM-based image normalization via `@silvia-odwyer/photon-node` (~2.3MB unpacked, no native deps, cross-platform single artifact).

```typescript
const MAX_IMAGE_WIDTH = 2_000;
const MAX_IMAGE_HEIGHT = 2_000;
export const MAX_IMAGE_BASE64_BYTES = 5 * 1024 * 1024;
const JPEG_QUALITIES = [80, 85, 70, 55, 40] as const;
```

Pipeline:

1. Parse base64 data URL. Non-data URLs pass through unchanged.
2. Decode via Photon. If decode fails (malformed image), preserve original.
3. If width ≤2000 AND height ≤2000 AND base64 ≤5MB, return URL unchanged (already in spec).
4. Generate candidate sizes via geometric decay (0.75× per step, capped at 32 steps).
5. For each candidate size: resize with Lanczos3, then try PNG → JPEG (quality 80, 85, 70, 55, 40) in order. Return the first encoding whose base64 ≤5MB.
6. If no candidate fits, return original URL (the final payload guard decides whether to drop it).

### `convertMessage()` changes (`src/extension.ts`)

- `convertMessage()` is now `async` and returns `ConvertedMessageResult { messages, normalizedImageCount }`.
- New closure `normalizeImagePart(part)` runs on **both** image paths:
  - Top-level `LanguageModelDataPart` (user paste/drag): line ~3468
  - Tool-result image inside `LanguageModelToolResultPart`: line ~3405
- Normalization runs **before** the final `MAX_IMAGE_BASE64_BYTES` (5MB) guard. Images that normalize successfully bypass the guard; images whose normalized base64 still exceeds 5MB are replaced with a placeholder text part.

### What was removed

- `MAX_TOP_LEVEL_IMAGE_BYTES = 2_000_000` constant — **deleted**. The raw-byte-only guard is obsolete now that a real normalizer exists.
- The old `normalizeImagePartsInPlace()` post-conversion pass — **deleted**. Normalization is now inline in `convertMessage()` so it composes correctly with the guard.

### What was kept

- `MAX_TOOL_RESULT_IMAGE_BYTES = 1_000_000` (1MB raw) for MCP tool-result images. The normalizer does not bound the cumulative multi-image accumulation case (a long agent loop with many screenshots), so the raw guard still serves its original purpose from issue #34.

### Dependency note

`@silvia-odwyer/photon-node` is a WASM module (not a native binary like `sharp`). It adds ~2.16MB to the packaged VSIX but has no platform-specific builds and no native compilation step. The earlier concern from issue #38 about "sharp/native binary impractical in VS Code extension" does not apply to WASM. Dynamic `import()` is used so the module loads lazily on first image request, not at extension activation.

---

## Configuration

No user-facing settings. Normalization is always on for image attachments. If the Photon module fails to load (corrupt install, WASM runtime issue), the normalizer degrades gracefully: original image data is preserved and the final 5MB base64 guard makes the send/drop decision.

---

## Files

| File | Change |
|------|--------|
| `src/imageNormalizer.ts` | New module: `normalizeImageDataUrl`, `getImageDataUrlBase64Bytes`, `MAX_IMAGE_BASE64_BYTES` export |
| `src/extension.ts` | `convertMessage()` → async, inline `normalizeImagePart`, delete `MAX_TOP_LEVEL_IMAGE_BYTES` + old `normalizeImagePartsInPlace` |
| `src/test/imageNormalizer.test.ts` | New: small image pass-through, dimension-limit resize, non-data URL passthrough, malformed image passthrough, 2MB-raw-but-5MB-base64 regression |
| `.vscodeignore` | Exception for `node_modules/@silvia-odwyer/photon-node/**` so WASM artifact ships in VSIX |
| `package.json` | New runtime dependency `@silvia-odwyer/photon-node` ^0.3.4 |

---

## References

- Issue doc: [`docs/issues/44-20260803-issue94-image-normalization.md`](../issues/44-20260803-issue94-image-normalization.md)
- Superseded: [`docs/issues/38-20260725-top-level-image-size-guard.md`](../issues/38-20260725-top-level-image-size-guard.md) (raw-byte guard, deprecated)
- Related: [`docs/features/12-20260720-mcp-tool-result-image-support.md`](12-20260720-mcp-tool-result-image-support.md) (tool-result image guard still applies)
- Follow-up: [`docs/issues/49-20260808-luna-image-invalid-prompt.md`](../issues/49-20260808-luna-image-invalid-prompt.md) (Responses API `image_url` string shape, separate issue)
