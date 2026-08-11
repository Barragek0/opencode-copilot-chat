import { resolveBaseVendor, type AllProviderVendor } from "./providerTypes";

/**
 * The full configuration key that gates whether a provider is registered at
 * all (`opencodego.enabled` / `opencodezen.enabled`). Agent-host variants
 * resolve to their base vendor, so the agent providers follow the same switch
 * as the vendor they mirror.
 *
 * CONTRACT: callers must read this from the ROOT configuration
 * (`vscode.workspace.getConfiguration().get(key, ...)`), never from a
 * section-scoped configuration — `getConfiguration("opencodego")` resolves
 * keys relative to that section, so passing the full `opencodezen.enabled`
 * key there would silently read `opencodego.opencodezen.enabled` and always
 * fall back to the default.
 */
export function providerEnabledSetting(vendor: AllProviderVendor): string {
  return `${resolveBaseVendor(vendor)}.enabled`;
}
