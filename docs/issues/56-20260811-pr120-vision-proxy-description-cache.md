# PR #120 — Cache Vision-Proxy Image Descriptions + Whole-Conversation Mode

**Date:** 2026-08-11
**Status:** ✅ Merged (merge commit `8f6cb9f`, 2026-08-10T23:16:17Z)
**Related:** Issue [#119](https://github.com/ltmoerdani/opencode-copilot-chat/issues/119) (closes), PR [#120](https://github.com/ltmoerdani/opencode-copilot-chat/pull/120)
**Author:** [@ChauThan](https://github.com/ChauThan)
**Branch:** `feat/vision-proxy-description-cache`
**Base feature doc:** `docs/features/11-20260715-vision-proxy.md` (Section "Description Cache & Whole-Conversation Mode")

## Summary

The vision proxy re-described the same image bytes on **every** turn of a multi-turn conversation. When a text-only model was paired with the vision proxy, `proxyVision()` called the vision model via `model.sendRequest()` each turn for the same attachments — wasting Copilot quota, adding latency, and producing a different description every time.

This PR adds a per-image description cache keyed by the SHA-256 of the image's base64 bytes, so already-described images are reused on later turns without contacting the vision model. It also adds an opt-in setting to restore whole-conversation context for descriptions.

## What Changed

### 1. New `src/visionProxyCache.ts` — in-memory description cache

- `Map<string, string>` keyed by SHA-256 of the image's base64 bytes (keeps memory small for large images).
- Capped at `IMAGE_DESCRIPTION_CACHE_LIMIT = 200` entries with FIFO eviction (mirrors the reasoning-content cache strategy).
- Public helpers: `imageDescriptionKey()`, `lookupImageDescriptions()` (returns `undefined` when ANY hash in the set is missing), `storeImageDescriptions()` (stores the combined description under every hash), `clearImageDescriptionCache()` (test helper).
- A message whose images are **all** cached reuses the cached description — no vision-model request at all.

### 2. `src/extension.ts` — `proxyVision()` refactor

- **Lazy vision-model resolution:** the model is only resolved (`selectChatModels()`) when a message actually needs a new description. When every image is cached, neither `selectChatModels()` nor `sendRequest()` runs.
- **Per-message describing (default):** only the message that contains a *new* image is sent to the vision model (message parts + prompt), instead of re-sending the whole conversation.
- **Whole-conversation mode (opt-in):** `opencodego.visionProxyWholeConversation` (default `false`). When on, `proxyVision()` sends ONE request over all messages so descriptions carry full conversation context; the combined description is stored under every image hash (same no-partial-reuse rule).
- **Flattened-message mapping:** converted messages are flattened with a `flatSourceIndex` array, tracking which original message produced each `apiMessage` (one input message can expand into several, e.g. tool results). Descriptions are keyed by original message index so the correct description lands on the right `apiMessage`.
- Refactored request builders: `collectRequestParts()`, `buildVisionRequestMessage()` (single message), `buildWholeConversationRequest()` (whole conversation).
- Log line now reports `(N from cache, M newly described)`.

### 3. Setting + docs

- `package.json`: new `opencodego.visionProxyWholeConversation` boolean (default `false`).
- `README.md`: new row in the settings table.
- `docs/features/11-20260715-vision-proxy.md`: new section "Description Cache & Whole-Conversation Mode".

### 4. Tests

- `src/test/visionProxy.test.ts`: 7 new tests for the cache — stable SHA-256 key, empty lookup, store under every hash, partial-hit returns `undefined`, reuse on second turn, FIFO eviction at limit, `clear()`.

## Review Timeline

1. **2026-08-08 — Round 1 (maintainer review, @ltmoerdani).** Positive on structure/tests. Two points to confirm:
   - Multi-image messages: the combined description is stored under every hash, so an image that appears alone later gets a description mentioning the other image. Not a correctness issue (partial hit forces a re-describe) — confirming it was intended.
   - Behavior change: the proxy now describes only the message with a new image instead of the whole conversation, so descriptions lose some conversation context. FYI.
   - Also flagged: lockfile sync `0.5.0 → 0.5.1` fixes a mismatch on main (package.json was already 0.5.1); extra `peer: true` flags look like npm-version noise, harmless.
2. **2026-08-09 — Author reply (@ChauThan).**
   - Multi-image: **intentional**. A partial hit returns nothing, so the message is described again — no risk of wrong descriptions.
   - Per-message behavior: **not intentional**; author proposed adding a setting flag so users choose the trade-off.
3. **2026-08-09 — Maintainer approval.** Agreed to the setting flag with guardrails: keep cache behavior as default, gate whole-conversation behind the flag, add a short docs entry.
4. **2026-08-10 — Author implemented (`e370512`).** Added `opencodego.visionProxyWholeConversation` (default `false`), `proxyVision()` takes `describeWholeConversation`, whole-conversation branch sends one request over all messages and stores the combined description under every hash. README settings table + feature doc section. Author reports compile / 168 tests / lint:js green.
5. **2026-08-11 — Maintainer local verification (in isolated worktree).** All green:
   - `npm run compile` ✅
   - `npm test` → 168 pass, 0 fail (7 new cache tests) ✅
   - `npm run lint:js` ✅
   - markdownlint on the feature doc ✅

## Design Notes (non-blocking)

- **Whole-conversation mode and the cache:** in whole-conversation mode every turn re-describes the whole conversation (the context changes each turn), so the cache is effectively not hit *within* that mode — it only pays off after switching back to the default mode. This is the expected "full context, more tokens" trade-off; the setting is opt-in.
- **Tool-result images:** nested images inside `LanguageModelToolResultPart` are not sent to the vision model (consistent with prior behavior). They fall back to the first available description in the pass.

## Merge Strategy

Merged via **regular merge commit** (`8f6cb9f`, parents `190b9ee` + `e370512`) to preserve both of ChauThan's commits (`e02bef8` cache, `e370512` whole-conversation mode). No squash (per project policy — contributor history preservation).

## Files Changed

7 files, +439 / −73 (cumulative over the PR's 2 commits):

| File | Change |
| --- | --- |
| `src/visionProxyCache.ts` | **New** — image description cache (SHA-256 key, 200-entry FIFO) |
| `src/extension.ts` | `proxyVision()` refactor (lazy model resolve, per-message + whole-conversation modes, flattened-message mapping, request builders), setting read |
| `src/test/visionProxy.test.ts` | 7 new cache tests |
| `package.json` | `opencodego.visionProxyWholeConversation` setting |
| `README.md` | Settings table row |
| `docs/features/11-20260715-vision-proxy.md` | "Description Cache & Whole-Conversation Mode" section |
| `package-lock.json` | Version sync `0.5.0 → 0.5.1` + `peer: true` noise on a few dev deps |

## Code Locations (on `main`)

| Concern | Location |
| --- | --- |
| Cache module | `src/visionProxyCache.ts` — `imageDescriptionCache` L22, `IMAGE_DESCRIPTION_CACHE_LIMIT` L25, `imageDescriptionKey` L32, `lookupImageDescriptions` L42, `storeImageDescriptions` L63, `clearImageDescriptionCache` L77 |
| Cache import | `src/extension.ts` L51 |
| Whole-conversation setting read | `src/extension.ts` ~L2265 |
| Request builders | `src/extension.ts` — `collectRequestParts()` L4088, `buildVisionRequestMessage()` L4111, `buildWholeConversationRequest()` L4137 |
| `proxyVision()` | `src/extension.ts` ~L4178 |

## References

- Issue: [#119](https://github.com/ltmoerdani/opencode-copilot-chat/issues/119)
- PR: [#120](https://github.com/ltmoerdani/opencode-copilot-chat/pull/120)
- Feature doc: `docs/features/11-20260715-vision-proxy.md`
- Base vision proxy PR: [#76](https://github.com/ltmoerdani/opencode-copilot-chat/pull/76)
