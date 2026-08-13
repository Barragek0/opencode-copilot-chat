/**
 * Per-day chat-completion usage counters (inline suggestions shown vs
 * accepted), persisted in globalState. Pure logic so it is unit-testable.
 */

export interface CompletionUsageDay {
  /** Unix ms at the START of the day (same boundary as the usage charts). */
  dayStart: number;
  /** Ghost-text suggestions the provider returned to VS Code. */
  suggested: number;
  /** Suggestions the user accepted (only counted when the API reports it). */
  approved: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Increment one counter for the given day (mutates and returns `days`). */
export function bumpCompletionUsage(
  days: CompletionUsageDay[],
  dayStart: number,
  kind: "suggested" | "approved",
  maxDays = 370,
): CompletionUsageDay[] {
  let day = days.find((d) => d.dayStart === dayStart);
  if (!day) {
    day = { dayStart, suggested: 0, approved: 0 };
    days.push(day);
    if (days.length > maxDays) {
      days.splice(0, days.length - maxDays);
    }
  }
  day[kind] += 1;
  return days;
}

/**
 * Whether a document change counts as accepting a ghost-text suggestion.
 * VS Code's stable API exposes no acceptance event, so we detect the insert
 * that happens when a suggestion is committed: it starts exactly at the
 * suggested position and the inserted text matches the suggestion.
 *
 * False positives are bounded by requiring a multi-character insert that
 * matches the suggestion prefix/suffix — a single keystroke that happens to
 * coincide is not counted.
 */
export function matchesAcceptance(changeText: string, pendingText: string): boolean {
  if (changeText.length < 2 || !pendingText) return false;
  return changeText.startsWith(pendingText) || pendingText.startsWith(changeText);
}

/** Start of the UTC day (the default chart boundary). */
export function utcDayStart(nowMs: number): number {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Align the stored per-day counters to a chart window. `windowDays` 0 =
 * lifetime (from the earliest stored day to today). Days without counters
 * are emitted as zeros so the line chart always spans the full window.
 */
export function completionUsageToSeries(
  days: CompletionUsageDay[],
  dayStartMs: number,
  windowDays: number,
  firstDayOverride?: number,
): { dayStart: number; suggested: number; approved: number }[] {
  const byDay = new Map(days.map((d) => [d.dayStart, d]));
  let firstDay: number;
  if (firstDayOverride !== undefined) {
    // Align with the usage chart's own day range (both series must share the
    // exact same buckets, otherwise hover values go undefined).
    firstDay = firstDayOverride;
  } else if (windowDays > 0) {
    firstDay = dayStartMs - (Math.max(1, Math.floor(windowDays)) - 1) * DAY_MS;
  } else if (days.length > 0) {
    const earliest = Math.min(...days.map((d) => d.dayStart));
    firstDay = dayStartMs - Math.ceil((dayStartMs - earliest) / DAY_MS) * DAY_MS;
  } else {
    firstDay = dayStartMs;
  }
  const count = Math.round((dayStartMs - firstDay) / DAY_MS) + 1;
  return Array.from({ length: count }, (_, i) => {
    const start = firstDay + i * DAY_MS;
    const day = byDay.get(start);
    return { dayStart: start, suggested: day?.suggested ?? 0, approved: day?.approved ?? 0 };
  });
}
