/**
 * Muse Spark (Meta) thinking strategy.
 *
 * Muse Spark models route through the OpenAI Responses API where reasoning
 * is a nested `reasoning: { effort }` object — same wire format as GPT 5.x.
 *
 * DISPLAY: Muse Spark is a native reasoning model — `reasoning_content` is
 * always genuine chain-of-thought and goes to the thinking panel.
 */
import { BaseThinkingProvider } from "./base";
import { schemaFromReasoningOptions, effortProperty, type ThinkingSchema } from "./schema";
import type { ResolvedModelMetadata } from "../models/metadata";
import type { ThinkingSettings, ThinkingFamily, BuildThinkingPayloadOptions } from "./types";

const MUSE_EFFORTS = ["off", "low", "medium", "high", "xhigh"] as const;

export class MuseThinking extends BaseThinkingProvider {
  readonly family: ThinkingFamily = "muse";

  constructor(readonly modelId: string) {
    super();
  }

  schema(metadata?: ResolvedModelMetadata): ThinkingSchema | undefined {
    return (
      schemaFromReasoningOptions(metadata) ?? {
        properties: {
          reasoningEffort: effortProperty({
            enum: MUSE_EFFORTS,
            labels: ["Off", "Low", "Medium", "High", "XHigh"],
            descriptions: [
              "Fastest responses",
              "Faster responses with less reasoning",
              "Balanced reasoning and speed",
              "Greater reasoning depth",
              "Maximum reasoning depth",
            ],
            default: "off",
          }),
        },
      }
    );
  }

  applyOverride(settings: ThinkingSettings, override: Record<string, unknown>): ThinkingSettings {
    return this.applyEffort(settings, override, "muse", MUSE_EFFORTS);
  }

  buildPayload(thinking: ThinkingSettings, _opts?: BuildThinkingPayloadOptions): Record<string, unknown> {
    if (thinking.muse === "off") {
      return {};
    }
    return { reasoning: { effort: thinking.muse } };
  }

  requestsThinking(thinking: ThinkingSettings): boolean {
    return thinking.muse !== "off";
  }

  // reasoning_content is always genuine CoT → never surfaced as visible text
  treatReasoningAsContent(_url: string, _thinking: ThinkingSettings): boolean {
    return false;
  }
}
