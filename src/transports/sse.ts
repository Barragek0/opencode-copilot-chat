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
 * A successful OpenCode stream always terminates with a `data: [DONE]`
 * sentinel, and the extractors capture a `finish_reason`/`stop_reason` from the
 * final chunk. If the connection closed (`done`) without EITHER signal while we
 * had already extracted content, the stream was cut off mid-response (gateway
 * dropped the connection, proxy reset, upstream crash) and must not be treated
 * as a silent success.
 */
export function isStreamTruncated(params: {
  sawDone: boolean;
  finishReason: string | undefined;
  extractedPartCount: number;
  totalBytes: number;
}): boolean {
  return !params.sawDone && params.finishReason === undefined && params.extractedPartCount > 0 && params.totalBytes > 0;
}
