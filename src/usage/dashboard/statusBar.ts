import * as vscode from "vscode";
import {
  ACTIVE_PROFILE_EXPLICIT_KEY,
  CONFIG_SECTION,
  DEFAULT_USAGE_REFRESH_INTERVAL_SECONDS,
  SETTING_SHOW_USAGE_STATUS_BAR,
  SETTING_USAGE_REFRESH_INTERVAL_SECONDS,
  secretKeyFor,
} from "../../config";
import type { TransportRequestSummary } from "../../core/transport";
import { GO_VENDOR } from "../../providerTypes";
import { getModelMetadataSnapshot } from "../../models/metadataFetcher";
import { formatGoUsageStatusBarText } from "../formatting";
import { GoUsageTracker } from "../tracker";
import { formatUsageStatusBarText, formatUsageStatusBarTooltip, type UsageSnapshot } from "../usage";
import {
  LEGACY_FINGERPRINT,
  findProfile,
  keyFingerprint,
  nonLegacyCount,
  readMigratedTo,
  readProfiles,
  writeActiveProfile,
  writeMigratedTo,
  writeProfiles,
} from "../usageProfile";
import {
  _extensionContext,
  activeGoUsageTracker,
  activeProfileFingerprint,
  extensionContext,
  goUsageStatusBarItem,
  goUsageTracker,
  goUsageTrackers,
  profileApiKeys,
  profilesCache,
  setActiveProfileFingerprint,
  setGoUsageStatusBarItem,
  setProfilesCache,
  setUsageStatusBarItem,
  usageLogChannel,
  usageStatusBarItem,
  usageTrackerOptions,
} from "./state";
import { buildUsageTooltip } from "./tooltip";
import { updateWebviewContent } from "./webview";

export function startUsageRefreshLoop(context: vscode.ExtensionContext): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = (): void => {
    timer = setTimeout(() => {
      refreshGoUsageStatusBar();
      schedule();
    }, usageRefreshIntervalSeconds() * 1000);
  };
  schedule();
  context.subscriptions.push({
    dispose: () => {
      if (timer) clearTimeout(timer);
    },
  });
}

function usageRefreshIntervalSeconds(): number {
  return Math.max(
    5,
    vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .get<number>(SETTING_USAGE_REFRESH_INTERVAL_SECONDS, DEFAULT_USAGE_REFRESH_INTERVAL_SECONDS),
  );
}

/** Look up (or create) the GoUsageTracker for a given key fingerprint. */
export function getOrCreateTracker(fingerprint: string): GoUsageTracker {
  // The singleton tracker does not have a storage suffix
  if (fingerprint === LEGACY_FINGERPRINT && goUsageTracker) return goUsageTracker;
  let tracker = goUsageTrackers.get(fingerprint);
  if (tracker) return tracker;
  tracker = new GoUsageTracker(
    extensionContext(),
    (msg) => {
      usageLogChannel().appendLine(`[${new Date().toISOString()}] [${fingerprint}] ${msg}`);
    },
    (modelId) => getModelMetadataSnapshot()?.providers[GO_VENDOR]?.[modelId]?.cost,
    fingerprint,
    usageTrackerOptions(),
  );
  goUsageTrackers.set(fingerprint, tracker);
  return tracker;
}
/** Switch the active profile and refresh the UI. Marks the choice as explicit. */
export async function setActiveProfile(fingerprint: string): Promise<void> {
  setActiveProfileFingerprint(fingerprint);
  await writeActiveProfile(extensionContext(), fingerprint);
  // Remember this was a deliberate user choice so provider/request resolution
  // never silently overrides it (issue #63).
  await extensionContext().globalState.update(ACTIVE_PROFILE_EXPLICIT_KEY, true);
  refreshGoUsageStatusBar();
  updateWebviewContent();
}

/**
 * Ensure a profile exists in the in-memory cache for the given API key.
 * This is called both from provideLanguageModelChatInformation (at startup,
 * when VS Code resolves all providers) and from onTransportSummary (when
 * a request completes). The first call creates the profile; subsequent
 * calls are no-ops. Persistence is fire-and-forget.
 */
export function ensureProfileSync(apiKey: string): void {
  const fp = keyFingerprint(apiKey);
  const tracker = getOrCreateTracker(fp);

  if (!findProfile(profilesCache, fp)) {
    const nextNumber = nonLegacyCount(profilesCache) + 1;
    profilesCache.push({
      fingerprint: fp,
      label: `Profile ${String(nextNumber)}`,
      lastSeenAt: Date.now(),
    });
    void writeProfiles(extensionContext(), profilesCache);
  }

  // One-time migration from singleton
  if (!readMigratedTo(extensionContext())) {
    if (goUsageTracker && fp !== LEGACY_FINGERPRINT) {
      tracker.migrateFromSingleton();
    }
    void writeMigratedTo(extensionContext(), fp);
    setProfilesCache(readProfiles(extensionContext()));
  }

  // Update active profile to this one ONLY while the user hasn't explicitly
  // chosen a profile — otherwise every ~300ms model-info resolution would
  // silently override the user's selection.
  if (!extensionContext().globalState.get<boolean>(ACTIVE_PROFILE_EXPLICIT_KEY, false)) {
    setActiveProfileFingerprint(fp);
    void writeActiveProfile(extensionContext(), fp);
  }
}

/**
 * Same as ensureProfileSync, but also refreshes the UI.
 * Called from onTransportSummary during request recording.
 */
export function ensureProfileForApiKey(apiKey: string): GoUsageTracker {
  ensureProfileSync(apiKey);
  // Remember which API key owns each profile, so status-bar refreshes can
  // sync the ACTIVE profile's meters with its own key instead of the
  // extension secret (which may belong to another account).
  profileApiKeys.set(keyFingerprint(apiKey), apiKey);
  return getOrCreateTracker(keyFingerprint(apiKey));
}

// ─── Status bar ──────────────────────────────────────────────────────────────

export function ensureUsageStatusBar(context: vscode.ExtensionContext): vscode.StatusBarItem {
  let item = usageStatusBarItem;
  if (!item) {
    item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 95);
    setUsageStatusBarItem(item);
    context.subscriptions.push(item);
  }

  resetUsageStatusBar();
  return item;
}

function shouldShowUsageStatusBar(): boolean {
  return vscode.workspace.getConfiguration(CONFIG_SECTION).get(SETTING_SHOW_USAGE_STATUS_BAR, true);
}

export function resetUsageStatusBar(): void {
  if (!usageStatusBarItem) {
    return;
  }

  if (!shouldShowUsageStatusBar()) {
    usageStatusBarItem.hide();
    return;
  }

  usageStatusBarItem.text = "OpenCode";
  usageStatusBarItem.tooltip = "OpenCode usage summary";
  usageStatusBarItem.show();
}

export function updateUsageStatusBar(providerDisplayName: string, modelId: string, summary: TransportRequestSummary): void {
  if (!usageStatusBarItem) {
    return;
  }

  if (!shouldShowUsageStatusBar()) {
    usageStatusBarItem.hide();
    return;
  }

  const usage: UsageSnapshot = {
    promptTokens: summary.promptTokens,
    completionTokens: summary.completionTokens,
    totalTokens: summary.totalTokens,
    cachedTokens: summary.cachedTokens,
    finishReason: summary.finishReason,
  };
  const text = formatUsageStatusBarText(providerDisplayName, usage);

  usageStatusBarItem.text = text ?? providerDisplayName;
  usageStatusBarItem.tooltip = formatUsageStatusBarTooltip(providerDisplayName, modelId, usage);
  usageStatusBarItem.show();
}

export function ensureGoUsageStatusBar(context: vscode.ExtensionContext): void {
  if (goUsageStatusBarItem) return;
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 94);
  item.command = "opencodego.showUsageQuickPick";
  setGoUsageStatusBarItem(item);
  context.subscriptions.push(item);
  refreshGoUsageStatusBar();
}

export function refreshGoUsageStatusBar(): void {
  if (!goUsageStatusBarItem) return;
  const tracker = activeGoUsageTracker();
  if (!tracker) {
    goUsageStatusBarItem.text = "OpenCode Go";
    goUsageStatusBarItem.tooltip = new vscode.MarkdownString("");
    goUsageStatusBarItem.show();
    return;
  }
  const s = tracker.getSummary();
  const activeProfile = findProfile(profilesCache, activeProfileFingerprint);
  const baseText = formatGoUsageStatusBarText(s);
  goUsageStatusBarItem.text = activeProfile && profilesCache.length > 1 ? `${baseText} [${activeProfile.label}]` : baseText;
  goUsageStatusBarItem.tooltip = buildUsageTooltip(s);
  goUsageStatusBarItem.show();
  updateWebviewContent();

  // Refresh the server-accurate meters in the background (TTL-guarded); when
  // a new snapshot lands, rebuild the status bar with it. Use the active
  // profile's own key when known, falling back to the extension secret.
  void (async () => {
    const apiKey = profileApiKeys.get(activeProfileFingerprint) ?? (await _extensionContext?.secrets.get(secretKeyFor(GO_VENDOR)));
    if (!apiKey) return;
    const changed = await tracker.syncServerUsage(apiKey);
    if (changed) refreshGoUsageStatusBar();
  })();
}

/**
 * Fetch server-accurate usage for a key and repaint the status bar when a new
 * snapshot arrived. Uses the tracker owning that key (creating its profile on
 * first use), so multi-account setups keep per-key meters.
 */
export async function syncTrackerUsage(tracker: GoUsageTracker, apiKey: string): Promise<void> {
  const changed = await tracker.syncServerUsage(apiKey);
  if (changed) refreshGoUsageStatusBar();
}

// ─── Usage webview panel ─────────────────────────────────────────────────────
