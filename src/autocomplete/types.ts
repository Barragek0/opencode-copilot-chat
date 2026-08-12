/**
 * Inline completion engine contract (issue #49).
 *
 * A completion engine turns a code context (text before/after the cursor)
 * into a suggested insertion, or nothing. Engines are stateless and
 * cancellation-aware, so the provider can abort an in-flight completion on
 * the next keystroke and never show stale ghost text.
 */

export interface CompletionContext {
  /** Text before the cursor (the prefix). */
  prefix: string;
  /** Text after the cursor (the suffix), trimmed to a bounded window. */
  suffix: string;
  /** Maximum tokens the completion may produce. */
  maxTokens: number;
  /** The model id the engine should use (resolved by the caller). */
  modelId: string;
}

export interface CompletionResult {
  /** The code to insert at the cursor, or undefined when nothing matched. */
  text: string | undefined;
  /** Completion latency, for diagnostics. */
  durationMs: number;
}

export interface CompletionEngine {
  /** Unique engine id (used in diagnostics/log lines). */
  readonly id: string;
  complete(ctx: CompletionContext, signal: AbortSignal): Promise<CompletionResult>;
}
