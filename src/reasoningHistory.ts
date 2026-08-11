import { thinkingFamily } from "./thinking";

/**
 * Extract the raw thinking text from a history thinking part's value.
 *
 * `LanguageModelThinkingPart.value` may be a plain string or an array of
 * string chunks; this pure helper normalizes both. Callers keep the
 * `instanceof vscode.LanguageModelThinkingPart` (with a `typeof` guard —
 * proposed API) check themselves and pass the value here, so the text logic
 * stays unit-testable without a VS Code host.
 */
export function thinkingTextFromValue(value: string | string[]): string {
  if (Array.isArray(value)) {
    return value.filter((chunk): chunk is string => typeof chunk === "string").join("\n");
  }
  return value;
}

/**
 * Whether the CURRENT model accepts `reasoning_content` echoed on assistant
 * history messages.
 *
 * CONTRACT:
 * - DeepSeek V4 (and other OpenAI-compatible reasoning models) REQUIRE the
 *   previous `reasoning_content` to be passed back unchanged on multi-turn
 *   requests; omitting it 400s (upstream DeepSeek V4 issue #36354, same class
 *   of error as MiMo's validator in issue #38).
 * - Gemini maps it to `thought: true` parts and needs the echo too.
 * - GLM / Kimi / Qwen / MiniMax tolerate the echo (see processAssistantMessage
 *   CONTRACT above) and benefit from cross-turn reasoning continuity.
 * - Excluded families reject or ignore the field:
 *   - MiMo: strict Pydantic-style validator rejects `reasoning_content` (issue #38).
 *   - GPT: OpenAI Responses API — messages carry no `reasoning_content` field.
 *   - Claude: Anthropic Messages API — no `reasoning_content` field.
 * - Unknown families are left untouched (no echo).
 */
export function shouldEchoThinkingHistory(rawModelId: string | undefined): boolean {
  if (rawModelId === undefined) return false;
  if (/^mimo-/i.test(rawModelId)) return false;
  if (/^gpt-/i.test(rawModelId)) return false;
  if (/^claude-/i.test(rawModelId)) return false;
  return thinkingFamily(rawModelId) !== null || /^gemini-/i.test(rawModelId);
}
