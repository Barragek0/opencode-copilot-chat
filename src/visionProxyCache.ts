import { createHash } from "node:crypto";
import { IMAGE_DESCRIPTION_CACHE_LIMIT } from "./config";

export { IMAGE_DESCRIPTION_CACHE_LIMIT } from "./config";

/**
 * Cache mapping an image's content hash to the text description produced by
 * the vision proxy.
 *
 * WHY: text-only models receive the same image attachments on EVERY turn of a
 * conversation. Without a cache, `proxyVision()` would call the vision model
 * via `model.sendRequest()` on each turn to describe the same bytes again —
 * wasting Copilot quota, adding latency, and returning a different description
 * every time. With this cache, once an image has been described, future turns
 * reuse that description and never re-call the vision model.
 *
 * Key   = SHA-256 of the image's base64 bytes (produced by `dataPartToBase64`),
 *         so the cache stays small even for large images.
 * Value = the text description returned by the vision proxy.
 *
 * When a message contains several images, the combined description is stored
 * under EVERY image hash, mirroring how `proxyVision()` describes a message as
 * one unit.
 */
export const imageDescriptionCache = new Map<string, string>();

/**
 * Stable key for an image's bytes. We hash the base64 string (as produced by
 * `dataPartToBase64`) rather than keeping the string itself, which keeps memory
 * usage small for large images.
 */
export function imageDescriptionKey(base64: string): string {
  return createHash("sha256").update(base64).digest("hex");
}

/**
 * Return the cached description for a set of image hashes, or `undefined` when
 * ANY hash is missing. When multiple images were described together, the same
 * combined description is stored under every hash, so all stored values are
 * identical and we return the first one.
 */
export function lookupImageDescriptions(hashes: readonly string[]): string | undefined {
  if (hashes.length === 0) {
    return undefined;
  }
  const first = imageDescriptionCache.get(hashes[0]);
  if (first === undefined) {
    return undefined;
  }
  for (let index = 1; index < hashes.length; index++) {
    if (!imageDescriptionCache.has(hashes[index])) {
      return undefined;
    }
  }
  return first;
}

/**
 * Store a description under every image hash. Once the cache exceeds
 * {@link IMAGE_DESCRIPTION_CACHE_LIMIT}, the oldest entries are evicted (FIFO),
 * mirroring the reasoning-content cache's eviction strategy.
 */
export function storeImageDescriptions(hashes: readonly string[], description: string): void {
  for (const hash of hashes) {
    imageDescriptionCache.set(hash, description);
  }
  while (imageDescriptionCache.size > IMAGE_DESCRIPTION_CACHE_LIMIT) {
    const oldest = imageDescriptionCache.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    imageDescriptionCache.delete(oldest);
  }
}

/** Test helper: drop all cached entries. */
export function clearImageDescriptionCache(): void {
  imageDescriptionCache.clear();
}
