/**
 * Usage dashboard — public surface.
 *
 * The implementation is split by responsibility:
 * - `dashboard/state`    — mutable module state + accessors
 * - `dashboard/statusBar`— status bars, refresh loop, tracker/profile management
 * - `dashboard/webview`  — webview panel lifecycle + content updates
 * - `dashboard/webviewData` — chart/stat payload assembly for the webview
 * - `dashboard/webviewHtml` — the webview HTML document template
 * - `dashboard/tooltip`  — status-bar hover card (SVG)
 * - `dashboard/targetEditor` — "Set spent targets" input flow
 *
 * This barrel re-exports everything so existing `usage/dashboard` import
 * paths keep working.
 */
export * from "./dashboard/state";
export * from "./dashboard/statusBar";
export * from "./dashboard/webview";
export * from "./dashboard/targetEditor";
