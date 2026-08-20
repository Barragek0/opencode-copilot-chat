/**
 * GLM (ZhipuAI) thinking strategy.
 *
 * Uses `thinking: { type: "enabled" | "disabled" }` when off, and
 * `reasoning_effort` for concrete effort levels (high/max). The gateway does
 * not transform GLM thinking params, so we send them through as-is.
 */
import { BaseThinkingProvider } from "./base";
import { schemaFromReasoningOptions, effortProperty, type ThinkingSchema } from "./schema";
import type { ResolvedModelMetadata } from "../models/metadata";
import type { ThinkingSettings, ThinkingFamily, BuildThinkingPayloadOptions } from "./types";

// Standard GLM models accept off/high/max (issue #61).
const GLM_EFFORTS = ["off", "high", "max"] as const;
// GLM 5.3+ always engage in thinking and reject `disabled` (issue #162); the
// upstream accepts high/max reasoning effort, so we expose only those.
const GLM_ALWAYS_THINKING_EFFORTS = ["high", "max"] as const;

/**
 * GLM 5.3 and later cannot disable thinking (Zhipu API constraint — the same
 * class of issue as Kimi K2.7-code in #25). Detected by version so future 5.x
 * releases are covered automatically.
 */
function isAlwaysThinking(modelId: string): boolean {
  return /^glm-5[.\-](?:[3-9]|\d{2,})/i.test(modelId);
}

export class GlmThinking extends BaseThinkingProvider {
  readonly family: ThinkingFamily = "glm";

  constructor(readonly modelId: string) {
    super();
  }

  schema(metadata?: ResolvedModelMetadata): ThinkingSchema | undefined {
    const fromOptions = schemaFromReasoningOptions(metadata);
    if (fromOptions) return fromOptions;

    // GLM 5.3+ cannot disable thinking — expose only the effort levels the
    // upstream accepts, defaulting to "high" (defensive against stale cache).
    if (isAlwaysThinking(this.modelId)) {
      return {
        properties: {
          reasoningEffort: effortProperty({
            enum: GLM_ALWAYS_THINKING_EFFORTS,
            labels: ["High", "Max"],
            descriptions: ["Greater reasoning depth", "Maximum reasoning effort"],
            default: "high",
          }),
        },
      };
    }

    return {
      properties: {
        reasoningEffort: effortProperty({
          enum: GLM_EFFORTS,
          labels: ["Off", "High", "Max"],
          descriptions: ["Fastest responses", "Greater reasoning depth", "Maximum reasoning effort"],
          default: "off",
        }),
      },
    };
  }

  applyOverride(settings: ThinkingSettings, override: Record<string, unknown>): ThinkingSettings {
    const efforts = isAlwaysThinking(this.modelId) ? GLM_ALWAYS_THINKING_EFFORTS : GLM_EFFORTS;
    let next = this.applyEffort(settings, override, "glm", efforts);
    next = this.applyMode(next, override, "glm", efforts);
    return next;
  }

  normalize(settings: ThinkingSettings): ThinkingSettings {
    // GLM 5.3+ forces thinking on regardless of picker selection (defensive —
    // the picker only exposes effort levels, but VS Code may cache a stale
    // "off" value). The upstream rejects `thinking: { type: "disabled" }`.
    if (isAlwaysThinking(this.modelId) && settings.glm === "off") {
      return { ...settings, glm: "high" };
    }
    return settings;
  }

  buildPayload(thinking: ThinkingSettings, _opts?: BuildThinkingPayloadOptions): Record<string, unknown> {
    if (thinking.glm === "off") {
      return { thinking: { type: "disabled" } };
    }
    return { reasoning_effort: thinking.glm };
  }

  requestsThinking(thinking: ThinkingSettings): boolean {
    return thinking.glm !== "off";
  }
}
