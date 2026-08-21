import type * as vscode from "vscode";

/** Pure SSE `data:` line parser — one event string in, extracted parts out. */
export function parseServerSentEvent(
  event: string,
  extractParts: (data: unknown) => vscode.LanguageModelResponsePart[],
  onData?: (data: unknown) => void,
  onDone?: () => void,
): vscode.LanguageModelResponsePart[] {
  const lines = event
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim());

  const parts: vscode.LanguageModelResponsePart[] = [];

  for (const line of lines) {
    if (!line) {
      continue;
    }
    if (line === "[DONE]") {
      onDone?.();
      continue;
    }

    try {
      const data = JSON.parse(line) as unknown;
      onData?.(data);
      parts.push(...extractParts(data));
    } catch {
      // Ignore malformed SSE lines; the API may send comments or keep-alive frames.
    }
  }

  return parts;
}

/**
 * Pure: decide whether an SSE stream ended abnormally (truncated/aborted).
 *
 * Only transports that emit a `data: [DONE]` terminator (`usesDoneSentinel`)
 * can be trusted to signal completion via its absence. OpenAI-style transports
 * (chat-completions, Responses API) do; Google (`streamGenerateContent?alt=sse`,
 * native SSE) and Anthropic (`/messages`, `message_stop`) do NOT, and their
 * `finishReason` can be legitimately `null`/absent on a healthy stream. Gating
 * truncation detection on `usesDoneSentinel` avoids false-positive errors on
 * those transports (a healthy Gemini response whose finishReason normalizes to
 * `null` must not be reported as truncated).
 *
 * For a `[DONE]` transport, if the connection closed (`done`) without `[DONE]`
 * AND without a captured `finish_reason` while we had already extracted content,
 * the stream was cut off mid-response (gateway dropped the connection, proxy
 * reset, upstream crash) and must not be treated as a silent success.
 */
export function isStreamTruncated(params: {
  usesDoneSentinel: boolean;
  sawDone: boolean;
  finishReason: string | undefined;
  extractedPartCount: number;
  totalBytes: number;
}): boolean {
  if (!params.usesDoneSentinel) {
    return false;
  }
  return !params.sawDone && params.finishReason === undefined && params.extractedPartCount > 0 && params.totalBytes > 0;
}
