/** Resolve a request key across native BYOK, the live model registry, and cold-start storage. */
export function resolveResponseApiKey(
  configuredApiKey: string | undefined,
  registeredApiKey: string | undefined,
  storedApiKey: string | undefined,
): string | undefined {
  return configuredApiKey || registeredApiKey || storedApiKey;
}
