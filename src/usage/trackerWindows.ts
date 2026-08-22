import { FIVE_HOURS_MS } from "../config";
import type { UsageBaseline, UsageLogEntry } from "./trackerTypes";

/**
 * Pure time-window and path helpers used by the usage tracker and its summary
 * builders. No state, no I/O.
 */

export function startOfUtcDay(nowMs: number): number {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Start of the LOCAL day — used when `usageDayBoundary` is set to "local". */
export function startOfLocalDay(nowMs: number): number {
  const d = new Date(nowMs);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Normalize a directory path for matching (trailing separators, Windows case). */
export function normalizeCwd(value: string): string {
  let normalized = value.replace(/[\/]+$/, "");
  if (process.platform === "win32") {
    normalized = normalized.toLowerCase();
  }
  return normalized;
}

/** Whether `value` starts with `prefix` followed by a path separator. */
function startsWithPathSegment(value: string, prefix: string): boolean {
  if (!value.startsWith(prefix)) {
    return false;
  }
  return value.length > prefix.length && (value.charAt(prefix.length) === "/" || value.charAt(prefix.length) === "\\");
}

/**
 * Whether a CLI row's working directory belongs to the current workspace.
 * Matches when the folder equals the cwd, is a parent of it (the user opened
 * the repo root but the CLI ran in a subfolder), or the folder is a subfolder
 * of the cwd (the user opened a subfolder of the project).
 *
 * Segment-boundary matching accepts both `/` and `\` so POSIX-style paths and
 * native Windows paths (where the separator is `\`) both match on any host.
 */
export function isCwdInWorkspace(cwd: string | undefined, workspaceFolders: readonly string[]): boolean {
  if (!cwd || workspaceFolders.length === 0) {
    return false;
  }
  const rowCwd = normalizeCwd(cwd);
  for (const folder of workspaceFolders) {
    const normalized = normalizeCwd(folder);
    if (rowCwd === normalized) return true;
    if (startsWithPathSegment(rowCwd, normalized)) return true;
    if (startsWithPathSegment(normalized, rowCwd)) return true;
  }
  return false;
}

export function startOfUtcWeek(nowMs: number): number {
  const d = new Date(nowMs);
  const offset = (d.getUTCDay() + 6) % 7; // Monday=0
  d.setUTCDate(d.getUTCDate() - offset);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

function anchoredMonthStart(nowMs: number, anchorDay: number, anchorHour: number): number {
  const now = new Date(nowMs);
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth();
  let candidate = Date.UTC(year, month, anchorDay, anchorHour, 0, 0, 0);
  if (candidate > nowMs) {
    if (month === 0) {
      year--;
      month = 11;
    } else {
      month--;
    }
    candidate = Date.UTC(year, month, anchorDay, anchorHour, 0, 0, 0);
  }
  return candidate;
}

function anchoredMonthEnd(startMs: number, anchorDay: number, anchorHour: number): number {
  const d = new Date(startMs);
  let year = d.getUTCFullYear();
  let month = d.getUTCMonth() + 1;
  if (month > 11) {
    year++;
    month = 0;
  }
  return Date.UTC(year, month, anchorDay, anchorHour, 0, 0, 0);
}

/** Build the monthly window: manual anchor > auto-anchor from earliest row > calendar month. */
export function buildMonthlyWindow(
  nowMs: number,
  baseline: UsageBaseline,
  earliestMs?: number | null,
): { monthStartMs: number; monthEndMs: number } {
  // Priority 1: user-configured anchor (set via "Set spent targets")
  const monthly = baseline.monthly;
  const monthlyAnchor = monthly?.anchorDay;
  if (monthly && monthlyAnchor && monthlyAnchor >= 1 && monthlyAnchor <= 31) {
    const hour = monthly.anchorHour ?? 0;
    const start = anchoredMonthStart(nowMs, monthlyAnchor, hour);
    const end = anchoredMonthEnd(start, monthlyAnchor, hour);
    return { monthStartMs: start, monthEndMs: end };
  }
  // Priority 2: auto-anchor from earliest SQLite row (actual billing start)
  if (earliestMs != null) {
    const d = new Date(earliestMs);
    const day = d.getUTCDate();
    const hour = d.getUTCHours();
    const start = anchoredMonthStart(nowMs, day, hour);
    const end = anchoredMonthEnd(start, day, hour);
    return { monthStartMs: start, monthEndMs: end };
  }
  // Fallback: calendar month
  const now = new Date(nowMs);
  return {
    monthStartMs: Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    monthEndMs: Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  };
}

/** Rolling reset: oldest entry in the current 5h window + 5h */
export function nextSessionReset(entries: UsageLogEntry[], nowMs: number): Date {
  const windowStart = nowMs - FIVE_HOURS_MS;
  let oldest: number | null = null;
  for (const e of entries) {
    if (e.timestamp >= windowStart && e.timestamp < nowMs) {
      if (oldest === null || e.timestamp < oldest) oldest = e.timestamp;
    }
  }
  return new Date((oldest ?? nowMs) + FIVE_HOURS_MS);
}

// ─── Exported tracker class ──────────────────────────────────────────────────
