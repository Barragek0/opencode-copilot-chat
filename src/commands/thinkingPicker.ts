import * as vscode from "vscode";
import { CONFIG_SECTION } from "../config";
import { getSettings, THINKING_ALLOWED_VALUES } from "../provider/settings";

/** Pick a model family then set its Thinking effort (writes config). */
export async function showThinkingEffortPicker(): Promise<void> {
  // Single source of truth (shared with request-time validation) so the option
  // lists can never drift from what the request builder actually accepts.
  const families: { label: string; key: keyof typeof THINKING_ALLOWED_VALUES; options: string[] }[] = [
    { label: "DeepSeek (deepseek-v4-*)", key: "deepseek", options: [...THINKING_ALLOWED_VALUES.deepseek] },
    { label: "GLM (glm-5, glm-5.1, glm-5.2)", key: "glm", options: [...THINKING_ALLOWED_VALUES.glm] },
    { label: "Kimi (kimi-k2.*)", key: "kimi", options: [...THINKING_ALLOWED_VALUES.kimi] },
    { label: "Mimo (mimo-v2.*)", key: "mimo", options: [...THINKING_ALLOWED_VALUES.mimo] },
    { label: "MiniMax (minimax-m*)", key: "minimax", options: [...THINKING_ALLOWED_VALUES.minimax] },
    { label: "OpenAI GPT (gpt-*)", key: "openai", options: [...THINKING_ALLOWED_VALUES.openai] },
    { label: "Qwen (qwen3.*)", key: "qwen", options: [...THINKING_ALLOWED_VALUES.qwen] },
    { label: "Qwen Thinking Budget", key: "qwenBudget", options: [...THINKING_ALLOWED_VALUES.qwenBudget] },
    { label: "Muse Spark (muse-spark-*)", key: "muse", options: [...THINKING_ALLOWED_VALUES.muse] },
  ];
  const settings = getSettings().thinking;
  const family = await vscode.window.showQuickPick(
    families.map((f) => ({ label: f.label, description: `current: ${settings[f.key]}`, family: f })),
    { placeHolder: "Pick a model family to configure Thinking" },
  );
  if (!family) return;
  const choice = await vscode.window.showQuickPick(family.family.options, {
    placeHolder: `Set ${family.family.label} → Thinking value`,
  });
  if (!choice) return;
  const cfg = vscode.workspace.getConfiguration(`${CONFIG_SECTION}.thinking`);
  await cfg.update(family.family.key, choice, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(`OpenCode Thinking — ${family.family.label}: ${choice}`);
}
