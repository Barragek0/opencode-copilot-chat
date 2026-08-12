/**
 * Inline completions registration (issue #49).
 *
 * Wires the completion engine + provider into the extension. The provider
 * checks the opt-in configuration live, resolves the API key per request,
 * and the engine is created with that key (cheap). Register once; toggling
 * `opencodego.inlineSuggestions` is honored on the fly.
 */

import * as vscode from "vscode";
import { ChatCompletionEngine } from "./engine";
import { OpenCodeInlineCompletionProvider } from "./provider";
import type { CompletionContext, CompletionEngine, CompletionResult } from "./types";

export const INLINE_SUGGESTIONS_SETTING = "inlineSuggestions";
export const INLINE_SUGGESTIONS_MODEL_SETTING = "inlineSuggestionsModel";
export const DEFAULT_INLINE_MODEL = "qwen3.5-plus";

export interface InlineCompletionsDeps {
  /** Gateway chat-completions URL (Go). */
  chatCompletionsUrl: string;
  /** Resolve the API key to use (extension secret / BYOK group key). */
  resolveApiKey: () => Promise<string | undefined>;
  log?: (msg: string) => void;
}

export function registerInlineCompletions(context: vscode.ExtensionContext, deps: InlineCompletionsDeps): vscode.Disposable {
  const engine: CompletionEngine = {
    id: "chat-completions",
    async complete(ctx: CompletionContext, signal: AbortSignal): Promise<CompletionResult> {
      const apiKey = await deps.resolveApiKey();
      if (!apiKey) {
        return { text: undefined, durationMs: 0 };
      }
      const keyed = new ChatCompletionEngine({
        chatCompletionsUrl: deps.chatCompletionsUrl,
        apiKey,
        log: deps.log,
      });
      return keyed.complete(ctx, signal);
    },
  };

  const provider = new OpenCodeInlineCompletionProvider({
    engine,
    resolveApiKey: deps.resolveApiKey,
    isEnabled: () => vscode.workspace.getConfiguration("opencodego").get<boolean>(INLINE_SUGGESTIONS_SETTING, false),
    resolveModelId: () =>
      vscode.workspace.getConfiguration("opencodego").get<string>(INLINE_SUGGESTIONS_MODEL_SETTING, DEFAULT_INLINE_MODEL) || "",
  });

  const registration = vscode.languages.registerInlineCompletionItemProvider({ pattern: "**" }, provider);
  context.subscriptions.push(registration, provider);
  return registration;
}
