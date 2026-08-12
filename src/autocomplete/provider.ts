/**
 * InlineCompletionItemProvider for ghost-text suggestions (issue #49).
 *
 * Opt-in via `opencodego.inlineSuggestions`. The provider debounces typing
 * (300ms), aborts in-flight requests on the next keystroke, and returns a
 * single completion item whose insertText is the model's suggestion.
 */

import * as vscode from "vscode";
import { buildCompletionWindow, DEFAULT_MAX_TOKENS } from "./context";
import { Debouncer } from "./throttle";
import type { CompletionEngine } from "./types";

export const COMPLETION_DEBOUNCE_MS = 300;

export interface InlineCompletionProviderOptions {
  engine: CompletionEngine;
  /** Resolve the API key (async; the caller owns caching/fallbacks). */
  resolveApiKey: () => Promise<string | undefined>;
  /** Whether suggestions are currently enabled (config-driven). */
  isEnabled: () => boolean;
  /** The model to use for suggestions (config-driven). */
  resolveModelId: () => string;
}

export class OpenCodeInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
  private readonly debouncer = new Debouncer(COMPLETION_DEBOUNCE_MS);

  constructor(private readonly options: InlineCompletionProviderOptions) {}

  provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    if (!this.options.isEnabled()) {
      return Promise.resolve(undefined);
    }

    const text = document.getText();
    const offset = document.offsetAt(position);
    const { prefix, suffix } = buildCompletionWindow(text, offset);
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
        this.debouncer.cancel();
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
        const result = await this.options.engine.complete({ prefix, suffix, modelId, maxTokens: DEFAULT_MAX_TOKENS }, signal);
        if (!result.text) {
          finish(undefined);
          return;
        }
        finish([new vscode.InlineCompletionItem(result.text, new vscode.Range(position, position))]);
      });
    });
  }

  dispose(): void {
    this.debouncer.dispose();
  }
}
