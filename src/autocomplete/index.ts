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
export const INLINE_DEBOUNCE_MS_SETTING = "inlineSuggestionsDebounceMs";
export const INLINE_TIMEOUT_MS_SETTING = "inlineSuggestionsTimeoutMs";
export const INLINE_MAX_TOKENS_SETTING = "inlineSuggestionsMaxTokens";
export const INLINE_PREFIX_LINES_SETTING = "inlineSuggestionsPrefixLines";
export const INLINE_SUFFIX_CHARS_SETTING = "inlineSuggestionsSuffixChars";
export const DEFAULT_INLINE_MODEL = "qwen3.5-plus";
export const DEFAULT_INLINE_DEBOUNCE_MS = 300;
export const DEFAULT_INLINE_TIMEOUT_MS = 3_000;
export const DEFAULT_INLINE_MAX_TOKENS = 128;
export const DEFAULT_INLINE_PREFIX_LINES = 10;
export const DEFAULT_INLINE_SUFFIX_CHARS = 300;

export interface InlineCompletionsDeps {
  /** Gateway chat-completions URL (Go). */
  chatCompletionsUrl: string;
  /** Resolve the API key to use (extension secret / BYOK group key). */
  resolveApiKey: () => Promise<string | undefined>;
  log?: (msg: string) => void;
}

function readSetting<T>(key: string, fallback: T): T {
  return vscode.workspace.getConfiguration("opencodego").get<T>(key, fallback);
}

export function registerInlineCompletions(context: vscode.ExtensionContext, deps: InlineCompletionsDeps): vscode.Disposable {
  const output = vscode.window.createOutputChannel("OpenCode Completions");
  context.subscriptions.push(output);
  const log = (msg: string): void => {
    output.appendLine(msg);
  };

  const engine: CompletionEngine = {
    id: "chat-completions",
    async complete(ctx: CompletionContext, signal: AbortSignal): Promise<CompletionResult> {
      const apiKey = await deps.resolveApiKey();
      if (!apiKey) {
        log("[completions] no API key — skipping");
        return { text: undefined, durationMs: 0 };
      }
      log(`[completions] model=${ctx.modelId} prefixChars=${String(ctx.prefix.length)} suffixChars=${String(ctx.suffix.length)}`);
      const keyed = new ChatCompletionEngine({
        chatCompletionsUrl: deps.chatCompletionsUrl,
        apiKey,
        timeoutMs: readSetting(INLINE_TIMEOUT_MS_SETTING, DEFAULT_INLINE_TIMEOUT_MS),
        log: (msg) => {
          log(msg);
        },
      });
      return keyed.complete(ctx, signal);
    },
  };

  const provider = new OpenCodeInlineCompletionProvider({
    engine,
    resolveApiKey: deps.resolveApiKey,
    isEnabled: () => readSetting(INLINE_SUGGESTIONS_SETTING, false),
    resolveModelId: () => readSetting(INLINE_SUGGESTIONS_MODEL_SETTING, DEFAULT_INLINE_MODEL),
    resolveDebounceMs: () => readSetting(INLINE_DEBOUNCE_MS_SETTING, DEFAULT_INLINE_DEBOUNCE_MS),
    resolveMaxTokens: () => readSetting(INLINE_MAX_TOKENS_SETTING, DEFAULT_INLINE_MAX_TOKENS),
    resolvePrefixLines: () => readSetting(INLINE_PREFIX_LINES_SETTING, DEFAULT_INLINE_PREFIX_LINES),
    resolveSuffixChars: () => readSetting(INLINE_SUFFIX_CHARS_SETTING, DEFAULT_INLINE_SUFFIX_CHARS),
  });

  const registration = vscode.languages.registerInlineCompletionItemProvider({ pattern: "**" }, provider);
  context.subscriptions.push(registration, provider);
  return registration;
}
