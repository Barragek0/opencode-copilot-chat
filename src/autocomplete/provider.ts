/**
 * InlineCompletionItemProvider for ghost-text suggestions (issue #49).
 *
 * Opt-in via `opencodego.inlineSuggestions`. The provider debounces typing
 * (300ms), aborts in-flight requests on the next keystroke, and returns a
 * single completion item whose insertText is the model's suggestion.
 */

import * as vscode from "vscode";
import { buildCompletionWindow, isChatInputDocument, isCompletionDocument } from "./context";
import { Debouncer } from "./throttle";
import type { CompletionContext, CompletionEngine } from "./types";

export interface InlineCompletionProviderOptions {
  engine: CompletionEngine;
  /** Resolve the API key (async; the caller owns caching/fallbacks). */
  resolveApiKey: () => Promise<string | undefined>;
  /** Called once when a ghost-text suggestion is actually returned to VS Code. */
  onSuggestion?: (text: string, position: vscode.Position, document: vscode.TextDocument) => void;
  /** Whether suggestions are currently enabled (config-driven). */
  isEnabled: () => boolean;
  /** The model to use for suggestions (config-driven). */
  resolveModelId: () => string;
  /** Whether suggestions are allowed inside the chat prompt box (opt-in). */
  resolveChatInputEnabled: () => boolean;
  /** Debounce delay in ms before a request is sent (config-driven). */
  resolveDebounceMs: () => number;
  /** Max tokens a completion may produce (config-driven). */
  resolveMaxTokens: () => number;
  /** Context window: lines before the cursor (config-driven). */
  resolvePrefixLines: () => number;
  /** Context window: chars after the cursor (config-driven). */
  resolveSuffixChars: () => number;
}

export class OpenCodeInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
  private readonly debouncer: Debouncer;

  constructor(private readonly options: InlineCompletionProviderOptions) {
    this.debouncer = new Debouncer(options.resolveDebounceMs());
  }

  provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    if (!this.options.isEnabled()) {
      return Promise.resolve(undefined);
    }

    // Only offer completions in real editable code surfaces. The Copilot
    // Chat prompt box is a virtual chatSessionInput document — excluded by
    // default (completions belong in code editors); users can opt in via
    // opencodego.inlineSuggestionsChatInput.
    if (!isCompletionDocument(document.uri) && !(isChatInputDocument(document.uri) && this.options.resolveChatInputEnabled())) {
      return Promise.resolve(undefined);
    }

    // Keep the debounce window live: a config change applies on the next
    // keystroke instead of requiring the provider to be recreated.
    const debounceMs = this.options.resolveDebounceMs();
    if (debounceMs !== this.debouncer.delayMs) {
      this.debouncer.delayMs = debounceMs;
    }

    const text = document.getText();
    const offset = document.offsetAt(position);
    const { prefix, suffix } = buildCompletionWindow(text, offset, {
      prefixLines: this.options.resolvePrefixLines(),
      suffixChars: this.options.resolveSuffixChars(),
    });
    if (!prefix.trim()) {
      return Promise.resolve(undefined);
    }
    const modelId = this.options.resolveModelId();
    if (!modelId) {
      return Promise.resolve(undefined);
    }

    return new Promise<vscode.InlineCompletionItem[] | undefined>((resolve) => {
      const finish = (items: vscode.InlineCompletionItem[] | undefined): void => {
        if (token.isCancellationRequested) {
          resolve(undefined);
          return;
        }
        resolve(items);
      };

      const tokenSubscription = token.onCancellationRequested(() => {
        // Do NOT cancel the shared debouncer here: VS Code may cancel this
        // request's token AFTER a newer keystroke already scheduled its own
        // debounced run, and aborting the debouncer would kill that newer
        // pending suggestion. The debouncer cancels the previous run itself
        // when the next debounce() is scheduled; here we only resolve this
        // request's promise as "no suggestion".
        finish(undefined);
      });

      this.debouncer.debounce(async (signal) => {
        tokenSubscription.dispose();
        if (signal.aborted || token.isCancellationRequested) {
          finish(undefined);
          return;
        }
        const apiKey = await this.options.resolveApiKey();
        if (!apiKey) {
          finish(undefined);
          return;
        }
        const ctx: CompletionContext = {
          prefix,
          suffix,
          modelId,
          maxTokens: this.options.resolveMaxTokens(),
        };
        const result = await this.options.engine.complete(ctx, signal);
        if (!result.text) {
          finish(undefined);
          return;
        }
        finish([new vscode.InlineCompletionItem(result.text, new vscode.Range(position, position))]);
        this.options.onSuggestion?.(result.text, position, document);
      });
    });
  }

  dispose(): void {
    this.debouncer.dispose();
  }
}
