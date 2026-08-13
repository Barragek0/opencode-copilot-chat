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
import {
  CONFIG_SECTION,
  DEFAULT_INLINE_DEBOUNCE_MS,
  DEFAULT_INLINE_MAX_TOKENS,
  DEFAULT_INLINE_MODEL,
  DEFAULT_INLINE_PREFIX_LINES,
  DEFAULT_INLINE_SUFFIX_CHARS,
  DEFAULT_INLINE_TIMEOUT_MS,
  INLINE_DEBOUNCE_MS_SETTING,
  INLINE_MAX_TOKENS_SETTING,
  INLINE_PREFIX_LINES_SETTING,
  INLINE_SUGGESTIONS_MODEL_SETTING,
  INLINE_SUGGESTIONS_SETTING,
  INLINE_SUFFIX_CHARS_SETTING,
  INLINE_TIMEOUT_MS_SETTING,
} from "../config";
import { toFiniteNumber } from "../utils";

export {
  INLINE_SUGGESTIONS_SETTING,
  INLINE_SUGGESTIONS_MODEL_SETTING,
  INLINE_DEBOUNCE_MS_SETTING,
  INLINE_TIMEOUT_MS_SETTING,
  INLINE_MAX_TOKENS_SETTING,
  INLINE_PREFIX_LINES_SETTING,
  INLINE_SUFFIX_CHARS_SETTING,
  DEFAULT_INLINE_MODEL,
  DEFAULT_INLINE_DEBOUNCE_MS,
  DEFAULT_INLINE_TIMEOUT_MS,
  DEFAULT_INLINE_MAX_TOKENS,
  DEFAULT_INLINE_PREFIX_LINES,
  DEFAULT_INLINE_SUFFIX_CHARS,
} from "../config";

export interface InlineCompletionsDeps {
  /** Gateway chat-completions URL (Go). */
  chatCompletionsUrl: string;
  /** Resolve the API key to use (extension secret / BYOK group key). */
  resolveApiKey: () => Promise<string | undefined>;
  log?: (msg: string) => void;
}

function readSetting<T>(key: string, fallback: T): T {
  return vscode.workspace.getConfiguration(CONFIG_SECTION).get<T>(key, fallback);
}

/** Read a numeric setting, clamped to a sane range (guards against bad config values). */
function readNumberSetting(key: string, fallback: number, min: number, max: number): number {
  return toFiniteNumber(readSetting(key, fallback), fallback, min, max);
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
        timeoutMs: readNumberSetting(INLINE_TIMEOUT_MS_SETTING, DEFAULT_INLINE_TIMEOUT_MS, 500, 15_000),
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
    resolveDebounceMs: () => readNumberSetting(INLINE_DEBOUNCE_MS_SETTING, DEFAULT_INLINE_DEBOUNCE_MS, 50, 2_000),
    resolveMaxTokens: () => readNumberSetting(INLINE_MAX_TOKENS_SETTING, DEFAULT_INLINE_MAX_TOKENS, 16, 1_024),
    resolvePrefixLines: () => readNumberSetting(INLINE_PREFIX_LINES_SETTING, DEFAULT_INLINE_PREFIX_LINES, 1, 100),
    resolveSuffixChars: () => readNumberSetting(INLINE_SUFFIX_CHARS_SETTING, DEFAULT_INLINE_SUFFIX_CHARS, 0, 5_000),
  });

  const registration = vscode.languages.registerInlineCompletionItemProvider({ pattern: "**" }, provider);
  context.subscriptions.push(registration, provider);
  return registration;
}
