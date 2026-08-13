/**
 * Shared pure utilities used across the extension.
 *
 * CONTRACT: no `vscode` import, no side effects — unit-testable in plain
 * Node (same convention as `thinking.ts`). Everything here was extracted to
 * eliminate near-identical copies that existed in several modules.
 */

/** Narrow a value to a non-null record. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** First defined, non-empty string among the candidates. */
export function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

/**
 * Collapse an error text to lowercase alphanumerics for robust pattern
 * matching (whitespace/punctuation differ between gateways and versions).
 */
export function compactErrorCode(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

/** Positive finite number (floored), else undefined. */
export function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

/**
 * Coerce an unknown config value to a finite number within [min, max],
 * falling back to `fallback` for anything invalid.
 */
export function toFiniteNumber(value: unknown, fallback: number, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

/** Human-readable error text for any thrown value. */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Parse a JSON string safely; returns undefined on any failure. */
export function parseJsonSafe(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

// ─── Formatting helpers ──────────────────────────────────────────────────────

/** `$12.30`-style fixed two-decimal currency. */
export function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

/**
 * Compact human token count: 1.2M / 12k / 1.2k / raw number.
 * Rounds at >= 10k for a shorter status-bar label.
 */
export function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${Math.round(value / 1_000)}k`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

/** Compact relative time ("now", "5m", "3h", "3h 20m", "2d 4h"). */
export function formatRelativeTime(target: Date, from: Date = new Date()): string {
  const diffMs = target.getTime() - from.getTime();
  if (diffMs <= 0) return "now";
  const totalMinutes = Math.ceil(diffMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${String(minutes)}m`;
  if (minutes === 0) return `${String(hours)}h`;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return remainingHours === 0 ? `${String(days)}d` : `${String(days)}d ${String(remainingHours)}h`;
  }
  return `${String(hours)}h ${String(minutes)}m`;
}

/** Escape a value for embedding in HTML/SVG text content. */
export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ─── Async helpers ───────────────────────────────────────────────────────────

/** Structural subset of vscode.CancellationToken — keeps this module pure. */
export interface LikeCancellationToken {
  readonly isCancellationRequested: boolean;
  onCancellationRequested(listener: () => unknown): { dispose(): void };
}

/**
 * Delay for `ms`, rejecting with an AbortError when the token fires.
 * Used for retry backoff that must bail out of the retry loop on cancel.
 */
export function sleep(ms: number, token?: LikeCancellationToken): Promise<void> {
  if (token?.isCancellationRequested) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    const state: { timer?: ReturnType<typeof setTimeout>; subscription?: { dispose(): void } } = {};
    const finish = (cancelled: boolean): void => {
      if (state.timer) clearTimeout(state.timer);
      state.subscription?.dispose();
      if (cancelled) {
        reject(new DOMException("Aborted", "AbortError"));
      } else {
        resolve();
      }
    };
    state.timer = setTimeout(() => {
      finish(false);
    }, ms);
    if (token) {
      state.subscription = token.onCancellationRequested(() => {
        finish(true);
      });
    }
  });
}

/**
 * Delay for `ms`, resolving early (without error) when the token fires.
 * Used for backoff waits where cancellation is a normal short-circuit.
 */
export function sleepWithCancellation(ms: number, token: LikeCancellationToken): Promise<void> {
  if (token.isCancellationRequested) return Promise.resolve();

  return new Promise((resolve) => {
    const state: { cancellation?: { dispose(): void }; settled: boolean } = { settled: false };
    const finish = (): void => {
      if (state.settled) return;
      state.settled = true;
      clearTimeout(timer);
      state.cancellation?.dispose();
      resolve();
    };
    const timer = setTimeout(finish, ms);
    state.cancellation = token.onCancellationRequested(finish);

    // Close the race between the initial check and listener registration.
    if (state.settled) {
      state.cancellation.dispose();
    } else if (token.isCancellationRequested) {
      finish();
    }
  });
}
