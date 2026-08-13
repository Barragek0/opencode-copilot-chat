/**
 * Prompt construction for the chat-completions completion engine (issue #49).
 *
 * OpenCode exposes only /chat/completions (no FIM endpoint — probed 404 on
 * /completions), so fill-in-the-middle is emulated with FIM tokens inline in
 * the prompt. The engine families that genuinely support non-thinking mode
 * (verified live: qwen3.5-plus with enable_thinking=false produces zero
 * hidden reasoning) are used with thinking forced off.
 *
 * Pure and unit-tested.
 */

export type CompletionFamily = "qwen" | "deepseek" | "unknown";

export function completionFamily(modelId: string): CompletionFamily {
  if (/^qwen/i.test(modelId)) return "qwen";
  if (/^deepseek/i.test(modelId)) return "deepseek";
  return "unknown";
}

export const COMPLETION_SYSTEM_PROMPT = "Return only the missing code at the cursor. No explanations, no markdown.";

/** FIM delimiter tokens per family. DeepSeek/Qwen descend from code models that know them. */
function fimTokens(family: CompletionFamily): { prefix: string; suffix: string; middle: string } {
  switch (family) {
    case "qwen":
      return { prefix: "<|fim_prefix|>", suffix: "<|fim_suffix|>", middle: "<|fim_middle|>" };
    case "deepseek":
      return { prefix: "EDMFunc", suffix: "EDMFunc", middle: "EDMFunc" };
    default:
      return { prefix: "<|fim_prefix|>", suffix: "<|fim_suffix|>", middle: "<|fim_middle|>" };
  }
}

export interface CompletionPrompt {
  messages: Array<{ role: string; content: string }>;
  /** Extra body fields the gateway needs for this family (e.g. enable_thinking). */
  extra: Record<string, unknown>;
}

export function buildCompletionPrompt(prefix: string, suffix: string, modelId: string): CompletionPrompt {
  const family = completionFamily(modelId);
  const tokens = fimTokens(family);
  const userContent = `${tokens.prefix}${prefix}${tokens.suffix}${suffix}${tokens.middle}`;

  const extra: Record<string, unknown> = {};
  if (family === "qwen") {
    // Qwen3 hybrid: enable_thinking=false is a genuine no-reasoning mode
    // (verified: 0 hidden reasoning chars, ~1.5s TTFB live).
    extra.enable_thinking = false;
  }

  return {
    messages: [
      { role: "system", content: COMPLETION_SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
    extra,
  };
}
