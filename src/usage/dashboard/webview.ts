import * as vscode from "vscode";
import {
  goUsageTracker,
  setUsageChartWindowDays,
  setUsageWebviewPanel,
  setUsageWebviewRendered,
  usageWebviewPanel,
  usageWebviewRendered,
} from "./state";
import { usageWebviewData } from "./webviewData";
import { usageWebviewHtml } from "./webviewHtml";
import { refreshGoUsageStatusBar } from "./statusBar";

export function showUsageWebview(context: vscode.ExtensionContext): void {
  if (usageWebviewPanel) {
    usageWebviewPanel.reveal(vscode.ViewColumn.Beside);
    return;
  }

  const panel = vscode.window.createWebviewPanel("opencodego.usageWebview", "OpenCode Usage", vscode.ViewColumn.Beside, {
    enableScripts: true,
    retainContextWhenHidden: true,
  });
  setUsageWebviewPanel(panel);

  panel.onDidDispose(
    () => {
      setUsageWebviewPanel(undefined);
      setUsageWebviewRendered(false);
    },
    null,
    context.subscriptions,
  );

  panel.webview.onDidReceiveMessage(
    (message: { type?: string }) => {
      switch (message.type) {
        case "refresh":
          refreshGoUsageStatusBar();
          break;
        case "setTargets":
          void vscode.commands.executeCommand("opencodego.setUsageTargets");
          break;
        case "renameProfile":
          void vscode.commands.executeCommand("opencodego.renameActiveProfile");
          break;
        case "window": {
          const days = Number((message as { days?: unknown }).days);
          if (Number.isFinite(days) && days >= 0 && days <= 370) {
            setUsageChartWindowDays(days);
            updateWebviewContent();
          }
          break;
        }
      }
    },
    null,
    context.subscriptions,
  );

  setUsageWebviewRendered(false);
  updateWebviewContent();
}

export function updateWebviewContent(): void {
  const panel = usageWebviewPanel;
  if (!panel || !goUsageTracker) return;
  const data = usageWebviewData();
  if (!data) {
    panel.webview.html = `<html><body><p>No active tracker</p></body></html>`;
    setUsageWebviewRendered(false);
    return;
  }

  if (!usageWebviewRendered) {
    // First paint: render the full page. Later refreshes only push new data
    // via postMessage so the user's active tab and chart stay in place.
    panel.webview.html = usageWebviewHtml(String(data.profile));
    setUsageWebviewRendered(true);
  }
  void panel.webview.postMessage({ type: "usage", data });
}
