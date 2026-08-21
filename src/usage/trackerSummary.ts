import { GO_LIMITS } from "../config";
import type { HistoryRow } from "./history";
import { FIVE_HOURS_MS, WEEK_MS } from "../config";
import type { UsageBaseline, UsageLogEntry, UsageSummary } from "./trackerTypes";
import { buildMonthlyWindow, nextSessionReset, startOfUtcDay, startOfUtcWeek } from "./trackerWindows";

/**
 * Summary aggregation for the Go usage tracker. The builders are pure: all
 * tracker state they need arrives via `SummaryContext`, so the class in
 * `tracker.ts` stays a thin shell over them.
 */

/** The slice of tracker state the summary builders read. */
export interface SummaryContext {
  entries: UsageLogEntry[];
  baseline: UsageBaseline;
  everTracked: boolean;
  dayStartMs(nowMs: number): number;
  dailyUsage(rows: HistoryRow[], dayStartMs: number): UsageSummary["today"];
  codebaseUsage(rows: HistoryRow[]): UsageSummary["codebase"];
  getActiveBaselineAmount(period: keyof UsageBaseline, nowMs: number): number;
}

export function buildSqliteEnrichedSummary(
  ctx: SummaryContext,
  nowMs: number,
  rows: HistoryRow[],
  clamp: (v: number, limit: number) => number,
): UsageSummary {
  const base = buildSummaryFromRows(ctx, nowMs, rows, clamp);

  // Today/Yesterday merge the CLI history (cost + tokens + requests) with
  // the extension's own tracked requests — the two never overlap, so the
  // sum is the user's real combined usage for the day.
  const dayMs = ctx.dayStartMs(nowMs);
  const yesterdayMs = dayMs - 24 * 60 * 60 * 1000;
  const today = ctx.dailyUsage(rows, dayMs);
  const yesterday = ctx.dailyUsage(rows, yesterdayMs);

  // Apply baselines on top of SQLite costs.
  const activeBaselineSession = ctx.getActiveBaselineAmount("session", nowMs);
  const activeBaselineWeekly = ctx.getActiveBaselineAmount("weekly", nowMs);
  const activeBaselineMonthly = ctx.getActiveBaselineAmount("monthly", nowMs);

  return {
    session: {
      ...base.session,
      spent: Math.round((base.session.spent + activeBaselineSession) * 10000) / 10000,
      percent: clamp(base.session.spent + activeBaselineSession, GO_LIMITS.session),
    },
    weekly: {
      ...base.weekly,
      spent: Math.round((base.weekly.spent + activeBaselineWeekly) * 10000) / 10000,
      percent: clamp(base.weekly.spent + activeBaselineWeekly, GO_LIMITS.weekly),
    },
    monthly: {
      ...base.monthly,
      spent: Math.round((base.monthly.spent + activeBaselineMonthly) * 10000) / 10000,
      percent: clamp(base.monthly.spent + activeBaselineMonthly, GO_LIMITS.monthly),
    },
    today,
    yesterday,
    codebase: ctx.codebaseUsage(rows),
    hasData: true,
    sqliteAvailable: true,
  };
}

/** Build summary from opencode.db rows (enrichment data from CLI history) */
export function buildSummaryFromRows(
  ctx: SummaryContext,
  nowMs: number,
  rows: HistoryRow[],
  clamp: (v: number, limit: number) => number,
): UsageSummary {
  const dayMs = startOfUtcDay(nowMs);
  const yesterdayMs = dayMs - 24 * 60 * 60 * 1000;
  const weekMs = startOfUtcWeek(nowMs);
  const sessionStart = nowMs - FIVE_HOURS_MS;
  const earliest = rows.length > 0 ? Math.min(...rows.map((r) => r.createdMs)) : null;
  const { monthStartMs, monthEndMs } = buildMonthlyWindow(nowMs, ctx.baseline, earliest);
  const weekEnd = weekMs + WEEK_MS;

  let sessionCost = 0,
    weeklyCost = 0,
    monthlyCost = 0;
  let todayCost = 0,
    todayReq = 0;
  let yestCost = 0,
    yestReq = 0;

  for (const r of rows) {
    if (r.createdMs >= sessionStart && r.createdMs <= nowMs) sessionCost += r.cost;
    if (r.createdMs >= weekMs && r.createdMs <= nowMs) weeklyCost += r.cost;
    if (r.createdMs >= monthStartMs && r.createdMs < monthEndMs) monthlyCost += r.cost;
    if (r.createdMs >= dayMs) {
      todayCost += r.cost;
      todayReq += 1;
    } else if (r.createdMs >= yesterdayMs) {
      yestCost += r.cost;
      yestReq += 1;
    }
  }

  // Rolling 5h reset: oldest entry in window + 5h
  let oldest: number | null = null;
  for (const r of rows) {
    if (r.createdMs >= sessionStart && r.createdMs < nowMs) {
      if (oldest === null || r.createdMs < oldest) oldest = r.createdMs;
    }
  }

  // If a monthly baseline exists and is active, use its expiresAt for resetsAt.
  const monthlyResetsAt = ctx.baseline.monthly ? new Date(ctx.baseline.monthly.expiresAt) : new Date(monthEndMs);

  return {
    session: {
      spent: Math.round(sessionCost * 10000) / 10000,
      limit: GO_LIMITS.session,
      percent: clamp(sessionCost, GO_LIMITS.session),
      resetsAt: new Date((oldest ?? nowMs) + FIVE_HOURS_MS),
    },
    weekly: {
      spent: Math.round(weeklyCost * 10000) / 10000,
      limit: GO_LIMITS.weekly,
      percent: clamp(weeklyCost, GO_LIMITS.weekly),
      resetsAt: new Date(weekEnd),
    },
    monthly: {
      spent: Math.round(monthlyCost * 10000) / 10000,
      limit: GO_LIMITS.monthly,
      percent: clamp(monthlyCost, GO_LIMITS.monthly),
      resetsAt: monthlyResetsAt,
    },
    today: {
      cost: Math.round(todayCost * 10000) / 10000,
      requests: todayReq,
      tokens: 0, // not available from SQLite
    },
    yesterday: {
      cost: Math.round(yestCost * 10000) / 10000,
      requests: yestReq,
      tokens: 0,
    },
    hasData: true,
    sqliteAvailable: true,
    codebase: { cost: 0, requests: 0, tokens: 0 },
  };
}

/** Build summary from extension-tracked entries (fallback when opencode.db unavailable) */
export function buildSummaryFromTracked(ctx: SummaryContext, nowMs: number, clamp: (v: number, limit: number) => number): UsageSummary {
  const dayMs = ctx.dayStartMs(nowMs);
  const yesterdayMs = dayMs - 24 * 60 * 60 * 1000;
  const weekMs = startOfUtcWeek(nowMs);
  const { monthStartMs, monthEndMs } = buildMonthlyWindow(nowMs, ctx.baseline);
  const sessionStart = nowMs - FIVE_HOURS_MS;

  let trackedSessionCost = 0,
    trackedWeeklyCost = 0,
    trackedMonthlyCost = 0;
  let todayCost = 0,
    todayReq = 0,
    todayTokens = 0;
  let yestCost = 0,
    yestReq = 0,
    yestTokens = 0;

  for (const e of ctx.entries) {
    if (e.timestamp >= sessionStart && e.timestamp <= nowMs) trackedSessionCost += e.cost;
    if (e.timestamp >= weekMs && e.timestamp <= nowMs) trackedWeeklyCost += e.cost;
    if (e.timestamp >= monthStartMs && e.timestamp < monthEndMs) trackedMonthlyCost += e.cost;
    if (e.timestamp >= dayMs) {
      todayCost += e.cost;
      todayReq += 1;
      todayTokens += e.promptTokens + e.completionTokens;
    } else if (e.timestamp >= yesterdayMs) {
      yestCost += e.cost;
      yestReq += 1;
      yestTokens += e.promptTokens + e.completionTokens;
    }
  }

  const activeBaselineSession = ctx.getActiveBaselineAmount("session", nowMs);
  const activeBaselineWeekly = ctx.getActiveBaselineAmount("weekly", nowMs);
  const activeBaselineMonthly = ctx.getActiveBaselineAmount("monthly", nowMs);

  const sessionCost = trackedSessionCost + activeBaselineSession;
  const weeklyCost = trackedWeeklyCost + activeBaselineWeekly;
  const monthlyCost = trackedMonthlyCost + activeBaselineMonthly;

  const weekEnd = weekMs + WEEK_MS;

  // If a monthly baseline exists and is active, use its expiresAt for resetsAt
  // instead of the anchor-based calculation (which ignores manual targets).
  const monthlyResetsAt = ctx.baseline.monthly ? new Date(ctx.baseline.monthly.expiresAt) : new Date(monthEndMs);

  return {
    session: {
      spent: Math.round(sessionCost * 10000) / 10000,
      limit: GO_LIMITS.session,
      percent: clamp(sessionCost, GO_LIMITS.session),
      resetsAt: nextSessionReset(ctx.entries, nowMs),
    },
    weekly: {
      spent: Math.round(weeklyCost * 10000) / 10000,
      limit: GO_LIMITS.weekly,
      percent: clamp(weeklyCost, GO_LIMITS.weekly),
      resetsAt: new Date(weekEnd),
    },
    monthly: {
      spent: Math.round(monthlyCost * 10000) / 10000,
      limit: GO_LIMITS.monthly,
      percent: clamp(monthlyCost, GO_LIMITS.monthly),
      resetsAt: monthlyResetsAt,
    },
    today: {
      cost: Math.round(todayCost * 10000) / 10000,
      requests: todayReq,
      tokens: todayTokens,
    },
    yesterday: {
      cost: Math.round(yestCost * 10000) / 10000,
      requests: yestReq,
      tokens: yestTokens,
    },
    // Without the CLI history there is no per-directory attribution, so the
    // codebase total falls back to everything this extension has tracked
    // (it only ever runs inside the current workspace).
    codebase: {
      cost: Math.round(ctx.entries.reduce((total, e) => total + e.cost, 0) * 10000) / 10000,
      requests: ctx.entries.length,
      tokens: ctx.entries.reduce((total, e) => total + e.promptTokens + e.completionTokens, 0),
    },
    hasData: ctx.entries.length > 0 || ctx.everTracked,
    sqliteAvailable: false,
  };
}
