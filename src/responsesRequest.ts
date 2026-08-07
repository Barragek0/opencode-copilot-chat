export interface ResponsesRequestEnvelopeOptions {
  model: string;
  input: readonly unknown[];
  maxOutputTokens: number;
  temperature?: number;
  thinkingPayload?: Record<string, unknown>;
  tools?: readonly unknown[];
  toolChoice?: unknown;
}

/** Build the transport-independent portion of an OpenAI Responses request. */
export function buildResponsesRequestEnvelope(options: ResponsesRequestEnvelopeOptions): Record<string, unknown> {
  const tools = options.tools ?? [];

  return {
    model: options.model,
    input: options.input,
    max_output_tokens: options.maxOutputTokens,
    truncation: "auto",
    ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
    stream: true,
    ...(options.thinkingPayload ?? {}),
    ...(tools.length > 0 ? { tools, tool_choice: options.toolChoice } : {}),
  };
}
