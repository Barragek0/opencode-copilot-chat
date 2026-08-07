export interface PromptToolDefinition {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

/** Estimate the complete prompt surface that the provider will tokenize. */
export function estimatePromptTokenCount(messages: unknown, tools?: readonly PromptToolDefinition[]): number {
  const prompt = {
    messages,
    ...(tools?.length
      ? {
          tools: tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })),
        }
      : {}),
  };

  return estimateTokenCount(JSON.stringify(prompt));
}

export function estimateTokenCount(value: string): number {
  if (!value) return 0;

  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return 0;

  // JSON structure makes word-count heuristics far too pessimistic. Character
  // count is steadier; modelLimits adds a proportional request-time margin for
  // tokenizer differences and retry.ts handles authoritative overflow errors.
  const cjkCharacters = normalized.match(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/gu)?.length ?? 0;
  const charEstimate = Math.ceil(normalized.length / 4);
  const codeBuffer = Math.ceil(charEstimate * 0.1);

  return Math.max(1, Math.ceil(charEstimate + codeBuffer + cjkCharacters));
}
