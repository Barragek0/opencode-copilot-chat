import type * as vscode from "vscode";
import { getErrorMessage } from "../utils";

/**
 * Small pure helpers shared by the provider class. No instance state.
 */

/** Bundle the cancellation semantics of a VS Code token into an AbortSignal. */
export function signalFromToken(token: vscode.CancellationToken): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  let subscription: vscode.Disposable | undefined;
  if (token.isCancellationRequested) {
    controller.abort();
  } else {
    // Already-cancelled tokens still invoke the listener (shortcutEvent),
    // so this single subscription covers the subscribe-time race too.
    subscription = token.onCancellationRequested(() => {
      controller.abort();
    });
  }
  return {
    signal: controller.signal,
    dispose: () => {
      subscription?.dispose();
      subscription = undefined;
    },
  };
}

/** Error message with the underlying cause code appended when present. */
export function errMsg(error: unknown): string {
  const message = getErrorMessage(error);
  const cause = (error as { cause?: { code?: string; name?: string; message?: string } } | null | undefined)?.cause;
  return cause?.code ? `${message} [${cause.code}]` : message;
}
