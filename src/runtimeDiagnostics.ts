import { execFileSync } from "node:child_process";
import * as vscode from "vscode";

export function runtimeDiagnosticsLines(context: vscode.ExtensionContext): string[] {
  const packageJson = context.extension.packageJSON as { version?: unknown };

  return [
    `- extensionVersion: ${stringValue(packageJson.version, "unknown")}`,
    `- vscodeVersion: ${vscode.version}`,
    `- appHost: ${vscode.env.appHost}`,
    `- remoteName: ${vscode.env.remoteName ?? "local"}`,
    `- uiKind: ${vscode.env.uiKind === vscode.UIKind.Web ? "web" : "desktop"}`,
    `- extensionMode: ${extensionModeLabel(context.extensionMode)}`,
    `- workspaceTrusted: ${String(vscode.workspace.isTrusted)}`,
    `- platform: ${process.platform}`,
    `- architecture: ${process.arch}`,
    `- nodeVersion: ${process.version}`,
    `- windowsIntegrity: ${windowsIntegrityLevel()}`,
    `- extensionPath: ${context.extension.extensionPath}`,
    `- executablePath: ${process.execPath}`,
  ];
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value ? value : fallback;
}

function extensionModeLabel(mode: vscode.ExtensionMode): string {
  switch (mode) {
    case vscode.ExtensionMode.Development:
      return "development";
    case vscode.ExtensionMode.Test:
      return "test";
    default:
      return "production";
  }
}

function windowsIntegrityLevel(): string {
  if (process.platform !== "win32") return "not-applicable";

  try {
    const groups = execFileSync("whoami.exe", ["/groups", "/fo", "csv", "/nh"], {
      encoding: "utf8",
      timeout: 2000,
      windowsHide: true,
    });

    if (/S-1-16-(?:12288|16384|20480)/i.test(groups)) return "high (elevated)";
    if (/S-1-16-8192/i.test(groups)) return "medium (not elevated)";
    if (/S-1-16-4096/i.test(groups)) return "low";
    return "unknown";
  } catch (error) {
    return `unavailable (${error instanceof Error ? error.message : String(error)})`;
  }
}
