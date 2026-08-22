import * as vscode from "vscode";
import {
  CONFIG_SECTION,
  DEFAULT_USAGE_CHART_DAYS,
  DEFAULT_USAGE_CODEBASE_ROW,
  DEFAULT_USAGE_CODEBASE_WINDOW_DAYS,
  DEFAULT_USAGE_DAY_BOUNDARY,
  DEFAULT_USAGE_ROLLING_SESSION_METER,
  DEFAULT_USAGE_TODAY_YESTERDAY_SOURCE,
  SETTING_USAGE_CHART_DAYS,
  SETTING_USAGE_CODEBASE_ROW,
  SETTING_USAGE_CODEBASE_WINDOW_DAYS,
  SETTING_USAGE_DAY_BOUNDARY,
  SETTING_USAGE_REFRESH_INTERVAL_SECONDS,
  SETTING_USAGE_ROLLING_SESSION_METER,
  SETTING_USAGE_TODAY_YESTERDAY_SOURCE,
  type UsageTodayYesterdaySource,
} from "../../config";
import { GoUsageTracker, type GoUsageTrackerOptions } from "../tracker";
import { LEGACY_FINGERPRINT, type UsageProfile } from "../usageProfile";

/**
 * Mutable module state for the usage dashboard plus its accessors. All other
 * dashboard modules read/write through here, so the state lives in exactly
 * one place.
 */

export let usageStatusBarItem: vscode.StatusBarItem | undefined;
export let goUsageStatusBarItem: vscode.StatusBarItem | undefined;
/** Singleton tracker — the first/legacy account. Used for backward compat until first migration. */
export let goUsageTracker: GoUsageTracker | undefined;
/** Per-profile trackers indexed by key fingerprint. */
export const goUsageTrackers = new Map<string, GoUsageTracker>();
/** API key per profile fingerprint — lets refreshes sync the active profile's own key. */
export const profileApiKeys = new Map<string, string>();
export let usageWebviewPanel: vscode.WebviewPanel | undefined;

export let profilesCache: UsageProfile[] = [];
export let activeProfileFingerprint: string = LEGACY_FINGERPRINT;

export let _extensionContext: vscode.ExtensionContext | undefined;
export let _usageLogChannel: vscode.OutputChannel | undefined;

/** Whether the usage webview has received its initial HTML (data flows via postMessage after that). */
export let usageWebviewRendered = false;
/** Selected chart window in days (0 = lifetime); the webview toggles it via message. */
export let usageChartWindowDays: number = vscode.workspace
  .getConfiguration(CONFIG_SECTION)
  .get<number>(SETTING_USAGE_CHART_DAYS, DEFAULT_USAGE_CHART_DAYS);

/**
 * Returns the extension context, or throws if the extension has not been
 * activated yet. Callers must be reached after `activate()` has run.
 */
export function extensionContext(): vscode.ExtensionContext {
  if (!_extensionContext) {
    throw new Error("extension context not initialized");
  }
  return _extensionContext;
}

/**
 * Returns the usage log output channel, or throws if the extension has not
 * been activated yet. Callers must be reached after `activate()` has run.
 */
export function usageLogChannel(): vscode.OutputChannel {
  if (!_usageLogChannel) {
    throw new Error("usage log channel not initialized");
  }
  return _usageLogChannel;
}

export function setExtensionContext(context: vscode.ExtensionContext): void {
  _extensionContext = context;
}

export function setUsageLogChannel(channel: vscode.OutputChannel): void {
  _usageLogChannel = channel;
}

export function setGoUsageTracker(tracker: GoUsageTracker | undefined): void {
  goUsageTracker = tracker;
}

export function setProfilesCache(profiles: UsageProfile[]): void {
  profilesCache = profiles;
}

export function setActiveProfileFingerprint(fingerprint: string): void {
  activeProfileFingerprint = fingerprint;
}

export function setUsageChartWindowDays(days: number): void {
  usageChartWindowDays = days;
}

export function setUsageWebviewRendered(rendered: boolean): void {
  usageWebviewRendered = rendered;
}

/** Mutate module state through setters — imported bindings are read-only. */
export function setUsageStatusBarItem(item: vscode.StatusBarItem | undefined): void {
  usageStatusBarItem = item;
}

export function setGoUsageStatusBarItem(item: vscode.StatusBarItem | undefined): void {
  goUsageStatusBarItem = item;
}

export function setUsageWebviewPanel(panel: vscode.WebviewPanel | undefined): void {
  usageWebviewPanel = panel;
}

/**
 * Resolvers for the per-view usage knobs, read live from configuration so
 * changing a setting repaints the status bar / tooltip / card immediately.
 */
export function usageTrackerOptions(): GoUsageTrackerOptions {
  const config = () => vscode.workspace.getConfiguration(CONFIG_SECTION);
  return {
    resolveWorkspaceFolders: () => vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? [],
    resolveTodayYesterdaySource: () =>
      config().get<UsageTodayYesterdaySource>(SETTING_USAGE_TODAY_YESTERDAY_SOURCE, DEFAULT_USAGE_TODAY_YESTERDAY_SOURCE),
    resolveCodebaseWindowDays: () => config().get<number>(SETTING_USAGE_CODEBASE_WINDOW_DAYS, DEFAULT_USAGE_CODEBASE_WINDOW_DAYS),
    resolveDayBoundary: () => config().get<"utc" | "local">(SETTING_USAGE_DAY_BOUNDARY, DEFAULT_USAGE_DAY_BOUNDARY),
  };
}

/** Whether the detailed usage views show the server 5h rolling meter. */
export function usageRollingMeterVisible(): boolean {
  return vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<boolean>(SETTING_USAGE_ROLLING_SESSION_METER, DEFAULT_USAGE_ROLLING_SESSION_METER);
}

/** Whether the detailed usage views show the all-time codebase row. */
export function usageCodebaseRowVisible(): boolean {
  return vscode.workspace.getConfiguration(CONFIG_SECTION).get<boolean>(SETTING_USAGE_CODEBASE_ROW, DEFAULT_USAGE_CODEBASE_ROW);
}

/** Every usage-view setting — a change to any of these repaints immediately. */
export const USAGE_DISPLAY_SETTING_KEYS = [
  SETTING_USAGE_TODAY_YESTERDAY_SOURCE,
  SETTING_USAGE_CODEBASE_ROW,
  SETTING_USAGE_CODEBASE_WINDOW_DAYS,
  SETTING_USAGE_DAY_BOUNDARY,
  SETTING_USAGE_ROLLING_SESSION_METER,
  SETTING_USAGE_REFRESH_INTERVAL_SECONDS,
];

/** Return the tracker for the currently active profile. */
export function activeGoUsageTracker(): GoUsageTracker | undefined {
  if (activeProfileFingerprint === LEGACY_FINGERPRINT) return goUsageTracker;
  return goUsageTrackers.get(activeProfileFingerprint);
}
