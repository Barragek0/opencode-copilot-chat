import type * as vscode from "vscode";
import type { TransportRequestSummary } from "../core/transport";
import { RECENT_TRANSPORT_SUMMARY_LIMIT, RECENT_TRANSPORT_SUMMARY_STORAGE_PREFIX } from "../config";
import { stringifyInitiator } from "../request/headers";
import { formatCacheHitRatio } from "../usage/usage";

/**
 * Rolling log of recent transport request summaries per provider vendor,
 * persisted to globalState and rendered in the diagnostics output.
 */
export class TransportSummaryLog {
  private readonly entries: RecentTransportSummary[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly vendor: string,
  ) {}

  restore(): void {
    const stored = this.context.globalState.get<RecentTransportSummary[]>(storageKeyFor(this.vendor), []);

    if (!Array.isArray(stored) || !stored.length) {
      return;
    }

    this.entries.push(...stored.slice(-RECENT_TRANSPORT_SUMMARY_LIMIT));
  }

  record(summary: TransportRequestSummary, endpointKind: string, metadataSource: string, requestInitiator: unknown): void {
    // requestInitiator is an arbitrary value from the transport layer. Only
    // stringify it when it is a primitive; objects are JSON-serialized and
    // nullish values are dropped so diagnostics never show "[object Object]".
    const initiator = stringifyInitiator(requestInitiator);

    this.entries.push({
      ...summary,
      recordedAt: new Date().toISOString(),
      endpointKind,
      metadataSource,
      ...(initiator ? { requestInitiator: initiator } : {}),
    });

    if (this.entries.length > RECENT_TRANSPORT_SUMMARY_LIMIT) {
      this.entries.splice(0, this.entries.length - RECENT_TRANSPORT_SUMMARY_LIMIT);
    }

    void this.context.globalState.update(storageKeyFor(this.vendor), this.entries);
  }

  /** Formatted diagnostic blocks (newest first), for the output channel. */
  diagnosticLines(): string[] {
    if (!this.entries.length) {
      return ["No requests recorded in this extension host yet.", ""];
    }

    return this.entries
      .slice()
      .reverse()
      .flatMap((summary, index) => formatTransportSummaryBlock(summary, index));
  }
}

interface RecentTransportSummary extends TransportRequestSummary {
  recordedAt: string;
  endpointKind: string;
  metadataSource: string;
  requestInitiator?: string;
}

function storageKeyFor(vendor: string): string {
  return `${RECENT_TRANSPORT_SUMMARY_STORAGE_PREFIX}.${vendor}`;
}

function formatTransportSummaryBlock(summary: RecentTransportSummary, index: number): string[] {
  const status = summary.status ?? summary.abortedReason ?? "n/a";
  const cacheHitRatio = formatCacheHitRatio({
    promptTokens: summary.promptTokens,
    cachedTokens: summary.cachedTokens,
  });
  const lines = [
    `### ${String(index + 1)}. ${summary.modelId}`,
    "",
    `- time: ${summary.recordedAt}`,
    `- endpoint: ${summary.endpointKind}`,
    `- initiator: ${summary.requestInitiator ?? "unknown"}`,
    `- metadataSource: ${summary.metadataSource}`,
    `- status: ${String(status)}`,
    `- durationMs: ${String(summary.durationMs)}`,
    `- ttfbMs: ${String(summary.ttfbMs ?? "n/a")}`,
    `- totalBytes: ${String(summary.totalBytes)}`,
    `- totalEvents: ${String(summary.totalEvents)}`,
    `- tokens: prompt=${String(summary.promptTokens ?? "n/a")}, completion=${String(summary.completionTokens ?? "n/a")}, total=${String(summary.totalTokens ?? "n/a")}, cached=${String(summary.cachedTokens ?? "n/a")}`,
    `- cacheHitRatio: ${cacheHitRatio ?? "n/a"}`,
    `- finishReason: ${summary.finishReason ?? "n/a"}`,
    `- requestId: ${summary.requestId ?? "n/a"}`,
    `- sessionId: ${summary.sessionId ?? "n/a"}`,
    `- url: ${summary.url}`,
  ];

  if (summary.rateLimitSummary) {
    lines.push(`- rateLimit: ${summary.rateLimitSummary}`);
  }
  if (summary.errorMessage) {
    lines.push(`- error: ${summary.errorMessage}`);
  }

  lines.push("");
  return lines;
}
