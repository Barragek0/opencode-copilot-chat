import type { BaseModelLimits } from "./metadata";

const UI_OUTPUT_TOKEN_RESERVE = 8192;
const TOKEN_ESTIMATE_SAFETY_MARGIN = 64;

export interface ModelLimits extends BaseModelLimits {
  advertisedContextWindow: number;
  advertisedMaxInputTokens: number;
  advertisedMaxOutputTokens: number;
}

export interface ModelLimitOverrides {
  maxInputTokens?: number;
  maxOutputTokens?: number;
  contextSize?: number;
  promptTokens?: number;
}

/**
 * Resolve the limits advertised to VS Code and the output budget sent upstream.
 * When the prompt size is known, the request budget never exceeds the remaining
 * context. Responses API requests can then truncate old input safely if needed.
 */
export function calculateModelLimits(metadata: BaseModelLimits, overrides: ModelLimitOverrides = {}): ModelLimits {
  const baseContextWindow = positiveOverride(overrides.maxInputTokens) ?? metadata.contextWindow;
  const contextSize = positiveOverride(overrides.contextSize);
  const contextWindow = contextSize === undefined ? baseContextWindow : Math.min(baseContextWindow, contextSize);
  const configuredMaxOutputTokens = positiveOverride(overrides.maxOutputTokens) ?? metadata.maxOutputTokens;

  const promptReserve = (overrides.promptTokens ?? Math.floor(contextWindow * 0.8)) + TOKEN_ESTIMATE_SAFETY_MARGIN;
  const remainingContext = Math.max(1, contextWindow - promptReserve);
  const maxOutputTokens = Math.max(1, Math.min(configuredMaxOutputTokens, remainingContext));

  const advertisedContextWindow = contextWindow;
  const advertisedMaxOutputTokens = Math.max(1, Math.min(maxOutputTokens, UI_OUTPUT_TOKEN_RESERVE));

  return {
    contextWindow,
    maxOutputTokens,
    advertisedContextWindow,
    advertisedMaxInputTokens: Math.max(1, advertisedContextWindow - advertisedMaxOutputTokens),
    advertisedMaxOutputTokens,
  };
}

function positiveOverride(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}
